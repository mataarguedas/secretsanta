"""Host-defined exclusion pairs (PRD §4.4, §7).

A pair is symmetric, so it is stored once in canonical order (``user_a_id < user_b_id``):
that makes the UNIQUE constraint catch both orderings. Visible to the host only.
"""

import uuid

from sqlalchemy import CheckConstraint, ForeignKey, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class Exclusion(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "exclusions"
    __table_args__ = (
        CheckConstraint("user_a_id < user_b_id", name="canonical_order"),
        UniqueConstraint("event_id", "user_a_id", "user_b_id"),
    )

    event_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("events.id", ondelete="CASCADE"), nullable=False
    )
    # CASCADE on users too: a pair naming a deleted account means nothing (Prompt 28).
    user_a_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    user_b_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )

    def __repr__(self) -> str:
        return f"<Exclusion {self.id} event={self.event_id}>"
