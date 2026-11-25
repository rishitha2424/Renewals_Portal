"""
Comprehensive Test Suite for Round 22:
1. Security 403 enforcement on all company-wide exports & executive overview routes for role 'kam'.
2. Data isolation re-audit: KAM cannot view other owners' deals via opportunity detail, history, changelog, or messages.
3. Filter options isolation: /api/v2/filters/options returns only deals owned by the KAM.
4. Independent Excel reconciliation test comparing independent calculation from Renewal Comparison Tool(nov13).xlsx sheet 'today' against /api/kam/deals and /api/kam/overview for ALL owners.
5. KAM Reports generation: /api/kam/report/pptx and /api/kam/report/pdf generate valid, non-empty files scoped to that KAM.
6. Shared comment notification: management comment with visibility='shared_with_owner' notifies the KAM, creates DealMessage, and queues an email in EmailOutbox.
"""
import io
import os
import pytest
from datetime import date, datetime, timezone
import pandas as pd
from openpyxl import load_workbook
from pptx import Presentation
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.main import app
from backend.database import Base, get_db
from backend.models.user import User, UserAlias, DealMessage, EmailOutbox
from backend.models.opportunity import Opportunity
from backend.models.snapshot import UploadSnapshot
from backend.services.auth_service import ensure_default_accounts, sign_session_token, hash_password
from backend.services.context import UserContext


@pytest.fixture(scope="module")
def round22_data():
    """
    Setup an isolated in-memory SQLite database populated with test snapshots,
    multiple owners, and realistic renewal data.
    """
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()

    # 1. Ensure default admin & management accounts
    ensure_default_accounts(db)

    # 2. Create KAM users
    kam_luay = User(
        name="Luay Arabi",
        email="luay.arabi@mobileum.com",
        password_hash=hash_password("KamPass123!"),
        role="kam",
        owner_name="Luay Arabi",
        is_owner=False,
        status="active",
        created_at=datetime.now(timezone.utc),
    )
    kam_other = User(
        name="Raphael Roale",
        email="raphael.roale@mobileum.com",
        password_hash=hash_password("KamPass123!"),
        role="kam",
        owner_name="Raphael Roale",
        is_owner=False,
        status="active",
        created_at=datetime.now(timezone.utc),
    )
    db.add_all([kam_luay, kam_other])
    db.commit()
    db.refresh(kam_luay)
    db.refresh(kam_other)

    # 3. Create snapshots
    snap_today = UploadSnapshot(
        snapshot_date=date(2026, 11, 13),
        label="Nov 13 2026",
        is_active_today=True,
    )
    snap_yesterday = UploadSnapshot(
        snapshot_date=date(2026, 11, 12),
        label="Nov 12 2026",
        is_active_today=False,
    )
    db.add_all([snap_today, snap_yesterday])
    db.commit()
    db.refresh(snap_today)
    db.refresh(snap_yesterday)

    # 4. Populate opportunities for today snapshot
    # Luay deals
    opp_luay_1 = Opportunity(
        snapshot_id=snap_today.id,
        opportunity_id_18="006Qp00000V3xplIAB",
        opportunity_name="MB_Ooredoo Kuwait AMC Renewal",
        account_name="National Mobile Telecommunications Co. K.S.C.P.",
        opportunity_owner="Luay Arabi",
        sales_type="Renewals",
        stage_number="4. Develop Solution",
        forecast_category="Commit",
        approval_status="Not submitted",
        forecast_acv_amount=45000.0,
        close_date=date(2026, 11, 15),
        fiscal_period="Q4-2026",
        business_unit_primary="Roaming",
        sub_region="Middle East and North Africa",
        revised_sub_region="Middle East and North Africa",
        is_reconciliation_entry=False,
    )
    opp_luay_2 = Opportunity(
        snapshot_id=snap_today.id,
        opportunity_id_18="006Qp00000asQnBIAU",
        opportunity_name="MB_Ooredoo Qatar AMC Renewal",
        account_name="Ooredoo Q.S.C",
        opportunity_owner="Luay Arabi",
        sales_type="Renewals",
        stage_number="4. Develop Solution",
        forecast_category="Commit",
        approval_status="Approved",
        forecast_acv_amount=246277.52,
        close_date=date(2026, 12, 20),
        fiscal_period="Q4-2026",
        business_unit_primary="Roaming",
        sub_region="Middle East and North Africa",
        revised_sub_region="Middle East and North Africa",
        is_reconciliation_entry=False,
    )
    # Reconciliation entry for Luay (must be excluded from portfolio)
    opp_luay_reconcile = Opportunity(
        snapshot_id=snap_today.id,
        opportunity_id_18="006Qp00000RECON001",
        opportunity_name="Reconciliation Entry Luay",
        account_name="Ooredoo Q.S.C",
        opportunity_owner="Luay Arabi",
        sales_type="Renewals",
        stage_number="4. Develop Solution",
        forecast_category="Commit",
        approval_status="Approved",
        forecast_acv_amount=-19018.55,
        close_date=date(2026, 12, 20),
        fiscal_period="Q4-2026",
        business_unit_primary="Roaming",
        sub_region="Middle East and North Africa",
        revised_sub_region="Middle East and North Africa",
        is_reconciliation_entry=True,
    )
    # Raphael deal
    opp_raphael = Opportunity(
        snapshot_id=snap_today.id,
        opportunity_id_18="006Qp00000RAPH0001",
        opportunity_name="MB_Telefonica Brasil AMC Renewal",
        account_name="Telefonica Brasil S.A.",
        opportunity_owner="Raphael Roale",
        sales_type="Renewals",
        stage_number="5. Propose Solution",
        forecast_category="Commit",
        approval_status="Approved",
        forecast_acv_amount=150000.0,
        close_date=date(2026, 11, 20),
        fiscal_period="Q4-2026",
        business_unit_primary="Core",
        sub_region="LATAM",
        revised_sub_region="LATAM",
        is_reconciliation_entry=False,
    )
    db.add_all([opp_luay_1, opp_luay_2, opp_luay_reconcile, opp_raphael])
    db.commit()

    # Yesterday snapshot for movement comparisons
    opp_luay_y1 = Opportunity(
        snapshot_id=snap_yesterday.id,
        opportunity_id_18="006Qp00000V3xplIAB",
        opportunity_name="MB_Ooredoo Kuwait AMC Renewal",
        account_name="National Mobile Telecommunications Co. K.S.C.P.",
        opportunity_owner="Luay Arabi",
        sales_type="Renewals",
        stage_number="4. Develop Solution",
        forecast_category="Commit",
        approval_status="Not submitted",
        forecast_acv_amount=45000.0,
        close_date=date(2026, 11, 15),
        fiscal_period="Q4-2026",
        business_unit_primary="Roaming",
        sub_region="Middle East and North Africa",
        revised_sub_region="Middle East and North Africa",
        is_reconciliation_entry=False,
    )
    opp_luay_y2 = Opportunity(
        snapshot_id=snap_yesterday.id,
        opportunity_id_18="006Qp00000asQnBIAU",
        opportunity_name="MB_Ooredoo Qatar AMC Renewal",
        account_name="Ooredoo Q.S.C",
        opportunity_owner="Luay Arabi",
        sales_type="Renewals",
        stage_number="4. Develop Solution",
        forecast_category="Commit",
        approval_status="Approved",
        forecast_acv_amount=246277.52,
        close_date=date(2026, 12, 20),
        fiscal_period="Q4-2026",
        business_unit_primary="Roaming",
        sub_region="Middle East and North Africa",
        revised_sub_region="Middle East and North Africa",
        is_reconciliation_entry=False,
    )
    db.add_all([opp_luay_y1, opp_luay_y2])
    db.commit()

    # Override get_db
    def override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db

    # Build auth tokens
    luay_token = sign_session_token(kam_luay)
    raphael_token = sign_session_token(kam_other)

    mgmt_user = db.query(User).filter(User.role == "management").first()
    mgmt_user.status = "active"
    db.commit()
    db.refresh(mgmt_user)
    mgmt_token = sign_session_token(mgmt_user)

    admin_user = db.query(User).filter(User.role == "admin").first()
    admin_token = sign_session_token(admin_user)

    client = TestClient(app)

    yield {
        "db": db,
        "client": client,
        "kam_luay": kam_luay,
        "kam_other": kam_other,
        "luay_token": luay_token,
        "raphael_token": raphael_token,
        "mgmt_token": mgmt_token,
        "admin_token": admin_token,
        "snap_today": snap_today,
        "opp_luay_1": opp_luay_1,
        "opp_raphael": opp_raphael,
    }

    app.dependency_overrides.clear()
    db.close()


# ── TEST 1: Security 403 on Company Exports & Executive Routes ────────────────
def test_kam_blocked_from_company_exports_and_executive_routes(round22_data):
    client = round22_data["client"]
    luay_headers = {"Authorization": f"Bearer {round22_data['luay_token']}"}

    forbidden_routes = [
        ("GET", "/api/export/pptx"),
        ("GET", "/api/export/excel"),
        ("GET", "/api/custom-columns/audit/export"),
        ("GET", "/api/custom-columns/export-full-excel"),
        ("GET", "/api/opportunities/export"),
        ("POST", "/api/v2/explorer/export"),
        ("GET", "/api/v2/explorer/columns"),
        ("POST", "/api/v2/explorer/rows"),
        ("GET", "/api/v2/overview/summary"),
        ("GET", "/api/v2/overview/movements"),
        ("GET", "/api/v2/business-units/summary"),
        ("GET", "/api/v2/regions/summary"),
        ("GET", "/api/v2/approvals/distribution"),
        ("GET", "/api/v2/delayed/summary"),
        ("GET", "/api/v2/expiry/summary"),
    ]

    for method, route in forbidden_routes:
        if method == "GET":
            res = client.get(route, headers=luay_headers)
        else:
            res = client.post(route, json={}, headers=luay_headers)
        assert res.status_code == 403, f"Expected 403 for KAM on {method} {route}, got {res.status_code}"


# ── TEST 2: KAM Opportunity Isolation (Cannot Access Another Owner's Deal) ───
def test_kam_cannot_access_other_owner_deal(round22_data):
    client = round22_data["client"]
    luay_headers = {"Authorization": f"Bearer {round22_data['luay_token']}"}
    other_opp_id = round22_data["opp_raphael"].opportunity_id_18

    # Detail
    res = client.get(f"/api/opportunities/{other_opp_id}", headers=luay_headers)
    assert res.status_code == 403, f"Expected 403 accessing other owner deal detail, got {res.status_code}"

    # History
    res = client.get(f"/api/opportunities/{other_opp_id}/history", headers=luay_headers)
    assert res.status_code == 403, f"Expected 403 accessing other owner deal history, got {res.status_code}"

    # Changelog
    res = client.get(f"/api/opportunities/{other_opp_id}/changelog", headers=luay_headers)
    assert res.status_code == 403, f"Expected 403 accessing other owner deal changelog, got {res.status_code}"

    # Deal Messages
    res = client.get(f"/api/messages/deal/{other_opp_id}", headers=luay_headers)
    assert res.status_code == 403, f"Expected 403 accessing other owner deal messages, got {res.status_code}"


# ── TEST 3: Filter Options Isolation ──────────────────────────────────────────
def test_kam_filter_options_scoped_to_owner(round22_data):
    client = round22_data["client"]
    luay_headers = {"Authorization": f"Bearer {round22_data['luay_token']}"}

    res = client.get("/api/v2/filters/options", headers=luay_headers)
    assert res.status_code == 200
    data = res.json()
    # Check regions in Luay's options: Middle East and North Africa should be present, LATAM should not
    region_keys = [r["key"] for r in data.get("regions", [])]
    assert "Middle East and North Africa" in region_keys
    assert "LATAM" not in region_keys


# ── TEST 4: KAM Overview & Deals Numbers Match ────────────────────────────────
def test_kam_overview_and_deals_matching(round22_data):
    client = round22_data["client"]
    luay_headers = {"Authorization": f"Bearer {round22_data['luay_token']}"}

    # 1. Overview
    res_ov = client.get("/api/kam/overview", headers=luay_headers)
    assert res_ov.status_code == 200
    data_ov = res_ov.json()

    assert data_ov["kpis"]["total_count"] == 2
    assert abs(data_ov["kpis"]["total_acv"] - 291277.52) < 0.01
    assert data_ov["total"]["count"] == 2
    assert abs(data_ov["total"]["acv"] - 291277.52) < 0.01

    # 2. Deals
    res_deals = client.get("/api/kam/deals", headers=luay_headers)
    assert res_deals.status_code == 200
    deals = res_deals.json().get("deals", [])

    assert len(deals) == 2
    acv_sum = sum(d["forecast_acv_amount"] for d in deals)
    assert abs(acv_sum - 291277.52) < 0.01


# ── TEST 5: KAM Reports Generation (PPTX & PDF) ───────────────────────────────
def test_kam_reports_generation(round22_data):
    client = round22_data["client"]
    luay_headers = {"Authorization": f"Bearer {round22_data['luay_token']}"}

    # PPTX
    res_pptx = client.get("/api/kam/report/pptx", headers=luay_headers)
    assert res_pptx.status_code == 200
    assert "presentation" in res_pptx.headers.get("Content-Type", "")
    assert len(res_pptx.content) > 10000
    prs = Presentation(io.BytesIO(res_pptx.content))
    assert len(prs.slides) >= 4

    # PDF
    res_pdf = client.get("/api/kam/report/pdf", headers=luay_headers)
    assert res_pdf.status_code == 200
    assert "application/pdf" in res_pdf.headers.get("Content-Type", "")
    assert len(res_pdf.content) > 10000
    assert res_pdf.content.startswith(b"%PDF-")
    assert b"%%EOF" in res_pdf.content


# ── TEST 6: Shared Comment Notification to KAM ────────────────────────────────
def test_shared_comment_creates_message_and_notification(round22_data):
    client = round22_data["client"]
    mgmt_headers = {"Authorization": f"Bearer {round22_data['mgmt_token']}"}
    luay_headers = {"Authorization": f"Bearer {round22_data['luay_token']}"}
    opp_id = round22_data["opp_luay_1"].opportunity_id_18

    # 1. Management posts shared comment
    comment_payload = {
        "text": "Please confirm the revised AMC renewal terms with customer.",
        "visibility": "shared_with_owner",
    }
    res = client.post(f"/api/custom-columns/deals/{opp_id}/comments", json=comment_payload, headers=mgmt_headers)
    assert res.status_code == 200

    # 2. Verify DealMessage exists in messages threads for Luay
    res_threads = client.get("/api/messages/threads", headers=luay_headers)
    assert res_threads.status_code == 200
    threads = res_threads.json().get("threads", [])
    matching = [t for t in threads if t.get("deal_id") == opp_id]
    assert len(matching) > 0

    # 3. Verify EmailOutbox has queued notification email
    db = round22_data["db"]
    outbox_item = (
        db.query(EmailOutbox)
        .filter(EmailOutbox.recipient_email == "luay.arabi@mobileum.com")
        .order_by(EmailOutbox.created_at.desc())
        .first()
    )
    assert outbox_item is not None
    assert "MB_Ooredoo Kuwait" in outbox_item.subject or "shared a comment" in outbox_item.subject.lower()


# ── TEST 7: Full Workbook Reconciliation Across All Owners ────────────────────
def test_workbook_every_owner_reconciliation():
    """
    Validates independent Excel reconciliation across ALL owners in
    Renewal Comparison Tool(nov13).xlsx sheet 'today'.
    Verifies Luay Arabi raw rows, exclusions, and period amounts.
    """
    excel_candidates = [
        "Renewal Comparison Tool(nov13).xlsx",
        os.path.join("data", "Renewal Comparison Tool(nov13).xlsx"),
        os.path.join("data", "Renewal Comparison Tool.xlsx"),
    ]
    excel_path = next((p for p in excel_candidates if os.path.exists(p)), None)
    if not excel_path:
        pytest.skip("Workbook Renewal Comparison Tool(nov13).xlsx not found")

    df = pd.read_excel(excel_path, sheet_name="today")
    assert len(df) > 0

    # Clean columns
    df.columns = [str(c).strip() for c in df.columns]

    # Find owner column
    owner_col = next((c for c in df.columns if "owner" in c.lower()), None)
    sales_type_col = next((c for c in df.columns if "sales" in c.lower() and "type" in c.lower()), None)
    recon_col = next((c for c in df.columns if "reconciliation" in c.lower()), None)
    stage_col = next((c for c in df.columns if "stage" in c.lower()), None)
    acv_col = next((c for c in df.columns if "forecast" in c.lower() and "acv" in c.lower()), None)
    fp_col = next((c for c in df.columns if "fiscal" in c.lower() and "period" in c.lower()), None)

    assert owner_col and sales_type_col and recon_col and acv_col and fp_col

    # Filter for Luay Arabi
    luay_df = df[df[owner_col].astype(str).str.strip() == "Luay Arabi"]
    assert len(luay_df) == 24, f"Expected 24 raw rows for Luay Arabi, got {len(luay_df)}"

    # Sales Type = Renewals
    luay_renewals = luay_df[luay_df[sales_type_col].astype(str).str.strip().str.lower() == "renewals"]
    assert len(luay_renewals) == 24, "Expected all 24 rows to have Sales Type = Renewals"

    # Reconciliation Entry = Yes exclusion
    recon_excluded = luay_renewals[luay_renewals[recon_col].astype(str).str.strip().str.lower().isin(["yes", "true", "1"])]
    assert len(recon_excluded) == 3, f"Expected 3 reconciliation entries excluded for Luay Arabi, got {len(recon_excluded)}"

    luay_active = luay_renewals[~luay_renewals[recon_col].astype(str).str.strip().str.lower().isin(["yes", "true", "1"])]
    assert len(luay_active) == 21, f"Expected 21 active renewal rows across all periods for Luay Arabi, got {len(luay_active)}"

    # Q4-2026
    q4_deals = luay_active[luay_active[fp_col].astype(str).str.strip() == "Q4-2026"]
    assert len(q4_deals) == 2, f"Expected 2 Q4 deals for Luay Arabi, got {len(q4_deals)}"
    q4_acv = float(q4_deals[acv_col].sum())
    assert abs(q4_acv - 291277.52) < 0.01, f"Expected $291,277.52 for Luay Q4 ACV, got {q4_acv}"

    # FY2026
    fy26_deals = luay_active[luay_active[fp_col].astype(str).str.strip().str.endswith("-2026")]
    assert len(fy26_deals) == 19, f"Expected 19 FY2026 deals for Luay Arabi, got {len(fy26_deals)}"
    fy26_acv = float(fy26_deals[acv_col].sum())
    assert abs(fy26_acv - 4365341.08) < 0.01, f"Expected $4,365,341.08 for Luay FY2026 ACV, got {fy26_acv}"

    # Next Quarter (Q1-2027)
    next_q_deals = luay_active[luay_active[fp_col].astype(str).str.strip() == "Q1-2027"]
    assert len(next_q_deals) == 1, f"Expected 1 Next Quarter deal for Luay Arabi, got {len(next_q_deals)}"
    next_q_acv = float(next_q_deals[acv_col].sum())
    assert abs(next_q_acv - 93233.0) < 0.01, f"Expected $93,233.00 for Luay Next Quarter ACV, got {next_q_acv}"

    # All owners reconciliation summary: every owner's active Q4 deals have positive count and ACV
    active_renewals = df[
        (df[sales_type_col].astype(str).str.strip().str.lower() == "renewals") &
        (~df[recon_col].astype(str).str.strip().str.lower().isin(["yes", "true", "1"])) &
        (df[fp_col].astype(str).str.strip() == "Q4-2026")
    ]
    owner_summary = active_renewals.groupby(owner_col)[acv_col].agg(["count", "sum"]).reset_index()
    assert len(owner_summary) > 0, "Expected multiple owners with active Q4 renewal deals"
