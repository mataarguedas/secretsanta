"""Archiving (Prompt 27, PRD §3): the host's manual archive and the daily auto-archive."""

import uuid
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import get_settings
from app.models import Event
from app.scripts import run_job
from app.services.scheduled import auto_archive_events
from app.worker.settings import WorkerSettings
from tests.api.auth_helpers import CSRF, login_as
from tests.api.event_helpers import EVENTS, create, error_code
from tests.invariants.drawn import ANA, PEOPLE, drawn_event

BETO = PEOPLE[1]
NOW = datetime(2026, 12, 28, 9, 0, tzinfo=UTC)


async def set_exchange(
    db: async_sessionmaker[AsyncSession], event_id: str, exchange_at: datetime
) -> None:
    async with db() as session:
        await session.execute(
            update(Event).where(Event.id == uuid.UUID(event_id)).values(exchange_at=exchange_at)
        )
        await session.commit()


async def event_row(db: async_sessionmaker[AsyncSession], event_id: str) -> Event:
    async with db() as session:
        event = await session.get(Event, uuid.UUID(event_id))
    assert event is not None
    return event


async def archive(client: httpx.AsyncClient, event_id: str) -> httpx.Response:
    return await client.post(f"{EVENTS}/{event_id}/archive", headers=CSRF)


# ── Manual archive ───────────────────────────────────────────────────────────


async def test_the_host_archives_a_drawn_event_after_the_exchange(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    drawn = await drawn_event(client, db)
    await set_exchange(db, drawn.id, datetime.now(UTC) - timedelta(minutes=1))

    response = await archive(client, drawn.id)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["state"] == "archived"
    assert body["archived_at"] is not None
    assert body["my_assignment"] is not None  # the giver still sees their own

    row = await event_row(db, drawn.id)
    assert row.state == "archived"
    assert row.archived_at is not None

    # Now in everyone's Past section, and nowhere else.
    for person in PEOPLE:
        await login_as(client, *person)
        past = (await client.get(EVENTS, params={"section": "past"})).json()["items"]
        assert [e["id"] for e in past] == [drawn.id]
        for section in ("hosting", "participating"):
            items = (await client.get(EVENTS, params={"section": section})).json()["items"]
            assert drawn.id not in [e["id"] for e in items]


async def test_archiving_before_the_exchange_is_too_early(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    drawn = await drawn_event(client, db)  # the exchange is 30 days away
    response = await archive(client, drawn.id)
    assert (response.status_code, error_code(response)) == (409, "ARCHIVE_TOO_EARLY")
    assert (await event_row(db, drawn.id)).state == "drawn"


async def test_an_open_event_is_deleted_not_archived(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    await login_as(client, *ANA)
    event = await create(client)
    await set_exchange(db, event["id"], datetime.now(UTC) - timedelta(days=1))
    response = await archive(client, event["id"])
    assert (response.status_code, error_code(response)) == (409, "EVENT_NOT_DRAWN")
    assert (await event_row(db, event["id"])).state == "open"


async def test_only_the_host_archives_and_only_once(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    drawn = await drawn_event(client, db)
    await set_exchange(db, drawn.id, datetime.now(UTC) - timedelta(days=1))

    await login_as(client, *BETO)
    response = await archive(client, drawn.id)
    assert (response.status_code, error_code(response)) == (403, "HOST_ONLY")

    await login_as(client, *ANA)
    assert (await archive(client, drawn.id)).status_code == 200
    first = (await event_row(db, drawn.id)).archived_at
    again = await archive(client, drawn.id)
    assert (again.status_code, error_code(again)) == (409, "EVENT_ARCHIVED")
    assert (await event_row(db, drawn.id)).archived_at == first


async def test_outsiders_cannot_probe_the_archive_route(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    drawn = await drawn_event(client, db)
    await login_as(client, "fede@test.local", "Fede")
    response = await archive(client, drawn.id)
    assert (response.status_code, error_code(response)) == (404, "EVENT_NOT_FOUND")
    missing = await archive(client, str(uuid.uuid4()))
    assert missing.status_code == 404


# ── Auto-archive (clock injected) ────────────────────────────────────────────


@pytest.mark.parametrize(
    ("days_ago", "archived"),
    [
        (8, True),
        (7.01, True),
        (6.99, False),
        (6, False),
        (-1, False),  # still ahead
    ],
)
async def test_auto_archive_after_7_days(
    client: httpx.AsyncClient,
    db: async_sessionmaker[AsyncSession],
    days_ago: float,
    archived: bool,
) -> None:
    drawn = await drawn_event(client, db)
    await set_exchange(db, drawn.id, NOW - timedelta(days=days_ago))
    async with db() as session:
        count = await auto_archive_events(session, NOW)
    assert count == int(archived)
    row = await event_row(db, drawn.id)
    assert row.state == ("archived" if archived else "drawn")
    assert row.archived_at == (NOW if archived else None)


async def test_auto_archive_skips_open_events_and_is_idempotent(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    drawn = await drawn_event(client, db)
    open_event = await create(client, name="Sigue abierto")
    for event_id in (drawn.id, open_event["id"]):
        await set_exchange(db, event_id, NOW - timedelta(days=30))

    async with db() as session:
        assert await auto_archive_events(session, NOW) == 1
    async with db() as session:
        assert await auto_archive_events(session, NOW + timedelta(days=1)) == 0
    assert (await event_row(db, drawn.id)).archived_at == NOW  # the first run's moment
    assert (await event_row(db, open_event["id"])).state == "open"


async def test_auto_archive_needs_an_aware_clock(db: async_sessionmaker[AsyncSession]) -> None:
    async with db() as session:
        with pytest.raises(ValueError, match="timezone-aware"):
            await auto_archive_events(session, NOW.replace(tzinfo=None))


def test_the_worker_auto_archives_daily_at_3am_costa_rica() -> None:
    job = {j.name: j for j in WorkerSettings.cron_jobs}["cron:auto_archive_events"]
    assert (job.hour, job.minute) == (3, 0)


async def test_run_job_auto_archives(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    drawn = await drawn_event(client, db)
    await set_exchange(db, drawn.id, NOW - timedelta(days=8))
    settings = get_settings()
    job, now = run_job.parse_args(["auto_archive_events", "--now", NOW.isoformat()], settings)
    assert await run_job.run(job, now, settings) == 1
    assert (await event_row(db, drawn.id)).state == "archived"
