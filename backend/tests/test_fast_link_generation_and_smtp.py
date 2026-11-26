"""
Targeted tests for fast password/invite/reset link generation, decoupled SMTP dispatch,
unreachable SMTP handling with short timeout, and APP_BASE_URL resolution.
"""
import time
import socket
import unittest.mock
import pytest
from datetime import datetime, timezone
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.main import app
from backend.database import Base, get_db
from backend.models.user import User, EmailOutbox
from backend.config import settings
from backend.services.auth_service import ensure_default_accounts, hash_password
from backend.services.mail_service import MailService


@pytest.fixture(scope="module")
def link_test_db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()

    ensure_default_accounts(db)

    test_user = User(
        name="Target KAM User",
        email="target.kam@example.com",
        password_hash=hash_password("InitPassword123!"),
        role="kam",
        owner_name="Target KAM",
        is_owner=False,
        status="active",
        created_at=datetime.now(timezone.utc),
    )
    db.add(test_user)
    db.commit()
    db.refresh(test_user)

    app.dependency_overrides[get_db] = lambda: db
    yield db, test_user
    app.dependency_overrides.clear()


def test_link_generation_under_one_second_with_unreachable_smtp(link_test_db):
    """
    Ensure generating an invite/reset link returns in under 1 second (target < 500ms)
    even when SMTP is configured to an unreachable IP address with a 2s timeout.
    The HTTP response must not block waiting for SMTP delivery.
    """
    db, test_user = link_test_db

    original_mail_enabled = settings.MAIL_ENABLED
    original_host = settings.SMTP_HOST
    original_port = settings.SMTP_PORT
    original_timeout = getattr(settings, "SMTP_TIMEOUT", 60)
    original_timeout_sec = getattr(settings, "SMTP_TIMEOUT_SECONDS", 60)
    original_testing = settings.TESTING
    original_base_url = settings.APP_BASE_URL

    try:
        settings.MAIL_ENABLED = True
        settings.SMTP_HOST = "192.0.2.1"
        settings.SMTP_PORT = 587
        settings.SMTP_TIMEOUT = 2
        settings.SMTP_TIMEOUT_SECONDS = 2
        settings.TESTING = False  # Exercise real SMTP path without testing mock
        settings.APP_BASE_URL = "http://10.0.0.5:5173"

        client = TestClient(app)
        login_resp = client.post(
            "/api/auth/login",
            json={"email": "admin", "password": settings.ADMIN_PASSWORD},
        )
        assert login_resp.status_code == 200

        # Measure invite link generation time
        t0 = time.perf_counter()
        resp_invite = client.post(f"/api/admin/users/{test_user.id}/invite-link")
        t_invite = time.perf_counter() - t0

        assert resp_invite.status_code == 200
        data_invite = resp_invite.json()
        assert "invite_link" in data_invite or "invite_url" in data_invite
        link_val = data_invite.get("invite_link") or data_invite.get("invite_url")
        assert link_val.startswith("http://10.0.0.5:5173/invite/")
        assert t_invite < 1.0, f"Invite link generation was too slow: {t_invite:.3f}s (must be < 1.0s)"

        # Measure reset link generation time
        t0 = time.perf_counter()
        resp_reset = client.post(f"/api/admin/users/{test_user.id}/reset-link")
        t_reset = time.perf_counter() - t0

        assert resp_reset.status_code == 200
        data_reset = resp_reset.json()
        assert "reset_link" in data_reset or "reset_url" in data_reset
        reset_val = data_reset.get("reset_link") or data_reset.get("reset_url")
        assert reset_val.startswith("http://10.0.0.5:5173/reset-password/")
        assert t_reset < 1.0, f"Reset link generation was too slow: {t_reset:.3f}s (must be < 1.0s)"

    finally:
        settings.MAIL_ENABLED = original_mail_enabled
        settings.SMTP_HOST = original_host
        settings.SMTP_PORT = original_port
        settings.SMTP_TIMEOUT = original_timeout
        settings.SMTP_TIMEOUT_SECONDS = original_timeout_sec
        settings.TESTING = original_testing
        settings.APP_BASE_URL = original_base_url


def test_smtp_timeout_passed_to_smtp_client_and_slow_greeting(link_test_db):
    """
    Verify that settings.SMTP_TIMEOUT (e.g. 60) is passed directly to smtplib.SMTP/SMTP_SSL.
    Also simulate a slow relay greeting that completes within timeout.
    """
    original_testing = settings.TESTING
    original_host = settings.SMTP_HOST
    original_port = settings.SMTP_PORT
    original_timeout = getattr(settings, "SMTP_TIMEOUT", 60)

    try:
        settings.TESTING = False
        settings.SMTP_HOST = "postfix-relay.roamware.com"
        settings.SMTP_PORT = 25
        settings.SMTP_TIMEOUT = 60
        settings.SMTP_TIMEOUT_SECONDS = 60
        settings.SMTP_SSL = False
        settings.SMTP_STARTTLS = False
        settings.SMTP_USER = ""
        settings.SMTP_PASSWORD = ""

        # Mock smtplib.SMTP: verify timeout argument and simulate delayed greeting
        mock_server = unittest.mock.MagicMock()
        def delayed_greeting(*args, **kwargs):
            # simulate 0.05s greeting delay
            time.sleep(0.05)
            return (220, b"postfix-relay.roamware.com ESMTP Postfix")

        mock_server.getreply.side_effect = delayed_greeting
        mock_server.sendmail.return_value = {}

        with unittest.mock.patch("smtplib.SMTP", return_value=mock_server) as mock_smtp_cls:
            success, err = MailService._send_smtp(
                to_addr="test@example.com",
                subject="Greeting test",
                body_html="<p>Test</p>",
                body_text="Test",
            )
            # Verify SMTP was initialized with host, port, and timeout=60
            mock_smtp_cls.assert_called_once_with("postfix-relay.roamware.com", 25, timeout=60)
            assert success is True
            assert err is None
    finally:
        settings.TESTING = original_testing
        settings.SMTP_HOST = original_host
        settings.SMTP_PORT = original_port
        settings.SMTP_TIMEOUT = original_timeout


def test_smtp_timeout_error_formatting_and_no_secret_leak(link_test_db):
    """
    Verify that when SMTP connection times out, the error is sanitized and formatted as:
    'Connection timed out connecting to SMTP host {host}:{port} (timeout={timeout}s)'.
    """
    original_testing = settings.TESTING
    original_host = settings.SMTP_HOST
    original_port = settings.SMTP_PORT
    original_timeout = getattr(settings, "SMTP_TIMEOUT", 60)

    try:
        settings.TESTING = False
        settings.SMTP_HOST = "smtp.example.com"
        settings.SMTP_PORT = 587
        settings.SMTP_TIMEOUT = 3
        settings.SMTP_TIMEOUT_SECONDS = 3

        with unittest.mock.patch("smtplib.SMTP", side_effect=socket.timeout("timed out")):
            success, err = MailService._send_smtp(
                to_addr="test@example.com",
                subject="Timeout test",
                body_html="<p>Test</p>",
                body_text="Test",
            )

            assert success is False
            assert err is not None
            assert "Connection timed out connecting to SMTP host smtp.example.com:587 (timeout=3s)" in err
            if settings.SMTP_PASSWORD:
                assert settings.SMTP_PASSWORD not in err
    finally:
        settings.TESTING = original_testing
        settings.SMTP_HOST = original_host
        settings.SMTP_PORT = original_port
        settings.SMTP_TIMEOUT = original_timeout


def test_mail_diagnostics_includes_timeout_and_error(link_test_db):
    """
    Ensure MailService.get_diagnostics() reports timeout, timeout_seconds, and variables.
    """
    diag = MailService.get_diagnostics()
    assert "timeout" in diag or "timeout_seconds" in diag
    timeout_val = diag.get("timeout") or diag.get("timeout_seconds")
    assert isinstance(timeout_val, int)
    assert "variables" in diag
    assert "SMTP_TIMEOUT" in diag["variables"] or "SMTP_TIMEOUT_SECONDS" in diag["variables"]


def test_email_outbox_retry_single_and_bulk_endpoints(link_test_db):
    """
    Test that single item retry and bulk retry endpoints:
    1. Reset item status from failed to pending/sent
    2. List recipient details (recipient_name and recipient_email)
    3. Require admin authentication
    """
    db, test_user = link_test_db
    client = TestClient(app)

    # Login as admin
    login_resp = client.post(
        "/api/auth/login",
        json={"email": "admin", "password": settings.ADMIN_PASSWORD},
    )
    assert login_resp.status_code == 200

    # Seed 2 failed outbox records
    outbox1 = EmailOutbox(
        recipient_email="retry.user1@example.com",
        recipient_name="Alice Smith",
        subject="Invitation to Horizon",
        body_html="<p>Welcome</p>",
        body_text="Welcome",
        template_type="invite",
        status="failed",
        error_message="SMTP greeting timed out after 15s",
        retry_count=1,
        created_at=datetime.now(timezone.utc),
    )
    outbox2 = EmailOutbox(
        recipient_email="retry.user2@example.com",
        recipient_name="Bob Jones",
        subject="Password Reset Link",
        body_html="<p>Reset</p>",
        body_text="Reset",
        template_type="reset",
        status="failed",
        error_message="Connection timed out",
        retry_count=2,
        created_at=datetime.now(timezone.utc),
    )
    db.add_all([outbox1, outbox2])
    db.commit()
    db.refresh(outbox1)
    db.refresh(outbox2)

    # 1. Test single retry endpoint: POST /api/admin/email/outbox/{id}/retry
    # Mock MailService._send_smtp to succeed
    with unittest.mock.patch.object(MailService, "_send_smtp", return_value=(True, None)):
        resp_retry = client.post(f"/api/admin/email/outbox/{outbox1.id}/retry")
        assert resp_retry.status_code == 200
        data_retry = resp_retry.json()
        assert data_retry.get("status") == "success"
        assert data_retry.get("delivered") is True
        assert data_retry.get("recipient", {}).get("recipient_email") == "retry.user1@example.com"
        assert data_retry.get("recipient", {}).get("recipient_name") == "Alice Smith"

        # Verify DB item updated to sent
        db.refresh(outbox1)
        assert outbox1.status == "sent"

    # 2. Test bulk retry endpoint: POST /api/admin/email/retry-failed
    # outbox2 is still 'failed'
    with unittest.mock.patch.object(MailService, "_send_smtp", return_value=(True, None)):
        resp_bulk = client.post("/api/admin/email/retry-failed")
        assert resp_bulk.status_code == 200
        data_bulk = resp_bulk.json()
        assert data_bulk.get("retried_count", 0) >= 1
        assert "recipients" in data_bulk
        recip_emails = [r["recipient_email"] for r in data_bulk["recipients"]]
        assert "retry.user2@example.com" in recip_emails

        # Verify DB item updated to sent
        db.refresh(outbox2)
        assert outbox2.status == "sent"
