"""
AnnotationService — handles custom columns configuration, deal annotation CRUD,
type validation, optimistic concurrency control, and audit trail logging.
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone, date
from typing import Any, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.models.custom_column import CustomColumn, DealAnnotation, AnnotationAudit
from backend.models.snapshot import UploadSnapshot
from backend.models.opportunity import Opportunity

log = logging.getLogger(__name__)

ALLOWED_COLUMN_TYPES = {
    "text",
    "long text",
    "number",
    "date",
    "dropdown",
    "checkbox",
    "auto: edited by",
    "auto: edited on",
}


class ConcurrencyError(Exception):
    """Raised when an optimistic concurrency conflict is detected."""
    pass


class ValidationError(Exception):
    """Raised when value validation fails."""
    pass


def slugify_key(label: str) -> str:
    """Generate a clean identifier key from column label."""
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "_", label.strip().lower()).strip("_")
    if not cleaned:
        cleaned = "col_" + str(uuid.uuid4())[:8]
    return cleaned[:64]


class AnnotationService:
    def __init__(self, db: Session):
        self.db = db

    # -------------------------------------------------------------
    # Custom Columns Configuration
    # -------------------------------------------------------------
    def list_columns(self, include_deleted: bool = False) -> list[CustomColumn]:
        q = self.db.query(CustomColumn)
        if not include_deleted:
            q = q.filter(CustomColumn.is_deleted == False)
        return q.order_by(CustomColumn.sort_order.asc(), CustomColumn.created_at.asc()).all()

    def get_column_by_id(self, col_id: str) -> CustomColumn | None:
        return self.db.query(CustomColumn).filter(CustomColumn.id == col_id).first()

    def get_column_by_key(self, col_key: str) -> CustomColumn | None:
        return self.db.query(CustomColumn).filter(CustomColumn.key == col_key).first()

    def create_column(
        self,
        label: str,
        col_type: str,
        dropdown_options: list[str] | None = None,
        sort_order: int | None = None,
        source_header: str | None = None,
        user_id: str = "admin",
    ) -> CustomColumn:
        label_clean = str(label or "").strip()
        if not label_clean:
            raise ValidationError("Column label cannot be empty.")

        type_clean = str(col_type or "").strip().lower()
        if type_clean not in ALLOWED_COLUMN_TYPES:
            raise ValidationError(f"Invalid column type '{col_type}'. Allowed types: {sorted(ALLOWED_COLUMN_TYPES)}")

        # Deduplicate key
        base_key = slugify_key(label_clean)
        candidate_key = base_key
        counter = 1
        while self.db.query(CustomColumn).filter(CustomColumn.key == candidate_key).first():
            candidate_key = f"{base_key}_{counter}"
            counter += 1

        if sort_order is None:
            max_order = self.db.query(func.max(CustomColumn.sort_order)).scalar()
            sort_order = (max_order + 1) if max_order is not None else 0

        # Dropdown options sanitization
        clean_opts: list[str] = []
        if type_clean == "dropdown" and dropdown_options:
            clean_opts = [str(o).strip() for o in dropdown_options if str(o).strip()]

        col = CustomColumn(
            id=str(uuid.uuid4()),
            key=candidate_key,
            label=label_clean,
            type=type_clean,
            dropdown_options=clean_opts if type_clean == "dropdown" else None,
            sort_order=sort_order,
            source_header=source_header.strip() if source_header else None,
            is_deleted=False,
            created_by=user_id,
            created_at=datetime.now(timezone.utc),
        )
        self.db.add(col)

        # Audit
        audit = AnnotationAudit(
            id=str(uuid.uuid4()),
            entity_type="column",
            entity_id=col.key,
            column_key=col.key,
            action="create",
            old_value=None,
            new_value=label_clean,
            user_id=user_id,
            timestamp=datetime.now(timezone.utc),
            extra_info={"type": type_clean, "source_header": source_header},
        )
        self.db.add(audit)
        self.db.commit()
        self.db.refresh(col)
        return col

    def update_column(
        self,
        col_id_or_key: str,
        label: str | None = None,
        col_type: str | None = None,
        dropdown_options: list[str] | None = None,
        sort_order: int | None = None,
        source_header: str | None = None,
        user_id: str = "admin",
    ) -> CustomColumn:
        col = (
            self.db.query(CustomColumn)
            .filter((CustomColumn.id == col_id_or_key) | (CustomColumn.key == col_id_or_key))
            .first()
        )
        if not col or col.is_deleted:
            raise ValidationError(f"Column '{col_id_or_key}' not found.")

        old_desc = f"label={col.label}, type={col.type}, sort_order={col.sort_order}"

        if label is not None:
            label_clean = str(label).strip()
            if not label_clean:
                raise ValidationError("Column label cannot be empty.")
            col.label = label_clean

        if col_type is not None:
            type_clean = str(col_type).strip().lower()
            if type_clean not in ALLOWED_COLUMN_TYPES:
                raise ValidationError(f"Invalid column type '{col_type}'.")
            col.type = type_clean

        if dropdown_options is not None and col.type == "dropdown":
            col.dropdown_options = [str(o).strip() for o in dropdown_options if str(o).strip()]

        if sort_order is not None:
            col.sort_order = sort_order

        if source_header is not None:
            col.source_header = source_header.strip() if source_header.strip() else None

        new_desc = f"label={col.label}, type={col.type}, sort_order={col.sort_order}"

        audit = AnnotationAudit(
            id=str(uuid.uuid4()),
            entity_type="column",
            entity_id=col.key,
            column_key=col.key,
            action="update",
            old_value=old_desc,
            new_value=new_desc,
            user_id=user_id,
            timestamp=datetime.now(timezone.utc),
        )
        self.db.add(audit)
        self.db.commit()
        self.db.refresh(col)
        return col

    def delete_column(self, col_id_or_key: str, user_id: str = "admin") -> CustomColumn:
        col = (
            self.db.query(CustomColumn)
            .filter((CustomColumn.id == col_id_or_key) | (CustomColumn.key == col_id_or_key))
            .first()
        )
        if not col or col.is_deleted:
            raise ValidationError(f"Column '{col_id_or_key}' not found.")

        col.is_deleted = True

        audit = AnnotationAudit(
            id=str(uuid.uuid4()),
            entity_type="column",
            entity_id=col.key,
            column_key=col.key,
            action="delete",
            old_value=col.label,
            new_value="DELETED",
            user_id=user_id,
            timestamp=datetime.now(timezone.utc),
        )
        self.db.add(audit)
        self.db.commit()
        return col

    def get_detected_headers(self, snapshot_id: str | None = None) -> list[str]:
        """Return headers detected in the latest uploaded snapshot."""
        if snapshot_id:
            snap = self.db.query(UploadSnapshot).filter(UploadSnapshot.id == snapshot_id).first()
        else:
            snap = self.db.query(UploadSnapshot).order_by(UploadSnapshot.snapshot_date.desc()).first()

        if not snap:
            return []

        if snap.column_order:
            return [str(c) for c in snap.column_order if str(c).strip()]

        # Fallback to inspecting one Opportunity row's extra_attributes
        sample = (
            self.db.query(Opportunity)
            .filter(Opportunity.snapshot_id == snap.id, Opportunity.extra_attributes != None)
            .first()
        )
        if sample and sample.extra_attributes:
            return list(sample.extra_attributes.keys())
        return []

    # -------------------------------------------------------------
    # Deal Annotation Values CRUD
    # -------------------------------------------------------------
    def _validate_value(self, col: CustomColumn, value: Any) -> str | None:
        """Validate value according to column type, length <= 5000, trimmed."""
        if value is None:
            return None
        val_str = str(value).strip()
        if not val_str:
            return None

        if len(val_str) > 5000:
            raise ValidationError(f"Value exceeds maximum length of 5,000 characters (length: {len(val_str)}).")

        ctype = col.type.lower()
        if ctype == "number":
            try:
                # Remove commas, currency symbols
                clean_num = re.sub(r"[$,\s]", "", val_str)
                float(clean_num)
                return clean_num
            except ValueError:
                raise ValidationError(f"Value '{val_str}' is not a valid number for column '{col.label}'.")
        elif ctype == "date":
            # Test ISO format parsing YYYY-MM-DD
            try:
                # Accept YYYY-MM-DD or standard parseable dates
                date.fromisoformat(val_str[:10])
                return val_str[:10]
            except Exception:
                raise ValidationError(f"Value '{val_str}' is not a valid date (YYYY-MM-DD expected).")
        elif ctype == "dropdown":
            allowed = col.dropdown_options or []
            if allowed and val_str not in allowed:
                raise ValidationError(f"Value '{val_str}' is not one of the allowed options: {allowed}")
            return val_str
        elif ctype == "checkbox":
            lower = val_str.lower()
            if lower in ("true", "1", "yes", "checked"):
                return "true"
            elif lower in ("false", "0", "no", "unchecked", ""):
                return "false"
            else:
                raise ValidationError(f"Value '{val_str}' is not a valid boolean for column '{col.label}'.")
        elif ctype.startswith("auto:"):
            raise ValidationError(f"Auto-generated column '{col.label}' cannot be edited directly.")

        return val_str

    def get_deal_annotations(self, opportunity_id_18: str) -> dict[str, Any]:
        """Return dict of { column_key: { value, source, updated_by, updated_at, version } } plus auto-columns."""
        rows = (
            self.db.query(DealAnnotation)
            .filter(DealAnnotation.opportunity_id_18 == opportunity_id_18)
            .all()
        )
        res: dict[str, Any] = {}
        latest_time: datetime | None = None
        latest_user: str | None = None

        for r in rows:
            res[r.column_key] = r.to_dict()
            if latest_time is None or r.updated_at > latest_time:
                latest_time = r.updated_at
                latest_user = r.updated_by

        # Include auto columns for display
        auto_cols = (
            self.db.query(CustomColumn)
            .filter(CustomColumn.is_deleted == False, CustomColumn.type.startswith("auto:"))
            .all()
        )
        for ac in auto_cols:
            if ac.type == "auto: edited by":
                res[ac.key] = {
                    "opportunity_id_18": opportunity_id_18,
                    "column_key": ac.key,
                    "value": latest_user or "",
                    "source": "app",
                    "updated_by": "system",
                    "updated_at": latest_time.isoformat() if latest_time else None,
                    "version": 1,
                }
            elif ac.type == "auto: edited on":
                res[ac.key] = {
                    "opportunity_id_18": opportunity_id_18,
                    "column_key": ac.key,
                    "value": latest_time.strftime("%Y-%m-%d %H:%M:%S") if latest_time else "",
                    "source": "app",
                    "updated_by": "system",
                    "updated_at": latest_time.isoformat() if latest_time else None,
                    "version": 1,
                }

        return res

    def set_deal_value(
        self,
        opportunity_id_18: str,
        column_key: str,
        value: Any,
        user_id: str = "admin",
        source: str = "app",
        expected_version: int | None = None,
    ) -> dict[str, Any]:
        """Save a deal annotation with validation, concurrency check, and audit logging."""
        opp_id = str(opportunity_id_18 or "").strip()
        if not opp_id:
            raise ValidationError("Opportunity ID cannot be empty.")

        col = self.get_column_by_key(column_key)
        if not col or col.is_deleted:
            raise ValidationError(f"Unknown or deleted column key: '{column_key}'.")

        clean_val = self._validate_value(col, value)

        existing = (
            self.db.query(DealAnnotation)
            .filter(
                DealAnnotation.opportunity_id_18 == opp_id,
                DealAnnotation.column_key == column_key,
            )
            .first()
        )

        # Optimistic concurrency check
        if existing and expected_version is not None and existing.version != expected_version:
            raise ConcurrencyError("This value changed, reload.")

        now = datetime.now(timezone.utc)

        # 1. Clearing a value (clean_val is None)
        if clean_val is None:
            if existing:
                old_val = existing.value
                self.db.delete(existing)
                audit = AnnotationAudit(
                    id=str(uuid.uuid4()),
                    entity_type="deal_value",
                    entity_id=opp_id,
                    column_key=column_key,
                    opportunity_id_18=opp_id,
                    action="delete",
                    old_value=old_val,
                    new_value=None,
                    user_id=user_id,
                    timestamp=now,
                )
                self.db.add(audit)
                self.db.commit()
                return {"cleared": True, "column_key": column_key, "opportunity_id_18": opp_id}
            return {"cleared": True, "column_key": column_key, "opportunity_id_18": opp_id}

        # 2. Updating existing value
        if existing:
            if existing.value == clean_val:
                # No change
                return existing.to_dict()

            old_val = existing.value
            existing.value = clean_val
            existing.updated_by = user_id
            existing.updated_at = now
            existing.source = source
            existing.version += 1

            audit = AnnotationAudit(
                id=str(uuid.uuid4()),
                entity_type="deal_value",
                entity_id=opp_id,
                column_key=column_key,
                opportunity_id_18=opp_id,
                action="update",
                old_value=old_val,
                new_value=clean_val,
                user_id=user_id,
                timestamp=now,
            )
            self.db.add(audit)
            self.db.commit()
            self.db.refresh(existing)
            return existing.to_dict()

        # 3. Creating new value
        new_annot = DealAnnotation(
            id=str(uuid.uuid4()),
            opportunity_id_18=opp_id,
            column_key=column_key,
            value=clean_val,
            source=source,
            updated_by=user_id,
            updated_at=now,
            version=1,
        )
        self.db.add(new_annot)

        audit = AnnotationAudit(
            id=str(uuid.uuid4()),
            entity_type="deal_value",
            entity_id=opp_id,
            column_key=column_key,
            opportunity_id_18=opp_id,
            action="create",
            old_value=None,
            new_value=clean_val,
            user_id=user_id,
            timestamp=now,
        )
        self.db.add(audit)
        self.db.commit()
        self.db.refresh(new_annot)
        return new_annot.to_dict()

    def delete_deal_value(self, opportunity_id_18: str, column_key: str, user_id: str = "admin") -> bool:
        """Clear a deal annotation value."""
        return self.set_deal_value(opportunity_id_18, column_key, None, user_id=user_id).get("cleared", False)

    def get_deal_audit(self, opportunity_id_18: str) -> list[dict]:
        """Return history for a single deal from the audit log."""
        entries = (
            self.db.query(AnnotationAudit)
            .filter(AnnotationAudit.opportunity_id_18 == opportunity_id_18)
            .order_by(AnnotationAudit.timestamp.desc())
            .all()
        )
        return [e.to_dict() for e in entries]

    # -------------------------------------------------------------
    # Batch Deal Enrichment for Data Explorer
    # -------------------------------------------------------------
    def enrich_deals_with_annotations(self, opp_ids: list[str]) -> dict[str, dict[str, Any]]:
        """Return a mapping of { opp_id: { column_key: value_or_meta } } for all requested deals."""
        if not opp_ids:
            return {}

        clean_ids = [str(i).strip() for i in opp_ids if str(i).strip()]
        annotations = (
            self.db.query(DealAnnotation)
            .filter(DealAnnotation.opportunity_id_18.in_(clean_ids))
            .all()
        )

        res: dict[str, dict[str, Any]] = {i: {} for i in clean_ids}
        latest_meta: dict[str, tuple[datetime, str]] = {}

        for a in annotations:
            res[a.opportunity_id_18][a.column_key] = a.to_dict()
            cur = latest_meta.get(a.opportunity_id_18)
            if cur is None or a.updated_at > cur[0]:
                latest_meta[a.opportunity_id_18] = (a.updated_at, a.updated_by)

        # Dynamic auto columns
        auto_cols = (
            self.db.query(CustomColumn)
            .filter(CustomColumn.is_deleted == False, CustomColumn.type.startswith("auto:"))
            .all()
        )
        if auto_cols:
            for opp_id in clean_ids:
                meta = latest_meta.get(opp_id)
                for ac in auto_cols:
                    if ac.type == "auto: edited by":
                        res[opp_id][ac.key] = {
                            "opportunity_id_18": opp_id,
                            "column_key": ac.key,
                            "value": meta[1] if meta else "",
                            "source": "app",
                            "updated_by": "system",
                            "updated_at": meta[0].isoformat() if meta else None,
                            "version": 1,
                        }
                    elif ac.type == "auto: edited on":
                        res[opp_id][ac.key] = {
                            "opportunity_id_18": opp_id,
                            "column_key": ac.key,
                            "value": meta[0].strftime("%Y-%m-%d %H:%M:%S") if meta else "",
                            "source": "app",
                            "updated_by": "system",
                            "updated_at": meta[0].isoformat() if meta else None,
                            "version": 1,
                        }

        return res

    # -------------------------------------------------------------
    # Upload Ingest Rule Enforcement
    # -------------------------------------------------------------
    def apply_upload_annotations(
        self,
        today_raw: Any,
        opp_id_header: str = "Opportunity ID 18 Digit",
        user_id: str = "upload_service",
    ) -> dict[str, int]:
        """
        On every upload, for each custom column that has a source_header present in the file,
        and for each deal row, apply:
        1. If app has no value: store Excel value (source 'excel').
        2. If app value has source 'app': keep it and never overwrite.
        3. If app value has source 'excel' and new Excel value is different and non-blank: replace it (log audit).
        4. A blank Excel cell never erases an app value.
        """
        summary = {"filled": 0, "kept": 0, "updated": 0, "skipped": 0, "deals_not_found": 0}
        if today_raw is None or not hasattr(today_raw, "iterrows"):
            return summary

        cols = (
            self.db.query(CustomColumn)
            .filter(CustomColumn.is_deleted == False, CustomColumn.source_header != None)
            .all()
        )
        if not cols:
            return summary

        # Find matching columns in DataFrame
        file_cols_lower = {str(c).strip().lower(): str(c) for c in today_raw.columns}
        active_match: list[tuple[CustomColumn, str]] = []
        for c in cols:
            sh = c.source_header.strip().lower()
            if sh in file_cols_lower:
                active_match.append((c, file_cols_lower[sh]))

        if not active_match:
            return summary

        # Find opp_id column in file
        opp_col_name = None
        for c in today_raw.columns:
            if "opportunity id 18" in str(c).lower() or "opportunity_id_18" in str(c).lower():
                opp_col_name = c
                break

        if not opp_col_name:
            summary["deals_not_found"] = len(today_raw)
            return summary

        now = datetime.now(timezone.utc)

        for _, row in today_raw.iterrows():
            opp_id_raw = row.get(opp_col_name)
            if not opp_id_raw or str(opp_id_raw).strip() == "":
                summary["deals_not_found"] += 1
                continue

            opp_id = str(opp_id_raw).strip()

            for col_obj, file_col in active_match:
                raw_cell = row.get(file_col)
                if raw_cell is None or pd_is_null(raw_cell):
                    excel_val = None
                else:
                    excel_val = str(raw_cell).strip()
                    if not excel_val:
                        excel_val = None

                existing = (
                    self.db.query(DealAnnotation)
                    .filter(
                        DealAnnotation.opportunity_id_18 == opp_id,
                        DealAnnotation.column_key == col_obj.key,
                    )
                    .first()
                )

                if existing is None:
                    if excel_val is not None:
                        # 1. App has no value: store Excel value (source 'excel')
                        clean_val = self._validate_value(col_obj, excel_val)
                        if clean_val is not None:
                            annot = DealAnnotation(
                                id=str(uuid.uuid4()),
                                opportunity_id_18=opp_id,
                                column_key=col_obj.key,
                                value=clean_val,
                                source="excel",
                                updated_by=user_id,
                                updated_at=now,
                                version=1,
                            )
                            self.db.add(annot)
                            audit = AnnotationAudit(
                                id=str(uuid.uuid4()),
                                entity_type="deal_value",
                                entity_id=opp_id,
                                column_key=col_obj.key,
                                opportunity_id_18=opp_id,
                                action="excel_sync",
                                old_value=None,
                                new_value=clean_val,
                                user_id=user_id,
                                timestamp=now,
                                extra_info={"source": "excel_ingest", "file_header": col_obj.source_header},
                            )
                            self.db.add(audit)
                            summary["filled"] += 1
                    else:
                        summary["skipped"] += 1
                else:
                    # Existing annotation
                    if existing.source == "app":
                        # 2. If app value has source 'app': keep it and never overwrite!
                        summary["kept"] += 1
                    elif existing.source == "excel":
                        # 3. If app value has source 'excel' and new Excel value is different and non-blank: replace it
                        if excel_val is not None and excel_val != existing.value:
                            clean_val = self._validate_value(col_obj, excel_val)
                            if clean_val is not None and clean_val != existing.value:
                                old_v = existing.value
                                existing.value = clean_val
                                existing.updated_by = user_id
                                existing.updated_at = now
                                existing.version += 1
                                audit = AnnotationAudit(
                                    id=str(uuid.uuid4()),
                                    entity_type="deal_value",
                                    entity_id=opp_id,
                                    column_key=col_obj.key,
                                    opportunity_id_18=opp_id,
                                    action="excel_sync",
                                    old_value=old_v,
                                    new_value=clean_val,
                                    user_id=user_id,
                                    timestamp=now,
                                    extra_info={"source": "excel_update", "file_header": col_obj.source_header},
                                )
                                self.db.add(audit)
                                summary["updated"] += 1
                            else:
                                summary["kept"] += 1
                        else:
                            # 4. Blank Excel cell never erases an app value
                            summary["kept"] += 1
                    else:
                        summary["kept"] += 1

        self.db.commit()
        return summary


def pd_is_null(val: Any) -> bool:
    """Helper to detect pandas or standard NaN/null."""
    if val is None:
        return True
    try:
        import pandas as pd
        return pd.isna(val)
    except Exception:
        return False
