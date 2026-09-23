"""Pure-ASGI middleware: CSRF header check, error safety net and JSON access log."""

import time
from typing import Final

import structlog
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.errors import error_response
from app.core.logging import get_logger
from app.db.uuid7 import uuid7

log = get_logger("app.request")

MUTATING_METHODS: Final[frozenset[str]] = frozenset({"POST", "PUT", "PATCH", "DELETE"})
CSRF_HEADER: Final[bytes] = b"x-requested-with"
CSRF_VALUE: Final[str] = "fetch"


class CSRFHeaderMiddleware:
    """Reject mutating requests without ``X-Requested-With: fetch``.

    Browsers can't send custom headers cross-site without a CORS preflight, and the
    API allows no cross-origin requests, so the header proves the call came from our
    own frontend (together with SameSite=Lax cookies).
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["method"] in MUTATING_METHODS:
            value = next((v for k, v in scope["headers"] if k == CSRF_HEADER), None)
            if value is None or value.decode("latin-1").strip().lower() != CSRF_VALUE:
                response = error_response("CSRF_HEADER_MISSING", 403)
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)


class UnhandledErrorMiddleware:
    """Turn any uncaught exception into a 500 ``INTERNAL_ERROR`` envelope and log it once."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        response_started = False

        async def send_wrapper(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            log.exception("unhandled_error")
            if response_started:
                raise
            response = error_response("INTERNAL_ERROR", 500)
            await response(scope, receive, send)


def templated_path(scope: Scope) -> str:
    """The request path with path-parameter values replaced by ``{name}``.

    Keeps secrets that travel in paths (e.g. ``/invites/{token}``) out of the logs.
    Requests that never matched a route are logged as a placeholder, not the raw path.
    """
    if "route" not in scope and "endpoint" not in scope:
        return "<unrouted>"
    path: str = scope["path"]
    for name, value in scope.get("path_params", {}).items():
        path = path.replace(str(value), "{" + name + "}")
    return path


class AccessLogMiddleware:
    """One JSON line per request. Logs the route template, never the query string."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = uuid7().hex
        structlog.contextvars.bind_contextvars(request_id=request_id)
        start = time.perf_counter()
        status = 500

        async def send_wrapper(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                headers = list(message.get("headers", []))
                headers.append((b"x-request-id", request_id.encode()))
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            log.info(
                "request",
                method=scope["method"],
                path=templated_path(scope),
                status=status,
                duration_ms=round((time.perf_counter() - start) * 1000, 1),
            )
            structlog.contextvars.unbind_contextvars("request_id")
