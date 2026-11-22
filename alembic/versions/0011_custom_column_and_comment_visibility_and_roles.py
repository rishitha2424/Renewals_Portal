"""0011_custom_column_and_comment_visibility_and_roles

Revision ID: 0011_custom_column_and_comment_visibility_and_roles
Revises: 0010_user_accounts_roles_messages_email
Create Date: 2026-11-22 16:30:00.000000

Adds visibility and role attribution columns to custom_columns and deal_comments:
- custom_columns: visibility (internal / visible_to_owner), creator_role (admin / management)
- deal_comments: visibility (internal / shared_with_owner), author_id, author_role (admin / management / kam)
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '0011_custom_column_and_comment_visibility_and_roles'
down_revision: Union[str, Sequence[str], None] = '0010_user_accounts_roles_messages_email'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    # 1. custom_columns table
    if 'custom_columns' in tables:
        cols = {c['name'] for c in inspector.get_columns('custom_columns')}
        if 'visibility' not in cols:
            op.add_column('custom_columns', sa.Column('visibility', sa.String(32), server_default='internal', nullable=False))
        if 'creator_role' not in cols:
            op.add_column('custom_columns', sa.Column('creator_role', sa.String(32), server_default='admin', nullable=False))

    # 2. deal_comments table
    if 'deal_comments' in tables:
        comment_cols = {c['name'] for c in inspector.get_columns('deal_comments')}
        if 'visibility' not in comment_cols:
            op.add_column('deal_comments', sa.Column('visibility', sa.String(32), server_default='internal', nullable=False))
        if 'author_id' not in comment_cols:
            op.add_column('deal_comments', sa.Column('author_id', sa.String(128), nullable=True))
        if 'author_role' not in comment_cols:
            op.add_column('deal_comments', sa.Column('author_role', sa.String(32), server_default='admin', nullable=False))


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    # batch alter for SQLite compatibility if dropping
    if 'custom_columns' in tables:
        cols = {c['name'] for c in inspector.get_columns('custom_columns')}
        with op.batch_alter_table('custom_columns') as batch_op:
            if 'visibility' in cols:
                batch_op.drop_column('visibility')
            if 'creator_role' in cols:
                batch_op.drop_column('creator_role')

    if 'deal_comments' in tables:
        comment_cols = {c['name'] for c in inspector.get_columns('deal_comments')}
        with op.batch_alter_table('deal_comments') as batch_op:
            if 'visibility' in comment_cols:
                batch_op.drop_column('visibility')
            if 'author_id' in comment_cols:
                batch_op.drop_column('author_id')
            if 'author_role' in comment_cols:
                batch_op.drop_column('author_role')
