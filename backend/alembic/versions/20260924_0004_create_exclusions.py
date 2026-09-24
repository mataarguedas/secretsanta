"""create exclusions

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-24 19:38:18.810721+00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # PRD §7: symmetric pairs stored once, canonical order (user_a_id < user_b_id), so the
    # UNIQUE constraint also rejects the reversed pair. The event_id prefix serves lookups.
    op.create_table(
        "exclusions",
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("user_a_id", sa.Uuid(), nullable=False),
        sa.Column("user_b_id", sa.Uuid(), nullable=False),
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
        sa.CheckConstraint("user_a_id < user_b_id", name=op.f("ck_exclusions_canonical_order")),
        sa.ForeignKeyConstraint(
            ["event_id"],
            ["events.id"],
            name=op.f("fk_exclusions_event_id_events"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_a_id"],
            ["users.id"],
            name=op.f("fk_exclusions_user_a_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_b_id"],
            ["users.id"],
            name=op.f("fk_exclusions_user_b_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_exclusions")),
        sa.UniqueConstraint(
            "event_id",
            "user_a_id",
            "user_b_id",
            name=op.f("uq_exclusions_event_id_user_a_id_user_b_id"),
        ),
    )


def downgrade() -> None:
    op.drop_table("exclusions")
