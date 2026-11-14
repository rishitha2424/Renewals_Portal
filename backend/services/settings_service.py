"""
SettingsService — manages user-configurable rules stored in the database.
All business rules (delayed group name, exclusions, thresholds, sheet keywords)
derive from these settings without hard-coding.
"""
from __future__ import annotations
import json
import logging
from typing import Any, Optional
from sqlalchemy.orm import Session
from backend.models.setting import SystemSetting

log = logging.getLogger(__name__)

DEFAULT_SETTINGS: dict[str, dict[str, Any]] = {
    "delayed_group": {
        "value": "",  # Empty indicates auto-detect (word "delay" in Group column)
        "description": "Group column value representing Delayed Renewals. Leave empty for automatic detection.",
    },
    "included_type_codes": {
        "value": "All",
        "description": "Deal Type codes to include across the application (default All). Specific codes narrow every page.",
    },
    "lookback_years": {
        "value": "1",
        "description": "Number of lookback years for Delayed Renewals and Slippage service start date calculations.",
    },
    "excluded_stages": {
        "value": json.dumps(["Deleted", "Lost", "Won & Closed", "PO & Signed Contract", "Finance Review"]),
        "description": "Stage names excluded from Delayed Renewals, Slippage, and Jan 1st Renewals.",
    },
    "timezone": {
        "value": "",
        "description": "Server timezone for calculating current date (e.g. UTC, America/New_York, Asia/Kolkata). Leave empty for server local timezone.",
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
        "value": json.dumps(["delayed", "slippage"]),
        "description": "Keywords used to detect extra manual sheets in workbooks for admin reconciliation.",
    },
    "exclude_reconciliation_entry": {
        "value": "true",
        "description": "Exclude deals where Reconciliation Entry = Yes across the application.",
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
    def get_included_types(db: Optional[Session] = None) -> list[str]:
        if db is None:
            try:
                from backend.database import SessionLocal
                session = SessionLocal()
                res = SettingsService.get_included_types(session)
                session.close()
                return res
            except Exception:
                return ["ALL"]
        try:
            raw_types = SettingsService.get_setting(db, "included_type_codes", "All")
            raw_clean = raw_types.strip()
            if not raw_clean or raw_clean.lower() in ("all", "['all']", '["all"]'):
                return ["ALL"]
            parsed = json.loads(raw_clean) if raw_clean.startswith("[") else [s.strip() for s in raw_clean.split(",")]
            types = [str(x).strip().upper() for x in parsed if str(x).strip()]
            if not types or any(t.lower() == "all" for t in types):
                return ["ALL"]
            return types
        except Exception:
            return ["ALL"]

    @staticmethod
    def get_lookback_years(db: Optional[Session] = None) -> int:
        if db is None:
            return 1
        try:
            val = SettingsService.get_setting(db, "lookback_years", "1")
            return max(1, int(val))
        except Exception:
            return 1

    @staticmethod
    def get_excluded_stages(db: Optional[Session] = None) -> list[str]:
        default_stages = ["Deleted", "Lost", "Won & Closed", "PO & Signed Contract", "Finance Review"]
        if db is None:
            return default_stages
        try:
            val = SettingsService.get_setting(db, "excluded_stages", json.dumps(default_stages))
            parsed = json.loads(val) if val.strip().startswith("[") else [s.strip() for s in val.split(",")]
            res = [str(x).strip() for x in parsed if str(x).strip()]
            return res or default_stages
        except Exception:
            return default_stages

    @staticmethod
    def get_timezone(db: Optional[Session] = None) -> str:
        if db is None:
            return ""
        try:
            return SettingsService.get_setting(db, "timezone", "").strip()
        except Exception:
            return ""

    @staticmethod
    def get_exclude_reconciliation_entry(db: Optional[Session] = None) -> bool:
        if db is None:
            try:
                from backend.database import SessionLocal
                session = SessionLocal()
                res = SettingsService.get_exclude_reconciliation_entry(session)
                session.close()
                return res
            except Exception:
                return True
        try:
            val = SettingsService.get_setting(db, "exclude_reconciliation_entry", "true")
            return str(val).strip().lower() in ("true", "1", "yes")
        except Exception:
            return True

    @staticmethod
    def get_all_settings(
        db: Session,
        available_groups: list[str] | None = None,
        available_types: list[str] | None = None,
    ) -> dict[str, Any]:
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

        # Resolve included type codes
        raw_types = result.get("included_type_codes", {}).get("value", "All")
        raw_clean = str(raw_types).strip()
        if not raw_clean or raw_clean.lower() in ("all", "['all']", '["all"]'):
            type_list = ["ALL"]
        else:
            try:
                parsed_types = json.loads(raw_clean) if raw_clean.startswith("[") else [s.strip() for s in raw_clean.split(",")]
                type_list = [str(x).strip().upper() for x in parsed_types if str(x).strip()] or ["ALL"]
            except Exception:
                type_list = ["ALL"]

        result["included_type_codes"]["effective_value"] = type_list
        result["included_type_codes"]["available_types"] = available_types or []
        note = "All types" if (type_list == ["ALL"] or "ALL" in type_list) else (" and ".join(type_list) + " types only")
        result["included_type_codes"]["note"] = note

        return result

    @staticmethod
    def get_delayed_rules(
        db: Session,
        available_groups: list[str] | None = None,
        available_types: list[str] | None = None,
    ) -> dict[str, Any]:
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

        included_types = SettingsService.get_included_types(db)
        type_note = "All types" if (included_types == ["ALL"] or "ALL" in included_types) else (" and ".join(included_types) + " types only")

        lookback_years = SettingsService.get_lookback_years(db)
        excluded_stages = SettingsService.get_excluded_stages(db)

        try:
            far_ahead_years = int(SettingsService.get_setting(db, "close_date_far_ahead_years", "5"))
        except (ValueError, TypeError):
            far_ahead_years = 5

        try:
            manual_keywords = json.loads(SettingsService.get_setting(db, "manual_sheet_keywords", '["delayed", "slippage"]'))
            if not isinstance(manual_keywords, list):
                manual_keywords = ["delayed", "slippage"]
        except Exception:
            manual_keywords = ["delayed", "slippage"]

        return {
            "delayed_group": effective_group,
            "is_auto_detected": not bool(configured_group),
            "fallback_used": effective_group is None,
            "included_type_codes": included_types,
            "type_filter_note": type_note,
            "exclude_zero_negative_acv": exclude_non_pos,
            "close_date_far_ahead_years": far_ahead_years,
            "manual_sheet_keywords": manual_keywords,
            "lookback_years": lookback_years,
            "excluded_stages": excluded_stages,
        }
