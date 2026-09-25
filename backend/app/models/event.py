"""Events and their participants (PRD §3, §7)."""

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    Uuid,
    false,
    func,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TimestampMixin, UUIDPrimaryKeyMixin, utcnow


class EventState(StrEnum):
    OPEN = "open"
    DRAWN = "drawn"
    ARCHIVED = "archived"


class Event(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "events"
    __table_args__ = (
        CheckConstraint("budget_crc >= 0", name="budget_non_negative"),
        CheckConstraint("state IN ('open', 'drawn', 'archived')", name="state_valid"),
        CheckConstraint(
            "join_deadline IS NULL OR join_deadline < exchange_at", name="deadline_before_exchange"
        ),
        Index("ix_events_state_exchange_at", "state", "exchange_at"),
    )

    # NULL only for an ARCHIVED event whose host deleted their account (FR-ACC-3): the
    # event stays readable for everyone else and the UI shows "Deleted user". No ON DELETE
    # rule on purpose: account deletion clears or deletes every hosted event itself, so a
    # host row that slipped through fails loudly instead of orphaning an active event.
    host_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    budget_crc: Mapped[int] = mapped_column(Integer, nullable=False)
    exchange_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    join_deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    location: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_online: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    cover_photo_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    group_chat_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=true()
    )
    state: Mapped[str] = mapped_column(
        Text, nullable=False, default=EventState.OPEN, server_default=EventState.OPEN.value
    )
    # NULL = link disabled. Secret: only ever returned to the host.
    invite_token: Mapped[str | None] = mapped_column(Text, unique=True, nullable=True)
    drawn_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    def __repr__(self) -> str:  # never the name or invite token
        return f"<Event {self.id} state={self.state}>"


class EventParticipant(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "event_participants"
    __table_args__ = (UniqueConstraint("event_id", "user_id"),)

    event_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("events.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, server_default=func.now()
    )

    def __repr__(self) -> str:
        return f"<EventParticipant event={self.event_id} user={self.user_id}>"
