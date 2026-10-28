"""Additive SQLite storage migrations; song JSON keeps the version-one contract."""
STORAGE_VERSION = 1


def migrate_storage(database):
    version = database.execute('PRAGMA user_version').fetchone()[0]
    if version > STORAGE_VERSION:
        raise RuntimeError('Эта база создана более новой версией приложения. Файлы не изменены; используйте подходящую версию.')
    if version == 0:
        # Existing document/audio columns stay intact. Origins are optional JSON
        # fields, so no content rewrite or lossy default conversion is necessary.
        database.execute('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)')
        database.execute('INSERT OR IGNORE INTO schema_migrations(version) VALUES (1)')
        database.execute('PRAGMA user_version = 1')
