import pytest
from datetime import datetime, timezone, date
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.main import app
from backend.database import Base, get_db
from backend.models.user import User
from backend.models.snapshot import UploadSnapshot
from backend.models.opportunity import Opportunity
from backend.config import settings
from backend.services.auth_service import ensure_default_accounts, hash_password


@pytest.fixture(scope="module")
def auth_test_db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()

    ensure_default_accounts(db)

    # Seed an active KAM user with password
    kam_user = User(
        name="Luay Arabi",
        email="luay.arabi@example.com",
        password_hash=hash_password("LuayPass123!"),
        role="kam",
        owner_name="Luay Arabi",
        is_owner=False,
        status="active",
        created_at=datetime.now(timezone.utc),
    )
    db.add(kam_user)

    # Seed snapshot
    snap = UploadSnapshot(
        snapshot_date=date(2026, 11, 13),
        label="Today",
        row_count=1,
        is_active_today=True,
        uploaded_at=datetime.now(timezone.utc),
    )
    db.add(snap)
    db.commit()
    db.refresh(kam_user)
    db.refresh(snap)

    opp = Opportunity(
        snapshot_id=snap.id,
        opportunity_id_18="006Qp00000LUAYAUTH1",
        opportunity_name="Luay Renewal Opportunity",
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
    db.add(opp)
    db.commit()

    def override_get_db():
        yield db

    app.dependency_overrides[get_db] = override_get_db
    yield {"db": db, "kam_user": kam_user}
    app.dependency_overrides.clear()


def get_clean_client():
    client = TestClient(app)
    client.headers.pop("Authorization", None)
    return client


def test_login_sets_httponly_cookie_and_no_token_in_body(auth_test_db):
    """
    Requirement:
    1. Login sets an HttpOnly cookie (auth_token).
    2. No token appears in the JSON login response body that the frontend stores.
    """
    client = get_clean_client()
    login_resp = client.post(
        "/api/auth/login",
        json={"email": "luay.arabi@example.com", "password": "LuayPass123!"},
    )
    assert login_resp.status_code == 200
    data = login_resp.json()

    # 1. No token in JSON response body
    assert "token" not in data, "Token must NOT be present in JSON response body"
    assert data["status"] == "success"
    assert data["user"]["email"] == "luay.arabi@example.com"
    assert data["user"]["role"] == "kam"

    # 2. Set-Cookie header contains HttpOnly auth_token
    set_cookie_headers = [h for h in login_resp.headers.raw if h[0].lower() == b"set-cookie"]
    assert len(set_cookie_headers) >= 1
    raw_cookies_str = " ; ".join([h[1].decode("latin1") for h in set_cookie_headers])
    assert "auth_token=" in raw_cookies_str
    assert "httponly" in raw_cookies_str.lower()
    assert "samesite=lax" in raw_cookies_str.lower()
    assert "path=/" in raw_cookies_str.lower()


def test_simulated_reload_with_cookie_succeeds(auth_test_db):
    """
    Requirement:
    A request with that cookie succeeds after a simulated reload.
    Simulate reload: completely new TestClient with no memory, initialized with the browser cookie.
    """
    # 1. Login to obtain cookie
    login_client = get_clean_client()
    login_resp = login_client.post(
        "/api/auth/login",
        json={"email": "luay.arabi@example.com", "password": "LuayPass123!"},
    )
    assert login_resp.status_code == 200
    auth_token_cookie = login_client.cookies.get("auth_token")
    assert auth_token_cookie is not None

    # 2. Simulated page reload: fresh client, no prior memory, only the HttpOnly cookie
    reload_client = get_clean_client()
    reload_client.cookies.set("auth_token", auth_token_cookie)

    # 3. Session restore call to /api/auth/me succeeds with 200
    me_resp = reload_client.get("/api/auth/me")
    assert me_resp.status_code == 200
    me_data = me_resp.json()
    assert me_data["user"]["email"] == "luay.arabi@example.com"
    assert me_data["user"]["role"] == "kam"

    # 4. Protected API query succeeds without any Bearer header
    overview_resp = reload_client.get("/api/kam/overview")
    assert overview_resp.status_code == 200


def test_missing_or_invalid_cookie_returns_401(auth_test_db):
    """
    Anonymous or expired session requests to /api/auth/me or protected endpoints return 401.
    """
    anon_client = get_clean_client()
    resp = anon_client.get("/api/auth/me")
    assert resp.status_code == 401

    invalid_client = get_clean_client()
    invalid_client.cookies.set("auth_token", "tampered_or_expired_jwt_value")
    resp_invalid = invalid_client.get("/api/auth/me")
    assert resp_invalid.status_code == 401


def test_logout_clears_cookie(auth_test_db):
    """
    Logout deletes auth cookies and revokes session.
    """
    client = get_clean_client()
    client.post(
        "/api/auth/login",
        json={"email": "luay.arabi@example.com", "password": "LuayPass123!"},
    )
    assert client.cookies.get("auth_token") is not None

    logout_resp = client.post("/api/auth/logout")
    assert logout_resp.status_code == 200

    # After logout, accessing protected route returns 401
    me_resp = client.get("/api/auth/me")
    assert me_resp.status_code == 401
