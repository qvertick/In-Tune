"""Read-only, user-initiated LRCLIB API adapter (https://lrclib.net/docs).

GET /api/lrclib/search?track=...&artist=...&album=...&duration=...
returns [LyricsRecord, ...] (at most 20). track is required,
metadata is 1..200 printable characters (optional empty artist/album omitted).
duration is optional, finite, 0..86400 seconds; it stably sorts the one upstream
search response by absolute duration difference. No versions are filtered out.
There is no pagination or fan-out.
GET /api/lrclib/track?id=... OR ?url=https://lrclib.net/tracks/123 returns
LyricsRecord. Exactly one selector is required, IDs are 1..2**63-1.
All adapter errors use {"error": {"code": str, "message": str}} and an HTTP
status; Retry-After is included only for a valid upstream header or the explicit
local request-gap/window policy. No automatic retries are performed.

Records retain the documented camelCase fields, including nullable lyrics and
raw lyricsfile YAML. No uploads, publishing, audio access or persistent writes.
"""
from collections import OrderedDict, deque
from copy import deepcopy
from email.utils import parsedate_to_datetime
import http.client
import json
import logging
import math
import re
import threading
import time
from urllib.parse import urlencode

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from .sources.errors import SourceError
from .sources.network import _PinnedHTTPS, _resolve

HOST = "lrclib.net"
USER_AGENT = "InTune/1.0 (https://github.com/qvertick/In-Tune)"
TOTAL_TIMEOUT = 12.0
MAX_BYTES = 2 * 1024 * 1024
MAX_RESULTS = 20
MAX_ID = 2**63 - 1
CACHE_TTL = 300
CACHE_ENTRIES = 64
CACHE_BYTES = 8 * 1024 * 1024
REQUESTS_PER_MINUTE = 20
REQUEST_GAP = 0.5
router = APIRouter(prefix="/api/lrclib", tags=["lrclib"])
logger = logging.getLogger(__name__)
DIAGNOSTIC_BYTES = 2048


class LrclibError(Exception):
    def __init__(self, code: str, message: str, status: int = 502,
                 retry_after: int | None = None):
        super().__init__(message)
        self.code, self.status, self.retry_after = code, status, retry_after


class LyricsRecord(BaseModel):
    # Reject coercions (e.g. "false", bool IDs), nonfinite durations and huge
    # fields. Unknown future fields never pass through to the application.
    model_config = ConfigDict(strict=True, extra="ignore", allow_inf_nan=False)
    id: int = Field(ge=1, le=MAX_ID)
    name: str = Field(max_length=2000)
    trackName: str = Field(max_length=2000)
    artistName: str = Field(max_length=2000)
    albumName: str = Field(max_length=2000)
    duration: float = Field(ge=0, le=86400)
    instrumental: bool
    hasWordSync: bool
    plainLyrics: str | None = Field(max_length=120000)
    syncedLyrics: str | None = Field(max_length=240000)
    lyricsfile: str = Field(max_length=1024 * 1024)

    @field_validator("name", "trackName", "artistName", "albumName", "plainLyrics", "syncedLyrics", "lyricsfile")
    @classmethod
    def valid_unicode(cls, value):
        if value is not None and re.search(r"[\ud800-\udfff]", value):
            raise ValueError("Unpaired Unicode surrogate")
        return value


class TTLCache:
    """LRU/TTL cache bounded by both entries and serialized UTF-8 bytes.

    Accessed under the client's state lock; serialized values isolate callers.
    """
    def __init__(self):
        self.entries = OrderedDict()
        self.size = 0

    def _remove(self, key):
        self.size -= len(self.entries.pop(key)[1])

    def _expire(self, now):
        for key, (expires, _) in list(self.entries.items()):
            if expires <= now:
                self._remove(key)

    def get(self, key, now):
        self._expire(now)
        if key not in self.entries:
            return None
        self.entries.move_to_end(key)
        return json.loads(self.entries[key][1])

    def put(self, key, value, now):
        self._expire(now)
        data = json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8")
        if key in self.entries:
            self._remove(key)
        if len(data) > CACHE_BYTES:
            return
        self.entries[key] = (now + CACHE_TTL, data)
        self.size += len(data)
        while len(self.entries) > CACHE_ENTRIES or self.size > CACHE_BYTES:
            self._remove(next(iter(self.entries)))


def _id(value: str) -> int:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{1,19}", value):
        raise LrclibError("invalid_id", "ID должен быть положительным целым числом.", 422)
    identifier = int(value)
    if not 1 <= identifier <= MAX_ID:
        raise LrclibError("invalid_id", "ID вне допустимого диапазона.", 422)
    return identifier


def validate_track_url(url: str) -> int:
    # Match the entire literal URL, without decoding/normalizing ambiguous URLs.
    match = re.fullmatch(r"https://lrclib\.net/tracks/([0-9]{1,19})", url)
    if not match:
        raise LrclibError("invalid_url", "Нужна ссылка https://lrclib.net/tracks/число.", 422)
    return _id(match[1])


def _text(value: str | None, required: bool = False) -> str:
    if value is None:
        value = ""
    if (len(value) > 200 or re.search(r"[\x00-\x1f\x7f]", value)
            or any(0xd800 <= ord(char) <= 0xdfff for char in value)):
        raise LrclibError("invalid_query", "Поля поиска: до 200 печатных символов.", 422)
    value = " ".join(value.split())
    if required and not value:
        raise LrclibError("invalid_query", "Укажите название трека (track).", 422)
    return value


def _duration(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        if len(value) > 32 or not value.strip():
            raise ValueError()
        number = float(value)
        if not math.isfinite(number) or not 0 <= number <= 86400:
            raise ValueError()
        return number
    except ValueError as exc:
        raise LrclibError("invalid_duration", "duration: число секунд от 0 до 86400.", 422) from exc


def _retry_after(value: str | None) -> int | None:
    if value:
        if re.fullmatch(r"[0-9]{1,12}", value.strip()):
            return int(value)
        try:
            return max(0, math.ceil(parsedate_to_datetime(value).timestamp() - time.time()))
        except (ValueError, TypeError, OverflowError):
            pass
    return None


def _exception_chain(exc):
    # Never stringify exceptions: validation inputs, URLs and lyrics may be in them.
    chain, seen = [], set()
    while exc is not None and id(exc) not in seen and len(chain) < 8:
        seen.add(id(exc))
        chain.append(type(exc).__name__)
        exc = exc.__cause__ or (None if exc.__suppress_context__ else exc.__context__)
    return chain


def _body_diagnostic(body):
    """A structural snippet only; no arbitrary upstream strings or lyrics."""
    try:
        value = json.loads(body)
    except (ValueError, UnicodeError, RecursionError):
        return {"type": "html" if b"<html" in body[:512].lower() else "non_json",
                "sample_bytes": min(len(body), DIAGNOSTIC_BYTES)}
    result = {"type": type(value).__name__}
    if isinstance(value, dict):
        name = value.get("name")
        if isinstance(name, str) and name in {"ServerOverloaded", "TrackNotFound", "TooManyRequests"}:
            result["error_name"] = name
        # Only known field names and their types; no metadata/search text either.
        result["snippet"] = {key: type(value[key]).__name__ for key in
                             ("id", "statusCode", "message", "plainLyrics", "syncedLyrics", "lyricsfile")
                             if key in value}
    return result


def _response_diagnostic(response):
    # Allowlist and bound response headers. Never log cookies, Location or IDs.
    result = {"status": response.status}
    for name in ("Content-Type", "Content-Length", "Content-Encoding", "Retry-After", "Server"):
        value = response.getheader(name)
        if value is not None:
            if name == "Retry-After":
                wait = _retry_after(value)
                result[name] = wait if wait is not None else "[invalid]"
            elif name == "Content-Length":
                result[name] = value if re.fullmatch(r"[0-9]{1,10}", value) else "[invalid]"
            else:
                allowed = {"Content-Type": {"application/json", "text/html", "text/plain"},
                           "Content-Encoding": {"identity", "gzip", "br", "deflate"},
                           "Server": {"cloudflare", "nginx"}}[name]
                token = value.split(";", 1)[0].strip().lower()
                result[name] = token if token in allowed else "[other]"
    return result


def _download(target: str):
    """Only fixed-host API targets; reuse public-DNS pinning/TLS/watchdog.

    No proxy environment, redirect following, URL fetching or automatic retries.
    Status is handled before decoding: edge 429/503 responses may be HTML.
    """
    if not (re.fullmatch(r"/api/get/[0-9]{1,19}", target)
            or target.startswith("/api/search?track_name=")):
        raise LrclibError("invalid_query", "Недопустимый запрос LRCLIB.", 422)
    deadline = time.monotonic() + TOTAL_TIMEOUT
    connection = response = watchdog = None
    diagnostic = {"operation": "get" if target.startswith("/api/get/") else "search"}
    try:
        connection = _PinnedHTTPS(HOST, _resolve(HOST, deadline), deadline)
        watchdog = threading.Timer(max(0.001, deadline - time.monotonic()), connection.abort)
        watchdog.daemon = True
        watchdog.start()
        connection.request("GET", target, headers={
            "User-Agent": USER_AGENT, "Accept": "application/json",
            "Accept-Encoding": "identity", "Connection": "close",
        })
        response = connection.getresponse()
        diagnostic["response"] = _response_diagnostic(response)
        # Read at most a small prefix for non-success diagnostics, without parsing
        # lyrics or letting an error-body failure hide the original HTTP status.
        error_name = None
        if response.status != 200:
            try:
                preview = bytearray()
                while len(preview) < DIAGNOSTIC_BYTES:
                    if time.monotonic() >= deadline:
                        raise TimeoutError()
                    chunk = response.read1(DIAGNOSTIC_BYTES - len(preview))
                    if not chunk:
                        break
                    preview.extend(chunk)
                diagnostic["body"] = _body_diagnostic(preview)
                error_name = diagnostic["body"].get("error_name")
            except (OSError, http.client.HTTPException, ValueError) as exc:
                diagnostic["body_read_exception"] = _exception_chain(exc)
        if response.status == 404:
            raise LrclibError("not_found", "Запись LRCLIB не найдена.", 404)
        if response.status in (429, 503):
            limited = response.status == 429
            overloaded = response.status == 503 and error_name == "ServerOverloaded"
            raise LrclibError("upstream_rate_limited" if limited else
                              "upstream_overloaded" if overloaded else "upstream_unavailable",
                              "LRCLIB ограничил запросы." if limited else
                              "LRCLIB перегружен. Повторите запрос позже." if overloaded else "LRCLIB временно недоступен.",
                              response.status, _retry_after(response.getheader("Retry-After")))
        if 300 <= response.status < 400:
            raise LrclibError("upstream_redirect", "Переадресация LRCLIB заблокирована.")
        if response.status != 200:
            raise LrclibError("upstream_http_error", "LRCLIB вернул ошибку HTTP.")
        if response.getheader("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
            raise LrclibError("invalid_response", "LRCLIB вернул неподдерживаемый тип данных.")
        if response.getheader("Content-Encoding", "identity").lower() != "identity":
            raise LrclibError("invalid_response", "Сжатый ответ LRCLIB не поддерживается.")
        size = response.getheader("Content-Length")
        if size is not None and (not re.fullmatch(r"[0-9]{1,10}", size) or int(size) > MAX_BYTES):
            raise LrclibError("response_too_large", "Ответ LRCLIB превышает допустимый размер.")
        body = bytearray()
        while True:
            if time.monotonic() >= deadline:
                raise TimeoutError()
            if connection.active_socket:
                connection.active_socket.settimeout(min(3, max(0.001, deadline - time.monotonic())))
            chunk = response.read1(min(65536, MAX_BYTES + 1 - len(body)))
            if not chunk:
                break
            body.extend(chunk)
            if len(body) > MAX_BYTES:
                raise LrclibError("response_too_large", "Ответ LRCLIB превышает допустимый размер.")
        if size is not None and int(size) != len(body):
            raise LrclibError("invalid_response", "Неполный ответ LRCLIB.")
        diagnostic["body"] = _body_diagnostic(body)
        try:
            # Strict UTF-8, no NaN/Infinity; reject malformed/deep hostile JSON.
            def bad_constant(_):
                raise ValueError()
            value = json.loads(body.decode("utf-8"), parse_constant=bad_constant)
            logger.info("LRCLIB transport %s", json.dumps(diagnostic, ensure_ascii=True))
            return value
        except (ValueError, UnicodeError, RecursionError) as exc:
            raise LrclibError("invalid_response", "LRCLIB вернул некорректный JSON.") from exc
    except LrclibError as exc:
        logger.warning("LRCLIB transport %s", json.dumps({**diagnostic, "code": exc.code,
                       "exception_chain": _exception_chain(exc)}, ensure_ascii=True))
        raise
    except SourceError as exc:
        logger.warning("LRCLIB DNS %s", json.dumps({**diagnostic, "exception_chain": _exception_chain(exc)}))
        # DNS socket failures are network errors; rejected public-address checks
        # remain unsafe_dns. The shared DNS/TLS guard is unchanged.
        network_failure = isinstance(exc.__cause__, OSError)
        code = "upstream_timeout" if exc.status == 504 else "upstream_network_error" if network_failure else "unsafe_dns"
        raise LrclibError(code, "Не удалось безопасно разрешить адрес LRCLIB.", exc.status) from exc
    except TimeoutError as exc:
        logger.warning("LRCLIB timeout %s", json.dumps({**diagnostic, "exception_chain": _exception_chain(exc)}))
        raise LrclibError("upstream_timeout", "Превышено время ожидания LRCLIB.", 504) from exc
    except (OSError, http.client.HTTPException, ValueError) as exc:
        logger.warning("LRCLIB network %s", json.dumps({**diagnostic, "exception_chain": _exception_chain(exc)}))
        timed_out = time.monotonic() >= deadline
        raise LrclibError("upstream_timeout" if timed_out else "upstream_network_error",
                          "Не удалось безопасно загрузить LRCLIB.", 504 if timed_out else 502) from exc
    finally:
        if watchdog:
            watchdog.cancel()
        if response:
            response.close()
        if connection:
            connection.close()


def _record(value):
    try:
        return LyricsRecord.model_validate(value).model_dump()
    except ValidationError as exc:
        logger.warning("LRCLIB record validation %s", json.dumps({
            "status": 200,
            "exception_chain": _exception_chain(exc),
            "fields": [{"field": str(issue["loc"][0]) if issue["loc"] and issue["loc"][0] in LyricsRecord.model_fields else "record",
                        "type": issue["type"]} for issue in exc.errors(include_input=False, include_context=False, include_url=False)[:20]]}))
        raise LrclibError("invalid_response", "Некорректные поля записи LRCLIB.") from exc


class Client:
    def __init__(self):
        self.cache = TTLCache()
        self.lock = threading.Lock()
        self.network = threading.Lock()
        self.request_times = deque()
        self.blocked_until = 0.0
        self.next_request = 0.0

    def fetch(self, key, target, *, identifier=None):
        with self.lock:
            cached = self.cache.get(key, time.monotonic())
        if cached is not None:
            return cached
        if not self.network.acquire(blocking=False):
            raise LrclibError("busy", "Запрос LRCLIB уже выполняется.", 503)
        started = False
        try:
            with self.lock:
                now = time.monotonic()
                cached = self.cache.get(key, now)
                if cached is not None:
                    return cached
                until = max(self.blocked_until, self.next_request)
                while self.request_times and self.request_times[0] <= now - 60:
                    self.request_times.popleft()
                if len(self.request_times) >= REQUESTS_PER_MINUTE:
                    until = max(until, self.request_times[0] + 60)
                if until > now:
                    raise LrclibError("rate_limited", "Повторите запрос LRCLIB позже.", 429,
                                      max(1, math.ceil(until - now)))
                self.request_times.append(now)
                started = True
            raw = _download(target)
            if identifier is None:
                if not isinstance(raw, list) or len(raw) > MAX_RESULTS:
                    raise LrclibError("invalid_response", "Некорректный список результатов LRCLIB.")
                result = [_record(row) for row in raw]
            else:
                result = _record(raw)
                if result["id"] != identifier:
                    raise LrclibError("invalid_response", "ID ответа LRCLIB не совпадает с запросом.")
            with self.lock:
                self.cache.put(key, result, time.monotonic())
            return deepcopy(result)
        except LrclibError as exc:
            logger.warning("LRCLIB request failed %s", json.dumps({"code": exc.code, "status": exc.status,
                           "retry_after": exc.retry_after, "exception_chain": _exception_chain(exc)}))
            if exc.retry_after is not None and exc.code.startswith("upstream_"):
                with self.lock:
                    self.blocked_until = max(self.blocked_until, time.monotonic() + exc.retry_after)
            raise
        finally:
            if started:
                with self.lock:
                    self.next_request = time.monotonic() + REQUEST_GAP
            self.network.release()


_client = Client()


def search_tracks(track: str | None, artist: str | None = None,
                  album: str | None = None, duration: str | None = None):
    track, artist, album = _text(track, True), _text(artist), _text(album)
    seconds = _duration(duration)
    params = {"track_name": track}
    if artist:
        params["artist_name"] = artist
    if album:
        params["album_name"] = album
    # Cache the single upstream result independently of local duration ranking.
    rows = _client.fetch(("search", track, artist, album), "/api/search?" + urlencode(params))
    if seconds is not None:
        rows = sorted(rows, key=lambda row: abs(row["duration"] - seconds))
    return rows


def get_track(identifier: str | None = None, url: str | None = None):
    if (identifier is None) == (url is None):
        raise LrclibError("invalid_selector", "Укажите ровно один параметр: id или url.", 422)
    number = validate_track_url(url) if url is not None else _id(identifier)
    return _client.fetch(("track", number), f"/api/get/{number}", identifier=number)


def _query(request: Request, allowed: set[str]):
    pairs = request.query_params.multi_items()
    if (len(request.scope.get("query_string", b"")) > 4096
            or len(pairs) != len(set(key for key, _ in pairs))
            or any(key not in allowed for key, _ in pairs)):
        raise LrclibError("invalid_query", "Неизвестные, повторные или слишком длинные параметры.", 422)


def _response(operation):
    try:
        return JSONResponse(operation(), headers={"Cache-Control": "no-store"})
    except LrclibError as exc:
        headers = {"Cache-Control": "no-store"}
        if exc.retry_after is not None:
            headers["Retry-After"] = str(exc.retry_after)
        return JSONResponse({"error": {"code": exc.code, "message": str(exc)}},
                            status_code=exc.status, headers=headers)


@router.get("/search", response_model=list[LyricsRecord])
def search(request: Request, track: str | None = Query(default=None, description="Required; 1–200 characters"),
           artist: str | None = None, album: str | None = None,
           duration: str | None = Query(default=None, description="0–86400 seconds; stable local ranking by duration difference")):
    def operation():
        _query(request, {"track", "artist", "album", "duration"})
        return search_tracks(track, artist, album, duration)
    return _response(operation)


@router.get("/track", response_model=LyricsRecord)
def track(request: Request, id: str | None = Query(default=None, description="Positive integer; use id OR url"),
          url: str | None = Query(default=None, description="Exact https://lrclib.net/tracks/ID")):
    def operation():
        _query(request, {"id", "url"})
        return get_track(id, url)
    return _response(operation)
