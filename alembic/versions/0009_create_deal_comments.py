"""0009_create_deal_comments

Revision ID: 0009_create_deal_comments
Revises: 0008_is_reconciliation_entry
Create Date: 2026-11-18 15:30:00.000000

Creates deal_comments table for server-side persistence of opportunity notes/comments.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '0009_create_deal_comments'
down_revision: Union[str, Sequence[str], None] = '0008_is_reconciliation_entry'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()
    if 'deal_comments' not in tables:
        op.create_table(
            'deal_comments',
            sa.Column('id', sa.String(36), primary_key=True),
            sa.Column('opportunity_id_18', sa.String(64), nullable=False),
            sa.Column('author', sa.String(128), server_default='Viewer', nullable=False),
            sa.Column('text', sa.Text(), nullable=False),
            sa.Column('is_deleted', sa.Boolean(), server_default='0', nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.Column('updated_at', sa.DateTime(), nullable=False),
        )
        try:
            op.create_index('ix_deal_comments_opp_deleted', 'deal_comments', ['opportunity_id_18', 'is_deleted'])
            op.create_index('ix_deal_comments_created', 'deal_comments', ['created_at'])
        except Exception:
            pass


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()
    if 'deal_comments' in tables:
        op.drop_table('deal_comments')

