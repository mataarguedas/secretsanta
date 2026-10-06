"""users.name_customized

Revision ID: 0013
Revises: 0012
Create Date: 2026-10-06 12:00:00+00:00

True once the user has set their own display name in Profile. Sign-in keeps refreshing the
Google name only while it is false.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("name_customized", sa.Boolean(), server_default=sa.false(), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("users", "name_customized")
