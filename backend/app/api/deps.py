"""Shared FastAPI dependencies.

Authorization dependencies (``current_user``, ``require_participant``,
``require_host``, ...) live here too and are added from Prompt 6 on. Routes must
use them instead of inline checks (CLAUDE.md §2.7).
"""

from collections.abc import AsyncIterator

from fastapi import Request
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker


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
