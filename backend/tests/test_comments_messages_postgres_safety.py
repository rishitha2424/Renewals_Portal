"""
Targeted PostgreSQL safety & 503 vs 500 regression tests for:
- GET /api/comments/log (every frontend filter combination & role)
- GET /api/messages/threads, /api/messages/deal/{id}, /api/messages/email-log, /api/messages/recipients
- GET /api/notifications, GET /api/admin/email/outbox
- Strict schema-only 503 ("missing: <table.column>") vs 500 + real exception logging (no emails/secrets).
"""
from __future__ import annotations

import json
import logging
import os
import re
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import Session, sessionmaker

from backend.database import Base, get_db
from backend.main import app
from backend.models.custom_column import DealComment
from backend.models.opportunity import Opportunity
from backend.models.snapshot import UploadSnapshot
from backend.models.user import DealMessage, EmailDeliveryEvent, EmailOutbox, Notification, User
from backend.services.auth_service import hash_password, sign_session_token


def _seed_env(engine):
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSession()

    admin = User(
        id=str(uuid.uuid4()),
        email="admin.pg@example.com",
        name="PG Admin",
        role="admin",
        status="active",
        password_hash=hash_password("Pass123!"),
        is_owner=True,
    )
    mgmt = User(
        id=str(uuid.uuid4()),
        email="mgmt.pg@example.com",
        name="PG Management",
        role="management",
        status="active",
        password_hash=hash_password("Pass123!"),
    )
    kam = User(
        id=str(uuid.uuid4()),
        email="kam.pg@example.com",
        name="PG KAM",
        role="kam",
        owner_name="PG KAM Owner",
        status="active",
        password_hash=hash_password("Pass123!"),
    )
    db.add_all([admin, mgmt, kam])
    db.flush()

    snap = UploadSnapshot(
        id=str(uuid.uuid4()),
        label="Today",
        snapshot_date=date(2026, 11, 20),
        uploaded_by="test",
        is_active_today=True,
        row_count=2,
        active_row_count=2,
    )
    db.add(snap)
    db.flush()

    opp1 = Opportunity(
        id=str(uuid.uuid4()),
        snapshot_id=snap.id,
        opportunity_id_18="006PG0000000000001",
        opportunity_name="Alpha Renewal",
        account_name="Alpha Corp",
        opportunity_owner="PG KAM Owner",
        forecast_category="Commit",
        forecast_acv_amount=Decimal("50000.00"),
        close_date=date(2026, 11, 25),
        approval_status="Approved",
        sales_type="Renewals",
        fiscal_period="Q4-2026",
        is_deleted_or_lost=False,
        is_reconciliation_entry=False,
    )
    opp2 = Opportunity(
        id=str(uuid.uuid4()),
        snapshot_id=snap.id,
        opportunity_id_18="006PG0000000000002",
        opportunity_name="Beta Renewal",
        account_name="Beta LLC",
        opportunity_owner="Other Owner",
        forecast_category="Pipeline",
        forecast_acv_amount=Decimal("25000.00"),
        close_date=date(2026, 11, 28),
        approval_status="Blank",
        sales_type="Renewals",
        fiscal_period="Q4-2026",
        is_deleted_or_lost=False,
        is_reconciliation_entry=False,
    )
    db.add_all([opp1, opp2])

    c1 = DealComment(
        id=str(uuid.uuid4()),
        opportunity_id_18=opp1.opportunity_id_18,
        author=admin.name,
        author_id=admin.id,
        author_role="admin",
        text="Shared comment on Alpha",
        visibility="shared_with_owner",
        recipient_ids=json.dumps([kam.id, mgmt.id]),
        is_deleted=False,
        created_at=datetime(2026, 11, 20, 10, 0, tzinfo=timezone.utc).replace(tzinfo=None),
    )
    c2 = DealComment(
        id=str(uuid.uuid4()),
        opportunity_id_18=opp2.opportunity_id_18,
        author=mgmt.name,
        author_id=mgmt.id,
        author_role="management",
        text="Internal note on Beta",
        visibility="internal",
        recipient_ids=json.dumps([admin.id]),
        is_deleted=False,
        created_at=datetime(2026, 11, 20, 11, 0, tzinfo=timezone.utc).replace(tzinfo=None),
    )
    c3 = DealComment(
        id=str(uuid.uuid4()),
        opportunity_id_18=opp1.opportunity_id_18,
        author=kam.name,
        author_id=kam.id,
        author_role="kam",
        text="Original KAM note",
        visibility="shared_with_owner",
        recipient_ids=json.dumps([admin.id, mgmt.id]),
        is_deleted=True,
        deleted_at=datetime(2026, 11, 20, 12, 0, tzinfo=timezone.utc).replace(tzinfo=None),
        created_at=datetime(2026, 11, 20, 11, 30, tzinfo=timezone.utc).replace(tzinfo=None),
    )
    db.add_all([c1, c2, c3])

    msg = DealMessage(
        id=str(uuid.uuid4()),
        deal_id=opp1.opportunity_id_18,
        sender_id=admin.id,
        sender_name=admin.name,
        sender_role="admin",
        recipient_id=kam.id,
        recipient_name=kam.name,
        recipient_ids=json.dumps([kam.id, mgmt.id]),
        subject="Renewal check-in",
        body="Checking status on Alpha",
        is_deleted=False,
        created_at=datetime(2026, 11, 20, 12, 5, tzinfo=timezone.utc).replace(tzinfo=None),
    )
    msg.thread_id = msg.id
    db.add(msg)

    ev = EmailDeliveryEvent(
        id=str(uuid.uuid4()),
        event_type="comment",
        entity_type="deal_comment",
        entity_id=c1.id,
        deal_id=opp1.opportunity_id_18,
        deal_name=opp1.opportunity_name,
        author_id=admin.id,
        author_name=admin.name,
        author_role="admin",
        subject="New comment: Alpha Renewal",
        body_preview="Shared comment on Alpha",
        recipient_summary="PG KAM, PG Management",
        selected_recipient_ids=json.dumps([kam.id, mgmt.id]),
        total_count=2,
        sent_count=2,
        failed_count=0,
        skipped_count=0,
    )
    ob = EmailOutbox(
        id=str(uuid.uuid4()),
        event_id=ev.id,
        recipient_user_id=kam.id,
        sender_id=admin.id,
        recipient_email=kam.email,
        recipient_name=kam.name,
        recipient_role="kam",
        sender_name=admin.name,
        sender_role="admin",
        deal_id=opp1.opportunity_id_18,
        deal_name=opp1.opportunity_name,
        subject="New comment: Alpha Renewal",
        body_html="<p>Shared</p>",
        body_text="Shared",
        template_type="comment",
        status="sent",
    )
    notif = Notification(
        id=str(uuid.uuid4()),
        user_id=kam.id,
        category="comment",
        title="New comment from Admin",
        message="Shared comment on Alpha",
        deal_id=opp1.opportunity_id_18,
        deal_name=opp1.opportunity_name,
        target_type="deal_comment",
        target_id=c1.id,
        is_read=False,
    )
    db.add_all([ev, ob, notif])
    db.commit()

    tokens = {
        "admin": sign_session_token(admin),
        "management": sign_session_token(mgmt),
        "kam": sign_session_token(kam),
    }
    snap_id = snap.id
    opp1_id = opp1.opportunity_id_18
    db.close()
    return TestingSession, tokens, snap_id, opp1_id


def _assert_pg_safe_sql(compiled_sql: str, params: dict) -> None:
    low = compiled_sql.lower()
    for bad in ("json_extract", "pragma", "group_concat", "sqlite_master", "ifnull("):
        assert bad not in low, f"SQLite-only construct '{bad}' found in query:\n{compiled_sql}"
    # Guard against integer 0/1 literals compared against boolean columns
    for bool_col in ("is_deleted", "is_read", "is_active_today", "is_deleted_or_lost", "is_reconciliation_entry"):
        assert not re.search(rf"\b{bool_col}\b\s*=\s*[01]\b", low), (
            f"Integer literal compared to boolean column '{bool_col}' in SQL:\n{compiled_sql}"
        )
    # Specifically verify snapshot_date is NEVER compared directly against a non-date string (e.g. UUID)
    if "upload_snapshots.snapshot_date =" in low:
        for k, v in (params or {}).items():
            if "snapshot_date" in k and isinstance(v, str) and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
                raise AssertionError(
                    f"Non-date string {v!r} bound to upload_snapshots.snapshot_date comparison:\n{compiled_sql}"
                )


def test_compile_all_queries_postgresql_dialect_and_all_filters(tmp_path):
    """Compile every query executed across comments/messages/email-log/notifications with PostgreSQL dialect."""
    db_file = tmp_path / "pg_safety.db"
    engine = create_engine(f"sqlite:///{db_file.as_posix()}", connect_args={"check_same_thread": False})
    TestingSession, tokens, snap_id, opp1_id = _seed_env(engine)

    pg_dialect = postgresql.dialect()
    compiled_queries: list[str] = []

    def _on_orm_execute(orm_execute_state):
        stmt = orm_execute_state.statement
        compiled = stmt.compile(dialect=pg_dialect)
        sql_str = str(compiled)
        _assert_pg_safe_sql(sql_str, dict(compiled.params or {}))
        compiled_queries.append(sql_str)

    def _override_db():
        s = TestingSession()
        try:
            yield s
        finally:
            s.close()

    listener_Target = Session
    event.listen(listener_Target, "do_orm_execute", _on_orm_execute)
    app.dependency_overrides[get_db] = _override_db
    try:
        client = TestClient(app)
        # Every filter combination the frontend can send across admin, management, kam, PLUS bare no-filter call
        filter_combos = [
            "",
            f"page=1&page_size=20&tab=my&limit_to_period=false&period=current_quarter&as_of={snap_id}&include_deleted_lost=false&types=all",
            f"page=1&page_size=20&tab=all&limit_to_period=false&period=current_quarter&as_of={snap_id}&include_deleted_lost=false&types=all",
            f"page=1&page_size=20&tab=all&search=Alpha&visibility=shared&author=Admin&author_role=admin&start_date=2026-11-01&end_date=2026-11-30&limit_to_period=true&period=current_quarter&as_of={snap_id}&include_deleted_lost=false&types=all",
            f"page=1&page_size=20&tab=all&visibility=internal&deal=Alpha&account=Alpha&start_date=2026-11-01T00:00:00Z&end_date=2026-11-30T23:59:59Z&limit_to_period=true&period=FY2026&as_of=2026-11-20&types=all",
            f"page=1&page_size=20&tab=all&search=NoMatchXYZ&deal=NoMatchDeal&account=NoMatchAcct&limit_to_period=true&period=Q1-2026&as_of={snap_id}",
        ]
        for role_name, tok in tokens.items():
            headers = {"Authorization": f"Bearer {tok}"}
            for qs in filter_combos:
                url = f"/api/comments/log?{qs}" if qs else "/api/comments/log"
                r = client.get(url, headers=headers)
                assert r.status_code == 200, f"role={role_name} qs={qs} returned {r.status_code}: {r.text}"

            # Messages & email log & notifications
            assert client.get("/api/messages/recipients", headers=headers).status_code == 200
            assert client.get("/api/messages/email-log?limit=50", headers=headers).status_code == 200
            assert client.get("/api/messages/threads?q=Alpha&thread_status=open", headers=headers).status_code == 200
            assert client.get(f"/api/messages/deal/{opp1_id}", headers=headers).status_code == 200
            assert client.get("/api/notifications?category=all&limit=50", headers=headers).status_code == 200

        # Admin email outbox & diagnostics
        adm_headers = {"Authorization": f"Bearer {tokens['admin']}"}
        assert client.get("/api/admin/email/outbox", headers=adm_headers).status_code == 200
        assert len(compiled_queries) > 20
    finally:
        app.dependency_overrides.clear()
        event.remove(listener_Target, "do_orm_execute", _on_orm_execute)
        engine.dispose()


def test_query_error_returns_500_and_logs_without_secrets_or_emails(tmp_path, caplog):
    """A genuine SQL runtime error (even one containing 'does not exist' or an email) must return 500 and log cleanly, NOT 503."""
    db_file = tmp_path / "err500.db"
    engine = create_engine(f"sqlite:///{db_file.as_posix()}", connect_args={"check_same_thread": False})
    TestingSession, tokens, snap_id, _ = _seed_env(engine)

    def _override_db():
        s = TestingSession()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _override_db
    caplog.set_level(logging.ERROR, logger="backend.services.schema_check")
    try:
        client = TestClient(app)
        adm_headers = {"Authorization": f"Bearer {tokens['admin']}"}
        fake_err = ProgrammingError(
            "SELECT * FROM upload_snapshots",
            {},
            Exception("operator does not exist for user secret.user@example.com"),
        )
        with patch("backend.routers.comments._execute_comments_log_query", side_effect=fake_err):
            r = client.get(
                f"/api/comments/log?tab=all&as_of={snap_id}&limit_to_period=false&types=all",
                headers=adm_headers,
            )
            assert r.status_code == 500
            assert "migration" not in r.json()["detail"].lower()

        assert "Database error on GET /api/comments/log [ProgrammingError]" in caplog.text
        assert "secret.user@example.com" not in caplog.text
        assert "[redacted-email]" in caplog.text
        assert "limit_to_period" in caplog.text
    finally:
        app.dependency_overrides.clear()
        engine.dispose()


def test_missing_column_returns_503_listing_missing_names(tmp_path):
    """When schema actually lacks a required column, GET /api/comments/log returns 503 naming the missing column(s)."""
    db_file = tmp_path / "missing_col.db"
    engine = create_engine(f"sqlite:///{db_file.as_posix()}", connect_args={"check_same_thread": False})
    TestingSession, tokens, snap_id, _ = _seed_env(engine)
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE deal_comments DROP COLUMN edited_at"))

    def _override_db():
        s = TestingSession()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _override_db
    try:
        client = TestClient(app)
        r = client.get(
            f"/api/comments/log?tab=my&as_of={snap_id}&types=all",
            headers={"Authorization": f"Bearer {tokens['admin']}"},
        )
        assert r.status_code == 503
        detail = r.json()["detail"]
        assert "Database needs migration: run alembic upgrade head" in detail
        assert "deal_comments.edited_at" in detail
    finally:
        app.dependency_overrides.clear()
        engine.dispose()


def test_schema_health_and_comments_guard_parity_across_binds_and_pg_schemas(tmp_path):
    """
    Verify check_schema_health(engine) and comments.py's pre-flight guard (ensure_schema_ready)
    use the exact same schema contract & resolution across Engine, Connection, and Session binds,
    including PostgreSQL fallback schema / case normalization.
    """
    from backend.services.schema_check import check_schema_health, ensure_schema_ready

    db_file = tmp_path / "parity.db"
    engine = create_engine(f"sqlite:///{db_file.as_posix()}", connect_args={"check_same_thread": False})
    TestingSession, tokens, _, _ = _seed_env(engine)
    try:
        # 1. Engine vs Connection vs Session bind must all report zero missing items
        h_engine = check_schema_health(engine, check_alembic=False)
        with engine.connect() as conn:
            h_conn = check_schema_health(conn, check_alembic=False)
        s = TestingSession()
        try:
            h_session = check_schema_health(s.get_bind(), check_alembic=False)
            assert ensure_schema_ready(s.get_bind())["needs_migration"] is False
        finally:
            s.close()

        assert h_engine["missing_tables"] == h_conn["missing_tables"] == h_session["missing_tables"] == []
        assert h_engine["missing_columns"] == h_conn["missing_columns"] == h_session["missing_columns"] == []

        # 2. Drop a required email_outbox column (deal_id) that previously diverged between
        # REQUIRED_TABLES and COMMENTS_REQUIRED_TABLES: both check_schema_health and GET /api/comments/log
        # must now report the exact same missing column.
        with engine.begin() as conn:
            conn.execute(text("DROP INDEX IF EXISTS ix_email_outbox_deal_id"))
            conn.execute(text("ALTER TABLE email_outbox DROP COLUMN deal_id"))

        after_drop = check_schema_health(engine, check_alembic=False)
        assert "email_outbox.deal_id" in after_drop["missing_columns"]

        def _override_db():
            db = TestingSession()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = _override_db
        client = TestClient(app)
        r = client.get("/api/comments/log", headers={"Authorization": f"Bearer {tokens['admin']}"})
        assert r.status_code == 503
        assert "email_outbox.deal_id" in r.json()["detail"]

        # 3. Simulated PostgreSQL schema fallback when default_schema_name differs from table schema
        class _FakeInspector:
            default_schema_name = "custom_app_schema"

            def clear_cache(self):
                pass

            def get_table_names(self, schema=None):
                if schema == "public":
                    return [
                        "users",
                        "deal_comments",
                        "deal_messages",
                        "email_outbox",
                        "comment_message_history",
                        "message_read_receipts",
                        "email_delivery_events",
                        "notifications",
                    ]
                return []

            def get_schema_names(self):
                return ["custom_app_schema", "public"]

            def get_columns(self, table_name, schema=None):
                from backend.services.schema_check import REQUIRED_TABLES
                return [{"name": col.upper()} for col in REQUIRED_TABLES.get(table_name.lower(), set())]

        class _FakeDialect:
            name = "postgresql"

        class _FakeEngine:
            dialect = _FakeDialect()

            def connect(self):
                raise RuntimeError("no network")

        with patch("backend.services.schema_check.inspect", return_value=_FakeInspector()):
            pg_res = check_schema_health(_FakeEngine(), check_alembic=False)
            assert pg_res["needs_migration"] is False
            assert pg_res["missing_tables"] == []
            assert pg_res["missing_columns"] == []
            assert ensure_schema_ready(_FakeEngine())["needs_migration"] is False
    finally:
        app.dependency_overrides.clear()
        engine.dispose()


@pytest.mark.skipif(
    not (os.environ.get("TEST_DATABASE_URL", "").startswith("postgresql")),
    reason="TEST_DATABASE_URL not set to a PostgreSQL database",
)
def test_live_postgresql_comments_messages_email_log():
    """Optional live PostgreSQL run when TEST_DATABASE_URL points to PostgreSQL."""
    from backend.services.schema_check import check_schema_health, ensure_schema_ready

    pg_url = os.environ["TEST_DATABASE_URL"]
    engine = create_engine(pg_url)
    TestingSession, tokens, snap_id, opp1_id = _seed_env(engine)

    # Verify unified schema guard passes identically on PG Engine and Session bind
    pg_health = check_schema_health(engine, check_alembic=False)
    assert pg_health["needs_migration"] is False, pg_health

    def _override_db():
        s = TestingSession()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _override_db
    try:
        s = TestingSession()
        try:
            assert ensure_schema_ready(s.get_bind())["missing_columns"] == []
        finally:
            s.close()

        client = TestClient(app)
        for role_name, tok in tokens.items():
            headers = {"Authorization": f"Bearer {tok}"}
            # Both bare /api/comments/log (no filters) and full query params
            r_bare = client.get("/api/comments/log", headers=headers)
            assert r_bare.status_code == 200, f"PG bare failed for {role_name}: {r_bare.text}"
            r = client.get(
                f"/api/comments/log?page=1&page_size=20&tab=all&limit_to_period=false&period=current_quarter&as_of={snap_id}&include_deleted_lost=false&types=all",
                headers=headers,
            )
            assert r.status_code == 200, f"PG live failed for {role_name}: {r.text}"
            assert client.get("/api/messages/email-log", headers=headers).status_code == 200
            assert client.get("/api/messages/threads", headers=headers).status_code == 200
    finally:
        app.dependency_overrides.clear()
        engine.dispose()

