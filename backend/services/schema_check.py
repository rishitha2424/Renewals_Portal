"""
Read-only database schema health check.
Detects whether Alembic revision or required tables/columns are behind application code
without ever modifying schema or data.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any
from sqlalchemy import inspect


REQUIRED_TABLES: dict[str, set[str]] = {
    "users": {"id", "email", "name", "role", "status", "last_sso_login", "sso_provider"},
    "deal_comments": {
        "id",
        "opportunity_id_18",
        "author",
        "text",
        "visibility",
        "author_id",
        "author_role",
        "recipient_ids",
        "batch_id",
        "is_deleted",
        "edited_at",
        "deleted_at",
        "deleted_by",
        "deleted_by_name",
        "created_at",
    },
    "deal_messages": {
        "id",
        "deal_id",
        "sender_id",
        "body",
        "recipient_ids",
        "edited_at",
        "is_deleted",
        "deleted_at",
        "deleted_by",
        "deleted_by_name",
        "created_at",
    },
    "email_outbox": {
        "id",
        "event_id",
        "recipient_user_id",
        "sender_id",
        "status",
    },
    "comment_message_history": {"id", "entity_type", "entity_id", "action"},
    "message_read_receipts": {"id", "message_id", "user_id", "read_at"},
    "email_delivery_events": {"id", "event_type", "author_name", "sent_count", "failed_count", "skipped_count"},
}

COMMENTS_REQUIRED_TABLES: dict[str, set[str]] = {
    "deal_comments": REQUIRED_TABLES["deal_comments"],
    "email_delivery_events": {"id", "entity_id", "sent_count", "failed_count", "skipped_count", "created_at"},
    "email_outbox": {"id", "deal_id", "template_type", "status", "created_at"},
}


def check_schema_health(bind: Any, check_alembic: bool = True) -> dict[str, Any]:
    """
    Inspect the database schema read-only and report missing tables, missing columns,
    and whether Alembic revision is behind head. Never modifies data or schema.
    """
    missing_tables: list[str] = []
    missing_columns: list[str] = []
    current_rev: str | None = None
    head_rev: str | None = None
    dialect = "unknown"

    try:
        dialect = getattr(getattr(bind, "dialect", None), "name", "unknown")
        inspector = inspect(bind)
        existing_tables = set(inspector.get_table_names())

        for tbl, req_cols in REQUIRED_TABLES.items():
            if tbl not in existing_tables:
                missing_tables.append(tbl)
            else:
                have_cols = {c["name"] for c in inspector.get_columns(tbl)}
                for col in sorted(req_cols - have_cols):
                    missing_columns.append(f"{tbl}.{col}")

        comments_missing = any(
            tbl in missing_tables or any(mc.startswith(f"{tbl}.") for mc in missing_columns)
            for tbl in COMMENTS_REQUIRED_TABLES
        )

        alembic_behind = False
        if check_alembic:
            try:
                from alembic.config import Config
                from alembic.script import ScriptDirectory
                from alembic.runtime.migration import MigrationContext

                cfg_path = Path(__file__).resolve().parent.parent.parent / "alembic.ini"
                alembic_cfg = Config(str(cfg_path))
                script = ScriptDirectory.from_config(alembic_cfg)
                head_rev = script.get_current_head()
                with bind.connect() as conn:
                    ctx = MigrationContext.configure(conn)
                    current_rev = ctx.get_current_revision()
                if current_rev is not None and head_rev is not None and current_rev != head_rev:
                    alembic_behind = True
            except Exception:
                # If alembic_version isn't stamped (e.g. Base.metadata.create_all in tests), rely on table/column check
                pass

        needs_migration = bool(missing_tables or missing_columns or alembic_behind)
        msg = "Database needs migration: run alembic upgrade head" if needs_migration else "ok"
        return {
            "status": "error" if needs_migration else "ok",
            "needs_migration": needs_migration,
            "at_head": not alembic_behind and not missing_tables and not missing_columns,
            "comments_ready": not comments_missing,
            "message": msg,
            "dialect": dialect,
            "current_revision": current_rev,
            "head_revision": head_rev,
            "missing_tables": missing_tables,
            "missing_columns": missing_columns,
        }
    except Exception as exc:
        return {
            "status": "error",
            "needs_migration": True,
            "at_head": False,
            "comments_ready": False,
            "message": f"Database check failed: {exc}",
            "dialect": dialect,
            "current_revision": current_rev,
            "head_revision": head_rev,
            "missing_tables": missing_tables,
            "missing_columns": missing_columns,
        }

