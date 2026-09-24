"""slowapi rate limiting with Redis storage (CLAUDE.md §7: auth 10/min/IP, uploads
20/min/user, messages 30/min/user).

The limiter is module-level because slowapi's decorators bind to an instance at import
time. Storage is Redis so limits hold across API workers. If Redis is unreachable the
limiter fails open (``swallow_errors``) rather than locking everyone out of sign-in.
"""

import secrets
import time
import uuid
from collections.abc import Callable
from typing import Any, Final, cast

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from redis.asyncio import Redis
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.api.cookies import ACCESS_COOKIE
from app.core.config import get_settings
from app.core.errors import AppError, error_response
from app.core.security import decode_access_token

AUTH_LIMIT: Final = "10/minute"
UPLOAD_LIMIT: Final = "20/minute"
MESSAGE_LIMIT: Final = 30  # per rolling minute, per user (REST and WebSocket together)
MESSAGE_WINDOW_SECONDS: Final = 60

limiter = Limiter(
    key_func=get_remote_address,
    storage_uri=get_settings().redis_url,
    key_prefix="rl",
    swallow_errors=True,
)


def auth_rate_limit[F: Callable[..., Any]](func: F) -> F:
    """10 requests per minute per client IP. The endpoint must take ``request: Request``."""
    return cast(F, limiter.limit(AUTH_LIMIT)(func))


def user_key(request: Request) -> str:
    """The signed-in user's id from the access cookie, else the client IP. An expired or
    forged cookie falls back to the IP; the route's own auth check rejects it anyway."""
    token = request.cookies.get(ACCESS_COOKIE)
    user_id = decode_access_token(token, get_settings()) if token else None
    return f"user:{user_id}" if user_id else f"ip:{get_remote_address(request)}"


def upload_rate_limit[F: Callable[..., Any]](func: F) -> F:
    """20 uploads per minute per user. The endpoint must take ``request: Request``."""
    return cast(F, limiter.limit(UPLOAD_LIMIT, key_func=user_key)(func))


async def hit_message_limit(redis: "Redis", user_id: uuid.UUID) -> None:
    """PRD FR-CHT-8: 30 messages per rolling minute per user, shared by REST and the
    WebSocket (a sliding log in a Redis sorted set). 429 ``RATE_LIMITED`` beyond that;
    refused attempts don't count. Fails open if Redis is unreachable, like the limiter."""
    key = f"rl:msg:{user_id}"
    now = time.time()
    entry = f"{now:.6f}:{secrets.token_hex(4)}"
    try:
        async with redis.pipeline(transaction=True) as pipe:
            pipe.zremrangebyscore(key, 0, now - MESSAGE_WINDOW_SECONDS)
            pipe.zadd(key, {entry: now})
            pipe.zcard(key)
            pipe.expire(key, MESSAGE_WINDOW_SECONDS)
            _, _, count, _ = await pipe.execute()
        if count > MESSAGE_LIMIT:
            await redis.zrem(key, entry)
    except Exception:
        return
    if count > MESSAGE_LIMIT:
        raise AppError("RATE_LIMITED", 429)


async def _rate_limited_handler(_request: Request, _exc: Exception) -> JSONResponse:
    return error_response("RATE_LIMITED", 429, headers={"Retry-After": "60"})


def register_rate_limiting(app: FastAPI) -> None:
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limited_handler)
