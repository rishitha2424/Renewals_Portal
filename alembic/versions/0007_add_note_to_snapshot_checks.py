"""0007_add_note_to_snapshot_checks

Revision ID: 0007_snapshot_checks_note
Revises: 0006_remove_linked_columns
Create Date: 2026-11-14 07:40:00.000000

Adds note column to snapshot_checks for source reconciliation like-for-like explanations.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0007_snapshot_checks_note'
down_revision: Union[str, Sequence[str], None] = '0006_remove_linked_columns'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    cols = [c['name'] for c in inspector.get_columns('snapshot_checks')]
    if 'note' not in cols:
        op.add_column(
            'snapshot_checks',
            sa.Column('note', sa.String(length=512), nullable=True)
        )


def downgrade() -> None:
    op.drop_column('snapshot_checks', 'note')
