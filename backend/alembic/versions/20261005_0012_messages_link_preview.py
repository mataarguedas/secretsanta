"""messages.link_preview

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-05 12:00:00+00:00

The preview of a message's first link (title, site, picture in R2), filled in by the
worker right after the message is sent. Cleared together with the body.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("messages", sa.Column("link_preview", postgresql.JSONB(), nullable=True))
    op.create_check_constraint(
        op.f("ck_messages_link_preview_only_if_not_deleted"),
        "messages",
        "link_preview IS NULL OR deleted_at IS NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("ck_messages_link_preview_only_if_not_deleted"), "messages", type_="check"
    )
    op.drop_column("messages", "link_preview")
