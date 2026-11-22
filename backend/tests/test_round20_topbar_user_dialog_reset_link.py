"""
Round 20 Test Suite:
1. Top bar in one line and display size
2. User Edit Dialog validation & protections
3. Reset Link Generation & single-use lifecycle for all user roles (including management & invited)
4. Shared management account security checks
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from backend.main import app
from backend.database import Base, get_db
from backend.models import User, UserToken, AuditLog
from backend.services.auth_service import hash_password, verify_password, create_user_token, sign_session_token, ensure_default_accounts


@pytest.fixture(scope="module")
def round20_db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()

    accounts = ensure_default_accounts(db)
    admin = accounts["admin"]

    def override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db

    admin_token = sign_session_token(admin)
    client = TestClient(app)
    client.headers["Authorization"] = f"Bearer {admin_token}"

    yield {
        "db": db,
        "admin": admin,
        "admin_token": admin_token,
        "client": client,
    }

    app.dependency_overrides.pop(get_db, None)
    db.close()
    engine.dispose()


def test_shared_management_account_initial_state(round20_db):
    """Confirm management@mobileum.com starts in status invited with no password."""
    db = round20_db["db"]
    client = round20_db["client"]

    mgmt = db.query(User).filter(User.email == "management@mobileum.com").first()
    assert mgmt is not None
    assert mgmt.status == "invited"
    assert mgmt.password_hash is None or mgmt.password_hash == ""

    # Login without password should fail
    anon_client = TestClient(app)
    res = anon_client.post("/api/auth/login", json={"email": "management@mobileum.com", "password": "anypassword"})
    assert res.status_code == 401


def test_reset_link_generation_for_management_and_kam(round20_db):
    """Admin can generate reset link for management and kam users without crash."""
    db = round20_db["db"]
    client = round20_db["client"]

    # 1. Management user
    mgmt = db.query(User).filter(User.email == "management@mobileum.com").first()
    assert mgmt is not None

    res = client.post(f"/api/admin/users/{mgmt.id}/reset-link")
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["status"] == "success"
    assert "reset-password/" in data["reset_url"]
    assert data["token"]
    assert data["expires_in_hours"] == 24

    # 2. KAM user
    kam = User(name="Test KAM", email="test_kam_r20@mobileum.com", role="kam", status="invited", owner_name="Test KAM")
    db.add(kam)
    db.commit()
    db.refresh(kam)

    res_kam = client.post(f"/api/admin/users/{kam.id}/reset-link")
    assert res_kam.status_code == 200
    kam_data = res_kam.json()
    assert kam_data["status"] == "success"
    assert "reset-password/" in kam_data["reset_url"]


def test_full_reset_password_activation_and_reuse_prevention(round20_db):
    """
    Full lifecycle:
    1. Admin generates reset link
    2. Verify token
    3. User sets password
    4. User logs in with new password
    5. Token cannot be reused (single-use)
    """
    db = round20_db["db"]
    client = round20_db["client"]

    test_user = User(
        name="Activation Test User",
        email="activate_me@mobileum.com",
        role="management",
        status="invited",
        password_hash=None,
    )
    db.add(test_user)
    db.commit()
    db.refresh(test_user)

    # Generate link
    res = client.post(f"/api/admin/users/{test_user.id}/reset-link")
    assert res.status_code == 200
    raw_token = res.json()["token"]

    # Verify link
    anon_client = TestClient(app)
    res_verify = anon_client.get(f"/api/auth/invite/verify?token={raw_token}")
    assert res_verify.status_code == 200
    assert res_verify.json()["valid"] is True
    assert res_verify.json()["email"] == "activate_me@mobileum.com"

    # Set password with mismatch
    res_bad = anon_client.post(
        "/api/auth/reset-password",
        json={"token": raw_token, "password": "StrongPassword123!", "confirm_password": "DifferentPassword123!"},
    )
    assert res_bad.status_code == 400

    # Set password successfully
    res_set = anon_client.post(
        "/api/auth/reset-password",
        json={"token": raw_token, "password": "StrongPassword123!", "confirm_password": "StrongPassword123!"},
    )
    assert res_set.status_code == 200
    assert res_set.json()["status"] == "success"

    # Verify user is now active with password set
    db.refresh(test_user)
    assert test_user.status == "active"
    assert test_user.password_hash is not None
    assert verify_password("StrongPassword123!", test_user.password_hash)

    # Login with new password
    res_login = anon_client.post(
        "/api/auth/login",
        json={"email": "activate_me@mobileum.com", "password": "StrongPassword123!"},
    )
    assert res_login.status_code == 200
    assert res_login.json()["user"]["email"] == "activate_me@mobileum.com"

    # Token cannot be reused
    res_reuse = anon_client.get(f"/api/auth/invite/verify?token={raw_token}")
    assert res_reuse.status_code == 400

    res_set_again = anon_client.post(
        "/api/auth/reset-password",
        json={"token": raw_token, "password": "AnotherPassword123!", "confirm_password": "AnotherPassword123!"},
    )
    assert res_set_again.status_code == 400


def test_user_update_validation_and_audit(round20_db):
    """Test user update endpoints: email validation, duplicate checks, owner protections, audit logging."""
    db = round20_db["db"]
    client = round20_db["client"]

    u1 = User(name="User One", email="user1_r20@mobileum.com", role="management", status="active")
    u2 = User(name="User Two", email="user2_r20@mobileum.com", role="kam", status="active", owner_name="User Two")
    db.add_all([u1, u2])
    db.commit()
    db.refresh(u1)
    db.refresh(u2)

    # 1. Invalid email format
    res_inv = client.put(f"/api/admin/users/{u1.id}", json={"email": "invalid-email"})
    assert res_inv.status_code == 400
    assert "Invalid email format" in res_inv.text

    # 2. Duplicate email
    res_dup = client.put(f"/api/admin/users/{u1.id}", json={"email": "user2_r20@mobileum.com"})
    assert res_dup.status_code == 400
    assert "already in use" in res_dup.text

    # 3. Successful update of name, email, status, and KAM aliases
    res_ok = client.put(
        f"/api/admin/users/{u2.id}",
        json={
            "name": "User Two Updated",
            "email": "user2_updated@mobileum.com",
            "status": "disabled",
            "owner_name": "User Two Main",
            "aliases": ["Alias 1", "Alias 2"],
        },
    )
    assert res_ok.status_code == 200
    data = res_ok.json()
    assert data["name"] == "User Two Updated"
    assert data["email"] == "user2_updated@mobileum.com"
    assert data["status"] == "disabled"
    assert data["owner_name"] == "User Two Main"
    assert "Alias 1" in data["aliases"]
    assert "Alias 2" in data["aliases"]

    # 4. Check audit log has recorded the changes
    audit_rec = (
        db.query(AuditLog)
        .filter(AuditLog.user_id == u2.id, AuditLog.event_type == "user_updated")
        .order_by(AuditLog.created_at.desc())
        .first()
    )
    assert audit_rec is not None
    assert "name" in audit_rec.details
    assert "email" in audit_rec.details
    assert "status" in audit_rec.details
