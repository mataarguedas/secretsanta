"""The draw result (PRD §7). SECRET: a user may only ever read the row where they are the
giver (CLAUDE.md §2.1). Never log, serialize or list these rows anywhere else."""

import uuid

from sqlalchemy import CheckConstraint, ForeignKey, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class Assignment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "assignments"
    __table_args__ = (
        UniqueConstraint("event_id", "giver_id"),
        UniqueConstraint("event_id", "receiver_id"),
        CheckConstraint("giver_id <> receiver_id", name="no_self_assignment"),
    )

    event_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("events.id", ondelete="CASCADE"), nullable=False
    )
    # Account deletion is refused while the user is in a DRAWN event (CLAUDE.md §2.3), so
    # these only cascade for archived events.
    giver_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    receiver_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )

    def __repr__(self) -> str:  # never the pair
        return f"<Assignment {self.id} event={self.event_id}>"
