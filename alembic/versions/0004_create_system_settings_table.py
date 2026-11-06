"""0004_create_system_settings_table

Revision ID: 0004_system_settings
Revises: 0003_column_order
Create Date: 2026-10-26 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0004_system_settings'
down_revision: Union[str, Sequence[str], None] = '0003_column_order'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()
    if 'system_settings' not in tables:
        op.create_table(
            'system_settings',
            sa.Column('key', sa.String(length=128), primary_key=True, nullable=False),
            sa.Column('value', sa.Text(), nullable=False),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
        )


def downgrade() -> None:
    op.drop_table('system_settings')
