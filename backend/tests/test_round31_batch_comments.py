import pytest
from datetime import datetime, timezone, date
import uuid
import json
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.main import app
from backend.database import Base, get_db
from backend.models.user import User, EmailOutbox
from backend.models.opportunity import Opportunity
from backend.models.custom_column import DealComment, AnnotationAudit
from backend.models.snapshot import UploadSnapshot
from backend.services.auth_service import ensure_default_accounts, sign_session_token, hash_password
from backend.services.settings_service import SettingsService


@pytest.fixture(scope="module")
def round31_setup():
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
    kam_raphael = User(
        name="Raphael Nogueira",
        email="raphael.n@example.com",
        password_hash=hash_password("KamPass123!"),
        role="kam",
        owner_name="Raphael Nogueira",
        is_owner=False,
        status="active",
        created_at=datetime.now(timezone.utc),
    )
    db.add_all([kam_luay, kam_raphael])
    db.commit()
    db.refresh(kam_luay)
    db.refresh(kam_raphael)

    luay_token = sign_session_token(kam_luay)
    raphael_token = sign_session_token(kam_raphael)

    # 2. Snapshot & Deals
    snap = UploadSnapshot(
        snapshot_date=date(2026, 11, 13),
        label="Today",
        row_count=5,
        is_active_today=True,
        uploaded_at=datetime.now(timezone.utc),
    )
    db.add(snap)
    db.commit()
    db.refresh(snap)

    deal_l1 = Opportunity(
        snapshot_id=snap.id,
        opportunity_id_18="006Qp00000LUAY0001",
        opportunity_name="Luay STC Renewal",
        account_name="Saudi Telecom",
        opportunity_owner="Luay Arabi",
        close_date=date(2026, 11, 30),
        fiscal_period="Q4-2026",
        forecast_acv_amount=500000.0,
        forecast_category="Commit",
        approval_status="Approved",
        stage_number="4. Develop Solution",
        sales_type="Renewals",
    )
    deal_l2 = Opportunity(
        snapshot_id=snap.id,
        opportunity_id_18="006Qp00000LUAY0002",
        opportunity_name="Luay Etisalat Renewal",
        account_name="Etisalat UAE",
        opportunity_owner="Luay Arabi",
        close_date=date(2026, 12, 15),
        fiscal_period="Q4-2026",
        forecast_acv_amount=350000.0,
        forecast_category="Best Case",
        approval_status="Pending Approval",
        stage_number="4. Develop Solution",
        sales_type="Renewals",
    )
    deal_r1 = Opportunity(
        snapshot_id=snap.id,
        opportunity_id_18="006Qp00000RAPH0001",
        opportunity_name="Raphael Claro Renewal",
        account_name="Claro Brasil",
        opportunity_owner="Raphael Nogueira",
        close_date=date(2026, 12, 20),
        fiscal_period="Q4-2026",
        forecast_acv_amount=400000.0,
        forecast_category="Commit",
        approval_status="Approved",
        stage_number="4. Develop Solution",
        sales_type="Renewals",
    )
    deal_r2 = Opportunity(
        snapshot_id=snap.id,
        opportunity_id_18="006Qp00000RAPH0002",
        opportunity_name="Raphael Vivo Renewal",
        account_name="Vivo Brasil",
        opportunity_owner="Raphael Nogueira",
        close_date=date(2026, 12, 22),
        fiscal_period="Q4-2026",
        forecast_acv_amount=250000.0,
        forecast_category="Commit",
        approval_status="Approved",
        stage_number="4. Develop Solution",
        sales_type="Renewals",
    )
    db.add_all([deal_l1, deal_l2, deal_r1, deal_r2])
    db.commit()

    def override_get_db():
        yield db

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)

    yield {
        "client": client,
        "db": db,
        "admin_token": admin_token,
        "mgmt_token": mgmt_token,
        "luay_token": luay_token,
        "raphael_token": raphael_token,
        "kam_luay": kam_luay,
        "kam_raphael": kam_raphael,
        "admin_user": admin_user,
    }

    app.dependency_overrides.clear()


def test_batch_comment_validation_empty_or_too_large(round31_setup):
    client = round31_setup["client"]
    admin_token = round31_setup["admin_token"]
    headers = {"Authorization": f"Bearer {admin_token}"}

    # Empty deal IDs
    resp = client.post("/api/comments/batch", json={"deal_ids": [], "text": "Test"}, headers=headers)
    assert resp.status_code == 400
    assert "At least one" in resp.json()["detail"]

    # Empty text
    resp = client.post(
        "/api/comments/batch",
        json={"deal_ids": ["006Qp00000LUAY0001"], "text": "   "},
        headers=headers,
    )
    assert resp.status_code == 400
    assert "Comment text cannot be empty" in resp.json()["detail"]

    # Exceeding batch size limit (default 50)
    fake_ids = [f"006QpFakeID_{i:04d}" for i in range(51)]
    resp = client.post(
        "/api/comments/batch",
        json={"deal_ids": fake_ids, "text": "Mass update"},
        headers=headers,
    )
    assert resp.status_code == 400
    assert "exceeds maximum limit" in resp.json()["detail"]


def test_batch_comment_kam_cannot_comment_on_other_owners_deals(round31_setup):
    client = round31_setup["client"]
    luay_token = round31_setup["luay_token"]
    headers = {"Authorization": f"Bearer {luay_token}"}

    # Luay attempts to batch comment on his own deal + Raphael's deal
    resp = client.post(
        "/api/comments/batch",
        json={
            "deal_ids": ["006Qp00000LUAY0001", "006Qp00000RAPH0001"],
            "text": "Unauthorized cross-portfolio comment",
        },
        headers=headers,
    )
    assert resp.status_code == 403
    assert "KAMs can only comment on their own opportunities" in resp.json()["detail"]


def test_batch_comment_kam_own_deals_success(round31_setup):
    client = round31_setup["client"]
    db = round31_setup["db"]
    luay_token = round31_setup["luay_token"]
    headers = {"Authorization": f"Bearer {luay_token}"}

    # Luay comments on his 2 deals
    resp = client.post(
        "/api/comments/batch",
        json={
            "deal_ids": ["006Qp00000LUAY0001", "006Qp00000LUAY0002"],
            "text": "Confirmed renewal discussion with telecom clients.",
            "visibility": "internal",  # Server must enforce shared_with_owner for KAM
        },
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["comments_created"] == 2
    batch_id = data["batch_id"]
    assert batch_id is not None

    # Verify DealComment records in DB
    comments = db.query(DealComment).filter(DealComment.batch_id == batch_id).all()
    assert len(comments) == 2
    for c in comments:
        assert c.author == "Luay Arabi"
        assert c.author_role == "kam"
        assert c.visibility == "shared_with_owner"  # Enforced for KAM
        assert c.batch_id == batch_id
        d_dict = c.to_dict()
        assert d_dict["batch_id"] == batch_id


def test_batch_comment_admin_multi_deal_grouped_notifications(round31_setup):
    client = round31_setup["client"]
    db = round31_setup["db"]
    admin_token = round31_setup["admin_token"]
    headers = {"Authorization": f"Bearer {admin_token}"}

    # Admin comments on 1 Luay deal and 2 Raphael deals with shared_with_owner
    deal_ids = ["006Qp00000LUAY0001", "006Qp00000RAPH0001", "006Qp00000RAPH0002"]
    resp = client.post(
        "/api/comments/batch",
        json={
            "deal_ids": deal_ids,
            "text": "Management review completed: Please ensure contract signed before end of quarter.",
            "visibility": "shared_with_owner",
        },
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["comments_created"] == 3
    batch_id = data["batch_id"]

    # Verify comments and audits
    comments = db.query(DealComment).filter(DealComment.batch_id == batch_id).all()
    assert len(comments) == 3
    for c in comments:
        assert c.visibility == "shared_with_owner"
        assert c.batch_id == batch_id

    audits = db.query(AnnotationAudit).filter(AnnotationAudit.opportunity_id_18.in_(deal_ids)).all()
    batch_audits = [a for a in audits if a.extra_info and a.extra_info.get("batch_id") == batch_id]
    assert len(batch_audits) == 3

    # Verify grouped emails in outbox
    # Luay should receive 1 email listing only his 1 deal
    # Raphael should receive 1 email listing his 2 deals
    luay_emails = db.query(EmailOutbox).filter(
        EmailOutbox.recipient_email == "luay.arabi@example.com",
        EmailOutbox.body_text.like(f"%{batch_id}%") | EmailOutbox.body_text.like("%Management review completed%"),
    ).all()
    assert len(luay_emails) >= 1
    # Check that Luay's email only references his deal, not Raphael's
    assert "Luay STC Renewal" in luay_emails[-1].body_text
    assert "Raphael Claro" not in luay_emails[-1].body_text

    raphael_emails = db.query(EmailOutbox).filter(
        EmailOutbox.recipient_email == "raphael.n@example.com",
        EmailOutbox.body_text.like(f"%{batch_id}%") | EmailOutbox.body_text.like("%Management review completed%"),
    ).all()
    assert len(raphael_emails) >= 1
    # Check that Raphael's email lists his 2 deals
    assert "Raphael Claro Renewal" in raphael_emails[-1].body_text
    assert "Raphael Vivo Renewal" in raphael_emails[-1].body_text
    assert "Luay STC Renewal" not in raphael_emails[-1].body_text
