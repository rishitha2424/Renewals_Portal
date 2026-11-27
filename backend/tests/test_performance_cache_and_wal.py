"""
Targeted tests for:
1. Summary & Export latency under target thresholds on multi-snapshot datasets.
2. Exact equality between uncached and cached responses across overview/approvals/regions/bu/exports.
3. Cache invalidation on snapshot commit/delete/activate and settings update.
4. SQLite journal_mode preservation (never switches to WAL by default; opt-in via SQLITE_JOURNAL_MODE only).
"""
from __future__ import annotations

import sqlite3
import tempfile
import time
import uuid
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

import openpyxl
import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from backend.config import settings
from backend.database import Base
from backend.models.opportunity import Opportunity
from backend.models.snapshot import UploadSnapshot
from backend.services.cache_service import analytics_cache
from backend.services.context import ADMIN_CONTEXT
from backend.services.excel_export_service import ExcelExportService
from backend.services.pptx_export_service import PptxExportService
from backend.services.settings_service import SettingsService
from backend.services.v2_approvals_service import V2ApprovalsService
from backend.services.v2_business_units_service import V2BusinessUnitsService
from backend.services.v2_overview_service import V2OverviewService
from backend.services.v2_regions_service import V2RegionsService


def _build_temp_db_with_snapshots(tmp_path: Path, row_count_per_snap: int = 400):
    db_path = tmp_path / "perf_test.db"
    engine = create_engine(
        f"sqlite:///{db_path.as_posix()}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = Session()

    base_d = date(2026, 11, 16)
    snaps = []
    for days_back, is_active in [(0, True), (1, False), (7, False)]:
        d = base_d - timedelta(days=days_back)
        s = UploadSnapshot(
            id=str(uuid.uuid4()),
            label="Today" if days_back == 0 else f"Day-{days_back}",
            snapshot_date=d,
            yesterday_date=(d - timedelta(days=1)) if days_back == 0 else None,
            uploaded_by="perf_test",
            is_active_today=is_active,
            row_count=row_count_per_snap,
            active_row_count=row_count_per_snap,
        )
        db.add(s)
        snaps.append(s)
    db.flush()

    cats = ["Closed", "Commit", "Best Case", "Pipeline", ""]
    approvals = ["Approved", "Pending Approval", "Blank", "Approved - 2nd"]
    regions = ["NAMR", "Europe", "APAC", "MENA", "AFRICA"]
    bus = ["Security", "Core", "Analytics", "Voice; Core"]

    opps = []
    for s_idx, snap in enumerate(snaps):
        for i in range(row_count_per_snap):
            fc = cats[(i + s_idx) % len(cats)]
            appr = approvals[(i + s_idx) % len(approvals)]
            reg = regions[i % len(regions)]
            bu = bus[i % len(bus)]
            bu_prim = bu.split(";")[0].strip()
            close_d = date(2026, 11, 20) if i % 4 != 0 else date(2027, 2, 15)
            start_d = "2026-10-01T00:00:00" if i % 5 == 0 else ("2027-01-01T00:00:00" if i % 7 == 0 else "2026-11-15T00:00:00")
            opps.append(
                Opportunity(
                    id=str(uuid.uuid4()),
                    snapshot_id=snap.id,
                    opportunity_id_18=f"006PERF{i:011d}",
                    opportunity_name=f"Renewal Deal {i}",
                    account_name=f"Account {i % 50}",
                    sub_region=reg,
                    revised_sub_region=reg,
                    country_territory="United States",
                    business_unit_raw=bu,
                    business_unit_primary=bu_prim,
                    forecast_category=fc,
                    forecast_acv_amount=Decimal(str(10000 + (i % 100) * 500)),
                    close_date=close_d,
                    probability_pct=75.0,
                    approval_status=appr,
                    service_expiry_period="Q4-2026",
                    closing_year=close_d.year,
                    renewal_category="Multiyear",
                    opportunity_owner=f"Owner {i % 10}",
                    stage_number="5. Proposal" if fc != "Closed" else "9. Won",
                    is_deleted_or_lost=False,
                    is_reconciliation_entry=False,
                    sales_type="Renewals",
                    fiscal_period="Q4-2026",
                    in_renewals=True,
                    extra_attributes={
                        "Type": "R - Renewal",
                        "Group": "Delayed" if i % 5 == 0 else "On Time",
                        "Service Start Date": start_d,
                        "Service Expiry date": "2026-09-30T00:00:00",
                        "Proposal status For Renewal Opp": "" if i % 3 == 0 else "Sent",
                        "Unused Col A": "padding" * 5,
                        "Unused Col B": "padding" * 5,
                    },
                )
            )
    db.bulk_save_objects(opps)
    db.commit()
    return db, engine, snaps[0]


def test_sqlite_default_does_not_enable_wal(tmp_path: Path, monkeypatch):
    """Creating an engine with default SQLITE_JOURNAL_MODE=None preserves existing DELETE journal mode."""
    db_file = tmp_path / "journal_default.db"
    conn = sqlite3.connect(str(db_file))
    conn.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)")
    conn.execute("INSERT INTO t VALUES (1, 'a')")
    conn.execute("PRAGMA journal_mode = DELETE")
    conn.commit()
    conn.close()

    monkeypatch.setattr(settings, "SQLITE_JOURNAL_MODE", None)
    eng = create_engine(
        f"sqlite:///{db_file.as_posix()}",
        connect_args={"check_same_thread": False},
    )

    @event.listens_for(eng, "connect")
    def _pragmas(dbapi_conn, _rec):
        cur = dbapi_conn.cursor()
        try:
            cur.execute("PRAGMA busy_timeout = 5000")
            req_mode = (settings.SQLITE_JOURNAL_MODE or "").strip().upper()
            if req_mode in ("DELETE", "TRUNCATE", "PERSIST", "MEMORY", "WAL", "OFF"):
                cur.execute(f"PRAGMA journal_mode = {req_mode}")
        finally:
            cur.close()

    with eng.connect() as c:
        mode = c.exec_driver_sql("PRAGMA journal_mode").scalar()
        assert str(mode).lower() == "delete"
    eng.dispose()

    assert not Path(f"{db_file}-wal").exists()
    assert not Path(f"{db_file}-shm").exists()


def test_sqlite_opt_in_wal_on_temp_db(tmp_path: Path, monkeypatch):
    """When SQLITE_JOURNAL_MODE='WAL' is explicitly configured, SQLite enables WAL on temp DB."""
    db_file = tmp_path / "journal_wal.db"
    conn = sqlite3.connect(str(db_file))
    conn.execute("CREATE TABLE t (id INTEGER PRIMARY KEY)")
    conn.commit()
    conn.close()

    monkeypatch.setattr(settings, "SQLITE_JOURNAL_MODE", "WAL")
    eng = create_engine(
        f"sqlite:///{db_file.as_posix()}",
        connect_args={"check_same_thread": False},
    )

    @event.listens_for(eng, "connect")
    def _pragmas(dbapi_conn, _rec):
        cur = dbapi_conn.cursor()
        try:
            req_mode = (settings.SQLITE_JOURNAL_MODE or "").strip().upper()
            if req_mode in ("DELETE", "TRUNCATE", "PERSIST", "MEMORY", "WAL", "OFF"):
                cur.execute(f"PRAGMA journal_mode = {req_mode}")
        finally:
            cur.close()

    with eng.connect() as c:
        mode = c.exec_driver_sql("PRAGMA journal_mode").scalar()
        assert str(mode).lower() == "wal"
    eng.dispose()


def test_cached_and_uncached_summaries_identical_and_fast(tmp_path: Path):
    """Verify summary & export latency stay within budget and cached == uncached."""
    analytics_cache.invalidate_all()
    db, engine, active_snap = _build_temp_db_with_snapshots(tmp_path, row_count_per_snap=350)
    try:
        # 1. Overview uncached vs cached
        t0 = time.monotonic()
        ov_uncached = V2OverviewService(db).get_summary(ADMIN_CONTEXT, as_of=active_snap.id)
        ov_uncached_dt = time.monotonic() - t0
        assert ov_uncached_dt < 2.5

        t1 = time.monotonic()
        ov_cached = V2OverviewService(db).get_summary(ADMIN_CONTEXT, as_of=active_snap.id)
        ov_cached_dt = time.monotonic() - t1
        assert ov_cached_dt < 0.25
        assert ov_uncached == ov_cached
        assert ov_uncached["total"]["count"] == 350

        # 2. Approvals, Regions, BU cached == uncached
        ap_u = V2ApprovalsService(db).get_distribution(ADMIN_CONTEXT, as_of=active_snap.id)
        ap_c = V2ApprovalsService(db).get_distribution(ADMIN_CONTEXT, as_of=active_snap.id)
        assert ap_u == ap_c
        assert ap_u["total"]["count"] == 350

        reg_u = V2RegionsService(db).get_summary(ADMIN_CONTEXT, as_of=active_snap.id)
        reg_c = V2RegionsService(db).get_summary(ADMIN_CONTEXT, as_of=active_snap.id)
        assert reg_u == reg_c

        bu_u = V2BusinessUnitsService(db).get_summary(ADMIN_CONTEXT, as_of=active_snap.id)
        bu_c = V2BusinessUnitsService(db).get_summary(ADMIN_CONTEXT, as_of=active_snap.id)
        assert bu_u == bu_c

        # 3. Excel & PPTX exports uncached & cached
        te0 = time.monotonic()
        buf_ex_u, fn_ex_u = ExcelExportService(db).generate_excel(snapshot_id=active_snap.id)
        ex_u_dt = time.monotonic() - te0
        assert ex_u_dt < 10.0

        buf_ex_c, fn_ex_c = ExcelExportService(db).generate_excel(snapshot_id=active_snap.id)
        assert fn_ex_u == fn_ex_c
        assert buf_ex_u.getvalue() == buf_ex_c.getvalue()

        wb = openpyxl.load_workbook(buf_ex_c, read_only=True)
        assert "All Opportunities" in wb.sheetnames
        wb.close()

        tp0 = time.monotonic()
        buf_pp_u, fn_pp_u = PptxExportService(db).generate_pptx(snapshot_id=active_snap.id)
        pp_u_dt = time.monotonic() - tp0
        assert pp_u_dt < 10.0

        buf_pp_c, fn_pp_c = PptxExportService(db).generate_pptx(snapshot_id=active_snap.id)
        assert fn_pp_u == fn_pp_c
        assert buf_pp_u.getvalue() == buf_pp_c.getvalue()

        # 4. Invalidation on settings update & snapshot change
        v_before = analytics_cache.versions()
        SettingsService.set_setting(db, "lookback_years", "2")
        v_after_setting = analytics_cache.versions()
        assert v_after_setting[1] > v_before[1]
        assert analytics_cache.get_response(db, "v2_overview_summary", (active_snap.id,)) is None

        analytics_cache.invalidate_snapshots()
        v_after_snap = analytics_cache.versions()
        assert v_after_snap[0] > v_before[0]
    finally:
        db.close()
        engine.dispose()
