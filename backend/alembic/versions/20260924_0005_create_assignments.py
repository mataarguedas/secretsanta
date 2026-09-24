"""create assignments

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-24 20:02:09.778490+00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # PRD §7: the draw result. SECRET (CLAUDE.md §2.1): each participant gives once and
    # receives once per event, never to themselves.
    op.create_table(
        "assignments",
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("giver_id", sa.Uuid(), nullable=False),
        sa.Column("receiver_id", sa.Uuid(), nullable=False),
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
            "giver_id <> receiver_id", name=op.f("ck_assignments_no_self_assignment")
        ),
        sa.ForeignKeyConstraint(
            ["event_id"],
            ["events.id"],
            name=op.f("fk_assignments_event_id_events"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["giver_id"],
            ["users.id"],
            name=op.f("fk_assignments_giver_id_users"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["receiver_id"],
            ["users.id"],
            name=op.f("fk_assignments_receiver_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_assignments")),
        sa.UniqueConstraint("event_id", "giver_id", name=op.f("uq_assignments_event_id_giver_id")),
        sa.UniqueConstraint(
            "event_id", "receiver_id", name=op.f("uq_assignments_event_id_receiver_id")
        ),
    )


def downgrade() -> None:
    op.drop_table("assignments")
