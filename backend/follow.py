"""One live following session, one in-flight window, no server audio backlog."""
from dataclasses import dataclass, field
import json
from threading import Event, RLock
import time
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from .audio import AnalysisError, Cancelled
from .follow_matcher import LineMatcher
from . import follow_provider
from .schema import Identifier
from .timing import TimedMatcher

RATE = 16000
MAX_BYTES = 4 * RATE * 2


class Start(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    songId: Identifier
    language: Literal['ru', 'uk', 'en']
    lineId: Identifier
    streaming: bool = False


class Position(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    lineId: Identifier
    generation: Annotated[int, Field(ge=1)]


@dataclass
class Session:
    id: str
    language: str
    matcher: LineMatcher
    stream: object = None
    timed: object = None
    stream_generation: int = -1
    generation: int = 0
    busy: bool = False
    sequence: int = -1
    touched: float = field(default_factory=time.monotonic)
    cancelled: Event = field(default_factory=Event)


def audible(pcm):
    import numpy as np
    samples = np.frombuffer(pcm, dtype='<i2').astype(np.float32) / 32768
    samples -= samples.mean()
    frames = samples[:len(samples) // 320 * 320].reshape(-1, 320)
    return len(frames) > 0 and int((np.sqrt((frames * frames).mean(axis=1)) >= 0.008).sum()) >= 8


class Following:
    def __init__(self, store, jobs):
        self.store, self.jobs = store, jobs
        self.guard = RLock()
        self.sessions = {}

    def active(self):
        for identifier, session in list(self.sessions.items()):
            if not session.busy and time.monotonic() - session.touched > 120:
                session.cancelled.set()
                if session.stream:
                    session.stream.close()
                del self.sessions[identifier]
        return bool(self.sessions)

    def get(self, identifier):
        session = self.sessions.get(identifier)
        if session is None or session.cancelled.is_set():
            raise HTTPException(404, 'Сеанс следования завершён. Включите следование снова.')
        session.touched = time.monotonic()
        return session

    def close(self):
        with self.guard:
            for session in self.sessions.values():
                session.cancelled.set()
                if session.stream and not session.busy:
                    session.stream.close()
            self.sessions.clear()

    def router(self):
        router = APIRouter(prefix='/api/follow')

        @router.get('/status')
        def status():
            return follow_provider.status()

        @router.post('/sessions', status_code=201)
        def start(body: Start):
            try:
                follow_provider.require_ready(body.language)
            except AnalysisError as exc:
                raise HTTPException(503, str(exc)) from exc
            with self.guard:
                if self.active():
                    raise HTTPException(409, 'Уже открыт сеанс следования. Остановите его в другой вкладке.')
                if self.jobs.has_active():
                    raise HTTPException(409, 'Сначала завершите или отмените фоновый анализ аудио.')
                row = self.store.get(body.songId)
                if row is None:
                    raise HTTPException(404, 'Песня не найдена.')
                lines = [line for section in json.loads(row['document'])['sections'] for line in section['lines']]
                try:
                    matcher = LineMatcher(lines, body.lineId)
                except ValueError as exc:
                    raise HTTPException(422, str(exc)) from exc
                identifier = str(uuid4())
                self.sessions[identifier] = Session(identifier, body.language, matcher,
                    stream=follow_provider.StreamRecognizer(body.language) if body.streaming else None,
                    timed=TimedMatcher(lines) if body.streaming else None)
                return {'id': identifier, 'generation': 0, 'status': 'listening'}

        @router.post('/sessions/{identifier}/position')
        def position(identifier: Identifier, body: Position):
            with self.guard:
                session = self.get(identifier)
                if body.generation <= session.generation:
                    raise HTTPException(409, 'Устаревший выбор позиции.')
                try:
                    session.matcher.reset(body.lineId, body.generation)
                except ValueError as exc:
                    raise HTTPException(422, str(exc)) from exc
                session.generation = body.generation
                if session.timed:
                    session.timed = TimedMatcher(session.matcher.lines)
                return {'generation': session.generation, 'lineId': body.lineId}

        @router.delete('/sessions/{identifier}', status_code=204)
        def stop(identifier: Identifier):
            with self.guard:
                session = self.sessions.pop(identifier, None)
                if session:
                    session.cancelled.set()
                    if session.stream and not session.busy:
                        session.stream.close()

        @router.post('/sessions/{identifier}/audio')
        async def audio(identifier: Identifier, request: Request,
                        sequence: int = Query(ge=0), generation: int = Query(ge=0),
                        startSample: int = Query(ge=0), endSample: int = Query(gt=0),
                        sampleRate: int = Query(16000, ge=16000, le=16000), channels: int = Query(1, ge=1, le=1),
                        encoding: Literal['pcm_s16le'] = Query('pcm_s16le'),
                        expectedPosition: float = Query(0, ge=0, le=86400, allow_inf_nan=False)):
            if request.headers.get('content-type', '').split(';')[0] != 'application/octet-stream':
                raise HTTPException(415, 'Ожидается PCM s16le, один канал, 16 кГц.')
            body = bytearray()
            async for chunk in request.stream():
                if len(body) + len(chunk) > MAX_BYTES:
                    raise HTTPException(413, 'Звуковое окно превышает четыре секунды.')
                body.extend(chunk)
            if not body or len(body) % 2 or len(body) != (endSample - startSample) * 2 or len(body) < RATE:
                raise HTTPException(422, 'Некорректная длина PCM или временные границы окна.')
            with self.guard:
                session = self.get(identifier)
                if generation != session.generation or sequence <= session.sequence:
                    raise HTTPException(409, 'Устаревшее звуковое окно.')
                if session.busy:
                    raise HTTPException(409, 'Предыдущее окно ещё обрабатывается. Отправляйте только свежий звук.')
                session.busy, session.sequence = True, sequence

            def check():
                if session.cancelled.is_set() or generation != session.generation:
                    raise Cancelled()

            def process():
                check()
                started = time.perf_counter()
                has_signal = audible(body)
                if session.stream:
                    if session.stream_generation != generation:
                        session.stream.close()
                        session.stream_generation = generation
                    words = session.stream.feed(bytes(body), startSample, check)
                    # Feed silence to finish utterances, but never use stale words as new evidence.
                    words = [w for w in words if w['end'] >= endSample / RATE - 4] if has_signal else []
                else:
                    words = follow_provider.recognize(bytes(body), session.language, check) if has_signal else []
                duration = (endSample - startSample) / RATE
                limit = endSample / RATE if session.stream else duration
                words = [w for w in words if 0 <= w['start'] <= w['end'] <= limit + 0.1]
                return words, round((time.perf_counter() - started) * 1000, 1)

            try:
                words, elapsed = await run_in_threadpool(process)
                with self.guard:
                    check()
                    if session.timed:
                        anchor = session.timed.match(words, expectedPosition) if elapsed <= 5000 else None
                        result = {'status': 'following' if anchor else 'uncertain' if words else 'no_voice',
                                  'lineId': session.matcher.lines[session.matcher.current]['id'], 'anchor': anchor}
                    else:
                        result = (session.matcher.response('uncertain', discarded=True) if elapsed > 5000
                                  else session.matcher.accept(words, sequence, generation, startSample, endSample))
                    return {**result, 'generation': generation, 'sequence': sequence,
                            'processingMs': elapsed, 'audioSeconds': len(body) / (RATE * 2),
                            'transcript': ' '.join(w['word'] for w in words)}
            except Cancelled as exc:
                raise HTTPException(409, 'Сеанс или позиция изменились. Старый результат отброшен.') from exc
            except AnalysisError as exc:
                raise HTTPException(503, str(exc)) from exc
            finally:
                with self.guard:
                    session.busy = False
                    if session.cancelled.is_set() and session.stream:
                        session.stream.close()

        return router
