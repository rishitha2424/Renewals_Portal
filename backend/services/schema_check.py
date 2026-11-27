"""
Read-only database schema health check & safe DB error classification helper.
Detects whether Alembic revision or required tables/columns are behind application code
without ever modifying schema or data. Never misclassifies a runtime SQL error as a migration problem.
"""
from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any, Optional

from fastapi import HTTPException, status
from sqlalchemy import inspect
from sqlalchemy.orm import Session

log = logging.getLogger(__name__)

_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")

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
    "notifications": {"id", "user_id", "category", "is_read", "created_at"},
}

COMMENTS_REQUIRED_TABLES: dict[str, set[str]] = {
    "deal_comments": REQUIRED_TABLES["deal_comments"],
    "email_delivery_events": {"id", "entity_id", "sent_count", "failed_count", "skipped_count", "created_at"},
    "email_outbox": {"id", "deal_id", "template_type", "status", "created_at"},
}

MESSAGES_REQUIRED_TABLES: dict[str, set[str]] = {
    "deal_messages": REQUIRED_TABLES["deal_messages"],
    "message_read_receipts": REQUIRED_TABLES["message_read_receipts"],
}

EMAIL_LOG_REQUIRED_TABLES: dict[str, set[str]] = {
    "email_delivery_events": REQUIRED_TABLES["email_delivery_events"],
    "email_outbox": REQUIRED_TABLES["email_outbox"],
}

NOTIFICATIONS_REQUIRED_TABLES: dict[str, set[str]] = {
    "notifications": REQUIRED_TABLES["notifications"],
}


def sanitize_db_error_message(msg: Any) -> str:
    """Scrub secrets and email addresses from database error strings before logging."""
    s = str(msg or "")
    try:
        from backend.config import settings
        for secret in (settings.SMTP_PASSWORD, settings.ADMIN_PASSWORD, settings.ADMIN_SECRET_KEY, settings.AZURE_CLIENT_SECRET):
            if secret and secret in s:
                s = s.replace(secret, "***")
    except Exception:
        pass
    s = _EMAIL_RE.sub("[redacted-email]", s)
    if len(s) > 1000:
        s = s[:997] + "..."
    return s


def sanitize_request_params(params: Optional[dict[str, Any]]) -> dict[str, Any]:
    """Return safe request parameter summary for logs (never logs email addresses)."""
    if not params:
        return {}
    safe: dict[str, Any] = {}
    for k, v in params.items():
        if v is None:
            continue
        if isinstance(v, (bool, int, float)):
            safe[k] = v
        else:
            s = _EMAIL_RE.sub("[redacted-email]", str(v))
            safe[k] = s[:120] + ("..." if len(s) > 120 else "")
    return safe


def format_missing_schema_message(missing_tables: list[str], missing_columns: list[str]) -> str:
    missing_items = list(missing_tables) + list(missing_columns)
    if not missing_items:
        return "Database needs migration: run alembic upgrade head"
    preview = ", ".join(missing_items[:12])
    if len(missing_items) > 12:
        preview += f" (+{len(missing_items) - 12} more)"
    return f"Database needs migration: run alembic upgrade head (missing: {preview})"


def check_schema_health(
    bind: Any,
    check_alembic: bool = True,
    target_tables: Optional[dict[str, set[str]]] = None,
) -> dict[str, Any]:
    """
    Inspect the database schema read-only and report missing tables, missing columns,
    and whether Alembic revision is behind head. Never modifies data or schema.
    """
    missing_tables: list[str] = []
    missing_columns: list[str] = []
    current_rev: str | None = None
    head_rev: str | None = None
    dialect = "unknown"
    tables_to_check = target_tables or REQUIRED_TABLES

    try:
        dialect = getattr(getattr(bind, "dialect", None), "name", "unknown")
        inspector = inspect(bind)
        existing_tables = set(inspector.get_table_names())

        for tbl, req_cols in tables_to_check.items():
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
        msg = format_missing_schema_message(missing_tables, missing_columns) if needs_migration else "ok"
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
            "inspection_failed": False,
        }
    except Exception as exc:
        return {
            "status": "error",
            "needs_migration": bool(missing_tables or missing_columns),
            "at_head": False,
            "comments_ready": True,
            "message": f"Database check failed: {sanitize_db_error_message(exc)}",
            "dialect": dialect,
            "current_revision": current_rev,
            "head_revision": head_rev,
            "missing_tables": missing_tables,
            "missing_columns": missing_columns,
            "inspection_failed": True,
        }


def raise_db_endpoint_error(
    db: Session,
    exc: Exception,
    *,
    endpoint: str,
    params: Optional[dict[str, Any]] = None,
    required_tables: Optional[dict[str, set[str]]] = None,
    generic_detail: str = "Could not load data due to a database error. Please try again.",
) -> None:
    """
    Classify a SQLAlchemy / DB exception strictly:
    - Roll back any aborted transaction cleanly (essential for PostgreSQL).
    - Inspect live schema: ONLY return 503 "Database needs migration..." if required
      tables or columns are genuinely missing, listing exact missing names.
    - For ALL other database errors (type mismatches, invalid syntax, timeouts, etc.),
      log exception type, sanitized message, and safe request parameters, and return 500.
    """
    try:
        db.rollback()
    except Exception:
        pass

    safe_params = sanitize_request_params(params)
    exc_type = type(exc).__name__
    exc_msg = sanitize_db_error_message(exc)

    schema_info = check_schema_health(
        db.get_bind(),
        check_alembic=False,
        target_tables=required_tables or REQUIRED_TABLES,
    )
    missing_tables = schema_info.get("missing_tables") or []
    missing_columns = schema_info.get("missing_columns") or []

    if (missing_tables or missing_columns) and not schema_info.get("inspection_failed"):
        detail = format_missing_schema_message(missing_tables, missing_columns)
        log.warning(
            "Schema mismatch on %s (%s): missing_tables=%s missing_columns=%s params=%s",
            endpoint,
            exc_type,
            missing_tables,
            missing_columns,
            safe_params,
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=detail,
        )

    import traceback as tb_mod
    tb_frames = sanitize_db_error_message("".join(tb_mod.format_tb(exc.__traceback__))).rstrip()
    log.error(
        "Database error on %s [%s]: %s | params=%s%s",
        endpoint,
        exc_type,
        exc_msg,
        safe_params,
        f"\n{tb_frames}" if tb_frames else "",
    )
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail=generic_detail,
    )
