"""Run with: python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000."""
import json
import os
import shutil
import sqlite3
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from importlib.util import find_spec
from typing import Literal
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from mutagen import MutagenError
from mutagen.mp3 import MP3
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException as StarletteHTTPException

from .schema import Identifier, Song
from .storage import Store
from .middleware import JsonBodyLimit
from .audio import AnalysisError
from .jobs import Jobs, QueueFull
from .providers import provider_health
from .follow import Following

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_AUDIO_LIMIT = 50 * 1024 * 1024


def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def create_app(data_dir: str | Path | None = None, static_dir: str | Path | None = None, max_audio_bytes: int | None = None):
    root = Path(data_dir or os.environ.get("VLAD_DATA_DIR", ROOT / "data")).resolve()
    frontend = Path(static_dir or ROOT / "frontend" / "dist").resolve()
    limit = max_audio_bytes if max_audio_bytes is not None else int(os.environ.get("VLAD_MAX_AUDIO_BYTES", DEFAULT_AUDIO_LIMIT))
    if limit <= 0:
        raise ValueError("Audio size limit must be positive")

    following = Following(None, None)

    @asynccontextmanager
    async def lifespan(app):
        app.state.store = Store(root)
        app.state.jobs = Jobs(app.state.store)
        following.store, following.jobs = app.state.store, app.state.jobs
        app.state.following = following
        try:
            yield
        finally:
            app.state.following.close()
            await run_in_threadpool(app.state.jobs.close)

    app = FastAPI(title="In Tune API", version="1.0.0", lifespan=lifespan)
    app.add_middleware(JsonBodyLimit)
    app.include_router(following.router())

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException):
        detail = {"Not Found": "Ресурс не найден", "Method Not Allowed": "Метод не поддерживается", "There was an error parsing the body": "Не удалось прочитать тело запроса"}.get(str(exc.detail), exc.detail)
        return JSONResponse(status_code=exc.status_code, content={"detail": detail}, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        # Do not echo invalid input: NaN/Infinity cannot be serialized as JSON,
        # and imported documents may contain large or private payloads.
        def message(error):
            kind, context = error["type"], error.get("ctx", {})
            if kind == "value_error":
                return str(context.get("error", "Недопустимое значение"))
            messages = {
                "missing": "Обязательное поле отсутствует", "extra_forbidden": "Неизвестное поле",
                "string_type": "Ожидается строка", "int_type": "Ожидается целое число",
                "float_type": "Ожидается число", "finite_number": "Ожидается конечное число",
                "list_type": "Ожидается массив", "model_type": "Ожидается объект",
                "literal_error": f"Допустимые значения: {context.get('expected', '')}",
                "string_too_long": f"Максимальная длина: {context.get('max_length', '')}",
                "string_too_short": f"Минимальная длина: {context.get('min_length', '')}",
                "too_long": f"Слишком много элементов; максимум: {context.get('max_length', '')}",
                "greater_than_equal": f"Минимальное значение: {context.get('ge', '')}",
                "less_than_equal": f"Максимальное значение: {context.get('le', '')}",
                "json_invalid": "Некорректный JSON",
            }
            return messages.get(kind, "Недопустимое значение")

        return JSONResponse(status_code=422, content={"detail": [
            {"loc": error["loc"], "msg": message(error), "type": error["type"]}
            for error in exc.errors()
        ]})

    def store() -> Store:
        return app.state.store

    def require_song(identifier):
        row = store().get(identifier)
        if row is None:
            raise HTTPException(404, "Песня не найдена")
        return row

    @app.get("/api/health")
    def health():
        metadata = provider_health()
        transcription = ("installed" if metadata["modelInstalled"] else "missing_model") if metadata["providerAvailable"] else "uninstalled"
        ffmpeg = shutil.which("ffmpeg") is not None
        try:
            harmony_available = ffmpeg and find_spec("numpy") is not None
        except (ImportError, ValueError):
            harmony_available = False
        return {"status": "ok", "schemaVersion": 1, "transcription": transcription,
                "dataDir": str(root), "ffmpeg": ffmpeg, "harmonyAvailable": harmony_available, **metadata}

    @app.get("/api/songs", response_model=list[Song], response_model_exclude_unset=True)
    def list_songs():
        return store().list()

    @app.post("/api/songs", status_code=201, response_model=Song, response_model_exclude_unset=True)
    def create_song(song: Song):
        try:
            store().create(song)
        except sqlite3.IntegrityError as exc:
            raise HTTPException(409, "Песня с таким UUID уже существует") from exc
        return song

    @app.post("/api/import", status_code=201, response_model=Song, response_model_exclude_unset=True)
    def import_song(song: Song):
        copy = Song.model_validate({**song.model_dump(exclude_unset=True), "id": str(uuid4()), "audio": None, "updatedAt": now()})
        store().create(copy)
        return copy

    @app.get("/api/songs/{identifier}/export")
    def export_song(identifier: Identifier):
        row = require_song(identifier)
        return Response(row["document"], media_type="application/json", headers={"Content-Disposition": f'attachment; filename="{identifier}.json"'})

    @app.get("/api/songs/{identifier}", response_model=Song, response_model_exclude_unset=True)
    def get_song(identifier: Identifier):
        return json.loads(require_song(identifier)["document"])

    @app.put("/api/songs/{identifier}", response_model=Song, response_model_exclude_unset=True)
    def update_song(identifier: Identifier, song: Song):
        if identifier != song.id:
            raise HTTPException(422, "UUID в адресе и документе должны совпадать")
        if not store().update(song):
            raise HTTPException(404, "Песня не найдена")
        return song

    @app.delete("/api/songs/{identifier}", status_code=204)
    def delete_song(identifier: Identifier):
        if not store().delete(identifier):
            raise HTTPException(404, "Песня не найдена")
        return Response(status_code=204)

    @app.put("/api/songs/{identifier}/audio", response_model=Song, response_model_exclude_unset=True)
    async def upload_audio(identifier: Identifier, request: Request, filename: str = Query(..., min_length=1, max_length=255)):
        await run_in_threadpool(require_song, identifier)
        # The display name never participates in a filesystem path.
        if any(c in filename for c in '/\\\r\n\x00') or any(ord(c) < 32 for c in filename) or not filename.lower().endswith(".mp3"):
            raise HTTPException(422, "Ожидается имя MP3-файла без пути и управляющих символов")
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                size = int(content_length)
            except ValueError as exc:
                raise HTTPException(400, "Недопустимый Content-Length") from exc
            if size < 0:
                raise HTTPException(400, "Недопустимый Content-Length")
            if size > limit:
                raise HTTPException(413, "Размер MP3 превышает допустимый предел")
        stored_name = f"{uuid4()}.mp3"
        temporary = store().audio / f"{stored_name}.part"
        target = store().audio / stored_name
        committed = False
        try:
            total = 0
            with temporary.open("xb") as handle:
                async for chunk in request.stream():
                    total += len(chunk)
                    if total > limit:
                        raise HTTPException(413, "Размер MP3 превышает допустимый предел")
                    await run_in_threadpool(handle.write, chunk)
            try:
                parsed = await run_in_threadpool(MP3, temporary)
                duration = parsed.info.length
                if duration <= 0:
                    raise ValueError("Empty audio")
            except (MutagenError, ValueError, EOFError) as exc:
                raise HTTPException(422, "Тело запроса не содержит допустимый MP3-аудиопоток") from exc
            temporary.replace(target)
            song = await run_in_threadpool(store().set_audio, identifier, stored_name, {"filename": filename, "url": f"/api/songs/{identifier}/audio?v={stored_name}", "duration": duration}, now())
            if song is None:
                raise HTTPException(404, "Песня не найдена")
            committed = True
            return song
        finally:
            temporary.unlink(missing_ok=True)
            if not committed:
                target.unlink(missing_ok=True)

    @app.get("/api/songs/{identifier}/audio")
    def get_audio(identifier: Identifier):
        row = require_song(identifier)
        if not row["audio_file"] or not (store().audio / row["audio_file"]).is_file():
            raise HTTPException(404, "Аудио не найдено")
        return FileResponse(store().audio / row["audio_file"], media_type="audio/mpeg", headers={"Cache-Control": "no-cache"})

    @app.post("/api/songs/{identifier}/analysis", status_code=202)
    def start_analysis(identifier: Identifier, kind: Literal["transcription", "chords", "timing"] = Query("transcription")):
        row = require_song(identifier)
        try:
            with app.state.following.guard:
                if app.state.following.active():
                    raise HTTPException(409, 'Сначала остановите следование за голосом.')
                return app.state.jobs.enqueue(row, kind)
        except AnalysisError as exc:
            raise HTTPException(422, str(exc)) from exc
        except QueueFull as exc:
            raise HTTPException(429, str(exc)) from exc

    @app.get("/api/jobs")
    def list_jobs(limit: int = Query(100, ge=1, le=100), offset: int = Query(0, ge=0)):
        return app.state.jobs.list(limit, offset)

    @app.post("/api/jobs/{identifier}/cancel")
    def cancel_job(identifier: Identifier):
        job = app.state.jobs.cancel(identifier)
        if job is None:
            raise HTTPException(404, "Задача анализа не найдена")
        return job

    @app.get("/api/jobs/{identifier}/result", response_model=Song, response_model_exclude_unset=True)
    def analysis_result(identifier: Identifier):
        if app.state.jobs.get(identifier) is None:
            raise HTTPException(404, "Задача анализа не найдена")
        draft = app.state.jobs.result(identifier)
        if draft is None:
            raise HTTPException(409, "У задачи анализа пока нет готового черновика")
        return draft

    @app.post("/api/jobs/{identifier}/import-result", status_code=201, response_model=Song, response_model_exclude_unset=True)
    def import_analysis_result(identifier: Identifier, response: Response):
        job = app.state.jobs.get(identifier)
        if job is None:
            raise HTTPException(404, "Задача анализа не найдена")
        draft = app.state.jobs.result(identifier)
        if job["status"] != "completed" or draft is None:
            raise HTTPException(409, "У задачи анализа пока нет готового черновика")
        # Validate the stored result directly; neither document content nor
        # audio source paths come from the request body.
        copy = Song.model_validate({**draft, "id": str(uuid4()), "audio": None, "updatedAt": now()})
        snapshot = app.state.jobs.source_snapshot(identifier)
        source = (store().audio / snapshot["audio_file"]).resolve()
        if source.parent != store().audio.resolve():
            raise HTTPException(409, "Недопустимый путь исходного аудио задачи")
        stored_name = f"{uuid4()}.mp3"
        temporary = store().audio / f"{stored_name}.part"
        target = store().audio / stored_name
        created = committed = copied = False
        try:
            try:
                shutil.copyfile(source, temporary)
            except FileNotFoundError:
                # Audio replacement/deletion may have removed the job's exact
                # source. Still allow independent use of its completed draft.
                temporary.unlink(missing_ok=True)
            else:
                temporary.replace(target)
                copied = True
            store().create(copy)
            created = True
            if copied:
                metadata = {**(snapshot["song"].get("audio") or {"filename": "audio.mp3"}),
                            "url": f"/api/songs/{copy.id}/audio?v={stored_name}"}
                saved = store().set_audio(copy.id, stored_name, metadata, copy.updatedAt)
                if saved is None:
                    raise HTTPException(409, "Импортированная песня была удалена. Повторите импорт.")
                copy = saved
            committed = True
            response.headers["X-Analysis-Audio"] = "copied" if copied else "unavailable"
            return copy
        except OSError as exc:
            raise HTTPException(503, "Не удалось скопировать аудио результата. Проверьте доступ к папке данных и повторите импорт.") from exc
        finally:
            temporary.unlink(missing_ok=True)
            if not committed:
                if created:
                    store().delete(copy.id)
                target.unlink(missing_ok=True)

    @app.get("/{path:path}")
    def frontend_file(path: str):
        if path == "api" or path.startswith("api/"):
            raise HTTPException(404, "Маршрут API не найден")
        target = (frontend / path).resolve()
        if not target.is_relative_to(frontend):
            raise HTTPException(404, "Ресурс не найден")
        if target.is_file():
            return FileResponse(target)
        if (frontend / "index.html").is_file():
            return FileResponse(frontend / "index.html")
        raise HTTPException(404, "Сборка frontend не найдена")

    return app


app = create_app()
