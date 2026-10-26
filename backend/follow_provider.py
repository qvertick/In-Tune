"""Small offline Vosk provider. Model() always receives an explicit local path."""
import argparse
import gc
from importlib import metadata
import json
from pathlib import Path
import shutil
import tempfile
from urllib.request import urlopen
import zipfile

from .audio import AnalysisError, Cancelled
from . import providers

MODEL_ROOT = Path(__file__).resolve().parents[1] / 'models'
MODELS = {
    'ru': {'name': 'vosk-model-small-ru-0.22', 'sizeMB': 45},
    'uk': {'name': 'vosk-model-small-uk-v3-nano', 'sizeMB': 73},
    'en': {'name': 'vosk-model-small-en-us-0.15', 'sizeMB': 40},
}
_model = None
_language = None


def model_ready(language):
    path = MODEL_ROOT / MODELS[language]['name']
    try:
        return all((path / name).is_file() and (path / name).stat().st_size > 0
                   for name in ('am/final.mdl', 'conf/model.conf')) and (path / 'graph').is_dir()
    except OSError:
        return False


def status():
    try:
        version = metadata.version('vosk')
    except metadata.PackageNotFoundError:
        version = None
    return {'provider': 'vosk', 'version': version, 'sampleRate': 16000,
            'models': {lang: {**spec, 'installed': model_ready(lang),
                             'command': f'powershell -ExecutionPolicy Bypass -File .\\install-follow.ps1 -Language {lang}'}
                       for lang, spec in MODELS.items()}}


def require_ready(language):
    if language not in MODELS:
        raise AnalysisError('Поддерживаются русский, украинский и английский языки.')
    spec = status()
    if not spec['version'] or not spec['models'][language]['installed']:
        raise AnalysisError('Для следования установите Vosk и выбранную модель: ' + spec['models'][language]['command'])


def unload_model():
    global _model, _language
    _model, _language = None, None
    gc.collect()


def recognize(pcm, language, check):
    """PCM s16le / mono / 16 kHz; serialized with the existing batch provider."""
    global _model, _language
    while not providers._lock.acquire(timeout=0.1):
        check()
    try:
        check()
        require_ready(language)
        try:
            from vosk import Model, KaldiRecognizer, SetLogLevel
            if _model is None or _language != language:
                unload_model()
                # Only one acoustic model is retained, even across providers.
                providers._model = None
                gc.collect()
                SetLogLevel(-1)
                _model = Model(str(MODEL_ROOT / MODELS[language]['name']))
                _language = language
            check()
            recognizer = KaldiRecognizer(_model, 16000)
            recognizer.SetWords(True)
            words = []
            try:
                for start in range(0, len(pcm), 6400):
                    check()
                    if recognizer.AcceptWaveform(pcm[start:start + 6400]):
                        words.extend(json.loads(recognizer.Result()).get('result', []))
                words.extend(json.loads(recognizer.FinalResult()).get('result', []))
            finally:
                del recognizer
            check()
            # conf is Vosk's word score, not an application confidence percentage.
            return [word for word in words if word.get('conf', 0) >= 0.45]
        except (AnalysisError, Cancelled):
            raise
        except Exception as exc:
            raise AnalysisError('Не удалось распознать звук локальной моделью Vosk. Проверьте установку и журнал сервера.') from exc
    finally:
        providers._lock.release()


class StreamRecognizer:
    """Persistent decoder; native timestamps are translated to the capture sample clock."""
    def __init__(self, language, retain_all=False):
        self.language = language
        self.retain_all = retain_all
        self.recognizer = None
        self.origin = 0
        self.next_sample = None
        self.final_words = []

    def close(self):
        self.recognizer = None
        self.final_words = []
        self.next_sample = None

    def feed(self, pcm, start_sample, check):
        global _model, _language
        while not providers._lock.acquire(timeout=.1):
            check()
        try:
            check()
            require_ready(self.language)
            from vosk import Model, KaldiRecognizer, SetLogLevel
            if _model is None or _language != self.language:
                self.close()
                unload_model(); providers._model = None; gc.collect()
                SetLogLevel(-1)
                _model = Model(str(MODEL_ROOT / MODELS[self.language]['name']))
                _language = self.language
            if self.recognizer is None or self.next_sample != start_sample:
                self.recognizer = KaldiRecognizer(_model, 16000)
                self.recognizer.SetWords(True)
                self.recognizer.SetPartialWords(True)
                self.origin = start_sample / 16000
                self.final_words = []
            for start in range(0, len(pcm), 6400):
                check()
                if self.recognizer.AcceptWaveform(pcm[start:start + 6400]):
                    self.final_words.extend(self._words(json.loads(self.recognizer.Result()).get('result', [])))
            if not self.retain_all:
                self.final_words = self.final_words[-24:]
            partial = self._words(json.loads(self.recognizer.PartialResult()).get('partial_result', []))
            self.next_sample = start_sample + len(pcm) // 2
            check()
            return (self.final_words[-24:] + partial)[-24:]
        except (Cancelled, AnalysisError):
            self.close()
            raise
        except Exception as exc:
            self.close()
            raise AnalysisError('Ошибка потокового Vosk. Проверьте локальную модель и журнал сервера.') from exc
        finally:
            providers._lock.release()

    def _words(self, words):
        return [{**w, 'start': w['start'] + self.origin, 'end': w['end'] + self.origin}
                for w in words if w.get('conf', 0) >= .45]

    def finish(self, check):
        with providers._lock:
            check()
            if self.recognizer:
                self.final_words.extend(self._words(json.loads(self.recognizer.FinalResult()).get('result', [])))
            return list(self.final_words)


def install_model(language):
    spec = MODELS[language]
    MODEL_ROOT.mkdir(parents=True, exist_ok=True)
    destination = MODEL_ROOT / spec['name']
    if destination.exists():
        if model_ready(language):
            print(f'Already installed: {destination}')
            return destination
        raise AnalysisError(f'Неполная папка модели: {destination}. Переместите её перед повторной установкой.')
    url = f"https://alphacephei.com/vosk/models/{spec['name']}.zip"
    print(f"Official catalog size: about {spec['sizeMB']} MB. Downloading only {spec['name']}.", flush=True)
    with tempfile.TemporaryDirectory(prefix='vosk-install-', dir=MODEL_ROOT) as temporary:
        root = Path(temporary)
        archive = root / 'download.zip'
        with urlopen(url, timeout=60) as response, archive.open('wb') as target:
            declared = response.headers.get('Content-Length')
            print(f'Archive Content-Length: {declared or "unknown"} bytes', flush=True)
            total = 0
            while chunk := response.read(1024 * 1024):
                total += len(chunk)
                if total > 200 * 1024 * 1024:
                    raise AnalysisError('Архив превышает ожидаемый предел 200 МиБ.')
                target.write(chunk)
        with zipfile.ZipFile(archive) as bundle:
            if sum(item.file_size for item in bundle.infolist()) > 500 * 1024 * 1024:
                raise AnalysisError('Распакованная модель превышает 500 МиБ.')
            for item in bundle.infolist():
                path = (root / item.filename).resolve()
                if not path.is_relative_to(root.resolve()) or '\\' in item.filename:
                    raise AnalysisError('Недопустимый путь в архиве модели.')
                if item.is_dir():
                    path.mkdir(parents=True, exist_ok=True)
                else:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    with bundle.open(item) as source, path.open('wb') as target:
                        shutil.copyfileobj(source, target)
        staged = root / spec['name']
        if not (staged / 'am/final.mdl').is_file() or not (staged / 'graph').is_dir():
            raise AnalysisError('Архив не содержит ожидаемую модель Vosk.')
        staged.rename(destination)
        print(f'Installed {total} archive bytes -> {destination}', flush=True)
    return destination


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Explicitly install one Vosk small language model.')
    parser.add_argument('--install-model', choices=MODELS, required=True)
    args = parser.parse_args()
    try:
        install_model(args.install_model)
    except (OSError, AnalysisError, zipfile.BadZipFile) as error:
        parser.exit(1, str(error) + '\n')
