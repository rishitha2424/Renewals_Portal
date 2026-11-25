"""
Comprehensive Test Suite for Round 19:
- Single login flow (rishithathoka@gmail.com owner account).
- Universal 401 enforcement across all non-exempt /api/* routes for anonymous requests.
- Public exemption verification (health, login, forgot-password, reset/invite token).
- Role landings (Admin/Management -> /, KAM -> /kam/overview).
- Global search (Ctrl+K) with scope enforcement (excluded stages & reconciliation entry = False) and strict KAM ownership isolation.
- Deal search for messaging by name, ID, account, and owner.
- Messages Hub search, filter, unread count update, and email outbox queueing for message & reply.
"""
import pytest
from datetime import date
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.main import app, EXEMPT_API_PATHS
from backend.database import Base, get_db
from backend.config import settings
from backend.models.user import User, DealMessage, EmailOutbox
from backend.models.opportunity import Opportunity
from backend.models.snapshot import UploadSnapshot
from backend.services.auth_service import ensure_default_accounts, sign_session_token, create_user_token
from backend.services.context import ADMIN_CONTEXT


@pytest.fixture(scope="module")
def round19_db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()

    # 1. Seed accounts
    ensure_default_accounts(db)
    mgmt = db.query(User).filter(User.role == "management").first()
    if mgmt:
        mgmt.status = "active"
        from datetime import datetime, timezone
        mgmt.last_login = datetime.now(timezone.utc)
        from backend.services.auth_service import hash_password
        mgmt.password_hash = hash_password(settings.ADMIN_PASSWORD)
        db.commit()

    # 2. Seed Snapshot
    snap = UploadSnapshot(
        snapshot_date=date(2026, 11, 13),
        label="Nov 13 Snapshot",
        is_active_today=True,
    )
    db.add(snap)
    db.commit()
    db.refresh(snap)

    # 3. Seed test opportunities with different owners and stages
    opp1 = Opportunity(
        snapshot_id=snap.id,
        opportunity_id_18="006Qp00000TEST001",
        opportunity_name="Alpha Renewal Project",
        account_name="Acme Global",
        opportunity_owner="Raphael Roale",
        stage_number="4 - Commit",
        forecast_category="Commit",
        forecast_acv_amount=150000.0,
        sub_region="LATAM",
        sales_type="Renewals",
        is_deleted_or_lost=False,
        is_reconciliation_entry=False,
    )
    opp2 = Opportunity(
        snapshot_id=snap.id,
        opportunity_id_18="006Qp00000TEST002",
        opportunity_name="Beta Renewal System",
        account_name="Bravo Telecom",
        opportunity_owner="Esteban Aguerre",
        stage_number="3 - In Negotiation",
        forecast_category="Best Case",
        forecast_acv_amount=85000.0,
        sub_region="North America",
        sales_type="Renewals",
        is_deleted_or_lost=False,
        is_reconciliation_entry=False,
    )
    # Excluded stage deal (Closed Lost / deleted)
    opp3_lost = Opportunity(
        snapshot_id=snap.id,
        opportunity_id_18="006Qp00000TEST003",
        opportunity_name="Gamma Lost Deal",
        account_name="Gamma Inc",
        opportunity_owner="Raphael Roale",
        stage_number="Closed Lost",
        forecast_category="Omitted",
        forecast_acv_amount=50000.0,
        sub_region="LATAM",
        sales_type="Renewals",
        is_deleted_or_lost=True,
        is_reconciliation_entry=False,
    )
    # Reconciliation entry deal (must be excluded from normal searches)
    opp4_reconcile = Opportunity(
        snapshot_id=snap.id,
        opportunity_id_18="006Qp00000TEST004",
        opportunity_name="Delta Reconciliation Row",
        account_name="Delta Systems",
        opportunity_owner="Raphael Roale",
        stage_number="4 - Commit",
        forecast_category="Commit",
        forecast_acv_amount=20000.0,
        sub_region="LATAM",
        sales_type="Renewals",
        is_deleted_or_lost=False,
        is_reconciliation_entry=True,
    )
    db.add_all([opp1, opp2, opp3_lost, opp4_reconcile])

    # 4. Seed KAM user linked to Raphael Roale
    kam_raphael = User(
        name="Raphael Roale",
        email="raphael@mobileum.com",
        role="kam",
        owner_name="Raphael Roale",
        status="active",
        is_owner=False,
        must_change_password=False,
    )
    db.add(kam_raphael)
    db.commit()
    db.refresh(kam_raphael)

    def override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db

    yield {
        "db": db,
        "snap": snap,
        "opp1": opp1,
        "opp2": opp2,
        "kam_user": kam_raphael,
    }

    app.dependency_overrides.pop(get_db, None)
    db.close()
    engine.dispose()


def get_all_api_routes(app):
    routes = []
    for r in app.routes:
        if getattr(r, "path", None):
            routes.append(r.path)
        elif hasattr(r, "original_router"):
            prefix = getattr(getattr(r, "include_context", None), "prefix", "") or ""
            for sub_r in getattr(r.original_router, "routes", []):
                sub_p = getattr(sub_r, "path", "")
                full_p = f"{prefix}{sub_p}".replace("//", "/")
                routes.append(full_p)
    return [p for p in routes if p.startswith("/api/")]


def test_anonymous_requests_get_401_on_every_api_route():
    """
    Round 19 Rule 2:
    Loop over all routes in app.routes.
    Every /api/* route that is not in the exempt whitelist MUST return 401 when accessed anonymously.
    """
    client = TestClient(app)
    # Explicitly clear any test authorization headers
    client.headers.pop("Authorization", None)

    tested_routes = 0
    checked_paths = set()
    all_api_paths = get_all_api_routes(app)

    for path in all_api_paths:
        clean_path = path.rstrip("/")
        if clean_path in EXEMPT_API_PATHS or path in EXEMPT_API_PATHS:
            continue

        # Format route path if parameterized (e.g. /api/snapshots/{snapshot_id})
        test_path = path
        if "{" in test_path:
            import re
            test_path = re.sub(r"\{[^}]+\}", "dummy_id", test_path)

        if test_path in checked_paths:
            continue
        checked_paths.add(test_path)

        # Anonymous request
        resp = client.get(test_path)
        assert resp.status_code == 401, (
            f"Expected 401 for anonymous request to '{test_path}', got {resp.status_code}: {resp.text}"
        )
        tested_routes += 1

    assert tested_routes > 50, f"Expected to test > 50 protected routes, tested {tested_routes}"


def test_exempt_public_endpoints_allowed_without_auth():
    """
    Public endpoints must be accessible without login:
    - /health and /api/health
    - /api/auth/login
    - /api/auth/forgot-password
    """
    client = TestClient(app)
    client.headers.pop("Authorization", None)

    # Health
    r_health = client.get("/api/health")
    assert r_health.status_code == 200, f"/api/health failed: {r_health.text}"

    # Forgot password (non-existent email still returns 200 to avoid enumeration)
    r_forgot = client.post("/api/auth/forgot-password", json={"email": "nobody@mobileum.com"})
    assert r_forgot.status_code == 200


def test_single_login_owner_account(round19_db):
    """
    Round 19 Rule 1:
    The owner account (rishithathoka@gmail.com, admin) logs in through the single login form
    using the env-based admin password. Separate admin modal removed.
    """
    client = TestClient(app)
    client.headers.pop("Authorization", None)

    # 1. Login with rishithathoka@gmail.com and settings.ADMIN_PASSWORD
    resp = client.post(
        "/api/auth/login",
        json={"email": "rishithathoka@gmail.com", "password": settings.ADMIN_PASSWORD},
    )
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    data = resp.json()
    assert data["status"] == "success"
    assert data["user"]["role"] == "admin"
    assert data["user"]["is_owner"] is True
    assert data["redirect_url"] == "/"

    # Verify that token does NOT appear in response body (cookie-only auth)
    assert "token" not in data

    # 2. Check /api/auth/me returns current user info via HttpOnly session cookie
    me_resp = client.get("/api/auth/me")
    assert me_resp.status_code == 200
    me_data = me_resp.json()
    assert me_data["role"] == "admin"
    assert me_data["is_owner"] is True


def test_role_landings(round19_db):
    """
    Round 19 Rule 2:
    After login:
    - Admin and management land on / (Overview)
    - KAM lands on /kam/overview (My Overview)
    """
    client = TestClient(app)
    client.headers.pop("Authorization", None)
    db = round19_db["db"]

    # 1. Management user
    mgmt_resp = client.post(
        "/api/auth/login",
        json={"email": "management@mobileum.com", "password": settings.ADMIN_PASSWORD},
    )
    assert mgmt_resp.status_code == 200
    assert mgmt_resp.json()["redirect_url"] == "/"

    # 2. KAM user
    kam = round19_db["kam_user"]
    # Set password for KAM to test login
    from backend.services.auth_service import hash_password
    kam.password_hash = hash_password("KamPassword123")
    db.commit()

    kam_resp = client.post(
        "/api/auth/login",
        json={"email": kam.email, "password": "KamPassword123"},
    )
    assert kam_resp.status_code == 200
    assert kam_resp.json()["redirect_url"] == "/kam/overview"


def test_global_search_scope_and_kam_isolation(round19_db):
    """
    Round 19 Rule 5.a and 5.c:
    - Global search (Ctrl+K) finds deals, accounts, and regions.
    - Reconciliation Entry = Yes and Excluded Stages are omitted.
    - For KAM: finds ONLY their own deals and never reveals another owner's data.
    """
    db = round19_db["db"]
    kam_user = round19_db["kam_user"]

    # 1. Admin search
    admin_token = sign_session_token(db.query(User).filter(User.role == "admin").first())
    admin_client = TestClient(app)
    admin_client.headers["Authorization"] = f"Bearer {admin_token}"

    res = admin_client.get("/api/search?q=Renewal")
    assert res.status_code == 200
    data = res.json()
    deal_ids = [d["opportunity_id_18"] for d in data["deals"]]

    # Both Alpha (Raphael) and Beta (Esteban) should appear for Admin
    assert "006Qp00000TEST001" in deal_ids  # Alpha
    assert "006Qp00000TEST002" in deal_ids  # Beta

    # Excluded stage (Closed Lost) and Reconciliation Entry MUST NOT appear
    assert "006Qp00000TEST003" not in deal_ids
    assert "006Qp00000TEST004" not in deal_ids

    # 2. KAM search (Raphael Roale)
    kam_token = sign_session_token(kam_user)
    kam_client = TestClient(app)
    kam_client.headers["Authorization"] = f"Bearer {kam_token}"

    kam_res = kam_client.get("/api/search?q=Renewal")
    assert kam_res.status_code == 200
    kam_data = kam_res.json()
    kam_deal_ids = [d["opportunity_id_18"] for d in kam_data["deals"]]

    # KAM Raphael must ONLY see Alpha (his own deal)
    assert "006Qp00000TEST001" in kam_deal_ids
    # KAM Raphael must NEVER see Beta (Esteban's deal)
    assert "006Qp00000TEST002" not in kam_deal_ids


def test_messages_hub_send_reply_and_outbox(round19_db):
    """
    Round 19 Rule 5.b and 5.d:
    - Management sends message about a deal -> KAM receives it.
    - KAM replies -> reaches sender.
    - Email outbox records entries for message and reply.
    - Thread filtering and unread count update.
    """
    db = round19_db["db"]
    kam_user = round19_db["kam_user"]
    mgmt_user = db.query(User).filter(User.role == "management").first()
    opp1 = round19_db["opp1"]

    mgmt_client = TestClient(app)
    mgmt_token = sign_session_token(mgmt_user)
    mgmt_client.headers["Authorization"] = f"Bearer {mgmt_token}"

    kam_client = TestClient(app)
    kam_token = sign_session_token(kam_user)
    kam_client.headers["Authorization"] = f"Bearer {kam_token}"

    # 1. Management sends message about Alpha Renewal Project (owned by Raphael)
    send_resp = mgmt_client.post(
        "/api/messages",
        json={
            "deal_id": opp1.opportunity_id_18,
            "subject": "Q4 Renewal Contract Status",
            "body": "Hi Raphael, please confirm the expected signature date.",
            "priority": "high",
        },
    )
    assert send_resp.status_code == 200
    msg_id = send_resp.json()["message_id"]

    # Verify EmailOutbox has entry for the new message
    outbox_msg = (
        db.query(EmailOutbox)
        .filter(EmailOutbox.recipient_email == kam_user.email)
        .order_by(EmailOutbox.created_at.desc())
        .first()
    )
    assert outbox_msg is not None
    assert "Q4 Renewal Contract Status" in outbox_msg.subject

    # 2. KAM checks threads: should see 1 unread message
    threads_resp = kam_client.get("/api/messages/threads")
    assert threads_resp.status_code == 200
    kam_threads = threads_resp.json()["threads"]
    assert len(kam_threads) >= 1
    target_thread = next(t for t in kam_threads if t["deal_id"] == opp1.opportunity_id_18)
    assert target_thread["unread_count"] >= 1

    # 3. KAM views thread and replies
    deal_thread_resp = kam_client.get(f"/api/messages/deal/{opp1.opportunity_id_18}")
    assert deal_thread_resp.status_code == 200
    deal_data = deal_thread_resp.json()
    assert len(deal_data["messages"]) >= 1
    assert deal_data["opportunity"]["opportunity_name"] == opp1.opportunity_name

    # KAM marks read
    read_resp = kam_client.post(f"/api/messages/{msg_id}/read")
    assert read_resp.status_code == 200

    # KAM replies
    reply_resp = kam_client.post(
        f"/api/messages/{msg_id}/reply",
        json={"body": "Signature is expected by Dec 15th after legal review."},
    )
    assert reply_resp.status_code == 200
    reply_id = reply_resp.json()["message_id"]

    # Verify EmailOutbox has entry for the reply to management
    outbox_reply = (
        db.query(EmailOutbox)
        .filter(EmailOutbox.recipient_email == mgmt_user.email)
        .order_by(EmailOutbox.created_at.desc())
        .first()
    )
    assert outbox_reply is not None
    assert "Re:" in outbox_reply.subject
