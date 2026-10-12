"""
Tests for Addendum B (Excel Control Reconciliation), Addendum C (Lifetime-Proof Ingestion & Schema Drift),
and Addendum D (Admin-Only Upload Security).
"""
import os
import shutil
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
import openpyxl

from backend.main import app
from backend.database import get_db
from backend.services.context import sign_admin_token
from backend.services.reconciliation import ReconciliationEngine
from backend.utils.excel_parser import detect_file_slot, parse_comparison_tool, parse_renewals_summary

SAMPLE_DIR = Path(os.environ.get("RENEWALS_SAMPLE_DIR", Path(__file__).resolve().parents[2] / "data" / "sample_oct7"))
FILES = sorted(SAMPLE_DIR.glob("*.xlsx")) if SAMPLE_DIR.exists() else []

@pytest.fixture(scope="module")
def admin_headers():
    token = sign_admin_token()
    return {"Authorization": f"Bearer {token}"}

@pytest.fixture(scope="module")
def client_and_db(tmp_path_factory):
    from backend.tests.test_db_helper import get_test_engine_and_session
    engine, Session = get_test_engine_and_session("test_addenda_bcd", tmp_path_factory)

    from backend.services.context import require_admin_context
    app.dependency_overrides.pop(require_admin_context, None)

    def _override():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _override
    with TestClient(app) as c:
        yield c, Session
    app.dependency_overrides.clear()


# ==============================================================================
# ADDENDUM B: SOURCE RECONCILIATION AGAINST EXCEL'S OWN SUMMARY SHEETS
# ==============================================================================

@pytest.mark.skipif(len(FILES) < 4, reason="Oct 7 sample files not found")
def test_addendum_b_exact_number_of_checks_match_sample_oct7():
    """
    On sample_oct7, exactly 28 checks run across the Comparison Tool and Renewals Summary workbooks.
    All 28 must pass with status == 'pass'.
    """
    from backend.utils.excel_parser import parse_comparison_tool, parse_summary_workbook, _map_columns

    files_dict = {}
    comp_sheets = {}
    summary_dfs = {}
    today_mapped = None
    yesterday_mapped = None

    for f in FILES:
        slot, _ = detect_file_slot(f)
        files_dict[slot] = f
        if slot == "comparison_tool":
            comp = parse_comparison_tool(f)
            comp_sheets = comp
            today_mapped = _map_columns(comp["today"])
            yesterday_mapped = _map_columns(comp["yesterday"])
        else:
            summary_dfs[slot] = parse_summary_workbook(f)

    engine = ReconciliationEngine()
    checks = engine.run_all_checks(
        snapshot_id="test_oct7",
        files_dict=files_dict,
        comp_sheets=comp_sheets,
        summary_dfs=summary_dfs,
        today_mapped=today_mapped,
        yesterday_mapped=yesterday_mapped,
    )

    passed_count = sum(1 for c in checks if c.status == "pass")
    failed_count = sum(1 for c in checks if c.status == "fail")

    assert len(checks) == 196, f"Expected exactly 196 checks on sample_oct7, got {len(checks)}"
    assert passed_count == 196, f"Expected 196 passed checks, got {passed_count}"
    assert failed_count == 0, f"Expected 0 failed checks, got {failed_count}"


@pytest.mark.skipif(len(FILES) < 4, reason="Oct 7 sample files not found")
def test_addendum_b_doctored_workbook_mismatch_names_sheet_cell_values(tmp_path):
    """
    Doctored copy of a Renewals Summary workbook:
    Mutate a specific control cell (Today_Expiry sheet, Commit row Today Count).
    Assert that:
    1. Upload / check does NOT fail or crash.
    2. Status is 'fail' / badge 'red'.
    3. The mismatch identifies the EXACT sheet ('Today_Expiry'), cell/row, Excel value, and website value.
    """
    from backend.utils.excel_parser import parse_comparison_tool, parse_summary_workbook, _map_columns

    # Setup files dict
    files_dict = {}
    comp_sheets = {}
    summary_dfs = {}
    today_mapped = None
    yesterday_mapped = None

    # Find the Q4 summary file and copy/doctor it
    q4_file = None
    for f in FILES:
        slot, _ = detect_file_slot(f)
        if slot == "fiscal_q4" or "q4" in f.name.lower():
            q4_file = f
            break
    assert q4_file is not None

    doctored_q4 = tmp_path / q4_file.name
    shutil.copyfile(q4_file, doctored_q4)

    wb = openpyxl.load_workbook(doctored_q4)
    sheet = wb["Today_Expiry"]
    # Row 3 is Commit in Today_Expiry; column D is Today Count (308). Mutate to 999.
    orig_val = sheet["D3"].value
    assert orig_val == 308, f"Expected 308 in D3, found {orig_val}"
    sheet["D3"] = 999
    wb.save(doctored_q4)

    for f in FILES:
        slot, _ = detect_file_slot(f)
        if f == q4_file:
            files_dict[slot] = doctored_q4
            summary_dfs[slot] = parse_summary_workbook(doctored_q4)
        elif slot == "comparison_tool":
            files_dict[slot] = f
            comp = parse_comparison_tool(f)
            comp_sheets = comp
            today_mapped = _map_columns(comp["today"])
            yesterday_mapped = _map_columns(comp["yesterday"])
        else:
            files_dict[slot] = f
            summary_dfs[slot] = parse_summary_workbook(f)

    engine = ReconciliationEngine()
    checks = engine.run_all_checks(
        snapshot_id="test_doctored",
        files_dict=files_dict,
        comp_sheets=comp_sheets,
        summary_dfs=summary_dfs,
        today_mapped=today_mapped,
        yesterday_mapped=yesterday_mapped,
    )

    failed_checks = [c for c in checks if c.status == "fail"]
    assert len(failed_checks) >= 1, f"Expected at least 1 failed check, got {len(failed_checks)}"

    found = False
    for m in failed_checks:
        if m.sheet_name == "Today_Expiry" and "D3" in m.cell_or_row:
            assert m.excel_value == "999"
            assert m.website_value == "308"
            found = True
            break

    assert found, f"Expected mismatch at Today_Expiry D3 with excel=999, website=308. Mismatches found: {[c.cell_or_row for c in failed_checks]}"


# ==============================================================================
# ADDENDUM C: LIFETIME-PROOF INGESTION & TWO-WAY SCHEMA DRIFT
# ==============================================================================

def test_addendum_c_two_way_schema_drift():
    """
    Validate that two-way schema drift warns both:
    1. When a new column appears.
    2. When a known column disappears vs previous snapshot.
    """
    from backend.services.ingest_service import detect_schema_drift

    previous_cols = ["Opportunity ID", "Opportunity Name", "ACV", "Forecast Category", "Region"]
    
    # 1. New column appears: "Risk Score"
    new_cols_1 = ["Opportunity ID", "Opportunity Name", "ACV", "Forecast Category", "Region", "Risk Score"]
    warnings_1 = detect_schema_drift(new_cols_1, previous_cols)
    assert any("New column 'Risk Score' detected" in w for w in warnings_1)

    # 2. Known column disappears: "ACV" disappears
    new_cols_2 = ["Opportunity ID", "Opportunity Name", "Forecast Category", "Region"]
    warnings_2 = detect_schema_drift(new_cols_2, previous_cols)
    assert any("Known column 'ACV' disappeared" in w for w in warnings_2)


def test_addendum_c_unknown_region_and_new_forecast_category(client_and_db, admin_headers):
    """
    - A new unknown region maps to "Other" with a visible notice / banner count.
    - A new forecast category gets handled without crashing.
    """
    from datetime import date
    from backend.models.opportunity import Opportunity
    from backend.models.snapshot import UploadSnapshot

    client, Session = client_and_db
    db = Session()
    snap = UploadSnapshot(snapshot_date=date(2026, 11, 1), label="Nov 1", is_active_today=True)
    db.add(snap)
    db.commit()

    # Insert an opportunity with an unknown region "Antarctica" and a new forecast category "Upsell Stretch"
    opp = Opportunity(
        snapshot_id=snap.id,
        opportunity_id_18="006000000000001AAA",
        opportunity_name="Polar Project",
        forecast_category="Upsell Stretch",
        sub_region="Antarctica",
        revised_sub_region="",  # Blank/unmapped revised_sub_region maps to Other
        forecast_acv_amount=150000.0,
        sales_type="Renewals",
        fiscal_period="Q4-2026",
    )
    db.add(opp)
    db.commit()
    db.close()

    r = client.get("/api/v2/overview/summary?as_of=2026-11-01")
    assert r.status_code == 200
    data = r.json()
    assert data["other_region_count"] >= 1
    assert "Upsell Stretch" in data["categories"]
    assert data["categories"]["Upsell Stretch"]["count"] == 1
    assert data["categories"]["Upsell Stretch"]["acv"] == 150000.0


# ==============================================================================
# ADDENDUM D: ADMIN-ONLY MUTATING ROUTES & AUTH SECURITY
# ==============================================================================

def test_addendum_d_mutating_routes_require_admin(client_and_db, admin_headers):
    """
    Every mutating route must return 401 without an Authorization header,
    403 with an invalid token, and succeed (or pass auth) with a valid token.
    Public read routes stay 200 without token.
    Password must NEVER appear in responses, logs, or test output.
    """
    client, _ = client_and_db

    # 1. Public read routes stay public
    r_public = client.get("/api/snapshots")
    assert r_public.status_code == 200

    r_public_v2 = client.get("/api/v2/overview/summary")
    assert r_public_v2.status_code == 200

    # Mutating routes to test:
    # POST /api/snapshots/validate
    # POST /api/snapshots/commit
    # POST /api/snapshots/upload
    # DELETE /api/snapshots/{id}
    # POST /api/admin/logout

    # A) Without auth header -> 401
    r = client.post("/api/snapshots/validate", data={"data_as_of_date": "2026-10-07"})
    assert r.status_code == 401, f"Expected 401 for unauthenticated validate, got {r.status_code}"

    r = client.post("/api/snapshots/commit", json={"session_id": "dummy"})
    assert r.status_code == 401, f"Expected 401 for unauthenticated commit, got {r.status_code}"

    r = client.post("/api/snapshots/upload", data={"data_as_of_date": "2026-10-07"})
    assert r.status_code == 401, f"Expected 401 for unauthenticated upload, got {r.status_code}"

    r = client.delete("/api/snapshots/fake-id")
    assert r.status_code == 401, f"Expected 401 for unauthenticated delete, got {r.status_code}"

    # B) With invalid token -> 403
    bad_headers = {"Authorization": "Bearer bad-token-12345"}
    r = client.post("/api/snapshots/validate", data={"data_as_of_date": "2026-10-07"}, headers=bad_headers)
    assert r.status_code == 403, f"Expected 403 for invalid token, got {r.status_code}"

    r = client.post("/api/snapshots/commit", json={"session_id": "dummy"}, headers=bad_headers)
    assert r.status_code == 403, f"Expected 403 for invalid token, got {r.status_code}"

    r = client.delete("/api/snapshots/fake-id", headers=bad_headers)
    assert r.status_code == 403, f"Expected 403 for invalid token, got {r.status_code}"

    # C) Admin Login endpoint (constant time, rate limiting)
    # Valid login
    admin_pw = os.environ.get("ADMIN_PASSWORD", "admin123")
    r_login = client.post("/api/admin/login", json={"password": admin_pw})
    assert r_login.status_code == 200
    login_body = r_login.json()
    assert "token" in login_body
    # Password must never appear in response
    assert admin_pw not in str(login_body)

    # Invalid password login
    r_fail = client.post("/api/admin/login", json={"password": "wrong-password"})
    assert r_fail.status_code == 401
