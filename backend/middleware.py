"""Bound JSON input even when Content-Length is missing or misleading."""
import re

from starlette.responses import JSONResponse

JSON_LIMIT = 2 * 1024 * 1024


class JsonBodyLimit:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] not in {"POST", "PUT", "PATCH"} or (
            scope["method"] == "PUT" and re.fullmatch(r"/api/songs/[^/]+/audio", scope["path"])
        ):
            return await self.app(scope, receive, send)
        headers = dict(scope["headers"])
        try:
            declared = int(headers.get(b"content-length", b"0"))
            if declared < 0:
                raise ValueError
        except ValueError:
            return await JSONResponse({"detail": "Недопустимый Content-Length"}, status_code=400)(scope, receive, send)
        if declared > JSON_LIMIT:
            return await self.too_large(scope, receive, send)
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            if len(body) + len(chunk) > JSON_LIMIT:
                return await self.too_large(scope, receive, send)
            body.extend(chunk)
            if not message.get("more_body", False):
                break
        delivered = False

        async def replay():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()

        await self.app(scope, replay, send)

    async def too_large(self, scope, receive, send):
        await JSONResponse({"detail": "Размер JSON превышает 2 МБ"}, status_code=413)(scope, receive, send)
