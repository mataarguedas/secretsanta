"""The product pushes (PRD §4.8, §5), run by the worker's arq tasks.

Each function gets only ids from the queue and looks everything else up here, inside the
worker: the queue never carries a name, a message body or an assignment.

- ``send_reveal``: every participant, "the draw is done". Never who anyone got.
- ``send_message_push``: the other members, minus whoever has the thread open; the sender
  as that recipient would see them (``build_member_public``), so an anonymous sender is
  only ever "Secret Elf #N".
- ``send_wishlist_updated``: only the owner's giver, looked up here. The text never names
  the owner (FR-NTF-4).
"""

import uuid

from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.logging import get_logger
from app.models.assignment import Assignment
from app.models.chat import Conversation, ConversationMember, Message
from app.models.event import Event, EventParticipant, EventState
from app.models.notification_log import WISHLIST_DEBOUNCE, NotificationLog
from app.models.user import User
from app.notifications.sender import NotifyResult, notify
from app.notifications.templates import preview, sender_label
from app.realtime.channels import active_key
from app.schemas.chat import build_member_public

log = get_logger(__name__)


async def send_reveal(session: AsyncSession, event_id: uuid.UUID) -> NotifyResult:
    event = await session.get(Event, event_id)
    if event is None or event.state != EventState.DRAWN:
        return NotifyResult()
    participants = await session.scalars(
        select(EventParticipant.user_id).where(EventParticipant.event_id == event_id)
    )
    return await notify(
        session,
        participants.all(),
        "reveal",
        {"event": event.name, "url": f"/events/{event_id}", "tag": f"reveal:{event_id}"},
    )


async def send_message_push(
    session: AsyncSession, redis: "Redis", message_id: uuid.UUID
) -> NotifyResult:
    message = await session.get(Message, message_id)
    if message is None or message.body is None:  # deleted before the worker got to it
        return NotifyResult()
    conversation = await session.scalar(
        select(Conversation)
        .where(Conversation.id == message.conversation_id)
        .options(selectinload(Conversation.members).selectinload(ConversationMember.user))
    )
    event = await session.get(Event, conversation.event_id) if conversation else None
    if conversation is None or event is None:  # pragma: no cover - cascades delete both
        return NotifyResult()

    sender = next(m for m in conversation.members if m.id == message.sender_member_id)
    still_in = set(
        (
            await session.scalars(
                select(EventParticipant.user_id).where(EventParticipant.event_id == event.id)
            )
        ).all()
    )
    recipients: dict[uuid.UUID, ConversationMember] = {
        m.user_id: m
        for m in conversation.members
        if m.user_id is not None
        and m.id != sender.id
        and m.user_id != sender.user_id
        and m.user_id in still_in
    }
    # FR-NTF-6: no push for a thread that's open on the recipient's screen.
    for user_id in list(recipients):
        if await redis.get(active_key(user_id)) == str(conversation.id):
            del recipients[user_id]

    body = preview(message.body)

    def context(user: User) -> dict[str, object]:
        public = build_member_public(sender, user)
        name = sender_label(
            user.locale,
            sender=public.display_name,
            anon_number=public.anon_number,
            former=public.is_former and not public.is_anonymous,
        )
        return {
            "event": event.name,
            "sender": name,
            "preview": body,
            "url": f"/chats/{conversation.id}",
            "tag": f"conv:{conversation.id}",  # one notification per thread (FR-NTF-5)
        }

    return await notify(session, recipients, "message", context)


async def send_wishlist_updated(
    session: AsyncSession, event_id: uuid.UUID, owner_id: uuid.UUID
) -> NotifyResult:
    event = await session.get(Event, event_id)
    if event is None or event.state != EventState.DRAWN:
        return NotifyResult()
    giver_id = await session.scalar(
        select(Assignment.giver_id).where(
            Assignment.event_id == event_id, Assignment.receiver_id == owner_id
        )
    )
    if giver_id is None:  # the owner left the draw's roster: nobody to tell
        return NotifyResult()
    # The log names the recipient only: never the owner, so it holds no pair.
    session.add(NotificationLog(user_id=giver_id, event_id=event_id, kind=WISHLIST_DEBOUNCE))
    await session.flush()
    return await notify(
        session,
        [giver_id],
        "wishlist_updated",
        {
            "event": event.name,
            "url": f"/events/{event_id}/wishlists?user={owner_id}",
            "tag": f"wishlist:{event_id}",
        },
    )
