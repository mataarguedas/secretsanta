"""Per-event wishlists (PRD §4.6, §7). One list per participant per event: the rows are
simply the items with that (event_id, user_id)."""

import uuid
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    Connection,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    Table,
    Text,
    Uuid,
    event,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.mixins import TimestampMixin, UUIDPrimaryKeyMixin

PRIORITIES = ("low", "medium", "high")
MAX_PHOTOS_PER_ITEM = 3


class WishlistItem(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "wishlist_items"
    __table_args__ = (
        CheckConstraint("priority IN ('low', 'medium', 'high')", name="priority_valid"),
        CheckConstraint("price_crc IS NULL OR price_crc >= 0", name="price_non_negative"),
        Index("ix_wishlist_items_event_id_user_id_position", "event_id", "user_id", "position"),
    )

    event_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("events.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    price_crc: Mapped[int | None] = mapped_column(Integer, nullable=True)
    priority: Mapped[str] = mapped_column(
        Text, nullable=False, default="medium", server_default="medium"
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)

    photos: Mapped[list["WishlistPhoto"]] = relationship(
        order_by="WishlistPhoto.position",
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="raise",
    )

    def __repr__(self) -> str:  # never the title or note
        return f"<WishlistItem {self.id} event={self.event_id}>"


class WishlistPhoto(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "wishlist_photos"

    item_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("wishlist_items.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    object_key: Mapped[str] = mapped_column(Text, nullable=False)
    thumb_key: Mapped[str] = mapped_column(Text, nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    position: Mapped[int] = mapped_column(SmallInteger, nullable=False)

    def __repr__(self) -> str:
        return f"<WishlistPhoto {self.id} item={self.item_id}>"


# CLAUDE.md §7: max 3 photos per item, enforced in the service AND here. The trigger locks
# the parent item row first, so two concurrent uploads can't both see "2 photos". The
# migration installs the same SQL; this listener covers `create_all` (the test schema).
# The literal 3 below is MAX_PHOTOS_PER_ITEM (a test asserts they agree).
PHOTO_LIMIT_FUNCTION = """
CREATE OR REPLACE FUNCTION wishlist_photos_limit() RETURNS trigger AS $$
BEGIN
    PERFORM 1 FROM wishlist_items WHERE id = NEW.item_id FOR UPDATE;
    IF (SELECT count(*) FROM wishlist_photos
        WHERE item_id = NEW.item_id AND id <> NEW.id) >= 3 THEN
        RAISE EXCEPTION 'WISHLIST_PHOTO_LIMIT' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
"""
PHOTO_LIMIT_TRIGGER = """
CREATE TRIGGER wishlist_photos_limit
BEFORE INSERT OR UPDATE OF item_id ON wishlist_photos
FOR EACH ROW EXECUTE FUNCTION wishlist_photos_limit();
"""


@event.listens_for(WishlistPhoto.__table__, "after_create")
def _install_photo_limit(_target: Table, connection: Connection, **_kw: Any) -> None:
    connection.execute(text(PHOTO_LIMIT_FUNCTION))
    connection.execute(text(PHOTO_LIMIT_TRIGGER))


@event.listens_for(WishlistPhoto.__table__, "before_drop")
def _drop_photo_limit(_target: Table, connection: Connection, **_kw: Any) -> None:
    connection.execute(text("DROP FUNCTION IF EXISTS wishlist_photos_limit() CASCADE"))
