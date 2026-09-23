from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.core.config import Settings


def create_engine(settings: Settings, *, url: str | None = None) -> AsyncEngine:
    return create_async_engine(
        url or settings.database_url,
        pool_size=10,
        max_overflow=10,
        pool_pre_ping=True,
        # asyncpg connect timeout, so /health fails fast when Postgres is down.
        connect_args={"timeout": 5},
    )
