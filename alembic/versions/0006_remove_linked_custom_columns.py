"""0006_remove_linked_custom_columns

Revision ID: 0006_remove_linked_columns
Revises: 0005_custom_columns
Create Date: 2026-10-28 10:00:00.000000

Finds every custom column with a source_header or known Excel column label (like 'Stage Number'),
soft-deletes it and any deal_annotations stored for it with an audit entry.
Safe on both SQLite and PostgreSQL, safe for offline SQL generation (--sql), and safe to run multiple times.
Columns that come from the uploaded Excel are strictly read-only and never linkable/editable.
"""
from datetime import datetime, timezone
import json
from typing import Sequence, Union
import uuid

from alembic import context, op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0006_remove_linked_columns'
down_revision: Union[str, Sequence[str], None] = '0005_custom_columns'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Offline SQL generation (--sql mode)
    try:
        is_offline = context.is_offline_mode()
    except Exception:
        is_offline = False

    if is_offline:
        # In offline mode, conn is a MockConnection and cannot be inspected.
        # Emit standard, dialect-safe SQL statements directly:
        op.execute(
            sa.text(
                "UPDATE custom_columns "
                "SET is_deleted = true "
                "WHERE is_deleted = false "
                "  AND ((source_header IS NOT NULL AND source_header != '') "
                "       OR LOWER(label) IN ('stage number', 'stagenumber', 'stage') "
                "       OR LOWER(key) IN ('stage_number', 'stagenumber', 'stage'))"
            )
        )
        return

    # 2. Online migration mode
    conn = op.get_bind()
    dialect = getattr(conn.dialect, "name", "sqlite")
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    if 'custom_columns' not in tables:
        return

    columns_info = inspector.get_columns('custom_columns')
    col_names = {c['name'] for c in columns_info}

    # Soft-delete linked columns like 'Stage Number' or columns with source_header
    find_clauses = [
        "LOWER(label) IN ('stage number', 'stagenumber', 'stage')",
        "LOWER(key) IN ('stage_number', 'stagenumber', 'stage')",
    ]
    if 'source_header' in col_names:
        find_clauses.append("(source_header IS NOT NULL AND source_header != '')")
    if 'is_linked' in col_names:
        find_clauses.append("is_linked = :true_val")
    if 'linked_field' in col_names:
        find_clauses.append("(linked_field IS NOT NULL AND linked_field != '')")

    where_expr = " OR ".join(find_clauses)
    query = sa.text(
        f"SELECT id, key, label FROM custom_columns "
        f"WHERE is_deleted = :false_val AND ({where_expr})"
    )
    rows = conn.execute(query, {"false_val": False, "true_val": True}).fetchall()

    now_utc = datetime.now(timezone.utc).isoformat()
    removed_info = []

    for r in rows:
        col_id, col_key, col_label = r[0], r[1], r[2]
        removed_info.append(f"Column '{col_label}' (key: '{col_key}', id: '{col_id}')")

        # Soft delete the column safely using boolean parameter
        conn.execute(
            sa.text("UPDATE custom_columns SET is_deleted = :true_val WHERE id = :cid"),
            {"true_val": True, "cid": col_id}
        )

        # Delete any annotations stored for this linked column so Excel values remain pure
        if 'deal_annotations' in tables:
            conn.execute(
                sa.text("DELETE FROM deal_annotations WHERE column_key = :ckey"),
                {"ckey": col_key}
            )

        # Record audit entry for column deletion
        if 'annotation_audit' in tables:
            audit_id = str(uuid.uuid4())
            extra = json.dumps({
                "soft_deleted_linked_column": col_label,
                "key": col_key,
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

    # Safely drop legacy columns if they exist (checking columns and indexes first)
    indexes = inspector.get_indexes('custom_columns')
    for legacy_col in ['is_linked', 'linked_field']:
        if legacy_col in col_names:
            # Check and drop any index that uses this column
            for idx in indexes:
                idx_cols = idx.get('column_names') or []
                if legacy_col in idx_cols:
                    idx_name = idx.get('name')
                    if idx_name:
                        op.drop_index(idx_name, table_name='custom_columns')
            # Drop the column safely according to dialect
            if dialect == 'sqlite':
                with op.batch_alter_table('custom_columns') as batch_op:
                    batch_op.drop_column(legacy_col)
            else:
                op.drop_column('custom_columns', legacy_col)

    if removed_info:
        print(f"[Migration 0006] Soft-deleted {len(removed_info)} linked custom column(s):")
        for item in removed_info:
            print(f"  - {item}")
    else:
        print("[Migration 0006] No active linked custom columns found.")


def downgrade() -> None:
    pass
