"""Chat request/response models (PRD §4.7, §8). CLAUDE.md §2.2 / §7:

- Members are serialized ONLY through ``build_member_public``. An anonymous member is
  shown as its alias ("Secret Elf #N", translated by the client from ``anon_number``)
  with no avatar, to every viewer, the initiator included. No member ever carries a
  user id, name-for-anonymous, or email.
- Messages are serialized ONLY through ``build_message_public``: they name the sender
  member, never a user.
- Nothing here describes presence, typing or read state of other members.
"""

import uuid
from datetime import datetime
from typing import Annotated, Final, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.models.chat import ConversationMember, Message
from app.models.user import User

BODY_MAX: Final = 2000
CLIENT_ID_MAX: Final = 64
FORMER_MEMBER_NAME: Final = "Former participant"  # left or was removed from the event
DELETED_USER_NAME: Final = "Deleted user"  # deleted their account (FR-ACC-3)

ConversationKindName = Literal["direct", "anonymous", "group"]
StartKind = Literal["direct", "anonymous"]
EventStateName = Literal["open", "drawn", "archived"]


def anon_alias(number: int) -> str:
    return f"Secret Elf #{number}"


class MemberPublic(BaseModel):
    id: uuid.UUID  # the member id, never a user id
    display_name: str
    avatar_url: str | None
    is_self: bool
    is_anonymous: bool
    anon_number: int | None
    # No longer in the event (left or removed): shown as a former participant; their past
    # messages stay.
    is_former: bool
    # Deleted their account: shown as "Deleted user"; their messages are emptied.
    # Never set for anonymous members, who stay "Secret Elf #N" (CLAUDE.md §2.2).
    is_deleted: bool


def build_member_public(member: ConversationMember, viewer: User) -> MemberPublic:
    """The one way to serialize a member. ``member.user`` must be loaded (it may be None)."""
    if member.is_anonymous:
        if member.anon_number is None:  # pragma: no cover - the table's CHECK forbids it
            raise ValueError("anonymous member without an anon_number")
        return MemberPublic(
            id=member.id,
            display_name=anon_alias(member.anon_number),
            avatar_url=None,
            is_self=member.user_id is not None and member.user_id == viewer.id,
            is_anonymous=True,
            anon_number=member.anon_number,
            # Always false: flagging a vanished initiator would let the recipient match the
            # alias to whoever just left or deleted their account.
            is_former=False,
            is_deleted=False,
        )
    user = member.user
    if user is None:
        deleted = bool(member.account_deleted)  # None on an unsaved row
        return MemberPublic(
            id=member.id,
            display_name=DELETED_USER_NAME if deleted else FORMER_MEMBER_NAME,
            avatar_url=None,
            is_self=False,
            is_anonymous=False,
            anon_number=None,
            is_former=not deleted,
            is_deleted=deleted,
        )
    return MemberPublic(
        id=member.id,
        display_name=user.name,
        avatar_url=user.avatar_url,
        is_self=user.id == viewer.id,
        is_anonymous=False,
        anon_number=None,
        is_former=False,
        is_deleted=False,
    )


class MessagePublic(BaseModel):
    id: uuid.UUID
    conversation_id: uuid.UUID
    sender_member_id: uuid.UUID
    body: str | None  # None once deleted
    deleted: bool
    created_at: datetime


def build_message_public(message: Message) -> MessagePublic:
    deleted = message.deleted_at is not None
    return MessagePublic(
        id=message.id,
        conversation_id=message.conversation_id,
        sender_member_id=message.sender_member_id,
        body=None if deleted else message.body,
        deleted=deleted,
        created_at=message.created_at,
    )


class EventRef(BaseModel):
    id: uuid.UUID
    name: str
    state: EventStateName


class ConversationSummary(BaseModel):
    id: uuid.UUID
    event: EventRef
    kind: ConversationKindName
    # The other member for direct/anonymous; None for group.
    title_member: MemberPublic | None
    my_member: MemberPublic
    last_message: MessagePublic | None
    last_message_at: datetime | None
    unread_count: int


class ConversationDetail(ConversationSummary):
    members: list[MemberPublic]


class ConversationPage(BaseModel):
    items: list[ConversationSummary]
    next_cursor: str | None


class MessagePage(BaseModel):
    items: list[MessagePublic]  # newest first
    next_cursor: str | None


class ConversationStart(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: StartKind
    recipient_id: uuid.UUID


class MessageCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    body: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=BODY_MAX)
    ]
    # Echoed in the WebSocket ack (Prompt 22) so the client can reconcile its optimistic
    # copy. Opaque to the server.
    client_id: Annotated[str, Field(min_length=1, max_length=CLIENT_ID_MAX)] | None = None
