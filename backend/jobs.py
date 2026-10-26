"""SQLite FIFO with one process owner and one cooperative worker per data directory.

Running work becomes failed/interrupted on restart; queued work resumes. Results
are immutable Song drafts, never writes to Store. Run uvicorn with one worker.
"""
import json
import logging
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from threading import Event, Thread
from uuid import uuid4

from .audio import AnalysisError, Cancelled, decode_audio
from .providers import transcribe
from .schema import Song


def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class QueueFull(Exception):
    pass


SUMMARY = "id, song_id, kind, status, stage, created_at, started_at, finished_at, cancel_requested, error, (result IS NOT NULL) AS result_available"
STATUS_LABELS = {"queued": "В очереди", "running": "Выполняется", "completed": "Завершено",
                 "failed": "Ошибка", "cancelled": "Отменено"}
STAGE_LABELS = {"decoding": "Декодирование аудио", "transcribing": "Распознавание текста",
                "harmony": "Анализ аккордов", "saving": "Сохранение черновика"}


def analyze(song, source, check):
    check("decoding")
    with decode_audio(source, check) as wav:
        check("transcribing")
        lines = transcribe(wav, song["language"], check)
    check()
    if not lines:
        raise AnalysisError("Речь не распознана. Черновик не создан.")
    check("saving")
    # Preserve every original line, chord, and setting in the separate draft.
    draft = {**song, "id": str(uuid4()), "source": "model", "updatedAt": now(),
             "sections": [*song["sections"], {"id": str(uuid4()), "name": "Распознанный текст",
                                               "lines": lines}]}
    try:
        return Song.model_validate(draft)
    except ValueError as exc:
        raise AnalysisError("Распознанный текст вместе с исходным содержимым превышает ограничения песни или содержит неверные временные метки.") from exc


def analyze_harmony(song, source, check):
    """Independent chord draft; harmony returns a copied Song dict, not counts."""
    check("decoding")
    with decode_audio(source, check) as wav:
        check("harmony")
        try:
            from . import harmony
        except ImportError as exc:
            raise AnalysisError("Для анализа аккордов нужен NumPy. Установите зависимости backend/requirements-lock.txt.") from exc
        try:
            intervals = harmony.analyze_chords(wav, check)
            check("saving")
            draft = harmony.attach_intervals(song, intervals)
        except AnalysisError as exc:
            messages = {
                "Chord analysis requires mono 16 kHz 16-bit PCM WAV.": "Для анализа аккордов требуется монофонический PCM WAV: 16 кГц, 16 бит.",
                "Chord analysis requires nonempty audio up to 10 minutes.": "Для анализа аккордов требуется непустое аудио длительностью до 10 минут.",
                "Truncated PCM WAV data during chord analysis.": "Аудиоданные WAV обрезаны. Загрузите полный файл и повторите анализ.",
                "Could not read PCM WAV for chord analysis.": "Не удалось прочитать WAV для анализа аккордов.",
                "Invalid chord interval.": "Получен недопустимый интервал аккорда.",
                "Chord timeline exceeds the v1 line limit.": "Шкала аккордов превышает ограничение количества строк песни.",
                "Chord timeline exceeds v1 document limits.": "Шкала аккордов вместе с исходным содержимым превышает ограничения документа песни.",
            }
            raise AnalysisError(messages.get(str(exc), str(exc))) from exc
    check()
    draft.update(id=str(uuid4()), source="model", updatedAt=now())
    if len(draft["sections"]) > len(song["sections"]):
        draft["sections"][-1]["name"] = "Экспериментальная шкала аккордов"
    try:
        return Song.model_validate(draft)
    except ValueError as exc:
        raise AnalysisError("Результат анализа аккордов не соответствует формату документа песни.") from exc


class Jobs:
    def __init__(self, store, processor=None, *, autostart=True):
        self.store = store
        self.database = store.root / "jobs.sqlite3"
        self.processor = processor
        self.stop = Event()
        self.wake = Event()
        self.thread = None
        self.owner = (store.root / "jobs.lock").open("a+b")
        # File locks are released by the OS after a crash. Never let a second
        # process mark a live worker's running jobs as interrupted.
        try:
            if os.name == "nt":
                import msvcrt
                if self.owner.seek(0, 2) == 0:
                    self.owner.write(b"0")
                    self.owner.flush()
                self.owner.seek(0)
                msvcrt.locking(self.owner.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.owner, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            self.owner.close()
            raise RuntimeError("В этой папке данных уже работает обработчик анализа. Используйте один процесс сервера.") from exc
        try:
            with self.connect() as db:
                db.execute("PRAGMA journal_mode=WAL")
                db.execute("""CREATE TABLE IF NOT EXISTS jobs (
                    seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
                    song_id TEXT NOT NULL, status TEXT NOT NULL,
                    created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
                    cancel_requested INTEGER NOT NULL DEFAULT 0, error TEXT,
                    document TEXT NOT NULL, audio_file TEXT NOT NULL, result TEXT, stage TEXT,
                    kind TEXT NOT NULL DEFAULT 'transcription')""")
                # Additive migration for databases written before stage reporting.
                if "stage" not in {row["name"] for row in db.execute("PRAGMA table_info(jobs)")}:
                    db.execute("ALTER TABLE jobs ADD COLUMN stage TEXT")
                if "kind" not in {row["name"] for row in db.execute("PRAGMA table_info(jobs)")}:
                    db.execute("ALTER TABLE jobs ADD COLUMN kind TEXT NOT NULL DEFAULT 'transcription'")
                db.execute("CREATE UNIQUE INDEX IF NOT EXISTS active_song ON jobs(song_id) WHERE status IN ('queued', 'running')")
                db.execute("""UPDATE jobs SET status = CASE WHEN cancel_requested THEN 'cancelled' ELSE 'failed' END,
                    error = CASE WHEN cancel_requested THEN NULL ELSE 'Анализ прерван перезапуском сервера. Запустите его снова.' END,
                    finished_at = ? WHERE status = 'running'""", (now(),))
            if autostart:
                self.start()
        except BaseException:
            self.owner.close()
            raise

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.database, timeout=30)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def public(row):
        return {"id": row["id"], "songId": row["song_id"], "kind": row["kind"], "status": row["status"],
                "statusLabel": "Отмена…" if row["cancel_requested"] and row["status"] == "running" else STATUS_LABELS[row["status"]],
                "stage": row["stage"], "stageLabel": STAGE_LABELS.get(row["stage"]),
                "createdAt": row["created_at"], "startedAt": row["started_at"],
                "finishedAt": row["finished_at"], "cancelRequested": bool(row["cancel_requested"]),
                "error": row["error"], "resultAvailable": bool(row["result_available"])}

    def get(self, identifier):
        with self.connect() as db:
            row = db.execute(f"SELECT {SUMMARY} FROM jobs WHERE id = ?", (identifier,)).fetchone()
        return self.public(row) if row else None

    def has_active(self):
        with self.connect() as db:
            return db.execute("SELECT 1 FROM jobs WHERE status IN ('queued','running') LIMIT 1").fetchone() is not None

    def list(self, limit=100, offset=0):
        with self.connect() as db:
            return [self.public(row) for row in db.execute(
                f"SELECT {SUMMARY} FROM jobs ORDER BY seq DESC LIMIT ? OFFSET ?", (limit, offset))]

    def result(self, identifier):
        with self.connect() as db:
            row = db.execute("SELECT result FROM jobs WHERE id = ?", (identifier,)).fetchone()
        return json.loads(row[0]) if row and row[0] else None

    def source_snapshot(self, identifier):
        """Internal audio reference and metadata; never resolve a document URL."""
        with self.connect() as db:
            row = db.execute("SELECT audio_file, document FROM jobs WHERE id = ?", (identifier,)).fetchone()
        return {"audio_file": row["audio_file"], "song": json.loads(row["document"])} if row else None

    def enqueue(self, row, kind="transcription"):
        if kind not in ("transcription", "chords", "timing"):
            raise AnalysisError("Неизвестный вид анализа. Допустимы transcription и chords.")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            active = db.execute(f"SELECT {SUMMARY} FROM jobs WHERE song_id = ? AND status IN ('queued','running')", (row["id"],)).fetchone()
            if active:
                return self.public(active)
            if self.stop.is_set() or db.execute("SELECT count(*) FROM jobs WHERE status IN ('queued','running')").fetchone()[0] >= 32:
                raise QueueFull("Очередь анализа заполнена или сервер завершает работу. Повторите попытку позже.")
            source = self.store.audio / (row["audio_file"] or "")
            if not row["audio_file"] or not source.is_file():
                raise AnalysisError("Перед началом анализа загрузите аудио.")
            identifier = str(uuid4())
            db.execute("""INSERT INTO jobs(id,song_id,status,created_at,document,audio_file,kind)
                          VALUES (?,?,'queued',?,?,?,?)""",
                       (identifier, row["id"], now(), row["document"], row["audio_file"], kind))
            job = self.public(db.execute(f"SELECT {SUMMARY} FROM jobs WHERE id = ?", (identifier,)).fetchone())
        self.wake.set()
        return job

    def cancel(self, identifier):
        with self.connect() as db:
            db.execute("""UPDATE jobs SET cancel_requested = 1,
                finished_at = CASE WHEN status = 'queued' THEN ? ELSE finished_at END,
                status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE status END
                WHERE id = ? AND status IN ('queued','running')""", (now(), identifier))
        self.wake.set()
        return self.get(identifier)

    def start(self):
        if self.thread is None:
            self.thread = Thread(target=self._run, name="audio-analysis", daemon=True)
            self.thread.start()

    def close(self):
        self.stop.set()
        self.wake.set()
        if self.thread:
            # Native inference is cooperative: wait for its current generation
            # step before releasing ownership and temporary resources.
            self.thread.join()
        self.owner.close()

    def _claim(self):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM jobs WHERE status = 'queued' ORDER BY seq LIMIT 1").fetchone()
            if row:
                db.execute("UPDATE jobs SET status = 'running', started_at = ? WHERE id = ?", (now(), row["id"]))
            return row

    def _check(self, identifier, stage=None):
        if stage is not None and stage not in STAGE_LABELS:
            raise ValueError("Неизвестный этап анализа")
        with self.connect() as db:
            requested = db.execute("SELECT cancel_requested FROM jobs WHERE id = ?", (identifier,)).fetchone()[0]
            if requested:
                raise Cancelled()
            if self.stop.is_set():
                raise AnalysisError("Анализ прерван остановкой сервера. Запустите его снова.")
            if stage is not None:
                db.execute("UPDATE jobs SET stage = ? WHERE id = ? AND status = 'running' AND stage IS NOT ?",
                           (stage, identifier, stage))

    def _execute(self, row):
        identifier = row["id"]
        result, error, status = None, None, "completed"
        try:
            self._check(identifier)
            from .timing import prepare
            processor = self.processor or (prepare if row["kind"] == "timing" else analyze_harmony if row["kind"] == "chords" else analyze)
            draft = processor(json.loads(row["document"]), self.store.audio / row["audio_file"],
                              lambda stage=None: self._check(identifier, stage))
            self._check(identifier, "saving")
            result = Song.model_validate(draft).model_dump_json(exclude_unset=True)
            if len(result.encode("utf-8")) > 2_000_000:
                raise AnalysisError("Результат анализа превышает 2 000 000 байт и не сможет быть сохранён в редакторе. Сократите аудио или исходный текст и повторите анализ.")
        except Cancelled:
            status = "cancelled"
        except AnalysisError as exc:
            status, error = "failed", str(exc)
        except Exception:
            logging.getLogger(__name__).exception("Analysis job %s failed", identifier)
            status, error = "failed", "Не удалось выполнить анализ. Проверьте локальные файлы аудио и модели, а также журнал сервера, затем повторите попытку."
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            # Cancellation wins even if it arrived just after the last check.
            if db.execute("SELECT cancel_requested FROM jobs WHERE id = ?", (identifier,)).fetchone()[0]:
                status, error = "cancelled", None
            db.execute("UPDATE jobs SET status = ?, error = ?, result = ?, finished_at = ? WHERE id = ?",
                       (status, error, result if status == "completed" else None, now(), identifier))

    def _run(self):
        while not self.stop.is_set():
            self.wake.clear()
            row = self._claim()
            if row:
                self._execute(row)
            else:
                self.wake.wait(0.25)
