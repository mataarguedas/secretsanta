"""Stable error codes and the ``{"error": {"code", "message"}}`` envelope.

Codes are SCREAMING_SNAKE and never change once shipped: the frontend
translates them (``errors.<CODE>`` in es.json / en.json). Add every new code to
``ERROR_REGISTRY`` with a short English fallback message.
"""

from typing import Any, Final

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import get_logger

log = get_logger(__name__)

ERROR_REGISTRY: Final[dict[str, str]] = {
    "VALIDATION_ERROR": "The request is invalid.",
    "NOT_FOUND": "The requested resource was not found.",
    "METHOD_NOT_ALLOWED": "This method is not allowed for this resource.",
    "RATE_LIMITED": "Too many requests. Please try again later.",
    "INTERNAL_ERROR": "Something went wrong. Please try again.",
    "HTTP_ERROR": "The request could not be processed.",
    "CSRF_HEADER_MISSING": "The X-Requested-With header is required for this request.",
    # Auth (Prompt 6)
    "AUTH_REQUIRED": "Sign in to continue.",
    "AUTH_REFRESH_INVALID": "Your session has expired. Sign in again.",
    "AUTH_OAUTH_FAILED": "Google sign-in failed. Please try again.",
    # Events (Prompt 9)
    "EVENT_NOT_FOUND": "Event not found.",
    "HOST_ONLY": "Only the host can do this.",
    "EVENT_ALREADY_DRAWN": "The draw has already happened.",
    "EVENT_ARCHIVED": "This event is archived and read-only.",
    "EVENT_NOT_DRAWN": "The draw hasn't happened yet.",
    "EVENT_FIELD_LOCKED": "After the draw only the description, location and date can change.",
}

_STATUS_TO_CODE: Final[dict[int, str]] = {
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    422: "VALIDATION_ERROR",
    429: "RATE_LIMITED",
}


class AppError(Exception):
    """Raise from services/routers to return a stable, translatable error."""

    def __init__(self, code: str, http_status: int, **params: Any) -> None:
        if code not in ERROR_REGISTRY:
            raise ValueError(f"Unregistered error code: {code}")
        super().__init__(code)
        self.code = code
        self.http_status = http_status
        self.params = params

    @property
    def message(self) -> str:
        return ERROR_REGISTRY[self.code]


def error_payload(code: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    error: dict[str, Any] = {"code": code, "message": ERROR_REGISTRY[code]}
    if params:
        error["params"] = params
    return {"error": error}


def error_response(
    code: str,
    http_status: int,
    params: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    return JSONResponse(error_payload(code, params), status_code=http_status, headers=headers)


async def _app_error_handler(_request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, AppError):  # pragma: no cover
        raise exc
    return error_response(exc.code, exc.http_status, exc.params or None)


async def _http_exception_handler(_request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, StarletteHTTPException):  # pragma: no cover
        raise exc
    code = _STATUS_TO_CODE.get(exc.status_code, "HTTP_ERROR")
    if exc.status_code >= 500:
        code = "INTERNAL_ERROR"
    return error_response(code, exc.status_code, headers=getattr(exc, "headers", None))


async def _validation_exception_handler(_request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, RequestValidationError):  # pragma: no cover
        raise exc
    # Only locations and error types: never echo the submitted input back.
    fields = [{"loc": list(err.get("loc", ())), "type": err.get("type")} for err in exc.errors()]
    return error_response("VALIDATION_ERROR", 422, {"fields": fields})


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, _app_error_handler)
    app.add_exception_handler(StarletteHTTPException, _http_exception_handler)
    app.add_exception_handler(RequestValidationError, _validation_exception_handler)
