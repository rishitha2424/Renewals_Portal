import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from backend.main import app
from backend.constants import get_approval_group, is_approved_2nd, normalize_approval_status
from backend.models.user import User, DealMessage, Notification, EmailOutbox
from backend.models.custom_column import DealComment
from backend.services.notification_service import NotificationService
from backend.services.auth_service import sign_session_token, ensure_default_accounts


from backend.database import get_db

@pytest.fixture
def test_client(seeded_session: Session):
    ensure_default_accounts(seeded_session)
    # Ensure a KAM test user exists
    kam = seeded_session.query(User).filter(User.role == "kam").first()
    if not kam:
        kam = User(
            id="test_kam_user_id",
            name="Luay Arabi",
            email="luay@mobileum.com",
            role="kam",
            status="active",
            owner_name="Luay Arabi",
        )
        seeded_session.add(kam)
        seeded_session.commit()

    def _override_get_db():
        yield seeded_session

    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()


def test_approved_2nd_mapping_helpers():
    """Verify Approved - 2nd maps to Approved group for metric parity and preserves raw status for details."""
    assert get_approval_group("Approved - 2nd") == "Approved"
    assert get_approval_group("Approved") == "Approved"
    assert get_approval_group("Pending Approval") == "Pending Approval"
    assert get_approval_group("Not submitted") == "Not submitted"

    assert is_approved_2nd("Approved - 2nd") is True
    assert is_approved_2nd("approved - 2nd") is True
    assert is_approved_2nd("Approved") is False

    assert normalize_approval_status("Approved - 2nd") == "Approved - 2nd"
    assert normalize_approval_status("Approved") == "Approved"


def test_snapshot_calendar_endpoint(test_client, seeded_session):
    """Verify /snapshots/calendar returns available upload snapshot dates."""
    admin_user = seeded_session.query(User).filter(User.role == "admin").first()
    assert admin_user
    admin_token = sign_session_token(admin_user)
    res = test_client.get("/api/snapshots/calendar", headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 200
    data = res.json()
    assert "available_dates" in data
    assert "snapshots" in data
    assert isinstance(data["available_dates"], list)
    assert len(data["available_dates"]) > 0


def test_notifications_crud_and_isolation(test_client, seeded_session):
    """Verify notification generation, user-isolation, mark read, and mark all read."""
    u1 = seeded_session.query(User).filter(User.role == "kam").first()
    u2 = seeded_session.query(User).filter(User.role == "management").first()
    assert u1 and u2

    u1.status = "active"
    u2.status = "active"
    seeded_session.commit()

    # Create notifications for both
    n1 = NotificationService.create_notification(
        db=seeded_session,
        user_id=u1.id,
        category="message",
        title="New deal message",
        message="Leadership sent an inquiry on deal XYZ",
        deal_id="TEST_DEAL_001",
        deal_name="Test Deal 001",
        target_type="message",
        target_id="msg_001",
    )
    n2 = NotificationService.create_notification(
        db=seeded_session,
        user_id=u2.id,
        category="comment",
        title="New deal comment",
        message="A comment was added on deal ABC",
        deal_id="TEST_DEAL_002",
        deal_name="Test Deal 002",
        target_type="comment",
        target_id="comm_001",
    )

    t1 = sign_session_token(u1)
    t2 = sign_session_token(u2)

    # User 1 sees n1 but NOT n2
    r1 = test_client.get("/api/notifications", headers={"Authorization": f"Bearer {t1}"})
    assert r1.status_code == 200
    items1 = r1.json()["notifications"]
    ids1 = [item["id"] for item in items1]
    assert n1.id in ids1
    assert n2.id not in ids1

    # User 2 sees n2 but NOT n1
    r2 = test_client.get("/api/notifications", headers={"Authorization": f"Bearer {t2}"})
    assert r2.status_code == 200
    items2 = r2.json()["notifications"]
    ids2 = [item["id"] for item in items2]
    assert n2.id in ids2
    assert n1.id not in ids2

    # Mark single read
    r_read = test_client.post(f"/api/notifications/{n1.id}/read", headers={"Authorization": f"Bearer {t1}"})
    assert r_read.status_code == 200
    assert r_read.json()["success"] is True

    # Mark all read
    r_read_all = test_client.post("/api/notifications/read-all", headers={"Authorization": f"Bearer {t2}"})
    assert r_read_all.status_code == 200
    assert r_read_all.json()["success"] is True


def test_recipients_picker_privacy(test_client, seeded_session):
    """Verify /api/messages/recipients returns names, IDs, and roles ONLY (NO email addresses)."""
    kam_user = seeded_session.query(User).filter(User.role == "kam").first()
    assert kam_user
    kam_token = sign_session_token(kam_user)

    res = test_client.get("/api/messages/recipients", headers={"Authorization": f"Bearer {kam_token}"})
    assert res.status_code == 200
    data = res.json()
    assert "management" in data
    assert "admins" in data

    # STRICT PRIVACY: verify no email address anywhere in the response
    for user_obj in data["management"] + data["admins"] + ([data["deal_owner"]] if data.get("deal_owner") else []):
        assert "email" not in user_obj, "Privacy leak: email found in recipients options!"
        assert "name" in user_obj
        assert "role" in user_obj
        assert "id" in user_obj


def test_email_log_privacy(test_client, seeded_session):
    """Verify /api/messages/email-log NEVER exposes recipient_email or sender_email anywhere in payload."""
    admin_user = seeded_session.query(User).filter(User.role == "admin").first()
    assert admin_user
    admin_token = sign_session_token(admin_user)

    # Seed an EmailOutbox entry
    outbox_entry = EmailOutbox(
        id="test_outbox_r25",
        recipient_email="sensitive_email_should_be_hidden@domain.com",
        recipient_name="Test Recipient",
        recipient_role="kam",
        sender_name="Management User",
        sender_role="management",
        deal_id="TEST_DEAL_PRIVACY",
        deal_name="Test Deal Privacy",
        template_type="new_message",
        subject="New message: Test Deal Privacy",
        body_html="<p>Inquiry body</p>",
        body_text="Inquiry body",
        status="sent",
    )
    seeded_session.add(outbox_entry)
    seeded_session.commit()

    res = test_client.get("/api/messages/email-log", headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 200
    log_items = res.json()["log"]

    # Verify every entry in log omits recipient email
    for item in log_items:
        assert "recipient_email" not in item
        assert "sender_email" not in item
        assert "recipient" not in item
        # Ensure recipient_name and role are present
        assert "recipient_name" in item
        assert "recipient_role" in item
        # Double check no value contains an @ symbol
        for key, val in item.items():
            if isinstance(val, str) and "@" in val:
                pytest.fail(f"Privacy leak: email address found in field '{key}': {val}")



