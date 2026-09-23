"""slowapi rate limiting with Redis storage (CLAUDE.md §7: auth 10/min/IP).

The limiter is module-level because slowapi's decorators bind to an instance at import
time. Storage is Redis so limits hold across API workers. If Redis is unreachable the
limiter fails open (``swallow_errors``) rather than locking everyone out of sign-in.
"""

from collections.abc import Callable
from typing import Any, Final, cast

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.core.config import get_settings
from app.core.errors import error_response

AUTH_LIMIT: Final = "10/minute"

limiter = Limiter(
    key_func=get_remote_address,
    storage_uri=get_settings().redis_url,
    key_prefix="rl",
    swallow_errors=True,
)


def auth_rate_limit[F: Callable[..., Any]](func: F) -> F:
    """10 requests per minute per client IP. The endpoint must take ``request: Request``."""
    return cast(F, limiter.limit(AUTH_LIMIT)(func))


async def _rate_limited_handler(_request: Request, _exc: Exception) -> JSONResponse:
    return error_response("RATE_LIMITED", 429, headers={"Retry-After": "60"})


def register_rate_limiting(app: FastAPI) -> None:
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limited_handler)
