"""Scheduled jobs with an injected clock (Prompt 26): exchange reminders and token pruning."""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
import pytest
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import get_settings
from app.models import Event, NotificationLog, RefreshToken, User
from app.scripts import run_job
from app.services.scheduled import (
    prune_refresh_tokens,
    reminder_due,
    reminder_target,
    send_exchange_reminders,
)
from app.worker.settings import WorkerSettings
from tests.invariants.drawn import PEOPLE, DrawnEvent, drawn_event
from tests.push import PushSpy, subscribe

CR = ZoneInfo("America/Costa_Rica")
EXCHANGE = datetime(2026, 12, 20, 19, 0, tzinfo=CR)  # Sunday 7 pm, Costa Rica


def cr(month: int, day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(2026, month, day, hour, minute, tzinfo=CR)


async def set_event(db: async_sessionmaker[AsyncSession], event_id: str, **values: object) -> None:
    async with db() as session:
        await session.execute(update(Event).where(Event.id == uuid.UUID(event_id)).values(**values))
        await session.commit()


async def reminders_at(db: async_sessionmaker[AsyncSession], now: datetime) -> int:
    async with db() as session:
        return (await send_exchange_reminders(session, now, tz=CR)).claimed


async def log_rows(db: async_sessionmaker[AsyncSession]) -> list[tuple[uuid.UUID, str]]:
    async with db() as session:
        rows = await session.execute(select(NotificationLog.user_id, NotificationLog.kind))
        return [(row.user_id, row.kind) for row in rows]


@pytest.fixture
async def drawn(client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]) -> DrawnEvent:
    """5 participants, everyone with a device, the exchange on 2026-12-20 at 19:00 CR."""
    event = await drawn_event(client, db)
    await set_event(db, event.id, exchange_at=EXCHANGE, budget_crc=25000)
    await subscribe(db, *(event.ids[email] for email, _name in PEOPLE))
    return event


# ── Windows ──────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("now", "sends"),
    [
        (cr(12, 13, 8, 59), False),
        (cr(12, 13, 9, 0), True),  # exactly 09:00
        (cr(12, 13, 14, 59), True),
        (cr(12, 13, 15, 1), False),  # the 6 h window is over
        (cr(12, 12, 9, 0), False),  # the day before
        (cr(12, 14, 9, 0), False),  # the day after
    ],
)
async def test_the_7_day_window(
    drawn: DrawnEvent,
    db: async_sessionmaker[AsyncSession],
    push_spy: PushSpy,
    now: datetime,
    sends: bool,
) -> None:
    claimed = await reminders_at(db, now)
    assert claimed == (5 if sends else 0)
    assert len(push_spy.sent) == (5 if sends else 0)
    if sends:
        assert {kind for _user, kind in await log_rows(db)} == {"reminder_7d"}
        ana = push_spy.to(drawn.ids["ana@test.local"])[0]
        assert ana == {
            "title": "Oficina 2026",
            "body": "Faltan 7 días para «Oficina 2026» — presupuesto ₡25\u00a0000",
            "tag": f"reminder:{drawn.id}",
            "url": f"/events/{drawn.id}",
        }


@pytest.mark.parametrize(
    ("now", "sends"),
    [
        (cr(12, 19, 8, 59), False),
        (cr(12, 19, 9, 0), True),
        (cr(12, 19, 14, 59), True),
        (cr(12, 19, 15, 1), False),
        (cr(12, 20, 9, 0), False),  # the exchange day itself: no reminder
    ],
)
async def test_the_1_day_window_in_each_language(
    drawn: DrawnEvent,
    db: async_sessionmaker[AsyncSession],
    push_spy: PushSpy,
    now: datetime,
    sends: bool,
) -> None:
    eva = drawn.ids["eva@test.local"]
    async with db() as session:
        await session.execute(update(User).where(User.id == eva).values(locale="en"))
        await session.commit()

    assert await reminders_at(db, now) == (5 if sends else 0)
    if sends:
        assert {kind for _user, kind in await log_rows(db)} == {"reminder_1d"}
        assert push_spy.to(eva)[0]["body"] == "1 day until Oficina 2026 — budget ₡25\u00a0000"
        assert push_spy.to(drawn.ids["ana@test.local"])[0]["body"].startswith(
            "Falta 1 día para «Oficina 2026»"
        )


async def test_a_second_run_sends_nothing(
    drawn: DrawnEvent, db: async_sessionmaker[AsyncSession], push_spy: PushSpy
) -> None:
    assert await reminders_at(db, cr(12, 13, 9, 0)) == 5
    assert await reminders_at(db, cr(12, 13, 9, 15)) == 0  # the next cron tick
    assert await reminders_at(db, cr(12, 13, 14, 45)) == 0
    assert len(push_spy.sent) == 5
    assert len(await log_rows(db)) == 5
    # The 1-day reminder is its own kind, sent once too.
    assert await reminders_at(db, cr(12, 19, 9, 0)) == 5
    assert await reminders_at(db, cr(12, 19, 9, 15)) == 0
    assert len(push_spy.sent) == 10


async def test_two_concurrent_runs_send_exactly_once(
    drawn: DrawnEvent, db: async_sessionmaker[AsyncSession], push_spy: PushSpy
) -> None:
    now = cr(12, 13, 9, 0)
    results = await asyncio.gather(*(reminders_at(db, now) for _ in range(3)))
    assert sum(results) == 5
    assert sorted(push_spy.recipients) == sorted(drawn.ids[e] for e, _n in PEOPLE)


async def test_reminders_off_gets_nothing_and_is_not_logged(
    drawn: DrawnEvent, db: async_sessionmaker[AsyncSession], push_spy: PushSpy
) -> None:
    carla = drawn.ids["carla@test.local"]

    async def reminders(on: bool) -> None:
        async with db() as session:
            await session.execute(update(User).where(User.id == carla).values(notify_reminder=on))
            await session.commit()

    await reminders(False)
    assert await reminders_at(db, cr(12, 13, 9, 0)) == 4
    assert carla not in push_spy.recipients
    assert carla not in {user for user, _kind in await log_rows(db)}

    # Documented choice: the log means "sent", so turning reminders back on while the
    # window is still open gets this reminder on the next run, once.
    await reminders(True)
    assert await reminders_at(db, cr(12, 13, 9, 15)) == 1
    assert await reminders_at(db, cr(12, 13, 9, 30)) == 0
    assert push_spy.recipients.count(carla) == 1


@pytest.mark.parametrize("state", ["open", "archived"])
async def test_open_or_archived_events_get_nothing(
    drawn: DrawnEvent, db: async_sessionmaker[AsyncSession], push_spy: PushSpy, state: str
) -> None:
    await set_event(db, drawn.id, state=state)
    assert await reminders_at(db, cr(12, 13, 9, 0)) == 0
    assert await reminders_at(db, cr(12, 19, 9, 0)) == 0
    assert push_spy.sent == []
    assert await log_rows(db) == []


async def test_the_local_date_counts_not_the_utc_date(
    drawn: DrawnEvent, db: async_sessionmaker[AsyncSession], push_spy: PushSpy
) -> None:
    # 18:30 in Costa Rica on the 20th is already the 21st in UTC.
    exchange = datetime(2026, 12, 21, 0, 30, tzinfo=UTC)
    assert exchange.astimezone(CR).date().day == 20
    await set_event(db, drawn.id, exchange_at=exchange)

    assert await reminders_at(db, cr(12, 20, 9, 0)) == 0  # a UTC-date bug would send here
    assert await reminders_at(db, cr(12, 19, 9, 0)) == 5
    # 09:00 CR is 15:00 UTC; the window closes at 21:00 UTC, before UTC midnight.
    assert reminder_target(exchange, 1, CR) == datetime(2026, 12, 19, 15, 0, tzinfo=UTC)


async def test_just_after_local_midnight(
    drawn: DrawnEvent, db: async_sessionmaker[AsyncSession], push_spy: PushSpy
) -> None:
    # 00:15 on the 20th in Costa Rica (06:15 UTC): still the 20th locally.
    await set_event(db, drawn.id, exchange_at=cr(12, 20, 0, 15))
    assert await reminders_at(db, cr(12, 19, 9, 0)) == 5
    assert len(push_spy.sent) == 5


async def test_a_moment_without_a_timezone_is_refused(
    db: async_sessionmaker[AsyncSession], clean_tables: None
) -> None:
    with pytest.raises(ValueError, match="timezone-aware"):
        await reminders_at(db, datetime(2026, 12, 13, 9, 0))  # noqa: DTZ001


def test_never_after_the_exchange() -> None:
    exchange = cr(12, 20, 10, 0)
    assert reminder_due(exchange, 0, cr(12, 20, 9, 30), CR)  # (a same-day offset)
    assert not reminder_due(exchange, 0, cr(12, 20, 10, 0), CR)


# ── Token pruning ────────────────────────────────────────────────────────────


async def test_prune_refresh_tokens(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    now = datetime(2026, 12, 1, 12, 0, tzinfo=UTC)
    await drawn_event(client, db)  # just for users
    async with db() as session:
        user = await session.scalar(select(User.id).limit(1))
        assert user is not None
        await session.execute(RefreshToken.__table__.delete())

        def token(name: str, expires: timedelta, revoked: timedelta | None = None) -> RefreshToken:
            return RefreshToken(
                user_id=user,
                token_hash=name,
                expires_at=now + expires,
                revoked_at=None if revoked is None else now + revoked,
            )

        session.add_all(
            [
                token("expired-8d", timedelta(days=-8)),
                token("expired-6d", timedelta(days=-6)),
                token("revoked-8d", timedelta(days=20), revoked=timedelta(days=-8)),
                token("revoked-1d", timedelta(days=20), revoked=timedelta(days=-1)),
                token("active", timedelta(days=29)),
            ]
        )
        await session.commit()

    async with db() as session:
        assert await prune_refresh_tokens(session, now) == 2
    async with db() as session:
        left = set(await session.scalars(select(RefreshToken.token_hash)))
    assert left == {"expired-6d", "revoked-1d", "active"}


async def test_pruning_keeps_the_current_session(
    client: httpx.AsyncClient, db: async_sessionmaker[AsyncSession]
) -> None:
    await drawn_event(client, db)
    async with db() as session:
        before = await session.scalar(select(func.count(RefreshToken.id)))
        await prune_refresh_tokens(session, datetime.now(UTC))
        after = await session.scalar(select(func.count(RefreshToken.id)))
    assert before == after
    assert (await client.get("/api/v1/me")).status_code == 200


# ── Wiring: the cron schedule and the run_job script ─────────────────────────


def test_the_worker_schedules_both_jobs_in_costa_rica_time() -> None:
    jobs = {job.name: job for job in WorkerSettings.cron_jobs}
    reminders = jobs["cron:send_exchange_reminders"]
    assert reminders.minute == {0, 15, 30, 45}
    prune = jobs["cron:prune_refresh_tokens"]
    assert (prune.hour, prune.minute) == (4, 10)
    assert WorkerSettings.timezone == ZoneInfo("America/Costa_Rica")


def test_run_job_parses_the_clock() -> None:
    settings = get_settings()
    job, now = run_job.parse_args(
        ["send_exchange_reminders", "--now", "2026-12-13T09:05:00-06:00"], settings
    )
    assert (job, now) == ("send_exchange_reminders", cr(12, 13, 9, 5))
    # No offset → Costa Rica time.
    assert run_job.parse_args(["prune_refresh_tokens", "--now", "2026-12-13T09:05"], settings)[
        1
    ] == cr(12, 13, 9, 5)
    with pytest.raises(SystemExit):
        run_job.parse_args(["send_exchange_reminders", "--now", "tomorrow"], settings)
    with pytest.raises(SystemExit):
        run_job.parse_args(["unknown_job"], settings)


def test_run_job_refuses_a_fake_clock_in_production(capsys: pytest.CaptureFixture[str]) -> None:
    production = get_settings().model_copy(update={"env": "production"})
    with pytest.raises(SystemExit):
        run_job.parse_args(["send_exchange_reminders", "--now", "2026-12-13T09:05"], production)
    assert "--now is not allowed when ENV=production" in capsys.readouterr().err
    job, _now = run_job.parse_args(["prune_refresh_tokens"], production)  # the real clock: ok
    assert job == "prune_refresh_tokens"


async def test_run_job_runs_against_the_database(drawn: DrawnEvent, push_spy: PushSpy) -> None:
    settings = get_settings()
    job, now = run_job.parse_args(
        ["send_exchange_reminders", "--now", "2026-12-13T09:05:00-06:00"], settings
    )
    result = await run_job.run(job, now, settings)
    assert result.claimed == 5
    assert len(push_spy.sent) == 5
