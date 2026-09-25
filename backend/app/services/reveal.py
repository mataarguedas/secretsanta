"""The reveal: run the draw and persist it (PRD §4.5, §6 steps 4-5, CLAUDE.md §2.1, §2.4).

Never log, return or publish the assignments. The only reader is ``my_assignment``, which
looks up the caller's own row.
"""

import random
import uuid
from datetime import UTC, datetime

from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.db.uuid7 import uuid7
from app.models.assignment import Assignment
from app.models.event import Event, EventParticipant, EventState
from app.models.user import User
from app.realtime.channels import publish_to_users
from app.realtime.frames import event_drawn_frame
from app.schemas.events import AssignmentReceiver, MyAssignment
from app.services.draw import MIN_PARTICIPANTS, DrawInfeasibleError, draw
from app.services.exclusions import exclusion_pairs, participant_ids
from app.worker.queue import enqueue_committed


async def run_draw(session: AsyncSession, redis: "Redis", event_id: uuid.UUID) -> None:
    """Draw and persist in ONE transaction; the caller has checked the host.

    The event row is locked (``FOR UPDATE``) and re-read, so a double click or two tabs
    wait for each other and the second one sees ``drawn`` (409). Any error rolls back.
    """
    try:
        event = await session.scalar(
            select(Event)
            .where(Event.id == event_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if event is None:  # pragma: no cover - the route checked participation
            raise AppError("EVENT_NOT_FOUND", 404)
        if event.state != EventState.OPEN:
            raise AppError("EVENT_ALREADY_DRAWN", 409)

        people = await participant_ids(session, event.id)
        if len(people) < MIN_PARTICIPANTS:
            raise AppError("NOT_ENOUGH_PARTICIPANTS", 409)
        try:
            result = draw(people, await exclusion_pairs(session, event.id), random.SystemRandom())
        except DrawInfeasibleError:
            raise AppError("DRAW_INFEASIBLE", 409) from None

        session.add_all(
            Assignment(id=uuid7(), event_id=event.id, giver_id=giver, receiver_id=receiver)
            for giver, receiver in result.items()
        )
        del result  # nothing below may touch the pairs
        await session.flush()  # constraint violations surface here, before the state flips
        event.state = EventState.DRAWN
        event.drawn_at = datetime.now(UTC)
        await session.commit()
    except BaseException:
        await session.rollback()
        raise

    await on_event_drawn(session, redis, event_id)


async def on_event_drawn(session: AsyncSession, redis: "Redis", event_id: uuid.UUID) -> None:
    """Runs after the draw commits. It knows only the event id, never a pair: every
    participant gets the same ``event_drawn {event_id}`` frame and fetches their own
    assignment over REST."""
    participants = await session.scalars(
        select(EventParticipant.user_id).where(EventParticipant.event_id == event_id)
    )
    await publish_to_users(redis, participants.all(), event_drawn_frame(event_id))
    # The worker looks up the participants itself; the job carries the event id only.
    enqueue_committed(session, "send_reveal", str(event_id))


async def my_assignment(
    session: AsyncSession, event: Event, viewer_id: uuid.UUID
) -> MyAssignment | None:
    """FR-DRW-4: the viewer's own receiver. Filtered by giver, so never anyone else's."""
    if event.state == EventState.OPEN:
        return None
    row = (
        await session.execute(
            select(User.id, User.name, User.avatar_url)
            .join(Assignment, Assignment.receiver_id == User.id)
            .where(Assignment.event_id == event.id, Assignment.giver_id == viewer_id)
        )
    ).one_or_none()
    if row is None:
        return None
    user_id, name, avatar_url = row
    return MyAssignment(
        receiver=AssignmentReceiver(user_id=user_id, name=name, avatar_url=avatar_url)
    )
