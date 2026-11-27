"""
Targeted tests for:
- Comments Log: admin, management, KAM (own deals only), empty log, removed tombstones, and unmigrated (pre-0013) DB error + diagnostics
- Startup / health / diagnostics reporting "Database needs migration: run alembic upgrade head"
- Background delivery DB session cleanup (zero leaked sessions/connections after N sends)
- Slow request timing log warning
"""
from __future__ import annotations

import logging
import os
import tempfile
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from unittest.mock import patch

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.database import Base, get_db
from backend.main import app
from backend.models.custom_column import DealComment
from backend.models.opportunity import Opportunity
from backend.models.snapshot import UploadSnapshot
from backend.models.user import User
from backend.services.auth_service import sign_session_token
from backend.services.delivery_service import run_post_commit_delivery
from backend.services.mail_service import MailService
from backend.services.schema_check import check_schema_health


def _make_env():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    SL = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_get_db():
        db = SL()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    return engine, SL


def _seed(db):
    admin = User(id=str(uuid.uuid4()), email="adm@example.test", name="Admin One", role="admin", status="active", is_owner=True)
    mgmt = User(id=str(uuid.uuid4()), email="mg@example.test", name="Mgmt One", role="management", status="active")
    kam1 = User(id=str(uuid.uuid4()), email="k1@example.test", name="Kam One", role="kam", status="active", owner_name="Kam One")
    kam2 = User(id=str(uuid.uuid4()), email="k2@example.test", name="Kam Two", role="kam", status="active", owner_name="Kam Two")
    snap = UploadSnapshot(id=str(uuid.uuid4()), label="Today", snapshot_date=date(2026, 2, 1), workbook_type="BOTH", is_active_today=True)
    db.add_all([admin, mgmt, kam1, kam2, snap])
    db.flush()

    opp1 = Opportunity(
        id=str(uuid.uuid4()),
        snapshot_id=snap.id,
        opportunity_id_18="006LOG00000000001",
        opportunity_name="Alpha Renewal",
        account_name="Alpha Co",
        opportunity_owner="Kam One",
        forecast_acv_amount=Decimal("25000"),
    )
    opp2 = Opportunity(
        id=str(uuid.uuid4()),
        snapshot_id=snap.id,
        opportunity_id_18="006LOG00000000002",
        opportunity_name="Beta Renewal",
        account_name="Beta Co",
        opportunity_owner="Kam Two",
        forecast_acv_amount=Decimal("40000"),
    )
    db.add_all([opp1, opp2])
    db.commit()
    return {"admin": admin, "mgmt": mgmt, "kam1": kam1, "kam2": kam2, "opp1": opp1.opportunity_id_18, "opp2": opp2.opportunity_id_18}


def _hdr(u: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {sign_session_token(u)}"}


def test_comments_log_empty_and_role_visibility_with_removed_items():
    eng, SL = _make_env()
    try:
        db = SL()
        d = _seed(db)
        c = TestClient(app)

        # 1. Empty log works cleanly for all roles
        for role_u in (d["admin"], d["mgmt"], d["kam1"]):
            for tab in ("my", "all"):
                r = c.get(f"/api/comments/log?tab={tab}", headers=_hdr(role_u))
                assert r.status_code == 200
                body = r.json()
                assert body["items"] == []
                assert body["total"] == 0

        # 2. Seed shared, internal, other-KAM, and removed (tombstone) comments
        db.add_all([
            DealComment(
                id="c-shared-k1",
                opportunity_id_18=d["opp1"],
                author="Admin One",
                author_id=d["admin"].id,
                author_role="admin",
                text="Shared update for Kam One",
                visibility="shared_with_owner",
            ),
            DealComment(
                id="c-internal-k1",
                opportunity_id_18=d["opp1"],
                author="Admin One",
                author_id=d["admin"].id,
                author_role="admin",
                text="Internal note on Alpha",
                visibility="internal",
            ),
            DealComment(
                id="c-shared-k2",
                opportunity_id_18=d["opp2"],
                author="Kam Two",
                author_id=d["kam2"].id,
                author_role="kam",
                text="Private to Kam Two",
                visibility="shared_with_owner",
            ),
            DealComment(
                id="c-removed-k1",
                opportunity_id_18=d["opp1"],
                author="Kam One",
                author_id=d["kam1"].id,
                author_role="kam",
                text="[original secret text]",
                is_deleted=True,
                deleted_at=datetime.now(timezone.utc),
                visibility="shared_with_owner",
            ),
        ])
        db.commit()

        # Admin sees all 4 items
        adm_all = c.get("/api/comments/log?tab=all", headers=_hdr(d["admin"])).json()
        assert adm_all["total"] == 4
        removed_item = next(i for i in adm_all["items"] if i["id"] == "c-removed-k1")
        assert removed_item["is_deleted"] is True
        assert removed_item["text"] == "This message was removed"

        # Management sees all 4 deals' comments, with Admin author masked as "Admin"
        mgmt_all = c.get("/api/comments/log?tab=all", headers=_hdr(d["mgmt"])).json()
        assert mgmt_all["total"] == 4
        alpha_shared = next(i for i in mgmt_all["items"] if i["id"] == "c-shared-k1")
        assert alpha_shared["author"] == "Admin"

        # KAM1 sees ONLY own deal (opp1) non-internal comments (c-shared-k1 and tombstone c-removed-k1)
        kam1_all = c.get("/api/comments/log?tab=all", headers=_hdr(d["kam1"])).json()
        kam1_ids = {i["id"] for i in kam1_all["items"]}
        assert kam1_ids == {"c-shared-k1", "c-removed-k1"}
        assert "c-internal-k1" not in kam1_ids
        assert "c-shared-k2" not in kam1_ids
        assert next(i for i in kam1_all["items"] if i["id"] == "c-shared-k1")["author"] == "Admin"

        # History endpoint remains strictly admin-only
        assert c.get("/api/comments/c-removed-k1/history", headers=_hdr(d["mgmt"])).status_code == 403
        assert c.get("/api/comments/c-removed-k1/history", headers=_hdr(d["kam1"])).status_code == 403
        assert c.get("/api/comments/c-removed-k1/history", headers=_hdr(d["admin"])).status_code == 200

        db.close()
    finally:
        app.dependency_overrides.clear()
        eng.dispose()


def test_comments_log_and_diagnostics_report_missing_migration_clearly():
    """Against a pre-0013 DB (0012), schema_check, /health/db, and /comments/log report the clear migration error."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tf:
        db_path = tf.name
    eng = None
    try:
        url = f"sqlite:///{db_path}"
        cfg = Config("alembic.ini")
        cfg.set_main_option("sqlalchemy.url", url)
        command.upgrade(cfg, "0012")

        eng = create_engine(url, connect_args={"check_same_thread": False})
        # Add only users SSO columns to isolate 0013 comments columns/tables missing
        from sqlalchemy import text
        with eng.begin() as conn:
            conn.execute(text("ALTER TABLE users ADD COLUMN last_sso_login DATETIME"))
            conn.execute(text("ALTER TABLE users ADD COLUMN sso_provider VARCHAR(64)"))

        status_info = check_schema_health(eng, check_alembic=True)
        assert status_info["needs_migration"] is True
        assert status_info["comments_ready"] is False
        assert "Database needs migration: run alembic upgrade head" in status_info["message"]

        SL = sessionmaker(autocommit=False, autoflush=False, bind=eng)
        db = SL()
        adm = User(id=str(uuid.uuid4()), email="adm@ex.test", name="Adm", role="admin", status="active", is_owner=True)
        db.add(adm)
        db.commit()
        tok = sign_session_token(adm)
        db.close()

        def ov():
            s = SL()
            try:
                yield s
            finally:
                s.close()

        app.dependency_overrides[get_db] = ov
        c = TestClient(app)

        # /api/comments/log returns friendly 503 with exact migration instructions instead of 500 traceback
        r_log = c.get("/api/comments/log?tab=all", headers={"Authorization": f"Bearer {tok}"})
        assert r_log.status_code == 503
        assert "Database needs migration: run alembic upgrade head" in r_log.json()["detail"]

        # /api/health/db and admin diagnostics expose needs_migration cleanly
        r_health = c.get("/api/health/db", headers={"Authorization": f"Bearer {tok}"})
        assert r_health.status_code == 200
        assert r_health.json()["needs_migration"] is True
        assert "alembic upgrade head" in r_health.json()["error"]

        r_diag = c.get("/api/admin/email/diagnostics", headers={"Authorization": f"Bearer {tok}"})
        assert r_diag.status_code == 200
        assert r_diag.json()["needs_migration"] is True
        assert "alembic upgrade head" in r_diag.json()["migration_message"]

        # Upgrading to head brings check_schema_health to parity (at_head=True, needs_migration=False)
        command.upgrade(cfg, "head")
        head_info = check_schema_health(eng, check_alembic=True)
        assert head_info["needs_migration"] is False
        assert head_info["comments_ready"] is True
    finally:
        app.dependency_overrides.clear()
        if eng is not None:
            eng.dispose()
        if os.path.exists(db_path):
            os.remove(db_path)


def test_background_delivery_closes_all_db_connections():
    """Verify background fan-out & batch mail workers never leak checked-out DB connections."""
    eng, SL = _make_env()
    try:
        db = SL()
        d = _seed(db)
        admin_id, admin_name, admin_email = d["admin"].id, d["admin"].name, d["admin"].email
        mgmt_id, kam1_id = d["mgmt"].id, d["kam1"].id
        opp1_id = d["opp1"]
        db.close()

        checked_out = {"count": 0}

        @event.listens_for(eng, "checkout")
        def _on_checkout(dbapi_conn, conn_record, conn_proxy):
            checked_out["count"] += 1

        @event.listens_for(eng, "checkin")
        def _on_checkin(dbapi_conn, conn_record):
            checked_out["count"] -= 1

        with patch.object(MailService, "is_configured", return_value=False):
            for i in range(5):
                run_post_commit_delivery(
                    bind_engine=eng,
                    event_type="comment",
                    entity_type="deal_comment",
                    entity_id=f"c-{i}",
                    author_id=admin_id,
                    author_name=admin_name,
                    author_role="admin",
                    author_email=admin_email,
                    subject=f"Comment {i}",
                    body_text="Check session close",
                    deal_id=opp1_id,
                    deal_name="Alpha Renewal",
                    account_name="Alpha Co",
                    acv_amount=25000.0,
                    recipient_user_ids=[mgmt_id, kam1_id],
                    recipient_summary="Mgmt One, Kam One",
                    audit_event_type="comment_created",
                    audit_details={"i": i},
                )
            MailService.wait_for_idle(timeout=5.0)

        assert checked_out["count"] == 0, f"Leaked {checked_out['count']} checked-out DB connections"
    finally:
        app.dependency_overrides.clear()
        eng.dispose()


def test_slow_request_timing_middleware_logs_warning():
    eng, SL = _make_env()
    try:
        c = TestClient(app)
        logged = []
        with (
            patch("backend.main.settings.SLOW_REQUEST_LOG_SECONDS", 0.0),
            patch("backend.main.log.warning", side_effect=lambda *a, **kw: logged.append(a[0] % a[1:] if len(a) > 1 else str(a[0]))),
        ):
            r = c.get("/api/health")
        assert r.status_code == 200
        assert any("Slow request:" in msg and "/api/health" in msg for msg in logged)
    finally:
        app.dependency_overrides.clear()
        eng.dispose()
