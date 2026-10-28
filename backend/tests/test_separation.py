"""Offline integration tests. Stub outputs are explicitly not model benchmarks."""
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
from threading import Event
import time
from uuid import uuid4
import wave

from fastapi import FastAPI
from fastapi.testclient import TestClient
import numpy as np
import pytest

from backend import separation
from backend.audio import AnalysisError, Cancelled
from backend.jobs import Jobs
from backend.schema import Song
from backend.storage import Store
from scripts import separate_audio


def add_audio(store, seconds=1):
    identifier = str(uuid4())
    song = {"schemaVersion": 1, "id": identifier, "title": "Original", "artist": "",
            "language": "en", "palette": [], "sections": [], "performance": {"fontSize": 24, "bpm": 120, "beats": 4},
            "audio": None, "updatedAt": "2026-10-25T10:00:00Z", "source": "manual"}
    store.create(Song.model_validate(song))
    name = str(uuid4()) + ".wav"
    with wave.open(str(store.audio / name), "wb") as audio:
        audio.setnchannels(2)
        audio.setsampwidth(2)
        audio.setframerate(44100)
        audio.writeframes(b"\x01\x00\x02\x00" * int(seconds * 44100))
    store.set_audio(identifier, name, {"filename": "Original.wav", "url": f"/api/songs/{identifier}/audio"}, song["updatedAt"])
    return store.get(identifier)


def wait_for(jobs, identifier, statuses):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        job = jobs.get(identifier)
        if job["status"] in statuses:
            return job
        time.sleep(.02)
    pytest.fail(str(jobs.get(identifier)))


@pytest.fixture
def store(tmp_path):
    return Store(tmp_path / "data")


@pytest.fixture
def stub_runtime(tmp_path, monkeypatch):
    if not shutil.which("ffmpeg"):
        pytest.skip("FFmpeg is required for the real decoder/process integration test")
    root = tmp_path / "stub-runtime"
    (root / "scripts").mkdir(parents=True)
    (root / "scripts" / "separate_audio.py").write_text('''
import argparse,json,time,wave
from pathlib import Path
p=argparse.ArgumentParser()
for name in ('input','output-dir','model-dir','device'):p.add_argument('--'+name)
a=p.parse_args()
root=Path(__file__).resolve().parents[1]
(root/'entered').write_text('entered')
while (root/'hold').exists():time.sleep(.05)
with wave.open(a.input,'rb') as w:frames=w.getnframes()
out=Path(a.output_dir)
# Deliberately stub bytes: this test verifies orchestration, not audio quality.
for stem in ('vocals','accompaniment'):(out/(stem+'.flac')).write_bytes(b'fLaC-stub-'+stem.encode())
(out/'result.json').write_text(json.dumps({'frames':frames,'sampleRate':44100,'offsetSeconds':0}))
''', encoding="utf-8")
    monkeypatch.setattr(separation, "ROOT", root)
    monkeypatch.setattr(separation, "runtime_python", lambda: Path(sys.executable))
    monkeypatch.setattr(separation, "runtime_command", lambda: [sys.executable, "-I", root / "scripts" / "separate_audio.py"])
    monkeypatch.setattr(separation, "status", lambda: {"available": True})
    return root


def test_absence_is_offline_actionable_and_base_jobs_survive(store, tmp_path, monkeypatch):
    monkeypatch.setattr(separation, "MODEL_ROOT", tmp_path / "missing")
    monkeypatch.setattr(separation, "runtime_python", lambda: tmp_path / "absent/python.exe")
    monkeypatch.setattr(separation.subprocess, "Popen", lambda *a, **k: pytest.fail("status must not spawn/download"))
    state = separation.status()
    assert state["available"] is False and state["modelInstalled"] is False
    assert "install-separation.ps1" in state["command"]
    assert "84 141 911" in state["modelSize"]
    row = add_audio(store)
    jobs = Jobs(store, processor=lambda song, source, check: song, autostart=False)
    try:
        job = jobs.enqueue(row, "separation")
        jobs._execute(jobs._claim())
        assert jobs.get(job["id"])["status"] == "failed"
        assert "install-separation.ps1" in jobs.get(job["id"])["error"]
        assert jobs.result(job["id"]) is None
        old = jobs.enqueue(row, "transcription")
        jobs._execute(jobs._claim())
        assert jobs.result(old["id"])["title"] == "Original"
    finally:
        jobs.close()


def test_real_decoder_child_stub_atomic_reuse_source_unchanged(store, stub_runtime, monkeypatch):
    row = add_audio(store)
    source = store.audio / row["audio_file"]
    before, document = source.read_bytes(), row["document"]
    calls = []
    separation.separate(store, json.loads(document), source, lambda stage=None: calls.append(stage))
    ready = separation.stems(store, row["id"])
    assert ready["ready"] and ready["duration"] == 1
    metadata_path = store.root / "stems" / row["id"] / "metadata.json"
    metadata = json.loads(metadata_path.read_text())
    assert metadata["offsetSeconds"] == 0 and metadata["sourceFingerprint"] == separation.fingerprint(source)
    assert not list(metadata_path.parent.glob(".tmp-*"))
    monkeypatch.setattr(separation, "run_process", lambda *a, **kw: pytest.fail("ready exact source must be reused"))
    monkeypatch.setattr(separation, "status", lambda: {"available": False})
    separation.separate(store, json.loads(document), source, lambda stage=None: None)
    assert metadata_path.read_text() == json.dumps(metadata, ensure_ascii=False, allow_nan=False)
    assert source.read_bytes() == before and store.get(row["id"])["document"] == document
    # Same length and mtime cannot hide changed audio bytes.
    original_stat = source.stat()
    changed = bytearray(before)
    changed[-1] ^= 1
    source.write_bytes(changed)
    import os
    os.utime(source, ns=(original_stat.st_atime_ns, original_stat.st_mtime_ns))
    assert separation.stems(store, row["id"])["ready"] is False


def test_source_replacement_during_inference_discards_output(store, stub_runtime, monkeypatch):
    row = add_audio(store)
    original_run = separation.run_process

    def replace(command, check, **options):
        original_run(command, check, **options)
        if "--output-dir" in command:
            with store.connect() as db:
                db.execute("UPDATE songs SET audio_file=? WHERE id=?", (str(uuid4()) + ".wav", row["id"]))

    monkeypatch.setattr(separation, "run_process", replace)
    with pytest.raises(AnalysisError, match="изменилось"):
        separation.separate(store, json.loads(row["document"]), store.audio / row["audio_file"], lambda stage=None: None)
    assert not (store.root / "stems" / row["id"] / "metadata.json").exists()
    assert not list((store.root / "stems" / row["id"]).glob(".tmp-*"))


def test_cancel_terminates_actual_owned_child_and_releases_fifo(store, stub_runtime, monkeypatch):
    row = add_audio(store)
    (stub_runtime / "hold").touch()
    processes = []
    real_popen = subprocess.Popen

    def capture(*args, **kwargs):
        assert kwargs["shell"] is False and "PYTHONPATH" not in kwargs["env"]
        child = real_popen(*args, **kwargs)
        processes.append(child)
        return child

    monkeypatch.setattr(separation.subprocess, "Popen", capture)
    jobs = Jobs(store, processor=lambda song, source, check: song)
    try:
        first = jobs.enqueue(row, "separation")
        deadline = time.monotonic() + 8
        while not (stub_runtime / "entered").exists() and time.monotonic() < deadline:
            time.sleep(.02)
        assert (stub_runtime / "entered").exists()
        second_row = add_audio(store)
        second = jobs.enqueue(second_row)
        assert jobs.get(second["id"])["status"] == "queued"
        jobs.cancel(first["id"])
        wait_for(jobs, first["id"], {"cancelled"})
        wait_for(jobs, second["id"], {"completed"})
        assert len(processes) == 2 and all(p.poll() is not None for p in processes)
        assert not list((store.root / "stems" / row["id"]).glob(".tmp-*"))
        assert not separation.stems(store, row["id"])["ready"]
        assert jobs.result(first["id"]) is None
    finally:
        jobs.close()


def test_restart_marks_running_separation_interrupted_and_preserves_source(store):
    row = add_audio(store)
    source = store.audio / row["audio_file"]
    original = source.read_bytes()
    jobs = Jobs(store, autostart=False)
    job = jobs.enqueue(row, "separation")
    jobs._claim()
    jobs.close()
    jobs = Jobs(store, autostart=False)
    try:
        failed = jobs.get(job["id"])
        assert failed["status"] == "failed" and "перезапуском" in failed["error"]
        assert separation.stems(store, row["id"], jobs)["error"] == failed["error"]
        assert source.read_bytes() == original
    finally:
        jobs.close()


def test_router_streaming_range_validation_and_no_song_result(store, stub_runtime):
    row = add_audio(store)
    jobs = Jobs(store)
    app = FastAPI()
    app.include_router(separation.separation_router(lambda: store, lambda: jobs))
    try:
        with TestClient(app) as client:
            identifier = row["id"]
            assert client.get(f"/api/songs/{identifier}/stems").json() == {"ready": False}
            job = client.post(f"/api/songs/{identifier}/separation").json()
            assert job["kind"] == "separation"
            completed = wait_for(jobs, job["id"], {"completed"})
            assert not completed["resultAvailable"] and jobs.result(job["id"]) is None
            ready = client.get(f"/api/songs/{identifier}/stems").json()
            assert ready["ready"]
            response = client.get(ready["vocalsUrl"], headers={"Range": "bytes=0-3"})
            assert response.status_code == 206 and response.content == b"fLaC"
            assert response.headers["content-type"] == "audio/flac"
            assert client.get(f"/api/songs/{identifier}/stems/vocals?v=obsolete").status_code == 404
            assert client.get(f"/api/songs/{identifier}/stems/metadata.json").status_code == 422
            assert client.get("/api/songs/not-a-uuid/stems").status_code == 422
            assert client.post(f"/api/songs/{uuid4()}/separation").status_code == 404
            # The route has no input path or command argument; a supplied body is
            # ignored and only the song's trusted Store audio can be processed.
            again = client.post(f"/api/songs/{identifier}/separation", json={"input": "C:/private.wav"})
            assert again.status_code == 202
            wait_for(jobs, again.json()["id"], {"completed"})
    finally:
        jobs.close()


def test_path_traversal_and_metadata_corruption_are_never_served(store, tmp_path, stub_runtime):
    row = add_audio(store)
    for name in ("../private.mp3", "..\\private.mp3", "C:\\private.mp3", "a.wav:stream", "/private.wav"):
        with pytest.raises(AnalysisError):
            separation.source_path(store, {"audio_file": name})
    with pytest.raises(AnalysisError):
        separation._directory(store, "../audio")
    separation.separate(store, json.loads(row["document"]), store.audio / row["audio_file"], lambda stage=None: None)
    pointer = store.root / "stems" / row["id"] / "metadata.json"
    data = json.loads(pointer.read_text())
    data["generation"] = "../../audio"
    pointer.write_text(json.dumps(data))
    assert not separation.stems(store, row["id"])["ready"]
    pointer.write_text("broken-json")
    assert not separation.stems(store, row["id"])["ready"]


@pytest.mark.parametrize("frames", [1, 13, 16, 17, 25, 28, 30, 43, 400])
def test_overlap_add_keeps_every_sample_and_bounds_each_prediction(frames):
    values = np.random.default_rng(12).normal(0, .1, (frames, 2)).astype(np.float32)
    sizes = []

    class Reader:
        def __init__(self):
            self.frames = frames
            self.position = 0

        def seek(self, position):
            self.position = position

        def read(self, count, **kwargs):
            return values[self.position:self.position + count].copy()

    class Writer:
        def __init__(self):
            self.blocks = []

        def write(self, block):
            self.blocks.append(block.copy())

    def predict(block):
        sizes.append(len(block))
        return block * .25

    vocals, accompaniment = Writer(), Writer()
    assert separate_audio.stream_stems(Reader(), predict, vocals, accompaniment, segment_frames=16, overlap_frames=4) == frames
    np.testing.assert_allclose(np.concatenate(vocals.blocks), values * .25, atol=1e-7)
    np.testing.assert_allclose(np.concatenate(accompaniment.blocks), values * .75, atol=1e-7)
    assert max(sizes) <= 16


def test_explicit_model_download_stages_checks_and_never_requests_other_models(tmp_path, monkeypatch, capsys):
    content = b"trusted-official-checkpoint-stub"
    import hashlib
    monkeypatch.setattr(separate_audio, "MODEL_BYTES", len(content))
    monkeypatch.setattr(separate_audio, "MODEL_SHA256", hashlib.sha256(content).hexdigest())
    requested = []

    class Response(io.BytesIO):
        headers = {"Content-Length": str(len(content))}

    def download(request, **options):
        requested.append(request.full_url if hasattr(request, "full_url") else request)
        return Response(content)

    monkeypatch.setattr(separate_audio, "urlopen", download)
    separate_audio.install_model(tmp_path)
    assert requested == [separate_audio.MODEL_URL] * 2
    assert (tmp_path / separate_audio.CHECKPOINT).read_bytes() == content
    assert json.loads((tmp_path / "installed.json").read_text())["bytes"] == len(content)
    assert "Explicit download" in capsys.readouterr().out
    separate_audio.install_model(tmp_path)
    assert len(requested) == 2
    assert not list(tmp_path.glob(".install-*"))


def test_bad_checkpoint_never_commits_installed_marker(tmp_path, monkeypatch):
    content = b"corrupt"
    monkeypatch.setattr(separate_audio, "MODEL_BYTES", len(content))
    monkeypatch.setattr(separate_audio, "MODEL_SHA256", "0" * 64)

    class Response(io.BytesIO):
        headers = {"Content-Length": str(len(content))}

    monkeypatch.setattr(separate_audio, "urlopen", lambda *a, **k: Response(content))
    with pytest.raises(ValueError, match="SHA-256"):
        separate_audio.install_model(tmp_path)
    assert not (tmp_path / "installed.json").exists()
    assert not (tmp_path / separate_audio.CHECKPOINT).exists()


def test_cancel_before_spawn_and_timeout_reap_actual_process(tmp_path):
    def cancel():
        raise Cancelled()
    with pytest.raises(Cancelled):
        separation.run_process(["this-must-never-launch"], cancel, timeout=1)
    with pytest.raises(AnalysisError, match="время"):
        separation.run_process([sys.executable, "-c", "import time; time.sleep(30)"], lambda: None, timeout=.1)


def test_shared_inference_lock_unloads_cached_speech_and_releases_on_cancel(monkeypatch):
    from backend import providers, follow_provider
    monkeypatch.setattr(providers, "_model", object())
    monkeypatch.setattr(follow_provider, "_model", object())
    with pytest.raises(Cancelled):
        with separation.inference_slot(lambda: None):
            assert providers._lock.locked()
            assert providers._model is None and follow_provider._model is None
            raise Cancelled()
    assert not providers._lock.locked()


def test_startup_cleans_abandoned_scratch_without_touching_ready_stems(store):
    row = add_audio(store)
    directory = store.root / "stems" / row["id"]
    abandoned = directory / ".tmp-interrupted"
    abandoned.mkdir(parents=True)
    (abandoned / "input.wav").write_bytes(b"temporary")
    ready = directory / ("a" * 32)
    ready.mkdir()
    (ready / "vocals.flac").write_bytes(b"ready")
    jobs = Jobs(store, autostart=False)
    try:
        assert not abandoned.exists() and (ready / "vocals.flac").read_bytes() == b"ready"
    finally:
        jobs.close()


def test_late_cancellation_wins_over_newly_published_stems(store, stub_runtime, monkeypatch):
    row = add_audio(store)
    jobs = Jobs(store, autostart=False)
    try:
        job = jobs.enqueue(row, "separation")
        original_separate = separation.separate

        def finish_then_cancel(*args):
            generation = original_separate(*args)
            jobs.cancel(job["id"])
            return generation

        monkeypatch.setattr(separation, "separate", finish_then_cancel)
        jobs._execute(jobs._claim())
        assert jobs.get(job["id"])["status"] == "cancelled"
        assert not separation.stems(store, row["id"])["ready"]
        assert not list((store.root / "stems" / row["id"]).glob("*/vocals.flac"))
    finally:
        jobs.close()


def test_range_validation_caches_digest_but_work_reuse_always_hashes(store, stub_runtime, monkeypatch):
    row = add_audio(store)
    source = store.audio / row["audio_file"]
    separation.separate(store, json.loads(row["document"]), source, lambda stage=None: None)
    real_hash = separation.fingerprint
    hashes = []

    def record(*args):
        hashes.append(True)
        return real_hash(*args)

    separation._range_fingerprint.cache_clear()
    monkeypatch.setattr(separation, "_cache_epoch", lambda: 1)
    monkeypatch.setattr(separation, "fingerprint", record)
    assert separation._metadata(store, row, cached=True)
    assert separation._metadata(store, row, cached=True)
    assert len(hashes) == 1
    # POST reuse / processor validation bypass the range cache.
    assert separation._metadata(store, row)
    assert len(hashes) == 2
    monkeypatch.setattr(separation, "_cache_epoch", lambda: 2)
    assert separation._metadata(store, row, cached=True)
    assert len(hashes) == 3
    source.write_bytes(source.read_bytes() + b'changed')
    assert separation._metadata(store, row, cached=True) is None
