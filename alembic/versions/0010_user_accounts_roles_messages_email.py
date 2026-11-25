"""0010_user_accounts_roles_messages_email

Revision ID: 0010_user_accounts_roles_messages_email
Revises: 0009_create_deal_comments
Create Date: 2026-11-22 12:35:00.000000

Creates tables for users, user_aliases, user_tokens, deal_messages,
email_outbox, audit_logs, and owner_sync_alerts.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '0010_user_accounts_roles_messages_email'
down_revision: Union[str, Sequence[str], None] = '0009_create_deal_comments'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    # 1. users table
    if 'users' not in tables:
        op.create_table(
            'users',
            sa.Column('id', sa.String(36), primary_key=True),
            sa.Column('email', sa.String(255), nullable=False),
            sa.Column('name', sa.String(255), nullable=False),
            sa.Column('role', sa.String(50), server_default='kam', nullable=False),
            sa.Column('owner_name', sa.String(256), nullable=True),
            sa.Column('mobileum_id', sa.String(100), nullable=True),
            sa.Column('status', sa.String(50), server_default='invited', nullable=False),
            sa.Column('password_hash', sa.String(255), nullable=True),
            sa.Column('must_change_password', sa.Boolean(), server_default='0', nullable=False),
            sa.Column('last_login', sa.DateTime(), nullable=True),
            sa.Column('failed_login_attempts', sa.Integer(), server_default='0', nullable=False),
            sa.Column('lockout_until', sa.DateTime(), nullable=True),
            sa.Column('is_owner', sa.Boolean(), server_default='0', nullable=False),
            sa.Column('email_notifications', sa.Boolean(), server_default='1', nullable=False),
            sa.Column('token_version', sa.Integer(), server_default='1', nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.Column('updated_at', sa.DateTime(), nullable=False),
        )
        try:
            op.create_index('ix_users_email', 'users', ['email'], unique=True)
            op.create_index('ix_users_owner_name', 'users', ['owner_name'])
            op.create_index('ix_users_role', 'users', ['role'])
            op.create_index('ix_users_status', 'users', ['status'])
        except Exception:
            pass

    # 2. user_aliases table
    if 'user_aliases' not in tables:
        op.create_table(
            'user_aliases',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
            sa.Column('alias', sa.String(256), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.UniqueConstraint('user_id', 'alias', name='uq_user_alias'),
        )
        try:
            op.create_index('ix_user_aliases_user_id', 'user_aliases', ['user_id'])
            op.create_index('ix_user_aliases_alias', 'user_aliases', ['alias'])
        except Exception:
            pass

    # 3. user_tokens table
    if 'user_tokens' not in tables:
        op.create_table(
            'user_tokens',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
            sa.Column('token_hash', sa.String(128), nullable=False),
            sa.Column('token_type', sa.String(50), nullable=False),
            sa.Column('expires_at', sa.DateTime(), nullable=False),
            sa.Column('used_at', sa.DateTime(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=False),
        )
        try:
            op.create_index('ix_user_tokens_user_id', 'user_tokens', ['user_id'])
            op.create_index('ix_user_tokens_token_hash', 'user_tokens', ['token_hash'])
            op.create_index('ix_user_tokens_type', 'user_tokens', ['token_type'])
        except Exception:
            pass

    # 4. deal_messages table
    if 'deal_messages' not in tables:
        op.create_table(
            'deal_messages',
            sa.Column('id', sa.String(36), primary_key=True),
            sa.Column('deal_id', sa.String(100), nullable=False),
            sa.Column('thread_id', sa.String(36), nullable=False),
            sa.Column('sender_id', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
            sa.Column('recipient_id', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
            sa.Column('sender_name', sa.String(255), nullable=False),
            sa.Column('sender_role', sa.String(50), nullable=False),
            sa.Column('recipient_name', sa.String(255), nullable=True),
            sa.Column('subject', sa.String(255), nullable=True),
            sa.Column('body', sa.Text(), nullable=False),
            sa.Column('priority', sa.String(20), server_default='normal', nullable=False),
            sa.Column('is_read', sa.Boolean(), server_default='0', nullable=False),
            sa.Column('thread_status', sa.String(20), server_default='open', nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=False),
        )
        try:
            op.create_index('ix_deal_messages_deal_id', 'deal_messages', ['deal_id'])
            op.create_index('ix_deal_messages_thread_id', 'deal_messages', ['thread_id'])
            op.create_index('ix_deal_messages_recipient_id', 'deal_messages', ['recipient_id'])
            op.create_index('ix_deal_messages_sender_id', 'deal_messages', ['sender_id'])
            op.create_index('ix_deal_messages_is_read', 'deal_messages', ['is_read'])
        except Exception:
            pass

    # 5. email_outbox table
    if 'email_outbox' not in tables:
        op.create_table(
            'email_outbox',
            sa.Column('id', sa.String(36), primary_key=True),
            sa.Column('recipient_email', sa.String(255), nullable=False),
            sa.Column('recipient_name', sa.String(255), nullable=True),
            sa.Column('subject', sa.String(255), nullable=False),
            sa.Column('body_html', sa.Text(), nullable=False),
            sa.Column('body_text', sa.Text(), nullable=True),
            sa.Column('template_type', sa.String(50), nullable=False),
            sa.Column('status', sa.String(50), server_default='pending – email not configured', nullable=False),
            sa.Column('error_message', sa.Text(), nullable=True),
            sa.Column('retry_count', sa.Integer(), server_default='0', nullable=False),
            sa.Column('sent_at', sa.DateTime(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=False),
        )
        try:
            op.create_index('ix_email_outbox_recipient', 'email_outbox', ['recipient_email'])
            op.create_index('ix_email_outbox_status', 'email_outbox', ['status'])
            op.create_index('ix_email_outbox_created_at', 'email_outbox', ['created_at'])
        except Exception:
            pass

    # 6. audit_logs table
    if 'audit_logs' not in tables:
        op.create_table(
            'audit_logs',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('event_type', sa.String(50), nullable=False),
            sa.Column('user_id', sa.String(36), nullable=True),
            sa.Column('user_email', sa.String(255), nullable=True),
            sa.Column('ip_address', sa.String(100), nullable=True),
            sa.Column('details', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=False),
        )
        try:
            op.create_index('ix_audit_logs_event_type', 'audit_logs', ['event_type'])
            op.create_index('ix_audit_logs_user_id', 'audit_logs', ['user_id'])
            op.create_index('ix_audit_logs_created_at', 'audit_logs', ['created_at'])
        except Exception:
            pass

    # 7. owner_sync_alerts table
    if 'owner_sync_alerts' not in tables:
        op.create_table(
            'owner_sync_alerts',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('alert_type', sa.String(50), nullable=False),
            sa.Column('owner_name', sa.String(256), nullable=False),
            sa.Column('deal_count', sa.Integer(), server_default='0', nullable=False),
            sa.Column('suggested_match', sa.String(256), nullable=True),
            sa.Column('details', sa.Text(), nullable=True),
            sa.Column('is_resolved', sa.Boolean(), server_default='0', nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.Column('resolved_at', sa.DateTime(), nullable=True),
        )
        try:
            op.create_index('ix_owner_sync_alerts_type', 'owner_sync_alerts', ['alert_type'])
            op.create_index('ix_owner_sync_alerts_resolved', 'owner_sync_alerts', ['is_resolved'])
        except Exception:
            pass


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    for tbl in [
        'owner_sync_alerts',
        'audit_logs',
        'email_outbox',
        'deal_messages',
        'user_tokens',
        'user_aliases',
        'users',
    ]:
        if tbl in tables:
            op.drop_table(tbl)

