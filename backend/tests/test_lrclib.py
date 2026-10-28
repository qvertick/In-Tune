"""Offline contract/security tests; never query LRCLIB during backend tests."""
from copy import deepcopy
from email.utils import formatdate
import json
import socket
import threading
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend import lrclib as m
from backend.sources.errors import SourceError
from backend.sources import network


def record(identifier=20902008, **changes):
    # Verified live metadata 2026-10-27. Lyrics are synthetic, not copied.
    return {"id": identifier, "name": "Стук", "trackName": "Стук", "artistName": "Кино",
            "albumName": "Стук - Single", "duration": 231.0, "instrumental": False,
            "hasWordSync": False, "plainLyrics": "Синтетическая строка\n",
            "syncedLyrics": "[00:01.25] Синтетическая строка\n",
            "lyricsfile": "version: '1.0'\nlines: []\n", **changes}


@pytest.fixture(autouse=True)
def isolation(monkeypatch):
    monkeypatch.setattr(m, "_client", m.Client())
    monkeypatch.setattr(m, "_resolve", lambda *a: pytest.fail("Unexpected network I/O"))


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(m.router)
    with TestClient(app) as client:
        yield client


@pytest.fixture
def clock(monkeypatch):
    value = [100.0]
    monkeypatch.setattr(m, "time", SimpleNamespace(monotonic=lambda: value[0], time=lambda: 1700000000))
    return value


def test_search_real_fields_single_request_local_duration_and_cache(client, monkeypatch):
    calls = []
    rows = [record(), record(2, duration=233), record(3, duration=234),
            record(4, duration=229, instrumental=True, plainLyrics=None, syncedLyrics=None)]

    def download(target):
        calls.append(target)
        return deepcopy(rows)

    monkeypatch.setattr(m, "_download", download)
    params = {"track": "  Стук  ", "artist": "Кино", "album": "Стук - Single", "duration": "231"}
    response = client.get("/api/lrclib/search", params=params)
    assert response.status_code == 200
    assert isinstance(response.json(), list)
    assert [x["id"] for x in response.json()] == [20902008, 2, 4, 3]
    assert response.json()[2]["plainLyrics"] is None
    assert response.headers["cache-control"] == "no-store"
    assert parse_qs(urlsplit(calls[0]).query) == {
        "track_name": ["Стук"], "artist_name": ["Кино"], "album_name": ["Стук - Single"]}
    assert "duration" not in calls[0] and calls[0].startswith("/api/search?")
    params["duration"] = "234"
    assert [r["id"] for r in client.get("/api/lrclib/search", params=params).json()] == [3, 2, 20902008, 4]
    params.pop("duration")
    assert len(client.get("/api/lrclib/search", params=params).json()) == 4
    assert len(calls) == 1  # No per-result get, paging or retry.


def test_track_by_id_and_strict_url_share_cache_and_preserve_raw_fields(client, monkeypatch):
    calls = []
    expected = record(lyricsfile="!!python/object/apply:os.system ['ignored']")
    monkeypatch.setattr(m, "_download", lambda path: calls.append(path) or {**expected, "futureField": "ignored"})
    assert client.get("/api/lrclib/track", params={"id": "20902008"}).json() == expected
    assert client.get("/api/lrclib/track", params={"url": "https://lrclib.net/tracks/20902008"}).json() == expected
    assert calls == ["/api/get/20902008"]
    assert m.get_track("00020902008") == expected


@pytest.mark.parametrize("url", [
    "http://lrclib.net/tracks/1", "https://www.lrclib.net/tracks/1", "https://LRCLIB.net/tracks/1",
    "https://lrclib.net:443/tracks/1", "https://user@lrclib.net/tracks/1",
    "https://lrclib.net.evil/tracks/1", "https://lrclib.net@127.0.0.1/tracks/1",
    "https://127.0.0.1/tracks/1", "https://[::1]/tracks/1", "file:///tracks/1",
    "https://lrclib.net/tracks/1/", "https://lrclib.net/tracks/1?q=x", "https://lrclib.net/tracks/1#x",
    "https://lrclib.net/tracks/%31", "https://lrclib.net/tracks/../1", "https://lrclib.net/tracks/１",
    "https://lrclib.net/tracks/0", "https://lrclib.net/tracks/-1", "https://lrclib.net/tracks/1\n",
    " https://lrclib.net/tracks/1", "https://lrclib.net\\@localhost/tracks/1",
    "https://lrclib.net/tracks/9223372036854775808", "https://lrclib.net/tracks/" + "1" * 10000,
], ids=lambda value: value[:100])
def test_ssrf_and_ambiguous_urls_rejected_before_network(client, url):
    response = client.get("/api/lrclib/track", params={"url": url})
    assert response.status_code == 422
    assert response.json()["error"]["code"] in {"invalid_url", "invalid_id", "invalid_query"}


@pytest.mark.parametrize("query", ["", "id=1&url=https://lrclib.net/tracks/1", "id=", "id=0",
    "id=-1", "id=1.0", "id=1e3", "id=true", "id=1&id=2", "id=1&extra=x",
    "id=9223372036854775808", "id=" + "9" * 5000])
def test_invalid_selectors_have_structured_errors(client, query):
    response = client.get("/api/lrclib/track?" + query)
    assert response.status_code == 422
    assert set(response.json()) == {"error"}


@pytest.mark.parametrize("params", [{}, {"track": " "}, {"track": "x" * 201}, {"track": "x\ny"},
    {"track": "x", "artist": "a" * 201}, {"track": "x", "album": "\x00"},
    *[{"track": "x", "duration": d} for d in ["NaN", "Infinity", "-1", "86401", "", "abc", "9" * 40]],
    {"track": "x", "q": "other"}, [("track", "x"), ("track", "y")]])
def test_search_validation_does_not_echo_input_or_fetch(client, params):
    response = client.get("/api/lrclib/search", params=params)
    assert response.status_code == 422
    assert set(response.json()["error"]) == {"code", "message"}
    assert "input" not in response.text


def test_optional_empty_metadata_and_empty_result_cached(monkeypatch):
    calls = []
    monkeypatch.setattr(m, "_download", lambda target: calls.append(target) or [])
    assert m.search_tracks("x", "", " ", "0") == []
    assert m.search_tracks("x", None, None, "86400") == []
    assert calls == ["/api/search?track_name=x"]


def test_ttl_lru_byte_bound_and_copy_isolation(monkeypatch):
    monkeypatch.setattr(m, "CACHE_ENTRIES", 2)
    monkeypatch.setattr(m, "CACHE_BYTES", 100)
    cache = m.TTLCache()
    cache.put("a", ["original"], 0)
    cache.get("a", 1).append("mutation")
    assert cache.get("a", 1) == ["original"]
    cache.put("b", [], 1)
    cache.get("a", 2)
    cache.put("c", [], 2)
    assert cache.get("b", 3) is None and len(cache.entries) == 2
    cache.put("large", ["x" * 1000], 3)
    assert len(cache.entries) == 2 and cache.size <= 100
    cache.put("d", ["x" * 85], 4)
    assert cache.size <= 100 and "a" not in cache.entries
    assert cache.get("d", 4 + m.CACHE_TTL) is None
    assert cache.size == 0 and not cache.entries


def test_cache_expiry_failure_not_cached_and_caller_mutation(monkeypatch, clock):
    calls = []
    def download(path):
        calls.append(path)
        if len(calls) == 1:
            raise m.LrclibError("upstream_timeout", "timeout", 504)
        return record()
    monkeypatch.setattr(m, "_download", download)
    with pytest.raises(m.LrclibError):
        m.get_track("20902008")
    clock[0] += 1
    m.get_track("20902008")["trackName"] = "changed"
    assert m.get_track("20902008")["trackName"] == "Стук"
    clock[0] += m.CACHE_TTL
    m.get_track("20902008")
    assert len(calls) == 3


def test_local_gap_budget_window_and_cached_hits(monkeypatch, clock):
    monkeypatch.setattr(m, "_download", lambda path: record(int(path.rsplit("/", 1)[1])))
    m.get_track("1")
    with pytest.raises(m.LrclibError, match="позже") as caught:
        m.get_track("2")
    assert caught.value.status == 429 and caught.value.retry_after == 1
    for identifier in range(2, m.REQUESTS_PER_MINUTE + 1):
        clock[0] += .5
        m.get_track(str(identifier))
    clock[0] += .5
    with pytest.raises(m.LrclibError) as caught:
        m.get_track("21")
    assert caught.value.code == "rate_limited" and caught.value.retry_after == 50
    assert m.get_track("1")["id"] == 1
    assert len(m._client.request_times) == 20
    clock[0] = 160
    assert m.get_track("21")["id"] == 21


def test_concurrent_request_rejected_without_queue_or_second_fetch(monkeypatch):
    entered, release = threading.Event(), threading.Event()
    calls, results = [], []
    def download(path):
        calls.append(path)
        entered.set()
        assert release.wait(3)
        return record(1)
    monkeypatch.setattr(m, "_download", download)
    worker = threading.Thread(target=lambda: results.append(m.get_track("1")))
    worker.start()
    try:
        assert entered.wait(3)
        with pytest.raises(m.LrclibError) as caught:
            m.get_track("2")
        assert caught.value.code == "busy" and caught.value.status == 503
        assert caught.value.retry_after is None  # No predicted completion time.
    finally:
        release.set()
        worker.join(3)
    assert len(calls) == len(results) == 1 and not worker.is_alive()


class Response:
    def __init__(self, status=200, body=None, **headers):
        self.status = status
        self.body = json.dumps(record()).encode() if body is None else body
        self.headers = {"Content-Type": "application/json; charset=utf-8", **headers}
        self.closed = False

    def getheader(self, name, default=None):
        return self.headers.get(name, default)

    def read1(self, size):
        chunk, self.body = self.body[:size], self.body[size:]
        return chunk

    def close(self):
        self.closed = True


def transport(monkeypatch, response):
    calls, connections = [], []
    class Connection:
        active_socket = None
        def __init__(self, host, addresses, deadline):
            assert host == "lrclib.net" and addresses == ["8.8.8.8"]
            self.closed = False
            connections.append(self)
        def request(self, method, target, headers):
            calls.append((method, target, headers))
        def getresponse(self):
            return response
        def abort(self):
            pass
        def close(self):
            self.closed = True
    monkeypatch.setattr(m, "_PinnedHTTPS", Connection)
    monkeypatch.setattr(m, "_resolve", lambda host, deadline: ["8.8.8.8"])
    return calls, connections


def test_transport_headers_fixed_host_and_cleanup(monkeypatch):
    response = Response()
    calls, connections = transport(monkeypatch, response)
    assert m.get_track("20902008") == record()
    assert calls == [("GET", "/api/get/20902008", {
        "User-Agent": "InTune/1.0 (https://github.com/qvertick/In-Tune)",
        "Accept": "application/json", "Accept-Encoding": "identity", "Connection": "close"})]
    assert response.closed and connections[0].closed
    assert m._PinnedHTTPS is not network._PinnedHTTPS  # fake installed only here


@pytest.mark.parametrize("response,code,status", [
    (Response(404, body=b"not JSON"), "not_found", 404),
    (Response(302, Location="https://127.0.0.1/"), "upstream_redirect", 502),
    (Response(301, Location="/api/get/1"), "upstream_redirect", 502),
    (Response(403), "upstream_http_error", 502), (Response(500), "upstream_http_error", 502),
    (Response(**{"Content-Type": "text/html"}), "invalid_response", 502),
    (Response(**{"Content-Encoding": "gzip"}), "invalid_response", 502),
    (Response(**{"Content-Length": str(m.MAX_BYTES + 1)}), "response_too_large", 502),
    (Response(**{"Content-Length": "bad"}), "response_too_large", 502),
    (Response(**{"Content-Length": "1"}), "invalid_response", 502),
    (Response(body=b"x" * (m.MAX_BYTES + 1)), "response_too_large", 502),
    (Response(body=b"{bad"), "invalid_response", 502),
    (Response(body=b"\xff"), "invalid_response", 502),
    (Response(body=b'{"duration":NaN}'), "invalid_response", 502),
    (Response(body=b"[" * 2000 + b"]" * 2000), "invalid_response", 502),
])
def test_transport_failures_no_redirect_retry_or_body_leak(client, monkeypatch, response, code, status):
    calls, connections = transport(monkeypatch, response)
    result = client.get("/api/lrclib/track?id=20902008")
    assert result.status_code == status and result.json()["error"]["code"] == code
    assert len(calls) == 1 and response.closed and connections[0].closed


@pytest.mark.parametrize("status,code", [(429, "upstream_rate_limited"), (503, "upstream_unavailable")])
def test_retry_after_honored_globally_even_non_json_and_not_cached(client, monkeypatch, clock, status, code):
    response = Response(status, body=b"<html>private upstream error</html>", **{
        "Retry-After": "120", "Content-Type": "text/html"})
    calls, _ = transport(monkeypatch, response)
    first = client.get("/api/lrclib/track?id=20902008")
    assert first.status_code == status and first.json()["error"]["code"] == code
    assert first.headers["retry-after"] == "120" and "private" not in first.text
    clock[0] += 60
    second = client.get("/api/lrclib/search?track=other")
    assert second.status_code == 429 and second.headers["retry-after"] == "60"
    assert len(calls) == 1 and not m._client.cache.entries
    clock[0] += 60
    monkeypatch.setattr(m, "_download", lambda path: record())
    assert m.get_track("20902008")["id"] == 20902008


def test_retry_after_date_fallback_and_long_wait(clock):
    assert m._retry_after(formatdate(1700000120, usegmt=True)) == 120
    assert m._retry_after("invalid") is None
    assert m._retry_after(None) is None
    assert m._retry_after("86400") == 86400
    assert m._retry_after("0") == 0
    assert m._retry_after(formatdate(1699999999, usegmt=True)) == 0


@pytest.mark.parametrize("status", [429, 503])
@pytest.mark.parametrize("header", [None, "invalid", "-1"])
def test_no_fabricated_retry_header_or_upstream_cooldown(client, monkeypatch, clock, status, header):
    response = Response(status, body=b"<html>busy</html>", **({"Retry-After": header} if header else {}))
    calls, _ = transport(monkeypatch, response)
    result = client.get("/api/lrclib/track?id=20902008")
    assert result.status_code == status
    assert "retry-after" not in result.headers
    assert m._client.blocked_until == 0
    assert len(calls) == 1
    # Only the documented local 0.5s gap remains, then an explicit retry succeeds.
    clock[0] += m.REQUEST_GAP
    monkeypatch.setattr(m, "_download", lambda path: record())
    assert m.get_track("20902008")["id"] == 20902008


def test_real_overload_json_diagnosed_without_lyrics_secrets_or_query(client, monkeypatch, caplog):
    body = json.dumps({"name": "ServerOverloaded", "statusCode": 503,
                       "message": "The server is busy, please retry in a moment",
                       "plainLyrics": "PRIVATE_LYRICS", "secret": "PRIVATE_SECRET"}).encode()
    response = Response(503, body=body, **{"Retry-After": "1", "Set-Cookie": "PRIVATE_COOKIE",
                                        "Location": "https://private/PRIVATE_LOCATION", "Server": "cloudflare"})
    calls, _ = transport(monkeypatch, response)
    with caplog.at_level("WARNING", logger="backend.lrclib"):
        result = client.get("/api/lrclib/search?track=PRIVATE_QUERY")
    assert result.status_code == 503
    assert result.json()["error"]["code"] == "upstream_overloaded"
    assert result.headers["retry-after"] == "1"
    assert '"status": 503' in caplog.text and "ServerOverloaded" in caplog.text
    assert '"Content-Type": "application/json"' in caplog.text
    assert '"plainLyrics": "str"' in caplog.text
    assert "PRIVATE_" not in caplog.text and "PRIVATE_" not in result.text
    assert len(calls) == 1


def test_fragmented_overload_body_and_bounded_safe_diagnostics(client, monkeypatch, caplog):
    body = b'{"name":"ServerOverloaded","statusCode":503,"message":"busy"}'
    response = Response(503, body=body, **{"Retry-After": "1"})
    read = response.read1
    response.read1 = lambda size: read(min(size, 3))
    transport(monkeypatch, response)
    result = client.get("/api/lrclib/track?id=20902008")
    assert result.json()["error"]["code"] == "upstream_overloaded"
    assert "ServerOverloaded" in caplog.text


def test_non_json_diagnostic_does_not_log_html_or_unknown_headers(client, monkeypatch, caplog):
    body = b"<html>PRIVATE_HTML" + b"x" * 10000
    response = Response(503, body=body, **{"Content-Type": "text/html; secret=PRIVATE_CHARSET",
                       "Server": "PRIVATE_SERVER", "Retry-After": "PRIVATE_WAIT"})
    transport(monkeypatch, response)
    result = client.get("/api/lrclib/track?id=20902008")
    assert result.status_code == 503 and "retry-after" not in result.headers
    assert '"type": "html"' in caplog.text
    assert len(response.body) == len(body) - m.DIAGNOSTIC_BYTES
    assert "PRIVATE_" not in caplog.text


def test_error_body_read_failure_keeps_original_http_status(client, monkeypatch, caplog):
    response = Response(503, **{"Retry-After": "2"})
    def fail(size):
        raise TimeoutError("PRIVATE_TIMEOUT")
    response.read1 = fail
    calls, _ = transport(monkeypatch, response)
    result = client.get("/api/lrclib/track?id=20902008")
    assert result.status_code == 503 and result.headers["retry-after"] == "2"
    assert "TimeoutError" in caplog.text and "PRIVATE_TIMEOUT" not in caplog.text
    assert len(calls) == 1


def test_parser_diagnostics_exclude_validation_input_and_exception_text(client, monkeypatch, caplog):
    monkeypatch.setattr(m, "_download", lambda path: record(instrumental="PRIVATE_INPUT"))
    result = client.get("/api/lrclib/track?id=20902008")
    assert result.status_code == 502
    assert "ValidationError" in caplog.text and "instrumental" in caplog.text
    assert "PRIVATE_INPUT" not in caplog.text


def test_dns_network_exception_chain_is_logged_without_message(client, monkeypatch, caplog):
    def fail(*args):
        try:
            raise socket.gaierror("PRIVATE_DNS")
        except socket.gaierror as exc:
            raise SourceError("PRIVATE_SOURCE") from exc
    monkeypatch.setattr(m, "_resolve", fail)
    result = client.get("/api/lrclib/track?id=20902008")
    assert result.json()["error"]["code"] == "upstream_network_error"
    assert "SourceError" in caplog.text and "gaierror" in caplog.text
    assert "PRIVATE_" not in caplog.text


@pytest.mark.parametrize("failure,code,status", [
    (TimeoutError(), "upstream_timeout", 504),
    (OSError("private address"), "upstream_network_error", 502),
    (SourceError("private DNS answer"), "unsafe_dns", 502),
    (SourceError("DNS timeout", 504), "upstream_timeout", 504),
])
def test_dns_and_network_errors_are_safe(client, monkeypatch, failure, code, status):
    def resolve(*args):
        raise failure
    monkeypatch.setattr(m, "_resolve", resolve)
    response = client.get("/api/lrclib/track?id=1")
    assert response.status_code == status and response.json()["error"]["code"] == code
    assert "private" not in response.text


def test_wall_deadline_aborts_slow_response_and_closes_connection(monkeypatch):
    aborted = threading.Event()
    response = Response()
    calls, connections = transport(monkeypatch, response)
    monkeypatch.setattr(m, "TOTAL_TIMEOUT", .03)
    monkeypatch.setattr(m._PinnedHTTPS, "abort", lambda self: aborted.set())
    def slow_read(size):
        assert aborted.wait(2)
        raise OSError("aborted by watchdog")
    response.read1 = slow_read
    with pytest.raises(m.LrclibError) as caught:
        m.get_track("20902008")
    assert caught.value.code == "upstream_timeout" and caught.value.status == 504
    assert len(calls) == 1 and response.closed and connections[0].closed
    assert not m._client.network.locked()


@pytest.mark.parametrize("changes", [
    {"id": True}, {"id": "20902008"}, {"id": 1}, {"duration": float("inf")},
    {"duration": -1}, {"instrumental": "false"}, {"plainLyrics": 3},
    {"syncedLyrics": "x" * 240001}, {"trackName": "x" * 2001},
    {"lyricsfile": None}, {"hasWordSync": 1}, {"plainLyrics": "\ud800"},
])
def test_real_field_types_limits_and_id_mismatch(client, monkeypatch, changes):
    monkeypatch.setattr(m, "_download", lambda path: record(**changes))
    response = client.get("/api/lrclib/track?id=20902008")
    assert response.status_code == 502 and response.json()["error"]["code"] == "invalid_response"
    assert not m._client.cache.entries


@pytest.mark.parametrize("raw", [{}, None, [record()] * 21, [None], [{"id": 1}]])
def test_invalid_search_shapes_rejected(client, monkeypatch, raw):
    monkeypatch.setattr(m, "_download", lambda path: raw)
    response = client.get("/api/lrclib/search?track=x")
    assert response.status_code == 502 and response.json()["error"]["code"] == "invalid_response"


def test_reuses_public_dns_pinning_and_no_proxy_transport():
    assert m._PinnedHTTPS is network._PinnedHTTPS and m._resolve is not None
    def dns(*args, **kwargs):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 443)) for ip in ["8.8.8.8", "127.0.0.1"]]
    with pytest.raises(SourceError):
        network.public_addresses("lrclib.net", resolver=dns)


def test_only_two_read_routes_mounted_in_main_without_data_access(tmp_path, monkeypatch):
    from backend.main import create_app
    monkeypatch.setattr(m, "_download", lambda path: record())
    app = create_app(tmp_path / "data", tmp_path / "static")
    routes = [r for r in app.routes if getattr(r, "path", "").startswith("/api/lrclib")]
    assert {(r.path, tuple(sorted(r.methods))) for r in routes} == {
        ("/api/lrclib/search", ("GET",)), ("/api/lrclib/track", ("GET",))}
    # Only the temporary store is initialized; no songs or audio are accessed.
    with TestClient(app, backend="asyncio") as client:
        assert client.get("/api/lrclib/track?id=20902008").status_code == 200
        assert client.post("/api/lrclib/track?id=1", json={}).status_code == 405
