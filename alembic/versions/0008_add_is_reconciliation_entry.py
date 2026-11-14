"""0008_add_is_reconciliation_entry

Revision ID: 0008_is_reconciliation_entry
Revises: 0007_snapshot_checks_note
Create Date: 2026-11-14 11:00:00.000000

Adds is_reconciliation_entry column to opportunities table and back-fills from extra_attributes.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
import json
import re

# revision identifiers, used by Alembic.
revision: str = '0008_is_reconciliation_entry'
down_revision: Union[str, Sequence[str], None] = '0007_snapshot_checks_note'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    cols = [c['name'] for c in inspector.get_columns('opportunities')]
    if 'is_reconciliation_entry' not in cols:
        op.add_column(
            'opportunities',
            sa.Column('is_reconciliation_entry', sa.Boolean(), server_default='0', nullable=False)
        )
        try:
            op.create_index(
                'ix_opportunities_is_reconciliation_entry',
                'opportunities',
                ['is_reconciliation_entry']
            )
        except Exception:
            pass

    # Backfill is_reconciliation_entry from extra_attributes (Python-based so Postgres & SQLite safe)
    opps_table = sa.table(
        'opportunities',
        sa.column('id', sa.String),
        sa.column('extra_attributes', sa.JSON),
        sa.column('is_reconciliation_entry', sa.Boolean),
    )
    results = conn.execute(sa.select(opps_table.c.id, opps_table.c.extra_attributes)).fetchall()
    
    yes_ids = []
    for row in results:
        opp_id, extra = row[0], row[1]
        if extra:
            if isinstance(extra, str):
                try:
                    extra = json.loads(extra)
                except Exception:
                    extra = None
            if isinstance(extra, dict):
                for k, v in extra.items():
                    cleaned_k = re.sub(r'[\s_\-]+', '', str(k).lower())
                    if cleaned_k in ('reconciliationentry', 'reconentry'):
                        v_str = str(v).strip().lower()
                        if v_str in ('yes', 'y', 'true', '1', 'x') or v is True:
                            yes_ids.append(opp_id)
                        break

    if yes_ids:
        for i in range(0, len(yes_ids), 500):
            batch = yes_ids[i:i+500]
            conn.execute(
                opps_table.update()
                .where(opps_table.c.id.in_(batch))
                .values(is_reconciliation_entry=True)
            )

    conn.execute(
        opps_table.update()
        .where(opps_table.c.is_reconciliation_entry == None)
        .values(is_reconciliation_entry=False)
    )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    cols = [c['name'] for c in inspector.get_columns('opportunities')]
    if 'is_reconciliation_entry' in cols:
        try:
            op.drop_index('ix_opportunities_is_reconciliation_entry', 'opportunities')
        except Exception:
            pass
        op.drop_column('opportunities', 'is_reconciliation_entry')

