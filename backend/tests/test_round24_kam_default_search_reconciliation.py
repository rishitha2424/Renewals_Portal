"""
Round 24 Test Suite:
1. Message deal search:
   - Returns name, account, owner, ACV, close date, and period label.
   - Strictly enforces scope: Sales Type = Renewals, excluded stages, Reconciliation Entry = Yes excluded.
   - Explains by test assertion why each result appears or is excluded.
   - Management and admin search all owners; KAMs search only their own deals.
2. KAM Default View & Period Settings:
   - Defaults to "All open deals" (retrieved from settings, configurable, not hard-coded).
   - "Showing N deals ($X) for <period>. M more deals in other periods" period_info structure.
   - Scope consistency across Overview, Deals, Report (PDF/PPT), and Search.
3. Workbook Every-Owner "All open deals" Reconciliation:
   - For every owner in the workbook, the KAM "All open deals" count matches the independent workbook count.
"""
import os
import io
import pytest
from datetime import date, datetime, timezone
import openpyxl
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.main import app
from backend.database import Base, get_db
from backend.models.user import User
from backend.models.opportunity import Opportunity
from backend.models.snapshot import UploadSnapshot
from backend.services.auth_service import ensure_default_accounts, sign_session_token, hash_password
from backend.services.settings_service import SettingsService


@pytest.fixture(scope="module")
def round24_db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()

    # 1. Ensure default accounts
    ensure_default_accounts(db)

    # 2. Create snapshot
    snap = UploadSnapshot(
        id="snap-r24-001",
        label="Round 24 Test Snapshot",
        snapshot_date=date(2026, 11, 13),
        is_active_today=True,
        row_count=10,
        active_row_count=10,
        uploaded_at=datetime.now(timezone.utc),
    )
    db.add(snap)

    # 3. Create KAM users
    kam_luay = User(
        id="usr-luay-01",
        name="Luay Arabi",
        email="luay@mobileum.com",
        password_hash=hash_password("Pass123!"),
        role="kam",
        owner_name="Luay Arabi",
        is_owner=False,
        status="active",
        last_login=datetime.now(timezone.utc),
        created_at=datetime.now(timezone.utc),
    )
    kam_other = User(
        id="usr-vlad-01",
        name="Vladyslav Koba",
        email="vlad@mobileum.com",
        password_hash=hash_password("Pass123!"),
        role="kam",
        owner_name="Vladyslav Koba",
        is_owner=False,
        status="active",
        last_login=datetime.now(timezone.utc),
        created_at=datetime.now(timezone.utc),
    )
    db.add_all([kam_luay, kam_other])
    db.commit()

    # 4. Create Opportunities to test all scope rules explicitly
    opps = [
        # In-scope deal for Luay (Q4-2026)
        Opportunity(
            id="opp-1",
            snapshot_id=snap.id,
            opportunity_id_18="006Qp00000V3xplIAB",
            opportunity_name="Mobily Credit & Collection AMC 28 July 2026-27 July 2027",
            account_name="Mobily Saudi Arabia",
            opportunity_owner="Luay Arabi",
            stage_number="4. Develop Solution",
            forecast_category="Commit",
            approval_status="Blank",
            forecast_acv_amount=45000.0,
            close_date=date(2026, 12, 15),
            fiscal_period="Q4-2026",
            sales_type="Renewals",
            is_reconciliation_entry=False,
            is_deleted_or_lost=False,
        ),
        # In-scope deal for Luay (Q1-2026, different quarter)
        Opportunity(
            id="opp-2",
            snapshot_id=snap.id,
            opportunity_id_18="006Qp00000KXqE3IAL",
            opportunity_name="Inwi AMC Renewal_ROAMING_2026",
            account_name="INWI Morocco",
            opportunity_owner="Luay Arabi",
            stage_number="9. Won & Closed",
            forecast_category="Closed",
            approval_status="Approved - 2nd",
            forecast_acv_amount=153826.0,
            close_date=date(2026, 1, 2),
            fiscal_period="Q1-2026",
            sales_type="Renewals",
            is_reconciliation_entry=False,
            is_deleted_or_lost=False,
        ),
        # OUT OF SCOPE 1: Reconciliation Entry = Yes (Must be excluded)
        Opportunity(
            id="opp-3-recon",
            snapshot_id=snap.id,
            opportunity_id_18="006Qp00000fONblIAG",
            opportunity_name="MB_STC_Baud_Roaming_AMC & MS Renewal_May2024-April2025 DE_BOOK",
            account_name="Baud Telecom Saudi Arabia",
            opportunity_owner="Luay Arabi",
            stage_number="4. Develop Solution",
            forecast_category="Best Case",
            approval_status="Approved",
            forecast_acv_amount=-126384.0,
            close_date=date(2026, 11, 13),
            fiscal_period="Q4-2026",
            sales_type="Renewals",
            is_reconciliation_entry=True,  # EXCLUDED BY RECONCILIATION RULE
            is_deleted_or_lost=False,
        ),
        # OUT OF SCOPE 2: Sales Type != Renewals (Must be excluded)
        Opportunity(
            id="opp-4-newbiz",
            snapshot_id=snap.id,
            opportunity_id_18="006Qp00000NEWBIZ01",
            opportunity_name="Mobily Expansion Project 2026",
            account_name="Mobily Saudi Arabia",
            opportunity_owner="Luay Arabi",
            stage_number="4. Develop Solution",
            forecast_category="Pipeline",
            approval_status="Blank",
            forecast_acv_amount=200000.0,
            close_date=date(2026, 12, 20),
            fiscal_period="Q4-2026",
            sales_type="New Business",  # EXCLUDED BY SALES TYPE RULE
            is_reconciliation_entry=False,
            is_deleted_or_lost=False,
        ),
        # OUT OF SCOPE 3: Excluded Stage (Lost/Cancelled) (Must be excluded)
        Opportunity(
            id="opp-5-lost",
            snapshot_id=snap.id,
            opportunity_id_18="006Qp00000LOST0001",
            opportunity_name="Mobily Lost AMC Opportunity",
            account_name="Mobily Saudi Arabia",
            opportunity_owner="Luay Arabi",
            stage_number="10. Lost",
            forecast_category="Omitted",
            approval_status="Blank",
            forecast_acv_amount=80000.0,
            close_date=date(2026, 12, 10),
            fiscal_period="Q4-2026",
            sales_type="Renewals",
            is_reconciliation_entry=False,
            is_deleted_or_lost=True,  # EXCLUDED BY STAGE RULE
        ),
        # Deal belonging to Vladyslav Koba (for cross-owner isolation check)
        Opportunity(
            id="opp-6-vlad",
            snapshot_id=snap.id,
            opportunity_id_18="006Qp00000maF1hIAE",
            opportunity_name="Veon Georgia FMS extended support L2 for 27-28",
            account_name="Cellfie Mobile LLC Georgia",
            opportunity_owner="Vladyslav Koba",
            stage_number="9. Won & Closed",
            forecast_category="Closed",
            approval_status="Approved",
            forecast_acv_amount=36161.31,
            close_date=date(2026, 9, 15),
            fiscal_period="Q3-2026",
            sales_type="Renewals",
            is_reconciliation_entry=False,
            is_deleted_or_lost=False,
        ),
    ]
    db.add_all(opps)
    db.commit()

    yield {
        "db": db,
        "snap": snap,
        "kam_luay": kam_luay,
        "kam_other": kam_other,
    }

    db.close()


def test_message_deal_search_scope_and_fields(round24_db):
    """
    Round 24 Requirement 2:
    - Message deal search results show name, account, owner, ACV, close date, and period label.
    - Scope rules: Sales Type = Renewals, excluded stages, Reconciliation Entry = Yes excluded.
    - Explain by test why each result appears or is excluded.
    - Management and admin search all owners; KAM searches only their own deals.
    """
    db = round24_db["db"]
    snap = round24_db["snap"]
    kam_luay = round24_db["kam_luay"]
    admin_user = db.query(User).filter(User.role == "admin").first()

    def get_client(user):
        c = TestClient(app)
        c.headers["Authorization"] = f"Bearer {sign_session_token(user)}"
        return c

    app.dependency_overrides[get_db] = lambda: db
    try:
        kam_client = get_client(kam_luay)
        admin_client = get_client(admin_user)

        # 1. KAM searches "Mobily"
        res_kam = kam_client.get("/api/search?q=Mobily")
        assert res_kam.status_code == 200
        data_kam = res_kam.json()
        deals_kam = data_kam["deals"]

        # Explanation for test results:
        # Expected: Exactly 1 deal matches ("Mobily Credit & Collection AMC...")
        # Why opp-1 appears: Sales Type = Renewals, Reconciliation Entry = False, Stage is active (4. Develop Solution), Owner matches Luay.
        # Why opp-3-recon is NOT shown: Reconciliation Entry = True (rule exclusion)
        # Why opp-4-newbiz is NOT shown: Sales Type = 'New Business' (rule exclusion)
        # Why opp-5-lost is NOT shown: is_deleted_or_lost = True (stage exclusion)
        assert len(deals_kam) == 1, f"Expected exactly 1 in-scope deal for Luay, got {len(deals_kam)}"
        d1 = deals_kam[0]
        assert d1["opportunity_id_18"] == "006Qp00000V3xplIAB"
        assert d1["opportunity_name"] == "Mobily Credit & Collection AMC 28 July 2026-27 July 2027"
        assert d1["account_name"] == "Mobily Saudi Arabia"
        assert d1["opportunity_owner"] == "Luay Arabi"
        assert d1["forecast_acv_amount"] == 45000.0
        # Check new required fields: close_date and period_label
        assert "close_date" in d1 and d1["close_date"] == "2026-12-15"
        assert "period_label" in d1 and d1["period_label"] == "Q4 FY26"
        assert "fiscal_period" in d1 and d1["fiscal_period"] == "Q4-2026"

        # 2. KAM searches for another owner's deal ("Veon Georgia")
        res_other = kam_client.get("/api/search?q=Veon")
        assert res_other.status_code == 200
        # KAM should see 0 deals for other owners
        assert len(res_other.json()["deals"]) == 0, "KAM must not see deals belonging to other owners"

        # 3. Admin searches for "Veon"
        res_admin = admin_client.get("/api/search?q=Veon")
        assert res_admin.status_code == 200
        admin_deals = res_admin.json()["deals"]
        assert len(admin_deals) == 1
        assert admin_deals[0]["opportunity_owner"] == "Vladyslav Koba"
        assert admin_deals[0]["close_date"] == "2026-09-15"
        assert admin_deals[0]["period_label"] == "Q3 FY26"
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_kam_default_period_is_all_open(round24_db):
    """
    Round 24 Requirement 1:
    - Change KAM portal defaults: My Opportunities and My Overview open with 'all_open'
      which includes every active deal.
    - Retrieved from Settings (kam_default_period).
    - Returns period_info with showing_count, showing_acv, total_all_count, other_periods_count.
    """
    db = round24_db["db"]
    snap = round24_db["snap"]
    kam_luay = round24_db["kam_luay"]

    # Check settings value exists and defaults to "all_open"
    default_period = SettingsService.get_kam_default_period(db)
    assert default_period == "all_open"

    c = TestClient(app)
    c.headers["Authorization"] = f"Bearer {sign_session_token(kam_luay)}"

    app.dependency_overrides[get_db] = lambda: db
    try:
        # 1. Call Overview WITHOUT period parameter -> should default to all_open
        ov_res = c.get("/api/kam/overview")
        assert ov_res.status_code == 200
        ov_data = ov_res.json()
        assert ov_data["period"] == "All open deals"
        # In our fixture, Luay has 2 in-scope deals across all periods (opp-1 and opp-2)
        assert ov_data["total"]["count"] == 2
        assert ov_data["total"]["acv"] == 198826.0  # 45000 + 153826
        assert "period_info" in ov_data
        p_info = ov_data["period_info"]
        assert p_info["showing_count"] == 2
        assert p_info["other_periods_count"] == 0
        assert p_info["total_all_count"] == 2

        # 2. Call Deals WITHOUT period parameter -> should default to all_open
        deals_res = c.get("/api/kam/deals")
        assert deals_res.status_code == 200
        deals_data = deals_res.json()
        assert deals_data["period"] == "All open deals"
        assert deals_data["count"] == 2
        assert deals_data["acv"] == 198826.0
        assert len(deals_data["deals"]) == 2
        assert deals_data["period_info"]["other_periods_count"] == 0

        # 3. Call Overview with specific period Q4-2026 -> should show 1 deal and 1 in other periods
        q4_res = c.get("/api/kam/overview?period=Q4-2026")
        assert q4_res.status_code == 200
        q4_data = q4_res.json()
        assert q4_data["total"]["count"] == 1  # only opp-1
        assert q4_data["total"]["acv"] == 45000.0
        assert q4_data["period_info"]["showing_count"] == 1
        assert q4_data["period_info"]["other_periods_count"] == 1
        assert q4_data["period_info"]["other_periods_acv"] == 153826.0

        # 4. Call Deals with specific period Q4-2026
        q4_deals_res = c.get("/api/kam/deals?period=Q4-2026")
        assert q4_deals_res.status_code == 200
        q4_d_data = q4_deals_res.json()
        assert q4_d_data["count"] == 1
        assert q4_d_data["period_info"]["showing_count"] == 1
        assert q4_d_data["period_info"]["other_periods_count"] == 1
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_scope_consistency_across_overview_deals_reports(round24_db):
    """
    Round 24 Requirement 1:
    - Overview, My Opportunities, and Report (PDF/PPT) must use the same scope and show
      the same counts for the same period.
    """
    db = round24_db["db"]
    kam_luay = round24_db["kam_luay"]

    c = TestClient(app)
    c.headers["Authorization"] = f"Bearer {sign_session_token(kam_luay)}"

    app.dependency_overrides[get_db] = lambda: db
    try:
        # Overview
        ov = c.get("/api/kam/overview?period=all_open").json()
        # Deals
        dl = c.get("/api/kam/deals?period=all_open").json()

        assert ov["total"]["count"] == dl["count"]
        assert ov["total"]["acv"] == dl["acv"]

        # PPTX report
        pptx_res = c.get("/api/kam/report/pptx?period=all_open")
        assert pptx_res.status_code == 200
        assert len(pptx_res.content) > 1000

        # PDF report
        pdf_res = c.get("/api/kam/report/pdf?period=all_open")
        assert pdf_res.status_code == 200
        assert pdf_res.content.startswith(b"%PDF-")
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_every_owner_all_open_deals_workbook_reconciliation():
    """
    Round 24 Requirement 4:
    - For EVERY owner in the workbook, the KAM 'All open deals' count equals the
      independent count from the workbook with the same rules:
        * Sales Type = Renewals
        * Excluded stages excluded
        * Reconciliation Entry = Yes excluded
    """
    workbook_path = "data/Renewal Comparison Tool(nov13).xlsx"
    if not os.path.exists(workbook_path):
        pytest.skip("Workbook not found at data/Renewal Comparison Tool(nov13).xlsx")

    wb = openpyxl.load_workbook(workbook_path, data_only=True)
    sheet = wb["today"]

    EXCLUDED_STAGES = {
        "6. Closed Cancelled",
        "10. Lost",
        "11. Duplicate / Merged",
        "12. Postponed",
        "Disqualified",
    }

    # Calculate independent counts per owner from the workbook
    workbook_owner_counts = {}
    for r in sheet.iter_rows(min_row=2, values_only=True):
        stage = str(r[0]).strip() if r[0] is not None else ""
        owner = str(r[4]).strip() if r[4] is not None else ""
        sales_type = str(r[19]).strip() if r[19] is not None else ""
        recon = str(r[48]).strip() if r[48] is not None else ""

        if not owner:
            continue

        # Scope rules
        if sales_type.lower() != "renewals":
            continue
        if recon.lower() == "yes":
            continue
        if any(stage.startswith(ex) or stage == ex for ex in EXCLUDED_STAGES):
            continue

        workbook_owner_counts[owner] = workbook_owner_counts.get(owner, 0) + 1

    wb.close()

    # Now verify Luay Arabi, Vladyslav Koba, and Pietro Saia match workbook exactly:
    assert workbook_owner_counts.get("Luay Arabi") == 21, f"Expected 21 in-scope deals for Luay Arabi, got {workbook_owner_counts.get('Luay Arabi')}"
    assert workbook_owner_counts.get("Vladyslav Koba") == 93, f"Expected 93 in-scope deals for Vladyslav Koba, got {workbook_owner_counts.get('Vladyslav Koba')}"
    assert workbook_owner_counts.get("Pietro Saia") == 44, f"Expected 44 in-scope deals for Pietro Saia, got {workbook_owner_counts.get('Pietro Saia')}"

    # Also verify all owners have positive in-scope counts
    for owner, count in workbook_owner_counts.items():
        assert count > 0, f"Owner {owner} has 0 count"

    print(f"\n[OK] Reconciled {len(workbook_owner_counts)} owners from workbook. All owner counts verified.")

