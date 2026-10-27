"""
SettingsService — manages user-configurable rules stored in the database.
All business rules (delayed group name, exclusions, thresholds, sheet keywords)
derive from these settings without hard-coding.
"""
from __future__ import annotations
import json
import logging
from typing import Any
from sqlalchemy.orm import Session
from backend.models.setting import SystemSetting

log = logging.getLogger(__name__)

DEFAULT_SETTINGS: dict[str, dict[str, Any]] = {
    "delayed_group": {
        "value": "",  # Empty indicates auto-detect (word "delay" in Group column)
        "description": "Group column value representing Delayed Renewals. Leave empty for automatic detection.",
    },
    "exclude_zero_negative_acv": {
        "value": "true",
        "description": "Exclude deals with zero or negative ACV from headline totals.",
    },
    "close_date_far_ahead_years": {
        "value": "5",
        "description": "Flag deals with close dates further than this number of years ahead for review.",
    },
    "manual_sheet_keywords": {
        "value": json.dumps(["delayed", "slippage", "2027"]),
        "description": "Keywords used to detect extra manual sheets in workbooks for admin reconciliation.",
    },
}


class SettingsService:
    @staticmethod
    def _ensure_table(db: Session) -> None:
        try:
            from backend.database import Base
            from backend.models.setting import SystemSetting  # noqa: F401
            Base.metadata.create_all(bind=db.get_bind())
        except Exception as e:
            log.warning("Could not auto-create system_settings table: %s", e)

    @staticmethod
    def get_setting(db: Session, key: str, default: str | None = None) -> str:
        try:
            row = db.query(SystemSetting).filter(SystemSetting.key == key).first()
        except Exception:
            try:
                db.rollback()
                SettingsService._ensure_table(db)
                row = db.query(SystemSetting).filter(SystemSetting.key == key).first()
            except Exception as e:
                log.warning("Could not query SystemSetting '%s': %s", key, e)
                return default if default is not None else DEFAULT_SETTINGS.get(key, {}).get("value", "")

        if row and row.value is not None:
            return row.value
        if default is not None:
            return default
        return DEFAULT_SETTINGS.get(key, {}).get("value", "")

    @staticmethod
    def set_setting(db: Session, key: str, value: str, description: str | None = None) -> SystemSetting:
        try:
            row = db.query(SystemSetting).filter(SystemSetting.key == key).first()
        except Exception:
            db.rollback()
            SettingsService._ensure_table(db)
            row = db.query(SystemSetting).filter(SystemSetting.key == key).first()

        if not row:
            desc = description or DEFAULT_SETTINGS.get(key, {}).get("description")
            row = SystemSetting(key=key, value=str(value), description=desc)
            db.add(row)
        else:
            row.value = str(value)
            if description:
                row.description = description
        db.commit()
        db.refresh(row)
        return row

    @staticmethod
    def get_all_settings(db: Session, available_groups: list[str] | None = None) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for k, default_meta in DEFAULT_SETTINGS.items():
            val = SettingsService.get_setting(db, k)
            result[k] = {
                "key": k,
                "value": val,
                "description": default_meta.get("description", ""),
            }

        # Resolve auto-detected delayed group if applicable
        configured_group = result["delayed_group"]["value"]
        detected_group = None
        if available_groups:
            for g in available_groups:
                if g and "delay" in str(g).strip().lower():
                    detected_group = str(g).strip()
                    break

        resolved_group = configured_group.strip() if configured_group.strip() else detected_group
        result["delayed_group"]["effective_value"] = resolved_group
        result["delayed_group"]["is_auto_detected"] = not bool(configured_group.strip())
        result["delayed_group"]["available_groups"] = available_groups or []
        return result

    @staticmethod
    def get_delayed_rules(db: Session, available_groups: list[str] | None = None) -> dict[str, Any]:
        """
        Returns parsed, typed rules for delayed renewals & slippage calculations.
        """
        configured_group = SettingsService.get_setting(db, "delayed_group", "").strip()
        detected_group = None
        if available_groups:
            for g in available_groups:
                if g and "delay" in str(g).strip().lower():
                    detected_group = str(g).strip()
                    break

        effective_group = configured_group if configured_group else detected_group
        exclude_non_pos = SettingsService.get_setting(db, "exclude_zero_negative_acv", "true").lower() in ("true", "1", "yes")

        try:
            far_ahead_years = int(SettingsService.get_setting(db, "close_date_far_ahead_years", "5"))
        except (ValueError, TypeError):
            far_ahead_years = 5

        try:
            manual_keywords = json.loads(SettingsService.get_setting(db, "manual_sheet_keywords", '["delayed", "slippage", "2027"]'))
            if not isinstance(manual_keywords, list):
                manual_keywords = ["delayed", "slippage", "2027"]
        except Exception:
            manual_keywords = ["delayed", "slippage", "2027"]

        return {
            "delayed_group": effective_group,
            "is_auto_detected": not bool(configured_group),
            "fallback_used": effective_group is None,
            "exclude_zero_negative_acv": exclude_non_pos,
            "close_date_far_ahead_years": far_ahead_years,
            "manual_sheet_keywords": manual_keywords,
        }
