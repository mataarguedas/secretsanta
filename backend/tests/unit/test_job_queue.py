"""Jobs are handed to the worker only after their transaction commits (CLAUDE.md §7)."""

from typing import Any

import pytest
from arq.connections import ArqRedis
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.worker.queue import committed_jobs, enqueue_after_commit, flush_committed_jobs


async def queued(pool: ArqRedis) -> list[tuple[str, tuple[Any, ...]]]:
    return [(job.function, job.args) for job in await pool.queued_jobs()]


@pytest.fixture
async def pool(arq_pool: ArqRedis, redis_client: Redis) -> ArqRedis:
    """``redis_client`` flushes the test DB around each test."""
    return arq_pool


async def test_committed_jobs_are_sent(
    db: async_sessionmaker[AsyncSession], pool: ArqRedis
) -> None:
    async with db() as session:
        await session.execute(text("SELECT 1"))
        enqueue_after_commit(session, "delete_objects", ["a.webp", "a_thumb.webp"])
        assert committed_jobs(session) == []
        assert await flush_committed_jobs(session, pool) == 0  # not yet committed
        assert await queued(pool) == []

        await session.commit()
        assert committed_jobs(session) == [("delete_objects", (["a.webp", "a_thumb.webp"],))]
        assert await flush_committed_jobs(session, pool) == 1
    assert await queued(pool) == [("delete_objects", (["a.webp", "a_thumb.webp"],))]


async def test_rolled_back_jobs_are_dropped(
    db: async_sessionmaker[AsyncSession], pool: ArqRedis
) -> None:
    async with db() as session:
        await session.execute(text("SELECT 1"))
        enqueue_after_commit(session, "delete_prefix", "events/e1/")
        await session.rollback()
        # A later, unrelated commit must not resurrect them.
        await session.execute(text("SELECT 1"))
        await session.commit()
        assert await flush_committed_jobs(session, pool) == 0
    assert await queued(pool) == []


async def test_a_failed_transaction_sends_nothing(
    db: async_sessionmaker[AsyncSession], pool: ArqRedis
) -> None:
    async with db() as session:
        await session.execute(text("SELECT 1"))
        enqueue_after_commit(session, "delete_objects", ["x.webp"])
        with pytest.raises(DBAPIError):
            await session.execute(text("SELECT 1/0"))
        await session.rollback()
        assert await flush_committed_jobs(session, pool) == 0
    assert await queued(pool) == []


async def test_without_a_queue_jobs_are_dropped_not_raised(
    db: async_sessionmaker[AsyncSession],
) -> None:
    async with db() as session:
        await session.execute(text("SELECT 1"))
        enqueue_after_commit(session, "delete_objects", ["x.webp"])
        await session.commit()
        assert await flush_committed_jobs(session, None) == 0


async def test_an_enqueue_failure_is_logged_not_raised(
    db: async_sessionmaker[AsyncSession],
) -> None:
    class BrokenPool:
        async def enqueue_job(self, *_args: Any) -> None:
            raise ConnectionError("redis is down")

    async with db() as session:
        await session.execute(text("SELECT 1"))
        enqueue_after_commit(session, "delete_objects", ["x.webp"])
        enqueue_after_commit(session, "delete_prefix", "events/e1/")
        await session.commit()
        sent = await flush_committed_jobs(session, BrokenPool())  # type: ignore[arg-type]
    assert sent == 0
