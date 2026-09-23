"""create events and event_participants

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-23 20:22:08.721031+00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # PRD §7: events (state machine open → drawn → archived; invite_token NULL = link disabled)
    # and event_participants (the host is a participant too).
    op.create_table(
        "events",
        sa.Column("host_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("budget_crc", sa.Integer(), nullable=False),
        sa.Column("exchange_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("join_deadline", sa.DateTime(timezone=True), nullable=True),
        sa.Column("location", sa.Text(), nullable=True),
        sa.Column("is_online", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("cover_photo_key", sa.Text(), nullable=True),
        sa.Column(
            "group_chat_enabled", sa.Boolean(), server_default=sa.text("true"), nullable=False
        ),
        sa.Column("state", sa.Text(), server_default="open", nullable=False),
        sa.Column("invite_token", sa.Text(), nullable=True),
        sa.Column("drawn_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
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
            "state IN ('open', 'drawn', 'archived')", name=op.f("ck_events_state_valid")
        ),
        sa.CheckConstraint("budget_crc >= 0", name=op.f("ck_events_budget_non_negative")),
        sa.CheckConstraint(
            "join_deadline IS NULL OR join_deadline < exchange_at",
            name=op.f("ck_events_deadline_before_exchange"),
        ),
        sa.ForeignKeyConstraint(["host_id"], ["users.id"], name=op.f("fk_events_host_id_users")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_events")),
        sa.UniqueConstraint("invite_token", name=op.f("uq_events_invite_token")),
    )
    op.create_index(op.f("ix_events_host_id"), "events", ["host_id"], unique=False)
    op.create_index("ix_events_state_exchange_at", "events", ["state", "exchange_at"], unique=False)
    op.create_table(
        "event_participants",
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "joined_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
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
            ["event_id"],
            ["events.id"],
            name=op.f("fk_event_participants_event_id_events"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_event_participants_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_event_participants")),
        sa.UniqueConstraint(
            "event_id", "user_id", name=op.f("uq_event_participants_event_id_user_id")
        ),
    )
    op.create_index(
        op.f("ix_event_participants_user_id"), "event_participants", ["user_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_event_participants_user_id"), table_name="event_participants")
    op.drop_table("event_participants")
    op.drop_index("ix_events_state_exchange_at", table_name="events")
    op.drop_index(op.f("ix_events_host_id"), table_name="events")
    op.drop_table("events")
