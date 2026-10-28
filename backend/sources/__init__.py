"""Source discovery/preview router; mount with app.include_router(router).

Previews are transient. This package does not save songs or modify the song store.
No dependencies beyond the existing FastAPI/Pydantic runtime are required.
"""
from collections import OrderedDict, deque
from copy import deepcopy
import re
import threading
import time
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from .adapters import SOURCES, parse_preview, parse_search, source_list
from .errors import SourceError
from .network import fetch_page, validate_url
from .parser import parse_text

router = APIRouter(prefix="/api/sources", tags=["sources"])
_cache = OrderedDict()
_cache_lock = threading.Lock()
_request_times = deque()
_budget_lock = threading.Lock()
CACHE_ENTRIES = 64
CACHE_TTL = 300


def _network_budget():
    """Global local-app budget, bounded independently of arbitrary client addresses."""
    now = time.monotonic()
    with _budget_lock:
        while _request_times and _request_times[0] <= now - 60:
            _request_times.popleft()
        if len(_request_times) >= 20:
            raise SourceError("Достигнут лимит обращений к источникам: 20 в минуту. Повторите попытку позже.", 429)
        _request_times.append(now)


def search_source(source: str, query: str) -> dict:
    result = {"source": source, "results": []}
    try:
        if source not in SOURCES:
            raise SourceError("Неизвестный источник.", 400)
        query = " ".join(query.split())
        if not 2 <= len(query) <= 120 or re.search(r"[\x00-\x1f\x7f]", query):
            raise SourceError("Запрос должен содержать от 2 до 120 печатных символов.", 422)
        if not SOURCES[source].searchAvailable:
            raise SourceError(SOURCES[source].note, 503)
        key = (source, query.casefold())
        now = time.monotonic()
        with _cache_lock:
            cached = _cache.get(key)
            if cached and cached[0] > now:
                _cache.move_to_end(key)
                return deepcopy(cached[1])
            if cached:
                del _cache[key]
        _network_budget()
        url = SOURCES[source].searchUrl.replace("{query}", quote(query, safe=""))
        page = fetch_page(url, "search", source)
        result["results"] = parse_search(source, page.url, page.text)
        with _cache_lock:
            _cache[key] = (time.monotonic() + CACHE_TTL, deepcopy(result))
            _cache.move_to_end(key)
            while len(_cache) > CACHE_ENTRIES:
                _cache.popitem(last=False)
    except SourceError as exc:
        result["error"] = str(exc)
    return result


def preview_source(url: str) -> dict:
    url = validate_url(url)
    _network_budget()
    page = fetch_page(url)
    return parse_preview(page.url, page.text)


class ManualInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    title: str = Field(default="", max_length=200)
    artist: str = Field(default="", max_length=200)
    text: str = Field(min_length=1, max_length=120000)


@router.get("")
def list_sources():
    return source_list()


@router.get("/search")
def search(source: str = Query(max_length=20), query: str = Query(max_length=120)):
    # Per-source errors remain in the agreed envelope for parallel partial results.
    return search_source(source, query)


@router.get("/preview")
def preview(url: str = Query(max_length=2048)):
    try:
        return JSONResponse(preview_source(url), headers={"Cache-Control": "no-store"})
    except SourceError as exc:
        raise HTTPException(exc.status, str(exc)) from exc


@router.post("/manual")
async def manual(request: Request):
    # Limit bytes before JSON decoding/Pydantic. Does not depend on main middleware.
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 768000:
            raise HTTPException(413, "Запрос ручного импорта превышает допустимый размер.")
    try:
        data = ManualInput.model_validate_json(bytes(body))
    except ValueError as exc:
        # Avoid echoing the submitted text in validation diagnostics.
        raise HTTPException(422, "Нужны название и исполнитель (до 200 символов) и текст (от 1 до 120000 символов).") from exc
    try:
        song, warnings = parse_text(data.title, data.artist, data.text)
    except SourceError as exc:
        raise HTTPException(exc.status, str(exc)) from exc
    return JSONResponse({"song": song, "warnings": warnings,
                         "source": {"id": "manual", "name": "Ручной ввод", "url": ""}},
                        headers={"Cache-Control": "no-store"})


__all__ = ["router", "search_source", "preview_source", "parse_text"]
