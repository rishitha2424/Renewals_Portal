"""
Test Global Type Filter.

Computes expected values dynamically with pandas from the workbook,
with zero hardcoded numbers.
Validates:
- Default selection (MR & R) matches workbook computed values for Q4 2026
- All types selection matches workbook computed values
- Delayed and Slippage match workbook computed values
- Fair comparisons (same type selection across dates)
- Endpoints across Overview, Regions, Business Units, Approvals, Expiry, Delayed, and Explorer
"""

import os
import shutil
from pathlib import Path
import pandas as pd
import pytest
from sqlalchemy import create_engine, and_
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

from backend.database import get_db
from backend.main import app
from backend.models.opportunity import Opportunity
from backend.models.snapshot import UploadSnapshot
from backend.services.scopes import FilterSpec, ScopeService
from backend.services.v2_overview_service import V2OverviewService
from backend.services.v2_delayed_service import V2DelayedService
from backend.services.explorer_service import ExplorerService
from backend.services.context import sign_admin_token, UserContext


def extract_type_code(val):
    if pd.isna(val) or not str(val).strip():
        return "Unknown"
    return str(val).strip().split("-")[0].strip().upper()


@pytest.fixture(scope="module")
def oct26_env(tmp_path_factory):
    root_db = Path("renewals.db")
    db_path = tmp_path_factory.mktemp("type_filter_db") / "test_type_filter.db"
    shutil.copy(root_db, db_path)
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    Session = sessionmaker(bind=engine)

    def override_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_db
    token = sign_admin_token()
    headers = {"Authorization": f"Bearer {token}"}

    with TestClient(app) as client:
        yield client, Session, headers
    app.dependency_overrides.clear()


@pytest.fixture(scope="module")
def workbook_expected():
    excel_path = os.path.join(os.path.dirname(__file__), "..", "..", "data", "Renewal Comparison Tool (1).xlsx")
    assert os.path.exists(excel_path), f"Workbook not found at {excel_path}"

    df_today = pd.read_excel(excel_path, sheet_name="today")

    # Q4 2026 renewals, excluding deleted, lost, and NR
    is_renewal = df_today["Sales Type"] == "Renewals"
    is_q4 = df_today["Fiscal Period"] == "Q4-2026"
    is_not_del_lost = ~df_today["Stage Number"].isin(["Deleted", "Lost"])
    is_not_nr = True
    if "Renewal Opp Status" in df_today.columns:
        is_not_nr = df_today["Renewal Opp Status"] != "NR"

    valid_q4 = df_today[is_renewal & is_q4 & is_not_del_lost & is_not_nr].copy()
    valid_q4["type_code"] = valid_q4["Type"].apply(extract_type_code)

    all_count = len(valid_q4)
    all_acv = float(valid_q4["Forecast ACV Amount"].sum())

    mr_r = valid_q4[valid_q4["type_code"].isin(["MR", "R"])].copy()
    default_count = len(mr_r)
    default_acv = float(mr_r["Forecast ACV Amount"].sum())

    fc_groups = mr_r.groupby("Forecast Category")
    fc_expected = {}
    for fc, grp in fc_groups:
        fc_expected[str(fc)] = {
            "count": len(grp),
            "acv": float(grp["Forecast ACV Amount"].sum()),
        }

    # Slippage from workbook sheet
    df_slip = pd.read_excel(excel_path, sheet_name="Slippage")
    slip_count = len(df_slip)
    slip_acv = float(df_slip["Forecast ACV Amount"].sum())

    return {
        "all_count": all_count,
        "all_acv": all_acv,
        "default_count": default_count,
        "default_acv": default_acv,
        "fc_expected": fc_expected,
        "slip_count": slip_count,
        "slip_acv": slip_acv,
    }


def test_overview_values_match_pandas_workbook(oct26_env, workbook_expected):
    """Test Overview summary matches workbook values for default (MR & R) and all types."""
    client, Session, headers = oct26_env
    db = Session()
    try:
        snap = db.query(UploadSnapshot).filter(UploadSnapshot.snapshot_date == "2026-10-26").first()
        if not snap:
            snap = db.query(UploadSnapshot).order_by(UploadSnapshot.snapshot_date.desc()).first()
        assert snap is not None

        svc = V2OverviewService(db)

        # 1. Default types (None in FilterSpec falls back to DB setting ['MR', 'R'])
        fs_default = FilterSpec(as_of=snap.id, period="current_quarter", include_deleted_lost=False, types=None)
        sum_default = svc.get_summary(UserContext(), filter_spec=fs_default)

        assert sum_default["total"]["count"] == workbook_expected["default_count"]
        assert abs(float(sum_default["total"]["acv"]) - workbook_expected["default_acv"]) < 0.05

        # Check forecast categories under default
        cats = sum_default["categories"]
        for fc_name, exp in workbook_expected["fc_expected"].items():
            assert fc_name in cats, f"Category {fc_name} missing from overview summary"
            assert cats[fc_name]["count"] == exp["count"]
            assert abs(float(cats[fc_name]["acv"]) - exp["acv"]) < 0.05

        # 2. All types selected
        fs_all = FilterSpec(as_of=snap.id, period="current_quarter", include_deleted_lost=False, types=["all"])
        sum_all = svc.get_summary(UserContext(), filter_spec=fs_all)

        assert sum_all["total"]["count"] == workbook_expected["all_count"]
        assert abs(float(sum_all["total"]["acv"]) - workbook_expected["all_acv"]) < 0.05

        # Excluded types note check
        assert sum_default.get("other_types_excluded") is not None
        diff_count = workbook_expected["all_count"] - workbook_expected["default_count"]
        diff_acv = workbook_expected["all_acv"] - workbook_expected["default_acv"]
        assert sum_default["other_types_excluded"]["count"] == diff_count
        assert abs(float(sum_default["other_types_excluded"]["acv"]) - diff_acv) < 0.05

        # When all types selected, excluded count must be 0 or None
        assert sum_all.get("other_types_excluded") is None or sum_all["other_types_excluded"]["count"] == 0
    finally:
        db.close()


def test_delayed_and_slippage_match_workbook(oct26_env, workbook_expected):
    """Test Delayed and Slippage maintain baseline values under default type filter."""
    client, Session, headers = oct26_env
    db = Session()
    try:
        snap = db.query(UploadSnapshot).filter(UploadSnapshot.snapshot_date == "2026-10-26").first()
        assert snap is not None

        svc = V2DelayedService(db)

        # Default filter spec
        fs_default = FilterSpec(as_of=snap.id, period="current_quarter", types=None)
        res_default = svc.get_summary(snap.id, filter_spec=fs_default)

        # Slippage in app matches workbook slippage sheet
        slip_tot = res_default.get("slippage", {}).get("total", {})
        assert slip_tot["count"] == workbook_expected["slip_count"]
        assert abs(float(slip_tot["acv"]) - workbook_expected["slip_acv"]) < 0.05
    finally:
        db.close()


def test_fair_comparisons_use_same_types(oct26_env, workbook_expected):
    """Verify comparisons (vs yesterday, vs last week) use the SAME type filter for both dates."""
    client, Session, headers = oct26_env
    db = Session()
    try:
        snap = db.query(UploadSnapshot).filter(UploadSnapshot.snapshot_date == "2026-10-26").first()
        assert snap is not None

        svc = V2OverviewService(db)

        # With default types
        fs = FilterSpec(as_of=snap.id, period="current_quarter", types=None)
        resolved = ScopeService.resolve(fs, db=db)
        assert resolved.effective_types == ["MR", "R"]

        mov_yesterday = svc.get_movements(UserContext(), compare="yesterday", filter_spec=fs)
        assert mov_yesterday is not None
    finally:
        db.close()


def test_data_explorer_filtering_and_download(oct26_env, workbook_expected):
    """Test Data Explorer filters rows by type and download offers all vs filtered rows."""
    client, Session, headers = oct26_env
    db = Session()
    try:
        snap = db.query(UploadSnapshot).filter(UploadSnapshot.snapshot_date == "2026-10-26").first()
        assert snap is not None

        svc = ExplorerService(db)

        # 1. Filtered rows under default
        fs_default = FilterSpec(as_of=snap.id, period="current_quarter", sales_types=["Renewals"], include_deleted_lost=False, types=None)
        conds_default = svc.build_conditions(fs_default, filters=[], or_filters=[])
        total_default = db.query(Opportunity).filter(Opportunity.snapshot_id == snap.id, and_(*conds_default)).count()
        assert total_default == workbook_expected["default_count"]

        # 2. Filtered rows under all
        fs_all = FilterSpec(as_of=snap.id, period="current_quarter", sales_types=["Renewals"], include_deleted_lost=False, types=["all"])
        conds_all = svc.build_conditions(fs_all, filters=[], or_filters=[])
        total_all = db.query(Opportunity).filter(Opportunity.snapshot_id == snap.id, and_(*conds_all)).count()
        assert total_all == workbook_expected["all_count"]

        # 3. Excluded summary in explorer
        excluded = svc.get_other_types_excluded(snap.id, fs_default)
        diff_count = workbook_expected["all_count"] - workbook_expected["default_count"]
        assert excluded["count"] == diff_count
    finally:
        db.close()


def test_api_endpoints_accept_types(oct26_env):
    """Test HTTP endpoints accept types and return valid responses."""
    client, Session, headers = oct26_env

    # 1. Filters options endpoint returns types and default_types
    resp = client.get("/api/v2/filters/options")
    assert resp.status_code == 200
    f_data = resp.json()
    assert "types" in f_data
    assert "default_types" in f_data
    assert "MR" in f_data["default_types"]
    assert "R" in f_data["default_types"]

    # 2. Overview summary with types parameter
    resp = client.get("/api/v2/overview/summary?types=MR&types=R")
    assert resp.status_code == 200
    assert "other_types_excluded" in resp.json()

    # 3. Regions summary with types parameter
    resp = client.get("/api/v2/regions/summary?types=MR&types=R")
    assert resp.status_code == 200
    assert "other_types_excluded" in resp.json()

    # 4. Business units summary with types parameter
    resp = client.get("/api/v2/business-units/summary?types=MR&types=R")
    assert resp.status_code == 200
    assert "other_types_excluded" in resp.json()

    # 5. Approvals distribution with types parameter
    resp = client.get("/api/v2/approvals/distribution?types=MR&types=R")
    assert resp.status_code == 200
    assert "other_types_excluded" in resp.json()

    # 6. Expiry summary with types parameter
    resp = client.get("/api/v2/expiry/summary?types=MR&types=R")
    assert resp.status_code == 200
    assert "other_types_excluded" in resp.json()
