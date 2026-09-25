"""events.host_id nullable (a deleted host's archived events)

Revision ID: 0010
Revises: 0009
Create Date: 2026-09-25 18:00:00+00:00

FR-ACC-3: deleting an account deletes the OPEN events it hosts and refuses while any is
DRAWN, so only ARCHIVED events can outlive their host. Those stay readable for the other
participants with ``host_id`` NULL, shown as "Deleted user".
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("events", "host_id", existing_type=sa.Uuid(), nullable=True)


def downgrade() -> None:
    # Hostless archived events can't be given a host back; they go with the downgrade.
    op.execute("DELETE FROM events WHERE host_id IS NULL")
    op.alter_column("events", "host_id", existing_type=sa.Uuid(), nullable=False)
