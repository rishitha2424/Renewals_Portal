"""
Targeted tests for Comments & Messages fix:
- Save-first 2xx resilience when notification/email dispatch fails
- Group expansion, Management locks Admin on comments, deduplication, skip disabled/author, 'no email on file'
- Message strict participant isolation (unselected admin denied)
- Per-user independent read/unread state
- Full visibility matrix (admin / management / owner KAM / other KAM)
- Edit, Unsend, Admin removal, non-author denial, Admin-only history, tombstone + unread cleared
- Email log: 1 row per event, counts, redacted body/recipients for unselected admins, zero emails in responses, KAM 'My Email Log', consistent UTC ISO timestamps
- 50 recipients API < 1s + single reused SMTP connection in background worker
- Alembic migration 0013 schema check (isolated temp SQLite, never touching renewals.db)
"""
from __future__ import annotations

import json
import os
import tempfile
import time
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.database import Base, get_db
from backend.main import app
from backend.models.opportunity import Opportunity
from backend.models.snapshot import UploadSnapshot
from backend.models.user import (
    CommentMessageHistory,
    DealMessage,
    EmailDeliveryEvent,
    EmailOutbox,
    MessageReadReceipt,
    Notification,
    User,
)
from backend.models.custom_column import DealComment
from backend.services.auth_service import sign_session_token
from backend.services.mail_service import MailService
from backend.services.notification_service import NotificationService


def _build_env():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    return engine, TestingSessionLocal


def _seed_core(db):
    main_admin = User(
        id=str(uuid.uuid4()),
        email="owner-admin@example.test",
        name="Main Admin",
        role="admin",
        status="active",
        is_owner=True,
    )
    admin_b = User(
        id=str(uuid.uuid4()),
        email="admin-b@example.test",
        name="Admin B",
        role="admin",
        status="active",
        is_owner=False,
    )
    mgmt_1 = User(
        id=str(uuid.uuid4()),
        email="mgmt-1@example.test",
        name="Mgmt One",
        role="management",
        status="active",
        is_owner=False,
    )
    mgmt_no_email = User(
        id=str(uuid.uuid4()),
        email="",
        name="Mgmt NoEmail",
        role="management",
        status="active",
        is_owner=False,
    )
    disabled_admin = User(
        id=str(uuid.uuid4()),
        email="disabled@example.test",
        name="Disabled Admin",
        role="admin",
        status="disabled",
        is_owner=False,
    )
    invited_mgmt = User(
        id=str(uuid.uuid4()),
        email="invited@example.test",
        name="Invited Mgmt",
        role="management",
        status="invited",
        is_owner=False,
    )
    kam_owner = User(
        id=str(uuid.uuid4()),
        email="niraj@example.test",
        name="Niraj Kumar",
        role="kam",
        status="active",
        is_owner=False,
        owner_name="Niraj Kumar",
    )
    other_kam = User(
        id=str(uuid.uuid4()),
        email="other-kam@example.test",
        name="Other KAM",
        role="kam",
        status="active",
        is_owner=False,
        owner_name="Other KAM",
    )
    db.add_all([main_admin, admin_b, mgmt_1, mgmt_no_email, disabled_admin, invited_mgmt, kam_owner, other_kam])

    snap_old = UploadSnapshot(
        id=str(uuid.uuid4()),
        label="Yesterday",
        snapshot_date=date(2026, 1, 1),
        workbook_type="BOTH",
        is_active_today=False,
    )
    snap_cur = UploadSnapshot(
        id=str(uuid.uuid4()),
        label="Today",
        snapshot_date=date(2026, 1, 2),
        workbook_type="BOTH",
        is_active_today=True,
    )
    db.add_all([snap_old, snap_cur])
    db.flush()

    deal_1 = Opportunity(
        id=str(uuid.uuid4()),
        snapshot_id=snap_cur.id,
        opportunity_id_18="006DEAL00000000001",
        opportunity_name="Acme Renewal Deal",
        account_name="Acme Corp",
        opportunity_owner="Niraj Kumar",
        forecast_acv_amount=Decimal("100000.00"),
        forecast_category="Commit",
    )
    deal_other = Opportunity(
        id=str(uuid.uuid4()),
        snapshot_id=snap_cur.id,
        opportunity_id_18="006DEAL00000000002",
        opportunity_name="Beta Renewal Deal",
        account_name="Beta Inc",
        opportunity_owner="Other KAM",
        forecast_acv_amount=Decimal("50000.00"),
        forecast_category="Pipeline",
    )
    # Deal present only in older snapshot (missing from next snapshot)
    deal_archived = Opportunity(
        id=str(uuid.uuid4()),
        snapshot_id=snap_old.id,
        opportunity_id_18="006DEAL00000000003",
        opportunity_name="Historical Renewal",
        account_name="Old Co",
        opportunity_owner="Niraj Kumar",
        forecast_acv_amount=Decimal("25000.00"),
        forecast_category="Closed",
    )
    db.add_all([deal_1, deal_other, deal_archived])
    db.commit()

    return {
        "main_admin": main_admin,
        "admin_b": admin_b,
        "mgmt_1": mgmt_1,
        "mgmt_no_email": mgmt_no_email,
        "disabled_admin": disabled_admin,
        "invited_mgmt": invited_mgmt,
        "kam_owner": kam_owner,
        "other_kam": other_kam,
        "deal_1": deal_1.opportunity_id_18,
        "deal_other": deal_other.opportunity_id_18,
        "deal_archived": deal_archived.opportunity_id_18,
    }


def _hdr(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {sign_session_token(user)}"}


@pytest.fixture
def env():
    engine, SessionLocal = _build_env()
    db = SessionLocal()
    data = _seed_core(db)
    client = TestClient(app)
    yield client, SessionLocal, data
    db.close()
    MailService.wait_for_idle(timeout=5.0)
    app.dependency_overrides.clear()
    engine.dispose()


def _assert_no_emails_in_payload(obj, allowed_emails: set[str]):
    raw = json.dumps(obj)
    for em in allowed_emails:
        if em and "@" in em:
            assert em not in raw, f"Email address leaked into response payload: {em}"


def test_comment_save_first_returns_2xx_even_when_notification_or_smtp_fails(env):
    client, SessionLocal, d = env
    with (
        patch.object(NotificationService, "create_notification", side_effect=RuntimeError("notif table hiccup")),
        patch("backend.services.mail_service.settings.TESTING", False),
        patch("backend.services.mail_service.settings.SMTP_HOST", "smtp.example.test"),
        patch("smtplib.SMTP", side_effect=OSError("smtp relay down")),
    ):
        resp = client.post(
            f"/api/custom-columns/deals/{d['deal_1']}/comments",
            headers=_hdr(d["kam_owner"]),
            json={
                "text": "Client signed PO today",
                "visibility": "shared_with_owner",
                "recipient_ids": ["group:admin", "group:management"],
            },
        )
        MailService.wait_for_idle(timeout=5.0)

    assert resp.status_code in (200, 201), resp.text
    body = resp.json()
    assert body["comment"]["text"] == "Client signed PO today"

    # Comment persisted cleanly
    list_resp = client.get(f"/api/custom-columns/deals/{d['deal_1']}/comments", headers=_hdr(d["main_admin"]))
    assert list_resp.status_code == 200
    assert any(c["text"] == "Client signed PO today" for c in list_resp.json()["comments"])

    # Delivery failure recorded in delivery log
    log_resp = client.get("/api/messages/email-log", headers=_hdr(d["main_admin"]))
    assert log_resp.status_code == 200
    events = log_resp.json()["log"]
    assert len(events) >= 1
    ev = events[0]
    assert ev["failed_count"] >= 1 or ev["skipped_count"] >= 1
    assert any(r["reason"] for r in ev["recipients"] if r["status"] in ("failed", "skipped"))


def test_comment_group_expansion_mgmt_locks_admin_dedup_and_skips(env):
    client, SessionLocal, d = env
    all_emails = {
        u.email for u in (d["main_admin"], d["admin_b"], d["mgmt_1"], d["disabled_admin"], d["invited_mgmt"], d["kam_owner"])
    }

    with patch.object(MailService, "is_configured", return_value=True), patch.object(MailService, "dispatch_batch") as mock_dispatch:
        mock_dispatch.return_value = {"sent": 0, "failed": 0, "skipped": 0, "connections_opened": 1}
        # Author = main_admin, picks "management" + overlapping mgmt_1 + disabled + invited -> should lock Admin on too!
        resp = client.post(
            f"/api/custom-columns/deals/{d['deal_1']}/comments",
            headers=_hdr(d["main_admin"]),
            json={
                "text": "Review forecast before EOW",
                "visibility": "shared_with_owner",
                "recipient_ids": ["group:management", d["mgmt_1"].id, d["disabled_admin"].id, d["invited_mgmt"].id],
            },
        )
        MailService.wait_for_idle(timeout=5.0)

    assert resp.status_code == 200, resp.text
    with SessionLocal() as db:
        notifs = db.query(Notification).filter(Notification.target_type == "deal_comment").all()
        notif_uids = {n.user_id for n in notifs}
        # Expect: admin_b (locked in because Mgmt selected), mgmt_1, mgmt_no_email, kam_owner (shared_with_owner)
        # Skip: main_admin (author), disabled_admin, invited_mgmt
        assert d["admin_b"].id in notif_uids
        assert d["mgmt_1"].id in notif_uids
        assert d["kam_owner"].id in notif_uids
        assert d["main_admin"].id not in notif_uids
        assert d["disabled_admin"].id not in notif_uids
        assert d["invited_mgmt"].id not in notif_uids
        # Zero duplicate notifications per user
        assert len(notifs) == len(notif_uids)

        # Outbox recorded "no email on file" for mgmt_no_email
        skipped = db.query(EmailOutbox).filter(EmailOutbox.recipient_user_id == d["mgmt_no_email"].id).first()
        assert skipped is not None
        assert skipped.status == "skipped"
        assert "no email on file" in (skipped.error_message or "").lower()

    # Main Admin checks admin email log and sees no email addresses leaked
    log_r = client.get("/api/messages/email-log", headers=_hdr(d["main_admin"]))
    assert log_r.status_code == 200
    _assert_no_emails_in_payload(log_r.json(), all_emails)


def test_kam_comment_reaches_main_admin_and_populates_kam_email_log(env):
    client, SessionLocal, d = env
    sent_to = []

    class FakeSMTP:
        def __init__(self, *a, **kw):
            pass
        def ehlo(self): pass
        def starttls(self, **kw): pass
        def login(self, *a, **kw): pass
        def sendmail(self, frm, to_addrs, raw_msg):
            sent_to.append((to_addrs, str(raw_msg)))
        def send_message(self, msg, from_addr=None, to_addrs=None):
            addrs = to_addrs if isinstance(to_addrs, list) else ([msg["To"]] if msg.get("To") else [])
            sent_to.append((addrs, msg.as_string()))
        def quit(self): pass

    with (
        patch.object(MailService, "is_configured", return_value=True),
        patch("backend.services.mail_service.settings.TESTING", False),
        patch("backend.services.mail_service.settings.SMTP_HOST", "smtp.example.test"),
        patch("backend.services.mail_service.settings.MAIL_FROM", "noreply@example.test"),
        patch("smtplib.SMTP", FakeSMTP),
    ):
        r = client.post(
            f"/api/custom-columns/deals/{d['deal_1']}/comments",
            headers=_hdr(d["kam_owner"]),
            json={
                "text": "Need approval sign-off",
                "visibility": "shared_with_owner",
            },
        )
        assert r.status_code == 200
        MailService.wait_for_idle(timeout=5.0)

    # Personalized greeting sent to Main Admin as well
    import email as _email_pkg
    to_list = [addr for addrs, _ in sent_to for addr in addrs]
    assert d["main_admin"].email in to_list
    assert d["admin_b"].email in to_list
    assert d["mgmt_1"].email in to_list
    decoded_bodies = []
    for _, raw in sent_to:
        parsed = _email_pkg.message_from_string(raw)
        if parsed.is_multipart():
            for part in parsed.walk():
                if part.get_content_type() in ("text/plain", "text/html"):
                    payload = part.get_payload(decode=True)
                    if payload:
                        decoded_bodies.append(payload.decode("utf-8", errors="ignore"))
        else:
            decoded_bodies.append(raw)
    assert any("Hello Main Admin," in body for body in decoded_bodies)

    # Admin email log shows event including Main Admin
    admin_log = client.get("/api/messages/email-log", headers=_hdr(d["main_admin"])).json()["log"]
    assert len(admin_log) >= 1
    assert any(rec["name"] == "Main Admin" and rec["status"] == "sent" for rec in admin_log[0]["recipients"])

    # KAM "My Email Log" is non-empty for the KAM author (and contains zero email addresses)
    kam_log = client.get("/api/messages/email-log", headers=_hdr(d["kam_owner"]))
    assert kam_log.status_code == 200
    assert len(kam_log.json()["log"]) >= 1
    _assert_no_emails_in_payload(kam_log.json(), {d["main_admin"].email, d["kam_owner"].email})


def test_messages_unselected_admin_isolation_and_independent_unread_state(env):
    client, SessionLocal, d = env

    with patch.object(MailService, "is_configured", return_value=False):
        # Main admin messages KAM owner + mgmt_1 ONLY (admin_b NOT selected)
        res = client.post(
            "/api/messages",
            headers=_hdr(d["main_admin"]),
            json={
                "deal_id": d["deal_1"],
                "subject": "Private pricing check",
                "body": "Please confirm 15% discount approval.",
                "recipient_ids": [d["kam_owner"].id, d["mgmt_1"].id],
            },
        )
        MailService.wait_for_idle(timeout=5.0)

    assert res.status_code == 200
    msg_id = res.json()["message_id"]

    # Unselected admin_b CANNOT read the message or thread, got NO notification, got NO email
    r_b_deal = client.get(f"/api/messages/deal/{d['deal_1']}", headers=_hdr(d["admin_b"]))
    assert r_b_deal.status_code == 200
    assert all(m["id"] != msg_id for m in r_b_deal.json()["messages"])

    r_b_notif = client.get("/api/notifications", headers=_hdr(d["admin_b"]))
    assert r_b_notif.status_code == 200
    assert all(n.get("target_id") != msg_id for n in r_b_notif.json()["notifications"])

    with SessionLocal() as db:
        outbox_b = db.query(EmailOutbox).filter(
            EmailOutbox.recipient_user_id == d["admin_b"].id,
            EmailOutbox.deal_id == d["deal_1"],
        ).count()
        assert outbox_b == 0

    # Selected recipients DO read it & see unread independently
    r_kam_before = client.get(f"/api/messages/deal/{d['deal_1']}", headers=_hdr(d["kam_owner"])).json()["messages"]
    r_mgmt_before = client.get(f"/api/messages/deal/{d['deal_1']}", headers=_hdr(d["mgmt_1"])).json()["messages"]
    assert any(m["id"] == msg_id and m["is_read"] is False for m in r_kam_before)
    assert any(m["id"] == msg_id and m["is_read"] is False for m in r_mgmt_before)

    # Unselected admin sees email-log row metadata with redacted body & recipients
    r_b_log = client.get("/api/messages/email-log", headers=_hdr(d["admin_b"])).json()["log"]
    assert len(r_b_log) == 1
    assert r_b_log[0]["details_redacted"] is True
    assert r_b_log[0]["body_preview"] is None
    assert r_b_log[0]["recipients"] == []

    # Selected recipient mgmt_1 DOES see body_preview and recipient details
    r_m_log = client.get("/api/messages/email-log", headers=_hdr(d["mgmt_1"])).json()["log"]
    assert len(r_m_log) == 1
    assert r_m_log[0]["details_redacted"] is False
    assert "Private pricing check" in (r_m_log[0]["subject"] or "")
    assert "15% discount" in (r_m_log[0]["body_preview"] or "")

    # Per-user independent read state: mgmt_1 marks read -> kam_owner stays unread!
    mark_r = client.post(f"/api/messages/{msg_id}/read", headers=_hdr(d["mgmt_1"]))
    assert mark_r.status_code == 200

    r_mgmt_after = client.get(f"/api/messages/deal/{d['deal_1']}", headers=_hdr(d["mgmt_1"])).json()["messages"]
    r_kam_after = client.get(f"/api/messages/deal/{d['deal_1']}", headers=_hdr(d["kam_owner"])).json()["messages"]
    assert any(m["id"] == msg_id and m["is_read"] is True for m in r_mgmt_after)
    assert any(m["id"] == msg_id and m["is_read"] is False for m in r_kam_after)


def test_visibility_matrix_and_historical_deal_fallback(env):
    client, SessionLocal, d = env

    with patch.object(MailService, "is_configured", return_value=False):
        # Admin posts internal comment AND shared comment on deal_1
        client.post(
            f"/api/custom-columns/deals/{d['deal_1']}/comments",
            headers=_hdr(d["main_admin"]),
            json={"text": "Internal risk note", "visibility": "internal"},
        )
        client.post(
            f"/api/custom-columns/deals/{d['deal_1']}/comments",
            headers=_hdr(d["main_admin"]),
            json={"text": "Shared next step", "visibility": "shared_with_owner"},
        )
        # Comment on deal_archived (missing from current active snapshot!)
        arch_r = client.post(
            f"/api/custom-columns/deals/{d['deal_archived']}/comments",
            headers=_hdr(d["kam_owner"]),
            json={"text": "Archive follow-up", "visibility": "shared_with_owner"},
        )
        MailService.wait_for_idle(timeout=5.0)
    assert arch_r.status_code == 200

    # Other KAM denied 403 on deal_1 comments, messages, recipients
    assert client.get(f"/api/custom-columns/deals/{d['deal_1']}/comments", headers=_hdr(d["other_kam"])).status_code == 403
    assert client.get(f"/api/messages/deal/{d['deal_1']}", headers=_hdr(d["other_kam"])).status_code == 403
    assert client.get(f"/api/messages/recipients?deal_id={d['deal_1']}", headers=_hdr(d["other_kam"])).status_code == 403

    # Owner KAM sees ONLY shared comment on own deal, NOT internal comment, and Admin masked as "Admin"
    kam_comments = client.get(f"/api/custom-columns/deals/{d['deal_1']}/comments", headers=_hdr(d["kam_owner"])).json()["comments"]
    texts = [c["text"] for c in kam_comments]
    assert "Shared next step" in texts
    assert "Internal risk note" not in texts
    for c in kam_comments:
        assert c["created_at"].endswith("Z")
        assert c["author"] == "Admin"

    # Management reads all comments on deal_1 including internal
    mgmt_comments = client.get(f"/api/custom-columns/deals/{d['deal_1']}/comments", headers=_hdr(d["mgmt_1"])).json()["comments"]
    assert len(mgmt_comments) == 2

    # Recipient picker hides individual admin names from KAM
    rec_kam = client.get(f"/api/messages/recipients?deal_id={d['deal_1']}", headers=_hdr(d["kam_owner"])).json()
    assert all(a["name"] == "Admin" for a in rec_kam["admins"])
    _assert_no_emails_in_payload(rec_kam, {d["main_admin"].email, d["mgmt_1"].email, d["kam_owner"].email})


def test_edit_unsend_history_and_unread_clear(env):
    client, SessionLocal, d = env
    send_count = {"n": 0}

    with patch.object(MailService, "is_configured", return_value=False):
        with patch.object(MailService, "submit_batch_async", side_effect=lambda *a, **kw: send_count.__setitem__("n", send_count["n"] + 1)):
            c_res = client.post(
                f"/api/custom-columns/deals/{d['deal_1']}/comments",
                headers=_hdr(d["kam_owner"]),
                json={"text": "Initial comment v1", "visibility": "shared_with_owner"},
            )
            m_res = client.post(
                "/api/messages",
                headers=_hdr(d["main_admin"]),
                json={
                    "deal_id": d["deal_1"],
                    "subject": "Edit test thread",
                    "body": "Initial message v1",
                    "recipient_ids": [d["kam_owner"].id],
                },
            )
            MailService.wait_for_idle(timeout=5.0)

    cid = c_res.json()["comment"]["id"]
    mid = m_res.json()["message_id"]
    initial_batches = send_count["n"]

    # Author edits own comment & message -> does NOT send new emails
    with patch.object(MailService, "submit_batch_async", side_effect=lambda *a, **kw: send_count.__setitem__("n", send_count["n"] + 1)):
        e_c = client.put(
            f"/api/custom-columns/deals/{d['deal_1']}/comments/{cid}",
            headers=_hdr(d["kam_owner"]),
            json={"text": "Edited comment v2", "visibility": "shared_with_owner"},
        )
        e_m = client.put(
            f"/api/messages/{mid}",
            headers=_hdr(d["main_admin"]),
            json={"body": "Edited message v2"},
        )
    assert e_c.status_code == 200
    assert e_c.json()["comment"]["edited_at"].endswith("Z")
    assert e_m.status_code == 200
    assert e_m.json()["message"]["edited_at"].endswith("Z")
    assert send_count["n"] == initial_batches  # No new emails on edit!

    # Non-author cannot edit someone else's comment or message
    assert client.put(
        f"/api/custom-columns/deals/{d['deal_1']}/comments/{cid}",
        headers=_hdr(d["mgmt_1"]),
        json={"text": "Hijacked"},
    ).status_code == 403
    assert client.put(
        f"/api/messages/{mid}",
        headers=_hdr(d["kam_owner"]),
        json={"body": "Hijacked"},
    ).status_code == 403

    # History is admin-only; non-participating admin denied for message history
    assert client.get(f"/api/custom-columns/deals/{d['deal_1']}/comments/{cid}/history", headers=_hdr(d["kam_owner"])).status_code == 403
    assert client.get(f"/api/custom-columns/deals/{d['deal_1']}/comments/{cid}/history", headers=_hdr(d["mgmt_1"])).status_code == 403
    assert client.get(f"/api/messages/{mid}/history", headers=_hdr(d["admin_b"])).status_code == 403

    hist_c = client.get(f"/api/custom-columns/deals/{d['deal_1']}/comments/{cid}/history", headers=_hdr(d["main_admin"]))
    assert hist_c.status_code == 200
    assert hist_c.json()["history"][0]["previous_text"] == "Initial comment v1"
    assert hist_c.json()["history"][0]["new_text"] == "Edited comment v2"

    # Admin removes KAM's comment; Author unsends own message -> tombstones + unread notifications cleared!
    del_c = client.delete(f"/api/custom-columns/deals/{d['deal_1']}/comments/{cid}", headers=_hdr(d["main_admin"]))
    del_m = client.delete(f"/api/messages/{mid}", headers=_hdr(d["main_admin"]))
    assert del_c.status_code == 200
    assert del_m.status_code == 200

    # Tombstone visible in comment & message lists
    c_list = client.get(f"/api/custom-columns/deals/{d['deal_1']}/comments", headers=_hdr(d["kam_owner"])).json()["comments"]
    m_list = client.get(f"/api/messages/deal/{d['deal_1']}", headers=_hdr(d["kam_owner"])).json()["messages"]
    assert any(c["id"] == cid and c["is_deleted"] is True and c["text"] == "This message was removed" for c in c_list)
    assert any(m["id"] == mid and m["is_deleted"] is True and m["body"] == "This message was removed" for m in m_list)

    # Unread notifications cleared for removed items
    kam_unread = client.get("/api/notifications?category=unread", headers=_hdr(d["kam_owner"])).json()["notifications"]
    assert all(n.get("target_id") not in (cid, mid) for n in kam_unread)


def test_50_recipients_single_reused_smtp_connection_returns_under_1_second(env):
    client, SessionLocal, d = env
    fifty_users = []
    with SessionLocal() as db:
        for i in range(50):
            u = User(
                id=str(uuid.uuid4()),
                email=f"bulk-{i}@example.test",
                name=f"Bulk User {i}",
                role="management",
                status="active",
                is_owner=False,
            )
            fifty_users.append(u)
        db.add_all(fifty_users)
        db.commit()

    conn_stats = {"opened": 0, "sent": 0, "greetings": []}

    class SlowSingleConnSMTP:
        def __init__(self, *a, **kw):
            conn_stats["opened"] += 1
            time.sleep(0.25)  # Simulates slow 220 banner greet
        def ehlo(self): pass
        def starttls(self, **kw): pass
        def login(self, *a, **kw): pass
        def sendmail(self, frm, to_addrs, raw_msg):
            addrs = to_addrs if isinstance(to_addrs, list) else [to_addrs]
            conn_stats["sent"] += len(addrs)
            conn_stats["greetings"].append(str(raw_msg).splitlines()[-4:])
        def send_message(self, msg, from_addr=None, to_addrs=None):
            conn_stats["sent"] += 1
            conn_stats["greetings"].append(msg.as_string().splitlines()[-4:])
        def quit(self): pass

    with (
        patch.object(MailService, "is_configured", return_value=True),
        patch("backend.services.mail_service.settings.TESTING", False),
        patch("backend.services.mail_service.settings.SMTP_HOST", "slow-relay.example.test"),
        patch("backend.services.mail_service.settings.MAIL_FROM", "noreply@example.test"),
        patch("smtplib.SMTP", SlowSingleConnSMTP),
    ):
        t0 = time.monotonic()
        resp = client.post(
            f"/api/custom-columns/deals/{d['deal_1']}/comments",
            headers=_hdr(d["main_admin"]),
            json={
                "text": "Quarterly wrap-up for 50 stakeholders",
                "visibility": "shared_with_owner",
                "recipient_ids": ["group:management"],
            },
        )
        elapsed = time.monotonic() - t0
        MailService.wait_for_idle(timeout=15.0)

    assert resp.status_code == 200
    assert elapsed < 1.0, f"API took {elapsed:.3f}s (>= 1.0s) for 50+ recipients"
    assert conn_stats["opened"] == 1, f"Expected 1 reused SMTP connection, opened {conn_stats['opened']}"
    # 50 bulk + mgmt_1 = 51 emails delivered on that 1 connection
    assert conn_stats["sent"] >= 50

    log_ev = client.get("/api/messages/email-log", headers=_hdr(d["main_admin"])).json()["log"][0]
    assert log_ev["sent_count"] >= 50
    assert log_ev["failed_count"] == 0


def test_alembic_migration_0013_sql_upgrade_check():
    """Verify migration 0013 adds required tables/columns on an isolated temp DB (never touches renewals.db)."""
    from alembic import command
    from alembic.config import Config

    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tf:
        db_path = tf.name
    try:
        url = f"sqlite:///{db_path}"
        cfg = Config("alembic.ini")
        cfg.set_main_option("sqlalchemy.url", url)
        # Upgrade clean DB to 0012 then upgrade 0012 -> head (0013)
        command.upgrade(cfg, "0012")
        command.upgrade(cfg, "head")

        eng = create_engine(url)
        insp = inspect(eng)
        assert "comment_message_history" in insp.get_table_names()
        assert "message_read_receipts" in insp.get_table_names()
        assert "email_delivery_events" in insp.get_table_names()
        dc_cols = {c["name"] for c in insp.get_columns("deal_comments")}
        dm_cols = {c["name"] for c in insp.get_columns("deal_messages")}
        assert {"edited_at", "deleted_at", "deleted_by", "deleted_by_name"} <= dc_cols
        assert {"edited_at", "is_deleted", "deleted_at", "deleted_by", "deleted_by_name"} <= dm_cols
        eng.dispose()
    finally:
        if os.path.exists(db_path):
            os.remove(db_path)
