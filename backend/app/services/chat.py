"""Chat rules (PRD §4.7). Routers check membership and state through ``app/api/deps.py``;
everything here serializes through ``app/schemas/chat.py`` (CLAUDE.md §2.2).

- Group: one per event while ``group_chat_enabled``; every current participant is a
  member. Leaving the event detaches the member (``user_id`` NULL) so their messages stay.
- Direct / anonymous: started by a participant with another participant, idempotent
  through the internal ``pair_key``. The anonymous initiator gets a random
  ``anon_number``, unique in the event and chosen per thread, so two threads from the
  same person can't be linked.
"""

import base64
import binascii
import json
import secrets
import uuid
from collections import defaultdict
from collections.abc import Sequence
from datetime import datetime
from typing import Final, cast

from redis.asyncio import Redis
from sqlalchemy import (
    DateTime,
    Uuid,
    and_,
    delete,
    func,
    literal,
    or_,
    select,
    tuple_,
    update,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import AppError
from app.core.rate_limit import hit_message_limit
from app.db.mixins import utcnow
from app.models.chat import ANON_NUMBER_MAX, Conversation, ConversationKind, ConversationMember
from app.models.chat import Message as MessageRow
from app.models.event import Event, EventParticipant
from app.models.user import User
from app.realtime.channels import publish_to_conversation, publish_to_users
from app.realtime.frames import (
    conversation_created_frame,
    message_deleted_frame,
    message_frame,
)
from app.schemas.chat import (
    ConversationDetail,
    ConversationKindName,
    ConversationPage,
    ConversationSummary,
    EventRef,
    EventStateName,
    MessageCreate,
    MessagePage,
    MessagePublic,
    StartKind,
    build_member_public,
    build_message_public,
)
from app.worker.queue import enqueue_committed

CONVERSATION_PAGE: Final = 30
MESSAGE_PAGE: Final = 50  # PRD FR-CHT-5
ANON_ATTEMPTS: Final = 5


# ── Group conversation (kept in sync with the roster) ────────────────────────


async def _group_of(session: AsyncSession, event_id: uuid.UUID) -> Conversation | None:
    group: Conversation | None = await session.scalar(
        select(Conversation).where(
            Conversation.event_id == event_id, Conversation.kind == ConversationKind.GROUP
        )
    )
    return group


async def create_group(session: AsyncSession, event: Event) -> None:
    """With every current participant as a member. The caller commits."""
    group = Conversation(event_id=event.id, kind=ConversationKind.GROUP)
    session.add(group)
    await session.flush()
    user_ids = await session.scalars(
        select(EventParticipant.user_id).where(EventParticipant.event_id == event.id)
    )
    session.add_all(
        ConversationMember(conversation_id=group.id, event_id=event.id, user_id=user_id)
        for user_id in user_ids.all()
    )


async def sync_group_flag(session: AsyncSession, event: Event) -> None:
    """``group_chat_enabled`` changed (only possible while OPEN): create the group, or
    delete it with its messages. The caller commits."""
    group = await _group_of(session, event.id)
    if event.group_chat_enabled and group is None:
        await create_group(session, event)
    elif not event.group_chat_enabled and group is not None:
        await session.execute(delete(Conversation).where(Conversation.id == group.id))


async def add_group_member(session: AsyncSession, event_id: uuid.UUID, user_id: uuid.UUID) -> None:
    """On join. The caller commits."""
    group = await _group_of(session, event_id)
    if group is not None:
        session.add(
            ConversationMember(conversation_id=group.id, event_id=event_id, user_id=user_id)
        )


async def detach_group_member(
    session: AsyncSession, event_id: uuid.UUID, user_id: uuid.UUID
) -> None:
    """On leave/remove: out of the group, but their messages stay (as a former member).
    Direct and anonymous threads are kept; ``require_member`` refuses a non-participant.
    The caller commits."""
    await session.execute(
        update(ConversationMember)
        .where(
            ConversationMember.event_id == event_id,
            ConversationMember.user_id == user_id,
            ConversationMember.conversation_id.in_(
                select(Conversation.id).where(
                    Conversation.event_id == event_id,
                    Conversation.kind == ConversationKind.GROUP,
                )
            ),
        )
        .values(user_id=None)
    )


# ── Starting a direct or anonymous conversation ──────────────────────────────


def pair_key(
    kind: StartKind, event_id: uuid.UUID, initiator_id: uuid.UUID, recipient_id: uuid.UUID
) -> str:
    if kind == "direct":
        low, high = sorted((str(initiator_id), str(recipient_id)))
        return f"d:{event_id}:{low}:{high}"
    return f"a:{event_id}:{initiator_id}:{recipient_id}"


async def start_conversation(
    session: AsyncSession,
    redis: "Redis",
    event: Event,
    initiator: User,
    recipient_id: uuid.UUID,
    kind: StartKind,
) -> tuple[ConversationDetail, bool]:
    """Idempotent: returns ``(conversation, created)``. The route holds the event lock, so
    starts in one event are serialized; the retries below are a backstop."""
    if recipient_id == initiator.id:
        raise AppError("CONVERSATION_WITH_SELF", 422)
    is_participant = await session.scalar(
        select(EventParticipant.id).where(
            EventParticipant.event_id == event.id, EventParticipant.user_id == recipient_id
        )
    )
    if is_participant is None:
        raise AppError("PARTICIPANT_NOT_FOUND", 404)

    key = pair_key(kind, event.id, initiator.id, recipient_id)
    for _attempt in range(ANON_ATTEMPTS):
        existing = await session.scalar(select(Conversation.id).where(Conversation.pair_key == key))
        if existing is not None:
            await session.commit()  # release the event lock
            return await conversation_detail(session, existing, initiator), False
        try:
            async with session.begin_nested():
                conversation_id = await _insert_pair(
                    session, event.id, kind, key, initiator.id, recipient_id
                )
        except IntegrityError:
            continue  # the same pair was created concurrently, or the alias was taken
        await session.commit()
        await after_conversation_started(session, redis, conversation_id, kind, initiator.id)
        return await conversation_detail(session, conversation_id, initiator), True
    raise AppError("INTERNAL_ERROR", 500)  # pragma: no cover - needs ANON_ATTEMPTS races


async def _insert_pair(
    session: AsyncSession,
    event_id: uuid.UUID,
    kind: StartKind,
    key: str,
    initiator_id: uuid.UUID,
    recipient_id: uuid.UUID,
) -> uuid.UUID:
    conversation = Conversation(event_id=event_id, kind=kind, pair_key=key)
    session.add(conversation)
    await session.flush()
    anonymous = kind == "anonymous"
    session.add_all(
        [
            ConversationMember(
                conversation_id=conversation.id,
                event_id=event_id,
                user_id=initiator_id,
                is_anonymous=anonymous,
                anon_number=await _free_anon_number(session, event_id) if anonymous else None,
            ),
            ConversationMember(
                conversation_id=conversation.id, event_id=event_id, user_id=recipient_id
            ),
        ]
    )
    await session.flush()
    return conversation.id


async def _free_anon_number(session: AsyncSession, event_id: uuid.UUID) -> int:
    """Uniformly random among the numbers not yet used in this event (``secrets``)."""
    used = set(
        (
            await session.scalars(
                select(ConversationMember.anon_number).where(
                    ConversationMember.event_id == event_id, ConversationMember.is_anonymous
                )
            )
        ).all()
    )
    free = [n for n in range(1, ANON_NUMBER_MAX + 1) if n not in used]
    if not free:  # pragma: no cover - 999 anonymous threads in one event
        raise AppError("INTERNAL_ERROR", 500)
    return secrets.choice(free)


# ── Reading conversations ────────────────────────────────────────────────────


def _encode_cursor(at: datetime, row_id: uuid.UUID) -> str:
    raw = json.dumps([at.isoformat(), str(row_id)]).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        at, row_id = json.loads(base64.urlsafe_b64decode(padded))
        parsed = datetime.fromisoformat(at)
        if parsed.tzinfo is None:
            raise ValueError("naive cursor timestamp")
        return parsed, uuid.UUID(row_id)
    except (ValueError, TypeError, binascii.Error, json.JSONDecodeError) as exc:
        raise AppError(
            "VALIDATION_ERROR", 422, fields=[{"loc": ["query", "cursor"], "type": "value_error"}]
        ) from exc


def _before(columns: tuple[object, object], cursor: str) -> object:
    at, row_id = _decode_cursor(cursor)
    return tuple_(*columns) < tuple_(  # type: ignore[arg-type]
        literal(at, DateTime(timezone=True)), literal(row_id, Uuid())
    )


async def list_conversations(
    session: AsyncSession, viewer: User, event_id: uuid.UUID | None, cursor: str | None
) -> ConversationPage:
    """The viewer's conversations in events they still participate in, most recent
    activity first. An anonymous thread appears to its recipient only once it has a
    message, so its creation time is never visible (PRD FR-CHT-3)."""
    me = ConversationMember
    sort_at = func.coalesce(Conversation.last_message_at, Conversation.created_at)
    stmt = (
        select(Conversation.id, sort_at.label("sort_at"))
        .join(me, and_(me.conversation_id == Conversation.id, me.user_id == viewer.id))
        .join(
            EventParticipant,
            and_(
                EventParticipant.event_id == Conversation.event_id,
                EventParticipant.user_id == viewer.id,
            ),
        )
        .where(
            or_(
                Conversation.kind != ConversationKind.ANONYMOUS,
                me.is_anonymous,
                Conversation.last_message_at.is_not(None),
            )
        )
    )
    if event_id is not None:
        stmt = stmt.where(Conversation.event_id == event_id)
    if cursor:
        stmt = stmt.where(_before((sort_at, Conversation.id), cursor))  # type: ignore[arg-type]
    rows = (
        await session.execute(
            stmt.order_by(sort_at.desc(), Conversation.id.desc()).limit(CONVERSATION_PAGE + 1)
        )
    ).all()
    page = rows[:CONVERSATION_PAGE]
    summaries = await _summaries(session, [row.id for row in page], viewer)
    next_cursor = None
    if len(rows) > CONVERSATION_PAGE:
        last = page[-1]
        next_cursor = _encode_cursor(last.sort_at, last.id)
    return ConversationPage(items=[s for s, _ in summaries], next_cursor=next_cursor)


async def conversation_detail(
    session: AsyncSession, conversation_id: uuid.UUID, viewer: User
) -> ConversationDetail:
    ((summary, members),) = await _summaries(session, [conversation_id], viewer)
    return ConversationDetail(
        **summary.model_dump(),
        members=[build_member_public(member, viewer) for member in members],
    )


async def _summaries(
    session: AsyncSession, ids: Sequence[uuid.UUID], viewer: User
) -> list[tuple[ConversationSummary, list[ConversationMember]]]:
    """Summaries in the order of ``ids`` (each with its members, for the detail view)."""
    if not ids:
        return []
    conversations = {
        c.id: c
        for c in (
            await session.scalars(
                select(Conversation)
                .where(Conversation.id.in_(ids))
                .execution_options(populate_existing=True)
            )
        ).all()
    }
    events = {
        e.id: e
        for e in (
            await session.scalars(
                select(Event).where(Event.id.in_({c.event_id for c in conversations.values()}))
            )
        ).all()
    }
    members: dict[uuid.UUID, list[ConversationMember]] = defaultdict(list)
    for member in (
        await session.scalars(
            select(ConversationMember)
            .where(ConversationMember.conversation_id.in_(ids))
            .options(selectinload(ConversationMember.user))
            .order_by(ConversationMember.created_at, ConversationMember.id)
            .execution_options(populate_existing=True)
        )
    ).all():
        members[member.conversation_id].append(member)
    last_messages = {
        m.conversation_id: m
        for m in (
            await session.scalars(
                select(MessageRow)
                .where(MessageRow.conversation_id.in_(ids))
                .order_by(
                    MessageRow.conversation_id,
                    MessageRow.created_at.desc(),
                    MessageRow.id.desc(),
                )
                .distinct(MessageRow.conversation_id)
            )
        ).all()
    }
    unread = await _unread_counts(session, ids, viewer.id)

    out: list[tuple[ConversationSummary, list[ConversationMember]]] = []
    for conversation_id in ids:
        conversation = conversations[conversation_id]
        event = events[conversation.event_id]
        its_members = members[conversation_id]
        mine = next(m for m in its_members if m.user_id == viewer.id)
        other = None
        if conversation.kind != ConversationKind.GROUP:
            other = next((m for m in its_members if m.id != mine.id), None)
        last = last_messages.get(conversation_id)
        summary = ConversationSummary(
            id=conversation.id,
            event=EventRef(id=event.id, name=event.name, state=cast(EventStateName, event.state)),
            kind=cast(ConversationKindName, conversation.kind),
            title_member=build_member_public(other, viewer) if other is not None else None,
            my_member=build_member_public(mine, viewer),
            last_message=build_message_public(last) if last is not None else None,
            last_message_at=conversation.last_message_at,
            unread_count=unread.get(conversation_id, 0),
        )
        out.append((summary, its_members))
    return out


async def _unread_counts(
    session: AsyncSession, ids: Sequence[uuid.UUID], viewer_id: uuid.UUID
) -> dict[uuid.UUID, int]:
    """Messages from others after my ``last_read_at`` (deleted ones don't count)."""
    me = ConversationMember
    rows = await session.execute(
        select(MessageRow.conversation_id, func.count())
        .join(me, and_(me.conversation_id == MessageRow.conversation_id, me.user_id == viewer_id))
        .where(
            MessageRow.conversation_id.in_(ids),
            MessageRow.sender_member_id != me.id,
            MessageRow.deleted_at.is_(None),
            or_(me.last_read_at.is_(None), MessageRow.created_at > me.last_read_at),
        )
        .group_by(MessageRow.conversation_id)
    )
    return dict(rows.tuples().all())


async def list_messages(
    session: AsyncSession, conversation_id: uuid.UUID, cursor: str | None
) -> MessagePage:
    """Newest first, ``MESSAGE_PAGE`` at a time (PRD FR-CHT-5)."""
    stmt = select(MessageRow).where(MessageRow.conversation_id == conversation_id)
    if cursor:
        stmt = stmt.where(_before((MessageRow.created_at, MessageRow.id), cursor))  # type: ignore[arg-type]
    rows = (
        await session.scalars(
            stmt.order_by(MessageRow.created_at.desc(), MessageRow.id.desc()).limit(
                MESSAGE_PAGE + 1
            )
        )
    ).all()
    page = rows[:MESSAGE_PAGE]
    next_cursor = (
        _encode_cursor(page[-1].created_at, page[-1].id) if len(rows) > MESSAGE_PAGE else None
    )
    return MessagePage(items=[build_message_public(m) for m in page], next_cursor=next_cursor)


# ── Writing ──────────────────────────────────────────────────────────────────


async def send_message(
    session: AsyncSession, redis: "Redis", member: ConversationMember, data: MessageCreate
) -> MessagePublic:
    """Rate limit, persist, bump the conversation, commit, then publish (CLAUDE.md §7 Chat).
    Shared by REST and the WebSocket."""
    if member.user_id is not None:
        await hit_message_limit(redis, member.user_id)
    kind, last_message_at = (
        await session.execute(
            select(Conversation.kind, Conversation.last_message_at).where(
                Conversation.id == member.conversation_id
            )
        )
    ).one()
    first_anonymous = kind == ConversationKind.ANONYMOUS and last_message_at is None
    now = utcnow()
    message = MessageRow(
        conversation_id=member.conversation_id,
        sender_member_id=member.id,
        body=data.body,
        created_at=now,
    )
    session.add(message)
    await session.flush()
    latest = func.coalesce(Conversation.last_message_at, now)
    await session.execute(
        update(Conversation)
        .where(Conversation.id == member.conversation_id)
        .values(last_message_at=func.greatest(latest, now))
    )
    member.last_read_at = now  # you've read what you replied to
    await session.commit()
    public = build_message_public(message)
    await after_message_created(session, redis, public, announce=first_anonymous)
    return public


async def delete_message(session: AsyncSession, redis: "Redis", message: MessageRow) -> None:
    """Soft delete: the body is gone for good, a "Message deleted" placeholder stays."""
    if message.deleted_at is not None:
        return
    message.body = None
    message.deleted_at = utcnow()
    await session.commit()
    await after_message_deleted(redis, message.conversation_id, message.id)


async def mark_read(session: AsyncSession, member: ConversationMember) -> None:
    """Private to the member: nobody else ever sees it (no read receipts)."""
    member.last_read_at = utcnow()
    await session.commit()


# ── Hooks ────────────────────────────────────────────────────────────────────


async def after_message_created(
    session: AsyncSession, redis: "Redis", message: MessagePublic, *, announce: bool
) -> None:
    """After the message is committed: fan it out to the conversation's sockets.

    ``announce``: the first message of an anonymous thread. Only now does the thread
    appear for its recipient (``list_conversations`` hides it until then), so only now are
    they told about it, never at creation (PRD FR-CHT-3)."""
    await publish_to_conversation(redis, message.conversation_id, message_frame(message))
    if announce:
        others = await _member_users(
            session, message.conversation_id, except_member=message.sender_member_id
        )
        await publish_to_users(redis, others, conversation_created_frame(message.conversation_id))
    # Persist, publish, then push (CLAUDE.md §7). The job carries the message id only.
    enqueue_committed(session, "send_message_push", str(message.id))


async def after_message_deleted(
    redis: "Redis", conversation_id: uuid.UUID, message_id: uuid.UUID
) -> None:
    await publish_to_conversation(
        redis, conversation_id, message_deleted_frame(conversation_id, message_id)
    )


async def after_conversation_started(
    session: AsyncSession,
    redis: "Redis",
    conversation_id: uuid.UUID,
    kind: StartKind,
    initiator_id: uuid.UUID,
) -> None:
    """A new direct thread appears for the recipient at once; an anonymous one waits for
    its first message (see ``after_message_created``)."""
    if kind != "direct":
        return
    recipients = [
        uid for uid in await _member_users(session, conversation_id) if uid != initiator_id
    ]
    await publish_to_users(redis, recipients, conversation_created_frame(conversation_id))


async def _member_users(
    session: AsyncSession,
    conversation_id: uuid.UUID,
    *,
    except_member: uuid.UUID | None = None,
) -> list[uuid.UUID]:
    """Internal only: user ids to address ``user:{id}`` channels. Never serialized."""
    stmt = select(ConversationMember.user_id).where(
        ConversationMember.conversation_id == conversation_id,
        ConversationMember.user_id.is_not(None),
    )
    if except_member is not None:
        stmt = stmt.where(ConversationMember.id != except_member)
    return [uid for uid in (await session.scalars(stmt)).all() if uid is not None]
