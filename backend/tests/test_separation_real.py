"""Explicit opt-in smoke test using installed weights, synthetic audio only.

No download is performed. Run with IN_TUNE_TEST_REAL_SEPARATION=1 after install.
This is a functional/timing check, not a music-quality benchmark.
"""
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import subprocess
from threading import Event
import time
import wave

import numpy as np
import pytest

from backend import separation
from backend.jobs import Jobs
from backend.tests.test_separation import add_audio, wait_for


pytestmark = pytest.mark.skipif(os.environ.get("IN_TUNE_TEST_REAL_SEPARATION") != "1", reason="Explicit real-model verification only; never auto-downloads")


def test_actual_cpu_separation_synthetic_eight_seconds(tmp_path, monkeypatch):
    from backend.storage import Store
    assert separation.status()["available"], separation.status()
    store = Store(tmp_path / "data")
    row = add_audio(store, seconds=8)
    source = store.audio / row["audio_file"]
    rate = 44100
    t = np.arange(8 * rate) / rate
    # Synthetic low/high components and pulses, deliberately not a user song.
    signal = .16 * np.sin(2 * np.pi * 220 * t) + .07 * np.sin(2 * np.pi * 740 * t) * (.5 + .5 * np.sin(2 * np.pi * 3 * t))
    stereo = np.column_stack((signal, signal * .8)).astype(np.float32)
    with wave.open(str(source), "wb") as audio:
        audio.setnchannels(2)
        audio.setsampwidth(2)
        audio.setframerate(rate)
        audio.writeframes((stereo * 32767).astype("<i2").tobytes())
    before = separation.fingerprint(source)
    real_popen = subprocess.Popen
    measurements = {"syntheticSeconds": 8, "device": "cpu", "peakWorkingSetBytes": None}

    class MemoryCounters(ctypes.Structure):
        _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD)] + [(name, ctypes.c_size_t) for name in (
            "PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage", "QuotaPagedPoolUsage",
            "QuotaPeakNonPagedPoolUsage", "QuotaNonPagedPoolUsage", "PagefileUsage", "PeakPagefileUsage")]

    def capture(*args, **kwargs):
        process = real_popen(*args, **kwargs)
        if "--output-dir" in args[0]:
            started = time.perf_counter()
            real_poll = process.poll

            def poll():
                if os.name == "nt":
                    counters = MemoryCounters()
                    counters.cb = ctypes.sizeof(counters)
                    get_memory = ctypes.windll.psapi.GetProcessMemoryInfo
                    get_memory.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD]
                    if get_memory(wintypes.HANDLE(int(process._handle)), ctypes.byref(counters), counters.cb):
                        measurements["peakWorkingSetBytes"] = max(measurements["peakWorkingSetBytes"] or 0, counters.PeakWorkingSetSize)
                result = real_poll()
                if result is not None:
                    measurements["inferenceProcessSeconds"] = round(time.perf_counter() - started, 3)
                return result

            process.poll = poll
        return process

    monkeypatch.setattr(separation.subprocess, "Popen", capture)
    monkeypatch.setenv("IN_TUNE_SEPARATION_DEVICE", "cpu")
    jobs = Jobs(store, autostart=False)
    try:
        job = jobs.enqueue(row, "separation")
        started = time.perf_counter()
        jobs._execute(jobs._claim())
        measurements["totalJobSeconds"] = round(time.perf_counter() - started, 3)
        completed = jobs.get(job["id"])
        assert completed["status"] == "completed", completed
        assert not completed["resultAvailable"]
        ready = separation.stems(store, row["id"])
        assert ready["ready"] and ready["duration"] == 8
        assert separation.fingerprint(source) == before
        metadata = json.loads((store.root / "stems" / row["id"] / "metadata.json").read_text())
        output = store.root / "stems" / row["id"] / metadata["generation"]
        # Small output validation in the isolated environment, not backend deps.
        code = "import json,sys,soundfile as sf,numpy as np; p=sys.argv[1]; a,s=sf.read(p+'/vocals.flac',dtype='float32'); b,q=sf.read(p+'/accompaniment.flac',dtype='float32'); assert s==q==44100 and a.shape==b.shape==(352800,2) and np.isfinite(a).all() and np.isfinite(b).all(); print(json.dumps({'frames':len(a),'sampleRate':s,'vocalsRms':float(np.sqrt((a*a).mean())),'accompanimentRms':float(np.sqrt((b*b).mean()))}))"
        check = subprocess.run([str(separation.runtime_python()), "-I", "-c", code, str(output)], capture_output=True, text=True, timeout=60)
        assert check.returncode == 0, check.stderr
        measurements.update(json.loads(check.stdout))
        assert measurements["vocalsRms"] > 0 and measurements["accompanimentRms"] > 0
        assert metadata["offsetSeconds"] == 0
        report = separation.ROOT / ".tmp" / "separation-smoke.json"
        report.parent.mkdir(exist_ok=True)
        report.write_text(json.dumps(measurements, indent=2), encoding="utf-8")
        print(json.dumps(measurements))
    finally:
        jobs.close()


def test_actual_isolated_runtime_cancellation_reaps_inference_pid(tmp_path, monkeypatch):
    from backend.storage import Store
    from backend import providers
    assert separation.status()["available"], separation.status()
    store = Store(tmp_path / "data")
    row = add_audio(store, seconds=8)
    before = separation.fingerprint(store.audio / row["audio_file"])
    entered = Event()
    children = []
    real_popen = subprocess.Popen

    def capture(*args, **kwargs):
        process = real_popen(*args, **kwargs)
        if "--output-dir" in args[0]:
            children.append(process)
            # The executable is base Python, not the Windows venv redirector.
            assert Path(args[0][0]).resolve() == Path(json.loads((separation.runtime_python().parent.parent / "separation-runtime.json").read_text())["baseExecutable"]).resolve()
            entered.set()
        return process

    monkeypatch.setattr(separation.subprocess, "Popen", capture)
    jobs = Jobs(store)
    try:
        job = jobs.enqueue(row, "separation")
        assert entered.wait(10)
        time.sleep(.75)
        started = time.perf_counter()
        jobs.cancel(job["id"])
        wait_for(jobs, job["id"], {"cancelled"})
        elapsed = round(time.perf_counter() - started, 3)
        assert len(children) == 1 and children[0].poll() is not None
        assert not providers._lock.locked()
        assert not separation.stems(store, row["id"])["ready"]
        assert separation.fingerprint(store.audio / row["audio_file"]) == before
        assert not list((store.root / "stems" / row["id"]).glob(".tmp-*"))
        report = separation.ROOT / ".tmp" / "separation-smoke.json"
        data = json.loads(report.read_text()) if report.exists() else {}
        data["realCancellationSeconds"] = elapsed
        report.write_text(json.dumps(data, indent=2), encoding="utf-8")
        print(json.dumps({"realCancellationSeconds": elapsed, "ownedInferencePidReaped": True}))
    finally:
        jobs.close()
