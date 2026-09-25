"""Sent-push log (PRD §7): idempotency for scheduled pushes and a record of debounced ones.

Kinds: ``reminder_7d`` / ``reminder_1d`` (at most once per user and event, enforced by a
partial unique index) and ``wishlist_debounce`` (one row per debounced wishlist push; the
row names the recipient, never the wishlist owner).
"""

import uuid
from datetime import datetime
from typing import Final

from sqlalchemy import DateTime, ForeignKey, Index, Text, Uuid, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TimestampMixin, UUIDPrimaryKeyMixin, utcnow

REMINDER_KINDS: Final = ("reminder_7d", "reminder_1d")
WISHLIST_DEBOUNCE: Final = "wishlist_debounce"


class NotificationLog(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "notification_log"
    __table_args__ = (
        Index(
            "uq_notification_log_user_id_event_id_kind",
            "user_id",
            "event_id",
            "kind",
            unique=True,
            postgresql_where=text("kind IN ('reminder_7d', 'reminder_1d')"),
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    event_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("events.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    sent_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )

    def __repr__(self) -> str:
        return f"<NotificationLog {self.id} {self.kind}>"
