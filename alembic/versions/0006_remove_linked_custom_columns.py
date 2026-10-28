"""0006_remove_linked_custom_columns

Revision ID: 0006_remove_linked_columns
Revises: 0005_custom_columns
Create Date: 2026-10-28 10:00:00.000000

Finds every custom column with a source_header, soft-deletes it and any values stored
for it with an audit entry, and prints what was removed.
Columns that come from the uploaded Excel are strictly read-only and never linkable/editable.
"""
from datetime import datetime, timezone
import json
from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0006_remove_linked_columns'
down_revision: Union[str, Sequence[str], None] = '0005_custom_columns'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    if 'custom_columns' in tables:
        # Find every custom column where source_header is not null and not empty and not already deleted
        query = sa.text(
            "SELECT id, key, label, source_header FROM custom_columns "
            "WHERE (source_header IS NOT NULL AND source_header != '') "
            "AND (is_deleted = :is_del OR is_deleted = 0)"
        )
        rows = conn.execute(query, {"is_del": False}).fetchall()

        removed_info = []
        now_utc = datetime.now(timezone.utc).isoformat()

        for r in rows:
            col_id, col_key, col_label, src_hdr = r[0], r[1], r[2], r[3]
            removed_info.append(f"Column '{col_label}' (key: '{col_key}', linked to: '{src_hdr}')")

            # Soft delete the column
            conn.execute(
                sa.text("UPDATE custom_columns SET is_deleted = :del_val WHERE id = :cid"),
                {"del_val": True, "cid": col_id}
            )

            # Find how many deal_annotations exist for this column_key
            annots = conn.execute(
                sa.text("SELECT id FROM deal_annotations WHERE column_key = :ckey"),
                {"ckey": col_key}
            ).fetchall()

            # Delete annotations stored for this linked column so Excel values remain pure
            if annots:
                conn.execute(
                    sa.text("DELETE FROM deal_annotations WHERE column_key = :ckey"),
                    {"ckey": col_key}
                )

            # Record audit entry for column deletion
            if 'annotation_audit' in tables:
                audit_id = str(uuid.uuid4())
                extra = json.dumps({
                    "source_header": src_hdr,
                    "removed_values_count": len(annots),
                    "reason": "migration_0006_remove_linked_columns"
                })
                conn.execute(
                    sa.text(
                        "INSERT INTO annotation_audit ("
                        "id, entity_type, entity_id, column_key, opportunity_id_18, action, "
                        "old_value, new_value, user_id, timestamp, extra_info"
                        ") VALUES ("
                        ":id, 'custom_column', :cid, :ckey, NULL, 'migration_cleanup', "
                        ":old_label, NULL, 'system_migration_0006', :ts, :extra"
                        ")"
                    ),
                    {
                        "id": audit_id,
                        "cid": col_id,
                        "ckey": col_key,
                        "old_label": col_label,
                        "ts": now_utc,
                        "extra": extra,
                    }
                )

        if removed_info:
            print(f"[Migration 0006] Soft-deleted {len(removed_info)} linked custom columns and purged annotations:")
            for item in removed_info:
                print(f"  - {item}")
        else:
            print("[Migration 0006] No linked custom columns found.")


def downgrade() -> None:
    pass
