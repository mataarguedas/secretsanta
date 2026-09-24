"""Chat (PRD §4.7, §7): conversations, their members and messages.

Anonymity lives in this schema: a message points at a *member* (``sender_member_id``),
never at a user, and an anonymous initiator's member row is the only place that ties the
alias to a user. That ``user_id`` must never leave the backend (CLAUDE.md §2.2); serialize
members only through ``app.schemas.chat.build_member_public``.
"""

import uuid
from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    SmallInteger,
    Text,
    UniqueConstraint,
    Uuid,
    false,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.mixins import TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.user import User

ANON_NUMBER_MAX = 999


class ConversationKind(StrEnum):
    DIRECT = "direct"
    ANONYMOUS = "anonymous"
    GROUP = "group"


class Conversation(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "conversations"
    __table_args__ = (
        CheckConstraint("kind IN ('direct', 'anonymous', 'group')", name="kind_valid"),
        CheckConstraint("(kind = 'group') = (pair_key IS NULL)", name="pair_key_unless_group"),
        Index(
            "ix_conversations_event_id_last_message_at",
            "event_id",
            text("last_message_at DESC"),
        ),
        # At most one group conversation per event.
        Index(
            "uq_conversations_group_per_event",
            "event_id",
            unique=True,
            postgresql_where=text("kind = 'group'"),
        ),
    )

    event_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("events.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Internal only, never serialized: 'd:{event}:{min}:{max}' / 'a:{event}:{from}:{to}'.
    pair_key: Mapped[str | None] = mapped_column(Text, unique=True, nullable=True)

    members: Mapped[list["ConversationMember"]] = relationship(
        back_populates="conversation", lazy="raise", passive_deletes=True
    )

    def __repr__(self) -> str:  # never the pair key: it names both users
        return f"<Conversation {self.id} kind={self.kind}>"


class ConversationMember(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "conversation_members"
    __table_args__ = (
        UniqueConstraint("conversation_id", "user_id"),
        CheckConstraint(
            "(is_anonymous AND anon_number BETWEEN 1 AND 999)"
            " OR (NOT is_anonymous AND anon_number IS NULL)",
            name="anon_number_iff_anonymous",
        ),
        # "Secret Elf #N" is unique within the event, per thread (PRD FR-CHT-3).
        Index(
            "uq_conversation_members_event_id_anon_number",
            "event_id",
            "anon_number",
            unique=True,
            postgresql_where=text("is_anonymous"),
        ),
    )

    conversation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )
    # Denormalized from the conversation, for the per-event anon_number uniqueness.
    event_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("events.id", ondelete="CASCADE"), nullable=False
    )
    # NULL once the user deleted their account or left the event's group chat: their
    # messages stay, attributed to a former member. NEVER serialized for anonymous rows.
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    is_anonymous: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    anon_number: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    # Private to this member: never shown to anyone else (no read receipts).
    last_read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    conversation: Mapped[Conversation] = relationship(back_populates="members", lazy="raise")
    user: Mapped["User | None"] = relationship(lazy="raise")

    def __repr__(self) -> str:  # never the user id: for anonymous rows it IS the secret
        return f"<ConversationMember {self.id} conversation={self.conversation_id}>"


class Message(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "messages"
    __table_args__ = (
        Index(
            "ix_messages_conversation_id_created_at",
            "conversation_id",
            text("created_at DESC"),
        ),
        CheckConstraint("(body IS NULL) = (deleted_at IS NOT NULL)", name="body_iff_not_deleted"),
    )

    conversation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )
    sender_member_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("conversation_members.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    body: Mapped[str | None] = mapped_column(Text, nullable=True)  # NULL when deleted
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    def __repr__(self) -> str:  # never the body
        return f"<Message {self.id} conversation={self.conversation_id}>"
