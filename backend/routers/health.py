from pathlib import Path
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import inspect, text
from backend.database import get_db
from backend.services.schema_check import check_schema_health

router = APIRouter(prefix="/api/health", tags=["health"])


@router.get("/db")
def get_db_health(db: Session = Depends(get_db)):
    dialect = "unknown"
    try:
        dialect = getattr(db.bind.dialect, "name", "unknown")
        # Connectivity check
        db.execute(text("SELECT 1"))

        inspector = inspect(db.bind)
        table_names = inspector.get_table_names()
        cols = [c["name"] for c in inspector.get_columns("opportunities")] if "opportunities" in table_names else []
        is_legacy = ("fiscal_period" not in cols or "sales_type" not in cols) if cols else False

        schema_info = check_schema_health(db.get_bind(), check_alembic=True)
        current_rev = schema_info.get("current_revision")
        head_rev = schema_info.get("head_revision")
        needs_migration = schema_info.get("needs_migration", False)

        if needs_migration:
            return {
                "status": "error",
                "dialect": dialect,
                "alembic_revision": current_rev,
                "alembic_head": head_rev,
                "is_legacy": is_legacy,
                "version": "v2" if not is_legacy else "v1",
                "needs_migration": True,
                "missing_tables": schema_info.get("missing_tables", []),
                "missing_columns": schema_info.get("missing_columns", []),
                "error": "Database needs migration: run alembic upgrade head",
            }

        return {
            "status": "ok",
            "dialect": dialect,
            "alembic_revision": current_rev,
            "alembic_head": head_rev,
            "is_legacy": is_legacy,
            "needs_migration": False,
            "version": "v2" if not is_legacy else "v1",
        }
    except Exception as e:
        return {
            "status": "error",
            "dialect": dialect,
            "alembic_revision": None,
            "alembic_head": None,
            "needs_migration": False,
            "error": str(e),
        }

