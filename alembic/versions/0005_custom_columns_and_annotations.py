"""0005_custom_columns_and_annotations

Revision ID: 0005_custom_columns
Revises: 0004_system_settings
Create Date: 2026-10-27 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers, used by Alembic.
revision: str = '0005_custom_columns'
down_revision: Union[str, Sequence[str], None] = '0004_system_settings'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    # 1. custom_columns table
    if 'custom_columns' not in tables:
        op.create_table(
            'custom_columns',
            sa.Column('id', sa.String(length=36), primary_key=True, nullable=False),
            sa.Column('key', sa.String(length=64), nullable=False),
            sa.Column('label', sa.String(length=256), nullable=False),
            sa.Column('type', sa.String(length=64), nullable=False),
            sa.Column('dropdown_options', sa.JSON().with_variant(JSONB, 'postgresql'), nullable=True),
            sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('source_header', sa.String(length=256), nullable=True),
            sa.Column('is_deleted', sa.Boolean(), nullable=False, server_default='0'),
            sa.Column('created_by', sa.String(length=128), nullable=False, server_default='system'),
            sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
            sa.UniqueConstraint('key', name='uq_custom_columns_key'),
        )
        op.create_index('ix_custom_columns_key', 'custom_columns', ['key'])
        op.create_index('ix_custom_columns_is_deleted_sort', 'custom_columns', ['is_deleted', 'sort_order'])

    # 2. deal_annotations table
    if 'deal_annotations' not in tables:
        op.create_table(
            'deal_annotations',
            sa.Column('id', sa.String(length=36), primary_key=True, nullable=False),
            sa.Column('opportunity_id_18', sa.String(length=64), nullable=False),
            sa.Column('column_key', sa.String(length=64), nullable=False),
            sa.Column('value', sa.Text(), nullable=True),
            sa.Column('source', sa.String(length=32), nullable=False, server_default='app'),
            sa.Column('updated_by', sa.String(length=128), nullable=False, server_default='system'),
            sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
            sa.Column('version', sa.Integer(), nullable=False, server_default='1'),
            sa.UniqueConstraint('opportunity_id_18', 'column_key', name='uq_deal_annotations_opp_col'),
        )
        op.create_index('ix_deal_annotations_opp', 'deal_annotations', ['opportunity_id_18'])
        op.create_index('ix_deal_annotations_col', 'deal_annotations', ['column_key'])
        op.create_index('ix_deal_annotations_opp_col', 'deal_annotations', ['opportunity_id_18', 'column_key'])

    # 3. annotation_audit table
    if 'annotation_audit' not in tables:
        op.create_table(
            'annotation_audit',
            sa.Column('id', sa.String(length=36), primary_key=True, nullable=False),
            sa.Column('entity_type', sa.String(length=32), nullable=False),
            sa.Column('entity_id', sa.String(length=64), nullable=False),
            sa.Column('column_key', sa.String(length=64), nullable=True),
            sa.Column('opportunity_id_18', sa.String(length=64), nullable=True),
            sa.Column('action', sa.String(length=32), nullable=False),
            sa.Column('old_value', sa.Text(), nullable=True),
            sa.Column('new_value', sa.Text(), nullable=True),
            sa.Column('user_id', sa.String(length=128), nullable=False, server_default='system'),
            sa.Column('timestamp', sa.DateTime(), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
            sa.Column('extra_info', sa.JSON().with_variant(JSONB, 'postgresql'), nullable=True),
        )
        op.create_index('ix_annotation_audit_opp', 'annotation_audit', ['opportunity_id_18'])
        op.create_index('ix_annotation_audit_col', 'annotation_audit', ['column_key'])
        op.create_index('ix_annotation_audit_time', 'annotation_audit', ['timestamp'])


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()
    if 'annotation_audit' in tables:
        op.drop_table('annotation_audit')
    if 'deal_annotations' in tables:
        op.drop_table('deal_annotations')
    if 'custom_columns' in tables:
        op.drop_table('custom_columns')
