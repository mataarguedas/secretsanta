"""conversation_members.account_deleted

Revision ID: 0011
Revises: 0010
Create Date: 2026-09-25 18:01:00+00:00

FR-ACC-3: tells a member whose user deleted their account ("Deleted user") apart from one
who left the event's group chat ("Former participant"). Both have ``user_id`` NULL.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "conversation_members",
        sa.Column("account_deleted", sa.Boolean(), server_default=sa.false(), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("conversation_members", "account_deleted")
