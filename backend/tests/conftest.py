"""Shared test fixtures.

Tests run against a real Postgres database, ``santa_test``, which is created on
the fly and rebuilt with ``create_all``. That is allowed here only; the app itself
uses Alembic. Redis tests use DB 15, flushed around each test.

Override with ``TEST_DATABASE_URL`` / ``TEST_REDIS_URL`` if needed.
"""

import asyncio
import os
from collections.abc import AsyncIterator, Iterator
from typing import TYPE_CHECKING

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from redis.asyncio import Redis
from sqlalchemy import make_url, text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import get_settings

if TYPE_CHECKING:
    from arq.connections import ArqRedis

    from app.storage.r2 import ObjectStorage

# ── Point the app at the test database / Redis DB *before* importing it ──────
_base = get_settings()
_db_url = make_url(os.environ.get("TEST_DATABASE_URL") or _base.database_url)
if not os.environ.get("TEST_DATABASE_URL"):
    _db_url = _db_url.set(database="santa_test")
TEST_DATABASE_URL = _db_url.render_as_string(hide_password=False)
TEST_REDIS_URL = os.environ.get("TEST_REDIS_URL") or (_base.redis_url.rsplit("/", 1)[0] + "/15")

S3_TEST_ENDPOINT = "http://s3.test:9000"

os.environ.update(
    ENV="test",
    DATABASE_URL=TEST_DATABASE_URL,
    REDIS_URL=TEST_REDIS_URL,
    # Deterministic, fake credentials: tests never talk to Google with the real client.
    APP_BASE_URL="http://localhost:5173",
    JWT_SECRET="test-jwt-secret-" + "x" * 48,
    GOOGLE_CLIENT_ID="test-client-id.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET="test-client-secret",
    # Object storage is moto's in-process S3 mock (the `s3` fixture), so tests need no
    # MinIO/R2 and run the same locally and in CI. moto intercepts this custom endpoint;
    # presigned URLs use the public one, like the browser would in dev.
    R2_ACCOUNT_ID="",
    R2_ACCESS_KEY_ID="test-access-key",
    R2_SECRET_ACCESS_KEY="test-secret-key",
    R2_BUCKET="secret-santa-test",
    S3_ENDPOINT_URL=S3_TEST_ENDPOINT,
    S3_PUBLIC_ENDPOINT_URL="http://localhost:9000",
    MOTO_S3_CUSTOM_ENDPOINTS=S3_TEST_ENDPOINT,
)
get_settings.cache_clear()

import app.models  # noqa: E402
from app.core.redis import create_redis  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.session import create_sessionmaker  # noqa: E402
from app.main import create_app  # noqa: E402


async def _prepare_database() -> None:
    target = make_url(TEST_DATABASE_URL)
    admin = create_async_engine(
        target.set(database="postgres"), isolation_level="AUTOCOMMIT", connect_args={"timeout": 5}
    )
    try:
        async with admin.connect() as conn:
            exists = await conn.scalar(
                text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": target.database}
            )
            if not exists:
                await conn.execute(text(f'CREATE DATABASE "{target.database}"'))
    finally:
        await admin.dispose()

    engine = create_async_engine(TEST_DATABASE_URL)
    try:
        async with engine.begin() as conn:
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS citext"))
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
    finally:
        await engine.dispose()


@pytest.fixture(scope="session", autouse=True)
def _test_database() -> None:
    asyncio.run(_prepare_database())


@pytest.fixture
async def db_engine() -> AsyncIterator[AsyncEngine]:
    engine = create_async_engine(TEST_DATABASE_URL)
    yield engine
    await engine.dispose()


@pytest.fixture
async def db_session(db_engine: AsyncEngine) -> AsyncIterator[AsyncSession]:
    """A session wrapped in a transaction that is rolled back after the test."""
    async with db_engine.connect() as conn:
        trans = await conn.begin()
        session = create_sessionmaker(db_engine)(bind=conn)
        try:
            yield session
        finally:
            await session.close()
            await trans.rollback()


@pytest.fixture
async def clean_tables(db_engine: AsyncEngine) -> None:
    """Empty every table (the app commits for real in API tests)."""
    names = ", ".join(f'"{t.name}"' for t in reversed(Base.metadata.sorted_tables))
    if names:
        async with db_engine.begin() as conn:
            await conn.execute(text(f"TRUNCATE {names} RESTART IDENTITY CASCADE"))


@pytest.fixture
def db(db_engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    """Sessions that see what the app committed (for assertions and test setup)."""
    return create_sessionmaker(db_engine)


@pytest.fixture
async def redis_client() -> AsyncIterator["Redis"]:
    client = create_redis(TEST_REDIS_URL)
    await client.flushdb()
    yield client
    await client.flushdb()
    await client.aclose()


@pytest.fixture
def app() -> FastAPI:
    return create_app(get_settings())


@pytest.fixture
async def client(
    app: FastAPI, redis_client: "Redis", clean_tables: None
) -> AsyncIterator[AsyncClient]:
    """httpx client against the ASGI app, with the lifespan (engine, Redis) running."""
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
            yield ac


@pytest.fixture
def s3() -> Iterator["ObjectStorage"]:
    """An empty, private bucket in moto's S3 mock; ``get_storage()`` returns a client on it."""
    from moto import mock_aws

    from app.storage.r2 import get_storage

    with mock_aws():
        get_storage.cache_clear()
        storage = get_storage()
        storage._client.create_bucket(Bucket=storage.bucket)
        yield storage
    get_storage.cache_clear()


@pytest.fixture
async def arq_pool() -> AsyncIterator["ArqRedis"]:
    """arq's pool on the test Redis DB, to inspect enqueued jobs."""
    from arq import create_pool
    from arq.connections import RedisSettings

    pool = await create_pool(RedisSettings.from_dsn(TEST_REDIS_URL))
    yield pool
    await pool.aclose()
