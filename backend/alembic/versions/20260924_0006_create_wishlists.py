"""create wishlists

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-24 21:42:16.980628+00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # PRD §7: per-event wishlist items (ordered by position) and their photos.
    op.create_table(
        "wishlist_items",
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("url", sa.Text(), nullable=True),
        sa.Column("price_crc", sa.Integer(), nullable=True),
        sa.Column("priority", sa.Text(), server_default="medium", nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "priority IN ('low', 'medium', 'high')", name=op.f("ck_wishlist_items_priority_valid")
        ),
        sa.CheckConstraint(
            "price_crc IS NULL OR price_crc >= 0", name=op.f("ck_wishlist_items_price_non_negative")
        ),
        sa.ForeignKeyConstraint(
            ["event_id"],
            ["events.id"],
            name=op.f("fk_wishlist_items_event_id_events"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_wishlist_items_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_wishlist_items")),
    )
    op.create_index(
        "ix_wishlist_items_event_id_user_id_position",
        "wishlist_items",
        ["event_id", "user_id", "position"],
        unique=False,
    )
    op.create_table(
        "wishlist_photos",
        sa.Column("item_id", sa.Uuid(), nullable=False),
        sa.Column("object_key", sa.Text(), nullable=False),
        sa.Column("thumb_key", sa.Text(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("position", sa.SmallInteger(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["item_id"],
            ["wishlist_items.id"],
            name=op.f("fk_wishlist_photos_item_id_wishlist_items"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_wishlist_photos")),
    )
    op.create_index(
        op.f("ix_wishlist_photos_item_id"), "wishlist_photos", ["item_id"], unique=False
    )
    # CLAUDE.md §7: at most 3 photos per item, also enforced by the database. The parent
    # item row is locked first so concurrent uploads can't both pass the count. Inlined on
    # purpose (a migration must not change when app code does); it matches
    # app/models/wishlist.py, which installs the same trigger for create_all.
    op.execute(
        """
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
    )
    op.execute(
        """
        CREATE TRIGGER wishlist_photos_limit
        BEFORE INSERT OR UPDATE OF item_id ON wishlist_photos
        FOR EACH ROW EXECUTE FUNCTION wishlist_photos_limit();
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS wishlist_photos_limit ON wishlist_photos")
    op.execute("DROP FUNCTION IF EXISTS wishlist_photos_limit()")
    op.drop_index(op.f("ix_wishlist_photos_item_id"), table_name="wishlist_photos")
    op.drop_table("wishlist_photos")
    op.drop_index("ix_wishlist_items_event_id_user_id_position", table_name="wishlist_items")
    op.drop_table("wishlist_items")
