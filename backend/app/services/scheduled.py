"""Scheduled jobs (PRD §12, CLAUDE.md §7 Cron jobs). Each takes the clock as ``now``: the
worker's cron passes the real time, ``app.scripts.run_job`` any moment you like, and
nothing in here reads the clock itself.

``send_exchange_reminders`` (every 15 min): for each DRAWN event and each offset, the
target is 09:00 Costa Rica time on the exchange's local calendar day minus the offset. A
run inside ``[target, target + 6 h)``, still before the exchange, claims one
``notification_log`` row per recipient (``INSERT … ON CONFLICT DO NOTHING``), commits, and
pushes only to the rows it actually inserted. So overlapping runs, retries and several
workers send each reminder at most once.

Who is logged: only users with reminders **on** when the run claims them. The log means
"this reminder was sent to them". Someone who turns reminders back on while the window is
still open gets that reminder on the next run; someone who turns them on later doesn't.

``prune_refresh_tokens`` (daily): delete refresh tokens that expired, or were revoked,
more than 7 days ago. The week of revoked rows is what lets ``/auth/refresh`` recognise a
replayed old token.

``auto_archive_events`` (daily, 03:00 CR): DRAWN events whose exchange was more than 7 days
ago become ARCHIVED (PRD §3). One conditional ``UPDATE``, so it is idempotent and can't
race a host's manual archive into archiving twice.
"""

import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Final
from zoneinfo import ZoneInfo

from sqlalchemy import delete, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.db.uuid7 import uuid7
from app.models.event import Event, EventParticipant, EventState
from app.models.notification_log import NotificationLog
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.notifications.sender import notify

log = get_logger(__name__)

REMINDER_OFFSETS: Final[dict[str, int]] = {"reminder_7d": 7, "reminder_1d": 1}  # kind → days
REMINDER_AT: Final = time(9, 0)
REMINDER_WINDOW: Final = timedelta(hours=6)
TOKEN_RETENTION: Final = timedelta(days=7)
AUTO_ARCHIVE_AFTER: Final = timedelta(days=7)


def reminder_target(exchange_at: datetime, days_before: int, tz: ZoneInfo) -> datetime:
    """09:00 local on the exchange's local calendar day minus ``days_before``."""
    local_day: date = exchange_at.astimezone(tz).date() - timedelta(days=days_before)
    return datetime.combine(local_day, REMINDER_AT, tzinfo=tz)


def reminder_due(exchange_at: datetime, days_before: int, now: datetime, tz: ZoneInfo) -> bool:
    target = reminder_target(exchange_at, days_before, tz)
    return target <= now < target + REMINDER_WINDOW and now < exchange_at


@dataclass(frozen=True, slots=True)
class ReminderRun:
    events: int = 0  # (event, offset) pairs that were due
    claimed: int = 0  # log rows inserted by this run = reminders sent
    delivered: int = 0  # subscriptions that accepted a push


async def send_exchange_reminders(
    session: AsyncSession, now: datetime, *, tz: ZoneInfo
) -> ReminderRun:
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    # Any reminder due now is for an exchange at most ~7 days away; a day of margin.
    horizon = now + timedelta(days=max(REMINDER_OFFSETS.values()) + 1)
    events = (
        await session.scalars(
            select(Event).where(
                Event.state == EventState.DRAWN,
                Event.exchange_at > now,
                Event.exchange_at <= horizon,
            )
        )
    ).all()

    due = 0
    claimed = delivered = 0
    for event in events:
        for kind, days in REMINDER_OFFSETS.items():
            if not reminder_due(event.exchange_at, days, now, tz):
                continue
            due += 1
            users = await _claim(session, event.id, kind, now)
            await session.commit()  # the claim is durable before anything is sent
            if not users:
                continue
            claimed += len(users)
            result = await notify(
                session,
                users,
                "exchange_reminder",
                {
                    "event": event.name,
                    "days": days,
                    "budget_crc": event.budget_crc,
                    "url": f"/events/{event.id}",
                    "tag": f"reminder:{event.id}",
                },
            )
            delivered += result.sent
    run = ReminderRun(events=due, claimed=claimed, delivered=delivered)
    log.info("exchange_reminders", events=run.events, claimed=run.claimed, sent=run.delivered)
    return run


async def _claim(
    session: AsyncSession, event_id: uuid.UUID, kind: str, now: datetime
) -> list[uuid.UUID]:
    """Insert a log row for each participant with reminders on; return the ones this call
    inserted (a row that already exists belongs to an earlier or concurrent run)."""
    recipients = (
        await session.scalars(
            select(User.id)
            .join(EventParticipant, EventParticipant.user_id == User.id)
            .where(EventParticipant.event_id == event_id, User.notify_reminder.is_(True))
        )
    ).all()
    if not recipients:
        return []
    stmt = (
        insert(NotificationLog)
        .values(
            [
                {
                    "id": uuid7(),
                    "user_id": uid,
                    "event_id": event_id,
                    "kind": kind,
                    "sent_at": now,
                }
                for uid in recipients
            ]
        )
        .on_conflict_do_nothing(
            index_elements=["user_id", "event_id", "kind"],
            index_where=NotificationLog.kind.in_(REMINDER_OFFSETS),
        )
        .returning(NotificationLog.user_id)
    )
    return list((await session.scalars(stmt)).all())


async def prune_refresh_tokens(session: AsyncSession, now: datetime) -> int:
    cutoff = now - TOKEN_RETENTION
    result = await session.execute(
        delete(RefreshToken).where(
            or_(RefreshToken.expires_at < cutoff, RefreshToken.revoked_at < cutoff)
        )
    )
    await session.commit()
    count = int(getattr(result, "rowcount", 0) or 0)
    log.info("prune_refresh_tokens", deleted=count)
    return count


async def auto_archive_events(session: AsyncSession, now: datetime) -> int:
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    result = await session.execute(
        update(Event)
        .where(Event.state == EventState.DRAWN, Event.exchange_at < now - AUTO_ARCHIVE_AFTER)
        .values(state=EventState.ARCHIVED, archived_at=now)
        .execution_options(synchronize_session=False)
    )
    await session.commit()
    count = int(getattr(result, "rowcount", 0) or 0)
    log.info("auto_archive_events", archived=count)
    return count
