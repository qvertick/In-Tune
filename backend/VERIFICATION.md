# Local verification — 2026-10-25

Environment: Windows, local Python 3.12.0. Dependencies installed successfully
in `backend/.deps` with `python -m pip install --target backend/.deps -r requirements.txt`.
Initial sandbox network access failed; the approved network-enabled installation
succeeded. Global Python packages were not replaced. Pip reported existing
environment conflicts involving aiogram/mitmproxy; neither is used by this
backend, and the application/test dependencies are isolated in `.deps`.

Resolved main versions: FastAPI 0.136.3, Pydantic 2.14.1, Starlette 1.10.0,
Uvicorn 0.47.0, Mutagen 1.48.1, HTTPX 0.28.1, pytest 9.1.1.

```powershell
$env:PYTHONPATH = "$PWD/backend/.deps"
python -m pytest backend/tests -q -o cache_dir=backend/.pytest_cache
```

Result: **88 passed, 1 warning in 12.94s**. The warning is Starlette's
deprecation notice for its HTTPX TestClient integration; it does not affect
the assertions or the Uvicorn application.

Tests cover full CRUD and export/import; stable nested UUIDs; strict fields,
types, ranges, reference integrity, code point offsets and word timestamps;
frontend chord normalization/invalid chord vectors; Russian errors; finite
numbers; declared/chunked 2 MiB JSON limits; MP3 parsing with actual MPEG frames
(not a mocked validator); safe filenames; declared/chunked upload limits;
failed upload preservation and cleanup; replacement/deletion; simulated Windows
file locks; FileResponse byte ranges; complete document and audio persistence
across app restarts; environment settings; FFmpeg availability probes; static
SPA fallback and API/path traversal exclusions.

No transcription models or FFmpeg binaries were downloaded. Transcription
remains `uninstalled`. Edits are confined to `backend/` and `requirements.txt`.
