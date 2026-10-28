import copy
import json
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from backend.main import create_app


def uid():
    return str(uuid4())


@pytest.fixture
def song():
    palette_id = uid()
    return {
        "schemaVersion": 1, "id": uid(), "title": "Пісня", "artist": "Исполнитель",
        "language": "uk", "palette": [{"id": palette_id, "name": "Am"}],
        "sections": [{"id": uid(), "name": "Куплет", "lines": [{
            "id": uid(), "text": "Привіт 🌍", "chords": [{
                "id": uid(), "paletteId": palette_id, "offset": 8, "source": "manual",
                "start": 0, "end": 1.25,
            }], "start": 0, "words": [],
        }]}],
        "performance": {"fontSize": 24, "bpm": 120, "beats": 4},
        "audio": None, "updatedAt": "2026-10-25T10:00:00Z", "source": "manual",
    }


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path / "data", tmp_path / "dist", max_audio_bytes=8192)) as test_client:
        yield test_client


@pytest.fixture
def mp3():
    # Ten MPEG-1 Layer III frames, 128 kbps / 44.1 kHz. Mutagen parses the
    # actual bytes; the upload validator is not mocked.
    return (bytes.fromhex("fffb9064") + bytes(413)) * 10


def create(client, song):
    response = client.post("/api/songs", json=song)
    assert response.status_code == 201, response.text
    return f'/api/songs/{song["id"]}'


def test_source_word_starts_round_trip_without_invented_ends(client, song):
    line = song['sections'][0]['lines'][0]
    line['wordStarts'] = [{'text': 'Привіт', 'start': 0.2}, {'text': '🌍', 'start': 1.0, 'end': 1.5}]
    url = create(client, song)
    result = client.get(url).json()['sections'][0]['lines'][0]
    assert result['wordStarts'] == line['wordStarts']
    assert 'end' not in result['wordStarts'][0]
    assert result['chords'] == line['chords']
    line['wordStarts'][0]['end'] = 0.1
    assert client.put(url, json=song).status_code == 422


def test_crud_export_import(client, song):
    health = client.get("/api/health").json()
    assert health["status"] == "ok"
    assert health["schemaVersion"] == 1
    expected = "uninstalled" if not health["providerAvailable"] else "installed" if health["modelInstalled"] else "missing_model"
    assert health["transcription"] == expected
    assert health["dataDir"] == str(client.app.state.store.root)
    assert type(health["ffmpeg"]) is bool
    assert client.get("/api/songs").json() == []
    url = create(client, song)
    assert client.get(url).json() == song
    assert client.get("/api/songs").json() == [song]
    assert client.post("/api/songs", json=song).status_code == 409
    song["title"] = "Changed"
    assert client.put(url, json=song).json() == song
    exported = client.get(url + "/export")
    assert exported.json() == song
    assert "attachment" in exported.headers["content-disposition"]
    song["audio"] = {"filename": "external.mp3", "url": "/external.mp3"}
    imported = client.post("/api/import", json=song)
    assert imported.status_code == 201
    imported = imported.json()
    assert str(UUID(imported["id"])) == imported["id"] != song["id"]
    assert imported["audio"] is None
    assert imported["sections"] == song["sections"]
    assert imported["palette"] == song["palette"]
    assert imported["updatedAt"] != song["updatedAt"]
    assert client.delete(url).status_code == 204
    assert client.delete(url).status_code == 404
    assert client.get(url).status_code == 404
    assert client.get(url + "/export").status_code == 404
    assert client.put(url, json=song).status_code == 404


@pytest.mark.parametrize("field,value", [
    ("schemaVersion", 2), ("schemaVersion", True), ("schemaVersion", 1.0),
    ("schemaVersion", "1"), ("id", "not-uuid"), ("language", "pl"),
    ("source", "ai"), ("updatedAt", "yesterday"), ("updatedAt", "2026-10-25"),
    ("title", 123), ("artist", None), ("surprise", True),
])
def test_document_validation(client, song, field, value):
    song[field] = value
    assert client.post("/api/songs", json=song).status_code == 422
    assert client.post("/api/import", json=song).status_code == 422
    assert client.get("/api/songs").json() == []


@pytest.mark.parametrize("case", ["duplicate", "reference", "offset", "offset_bool", "negative_start", "end", "unknown", "null", "words", "bpm", "missing"])
def test_nested_validation(client, song, case):
    line = song["sections"][0]["lines"][0]
    chord = line["chords"][0]
    if case == "duplicate":
        line["id"] = song["palette"][0]["id"]
    elif case == "reference":
        chord["paletteId"] = uid()
    elif case == "offset":
        chord["offset"] = 9
    elif case == "offset_bool":
        chord["offset"] = True
    elif case == "negative_start":
        line["start"] = -1
    elif case == "end":
        chord["end"] = -1
    elif case == "unknown":
        chord["extra"] = 0
    elif case == "null":
        chord["start"] = None
    elif case == "words":
        line["words"] = "text"
    elif case == "bpm":
        song["performance"]["bpm"] = 0
    elif case == "missing":
        del song["audio"]
    assert client.post("/api/songs", json=song).status_code == 422


def test_optional_fields_stay_omitted(client, song):
    line = song["sections"][0]["lines"][0]
    del line["start"], line["words"]
    del line["chords"][0]["start"], line["chords"][0]["end"]
    url = create(client, song)
    assert client.get(url).json() == song
    assert client.get(url + "/export").json() == song


def test_id_mismatch_and_invalid_path(client, song):
    url = create(client, song)
    other = copy.deepcopy(song)
    other["id"] = uid()
    assert client.put(url, json=other).status_code == 422
    assert client.get("/api/songs/not-uuid").status_code == 422
    assert client.get(url).json() == song


def test_audio_upload_range_replace_delete(client, song, mp3):
    url = create(client, song)
    assert client.get(url + "/audio").status_code == 404
    response = client.put(url + "/audio", params={"filename": "Пісня.mp3"}, content=mp3)
    assert response.status_code == 200, response.text
    uploaded = response.json()
    assert uploaded["audio"]["filename"] == "Пісня.mp3"
    assert uploaded["audio"]["url"].startswith(url + "/audio?v=")
    assert uploaded["audio"]["duration"] > 0
    assert uploaded["sections"] == song["sections"]
    assert uploaded["updatedAt"] != song["updatedAt"]
    files = list(client.app.state.store.audio.iterdir())
    assert len(files) == 1
    UUID(files[0].stem)
    fetched = client.get(url + "/audio")
    assert fetched.content == mp3
    assert fetched.headers["content-type"] == "audio/mpeg"
    partial = client.get(url + "/audio", headers={"Range": "bytes=0-15"})
    assert partial.status_code == 206
    assert partial.content == mp3[:16]
    assert client.put(url + "/audio?filename=bad.mp3", content=b"ID3 not audio").status_code == 422
    assert client.get(url + "/audio").content == mp3
    replacement = client.put(url + "/audio?filename=Пісня.mp3", content=mp3)
    assert replacement.status_code == 200
    assert replacement.json()["audio"]["filename"] == uploaded["audio"]["filename"]
    assert replacement.json()["audio"]["url"] != uploaded["audio"]["url"]
    assert client.get(replacement.json()["audio"]["url"]).content == mp3
    assert len(list(client.app.state.store.audio.iterdir())) == 1
    assert not files[0].exists()
    assert client.delete(url).status_code == 204
    assert list(client.app.state.store.audio.iterdir()) == []


@pytest.mark.parametrize("filename", ["../evil.mp3", "C:\\evil.mp3", "bad\n.mp3", "test.wav", "", "bad\x00.mp3"])
def test_unsafe_filename(client, song, mp3, filename):
    url = create(client, song)
    assert client.put(url + "/audio", params={"filename": filename}, content=mp3).status_code == 422
    assert list(client.app.state.store.audio.iterdir()) == []


def test_audio_limits_and_missing_song(client, song):
    url = create(client, song)
    assert client.put(url + "/audio?filename=x.mp3", content=b"x" * 8193).status_code == 413
    assert client.put(url + "/audio?filename=x.mp3", content=iter([b"x" * 4096] * 3)).status_code == 413
    assert client.put(url + "/audio?filename=x.mp3", content=b"").status_code == 422
    assert client.put(url + "/audio?filename=x.mp3", content=b"x", headers={"Content-Length": "oops"}).status_code == 400
    assert client.put(f"/api/songs/{uid()}/audio?filename=x.mp3", content=b"x").status_code == 404
    assert list(client.app.state.store.audio.iterdir()) == []


def test_clear_audio_and_import_copy(client, song, mp3):
    url = create(client, song)
    uploaded = client.put(url + "/audio?filename=x.mp3", content=mp3).json()
    copied = client.post("/api/import", json=uploaded).json()
    assert copied["audio"] is None
    assert client.get(f'/api/songs/{copied["id"]}/audio').status_code == 404
    uploaded["audio"] = None
    assert client.put(url, json=uploaded).status_code == 200
    assert client.get(url + "/audio").status_code == 404
    assert list(client.app.state.store.audio.iterdir()) == []


def test_persistence_static_and_env(tmp_path, monkeypatch, song, mp3):
    data = tmp_path / "data"
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<html>SPA</html>")
    (dist / "asset.js").write_text("const ok = true;")
    monkeypatch.setenv("VLAD_DATA_DIR", str(data))
    with TestClient(create_app(static_dir=dist)) as client:
        url = create(client, song)
        saved = client.put(url + "/audio?filename=x.mp3", content=mp3).json()
        assert client.get("/").text == "<html>SPA</html>"
        assert client.get("/songs/editor").text == "<html>SPA</html>"
        assert client.get("/asset.js").text == "const ok = true;"
        assert client.get("/api/unknown").status_code == 404
        assert client.get("/api").status_code == 404
        assert client.get("/%2e%2e/songs.sqlite3").status_code == 404
    with TestClient(create_app(static_dir=dist)) as client:
        assert client.get(url).json() == saved
        assert client.get("/api/songs").json() == [saved]
        assert client.get(url + "/audio").content == mp3


def test_no_frontend_build(client):
    assert client.get("/").status_code == 404


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
def test_nonfinite_values_are_validation_errors(client, song, value):
    song["performance"]["bpm"] = value
    response = client.post("/api/songs", content=json.dumps(song), headers={"Content-Type": "application/json"})
    assert response.status_code == 422
    assert response.json()["detail"]


def test_locked_obsolete_file_does_not_break_committed_upload(client, song, mp3, monkeypatch):
    from pathlib import Path

    url = create(client, song)
    assert client.put(url + "/audio?filename=first.mp3", content=mp3).status_code == 200
    old_file = next(client.app.state.store.audio.iterdir())
    unlink = Path.unlink

    def locked(path, *args, **kwargs):
        if path == old_file:
            raise PermissionError("Simulated active Windows download")
        return unlink(path, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", locked)
    response = client.put(url + "/audio?filename=second.mp3", content=mp3)
    assert response.status_code == 200
    assert client.get(url).json()["audio"]["filename"] == "second.mp3"
    assert client.get(url + "/audio").content == mp3


@pytest.mark.parametrize("name,expected", [
    (" C ", "C"), ("am", "Am"), ("c♯m7/g♭", "C#m7/Gb"),
    ("B♭maj7/D", "Bbmaj7/D"), ("F#sus4", "F#sus4"), ("G7sus4", "G7sus4"),
    ("Bm7b5", "Bm7b5"), ("Cadd9", "Cadd9"), ("Edim7", "Edim7"),
    ("Aaug", "Aaug"), ("Dm9", "Dm9"), ("C7#9", "C7#9"),
])
def test_frontend_chord_normalization(client, song, name, expected):
    song["palette"][0]["name"] = name
    url = create(client, song)
    assert client.get(url).json()["palette"][0]["name"] == expected


@pytest.mark.parametrize("name", ["", " ", "H", "C##", "Cbb", "C8", "Cfoo", "C/E/G", "C/", "/E", "C/Em", "C major", "Am\nG", "До", "<C>"])
def test_frontend_invalid_chords(client, song, name):
    song["palette"][0]["name"] = name
    response = client.post("/api/songs", json=song)
    assert response.status_code == 422
    assert "аккорда" in response.json()["detail"][0]["msg"]


@pytest.mark.parametrize("field,value", [
    ("fontSize", 15), ("fontSize", 61), ("fontSize", 24.0),
    ("bpm", 29), ("bpm", 241), ("bpm", "120"),
    ("beats", 0), ("beats", 13), ("beats", 4.5), ("beats", True),
])
def test_performance_limits(client, song, field, value):
    song["performance"][field] = value
    assert client.post("/api/songs", json=song).status_code == 422


@pytest.mark.parametrize("case", ["title", "artist", "text", "lines", "sections", "palette", "global_lines"])
def test_document_size_limits(client, song, case):
    line = song["sections"][0]["lines"][0]
    if case in {"title", "artist"}:
        song[case] = "x" * 201
    elif case == "text":
        line["text"] = "x" * 10001
    elif case == "lines":
        song["sections"][0]["lines"] = [line] * 2001
    elif case in {"sections", "palette"}:
        song[case] = song[case] * 201
    else:
        song["sections"] = [{"id": uid(), "name": "", "lines": [
            {"id": uid(), "text": "", "chords": []} for _ in range(1001)
        ]} for _ in range(2)]
    response = client.post("/api/songs", json=song)
    assert response.status_code == 422


def test_words_model(client, song):
    line = song["sections"][0]["lines"][0]
    line["words"] = [{"text": "Привіт", "start": 0, "end": 1}]
    url = create(client, song)
    assert client.get(url).json() == song
    line["words"][0]["end"] = -1
    assert client.put(url, json=song).status_code == 422
    line["words"] = [{"text": "x", "start": 2, "end": 1}]
    assert client.put(url, json=song).status_code == 422
    line["words"] = [{"text": "x", "start": 0}]
    assert client.put(url, json=song).status_code == 422
    line["words"] = ["x"]
    assert client.put(url, json=song).status_code == 422


def test_json_body_limit(client):
    from backend.middleware import JSON_LIMIT

    assert client.post("/api/import", content=b"x" * (JSON_LIMIT + 1)).status_code == 413
    # No Content-Length: exercise actual-byte counting, not only headers.
    response = client.post("/api/songs", content=iter([b"x" * 1048576] * 3))
    assert response.status_code == 413
    assert "2 МБ" in response.json()["detail"]
    response = client.post("/api/songs", content=b"{", headers={"Content-Type": "application/json"})
    assert response.status_code == 422
    assert response.json()["detail"][0]["msg"] == "Некорректный JSON"


def test_health_ffmpeg_probe(client, monkeypatch):
    monkeypatch.setattr("backend.main.shutil.which", lambda name: None)
    assert client.get("/api/health").json()["ffmpeg"] is False
    monkeypatch.setattr("backend.main.shutil.which", lambda name: "C:/ffmpeg.exe")
    assert client.get("/api/health").json()["ffmpeg"] is True
