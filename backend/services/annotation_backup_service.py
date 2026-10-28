"""
AnnotationBackupService — daily rolling JSON backups of annotations (columns, deal values, audit)
with configurable retention (default: 14 days, from system_settings) stored next to the DB.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone, timedelta
from pathlib import Path
from sqlalchemy.orm import Session

from backend.config import settings
from backend.models.custom_column import CustomColumn, DealAnnotation, AnnotationAudit
from backend.services.settings_service import SettingsService

log = logging.getLogger(__name__)

DEFAULT_RETENTION_DAYS = 14
SETTING_KEY_RETENTION = "annotation_backup_retention_days"


def get_backup_directory() -> Path:
    """Determine backup directory location configurable via env or next to the SQLite database file."""
    env_path = os.getenv("ANNOTATION_BACKUP_PATH")
    if env_path:
        backup_dir = Path(env_path)
    else:
        db_url = settings.sqlalchemy_database_url
        if db_url.startswith("sqlite"):
            clean = db_url.replace("sqlite:///", "").replace("sqlite://", "")
            db_file = Path(clean)
            backup_dir = db_file.parent / "backups" / "annotations"
        else:
            backup_dir = Path("data") / "backups" / "annotations"

    backup_dir.mkdir(parents=True, exist_ok=True)
    return backup_dir


class AnnotationBackupService:
    def __init__(self, db: Session):
        self.db = db

    def get_retention_days(self) -> int:
        env_val = os.getenv("ANNOTATION_BACKUP_RETENTION")
        if env_val:
            try:
                return max(1, int(env_val))
            except (ValueError, TypeError):
                pass
        val = SettingsService.get_setting(self.db, SETTING_KEY_RETENTION, None)
        if val is None:
            val = SettingsService.get_setting(self.db, "annotation_backup_retention", str(DEFAULT_RETENTION_DAYS))
        if val is not None:
            try:
                return max(1, int(val))
            except (ValueError, TypeError):
                pass
        return DEFAULT_RETENTION_DAYS

    def dump_annotations_payload(self) -> dict:
        """Export all columns, annotations, and audit records as a serialized JSON payload."""
        columns = self.db.query(CustomColumn).all()
        annotations = self.db.query(DealAnnotation).all()
        audit = self.db.query(AnnotationAudit).all()

        return {
            "version": "1.0",
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "counts": {
                "custom_columns": len(columns),
                "deal_annotations": len(annotations),
                "annotation_audit": len(audit),
            },
            "custom_columns": [c.to_dict() for c in columns],
            "deal_annotations": [a.to_dict() for a in annotations],
            "annotation_audit": [au.to_dict() for au in audit],
        }

    def run_daily_backup(self, retention_count: int | None = None) -> str:
        """Create backup file and prune to the number of backups from setting (default 14)."""
        backup_dir = get_backup_directory()
        timestamp_str = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        filename = f"annotations_backup_{timestamp_str}.json"
        filepath = backup_dir / filename

        payload = self.dump_annotations_payload()
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)

        # Prune old backups to keep max retention files
        retention = retention_count if retention_count is not None else self.get_retention_days()
        all_backups = sorted(
            list(backup_dir.glob("annotations_backup_*.json")),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )

        if len(all_backups) > retention:
            for old_p in all_backups[retention:]:
                try:
                    old_p.unlink()
                    log.info("Pruned old annotation backup: %s", old_p.name)
                except Exception as e:
                    log.warning("Could not prune backup %s: %s", old_p, e)

        return str(filepath)
