"""0012_notifications_and_recipients

Revision ID: 0012_notifications_and_recipients
Revises: 0011_custom_column_and_comment_visibility_and_roles
Create Date: 2026-11-25 00:00:00.000000

Adds notifications table and recipient_ids column to deal_messages and deal_comments:
- notifications table: id, user_id, category, title, message, deal_id, deal_name, target_type, target_id, is_read, created_at, read_at
- deal_messages.recipient_ids: text/json list of selected user recipient IDs
- deal_comments.recipient_ids: text/json list of selected user recipient IDs
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '0012_notifications_and_recipients'
down_revision: Union[str, Sequence[str], None] = '0011_custom_column_and_comment_visibility_and_roles'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    # 1. notifications table
    if 'notifications' not in tables:
        op.create_table(
            'notifications',
            sa.Column('id', sa.String(36), primary_key=True),
            sa.Column('user_id', sa.String(36), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
            sa.Column('category', sa.String(50), nullable=False),
            sa.Column('title', sa.String(255), nullable=False),
            sa.Column('message', sa.Text(), nullable=False),
            sa.Column('deal_id', sa.String(100), nullable=True),
            sa.Column('deal_name', sa.String(255), nullable=True),
            sa.Column('target_type', sa.String(50), nullable=False),
            sa.Column('target_id', sa.String(100), nullable=True),
            sa.Column('is_read', sa.Boolean(), server_default='0', nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.Column('read_at', sa.DateTime(), nullable=True),
        )
        op.create_index('ix_notifications_user_id', 'notifications', ['user_id'])
        op.create_index('ix_notifications_category', 'notifications', ['category'])
        op.create_index('ix_notifications_is_read', 'notifications', ['is_read'])
        op.create_index('ix_notifications_deal_id', 'notifications', ['deal_id'])

    # 2. recipient_ids in deal_messages
    if 'deal_messages' in tables:
        msg_cols = {c['name'] for c in inspector.get_columns('deal_messages')}
        if 'recipient_ids' not in msg_cols:
            op.add_column('deal_messages', sa.Column('recipient_ids', sa.Text(), nullable=True))

    # 3. recipient_ids in deal_comments
    if 'deal_comments' in tables:
        comment_cols = {c['name'] for c in inspector.get_columns('deal_comments')}
        if 'recipient_ids' not in comment_cols:
            op.add_column('deal_comments', sa.Column('recipient_ids', sa.Text(), nullable=True))

    # 4. email_outbox deal and role attribution
    if 'email_outbox' in tables:
        outbox_cols = {c['name'] for c in inspector.get_columns('email_outbox')}
        for col_name, col_type in [
            ('deal_id', sa.String(100)),
            ('deal_name', sa.String(255)),
            ('sender_name', sa.String(255)),
            ('sender_role', sa.String(50)),
            ('recipient_role', sa.String(50)),
        ]:
            if col_name not in outbox_cols:
                op.add_column('email_outbox', sa.Column(col_name, col_type, nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    if 'deal_messages' in tables:
        msg_cols = {c['name'] for c in inspector.get_columns('deal_messages')}
        if 'recipient_ids' in msg_cols:
            with op.batch_alter_table('deal_messages') as batch_op:
                batch_op.drop_column('recipient_ids')

    if 'deal_comments' in tables:
        comment_cols = {c['name'] for c in inspector.get_columns('deal_comments')}
        if 'recipient_ids' in comment_cols:
            with op.batch_alter_table('deal_comments') as batch_op:
                batch_op.drop_column('recipient_ids')

    if 'notifications' in tables:
        op.drop_table('notifications')
