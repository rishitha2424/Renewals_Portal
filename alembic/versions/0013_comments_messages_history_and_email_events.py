"""0013_comments_messages_history_and_email_events

Revision ID: 0013_comments_messages_history_and_email_events
Revises: 0012_notifications_and_recipients
Create Date: 2026-11-26 23:55:00.000000

Adds:
- deal_comments: edited_at, deleted_at, deleted_by, deleted_by_name
- deal_messages: edited_at, is_deleted, deleted_at, deleted_by, deleted_by_name
- comment_message_history table (version/edit/unsend history)
- message_read_receipts table (per-user read state for DealMessage)
- email_delivery_events table (one row per comment/message event)
- email_outbox: event_id, recipient_user_id, sender_id
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "0013_comments_messages_history_and_email_events"
down_revision: Union[str, Sequence[str], None] = "0012_notifications_and_recipients"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())
    is_pg = conn.dialect.name == "postgresql"
    false_default = sa.text("false") if is_pg else sa.text("0")

    # 1. deal_comments columns (including batch_id / is_deleted if earlier migration omitted them)
    if "deal_comments" in tables:
        cols = {c["name"] for c in inspector.get_columns("deal_comments")}
        if "batch_id" not in cols:
            op.add_column("deal_comments", sa.Column("batch_id", sa.String(64), nullable=True))
        if "is_deleted" not in cols:
            op.add_column(
                "deal_comments",
                sa.Column("is_deleted", sa.Boolean(), server_default=false_default, nullable=False),
            )
        if "edited_at" not in cols:
            op.add_column("deal_comments", sa.Column("edited_at", sa.DateTime(), nullable=True))
        if "deleted_at" not in cols:
            op.add_column("deal_comments", sa.Column("deleted_at", sa.DateTime(), nullable=True))
        if "deleted_by" not in cols:
            op.add_column("deal_comments", sa.Column("deleted_by", sa.String(128), nullable=True))
        if "deleted_by_name" not in cols:
            op.add_column("deal_comments", sa.Column("deleted_by_name", sa.String(255), nullable=True))

    # 1b. users SSO columns if missing
    if "users" in tables:
        u_cols = {c["name"] for c in inspector.get_columns("users")}
        if "last_sso_login" not in u_cols:
            op.add_column("users", sa.Column("last_sso_login", sa.DateTime(), nullable=True))
        if "sso_provider" not in u_cols:
            op.add_column("users", sa.Column("sso_provider", sa.String(64), nullable=True))
        if "sso_subject" not in u_cols:
            op.add_column("users", sa.Column("sso_subject", sa.String(256), nullable=True))

    # 2. deal_messages columns
    if "deal_messages" in tables:
        cols = {c["name"] for c in inspector.get_columns("deal_messages")}
        if "edited_at" not in cols:
            op.add_column("deal_messages", sa.Column("edited_at", sa.DateTime(), nullable=True))
        if "is_deleted" not in cols:
            op.add_column(
                "deal_messages",
                sa.Column("is_deleted", sa.Boolean(), server_default=false_default, nullable=False),
            )
        if "deleted_at" not in cols:
            op.add_column("deal_messages", sa.Column("deleted_at", sa.DateTime(), nullable=True))
        if "deleted_by" not in cols:
            op.add_column("deal_messages", sa.Column("deleted_by", sa.String(128), nullable=True))
        if "deleted_by_name" not in cols:
            op.add_column("deal_messages", sa.Column("deleted_by_name", sa.String(255), nullable=True))

    # 3. comment_message_history table
    if "comment_message_history" not in tables:
        op.create_table(
            "comment_message_history",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("entity_type", sa.String(32), nullable=False),
            sa.Column("entity_id", sa.String(36), nullable=False),
            sa.Column("deal_id", sa.String(100), nullable=True),
            sa.Column("action", sa.String(32), nullable=False),
            sa.Column("previous_text", sa.Text(), nullable=True),
            sa.Column("new_text", sa.Text(), nullable=True),
            sa.Column("previous_visibility", sa.String(32), nullable=True),
            sa.Column("new_visibility", sa.String(32), nullable=True),
            sa.Column("actor_id", sa.String(128), nullable=True),
            sa.Column("actor_name", sa.String(255), nullable=True),
            sa.Column("actor_role", sa.String(50), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_cmh_entity", "comment_message_history", ["entity_type", "entity_id"])
        op.create_index("ix_cmh_deal_id", "comment_message_history", ["deal_id"])

    # 4. message_read_receipts table
    if "message_read_receipts" not in tables:
        op.create_table(
            "message_read_receipts",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("message_id", sa.String(36), sa.ForeignKey("deal_messages.id", ondelete="CASCADE"), nullable=False),
            sa.Column("thread_id", sa.String(36), nullable=False),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("read_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("message_id", "user_id", name="uq_msg_read_user"),
        )
        op.create_index("ix_mrr_message_id", "message_read_receipts", ["message_id"])
        op.create_index("ix_mrr_thread_id", "message_read_receipts", ["thread_id"])
        op.create_index("ix_mrr_user_id", "message_read_receipts", ["user_id"])

    # 5. email_delivery_events table
    if "email_delivery_events" not in tables:
        op.create_table(
            "email_delivery_events",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("event_type", sa.String(50), nullable=False),
            sa.Column("entity_type", sa.String(50), nullable=True),
            sa.Column("entity_id", sa.String(100), nullable=True),
            sa.Column("deal_id", sa.String(100), nullable=True),
            sa.Column("deal_name", sa.String(255), nullable=True),
            sa.Column("author_id", sa.String(128), nullable=True),
            sa.Column("author_name", sa.String(255), nullable=False),
            sa.Column("author_role", sa.String(50), nullable=False),
            sa.Column("subject", sa.String(255), nullable=False),
            sa.Column("body_preview", sa.Text(), nullable=True),
            sa.Column("recipient_summary", sa.String(512), nullable=True),
            sa.Column("selected_recipient_ids", sa.Text(), nullable=True),
            sa.Column("total_count", sa.Integer(), server_default="0", nullable=False),
            sa.Column("sent_count", sa.Integer(), server_default="0", nullable=False),
            sa.Column("failed_count", sa.Integer(), server_default="0", nullable=False),
            sa.Column("skipped_count", sa.Integer(), server_default="0", nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_ede_entity_id", "email_delivery_events", ["entity_id"])
        op.create_index("ix_ede_deal_id", "email_delivery_events", ["deal_id"])
        op.create_index("ix_ede_author_id", "email_delivery_events", ["author_id"])
        op.create_index("ix_ede_created_at", "email_delivery_events", ["created_at"])

    # 6. email_outbox additions
    if "email_outbox" in tables:
        cols = {c["name"] for c in inspector.get_columns("email_outbox")}
        if "event_id" not in cols:
            op.add_column("email_outbox", sa.Column("event_id", sa.String(36), nullable=True))
            try:
                op.create_index("ix_email_outbox_event_id", "email_outbox", ["event_id"])
            except Exception:
                pass
        if "recipient_user_id" not in cols:
            op.add_column("email_outbox", sa.Column("recipient_user_id", sa.String(36), nullable=True))
            try:
                op.create_index("ix_email_outbox_recipient_user_id", "email_outbox", ["recipient_user_id"])
            except Exception:
                pass
        if "sender_id" not in cols:
            op.add_column("email_outbox", sa.Column("sender_id", sa.String(36), nullable=True))
            try:
                op.create_index("ix_email_outbox_sender_id", "email_outbox", ["sender_id"])
            except Exception:
                pass


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = set(inspector.get_table_names())

    if "email_outbox" in tables:
        cols = {c["name"] for c in inspector.get_columns("email_outbox")}
        with op.batch_alter_table("email_outbox") as batch_op:
            for c in ("event_id", "recipient_user_id", "sender_id"):
                if c in cols:
                    batch_op.drop_column(c)

    for tbl in ("email_delivery_events", "message_read_receipts", "comment_message_history"):
        if tbl in tables:
            op.drop_table(tbl)

    if "deal_messages" in tables:
        cols = {c["name"] for c in inspector.get_columns("deal_messages")}
        with op.batch_alter_table("deal_messages") as batch_op:
            for c in ("edited_at", "is_deleted", "deleted_at", "deleted_by", "deleted_by_name"):
                if c in cols:
                    batch_op.drop_column(c)

    if "deal_comments" in tables:
        cols = {c["name"] for c in inspector.get_columns("deal_comments")}
        with op.batch_alter_table("deal_comments") as batch_op:
            for c in ("edited_at", "deleted_at", "deleted_by", "deleted_by_name"):
                if c in cols:
                    batch_op.drop_column(c)

