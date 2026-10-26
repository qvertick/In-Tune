# In Tune backend

Python 3.12+, FastAPI, SQLite, Mutagen. Run commands from the project root.

```powershell
python -m venv backend/.venv
backend/.venv/Scripts/python -m pip install -r backend/requirements-lock.txt
backend/.venv/Scripts/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
# For tests, install the separate development requirements:
backend/.venv/Scripts/python -m pip install -r backend/requirements-dev.txt
backend/.venv/Scripts/python -m pytest backend/tests -q -o cache_dir=backend/.pytest_cache
```

`VLAD_DATA_DIR` overrides the default project-root `data/` directory. The
directory is created at application startup, containing `songs.sqlite3`,
`jobs.sqlite3`, a worker lock, and `audio/`. `VLAD_MAX_AUDIO_BYTES` sets the raw
upload limit (default 52428800, 50 MiB). Transcription is optional and uses a local
Whisper tiny model only; base installation never downloads or installs it.
See [MODELS.md](MODELS.md) for explicit setup, verified sizes and licenses.
Health returns `dataDir`, `ffmpeg`, `providerAvailable`, `providerVersion`,
`modelInstalled`, and `harmonyAvailable`. These are package/file-presence checks,
not an inference smoke test. `transcription` is `uninstalled`, `missing_model`,
or `installed`; the last requires both provider metadata and all required,
nonempty model files. `harmonyAvailable` requires NumPy discovery and FFmpeg on PATH.
API docs: `/docs`; JSON Schema: `/openapi.json`. API errors are in Russian.

| Method | Path | Result |
| --- | --- | --- |
| GET | `/api/health` | Status and schema version |
| GET | `/api/songs` | Full Song documents |
| POST | `/api/songs` | Create the supplied UUID, 201; duplicate 409 |
| GET | `/api/songs/{id}` | One Song |
| PUT | `/api/songs/{id}` | Replace existing Song; path/body IDs must match |
| DELETE | `/api/songs/{id}` | Delete Song and uploaded file, 204 |
| GET | `/api/songs/{id}/export` | Song JSON attachment |
| POST | `/api/import` | Validate Song and create copy, 201 |
| PUT | `/api/songs/{id}/audio?filename=track.mp3` | Raw MP3 body; returns updated Song |
| GET | `/api/songs/{id}/audio` | FileResponse, audio/mpeg, byte ranges |
| POST | `/api/songs/{id}/analysis?kind=transcription` | Queue transcription, 202; default kind |
| POST | `/api/songs/{id}/analysis?kind=chords` | Queue independent experimental chord analysis, 202 |
| GET | `/api/jobs?limit=100&offset=0` | Newest jobs first; limit 1..100 |
| POST | `/api/jobs/{id}/cancel` | Request cooperative cancellation; return job |
| GET | `/api/jobs/{id}/result` | Completed draft Song; 409 if unavailable, 404 if job unknown |
| POST | `/api/jobs/{id}/import-result` | Create independent Song and audio copy, 201; no body |

Missing songs/audio return 404. Invalid documents return 422. Imports generate
only a new song UUID and updatedAt, preserve nested IDs, and set audio to null
when using generic `/api/import`. To retain analysis audio, use the dedicated
`/api/jobs/{id}/import-result` endpoint. It copies the job's saved internal MP3
into a new UUID file using `shutil.copyfile`; it never fetches a document URL.
The new Song's audio URL points to its own file and survives original-song
deletion. If that exact source file was removed or replaced, import still
succeeds with `audio: null`. `X-Analysis-Audio` is `copied` or `unavailable`.
Failed imports clean up newly created files and rows. Repeating an import
explicitly creates another independent copy.
CRUD preserves supplied UUIDs and updatedAt; upload refreshes updatedAt.

Schema v1 rejects unknown fields, coercion, noncanonical UUIDs, duplicate entity
IDs, missing palette references, invalid offsets, nonfinite/negative times,
out-of-range performance values, and timestamps without a timezone. Optional
fields are omitted rather than null; `audio` is required and nullable. Chord
offsets count Unicode code points, matching frontend `Array.from(text)`, including
the position immediately after the last character. An end time requires a start
and cannot precede it. `words` contains strict `{text, start, end}` objects, with
nonnegative finite times and end >= start. Palette chord names use the same
limited regex as frontend `normalizeChord`; roots/bass are capitalized and
Unicode accidentals normalize to ASCII `#`/`b`.
Documents otherwise follow the frontend camelCase names exactly.
`Line.source` (`manual`/`model`), `Line.manuallyEdited` (boolean), and
`Chord.manuallyEdited` (boolean) are optional schema-v1 fields. Older documents
remain valid; omitted fields remain omitted, while explicit nulls are rejected.
Generated lines use `source: "model"`; edit flags are preserved on import.

Limits: title/artist/section name 200 characters; line/word text 10000;
200 palette entries and 200 sections; 2000 lines total; 2000 chords or words
per line, 20000 chords total. Performance values are integers: fontSize 16..60,
bpm 30..240, beats 1..12. Non-audio POST/PUT/PATCH bodies have a hard 2 MiB
limit, enforced on declared and actual bytes, including chunked input.
Before completion, each analysis result is validated as a Song and must fit
within **2,000,000 UTF-8 bytes** of serialized JSON, matching the editor's
conservative save limit. Larger results fail with a Russian error and cannot
be imported; shorten the audio or existing text and retry.

## Analysis jobs

Use one Uvicorn worker. An OS file lock prevents a second process from running
analysis against the same data directory. A SQLite FIFO feeds one worker thread;
at most 32 jobs may be active. The active-song uniqueness rule spans both kinds:
a duplicate request returns that song's existing active job, including its kind.

Job metadata contains `id`, `songId`, `kind`, `status`, `statusLabel`, `stage`,
`stageLabel`, `createdAt`, `startedAt`, `finishedAt`, `cancelRequested`, `error`,
and `resultAvailable`. Status values are `queued`, `running`, `completed`,
`failed`, and `cancelled`; display labels/errors are Russian. Actual persisted
stages are `decoding`, then `transcribing` or `harmony`, then `saving`, without
percentages. Queued/legacy jobs have a null stage; terminal jobs retain their
last stage. Database migrations add stage/kind without removing existing jobs;
legacy kinds default to `transcription`.

Queued jobs resume on startup. Interrupted running jobs become failed (or
cancelled if cancellation was requested); they are not silently retried.
Cancellation is cooperative: FFmpeg is killed and reaped, while native Whisper
inference finishes its current generation step before the worker releases its
temporary resources. A cancelled job never publishes a result.

Both kinds safely decode local audio to temporary mono 16 kHz 16-bit PCM WAV.
Decoding has a 120-second timeout and a ten-minute audio limit. Transcription
uses one cached CPU int8 model, two CPU threads and one model worker, with
`local_files_only=True`. There are no implicit model downloads, confidence
placeholders or automatic writes to the original song. Its manual content is
retained in a separate draft, with a new transcription section.

Chord analysis needs NumPy and FFmpeg, not Whisper. It is an experimental
24-triad baseline with approximate timestamps, not lyric alignment or a full
arrangement. One timeline line is added per interval; known intervals get one
model chord each, unknown intervals get none. Existing palette entries are
reused by name. Original text, words, chords and edit flags are preserved.

MP3 requests are streamed to temporary files with both Content-Length and
actual-byte limits (413). Mutagen must parse MPEG audio frames (422 otherwise).
Files receive generated UUID filenames; the display filename is never a path.
Failed uploads preserve existing audio and clean temporary files. Replacement,
deletion, and PUT with audio=null remove the previous uploaded file. Supplied
audio metadata is preserved on CRUD but does not grant access to filesystem
paths; only this server's uploads are served. There is no multipart dependency.
If Windows locks an obsolete file during a concurrent download, cleanup logs a
warning and may leave that obsolete UUID file; the committed update still succeeds.
Upload metadata URLs include `?v={stored_name}` so replacing audio, even with
the same display filename, causes the player to reload.

Existing `frontend/dist` assets are served on the same origin, with index.html
fallback for frontend routes. Unknown `/api` paths return 404. No frontend build
is required to run the API. Intended for local use; no authentication is included.

## Local verification

Dependencies may also be isolated with
`python -m pip install --target backend/.deps -r backend/requirements-dev.txt`.
Set `$env:PYTHONPATH = "$PWD/backend/.deps"` before running
Python in that case. See `VERIFICATION.md` for the recorded validation run.
