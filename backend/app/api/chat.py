"""Chat REST API (PRD §4.7, §8). Every member is serialized through
``build_member_public`` and every message through ``build_message_public``; no response
carries a user id for a member, or anything about presence, typing or read state.

Archived events: history stays readable; sending, deleting and marking read are 409
``CONVERSATION_READ_ONLY``. Starting a conversation there is 409 ``EVENT_ARCHIVED``.
"""

import uuid

from fastapi import APIRouter, Depends, Query, Response
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    EventAccess,
    MemberAccess,
    OwnMessage,
    current_user,
    get_db,
    get_redis,
    require_event_state,
    require_member,
    require_message_sender,
    require_participant,
    require_writable_member,
)
from app.models.event import EventState
from app.models.user import User
from app.schemas.chat import (
    ConversationDetail,
    ConversationPage,
    ConversationStart,
    MessageCreate,
    MessagePage,
    MessagePublic,
)
from app.services import chat as service

router = APIRouter(tags=["chat"])


@router.get("/conversations", response_model=ConversationPage)
async def list_conversations(
    event_id: uuid.UUID | None = None,
    cursor: str | None = Query(default=None, max_length=200),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_db),
) -> ConversationPage:
    """Mine, across events (or one with ``event_id``), most recent activity first."""
    return await service.list_conversations(session, user, event_id, cursor)


@router.post("/events/{event_id}/conversations", response_model=ConversationDetail)
async def start_conversation(
    data: ConversationStart,
    response: Response,
    access: EventAccess = Depends(require_participant),
    _state: EventAccess = Depends(require_event_state(EventState.OPEN, EventState.DRAWN)),
    session: AsyncSession = Depends(get_db),
    redis: "Redis" = Depends(get_redis),
) -> ConversationDetail:
    """Direct or anonymous; idempotent (200 with the existing one, 201 when new)."""
    detail, created = await service.start_conversation(
        session, redis, access.event, access.user, data.recipient_id, data.kind
    )
    response.status_code = 201 if created else 200
    return detail


@router.get("/conversations/{conversation_id}", response_model=ConversationDetail)
async def get_conversation(
    access: MemberAccess = Depends(require_member),
    session: AsyncSession = Depends(get_db),
) -> ConversationDetail:
    return await service.conversation_detail(session, access.conversation.id, access.user)


@router.get("/conversations/{conversation_id}/messages", response_model=MessagePage)
async def list_messages(
    cursor: str | None = Query(default=None, max_length=200),
    access: MemberAccess = Depends(require_member),
    session: AsyncSession = Depends(get_db),
) -> MessagePage:
    return await service.list_messages(session, access.conversation.id, cursor)


@router.post(
    "/conversations/{conversation_id}/messages", status_code=201, response_model=MessagePublic
)
async def send_message(
    data: MessageCreate,
    access: MemberAccess = Depends(require_writable_member),
    session: AsyncSession = Depends(get_db),
    redis: "Redis" = Depends(get_redis),
) -> MessagePublic:
    """30 per rolling minute per user, counted together with WebSocket sends."""
    return await service.send_message(session, redis, access.member, data)


@router.delete("/messages/{message_id}", status_code=204)
async def delete_message(
    own: OwnMessage = Depends(require_message_sender),
    session: AsyncSession = Depends(get_db),
    redis: "Redis" = Depends(get_redis),
) -> Response:
    await service.delete_message(session, redis, own.message)
    return Response(status_code=204)


@router.post("/conversations/{conversation_id}/read", status_code=204)
async def mark_read(
    access: MemberAccess = Depends(require_writable_member),
    session: AsyncSession = Depends(get_db),
) -> Response:
    await service.mark_read(session, access.member)
    return Response(status_code=204)
