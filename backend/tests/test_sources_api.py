import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.schema import Song
import backend.sources as sources
from backend.sources.errors import SourceError
from backend.sources.network import Page


@pytest.fixture(autouse=True)
def reset_state():
    sources._cache.clear()
    sources._request_times.clear()
    yield
    sources._cache.clear()
    sources._request_times.clear()


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(sources.router)
    with TestClient(app) as client:
        yield client


def result_page(url):
    return Page(url, '<ol class="apx-top-songs--archive"><li><a class="apx-top-songs__link" href="/songs/test/synthetic/"><span class="apx-top-songs__title">Пробная</span><span class="apx-top-songs__artist">Тестер</span></a></li></ol>')


def test_discovery_manual_and_schema_without_extra_dependencies(client):
    assert client.get("/api/sources").status_code == 200
    response = client.post("/api/sources/manual", json={"title": "Пробная", "artist": "Тестер", "text": "[Am]Синтетический текст 🌍"})
    assert response.status_code == 200
    preview = response.json()
    assert preview["source"] == {"id": "manual", "name": "Ручной ввод", "url": ""}
    assert response.headers["Cache-Control"] == "no-store"
    Song.model_validate(preview["song"])


def test_manual_limits_and_validation_do_not_echo_body(client):
    for body in [{"text": ""}, {"text": "x", "extra": "value"}, {"text": 3}, {"title": 1, "text": "x"}, {"text": "x" * 120001}]:
        response = client.post("/api/sources/manual", json=body)
        assert response.status_code == 422
        assert "input" not in response.json()
    assert client.post("/api/sources/manual", content=b"x" * 768001).status_code == 413
    assert client.post("/api/sources/manual", content=b"{invalid").status_code == 422


def test_search_error_envelope_does_not_hide_failures(client, monkeypatch):
    def unavailable(*args):
        raise SourceError("Источник недоступен")

    monkeypatch.setattr(sources, "fetch_page", unavailable)
    result = client.get("/api/sources/search", params={"source": "akkords", "query": "тест"}).json()
    assert result == {"source": "akkords", "results": [], "error": "Источник недоступен"}
    for source in ["mychords", "chorder", "ultimate", "unknown"]:
        result = client.get("/api/sources/search", params={"source": source, "query": "тест"}).json()
        assert result["error"] and result["results"] == []
    assert "error" in sources.search_source("akkords", " ")


def test_cache_is_case_normalized_copy_safe_bounded_and_failures_not_cached(client, monkeypatch):
    calls = []

    def fetch(url, *args):
        calls.append(url)
        return result_page(url)

    monkeypatch.setattr(sources, "fetch_page", fetch)
    monkeypatch.setattr(sources, "CACHE_ENTRIES", 2)
    first = sources.search_source("akkords", "Мама анархия")
    first["results"][0]["title"] = "changed"
    second = sources.search_source("akkords", "мама   анархия")
    assert second["results"][0]["title"] == "Пробная" and len(calls) == 1
    sources.search_source("akkords", "second")
    sources.search_source("akkords", "third")
    assert len(sources._cache) == 2
    sources.search_source("akkords", "Мама анархия")
    assert len(calls) == 4


def test_search_failure_does_not_poison_cache(monkeypatch):
    def fail(*args):
        raise SourceError("Ошибка источника")

    monkeypatch.setattr(sources, "fetch_page", fail)
    assert sources.search_source("akkords", "тест")["error"]
    monkeypatch.setattr(sources, "fetch_page", lambda url, *args: result_page(url))
    assert sources.search_source("akkords", "тест")["results"]


def test_cache_expiration_fetches_again(monkeypatch):
    calls = []

    def fetch(url, *args):
        calls.append(url)
        return result_page(url)

    monkeypatch.setattr(sources, "fetch_page", fetch)
    sources.search_source("akkords", "тест")
    key = ("akkords", "тест")
    _, data = sources._cache[key]
    sources._cache[key] = (0, data)
    sources.search_source("akkords", "тест")
    assert len(calls) == 2


def test_preview_rejects_url_before_fetch_and_returns_plain_structured_song(client, monkeypatch):
    calls = []

    def fetch(url, *args):
        calls.append(url)
        return Page(url, '<h1>Тест: аккорды для гитары</h1><p class="chords">Am\nСинтетический текст</p>')

    monkeypatch.setattr(sources, "fetch_page", fetch)
    assert client.get("/api/sources/preview", params={"url": "https://127.0.0.1/"}).status_code == 400
    assert not calls
    response = client.get("/api/sources/preview", params={"url": "https://akkords.pro/songs/test/synthetic/"})
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    Song.model_validate(response.json()["song"])


def test_upstream_preview_error_is_sanitized_and_http_status_preserved(client, monkeypatch):
    def fail(*args):
        raise SourceError("Время ожидания истекло", 504)

    monkeypatch.setattr(sources, "fetch_page", fail)
    response = client.get("/api/sources/preview", params={"url": "https://akkords.pro/songs/test/synthetic/"})
    assert response.status_code == 504 and response.json() == {"detail": "Время ожидания истекло"}


def test_global_budget_rejects_more_than_twenty_uncached_requests(monkeypatch):
    monkeypatch.setattr(sources, "fetch_page", lambda url, *args: result_page(url))
    for index in range(20):
        assert "error" not in sources.search_source("akkords", f"test {index}")
    assert "error" in sources.search_source("akkords", "test 21")
    assert len(sources._request_times) == 20
