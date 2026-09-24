"""Invariant 4 — draw atomicity (CLAUDE.md §2.4, PRD §6.4).

The draw runs in one transaction under ``SELECT … FOR UPDATE``: concurrent requests draw
exactly once, and a failure after the assignments are inserted leaves nothing behind.
"""

import asyncio
import uuid
from collections.abc import Iterator
from typing import Any

import httpx
import pytest
from sqlalchemy import event as sa_event
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import Session

from app.models import Assignment, Event
from app.services import reveal
from tests.api.auth_helpers import CSRF
from tests.api.event_helpers import EVENTS
from tests.invariants.drawn import open_event


async def state_and_rows(db: async_sessionmaker[AsyncSession], event_id: str) -> tuple[str, int]:
    eid = uuid.UUID(event_id)
    async with db() as session:
        event = await session.get(Event, eid)
        rows = await session.scalar(
            select(func.count()).select_from(Assignment).where(Assignment.event_id == eid)
        )
    assert event is not None
    return event.state, rows or 0


async def test_concurrent_draws_draw_exactly_once(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    event, _ = await open_event(client, db)
    responses = await asyncio.gather(
        *(client.post(f"{EVENTS}/{event['id']}/draw", headers=CSRF) for _ in range(6))
    )
    assert sorted(r.status_code for r in responses) == [200, *[409] * 5]
    assert await state_and_rows(db, event["id"]) == ("drawn", 5)


@pytest.fixture
def flushed_assignments() -> Iterator[list[int]]:
    """How many Assignment rows each flush sent to the database."""
    seen: list[int] = []

    def after_flush(session: Session, _context: Any) -> None:
        count = sum(isinstance(obj, Assignment) for obj in session.new)
        if count:
            seen.append(count)

    sa_event.listen(Session, "after_flush", after_flush)
    yield seen
    sa_event.remove(Session, "after_flush", after_flush)


async def test_failure_after_insert_rolls_everything_back(
    client: httpx.AsyncClient,
    db: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
    flushed_assignments: list[int],
) -> None:
    event, _ = await open_event(client, db)

    class InjectedError(RuntimeError):
        pass

    class ExplodingDatetime:
        """Stands in for ``datetime`` in the reveal module: fails at ``drawn_at``, which
        runs after the assignments were flushed and before the commit."""

        @staticmethod
        def now(_tz: Any = None) -> Any:
            raise InjectedError

    monkeypatch.setattr(reveal, "datetime", ExplodingDatetime)
    failed = await client.post(f"{EVENTS}/{event['id']}/draw", headers=CSRF)
    assert failed.status_code == 500
    assert failed.json()["error"]["code"] == "INTERNAL_ERROR"

    assert flushed_assignments == [5], "the failure must come after the INSERTs"
    assert await state_and_rows(db, event["id"]) == ("open", 0)

    # The lock was released and nothing half-done blocks a real draw.
    monkeypatch.undo()
    response = await client.post(f"{EVENTS}/{event['id']}/draw", headers=CSRF)
    assert response.status_code == 200
    assert await state_and_rows(db, event["id"]) == ("drawn", 5)
