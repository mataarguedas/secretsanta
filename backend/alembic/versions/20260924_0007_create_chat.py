"""create chat

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-24 22:23:13.489068+00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # PRD §4.7, §7: conversations, members (the anonymity boundary) and messages.
    op.create_table(
        "conversations",
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("pair_key", sa.Text(), nullable=True),
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
            "(kind = 'group') = (pair_key IS NULL)",
            name=op.f("ck_conversations_pair_key_unless_group"),
        ),
        sa.CheckConstraint(
            "kind IN ('direct', 'anonymous', 'group')", name=op.f("ck_conversations_kind_valid")
        ),
        sa.ForeignKeyConstraint(
            ["event_id"],
            ["events.id"],
            name=op.f("fk_conversations_event_id_events"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_conversations")),
        sa.UniqueConstraint("pair_key", name=op.f("uq_conversations_pair_key")),
    )
    op.create_index(
        "ix_conversations_event_id_last_message_at",
        "conversations",
        ["event_id", sa.literal_column("last_message_at DESC")],
        unique=False,
    )
    op.create_index(
        "uq_conversations_group_per_event",
        "conversations",
        ["event_id"],
        unique=True,
        postgresql_where=sa.text("kind = 'group'"),
    )
    op.create_table(
        "conversation_members",
        sa.Column("conversation_id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("is_anonymous", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("anon_number", sa.SmallInteger(), nullable=True),
        sa.Column("last_read_at", sa.DateTime(timezone=True), nullable=True),
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
            "(is_anonymous AND anon_number BETWEEN 1 AND 999)"
            " OR (NOT is_anonymous AND anon_number IS NULL)",
            name=op.f("ck_conversation_members_anon_number_iff_anonymous"),
        ),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["conversations.id"],
            name=op.f("fk_conversation_members_conversation_id_conversations"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["event_id"],
            ["events.id"],
            name=op.f("fk_conversation_members_event_id_events"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_conversation_members_user_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_conversation_members")),
        sa.UniqueConstraint(
            "conversation_id",
            "user_id",
            name=op.f("uq_conversation_members_conversation_id_user_id"),
        ),
    )
    op.create_index(
        op.f("ix_conversation_members_user_id"), "conversation_members", ["user_id"], unique=False
    )
    op.create_index(
        "uq_conversation_members_event_id_anon_number",
        "conversation_members",
        ["event_id", "anon_number"],
        unique=True,
        postgresql_where=sa.text("is_anonymous"),
    )
    op.create_table(
        "messages",
        sa.Column("conversation_id", sa.Uuid(), nullable=False),
        sa.Column("sender_member_id", sa.Uuid(), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
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
            "(body IS NULL) = (deleted_at IS NOT NULL)",
            name=op.f("ck_messages_body_iff_not_deleted"),
        ),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["conversations.id"],
            name=op.f("fk_messages_conversation_id_conversations"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["sender_member_id"],
            ["conversation_members.id"],
            name=op.f("fk_messages_sender_member_id_conversation_members"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_messages")),
    )
    op.create_index(
        "ix_messages_conversation_id_created_at",
        "messages",
        ["conversation_id", sa.literal_column("created_at DESC")],
        unique=False,
    )
    op.create_index(
        op.f("ix_messages_sender_member_id"), "messages", ["sender_member_id"], unique=False
    )

    # Events created before chat existed get their group conversation (FR-CHT-1), with
    # every current participant as a member.
    op.execute(
        """
        INSERT INTO conversations (id, event_id, kind, created_at, updated_at)
        SELECT gen_random_uuid(), e.id, 'group', now(), now()
        FROM events e WHERE e.group_chat_enabled
        """
    )
    op.execute(
        """
        INSERT INTO conversation_members
            (id, conversation_id, event_id, user_id, is_anonymous, created_at, updated_at)
        SELECT gen_random_uuid(), c.id, c.event_id, p.user_id, false, now(), now()
        FROM conversations c JOIN event_participants p ON p.event_id = c.event_id
        WHERE c.kind = 'group'
        """
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_messages_sender_member_id"), table_name="messages")
    op.drop_index("ix_messages_conversation_id_created_at", table_name="messages")
    op.drop_table("messages")
    op.drop_index(
        "uq_conversation_members_event_id_anon_number",
        table_name="conversation_members",
        postgresql_where=sa.text("is_anonymous"),
    )
    op.drop_index(op.f("ix_conversation_members_user_id"), table_name="conversation_members")
    op.drop_table("conversation_members")
    op.drop_index(
        "uq_conversations_group_per_event",
        table_name="conversations",
        postgresql_where=sa.text("kind = 'group'"),
    )
    op.drop_index("ix_conversations_event_id_last_message_at", table_name="conversations")
    op.drop_table("conversations")
