"""Account deletion (FR-ACC-3, CLAUDE.md §2.3).

``delete_account`` runs in one transaction, holding a lock on every event the user is in
(or hosts), so a draw can't start halfway through:

- refused (409 ``ACCOUNT_IN_ACTIVE_DRAW``) while they are in any DRAWN event: participants
  can't leave after the draw, and removing someone would break the chain;
- OPEN events they host are deleted, as ``DELETE /events/{id}`` does (rows cascade; the
  event's storage folder goes after the commit);
- OPEN events they only joined: they are taken off the roster the way a leave does
  (exclusions, wishlist, group chat);
- ARCHIVED events stay for everyone else: their wishlist items go, assignments that
  involve them go, and an event they host keeps ``host_id`` NULL ("Deleted user") with
  its invite link cleared;
- every message they sent keeps its row but loses its body (the "Message deleted"
  placeholder), and their member rows lose the user (``account_deleted``): named members
  read "Deleted user", anonymous ones stay "Secret Elf #N". Their threads' ``pair_key``
  (which holds user ids) becomes a tombstone;
- push subscriptions, refresh tokens and the user row go last.

Storage objects are deleted by the worker once the transaction has committed.
"""

import uuid
from dataclasses import dataclass, field

from sqlalchemy import Text, and_, cast, delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.logging import get_logger
from app.db.mixins import utcnow
from app.models.assignment import Assignment
from app.models.chat import Conversation, ConversationMember, Message
from app.models.event import Event, EventParticipant, EventState
from app.models.push import PushSubscription
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.models.wishlist import WishlistItem, WishlistPhoto
from app.services.covers import event_prefix
from app.services.events import detach_participant
from app.worker.queue import enqueue_after_commit

log = get_logger(__name__)


@dataclass(frozen=True, slots=True)
class EventRef:
    id: uuid.UUID
    name: str


@dataclass(frozen=True, slots=True)
class HostedEventRef:
    id: uuid.UUID
    name: str
    participant_count: int


@dataclass(frozen=True, slots=True)
class DeletionPreview:
    blocking_events: list[EventRef] = field(default_factory=list)
    hosted_open_events: list[HostedEventRef] = field(default_factory=list)

    @property
    def blocked(self) -> bool:
        return bool(self.blocking_events)


async def _events(
    session: AsyncSession, user_id: uuid.UUID, *, for_update: bool = False
) -> list[Event]:
    """Events the user participates in or hosts."""
    participates = select(EventParticipant.event_id).where(EventParticipant.user_id == user_id)
    stmt = (
        select(Event)
        .where(or_(Event.id.in_(participates), Event.host_id == user_id))
        .order_by(Event.id)
    )
    if for_update:
        stmt = stmt.with_for_update(of=Event)  # same order everywhere: no deadlocks
    return list((await session.scalars(stmt)).all())


async def _counts(session: AsyncSession, event_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not event_ids:
        return {}
    rows = await session.execute(
        select(EventParticipant.event_id, func.count())
        .where(EventParticipant.event_id.in_(event_ids))
        .group_by(EventParticipant.event_id)
    )
    return dict(rows.tuples().all())


async def _preview(
    session: AsyncSession, user_id: uuid.UUID, events: list[Event]
) -> DeletionPreview:
    blocking = [e for e in events if e.state == EventState.DRAWN]
    hosted_open = [e for e in events if e.host_id == user_id and e.state == EventState.OPEN]
    counts = await _counts(session, [e.id for e in hosted_open])
    return DeletionPreview(
        blocking_events=[EventRef(e.id, e.name) for e in sorted(blocking, key=_by_name)],
        hosted_open_events=[
            HostedEventRef(e.id, e.name, counts.get(e.id, 0))
            for e in sorted(hosted_open, key=_by_name)
        ],
    )


def _by_name(event: Event) -> str:
    return event.name.casefold()


async def deletion_preview(session: AsyncSession, user: User) -> DeletionPreview:
    return await _preview(session, user.id, await _events(session, user.id))


async def delete_account(session: AsyncSession, user: User) -> None:
    user_id = user.id
    events = await _events(session, user_id, for_update=True)
    if any(e.state == EventState.DRAWN for e in events):
        raise AppError("ACCOUNT_IN_ACTIVE_DRAW", 409)

    hosted_open = [e for e in events if e.host_id == user_id and e.state == EventState.OPEN]
    joined_open = [e for e in events if e.host_id != user_id and e.state == EventState.OPEN]
    archived = [e for e in events if e.state == EventState.ARCHIVED]

    # Messages and member rows first, while the member rows still carry the user id.
    now = utcnow()
    mine = select(ConversationMember.id).where(ConversationMember.user_id == user_id)
    await session.execute(
        update(Message)
        .where(Message.sender_member_id.in_(mine), Message.deleted_at.is_(None))
        .values(body=None, deleted_at=now)
        .execution_options(synchronize_session=False)
    )
    await session.execute(
        update(ConversationMember)
        .where(ConversationMember.user_id == user_id)
        .values(user_id=None, account_deleted=True)
        .execution_options(synchronize_session=False)
    )
    # pair_key spells out user ids (for anonymous threads: initiator → recipient). With the
    # user gone it can't dedupe anything, and it would be the last link from an alias to
    # them. A tombstone keeps the column's NOT NULL / UNIQUE rules ('d:'/'a:' never clash).
    await session.execute(
        update(Conversation)
        .where(Conversation.pair_key.contains(str(user_id)))
        .values(pair_key=func.concat("x:", cast(Conversation.id, Text)))
        .execution_options(synchronize_session=False)
    )

    # OPEN events they joined: the leave path (roster, exclusions, wishlist, group chat).
    for event in joined_open:
        await detach_participant(session, event.id, user_id)

    # ARCHIVED events: their wishlist (photos after the commit) and assignments go; an event
    # they host loses its host and its invite link.
    archived_ids = [e.id for e in archived]
    if archived_ids:
        own_items = select(WishlistItem.id).where(
            WishlistItem.user_id == user_id, WishlistItem.event_id.in_(archived_ids)
        )
        photos = await session.execute(
            select(WishlistPhoto.object_key, WishlistPhoto.thumb_key).where(
                WishlistPhoto.item_id.in_(own_items)
            )
        )
        keys = [key for pair in photos.tuples().all() for key in pair]
        if keys:
            enqueue_after_commit(session, "delete_objects", keys)
        await session.execute(
            delete(WishlistItem).where(
                WishlistItem.user_id == user_id, WishlistItem.event_id.in_(archived_ids)
            )
        )
        await session.execute(
            delete(Assignment).where(
                Assignment.event_id.in_(archived_ids),
                or_(Assignment.giver_id == user_id, Assignment.receiver_id == user_id),
            )
        )
        await session.execute(
            update(Event)
            .where(and_(Event.id.in_(archived_ids), Event.host_id == user_id))
            .values(host_id=None, invite_token=None)
            .execution_options(synchronize_session=False)
        )

    # OPEN events they host: gone, as DELETE /events/{id} does (storage folder after commit).
    for event in hosted_open:
        enqueue_after_commit(session, "delete_prefix", event_prefix(event.id))
    if hosted_open:
        await session.execute(delete(Event).where(Event.id.in_([e.id for e in hosted_open])))

    await session.execute(delete(PushSubscription).where(PushSubscription.user_id == user_id))
    await session.execute(delete(RefreshToken).where(RefreshToken.user_id == user_id))
    # Everything else keyed on the user (roster rows, exclusions, notification log) cascades.
    await session.execute(delete(User).where(User.id == user_id))
    await session.commit()
    log.info(
        "account_deleted",
        hosted_open_deleted=len(hosted_open),
        open_left=len(joined_open),
        archived_kept=len(archived),
    )
