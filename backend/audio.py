"""Bounded, cancellable local decoding; no shell or network inputs."""
import shutil
import subprocess
import time
import wave
from contextlib import contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory

MAX_SECONDS = 600


class AnalysisError(Exception):
    """Actionable analysis failure suitable for the jobs API."""


class Cancelled(Exception):
    pass


@contextmanager
def decode_audio(source: Path, check):
    check()
    executable = shutil.which("ffmpeg")
    if not executable:
        raise AnalysisError("FFmpeg не найден. Установите FFmpeg, добавьте его в PATH и повторите анализ.")
    with TemporaryDirectory(prefix="in-tune-analysis-") as temporary:
        target = Path(temporary) / "audio.wav"
        command = [executable, "-nostdin", "-hide_banner", "-loglevel", "error",
                   "-protocol_whitelist", "file", "-format_whitelist", "mp3,wav",
                   "-threads", "1", "-i", str(source.resolve()),
                   "-map", "0:a:0", "-vn", "-sn", "-dn", "-t", str(MAX_SECONDS + 1),
                   "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-threads", "1", str(target)]
        process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                   stderr=subprocess.DEVNULL,
                                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        try:
            deadline = time.monotonic() + 120
            while process.poll() is None:
                check()
                if time.monotonic() > deadline:
                    raise AnalysisError("Превышено время декодирования аудио (120 секунд).")
                time.sleep(0.05)
            check()
            if process.returncode:
                raise AnalysisError("FFmpeg не удалось декодировать этот аудиофайл.")
            with wave.open(str(target), "rb") as decoded:
                duration = decoded.getnframes() / decoded.getframerate()
                if not 0 < duration <= MAX_SECONDS:
                    raise AnalysisError("Для анализа поддерживается аудио до 10 минут. Сократите файл и повторите попытку.")
                if (decoded.getnchannels(), decoded.getframerate(), decoded.getsampwidth()) != (1, 16000, 2):
                    raise AnalysisError("FFmpeg вернул неподдерживаемый формат аудио.")
            yield target
        finally:
            if process.poll() is None:
                process.kill()
            process.wait()
