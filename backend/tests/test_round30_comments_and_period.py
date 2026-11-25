import pytest
from datetime import datetime, timezone, date
import json
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.main import app
from backend.database import Base, get_db
from backend.models.user import User, EmailOutbox
from backend.models.opportunity import Opportunity
from backend.models.custom_column import DealComment
from backend.models.snapshot import UploadSnapshot
from backend.services.auth_service import ensure_default_accounts, sign_session_token, hash_password
from backend.services.settings_service import SettingsService


@pytest.fixture(scope="module")
def round30_setup():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()

    # 1. Accounts
    ensure_default_accounts(db)

    admin_user = db.query(User).filter(User.role == "admin").first()
    admin_token = sign_session_token(admin_user)

    mgmt_user = db.query(User).filter(User.role == "management").first()
    mgmt_user.status = "active"
    mgmt_user.password_hash = hash_password("MgmtPass123!")
    db.commit()
    db.refresh(mgmt_user)
    mgmt_token = sign_session_token(mgmt_user)

    kam_luay = User(
        name="Luay Arabi",
        email="luay.arabi@example.com",
        password_hash=hash_password("KamPass123!"),
        role="kam",
        owner_name="Luay Arabi",
        is_owner=False,
        status="active",
        created_at=datetime.now(timezone.utc),
    )
    kam_other = User(
        name="Raphael Nogueira",
        email="raphael.n@example.com",
        password_hash=hash_password("KamPass123!"),
        role="kam",
        owner_name="Raphael Nogueira",
        is_owner=False,
        status="active",
        created_at=datetime.now(timezone.utc),
    )
    db.add_all([kam_luay, kam_other])
    db.commit()
    db.refresh(kam_luay)
    db.refresh(kam_other)

    luay_token = sign_session_token(kam_luay)
    other_token = sign_session_token(kam_other)

    # 2. Snapshot
    snap = UploadSnapshot(
        snapshot_date=date(2026, 11, 13),
        label="Today",
        row_count=4,
        is_active_today=True,
        uploaded_at=datetime.now(timezone.utc),
    )
    db.add(snap)
    db.commit()
    db.refresh(snap)

    # 3. Opportunities: 2 for Luay (one in Q4-2026, one in Q1-2027), 1 for Raphael (Q4-2026)
    opp_luay_q4 = Opportunity(
        snapshot_id=snap.id,
        opportunity_id_18="006Qp00000TESTLUAY1",
        opportunity_name="Luay Renewal Q4 Deal",
        account_name="Saudi Telecom",
        opportunity_owner="Luay Arabi",
        close_date=date(2026, 11, 30),
        fiscal_period="Q4-2026",
        forecast_acv_amount=150000.0,
        forecast_category="Commit",
        approval_status="Approved",
        stage_number="4. Develop Solution",
        sales_type="Renewals",
    )
    opp_luay_q1 = Opportunity(
        snapshot_id=snap.id,
        opportunity_id_18="006Qp00000TESTLUAY2",
        opportunity_name="Luay Renewal Q1 Deal",
        account_name="Etisalat",
        opportunity_owner="Luay Arabi",
        close_date=date(2027, 2, 15),
        fiscal_period="Q1-2027",
        forecast_acv_amount=200000.0,
        forecast_category="Best Case",
        approval_status="Pending Approval",
        stage_number="4. Develop Solution",
        sales_type="Renewals",
    )
    opp_other = Opportunity(
        snapshot_id=snap.id,
        opportunity_id_18="006Qp00000TESTRAPH1",
        opportunity_name="Raphael Renewal Deal",
        account_name="Claro Brasil",
        opportunity_owner="Raphael Nogueira",
        close_date=date(2026, 12, 10),
        fiscal_period="Q4-2026",
        forecast_acv_amount=300000.0,
        forecast_category="Commit",
        approval_status="Approved",
        stage_number="4. Develop Solution",
        sales_type="Renewals",
    )
    db.add_all([opp_luay_q4, opp_luay_q1, opp_other])
    db.commit()

    # 4. Comments:
    # - Luay wrote a shared comment on his Q4 deal
    c1 = DealComment(
        opportunity_id_18="006Qp00000TESTLUAY1",
        author="Luay Arabi",
        author_id=kam_luay.id,
        author_role="kam",
        text="Customer agreed to renewal terms, PO coming next week.",
        visibility="shared_with_owner",
        recipient_ids=json.dumps([admin_user.id]),
        created_at=datetime(2026, 11, 14, 10, 0, tzinfo=timezone.utc),
    )
    # - Admin wrote an internal comment on Luay's Q4 deal
    c2 = DealComment(
        opportunity_id_18="006Qp00000TESTLUAY1",
        author="Rishitha Admin",
        author_id=admin_user.id,
        author_role="admin",
        text="Internal note: Margin target needs review with finance.",
        visibility="internal",
        recipient_ids=json.dumps([mgmt_user.id]),
        created_at=datetime(2026, 11, 14, 11, 0, tzinfo=timezone.utc),
    )
    # - Management wrote a shared comment on Raphael's deal
    c3 = DealComment(
        opportunity_id_18="006Qp00000TESTRAPH1",
        author="Management Lead",
        author_id=mgmt_user.id,
        author_role="management",
        text="Please confirm contract duration before submission.",
        visibility="shared_with_owner",
        recipient_ids=json.dumps([kam_other.id]),
        created_at=datetime(2026, 11, 15, 12, 0, tzinfo=timezone.utc),
    )
    db.add_all([c1, c2, c3])
    db.commit()

    # 5. Outbox email status for c1
    outbox1 = EmailOutbox(
        deal_id="006Qp00000TESTLUAY1",
        recipient_email=admin_user.email,
        recipient_name=admin_user.name,
        subject="New Comment on 006Qp00000TESTLUAY1",
        body_html="<p>Customer agreed</p>",
        template_type="comment",
        status="sent",
        created_at=datetime(2026, 11, 14, 10, 1, tzinfo=timezone.utc),
    )
    db.add(outbox1)
    db.commit()

    def override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)

    yield {
        "db": db,
        "client": client,
        "admin_user": admin_user,
        "mgmt_user": mgmt_user,
        "kam_luay": kam_luay,
        "kam_other": kam_other,
        "admin_token": admin_token,
        "mgmt_token": mgmt_token,
        "luay_token": luay_token,
        "other_token": other_token,
        "snap": snap,
    }

    app.dependency_overrides.clear()
    db.close()


def test_kam_default_period_setting(round30_setup):
    db = round30_setup["db"]
    # Verify default is current_quarter
    val = SettingsService.get_kam_default_period(db)
    assert val == "current_quarter"


def test_kam_overview_default_period_resolution(round30_setup):
    client = round30_setup["client"]
    token = round30_setup["luay_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Request KAM overview with no period parameter -> should default to current_quarter
    resp = client.get("/api/kam/overview", headers=headers)
    assert resp.status_code == 200
    data = resp.json()

    assert "Current quarter" in data["period"]
    assert data["period_info"]["selected_period"] == "current_quarter"
    assert "Current quarter" in data["period_info"]["period_label"]
    # Luay has 1 deal in Q4-2026 ($150,000) and 1 deal in Q1-2027 ($200,000)
    pinfo = data["period_info"]
    assert pinfo["showing_count"] == 1
    assert pinfo["showing_acv"] == 150000.0
    assert pinfo["other_periods_count"] == 1
    assert pinfo["other_periods_acv"] == 200000.0


def test_comments_log_kam_role_enforcement(round30_setup):
    client = round30_setup["client"]
    luay_token = round30_setup["luay_token"]
    headers = {"Authorization": f"Bearer {luay_token}"}

    # Luay requests comments log
    resp = client.get("/api/comments/log", headers=headers)
    assert resp.status_code == 200
    data = resp.json()

    # Luay should see ONLY his own comment (c1)
    assert data["total"] == 1
    item = data["items"][0]
    assert item["author"] == "Luay Arabi"
    assert item["deal_id"] == "006Qp00000TESTLUAY1"
    assert item["text"] == "Customer agreed to renewal terms, PO coming next week."
    # Admin recipient must be masked to "Admin" without email
    assert "Admin" in item["recipients"]
    for r in item["recipients"]:
        assert "@" not in r
    assert item["email_status"] == "emailed"


def test_comments_log_kam_never_sees_internal_comments(round30_setup):
    client = round30_setup["client"]
    luay_token = round30_setup["luay_token"]
    headers = {"Authorization": f"Bearer {luay_token}"}

    # Attempt to request internal comments or tab=all
    resp = client.get("/api/comments/log?tab=all&visibility=internal", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    # Still 0 because KAM can never see internal comments, and tab=all is ignored for KAM
    assert data["total"] == 0


def test_comments_log_management_role(round30_setup):
    client = round30_setup["client"]
    mgmt_token = round30_setup["mgmt_token"]
    headers = {"Authorization": f"Bearer {mgmt_token}"}

    resp = client.get("/api/comments/log", headers=headers)
    assert resp.status_code == 200
    data = resp.json()

    # Management sees their own written comment (c3)
    assert data["total"] == 1
    item = data["items"][0]
    assert item["author"] == "Management Lead"
    assert item["deal_id"] == "006Qp00000TESTRAPH1"


def test_comments_log_admin_tabs_and_filters(round30_setup):
    client = round30_setup["client"]
    admin_token = round30_setup["admin_token"]
    headers = {"Authorization": f"Bearer {admin_token}"}

    # Tab "my": sees only admin's comment (c2)
    resp_my = client.get("/api/comments/log?tab=my", headers=headers)
    assert resp_my.status_code == 200
    data_my = resp_my.json()
    assert data_my["total"] == 1
    assert data_my["items"][0]["author"] == "Rishitha Admin"

    # Tab "all": sees all 3 comments
    resp_all = client.get("/api/comments/log?tab=all", headers=headers)
    assert resp_all.status_code == 200
    data_all = resp_all.json()
    assert data_all["total"] == 3

    # Filter by visibility=internal under tab=all
    resp_internal = client.get("/api/comments/log?tab=all&visibility=internal", headers=headers)
    assert resp_internal.status_code == 200
    data_internal = resp_internal.json()
    assert data_internal["total"] == 1
    assert data_internal["items"][0]["visibility"] == "internal"

    # Filter by author under tab=all
    resp_author = client.get("/api/comments/log?tab=all&author=Luay", headers=headers)
    assert resp_author.status_code == 200
    assert resp_author.json()["total"] == 1

