"""
Snapshot-scoped Analytics, Delayed-Bucket, Export, and Snapshot-Row Cache.

Key design guarantees:
1. Thread-safe with OrderedDict LRU + TTL eviction and hard memory bounds.
2. Keyed cleanly by DB bind identity + snapshot/settings mutation version +
   resolved filter/role parameters so isolated test DBs never collide and any
   snapshot upload/commit/delete/set-active or setting update immediately
   invalidates affected caches.
3. Lightweight OppLite projection preserves 100% SQL ScopeService parity while
   avoiding repeated 172-column extra_attributes JSON decoding and ORM object
   hydration across snapshots.
"""
from __future__ import annotations

import copy
import time
import logging
from collections import OrderedDict
from threading import RLock
from typing import Any, Callable, Iterable, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.config import settings
from backend.models.opportunity import Opportunity

log = logging.getLogger(__name__)

_EXTRA_ANALYTICS_KEYS = (
    "Type", "type",
    "Group", "group",
    "Category", "category",
    "Service Start Date", "service_start_date", "Service Start date",
    "Service Expiry date", "Service End Date", "Service Expiry Date", "service_expiry_date", "service_end_date",
    "Close Date", "close_date",
    "Probability (%)", "probability",
    "Stage Number", "Stage", "stage",
    "Opportunity Owner", "Owner", "owner",
    "Business Unit", "business_unit",
    "Sales Type", "sales_type",
    "Forecast Category", "forecast_category",
    "Fiscal Period",
    "Opportunity Approval Status",
    "Proposal status For Renewal Opp",
    "Reason for approval",
    "Country/Territory", "Country", "Country / Territory",
)


class OppLite:
    """Lightweight read-only projection of an Opportunity row for fast analytics."""
    __slots__ = (
        "id",
        "snapshot_id",
        "opportunity_id_18",
        "opportunity_name",
        "account_name",
        "sub_region",
        "revised_sub_region",
        "country_territory",
        "business_unit_raw",
        "business_unit_primary",
        "forecast_category",
        "forecast_acv_amount",
        "close_date",
        "last_modified_date",
        "probability_pct",
        "approval_status",
        "service_expiry_period",
        "closing_year",
        "renewal_category",
        "months_delayed",
        "opportunity_owner",
        "stage_number",
        "is_deleted_or_lost",
        "is_reconciliation_entry",
        "sales_type",
        "fiscal_period",
        "in_renewals",
        "in_fy2026",
        "in_fy2027",
        "in_q4_2026",
        "extra_attributes",
    )

    def __init__(self, row: tuple, slim_extra: dict | None):
        (
            self.id,
            self.snapshot_id,
            self.opportunity_id_18,
            self.opportunity_name,
            self.account_name,
            self.sub_region,
            self.revised_sub_region,
            self.country_territory,
            self.business_unit_raw,
            self.business_unit_primary,
            self.forecast_category,
            self.forecast_acv_amount,
            self.close_date,
            self.last_modified_date,
            self.probability_pct,
            self.approval_status,
            self.service_expiry_period,
            self.closing_year,
            self.renewal_category,
            self.months_delayed,
            self.opportunity_owner,
            self.stage_number,
            self.is_deleted_or_lost,
            self.is_reconciliation_entry,
            self.sales_type,
            self.fiscal_period,
            self.in_renewals,
            self.in_fy2026,
            self.in_fy2027,
            self.in_q4_2026,
        ) = row
        self.extra_attributes = slim_extra


_BASE_COLUMNS_LEN = 30

_EXTRACTED_SLIM_COLS = (
    ("Type", func.coalesce(Opportunity.extra_attributes["Type"].as_string(), Opportunity.extra_attributes["type"].as_string())),
    ("Group", func.coalesce(Opportunity.extra_attributes["Group"].as_string(), Opportunity.extra_attributes["group"].as_string())),
    ("Category", func.coalesce(Opportunity.extra_attributes["Category"].as_string(), Opportunity.extra_attributes["category"].as_string())),
    ("Service Start Date", func.coalesce(Opportunity.extra_attributes["Service Start Date"].as_string(), Opportunity.extra_attributes["service_start_date"].as_string(), Opportunity.extra_attributes["Service Start date"].as_string())),
    ("Service Expiry date", func.coalesce(Opportunity.extra_attributes["Service Expiry date"].as_string(), Opportunity.extra_attributes["Service End Date"].as_string(), Opportunity.extra_attributes["Service Expiry Date"].as_string(), Opportunity.extra_attributes["service_expiry_date"].as_string(), Opportunity.extra_attributes["service_end_date"].as_string())),
    ("Close Date", func.coalesce(Opportunity.extra_attributes["Close Date"].as_string(), Opportunity.extra_attributes["close_date"].as_string())),
    ("Probability (%)", func.coalesce(Opportunity.extra_attributes["Probability (%)"].as_string(), Opportunity.extra_attributes["probability"].as_string())),
    ("Stage Number", func.coalesce(Opportunity.extra_attributes["Stage Number"].as_string(), Opportunity.extra_attributes["Stage"].as_string(), Opportunity.extra_attributes["stage"].as_string())),
    ("Opportunity Owner", func.coalesce(Opportunity.extra_attributes["Opportunity Owner"].as_string(), Opportunity.extra_attributes["Owner"].as_string(), Opportunity.extra_attributes["owner"].as_string())),
    ("Business Unit", func.coalesce(Opportunity.extra_attributes["Business Unit"].as_string(), Opportunity.extra_attributes["business_unit"].as_string())),
    ("Sales Type", func.coalesce(Opportunity.extra_attributes["Sales Type"].as_string(), Opportunity.extra_attributes["sales_type"].as_string())),
    ("Forecast Category", func.coalesce(Opportunity.extra_attributes["Forecast Category"].as_string(), Opportunity.extra_attributes["forecast_category"].as_string())),
    ("Fiscal Period", Opportunity.extra_attributes["Fiscal Period"].as_string()),
    ("Opportunity Approval Status", Opportunity.extra_attributes["Opportunity Approval Status"].as_string()),
    ("Proposal status For Renewal Opp", Opportunity.extra_attributes["Proposal status For Renewal Opp"].as_string()),
    ("Reason for approval", Opportunity.extra_attributes["Reason for approval"].as_string()),
    ("Country/Territory", func.coalesce(Opportunity.extra_attributes["Country/Territory"].as_string(), Opportunity.extra_attributes["Country"].as_string(), Opportunity.extra_attributes["Country / Territory"].as_string())),
)

_PROJECTION_COLUMNS = (
    Opportunity.id,
    Opportunity.snapshot_id,
    Opportunity.opportunity_id_18,
    Opportunity.opportunity_name,
    Opportunity.account_name,
    Opportunity.sub_region,
    Opportunity.revised_sub_region,
    Opportunity.country_territory,
    Opportunity.business_unit_raw,
    Opportunity.business_unit_primary,
    Opportunity.forecast_category,
    Opportunity.forecast_acv_amount,
    Opportunity.close_date,
    Opportunity.last_modified_date,
    Opportunity.probability_pct,
    Opportunity.approval_status,
    Opportunity.service_expiry_period,
    Opportunity.closing_year,
    Opportunity.renewal_category,
    Opportunity.months_delayed,
    Opportunity.opportunity_owner,
    Opportunity.stage_number,
    Opportunity.is_deleted_or_lost,
    Opportunity.is_reconciliation_entry,
    Opportunity.sales_type,
    Opportunity.fiscal_period,
    Opportunity.in_renewals,
    Opportunity.in_fy2026,
    Opportunity.in_fy2027,
    Opportunity.in_q4_2026,
) + tuple(expr for _, expr in _EXTRACTED_SLIM_COLS)


def _trim_extracted_row(ext_vals: tuple) -> dict | None:
    out: dict[str, Any] = {}
    for (k, _), val in zip(_EXTRACTED_SLIM_COLS, ext_vals):
        if val is not None and val != "" and val != "null":
            out[k] = val
    return out or None


class AnalyticsCacheService:
    def __init__(self) -> None:
        self._lock = RLock()
        self._snapshot_version: int = 1
        self._settings_version: int = 1
        self._snapshot_rows: OrderedDict[tuple, tuple[float, list[OppLite], dict[str, OppLite]]] = OrderedDict()
        self._delayed_dfs: OrderedDict[tuple, tuple[float, Any]] = OrderedDict()
        self._responses: OrderedDict[tuple, tuple[float, Any]] = OrderedDict()
        self._exports: OrderedDict[tuple, tuple[float, tuple[bytes, str]]] = OrderedDict()
        self._settings_vals: dict[tuple, Any] = {}
        self._hits = 0
        self._misses = 0

    def _bind_key(self, db: Session) -> tuple[int, str]:
        try:
            bind = db.get_bind()
            return (id(bind), str(getattr(bind, "url", "")))
        except Exception:
            return (id(db), "")

    def versions(self) -> tuple[int, int]:
        with self._lock:
            return (self._snapshot_version, self._settings_version)

    def invalidate_snapshots(self) -> None:
        with self._lock:
            self._snapshot_version += 1
            self._snapshot_rows.clear()
            self._delayed_dfs.clear()
            self._responses.clear()
            self._exports.clear()

    def invalidate_settings(self) -> None:
        with self._lock:
            self._settings_version += 1
            self._settings_vals.clear()
            self._delayed_dfs.clear()
            self._responses.clear()
            self._exports.clear()

    _MISSING = object()

    def get_setting_value(self, db: Session, key: str) -> Any:
        bind_key = self._bind_key(db)
        with self._lock:
            return self._settings_vals.get((bind_key, self._settings_version, key), self._MISSING)

    def set_setting_value(self, db: Session, key: str, value: Any) -> None:
        bind_key = self._bind_key(db)
        with self._lock:
            if len(self._settings_vals) >= 1024:
                self._settings_vals.clear()
            self._settings_vals[(bind_key, self._settings_version, key)] = value

    def invalidate_all(self) -> None:
        self.invalidate_snapshots()

    def stats(self) -> dict[str, int]:
        with self._lock:
            return {
                "snapshot_version": self._snapshot_version,
                "settings_version": self._settings_version,
                "snapshot_rows_cached": len(self._snapshot_rows),
                "delayed_dfs_cached": len(self._delayed_dfs),
                "responses_cached": len(self._responses),
                "exports_cached": len(self._exports),
                "hits": self._hits,
                "misses": self._misses,
            }

    @staticmethod
    def normalize_filter_key(filter_spec: Any, include_as_of: bool = False) -> tuple:
        if filter_spec is None:
            return ()
        allowed = tuple(sorted(str(x) for x in (getattr(filter_spec, "allowed_owners", None) or [])))
        uc = getattr(filter_spec, "user_context", None)
        uc_owners: tuple = ()
        uc_role = ""
        if uc is not None:
            uc_role = str(getattr(uc, "role", "") or "")
            if getattr(uc, "is_kam", False):
                uc_owners = tuple(sorted(str(x) for x in (getattr(uc, "all_owner_names", None) or [])))
        return (
            str(getattr(filter_spec, "as_of", None) or "") if include_as_of else "",
            str(getattr(filter_spec, "compare", None) or ""),
            str(getattr(filter_spec, "period", None) or ""),
            tuple(sorted(str(x) for x in (getattr(filter_spec, "sales_types", None) or []))),
            tuple(sorted(str(x) for x in (getattr(filter_spec, "regions", None) or []))),
            tuple(sorted(str(x) for x in (getattr(filter_spec, "business_units", None) or []))),
            tuple(sorted(str(x) for x in (getattr(filter_spec, "forecast_categories", None) or []))),
            tuple(sorted(str(x) for x in (getattr(filter_spec, "approval_statuses", None) or []))),
            tuple(sorted(str(x) for x in (getattr(filter_spec, "types", None) or []))),
            bool(getattr(filter_spec, "include_deleted_lost", False)),
            allowed,
            uc_role,
            uc_owners,
        )

    def get_snapshot_lite_data(
        self, db: Session, snapshot_id: str
    ) -> tuple[list[OppLite], dict[str, OppLite]]:
        """Return (all_lite_rows, id_to_lite_row) for a snapshot, loading from DB once."""
        bind_key = self._bind_key(db)
        ttl = max(10, int(getattr(settings, "ANALYTICS_CACHE_TTL_SECONDS", 300)))
        now = time.monotonic()

        with self._lock:
            snap_ver = self._snapshot_version
            cache_key = (bind_key, snap_ver, snapshot_id)
            entry = self._snapshot_rows.get(cache_key)
            if entry is not None:
                ts, rows, by_id = entry
                if (now - ts) <= ttl:
                    self._snapshot_rows.move_to_end(cache_key)
                    self._hits += 1
                    return rows, by_id
                del self._snapshot_rows[cache_key]

        raw_rows = (
            db.query(*_PROJECTION_COLUMNS)
            .filter(Opportunity.snapshot_id == snapshot_id)
            .all()
        )
        lite_rows: list[OppLite] = []
        by_id: dict[str, OppLite] = {}
        for r in raw_rows:
            lite = OppLite(r[:_BASE_COLUMNS_LEN], _trim_extracted_row(r[_BASE_COLUMNS_LEN:]))
            lite_rows.append(lite)
            by_id[lite.id] = lite

        with self._lock:
            if self._snapshot_version == snap_ver:
                while len(self._snapshot_rows) >= 64:
                    self._snapshot_rows.popitem(last=False)
                self._snapshot_rows[cache_key] = (time.monotonic(), lite_rows, by_id)
            self._misses += 1
        return lite_rows, by_id

    def query_scoped_lite(
        self,
        db: Session,
        snapshot_id: str,
        conditions: Iterable[Any],
    ) -> list[OppLite]:
        """
        Execute ScopeService SQL filter returning ONLY Opportunity.id (fast indexed scan,
        no extra_attributes JSON deserialization or ORM hydration), then return cached OppLite rows.
        Preserves exact SQL filtering parity.
        """
        _, by_id = self.get_snapshot_lite_data(db, snapshot_id)
        if not by_id:
            return []
        conds = list(conditions or ())
        if not conds:
            rows, _ = self.get_snapshot_lite_data(db, snapshot_id)
            return list(rows)
        matched_ids = (
            db.query(Opportunity.id)
            .filter(Opportunity.snapshot_id == snapshot_id, *conds)
            .all()
        )
        out: list[OppLite] = []
        for (oid,) in matched_ids:
            lite = by_id.get(oid)
            if lite is not None:
                out.append(lite)
        return out

    def get_or_build_delayed_df(
        self,
        db: Session,
        snapshot_id: str,
        exclude_recon: bool,
        builder: Callable[[list[OppLite]], Any],
    ) -> Any:
        bind_key = self._bind_key(db)
        ttl = max(10, int(getattr(settings, "ANALYTICS_CACHE_TTL_SECONDS", 300)))
        now = time.monotonic()

        with self._lock:
            snap_ver = self._snapshot_version
            cache_key = (bind_key, snap_ver, snapshot_id, bool(exclude_recon))
            entry = self._delayed_dfs.get(cache_key)
            if entry is not None:
                ts, df_cached = entry
                if (now - ts) <= ttl:
                    self._delayed_dfs.move_to_end(cache_key)
                    self._hits += 1
                    return df_cached
                del self._delayed_dfs[cache_key]

        lite_rows, _ = self.get_snapshot_lite_data(db, snapshot_id)
        if exclude_recon:
            filtered = [o for o in lite_rows if not bool(o.is_reconciliation_entry)]
        else:
            filtered = lite_rows
        df = builder(filtered)

        with self._lock:
            if self._snapshot_version == snap_ver:
                while len(self._delayed_dfs) >= 64:
                    self._delayed_dfs.popitem(last=False)
                self._delayed_dfs[cache_key] = (time.monotonic(), df)
            self._misses += 1
        return df

    def get_response(self, db: Session, namespace: str, key_parts: tuple) -> Any | None:
        bind_key = self._bind_key(db)
        ttl = max(10, int(getattr(settings, "ANALYTICS_CACHE_TTL_SECONDS", 300)))
        now = time.monotonic()
        with self._lock:
            cache_key = (bind_key, self._snapshot_version, self._settings_version, namespace, key_parts)
            entry = self._responses.get(cache_key)
            if entry is not None:
                ts, payload = entry
                if (now - ts) <= ttl:
                    self._responses.move_to_end(cache_key)
                    self._hits += 1
                    return copy.deepcopy(payload)
                del self._responses[cache_key]
        return None

    def set_response(self, db: Session, namespace: str, key_parts: tuple, payload: Any) -> None:
        bind_key = self._bind_key(db)
        max_entries = max(32, int(getattr(settings, "ANALYTICS_CACHE_MAX_ENTRIES", 256)))
        with self._lock:
            cache_key = (bind_key, self._snapshot_version, self._settings_version, namespace, key_parts)
            while len(self._responses) >= max_entries:
                self._responses.popitem(last=False)
            self._responses[cache_key] = (time.monotonic(), copy.deepcopy(payload))
            self._misses += 1

    def get_export(self, db: Session, kind: str, key_parts: tuple) -> tuple[bytes, str] | None:
        bind_key = self._bind_key(db)
        ttl = max(10, int(getattr(settings, "ANALYTICS_CACHE_TTL_SECONDS", 300)))
        now = time.monotonic()
        with self._lock:
            cache_key = (bind_key, self._snapshot_version, self._settings_version, kind, key_parts)
            entry = self._exports.get(cache_key)
            if entry is not None:
                ts, val = entry
                if (now - ts) <= ttl:
                    self._exports.move_to_end(cache_key)
                    self._hits += 1
                    return val
                del self._exports[cache_key]
        return None

    def set_export(self, db: Session, kind: str, key_parts: tuple, data: bytes, filename: str) -> None:
        bind_key = self._bind_key(db)
        max_entries = max(4, int(getattr(settings, "EXPORT_CACHE_MAX_ENTRIES", 24)))
        with self._lock:
            cache_key = (bind_key, self._snapshot_version, self._settings_version, kind, key_parts)
            while len(self._exports) >= max_entries:
                self._exports.popitem(last=False)
            self._exports[cache_key] = (time.monotonic(), (data, filename))
            self._misses += 1


analytics_cache = AnalyticsCacheService()
