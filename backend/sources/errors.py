"""User-safe failures: never expose upstream HTML, credentials or network internals."""


class SourceError(Exception):
    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status

