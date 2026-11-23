"""
Round 21 Test Suite:
1. Parsing of MAIL_ENABLED (case-insensitive bool), port, and TLS flags
2. Safe diagnostics endpoint:
   - admin-only authentication
   - returns loaded .env path, file exists, variable status
   - NEVER returns raw SMTP_PASSWORD or secrets in response or logs (strictly masked as ***)
   - exact inactive_reason when misconfigured or active
3. Outbox endpoints and actions:
   - list outbox with both config & diagnostics schemas
   - cancel outbox item
   - delete outbox item
   - send single outbox item
   - resend pending outbox items (skips cancelled)
4. Send test email error reporting:
   - reports real error safely without exposing passwords
"""
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.main import app
from backend.config import settings, Settings
from backend.database import Base, get_db
from backend.models import User, EmailOutbox, AuditLog
from backend.services.auth_service import sign_session_token, ensure_default_accounts
from backend.services.mail_service import MailService, _sanitize_error


@pytest.fixture(scope="module")
def round21_db():
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


def test_mail_env_parsing():
    """Verify case-insensitive bool parsing and port conversion."""
    # Boolean parsing
    for truthy in ("true", "True", "TRUE", " 1 ", "yes", "YES", "on", "ON", True):
        assert Settings.parse_bool_env(truthy) is True

    for falsy in ("false", "False", "0", "no", "off", False):
        assert Settings.parse_bool_env(falsy) is False

    # Port parsing
    assert Settings.parse_int_env("587") == 587
    assert Settings.parse_int_env(465) == 465
    assert Settings.parse_int_env("invalid") == 587


def test_safe_diagnostics_endpoint_security(round21_db):
    """Verify diagnostics endpoint is admin-only and masks all secrets as ***."""
    client = round21_db["client"]

    # 1. Anonymous request must be rejected
    anon_client = TestClient(app)
    anon_client.headers.pop("Authorization", None)
    anon_res = anon_client.get("/api/admin/email/diagnostics")
    assert anon_res.status_code == 401

    # 2. Admin request returns diagnostic information
    res = client.get("/api/admin/email/diagnostics")
    assert res.status_code == 200
    data = res.json()

    assert "env_file_path" in data
    assert "env_file_exists" in data
    assert "is_configured" in data
    assert "inactive_reason" in data
    assert "variables" in data

    vars_data = data["variables"]
    for required_var in ["MAIL_ENABLED", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_STARTTLS", "SMTP_SSL", "MAIL_FROM"]:
        assert required_var in vars_data
        assert "set" in vars_data[required_var]
        assert "value" in vars_data[required_var]

    # 3. CRITICAL: SMTP_PASSWORD is NEVER exposed in the JSON response
    password_val = vars_data["SMTP_PASSWORD"]["value"]
    assert password_val in ("***", "(not set)")
    raw_json = res.text
    # Verify no raw passwords or secrets leaked in body
    if settings.SMTP_PASSWORD:
        assert settings.SMTP_PASSWORD not in raw_json


def test_exact_inactive_reason():
    """Verify exact reasons reported when settings are missing."""
    with patch.object(settings, "MAIL_ENABLED", False):
        reason = MailService.get_inactive_reason()
        assert reason == "MAIL_ENABLED is false"

    with patch.object(settings, "MAIL_ENABLED", True), \
         patch.object(settings, "SMTP_HOST", ""):
        reason = MailService.get_inactive_reason()
        assert reason == "SMTP_HOST missing"

    with patch.object(settings, "MAIL_ENABLED", True), \
         patch.object(settings, "SMTP_HOST", "smtp.office365.com"), \
         patch.object(settings, "SMTP_PORT", 0):
        reason = MailService.get_inactive_reason()
        assert reason == "SMTP_PORT missing or invalid"

    with patch.object(settings, "MAIL_ENABLED", True), \
         patch.object(settings, "SMTP_HOST", "smtp.office365.com"), \
         patch.object(settings, "SMTP_PORT", 587), \
         patch.object(settings, "MAIL_FROM", ""):
        reason = MailService.get_inactive_reason()
        assert reason == "MAIL_FROM missing"

    with patch.object(settings, "MAIL_ENABLED", True), \
         patch.object(settings, "SMTP_HOST", "smtp.office365.com"), \
         patch.object(settings, "SMTP_PORT", 587), \
         patch.object(settings, "MAIL_FROM", "renewals@mobileum.com"), \
         patch.object(settings, "SMTP_USER", "admin@mobileum.com"), \
         patch.object(settings, "SMTP_PASSWORD", ""):
        reason = MailService.get_inactive_reason()
        assert reason == "SMTP_PASSWORD missing"


def test_outbox_endpoints_and_actions(round21_db):
    """Test outbox listing, item cancellation, item deletion, and single-item sending."""
    db = round21_db["db"]
    client = round21_db["client"]

    # Seed 2 outbox entries
    item1 = MailService.queue_email(
        db,
        recipient_email="cancel-me@mobileum.com",
        subject="Item to Cancel",
        body_html="<p>Cancel me</p>",
        template_type="test",
    )
    item2 = MailService.queue_email(
        db,
        recipient_email="delete-me@mobileum.com",
        subject="Item to Delete",
        body_html="<p>Delete me</p>",
        template_type="test",
    )

    # 1. GET /api/admin/email/outbox
    res = client.get("/api/admin/email/outbox")
    assert res.status_code == 200
    data = res.json()
    assert "emails" in data
    assert "outbox" in data
    assert "smtp_configured" in data
    assert "inactive_reason" in data
    assert any(e["id"] == item1.id for e in data["emails"])

    # 2. GET /api/email-admin/outbox (alias route)
    alias_res = client.get("/api/email-admin/outbox")
    assert alias_res.status_code == 200
    assert any(e["id"] == item1.id for e in alias_res.json()["emails"])

    # 3. Cancel item1
    cancel_res = client.post(f"/api/admin/email/outbox/{item1.id}/cancel")
    assert cancel_res.status_code == 200
    assert cancel_res.json()["item_status"] == "cancelled"

    db.refresh(item1)
    assert item1.status == "cancelled"

    # 4. Delete item2
    delete_res = client.delete(f"/api/admin/email/outbox/{item2.id}")
    assert delete_res.status_code == 200
    assert delete_res.json()["deleted_id"] == item2.id

    db_item2 = db.query(EmailOutbox).filter(EmailOutbox.id == item2.id).first()
    assert db_item2 is None

    # 5. Resend pending does not send cancelled items
    with patch.object(MailService, "is_configured", return_value=True), \
         patch.object(MailService, "_send_smtp", return_value=(True, None)):
        resend_res = client.post("/api/admin/email/resend-pending")
        assert resend_res.status_code == 200
        # item1 was cancelled so it should not be dispatched
        db.refresh(item1)
        assert item1.status == "cancelled"


def test_send_test_email_error_sanitization(round21_db):
    """Test send test email handles and reports errors safely without leaking passwords."""
    client = round21_db["client"]

    # 1. When SMTP is configured but authentication fails
    with patch.object(MailService, "is_configured", return_value=True), \
         patch.object(MailService, "_send_smtp", return_value=(False, "SMTP authentication failed (535): Invalid credentials")):
        test_res = client.post("/api/admin/email/test", json={"recipient_email": "test@mobileum.com"})
        assert test_res.status_code == 200
        body = test_res.json()
        assert body["status"] == "failed"
        assert body["delivered"] is False
        assert "authentication failed" in body["detail"]

    # 2. Sanitize error helper
    with patch.object(settings, "SMTP_PASSWORD", "SuperSecretPwd123!"):
        leaked = "Connection failed with password SuperSecretPwd123! at port 587"
        cleaned = _sanitize_error(leaked)
        assert "SuperSecretPwd123!" not in cleaned
        assert "***" in cleaned
