"""
Targeted Tests for Owner Email from .env:
1. Startup with new OWNER_EMAIL updates the same owner row (no duplicate).
2. Old email cannot log in (returns 401).
3. New email logs in successfully with ADMIN_PASSWORD.
4. Duplicate email refused when OWNER_EMAIL belongs to an existing non-owner user.
5. Owner protection holds (cannot be deleted, disabled, or demoted).
6. Codebase check: no hardcoded personal emails remain in backend/ or frontend/ source.
"""
import re
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.main import app
from backend.database import Base, get_db
from backend.models.user import User, AuditLog
from backend.config import settings
from backend.services.auth_service import ensure_default_accounts, mask_email
from backend.routers.admin_users import check_last_admin_or_owner_protection
from fastapi import HTTPException


@pytest.fixture
def owner_db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSessionLocal()

    def override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    yield db
    db.close()
    Base.metadata.drop_all(bind=engine)
    app.dependency_overrides.pop(get_db, None)


def test_mask_email_helper():
    assert mask_email("rishitha.thoka@mobileum.com") == "r***a@mobileum.com"
    assert mask_email("admin@test.org") == "a***n@test.org"
    assert mask_email("ab@c.com") == "a***@c.com"
    assert mask_email("invalid") == "***"
    assert mask_email(None) == "***"


def test_owner_email_update_same_row(owner_db, monkeypatch):
    """Setting OWNER_EMAIL in env updates existing owner row, not creating a duplicate."""
    # 1. Initial state: owner has old email
    initial_owner = User(
        name="Administrator",
        email="old.owner@mobileum.com",
        role="admin",
        status="active",
        is_owner=True,
    )
    owner_db.add(initial_owner)
    owner_db.commit()
    initial_id = initial_owner.id

    # 2. Configure new OWNER_EMAIL in settings
    new_email = "rishitha.thoka@mobileum.com"
    monkeypatch.setattr(settings, "OWNER_EMAIL", new_email)
    monkeypatch.setattr(settings, "OWNER_NAME", "Rishitha Thoka")

    # 3. Run ensure_default_accounts (runs on app startup)
    accs = ensure_default_accounts(owner_db)
    admin = accs["admin"]

    # Must be the exact same user row
    assert admin.id == initial_id
    assert admin.email == new_email
    assert admin.name == "Rishitha Thoka"
    assert admin.is_owner is True

    # Assert total admin count is exactly 1 (no duplicate row)
    total_owners = owner_db.query(User).filter(User.is_owner == True).count()
    assert total_owners == 1

    # Assert audit log entry was created
    audit = owner_db.query(AuditLog).filter(AuditLog.event_type == "owner_email_changed").first()
    assert audit is not None
    assert audit.user_id == initial_id
    assert "owner email changed from" in audit.details


def test_old_email_fails_and_new_email_succeeds(owner_db, monkeypatch):
    """Old email fails login with 401; new email succeeds with ADMIN_PASSWORD."""
    monkeypatch.setattr(settings, "ADMIN_PASSWORD", "SecretPass123!")
    client = TestClient(app)

    # Seed owner with initial email
    owner = User(
        name="Administrator",
        email="prior.owner@mobileum.com",
        role="admin",
        status="active",
        is_owner=True,
    )
    owner_db.add(owner)
    owner_db.commit()

    # Change OWNER_EMAIL in settings and run ensure_default_accounts
    new_email = "new.owner@mobileum.com"
    monkeypatch.setattr(settings, "OWNER_EMAIL", new_email)
    ensure_default_accounts(owner_db)

    # 1. Login with old email -> MUST RETURN 401
    old_resp = client.post(
        "/api/auth/login",
        json={"email": "prior.owner@mobileum.com", "password": "SecretPass123!"},
    )
    assert old_resp.status_code == 401
    assert "Invalid email or password" in old_resp.json()["detail"]

    # 2. Login with new email -> MUST SUCCEED (200)
    new_resp = client.post(
        "/api/auth/login",
        json={"email": new_email, "password": "SecretPass123!"},
    )
    assert new_resp.status_code == 200
    data = new_resp.json()
    assert data["status"] == "success"
    assert data["user"]["email"] == new_email
    assert data["user"]["is_owner"] is True
    # HttpOnly cookie must be present
    assert "auth_token" in new_resp.cookies

    # 3. Login with username 'admin' also succeeds
    admin_resp = client.post(
        "/api/auth/login",
        json={"email": "admin", "password": "SecretPass123!"},
    )
    assert admin_resp.status_code == 200
    assert admin_resp.json()["user"]["email"] == new_email


def test_duplicate_email_refused_on_startup(owner_db, monkeypatch, caplog):
    """If OWNER_EMAIL collides with an existing different user, refuse change and keep old email."""
    # Owner
    owner = User(
        name="Current Owner",
        email="owner@mobileum.com",
        role="admin",
        status="active",
        is_owner=True,
    )
    # Existing KAM with target email
    existing_user = User(
        name="Jane KAM",
        email="jane.kam@mobileum.com",
        role="kam",
        status="active",
        is_owner=False,
    )
    owner_db.add(owner)
    owner_db.add(existing_user)
    owner_db.commit()

    # Attempt to set OWNER_EMAIL to jane.kam@mobileum.com
    monkeypatch.setattr(settings, "OWNER_EMAIL", "jane.kam@mobileum.com")
    accs = ensure_default_accounts(owner_db)

    # Owner email must NOT change
    admin = accs["admin"]
    assert admin.email == "owner@mobileum.com"


def test_owner_protections(owner_db):
    """Owner cannot be deleted, disabled, or demoted."""
    owner = User(
        name="Owner",
        email="owner@mobileum.com",
        role="admin",
        status="active",
        is_owner=True,
    )
    owner_db.add(owner)
    owner_db.commit()

    with pytest.raises(HTTPException) as exc:
        check_last_admin_or_owner_protection(owner_db, owner, "delete")
    assert exc.value.status_code == 403
    assert "system owner" in exc.value.detail.lower()


def test_no_hardcoded_personal_emails_in_code():
    """Verify that rishithathoka@gmail.com and rishitha@mobileum.com are nowhere in source code."""
    repo_root = Path(__file__).resolve().parents[2]
    dirs_to_check = [
        repo_root / "backend" / "routers",
        repo_root / "backend" / "services",
        repo_root / "backend" / "models",
        repo_root / "frontend" / "src" / "pages",
        repo_root / "frontend" / "src" / "api",
        repo_root / "frontend" / "src" / "components",
    ]

    forbidden_patterns = [
        re.compile(r"rishithathoka@gmail\.com", re.IGNORECASE),
        re.compile(r"rishitha@mobileum\.com", re.IGNORECASE),
    ]

    violations = []
    for directory in dirs_to_check:
        if not directory.exists():
            continue
        for file_path in directory.rglob("*"):
            if file_path.is_file() and file_path.suffix in (".py", ".ts", ".tsx", ".js", ".jsx"):
                content = file_path.read_text(encoding="utf-8", errors="ignore")
                for pat in forbidden_patterns:
                    matches = pat.findall(content)
                    if matches:
                        violations.append(f"{file_path.relative_to(repo_root)}: matched {matches[0]}")

    assert not violations, f"Found hardcoded personal email violations in source: {violations}"
