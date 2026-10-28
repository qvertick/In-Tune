"""Small transactional SQLite document store."""
import json
import logging
import sqlite3
import shutil
from contextlib import contextmanager
from pathlib import Path

from .schema import Song
from .migrations import migrate_storage


class Store:
    def __init__(self, root: Path):
        self.root = root
        self.audio = root / "audio"
        self.audio.mkdir(parents=True, exist_ok=True)
        self.database = root / "songs.sqlite3"
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("CREATE TABLE IF NOT EXISTS songs (id TEXT PRIMARY KEY, document TEXT NOT NULL, audio_file TEXT)")
            migrate_storage(db)

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
    def encode(song: Song):
        return json.dumps(song.model_dump(exclude_unset=True), ensure_ascii=False, allow_nan=False)

    def list(self):
        with self.connect() as db:
            return [json.loads(row[0]) for row in db.execute("SELECT document FROM songs ORDER BY json_extract(document, '$.updatedAt') DESC, id")]

    def get(self, identifier: str):
        with self.connect() as db:
            return db.execute("SELECT * FROM songs WHERE id = ?", (identifier,)).fetchone()

    def create(self, song: Song):
        with self.connect() as db:
            db.execute("INSERT INTO songs(id, document) VALUES (?, ?)", (song.id, self.encode(song)))

    def update(self, song: Song):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            old = db.execute("SELECT audio_file FROM songs WHERE id = ?", (song.id,)).fetchone()
            if old is None:
                return False
            db.execute("UPDATE songs SET document = ?, audio_file = ? WHERE id = ?", (self.encode(song), old[0] if song.audio else None, song.id))
        if not song.audio:
            self.unlink(old[0])
        return True

    def delete(self, identifier: str):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            old = db.execute("SELECT audio_file FROM songs WHERE id = ?", (identifier,)).fetchone()
            if old is None:
                return False
            db.execute("DELETE FROM songs WHERE id = ?", (identifier,))
        self.unlink(old[0])
        # UUIDs are validated by the API; still verify the resolved boundary
        # before removing optional generated files (never follow a symlink).
        stems_root = self.root / 'stems'
        stems = stems_root / identifier
        if (stems.is_dir() and not stems.is_symlink() and
                stems.resolve().parent == stems_root.resolve() and
                stems_root.resolve().parent == self.root.resolve()):
            try:
                shutil.rmtree(stems)
            except OSError:
                logging.getLogger(__name__).warning('Could not remove obsolete stems for %s', identifier, exc_info=True)
        return True

    def set_audio(self, identifier: str, filename: str, metadata: dict, updated_at: str):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM songs WHERE id = ?", (identifier,)).fetchone()
            if row is None:
                return None
            song = Song.model_validate(json.loads(row["document"]))
            document = song.model_dump(exclude_unset=True)
            if row['audio_file']:
                for section in document['sections']:
                    for line in section['lines']:
                        if 'start' in line or line.get('words'):
                            line['timingReview'] = True
            song = Song.model_validate({**document, "audio": metadata, "updatedAt": updated_at})
            db.execute("UPDATE songs SET document = ?, audio_file = ? WHERE id = ?", (self.encode(song), filename, identifier))
        self.unlink(row["audio_file"])
        return song

    def unlink(self, filename):
        if filename:
            try:
                (self.audio / filename).unlink(missing_ok=True)
            except OSError:
                # Windows can lock an audio file during a concurrent download.
                # Cleanup must not turn an already committed transaction into
                # a failed request (or delete the newly uploaded file).
                logging.getLogger(__name__).warning("Could not remove obsolete audio file %s", filename, exc_info=True)
