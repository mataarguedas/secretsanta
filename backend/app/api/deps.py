"""Shared FastAPI dependencies.

Authorization dependencies (``current_user``, ``require_participant``,
``require_host``, ...) live here. Routes must use them instead of inline checks
(CLAUDE.md §2.7).
"""

from collections.abc import AsyncIterator

from fastapi import Depends, Request
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.api.cookies import ACCESS_COOKIE
from app.core.config import Settings
from app.core.errors import AppError
from app.core.security import decode_access_token
from app.models.user import User
from app.services.google_oauth import GoogleOAuthClient


def get_engine(request: Request) -> AsyncEngine:
    engine: AsyncEngine = request.app.state.engine
    return engine


async def get_db(request: Request) -> AsyncIterator[AsyncSession]:
    sessionmaker: async_sessionmaker[AsyncSession] = request.app.state.sessionmaker
    async with sessionmaker() as session:
        yield session


def get_redis(request: Request) -> "Redis":
    redis: Redis = request.app.state.redis
    return redis


def get_app_settings(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


def get_google_oauth_client(settings: Settings = Depends(get_app_settings)) -> GoogleOAuthClient:
    """Overridden in tests with a fake that never talks to Google."""
    return GoogleOAuthClient(settings)


async def current_user(
    request: Request,
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_app_settings),
) -> User:
    """The signed-in user from the ``access_token`` cookie, else 401 ``AUTH_REQUIRED``."""
    token = request.cookies.get(ACCESS_COOKIE)
    user_id = decode_access_token(token, settings) if token else None
    user = await session.get(User, user_id) if user_id else None
    if user is None:
        raise AppError("AUTH_REQUIRED", 401)
    return user
