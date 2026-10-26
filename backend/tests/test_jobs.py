import copy
import json
import shutil
import sqlite3
import sys
import time
import wave
from contextlib import contextmanager
from threading import Event
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend import providers
from backend.audio import AnalysisError, Cancelled, decode_audio
from backend.jobs import Jobs, QueueFull, analyze
from backend.main import create_app
from backend.schema import Song
from backend.storage import Store


def document():
    return {"schemaVersion": 1, "id": str(uuid4()), "title": "Manual", "artist": "Artist",
            "language": "en", "palette": [], "sections": [{"id": str(uuid4()), "name": "Verse",
            "lines": [{"id": str(uuid4()), "text": "Keep me", "chords": []}]}],
            "performance": {"fontSize": 24, "bpm": 120, "beats": 4}, "audio": None,
            "updatedAt": "2026-10-25T10:00:00Z", "source": "manual"}


def add_audio(store):
    song = document()
    store.create(Song.model_validate(song))
    filename = str(uuid4()) + ".mp3"
    (store.audio / filename).write_bytes(b"local audio")
    store.set_audio(song["id"], filename, {"filename": "input.mp3", "url": "/audio"}, song["updatedAt"])
    return store.get(song["id"])


def wait_for(jobs, identifier, statuses):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        job = jobs.get(identifier)
        if job["status"] in statuses:
            return job
        time.sleep(0.01)
    pytest.fail(f"Job did not reach {statuses}: {jobs.get(identifier)}")


def test_fifo_duplicate_cancel_and_release(tmp_path):
    store = Store(tmp_path)
    first, second, third = [add_audio(store) for _ in range(3)]
    entered, release = Event(), Event()
    calls = []

    def processor(song, source, check):
        calls.append(song["id"])
        if len(calls) == 1:
            entered.set()
            assert release.wait(5)
        check()
        return song

    jobs = Jobs(store, processor)
    try:
        a = jobs.enqueue(first)
        assert entered.wait(5)
        assert jobs.enqueue(first)["id"] == a["id"]
        b, c = jobs.enqueue(second), jobs.enqueue(third)
        assert jobs.cancel(b["id"])["status"] == "cancelled"
        cancelling = jobs.cancel(a["id"])
        assert cancelling["status"] == "running" and cancelling["cancelRequested"]
        assert calls == [first["id"]]
        release.set()
        wait_for(jobs, a["id"], {"cancelled"})
        wait_for(jobs, c["id"], {"completed"})
        assert calls == [first["id"], third["id"]]
        assert jobs.result(a["id"]) is None
        assert jobs.result(c["id"])["id"] == third["id"]
        # Terminal cancellation is idempotent and cannot erase a result.
        assert jobs.cancel(c["id"])["status"] == "completed"
        retry = jobs.enqueue(first)
        assert retry["id"] != a["id"]
        wait_for(jobs, retry["id"], {"completed"})
    finally:
        release.set()
        jobs.close()


def test_restart_interrupted_queued_and_results_persist(tmp_path):
    store = Store(tmp_path)
    jobs = Jobs(store, lambda song, source, check: song, autostart=False)
    first, second, third = [jobs.enqueue(add_audio(store)) for _ in range(3)]
    with jobs.connect() as db:
        db.execute("UPDATE jobs SET status='running' WHERE id IN (?,?)", (first["id"], second["id"]))
        db.execute("UPDATE jobs SET cancel_requested=1 WHERE id=?", (second["id"],))
    jobs.close()  # Simulate state left on disk by a terminated process.
    jobs = Jobs(store, lambda song, source, check: song)
    try:
        assert jobs.get(first["id"])["status"] == "failed"
        assert "перезапуском" in jobs.get(first["id"])["error"]
        assert jobs.get(second["id"])["status"] == "cancelled"
        wait_for(jobs, third["id"], {"completed"})
        saved = jobs.result(third["id"])
    finally:
        jobs.close()
    jobs = Jobs(store)
    try:
        assert jobs.result(third["id"]) == saved
        assert len(jobs.list(limit=2, offset=1)) == 2
    finally:
        jobs.close()


def test_single_owner_and_queue_bound(tmp_path):
    store = Store(tmp_path)
    jobs = Jobs(store, autostart=False)
    try:
        with pytest.raises(RuntimeError, match="уже работает"):
            Jobs(store)
        for _ in range(32):
            jobs.enqueue(add_audio(store))
        with pytest.raises(QueueFull):
            jobs.enqueue(add_audio(store))
    finally:
        jobs.close()


def test_shutdown_releases_worker_and_resumes_queued_snapshot(tmp_path):
    store = Store(tmp_path)
    entered = Event()

    def processor(song, source, check):
        entered.set()
        while True:
            check()
            time.sleep(0.01)

    jobs = Jobs(store, processor)
    first = jobs.enqueue(add_audio(store))
    assert entered.wait(5)
    queued_row = add_audio(store)
    second = jobs.enqueue(queued_row)
    edited = json.loads(queued_row["document"])
    edited["title"] = "Changed after enqueue"
    store.update(Song.model_validate(edited))
    jobs.close()
    assert not jobs.thread.is_alive()
    assert jobs.get(first["id"])["status"] == "failed"
    assert "остановкой" in jobs.get(first["id"])["error"]
    assert jobs.get(second["id"])["status"] == "queued"
    resumed = Jobs(store, lambda song, source, check: song)
    try:
        wait_for(resumed, second["id"], {"completed"})
        assert resumed.result(second["id"])["title"] == "Manual"
        assert json.loads(store.get(queued_row["id"])["document"])["title"] == edited["title"]
    finally:
        resumed.close()


def test_missing_model_and_optional_dependency_are_friendly(tmp_path, monkeypatch):
    monkeypatch.setattr(providers, "MODEL_PATH", tmp_path / "whisper-tiny")
    monkeypatch.setattr(providers, "_model", None)
    with pytest.raises(AnalysisError, match="Модель не скачивалась"):
        providers.transcribe(tmp_path / "input.wav", "en", lambda: None)
    providers.MODEL_PATH.mkdir()
    for name in providers.MODEL_FILES:
        (providers.MODEL_PATH / name).touch()
    monkeypatch.setitem(sys.modules, "faster_whisper", None)
    with pytest.raises(AnalysisError, match="pip install -r backend/requirements-audio.txt"):
        providers.transcribe(tmp_path / "input.wav", "en", lambda: None)


def test_provider_offline_cpu_cache_and_generator_cleanup(tmp_path, monkeypatch):
    for name in providers.MODEL_FILES:
        (tmp_path / name).touch()
    monkeypatch.setattr(providers, "MODEL_PATH", tmp_path)
    monkeypatch.setattr(providers, "_model", None)
    loaded, options, closed = [], [], []

    class Model:
        def __init__(self, path, **kwargs):
            loaded.append((path, kwargs))

        def transcribe(self, path, **kwargs):
            options.append(kwargs)

            def segments():
                try:
                    yield SimpleNamespace(text=" Real words ", start=0.0,
                                          words=[SimpleNamespace(word=" Real", start=0.0, end=1.0)])
                finally:
                    closed.append(True)
            return segments(), None

    monkeypatch.setitem(sys.modules, "faster_whisper", SimpleNamespace(WhisperModel=Model))
    for _ in range(2):
        lines = providers.transcribe(tmp_path / "input.wav", "en", lambda: None)
        assert lines[0]["text"] == "Real words"
        assert lines[0]["source"] == "model"
        assert "manuallyEdited" not in lines[0]
        assert "confidence" not in lines[0]
    assert len(loaded) == 1 and len(closed) == 2
    assert loaded[0] == (str(tmp_path), {"device": "cpu", "compute_type": "int8", "cpu_threads": 2,
                                       "num_workers": 1, "local_files_only": True})
    assert options[0]["word_timestamps"] is True
    checks = []

    def cancel():
        checks.append(True)
        if len(checks) == 3:
            raise Cancelled()

    with pytest.raises(Cancelled):
        providers.transcribe(tmp_path / "input.wav", "en", cancel)
    assert len(closed) == 3
    # The inference lock was released after cancellation.
    providers.transcribe(tmp_path / "input.wav", "en", lambda: None)


@contextmanager
def passthrough(source, check):
    check()
    yield source


def test_api_draft_preserves_manual_data_and_import_copy(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.jobs.decode_audio", passthrough)
    monkeypatch.setattr("backend.jobs.transcribe", lambda audio, language, check: [
        {"id": str(uuid4()), "text": "Transcribed", "start": 0.0, "chords": [],
         "words": [{"text": "Transcribed", "start": 0.0, "end": 1.0}]}])
    with TestClient(create_app(tmp_path)) as client:
        row = add_audio(client.app.state.store)
        original = json.loads(row["document"])
        response = client.post(f'/api/songs/{row["id"]}/analysis')
        assert response.status_code == 202
        job = response.json()
        assert job["kind"] == "transcription"
        wait_for(client.app.state.jobs, job["id"], {"completed"})
        response = client.get(f'/api/jobs/{job["id"]}/result')
        assert response.status_code == 200
        draft = response.json()
        assert draft["id"] != original["id"] and draft["source"] == "model"
        assert draft["sections"][:-1] == original["sections"]
        assert draft["sections"][-1]["name"] == "Распознанный текст"
        assert draft["palette"] == original["palette"]
        assert client.get(f'/api/songs/{row["id"]}').json() == original
        imported = client.post("/api/import", json=draft)
        assert imported.status_code == 201
        assert imported.json()["id"] not in (original["id"], draft["id"])
        assert imported.json()["audio"] is None
        assert client.get("/api/jobs").json()[0]["resultAvailable"]
        assert client.get("/api/jobs?limit=101").status_code == 422
        missing = str(uuid4())
        assert client.get(f"/api/jobs/{missing}/result").status_code == 404
        assert client.post(f"/api/jobs/{missing}/cancel").status_code == 404
        assert client.post(f"/api/songs/{missing}/analysis").status_code == 404
        plain = document()
        client.post("/api/songs", json=plain)
        assert client.post(f'/api/songs/{plain["id"]}/analysis').status_code == 422


def test_api_missing_model_failure_and_no_draft(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.jobs.decode_audio", passthrough)
    monkeypatch.setattr(providers, "MODEL_PATH", tmp_path / "absent")
    monkeypatch.setattr(providers, "_model", None)
    with TestClient(create_app(tmp_path)) as client:
        row = add_audio(client.app.state.store)
        original = row["document"]
        job = client.post(f'/api/songs/{row["id"]}/analysis').json()
        failed = wait_for(client.app.state.jobs, job["id"], {"failed"})
        assert "модель Whisper tiny отсутствует" in failed["error"]
        assert failed["stage"] == "transcribing"
        assert failed["stageLabel"] == "Распознавание текста"
        assert not failed["resultAvailable"]
        assert client.get(f'/api/jobs/{job["id"]}/result').status_code == 409
        assert client.app.state.store.get(row["id"])["document"] == original


def test_no_speech_does_not_create_placeholder(monkeypatch, tmp_path):
    monkeypatch.setattr("backend.jobs.decode_audio", passthrough)
    monkeypatch.setattr("backend.jobs.transcribe", lambda *args: [])
    song = document()
    before = copy.deepcopy(song)
    with pytest.raises(AnalysisError, match="Речь не распознана"):
        analyze(song, tmp_path / "input", lambda stage=None: None)
    assert song == before


def test_real_ffmpeg_decode_cleanup_and_bad_input(tmp_path):
    if not shutil.which("ffmpeg"):
        pytest.skip("FFmpeg is not installed")
    source = tmp_path / "input.wav"
    with wave.open(str(source), "wb") as audio:
        audio.setnchannels(2)
        audio.setsampwidth(2)
        audio.setframerate(44100)
        audio.writeframes(bytes(44100 * 4))
    with decode_audio(source, lambda: None) as target:
        with wave.open(str(target), "rb") as audio:
            assert (audio.getnchannels(), audio.getframerate()) == (1, 16000)
            assert audio.getnframes() == 16000
    assert not target.parent.exists()
    source.write_bytes(b"invalid audio")
    with pytest.raises(AnalysisError, match="не удалось декодировать"):
        with decode_audio(source, lambda: None):
            pytest.fail("Invalid audio decoded")


def test_missing_ffmpeg_and_cancel_before_decode(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.audio.shutil.which", lambda _: None)
    with pytest.raises(AnalysisError, match="FFmpeg не найден"):
        with decode_audio(tmp_path / "input", lambda: None):
            pass

    def cancel():
        raise Cancelled()

    with pytest.raises(Cancelled):
        with decode_audio(tmp_path / "input", cancel):
            pass


def test_ffmpeg_duration_limit(tmp_path, monkeypatch):
    if not shutil.which("ffmpeg"):
        pytest.skip("FFmpeg is not installed")
    monkeypatch.setattr("backend.audio.MAX_SECONDS", 1)
    source = tmp_path / "long.wav"
    with wave.open(str(source), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(16000)
        audio.writeframes(bytes(16000 * 2 * 2))
    with pytest.raises(AnalysisError, match="Сократите файл"):
        with decode_audio(source, lambda: None):
            pass


def test_decode_running_cancellation_kills_process_and_cleans_temp(tmp_path, monkeypatch):
    processes = []

    class Process:
        returncode = None

        def __init__(self, command, **kwargs):
            self.target = command[-1]
            self.killed = self.waited = False
            processes.append(self)

        def poll(self):
            return self.returncode

        def kill(self):
            self.killed = True
            self.returncode = -1

        def wait(self):
            self.waited = True

    monkeypatch.setattr("backend.audio.shutil.which", lambda _: "ffmpeg")
    monkeypatch.setattr("backend.audio.subprocess.Popen", Process)

    def check():
        if processes:
            raise Cancelled()

    with pytest.raises(Cancelled):
        with decode_audio(tmp_path / "input", check):
            pass
    assert processes[0].killed and processes[0].waited
    from pathlib import Path
    assert not Path(processes[0].target).parent.exists()


def test_explicit_installer_stages_model_without_automatic_download(tmp_path, monkeypatch):
    destination = tmp_path / "models" / "whisper-tiny"
    monkeypatch.setattr(providers, "MODEL_PATH", destination)
    calls = []

    def download(**kwargs):
        from pathlib import Path
        calls.append(kwargs)
        staging = Path(kwargs["local_dir"])
        staging.mkdir()
        for name in providers.MODEL_FILES:
            (staging / name).touch()

    monkeypatch.setitem(sys.modules, "huggingface_hub", SimpleNamespace(snapshot_download=download))
    assert not calls
    assert providers.install_model("specific-revision") == destination
    assert len(calls) == 1
    assert calls[0]["repo_id"] == "Systran/faster-whisper-tiny"
    assert calls[0]["revision"] == "specific-revision"
    assert calls[0]["max_workers"] == 1
    assert (destination / "tokenizer.json").is_file()
    with pytest.raises(AnalysisError, match="уже существует"):
        providers.install_model()
    assert len(calls) == 1


@pytest.mark.parametrize("cancel_stage", [None, "decoding", "transcribing", "saving"])
def test_real_pipeline_persists_stages_and_cancellation(tmp_path, monkeypatch, cancel_stage):
    monkeypatch.setattr("backend.jobs.decode_audio", passthrough)
    monkeypatch.setattr("backend.jobs.transcribe", lambda *args: [
        {"id": str(uuid4()), "text": "Текст", "chords": [], "source": "model"}])
    store = Store(tmp_path)
    stages, entered, release = [], Event(), Event()

    def processor(song, source, check):
        def report(stage=None):
            check(stage)
            if stage:
                with sqlite3.connect(jobs.database) as db:
                    persisted = db.execute("SELECT stage FROM jobs WHERE status='running'").fetchone()[0]
                assert persisted == stage
                stages.append(stage)
                if stage == cancel_stage:
                    entered.set()
                    assert release.wait(5)
                    check()
        return analyze(song, source, report)

    jobs = Jobs(store, processor)
    try:
        job = jobs.enqueue(add_audio(store))
        if cancel_stage:
            assert entered.wait(5)
            assert jobs.list()[0]["stage"] == cancel_stage
            pending = jobs.cancel(job["id"])
            assert pending["statusLabel"] == "Отмена…"
            release.set()
            terminal = wait_for(jobs, job["id"], {"cancelled"})
            assert terminal["stage"] == cancel_stage
            assert terminal["statusLabel"] == "Отменено"
            assert stages[-1] == cancel_stage
            assert jobs.result(job["id"]) is None
        else:
            terminal = wait_for(jobs, job["id"], {"completed"})
            assert stages == ["decoding", "transcribing", "saving"]
            assert terminal["stage"] == "saving"
            assert terminal["stageLabel"] == "Сохранение черновика"
    finally:
        release.set()
        jobs.close()
    reopened = Jobs(store, autostart=False)
    try:
        assert reopened.get(job["id"])["stage"] == terminal["stage"]
    finally:
        reopened.close()


def test_stage_additive_migration_of_existing_database(tmp_path):
    store = Store(tmp_path)
    with sqlite3.connect(tmp_path / "jobs.sqlite3") as db:
        db.execute("""CREATE TABLE jobs (
            seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
            song_id TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
            started_at TEXT, finished_at TEXT, cancel_requested INTEGER NOT NULL DEFAULT 0,
            error TEXT, document TEXT NOT NULL, audio_file TEXT NOT NULL, result TEXT)""")
        identifier = str(uuid4())
        song = document()
        db.execute("""INSERT INTO jobs(id,song_id,status,created_at,document,audio_file,result)
                      VALUES (?,?,'completed',?,?,?,?)""",
                   (identifier, song["id"], song["updatedAt"], json.dumps(song), "input.mp3", json.dumps(song)))
    for _ in range(2):
        jobs = Jobs(store, autostart=False)
        try:
            assert jobs.get(identifier)["stage"] is None
            assert jobs.get(identifier)["kind"] == "transcription"
            assert jobs.get(identifier)["stageLabel"] is None
            assert jobs.result(identifier) == song
        finally:
            jobs.close()


@pytest.mark.parametrize("package_installed", [False, True])
@pytest.mark.parametrize("model_state", ["absent", "partial", "empty", "complete"])
def test_health_uses_metadata_without_importing_inference(tmp_path, monkeypatch, package_installed, model_state):
    model = tmp_path / "model"
    model.mkdir()
    monkeypatch.setattr(providers, "MODEL_PATH", model)
    if model_state != "absent":
        files = providers.MODEL_FILES[:1] if model_state == "partial" else providers.MODEL_FILES
        for name in files:
            (model / name).write_bytes(b"" if model_state == "empty" else b"data")

    def version(name):
        assert name == "faster-whisper"
        if not package_installed:
            raise providers.metadata.PackageNotFoundError(name)
        return "1.2.1"

    monkeypatch.setattr(providers.metadata, "version", version)
    # Any heavy import would encounter this poisoned module.
    monkeypatch.setitem(sys.modules, "faster_whisper", None)
    with TestClient(create_app(tmp_path / "data")) as client:
        health = client.get("/api/health").json()
    assert health["providerAvailable"] is package_installed
    assert health["providerVersion"] == ("1.2.1" if package_installed else None)
    assert health["modelInstalled"] is (model_state == "complete")
    expected = "uninstalled" if not package_installed else ("installed" if model_state == "complete" else "missing_model")
    assert health["transcription"] == expected


def flagged_song():
    song = document()
    palette_id = str(uuid4())
    song["palette"] = [{"id": palette_id, "name": "Am"}]
    line = song["sections"][0]["lines"][0]
    line["chords"] = [{"id": str(uuid4()), "paletteId": palette_id, "offset": 0, "source": "manual"}]
    return song


def test_optional_provenance_round_trip_and_old_documents(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        old = flagged_song()
        assert client.post("/api/songs", json=old).json() == old
        changed = copy.deepcopy(old)
        line = changed["sections"][0]["lines"][0]
        line.update(source="model", manuallyEdited=True)
        line["chords"][0]["manuallyEdited"] = False
        url = f'/api/songs/{old["id"]}'
        assert client.put(url, json=changed).json() == changed
        assert client.get(url + "/export").json() == changed
        imported = client.post("/api/import", json=changed)
        assert imported.status_code == 201
        assert imported.json()["sections"] == changed["sections"]


@pytest.mark.parametrize("target,field,value", [
    ("line", "source", None), ("line", "source", "ai"), ("line", "source", 1),
    ("line", "manuallyEdited", None), ("line", "manuallyEdited", 1),
    ("line", "manuallyEdited", "true"), ("chord", "manuallyEdited", None),
    ("chord", "manuallyEdited", 0), ("chord", "manuallyEdited", "false"),
])
def test_optional_provenance_rejects_nulls_and_coercion(target, field, value):
    song = flagged_song()
    line = song["sections"][0]["lines"][0]
    item = line if target == "line" else line["chords"][0]
    item[field] = value
    with pytest.raises(ValueError):
        Song.model_validate(song)


def test_chords_api_real_decode_without_whisper_and_attachment_counts(tmp_path, monkeypatch):
    import numpy as np
    from backend import harmony

    if not shutil.which("ffmpeg"):
        pytest.skip("FFmpeg is not installed")
    monkeypatch.setattr(providers, "MODEL_PATH", tmp_path / "missing-model")
    monkeypatch.setattr(providers, "_model", None)

    def no_transcription(*args):
        pytest.fail("Chord analysis must not call Whisper")

    monkeypatch.setattr("backend.jobs.transcribe", no_transcription)
    actual_analyze = harmony.analyze_chords
    observed = []
    with TestClient(create_app(tmp_path / "data")) as client:
        store = client.app.state.store
        row = add_audio(store)
        original = json.loads(row["document"])
        ticks = np.arange(32000) / 16000
        with wave.open(str(store.audio / row["audio_file"]), "wb") as audio:
            audio.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
            for notes in ([60, 64, 67], [], [57, 60, 64]):
                signal = (sum(np.sin(2 * np.pi * (440 * 2 ** ((note - 69) / 12)) * ticks)
                              for note in notes) / len(notes)) if notes else np.zeros(32000)
                audio.writeframes((signal * 0.6 * 32767).astype("<i2").tobytes())

        def observe(wav, check):
            job = client.app.state.jobs.list()[0]
            observed.append((job["kind"], job["stage"]))
            return actual_analyze(wav, check)

        monkeypatch.setattr(harmony, "analyze_chords", observe)
        url = f'/api/songs/{row["id"]}/analysis'
        assert client.post(url + "?kind=invalid").status_code == 422
        response = client.post(url + "?kind=chords")
        assert response.status_code == 202
        job = response.json()
        assert job["kind"] == "chords"
        terminal = wait_for(client.app.state.jobs, job["id"], {"completed", "failed"})
        assert terminal["status"] == "completed", terminal
        assert terminal["stage"] == "saving"
        assert observed == [("chords", "harmony")]
        draft = client.get(f'/api/jobs/{job["id"]}/result').json()
        assert draft["id"] != original["id"] and draft["source"] == "model"
        assert draft["sections"][:-1] == original["sections"]
        added = draft["sections"][-1]
        assert added["name"] == "Экспериментальная шкала аккордов"
        assert len(added["lines"]) == 3
        assert [len(line["chords"]) for line in added["lines"]] == [1, 0, 1]
        assert len(draft["palette"]) - len(original["palette"]) == 2
        assert {entry["name"] for entry in draft["palette"]} == {"C", "Am"}
        assert json.loads(store.get(row["id"])["document"]) == original
        assert client.get("/api/health").json()["modelInstalled"] is False
        assert client.get("/api/health").json()["harmonyAvailable"] is True
        imported = client.post("/api/import", json=draft)
        assert imported.status_code == 201
        assert imported.json()["sections"] == draft["sections"]
        assert imported.json()["audio"] is None


def test_chords_kind_persists_restarts_and_active_uniqueness_is_per_song(tmp_path, monkeypatch):
    from backend import harmony

    monkeypatch.setattr("backend.jobs.decode_audio", passthrough)
    monkeypatch.setattr(harmony, "analyze_chords", lambda *args: [{"name": "C", "start": 0.0, "end": 1.0}])
    store = Store(tmp_path)
    row = add_audio(store)
    jobs = Jobs(store, autostart=False)
    job = jobs.enqueue(row, "chords")
    assert job["stage"] is None
    duplicate = jobs.enqueue(row)  # Same song's active chord job wins, even across kinds.
    assert duplicate["id"] == job["id"] and duplicate["kind"] == "chords"
    jobs.close()
    resumed = Jobs(store)
    try:
        terminal = wait_for(resumed, job["id"], {"completed"})
        assert terminal["kind"] == "chords"
        assert len(resumed.result(job["id"])["sections"][-1]["lines"]) == 1
    finally:
        resumed.close()


def test_chords_api_cancel_in_harmony_stage(tmp_path, monkeypatch):
    from backend import harmony

    monkeypatch.setattr("backend.jobs.decode_audio", passthrough)
    entered, release = Event(), Event()

    def blocking(wav, check):
        entered.set()
        assert release.wait(5)
        check()
        return []

    monkeypatch.setattr(harmony, "analyze_chords", blocking)
    with TestClient(create_app(tmp_path)) as client:
        row = add_audio(client.app.state.store)
        job = client.post(f'/api/songs/{row["id"]}/analysis?kind=chords').json()
        try:
            assert entered.wait(5)
            pending = client.post(f'/api/jobs/{job["id"]}/cancel').json()
            assert pending["kind"] == "chords" and pending["stage"] == "harmony"
            assert pending["stageLabel"] == "Анализ аккордов"
            release.set()
            wait_for(client.app.state.jobs, job["id"], {"cancelled"})
            assert client.get(f'/api/jobs/{job["id"]}/result').status_code == 409
        finally:
            release.set()


def test_health_harmony_requires_numpy_and_ffmpeg(tmp_path, monkeypatch):
    with TestClient(create_app(tmp_path)) as client:
        monkeypatch.setattr("backend.main.find_spec", lambda _: None)
        monkeypatch.setattr("backend.main.shutil.which", lambda _: "ffmpeg")
        assert client.get("/api/health").json()["harmonyAvailable"] is False
        monkeypatch.setattr("backend.main.find_spec", lambda _: object())
        assert client.get("/api/health").json()["harmonyAvailable"] is True
        monkeypatch.setattr("backend.main.shutil.which", lambda _: None)
        assert client.get("/api/health").json()["harmonyAvailable"] is False


def completed_import_job(client, *, large=False):
    store = client.app.state.store
    row = add_audio(store)
    mp3 = (bytes.fromhex("fffb9064") + bytes(413)) * 10
    (store.audio / row["audio_file"]).write_bytes(mp3)

    def processor(song, source, check):
        draft = copy.deepcopy(song)
        draft["id"] = str(uuid4())
        line = draft["sections"][0]["lines"][0]
        line.update(source="model", manuallyEdited=True)
        if large:
            draft["sections"][0]["lines"] = [
                {**line, "id": str(uuid4()), "text": "я" * 4500} for _ in range(250)]
        # Import must use the job's internal source, never this URL.
        draft["audio"] = {"filename": "untrusted.mp3", "url": "https://invalid.example/not-a-source"}
        return draft

    client.app.state.jobs.processor = processor
    job = client.app.state.jobs.enqueue(row)
    wait_for(client.app.state.jobs, job["id"], {"completed", "failed"})
    return row, job, mp3


def test_import_result_copies_independent_audio_and_preserves_flags(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        row, job, mp3 = completed_import_job(client)
        store = client.app.state.store
        original = row["document"]
        draft = client.app.state.jobs.result(job["id"])
        response = client.post(f'/api/jobs/{job["id"]}/import-result')
        assert response.status_code == 201, response.text
        assert response.headers["X-Analysis-Audio"] == "copied"
        imported = response.json()
        assert imported["id"] not in (row["id"], draft["id"])
        assert imported["sections"] == draft["sections"]
        assert imported["audio"]["filename"] == "input.mp3"
        assert imported["audio"]["url"].startswith(f'/api/songs/{imported["id"]}/audio?v=')
        imported_row = store.get(imported["id"])
        assert imported_row["audio_file"] != row["audio_file"]
        assert store.get(row["id"])["document"] == original
        fetched = client.get(imported["audio"]["url"], headers={"Range": "bytes=0-15"})
        assert fetched.status_code == 206 and fetched.content == mp3[:16]
        assert client.delete(f'/api/songs/{row["id"]}').status_code == 204
        assert client.get(imported["audio"]["url"]).content == mp3
        assert (store.audio / imported_row["audio_file"]).is_file()
        # Source gone: future imports remain possible but explicitly lack audio.
        fallback = client.post(f'/api/jobs/{job["id"]}/import-result')
        assert fallback.status_code == 201
        assert fallback.headers["X-Analysis-Audio"] == "unavailable"
        assert fallback.json()["audio"] is None
        assert fallback.json()["sections"] == draft["sections"]


@pytest.mark.parametrize("failure", ["copy", "create", "set_audio"])
def test_import_result_failure_cleans_new_files_and_rows(tmp_path, monkeypatch, failure):
    with TestClient(create_app(tmp_path), raise_server_exceptions=False) as client:
        row, job, mp3 = completed_import_job(client)
        store = client.app.state.store
        before = {path.name for path in store.audio.iterdir()}

        def fail(*args, **kwargs):
            if failure == "copy":
                from pathlib import Path
                Path(args[1]).write_bytes(b"partial")
            raise OSError("simulated disk failure")

        if failure == "copy":
            monkeypatch.setattr("backend.main.shutil.copyfile", fail)
        else:
            monkeypatch.setattr(store, failure, fail)
        response = client.post(f'/api/jobs/{job["id"]}/import-result')
        assert response.status_code == 503
        assert len(store.list()) == 1
        assert store.get(row["id"])["document"] == row["document"]
        assert {path.name for path in store.audio.iterdir()} == before
        assert (store.audio / row["audio_file"]).read_bytes() == mp3


def test_oversized_draft_fails_and_cannot_be_imported(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        assert client.post(f'/api/jobs/{uuid4()}/import-result').status_code == 404
        row, job, mp3 = completed_import_job(client, large=True)
        failed = client.app.state.jobs.get(job["id"])
        assert failed["status"] == "failed"
        assert "превышает 2 000 000 байт" in failed["error"]
        assert failed["resultAvailable"] is False
        assert client.app.state.jobs.result(job["id"]) is None
        assert client.get(f'/api/jobs/{job["id"]}/result').status_code == 409
        assert client.post(f'/api/jobs/{job["id"]}/import-result').status_code == 409
        assert len(client.app.state.store.list()) == 1
