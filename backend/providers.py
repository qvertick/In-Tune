"""Optional offline transcription. Base requirements deliberately exclude faster-whisper.

Opt in manually: python -m pip install -r backend/requirements-audio.txt
Then explicitly download: python -m backend.providers --install-model
Place a complete Systran/faster-whisper-tiny CTranslate2 snapshot in
<project>/models/whisper-tiny (including tokenizer.json). Nothing downloads here.
Sources: https://github.com/SYSTRAN/faster-whisper
https://huggingface.co/Systran/faster-whisper-tiny (MIT model card)
https://opennmt.net/CTranslate2/quantization.html
"""
from pathlib import Path
from importlib import metadata
from threading import Lock
from uuid import uuid4

from .audio import AnalysisError

MODEL_PATH = Path(__file__).resolve().parents[1] / "models" / "whisper-tiny"
MODEL_FILES = ("model.bin", "config.json", "tokenizer.json", "vocabulary.txt")
_lock = Lock()
_model = None


def provider_health():
    """Metadata/file-presence checks only; does not import inference libraries.

    These flags describe installation, not whether native inference will work.
    """
    try:
        provider_version = metadata.version("faster-whisper")
    except metadata.PackageNotFoundError:
        provider_version = None
    try:
        model_installed = all((MODEL_PATH / name).is_file() and (MODEL_PATH / name).stat().st_size > 0
                              for name in MODEL_FILES)
    except OSError:
        model_installed = False
    return {"providerAvailable": provider_version is not None,
            "providerVersion": provider_version, "modelInstalled": model_installed}


def _load_model():
    global _model
    if _model is not None:
        return _model
    if not all((MODEL_PATH / name).is_file() for name in MODEL_FILES):
        raise AnalysisError("Локальная модель Whisper tiny отсутствует или неполна. Разместите все файлы "
                            f"Systran/faster-whisper-tiny в {MODEL_PATH}. Модель не скачивалась.")
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise AnalysisError("Не установлен необязательный пакет распознавания. Установите его явно командой "
                            "python -m pip install -r backend/requirements-audio.txt и повторите попытку.") from exc
    try:
        from .follow_provider import unload_model
        unload_model()
        _model = WhisperModel(str(MODEL_PATH), device="cpu", compute_type="int8",
                              cpu_threads=2, num_workers=1, local_files_only=True)
    except Exception as exc:
        raise AnalysisError("Не удалось загрузить локальную модель Whisper tiny. Проверьте комплектность "
                            "файлов модели и поддержку CPU int8. Скачивание не выполнялось.") from exc
    return _model


def transcribe(audio, language, check):
    # Also serialize inference across app instances using different data directories.
    while not _lock.acquire(timeout=0.1):
        check()
    try:
        check()
        model = _load_model()
        check()
        segments, _ = model.transcribe(str(audio), language=language, beam_size=1, best_of=1,
                                       temperature=0, word_timestamps=True, vad_filter=False,
                                       condition_on_previous_text=False)
        lines = []
        try:
            for segment in segments:
                check()
                text = segment.text.strip()
                if not text:
                    continue
                if len(lines) >= 2000 or len(text) > 10000 or len(segment.words or []) > 2000:
                    raise AnalysisError("Распознанный текст превышает ограничения документа песни. Сократите аудио.")
                line = {"id": str(uuid4()), "text": text, "chords": [], "start": float(segment.start),
                        "source": "model"}
                if segment.words:
                    line["words"] = [{"text": word.word, "start": float(word.start), "end": float(word.end)}
                                     for word in segment.words]
                lines.append(line)
        finally:
            close = getattr(segments, "close", None)
            if close:
                close()
        check()
        return lines
    finally:
        _lock.release()


def install_model(revision="main"):
    """Explicit CLI opt-in only; never called by the server or provider loader.

    Download API: https://huggingface.co/docs/huggingface_hub/guides/download
    Stage first, so inference cannot see a partially downloaded model.
    """
    from tempfile import TemporaryDirectory

    if MODEL_PATH.exists():
        raise AnalysisError(f"Папка модели уже существует: {MODEL_PATH}. Переместите её перед установкой.")
    try:
        from huggingface_hub import snapshot_download
    except ImportError as exc:
        raise AnalysisError("Сначала установите необязательные пакеты: python -m pip install -r backend/requirements-audio.txt") from exc
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix="whisper-install-", dir=MODEL_PATH.parent) as staging:
        target = Path(staging) / "model"
        snapshot_download(repo_id="Systran/faster-whisper-tiny", revision=revision,
                          local_dir=str(target), max_workers=1,
                          allow_patterns=[*MODEL_FILES, "preprocessor_config.json", "README.md", "LICENSE*"])
        if not all((target / name).is_file() for name in MODEL_FILES):
            raise AnalysisError("Скачанный комплект файлов неполон. Модель не установлена.")
        target.rename(MODEL_PATH)
    return MODEL_PATH


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Явная установка необязательной локальной модели Whisper tiny (MIT).")
    parser.add_argument("--install-model", action="store_true", help="Скачать Systran/faster-whisper-tiny в models/whisper-tiny")
    parser.add_argument("--revision", default="main", help="Необязательный хеш коммита или тег модели")
    args = parser.parse_args()
    if not args.install_model:
        parser.print_help()
    else:
        try:
            print(install_model(args.revision))
        except AnalysisError as exc:
            parser.exit(1, str(exc) + "\n")
