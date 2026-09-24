"""Exclusion rules (PRD §4.4). Routers validate and call these; the host/state checks and
the event row lock come from the route dependencies."""

import itertools
import uuid

from sqlalchemy import delete, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.errors import AppError
from app.db.uuid7 import uuid7
from app.models.event import Event, EventParticipant
from app.models.exclusion import Exclusion
from app.models.user import User
from app.schemas.events import UserPublic
from app.schemas.exclusions import ExclusionList, ExclusionOut
from app.services.draw import is_feasible


def canonical(a: uuid.UUID, b: uuid.UUID) -> tuple[uuid.UUID, uuid.UUID]:
    """The stored order. Python and Postgres order UUIDs the same way (by their bytes)."""
    return (a, b) if a < b else (b, a)


async def participant_ids(session: AsyncSession, event_id: uuid.UUID) -> list[uuid.UUID]:
    rows = await session.scalars(
        select(EventParticipant.user_id)
        .where(EventParticipant.event_id == event_id)
        .order_by(EventParticipant.joined_at, EventParticipant.id)
    )
    return list(rows.all())


async def exclusion_pairs(
    session: AsyncSession, event_id: uuid.UUID
) -> list[tuple[uuid.UUID, uuid.UUID]]:
    rows = await session.execute(
        select(Exclusion.user_a_id, Exclusion.user_b_id).where(Exclusion.event_id == event_id)
    )
    return [(a, b) for a, b in rows.all()]


async def check_feasible(session: AsyncSession, event_id: uuid.UUID) -> bool:
    """FR-EXC-4: whether a valid draw exists with the current roster and exclusions."""
    people = await participant_ids(session, event_id)
    members = set(people)
    # Removing a participant deletes their pairs, so this filter is only a safety net: a
    # stray pair must never turn into a ValueError from the pure module.
    pairs = [(a, b) for a, b in await exclusion_pairs(session, event_id) if {a, b} <= members]
    return is_feasible(people, pairs)


async def list_exclusions(session: AsyncSession, event: Event) -> ExclusionList:
    user_a, user_b = aliased(User), aliased(User)
    rows = (
        await session.execute(
            select(Exclusion.id, user_a, user_b)
            .join(user_a, user_a.id == Exclusion.user_a_id)
            .join(user_b, user_b.id == Exclusion.user_b_id)
            .where(Exclusion.event_id == event.id)
            .order_by(Exclusion.created_at, Exclusion.id)
        )
    ).all()
    items = [
        ExclusionOut(id=exclusion_id, user_a=_public(a), user_b=_public(b))
        for exclusion_id, a, b in rows
    ]
    return ExclusionList(items=items, feasible=await check_feasible(session, event.id))


async def create_exclusions(
    session: AsyncSession, event: Event, user_ids: list[uuid.UUID]
) -> ExclusionList:
    """Every pair among ``user_ids`` (one pair for two ids). Existing pairs are skipped."""
    found = await session.scalars(
        select(EventParticipant.user_id).where(
            EventParticipant.event_id == event.id, EventParticipant.user_id.in_(user_ids)
        )
    )
    if len(set(found.all())) != len(set(user_ids)):
        raise AppError("EXCLUSION_INVALID_PARTICIPANT", 422)

    pairs = {canonical(a, b) for a, b in itertools.combinations(user_ids, 2)}
    await session.execute(
        insert(Exclusion)
        .values(
            [
                {"id": uuid7(), "event_id": event.id, "user_a_id": a, "user_b_id": b}
                for a, b in sorted(pairs)
            ]
        )
        .on_conflict_do_nothing(index_elements=["event_id", "user_a_id", "user_b_id"])
    )
    await session.commit()
    return await list_exclusions(session, event)


async def delete_exclusion(
    session: AsyncSession, event: Event, exclusion_id: uuid.UUID
) -> ExclusionList:
    result = await session.execute(
        delete(Exclusion).where(Exclusion.id == exclusion_id, Exclusion.event_id == event.id)
    )
    if getattr(result, "rowcount", 0) == 0:
        raise AppError("EXCLUSION_NOT_FOUND", 404)
    await session.commit()
    return await list_exclusions(session, event)


async def delete_user_exclusions(
    session: AsyncSession, event_id: uuid.UUID, user_id: uuid.UUID
) -> None:
    """FR-EXC-3: part of removing a participant. The caller commits."""
    await session.execute(
        delete(Exclusion).where(
            Exclusion.event_id == event_id,
            or_(Exclusion.user_a_id == user_id, Exclusion.user_b_id == user_id),
        )
    )


def _public(user: User) -> UserPublic:
    return UserPublic(id=user.id, name=user.name, avatar_url=user.avatar_url)
