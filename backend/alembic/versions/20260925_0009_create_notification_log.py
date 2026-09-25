"""create notification_log

Revision ID: 0009
Revises: 0008
Create Date: 2026-09-25 02:04:31.304665+00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # PRD §7: reminders are idempotent per (user, event, kind); debounced wishlist pushes
    # may repeat, so the unique index is partial.
    op.create_table(
        "notification_log",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=False),
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
            name=op.f("fk_notification_log_event_id_events"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_notification_log_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_notification_log")),
    )
    op.create_index(
        op.f("ix_notification_log_event_id"), "notification_log", ["event_id"], unique=False
    )
    op.create_index(
        "uq_notification_log_user_id_event_id_kind",
        "notification_log",
        ["user_id", "event_id", "kind"],
        unique=True,
        postgresql_where=sa.text("kind IN ('reminder_7d', 'reminder_1d')"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_notification_log_user_id_event_id_kind",
        table_name="notification_log",
        postgresql_where=sa.text("kind IN ('reminder_7d', 'reminder_1d')"),
    )
    op.drop_index(op.f("ix_notification_log_event_id"), table_name="notification_log")
    op.drop_table("notification_log")
