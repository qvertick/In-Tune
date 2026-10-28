"""Optional local stems, using the existing Jobs worker and an isolated runtime.

Importing this module, status queries and server startup never download anything.
The only network operation is the explicitly invoked installer CLI.
"""
from contextlib import contextmanager
from functools import lru_cache
import gc
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import time
from tempfile import TemporaryDirectory
from typing import Literal
from uuid import UUID, uuid4
import wave

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from .audio import AnalysisError
from .schema import Identifier

ROOT = Path(__file__).resolve().parents[1]
MODEL_ROOT = ROOT / "models" / "separation" / "htdemucs"
CHECKPOINT = "955717e8-8726e21a.th"
MODEL_BYTES = 84_141_911
MODEL_SHA256 = "8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4"
INSTALL_COMMAND = ".\\install-separation.ps1 -DownloadModel"
MAX_SECONDS = 600
RECIPE = "htdemucs-4s-overlap1-residual-flac-v1"


def runtime_python():
    override = os.environ.get("IN_TUNE_SEPARATION_PYTHON")
    return Path(override) if override else ROOT / ".venv-separation" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def model_installed():
    try:
        marker = json.loads((MODEL_ROOT / "installed.json").read_text("utf-8"))
        return (marker["checkpoint"] == CHECKPOINT and marker["bytes"] == MODEL_BYTES and marker["sha256"] == MODEL_SHA256
                and (MODEL_ROOT / CHECKPOINT).stat().st_size == MODEL_BYTES)
    except (OSError, ValueError, KeyError, TypeError):
        return False


def runtime_command():
    """Bypass Windows venv's redirector so Popen owns the actual inference PID."""
    python = runtime_python()
    try:
        marker = json.loads((python.parent.parent / "separation-runtime.json").read_text("utf-8"))
        base, packages = Path(marker["baseExecutable"]), Path(marker["sitePackages"])
        expected = ("torch/__init__.py", "demucs_infer/__init__.py", "numpy/__init__.py", "soundfile.py")
        if base.is_file() and packages.is_dir() and all((packages / name).is_file() for name in expected):
            return [base, "-I", "-S", ROOT / "scripts" / "separate_audio.py", "--site-packages", packages]
    except (OSError, ValueError, KeyError, TypeError):
        pass
    raise AnalysisError("Проверьте изолированную среду: install-separation.ps1 (маркер среды отсутствует или устарел).")


def status():
    python = runtime_python()
    # Marker is written only after imports succeed in the isolated interpreter.
    try:
        marker = json.loads((python.parent.parent / "separation-runtime.json").read_text("utf-8"))
        runtime_ready = isinstance(marker, dict) and marker.get("provider") == "demucs-infer" and marker.get("protocol") == 1 and python.is_file()
        if runtime_ready:
            runtime_command()
    except (OSError, ValueError, TypeError, AnalysisError):
        runtime_ready = False
    installed = model_installed()
    available = bool(runtime_ready and installed and shutil.which("ffmpeg"))
    note = ("Локальное разделение: CPU, одна модель htdemucs; обработка может занять значительное время."
            if available else "Необязательное разделение не установлено полностью. Выполните install-separation.ps1 -DownloadModel; нужен FFmpeg в PATH. Автоматической загрузки нет.")
    return {"available": available, "modelInstalled": installed, "command": INSTALL_COMMAND,
            "modelSize": "84 141 911 байт (80,24 МиБ), одна модель htdemucs", "note": note}


def _identifier(identifier):
    try:
        if str(UUID(identifier)) == identifier:
            return identifier
    except (ValueError, TypeError, AttributeError):
        pass
    raise AnalysisError("Недопустимый идентификатор песни.")


def source_path(store, row):
    name = row["audio_file"]
    if not name or Path(name).name != name or "\\" in name or ":" in name:
        raise AnalysisError("Загрузите локальное аудио песни перед разделением.")
    path = (store.audio / name).resolve()
    if path.parent != store.audio.resolve() or not path.is_file() or path.suffix.lower() not in (".mp3", ".wav"):
        raise AnalysisError("Исходное аудио отсутствует или его путь недопустим.")
    return path


def fingerprint(path, check=lambda: None):
    digest = hashlib.sha256()
    before = path.stat()
    with path.open("rb") as source:
        while block := source.read(1024 * 1024):
            check()
            digest.update(block)
    after = path.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise AnalysisError("Исходное аудио изменилось во время чтения. Повторите разделение.")
    return {"sha256": digest.hexdigest(), "bytes": after.st_size}


def _cache_epoch():
    return time.monotonic_ns() // 2_000_000_000


@lru_cache(maxsize=32)
def _range_fingerprint(path, signature, epoch):
    # Only digests/stat keys are retained, never audio. Two second TTL also
    # bounds stale reads if an external editor deliberately restores timestamps.
    return fingerprint(path)


def read_fingerprint(path):
    info = path.stat()
    signature = (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
    return _range_fingerprint(path, signature, _cache_epoch())


def _directory(store, identifier):
    root = (store.root / "stems").resolve()
    # Do not follow a user-created stems symlink outside the data directory.
    if root.parent != store.root.resolve():
        raise AnalysisError("Недопустимая папка результатов разделения.")
    directory = root / _identifier(identifier)
    if directory.resolve() != directory:
        raise AnalysisError("Недопустимая папка результатов разделения.")
    return directory


def _metadata(store, row, check=lambda: None, *, cached=False):
    try:
        directory = _directory(store, row["id"])
        metadata = json.loads((directory / "metadata.json").read_text("utf-8"))
        generation = metadata["generation"]
        if len(generation) != 32 or any(c not in "0123456789abcdef" for c in generation):
            return None
        source = source_path(store, row)
        current_fingerprint = read_fingerprint(source) if cached else fingerprint(source, check)
        if (metadata["recipe"] != RECIPE or metadata["sourceFile"] != row["audio_file"]
                or metadata["sourceFingerprint"] != current_fingerprint):
            return None
        if not isinstance(metadata["duration"], (int, float)) or not math.isfinite(metadata["duration"]) or not 0 < metadata["duration"] <= MAX_SECONDS:
            return None
        for stem in ("vocals", "accompaniment"):
            path = directory / generation / (stem + ".flac")
            if path.resolve().parent != (directory / generation) or path.stat().st_size != metadata["stemBytes"][stem] or path.stat().st_size <= 0:
                return None
        return metadata
    except (OSError, ValueError, KeyError, TypeError, AnalysisError):
        return None


def stems(store, identifier, jobs=None):
    row = store.get(_identifier(identifier))
    if row is None:
        raise HTTPException(404, "Песня не найдена.")
    metadata = _metadata(store, row)
    if metadata:
        base = f"/api/songs/{identifier}/stems"
        version = metadata["generation"]
        return {"ready": True, "vocalsUrl": f"{base}/vocals?v={version}",
                "accompanimentUrl": f"{base}/accompaniment?v={version}", "duration": metadata["duration"]}
    result = {"ready": False}
    if jobs is not None:
        with jobs.connect() as db:
            job = db.execute("SELECT status,error FROM jobs WHERE song_id=? AND kind='separation' ORDER BY seq DESC LIMIT 1", (identifier,)).fetchone()
        if job and job["status"] == "failed" and job["error"]:
            result["error"] = job["error"]
    return result


def run_process(command, check, *, timeout, cwd=None):
    """Only our own process is terminated, then reaped before scratch cleanup."""
    environment = {**os.environ, "OMP_NUM_THREADS": "2", "MKL_NUM_THREADS": "2"}
    # Backend's --target dependencies must never shadow the isolated torch/numpy.
    environment.pop("PYTHONPATH", None)
    environment.pop("PYTHONHOME", None)
    check()
    process = subprocess.Popen([str(arg) for arg in command], shell=False, cwd=cwd, env=environment,
                               stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    try:
        deadline = time.monotonic() + timeout
        while process.poll() is None:
            check()
            if time.monotonic() > deadline:
                raise AnalysisError("Превышено время локального разделения. Попробуйте более короткое аудио.")
            time.sleep(0.05)
        check()
        if process.returncode:
            raise AnalysisError("Локальный процесс разделения завершился с ошибкой. Проверьте FFmpeg, модель и install-separation.ps1; для диагностики запустите scripts/separate_audio.py вручную.")
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
        process.wait()


@contextmanager
def inference_slot(check):
    """Share the speech providers' lock, including across data directories."""
    from . import providers, follow_provider
    while not providers._lock.acquire(timeout=.1):
        check()
    try:
        check()
        providers._model = None
        follow_provider.unload_model()
        gc.collect()
        yield
    finally:
        providers._lock.release()


def cleanup_interrupted(store):
    """Called only after Jobs owns the data directory, before its worker starts."""
    root = (store.root / "stems").absolute()
    if not root.is_dir() or root.resolve() != root:
        return
    for directory in root.iterdir():
        try:
            _identifier(directory.name)
        except AnalysisError:
            continue
        if not directory.is_dir() or directory.resolve() != directory:
            continue
        for stale in directory.glob(".tmp-*"):
            if stale.is_dir() and stale.resolve() == stale:
                shutil.rmtree(stale, ignore_errors=True)


def discard_generation(store, identifier, generation):
    """Cancellation winning Jobs' final transaction must not leave new ready files."""
    directory = _directory(store, identifier)
    try:
        pointer = directory / "metadata.json"
        if json.loads(pointer.read_text("utf-8")).get("generation") == generation:
            pointer.unlink(missing_ok=True)
    except (OSError, ValueError, AttributeError):
        pass
    shutil.rmtree(directory / generation, ignore_errors=True)


def separate(store, song, source, check):
    """Jobs-only processor; persists stems, never returns or mutates a Song."""
    identifier = _identifier(song["id"])
    row = store.get(identifier)
    if row is None or source_path(store, row) != source.resolve():
        raise AnalysisError("Аудио песни изменилось после постановки в очередь. Повторите разделение.")
    check("separating")
    if _metadata(store, row, check):
        return
    if not status()["available"]:
        raise AnalysisError(status()["note"])
    device = os.environ.get("IN_TUNE_SEPARATION_DEVICE", "cpu")
    if device not in ("cpu", "cuda"):
        raise AnalysisError("IN_TUNE_SEPARATION_DEVICE: допустимы cpu или cuda.")
    original = fingerprint(source, check)
    directory = _directory(store, identifier)
    directory.mkdir(parents=True, exist_ok=True)
    # Remove only abandoned staging directories for this song, in the sole worker.
    for stale in directory.glob(".tmp-*"):
        if stale.is_dir() and stale.resolve() == stale:
            shutil.rmtree(stale)
    generation = uuid4().hex
    with TemporaryDirectory(prefix=".tmp-", dir=directory) as temporary:
        scratch = Path(temporary)
        decoded = scratch / "input.wav"
        check("decoding")
        run_process([shutil.which("ffmpeg"), "-nostdin", "-hide_banner", "-loglevel", "error",
                     "-protocol_whitelist", "file", "-format_whitelist", "mp3,wav", "-threads", "1",
                     "-i", source, "-map", "0:a:0", "-vn", "-sn", "-dn", "-t", str(MAX_SECONDS + 1),
                     "-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le", "-threads", "1", decoded], check, timeout=120)
        with wave.open(str(decoded), "rb") as audio:
            duration = audio.getnframes() / audio.getframerate()
            if (audio.getnchannels(), audio.getframerate(), audio.getsampwidth()) != (2, 44100, 2) or not 0 < duration <= MAX_SECONDS:
                raise AnalysisError("Для разделения нужно непустое аудио до 10 минут.")
        output = scratch / "output"
        output.mkdir()
        check("separating")
        with inference_slot(check):
            run_process([*runtime_command(), "--input", decoded, "--output-dir", output,
                         "--model-dir", MODEL_ROOT, "--device", device], check, timeout=6 * 3600)
        info = json.loads((output / "result.json").read_text("utf-8"))
        if info.get("frames") != round(duration * 44100) or info.get("sampleRate") != 44100 or info.get("offsetSeconds") != 0:
            raise AnalysisError("Разделение вернуло неверную длительность или смещение.")
        sizes = {stem: (output / f"{stem}.flac").stat().st_size for stem in ("vocals", "accompaniment")}
        if min(sizes.values()) <= 0:
            raise AnalysisError("Разделение вернуло пустые дорожки.")
        check("saving")
        current = store.get(identifier)
        if (current is None or current["audio_file"] != row["audio_file"]
                or fingerprint(source_path(store, current), check) != original):
            raise AnalysisError("Исходное аудио изменилось во время разделения. Результат отброшен.")
        metadata = {"version": 1, "recipe": RECIPE, "model": "htdemucs", "generation": generation,
                    "sourceFile": row["audio_file"], "sourceFingerprint": original, "duration": duration,
                    "offsetSeconds": 0, "sampleRate": 44100, "stemBytes": sizes}
        pointer = scratch / "metadata.json"
        with pointer.open("w", encoding="utf-8") as target:
            json.dump(metadata, target, ensure_ascii=False, allow_nan=False)
            target.flush()
            os.fsync(target.fileno())
        check()
        published = directory / generation
        published.mkdir()
        try:
            # Windows/sandbox directory renames can be denied even when files
            # can be moved. The pointer, not a directory rename, is the commit.
            for name in ("vocals.flac", "accompaniment.flac"):
                (output / name).replace(published / name)
            check()
            pointer.replace(directory / "metadata.json")  # Commit marker, always last.
        except BaseException:
            shutil.rmtree(published, ignore_errors=True)
            raise
    # Previous generations are obsolete; Windows may still have an open response.
    for old in directory.iterdir():
        if old.is_dir() and old.name != generation and len(old.name) == 32 and all(c in "0123456789abcdef" for c in old.name) and old.resolve() == old:
            shutil.rmtree(old, ignore_errors=True)
    return generation


def separation_router(store_getter, jobs_getter):
    """Parent mounts once; getters resolve app.state only after lifespan startup."""
    from .jobs import QueueFull
    router = APIRouter()

    @router.get("/api/separation/status")
    def separation_status():
        return status()

    @router.get("/api/songs/{identifier}/stems")
    def get_stems(identifier: Identifier):
        return stems(store_getter(), identifier, jobs_getter())

    @router.post("/api/songs/{identifier}/separation", status_code=202)
    def enqueue(identifier: Identifier, request: Request):
        row = store_getter().get(identifier)
        if row is None:
            raise HTTPException(404, "Песня не найдена.")
        try:
            source_path(store_getter(), row)
            if not _metadata(store_getter(), row) and not status()["available"]:
                raise HTTPException(503, status()["note"])
            following = getattr(request.app.state, "following", None)
            if following is not None:
                with following.guard:
                    if following.active():
                        raise HTTPException(409, "Сначала остановите следование за голосом.")
                    return jobs_getter().enqueue(row, "separation")
            return jobs_getter().enqueue(row, "separation")
        except AnalysisError as exc:
            raise HTTPException(422, str(exc)) from exc
        except QueueFull as exc:
            raise HTTPException(429, str(exc)) from exc

    @router.get("/api/songs/{identifier}/stems/{stem}")
    def get_stem(identifier: Identifier, stem: Literal["vocals", "accompaniment"], v: str = ""):
        row = store_getter().get(identifier)
        metadata = _metadata(store_getter(), row, cached=True) if row is not None else None
        if not metadata or (v and v != metadata["generation"]):
            raise HTTPException(404, "Готовая дорожка для текущего аудио не найдена.")
        path = _directory(store_getter(), identifier) / metadata["generation"] / f"{stem}.flac"
        return FileResponse(path, media_type="audio/flac", headers={"Cache-Control": "no-store"})

    return router
