import pytest
from datetime import datetime
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.database import Base, get_db
from backend.main import app
from backend.models import (
    User,
    Opportunity,
    UploadSnapshot,
    CustomColumn,
    DealAnnotation,
    DealComment,
    AnnotationAudit,
)
from backend.services.auth_service import sign_session_token
from backend.services.annotation_service import AnnotationService
from backend.services.context import UserContext


from sqlalchemy.pool import StaticPool


@pytest.fixture
def test_db_session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client_and_users(test_db_session):
    engine = test_db_session.get_bind()
    TestingSessionLocal = sessionmaker(bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db

    # Create admin, management, and kam users
    admin_user = User(
        name="Admin User",
        email="admin@example.com",
        role="admin",
        status="active",
        is_owner=True,
    )
    mgmt_user = User(
        name="Management Lead",
        email="mgmt@mobileum.com",
        role="management",
        status="active",
    )
    kam_user = User(
        name="Gabriel Camarena",
        email="gabriel@mobileum.com",
        role="kam",
        owner_name="Gabriel Camarena",
        status="active",
    )
    other_kam = User(
        name="Esteban Aguerre",
        email="esteban@mobileum.com",
        role="kam",
        owner_name="Esteban Aguerre",
        status="active",
    )
    test_db_session.add_all([admin_user, mgmt_user, kam_user, other_kam])
    test_db_session.flush()

    admin_token = sign_session_token(admin_user)
    mgmt_token = sign_session_token(mgmt_user)
    kam_token = sign_session_token(kam_user)
    other_kam_token = sign_session_token(other_kam)

    # Create snapshot and deals
    snap = UploadSnapshot(snapshot_date=datetime.now().date(), label="Test Snapshot", is_active_today=True)
    test_db_session.add(snap)
    test_db_session.flush()

    deal1 = Opportunity(
        snapshot_id=snap.id,
        opportunity_id_18="006Qp00000Gabriel1",
        opportunity_name="Gabriel Renewal Deal",
        account_name="Telefonica",
        sales_type="Renewals",
        is_deleted_or_lost=False,
        is_reconciliation_entry=False,
        forecast_category="Commit",
        forecast_acv_amount=150000.0,
        opportunity_owner="Gabriel Camarena",
        business_unit_primary="Roaming",
    )
    deal2 = Opportunity(
        snapshot_id=snap.id,
        opportunity_id_18="006Qp00000Esteban1",
        opportunity_name="Esteban Renewal Deal",
        account_name="Telecom Argentina",
        sales_type="Renewals",
        is_deleted_or_lost=False,
        is_reconciliation_entry=False,
        forecast_category="Commit",
        forecast_acv_amount=200000.0,
        opportunity_owner="Esteban Aguerre",
        business_unit_primary="Roaming",
    )
    test_db_session.add_all([deal1, deal2])
    test_db_session.commit()

    test_client = TestClient(app)

    yield {
        "client": test_client,
        "db": test_db_session,
        "admin": admin_user,
        "mgmt": mgmt_user,
        "kam": kam_user,
        "other_kam": other_kam,
        "admin_token": admin_token,
        "mgmt_token": mgmt_token,
        "kam_token": kam_token,
        "other_kam_token": other_kam_token,
        "deal1": deal1,
        "deal2": deal2,
        "snap": snap,
    }

    app.dependency_overrides.clear()


def test_anonymous_gets_401(client_and_users):
    client = client_and_users["client"]
    client.headers.pop("Authorization", None)
    deal_id = client_and_users["deal1"].opportunity_id_18

    # Create custom column without token
    r = client.post("/api/custom-columns", json={"label": "Secret Col", "type": "text"})
    assert r.status_code == 401

    # Annotate deal without token
    r = client.put(f"/api/custom-columns/deals/{deal_id}/annotations/notes", json={"value": "hello"})
    assert r.status_code == 401

    # Add comment without token
    r = client.post(f"/api/custom-columns/deals/{deal_id}/comments", json={"text": "hello"})
    assert r.status_code == 401


def test_management_can_create_and_annotate_and_rules(client_and_users):
    client = client_and_users["client"]
    mgmt_token = client_and_users["mgmt_token"]
    admin_token = client_and_users["admin_token"]
    kam_token = client_and_users["kam_token"]
    deal1_id = client_and_users["deal1"].opportunity_id_18

    headers_mgmt = {"Authorization": f"Bearer {mgmt_token}"}
    headers_admin = {"Authorization": f"Bearer {admin_token}"}
    headers_kam = {"Authorization": f"Bearer {kam_token}"}

    # 1. Management creates custom column with internal visibility
    r = client.post(
        "/api/custom-columns",
        json={"label": "Management Strategy", "type": "text", "visibility": "internal"},
        headers=headers_mgmt,
    )
    assert r.status_code == 200, r.text
    mgmt_col = r.json()["column"]
    assert mgmt_col["label"] == "Management Strategy"
    assert mgmt_col["visibility"] == "internal"
    assert mgmt_col["creator_role"] == "management"

    # 2. Management creates custom column with visible_to_owner visibility
    r = client.post(
        "/api/custom-columns",
        json={"label": "Action Item for Owner", "type": "text", "visibility": "visible_to_owner"},
        headers=headers_mgmt,
    )
    assert r.status_code == 200, r.text
    shared_col = r.json()["column"]
    assert shared_col["label"] == "Action Item for Owner"
    assert shared_col["visibility"] == "visible_to_owner"

    # 3. Admin creates an admin custom column
    r = client.post(
        "/api/custom-columns",
        json={"label": "Board Approval Notes", "type": "text", "visibility": "internal"},
        headers=headers_admin,
    )
    assert r.status_code == 200
    admin_col = r.json()["column"]
    assert admin_col["creator_role"] == "admin"

    # 4. Management tries to rename or delete the admin-created column -> 403 Forbidden
    r = client.post(
        f"/api/custom-columns/{admin_col['id']}/rename",
        json={"label": "Hacked Name"},
        headers=headers_mgmt,
    )
    assert r.status_code == 403
    assert "cannot rename admin-created" in r.json()["detail"].lower()

    r = client.delete(f"/api/custom-columns/{admin_col['id']}", headers=headers_mgmt)
    assert r.status_code == 403
    assert "cannot delete admin-created" in r.json()["detail"].lower()

    # 5. Management CAN rename and delete the column they created
    r = client.post(
        f"/api/custom-columns/{mgmt_col['id']}/rename",
        json={"label": "Management Strategy v2"},
        headers=headers_mgmt,
    )
    assert r.status_code == 200
    assert r.json()["column"]["label"] == "Management Strategy v2"

    # 6. Management fills in custom column values for deal1
    col_key = shared_col["key"]
    r = client.put(
        f"/api/custom-columns/deals/{deal1_id}/annotations/{col_key}",
        json={"value": "Contact CTO by Friday"},
        headers=headers_mgmt,
    )
    assert r.status_code == 200
    assert r.json()["value"] == "Contact CTO by Friday"

    # 7. Management CANNOT modify original Excel-derived columns (raises 400)
    r = client.put(
        f"/api/custom-columns/deals/{deal1_id}/annotations/forecast_category",
        json={"value": "Closed"},
        headers=headers_mgmt,
    )
    assert r.status_code == 400
    assert "read-only" in r.json()["detail"].lower()

    # 8. KAM cannot create or edit custom columns (raises 403)
    r = client.post(
        "/api/custom-columns",
        json={"label": "KAM Unauthorized Col", "type": "text"},
        headers=headers_kam,
    )
    assert r.status_code == 403

    r = client.put(
        f"/api/custom-columns/deals/{deal1_id}/annotations/{col_key}",
        json={"value": "KAM trying to write"},
        headers=headers_kam,
    )
    assert r.status_code == 403


def test_comment_visibility_and_isolation(client_and_users):
    client = client_and_users["client"]
    mgmt_token = client_and_users["mgmt_token"]
    admin_token = client_and_users["admin_token"]
    kam_token = client_and_users["kam_token"]
    other_kam_token = client_and_users["other_kam_token"]
    deal1_id = client_and_users["deal1"].opportunity_id_18

    headers_mgmt = {"Authorization": f"Bearer {mgmt_token}"}
    headers_admin = {"Authorization": f"Bearer {admin_token}"}
    headers_kam = {"Authorization": f"Bearer {kam_token}"}
    headers_other_kam = {"Authorization": f"Bearer {other_kam_token}"}

    # 1. Management adds an internal comment on deal1
    r = client.post(
        f"/api/custom-columns/deals/{deal1_id}/comments",
        json={"text": "Internal leadership discussion: margin is tight", "visibility": "internal"},
        headers=headers_mgmt,
    )
    assert r.status_code == 200
    internal_comment = r.json()["comment"]
    assert internal_comment["visibility"] == "internal"
    assert internal_comment["author_role"] == "management"

    # 2. Management adds a shared comment on deal1
    r = client.post(
        f"/api/custom-columns/deals/{deal1_id}/comments",
        json={"text": "Please confirm delivery date with client", "visibility": "shared_with_owner"},
        headers=headers_mgmt,
    )
    assert r.status_code == 200
    shared_comment = r.json()["comment"]
    assert shared_comment["visibility"] == "shared_with_owner"

    # 3. KAM adds a comment on their own deal (deal1)
    r = client.post(
        f"/api/custom-columns/deals/{deal1_id}/comments",
        json={"text": "Meeting held, client agreed to terms"},
        headers=headers_kam,
    )
    assert r.status_code == 200
    kam_comment = r.json()["comment"]
    assert kam_comment["visibility"] == "shared_with_owner"
    assert kam_comment["author_role"] == "kam"

    # 4. Other KAM tries to comment or view comments on deal1 (they don't own deal1) -> 403 Forbidden
    r = client.post(
        f"/api/custom-columns/deals/{deal1_id}/comments",
        json={"text": "Intruder comment"},
        headers=headers_other_kam,
    )
    assert r.status_code == 403

    r = client.get(f"/api/custom-columns/deals/{deal1_id}/comments", headers=headers_other_kam)
    assert r.status_code == 403

    # 5. Deal Owner (Gabriel) views comments:
    # Must see shared_comment and their own kam_comment.
    # MUST NOT see internal_comment!
    r = client.get(f"/api/custom-columns/deals/{deal1_id}/comments", headers=headers_kam)
    assert r.status_code == 200
    returned_comments = r.json()["comments"]
    comment_texts = [c["text"] for c in returned_comments]
    assert "Please confirm delivery date with client" in comment_texts
    assert "Meeting held, client agreed to terms" in comment_texts
    assert "Internal leadership discussion: margin is tight" not in comment_texts

    # 6. Management views comments: sees ALL comments (internal + shared)
    r = client.get(f"/api/custom-columns/deals/{deal1_id}/comments", headers=headers_mgmt)
    assert r.status_code == 200
    mgmt_comments = r.json()["comments"]
    mgmt_texts = [c["text"] for c in mgmt_comments]
    assert "Internal leadership discussion: margin is tight" in mgmt_texts
    assert "Please confirm delivery date with client" in mgmt_texts
    assert "Meeting held, client agreed to terms" in mgmt_texts

    # 7. Management can edit/delete their own comment
    r = client.put(
        f"/api/custom-columns/deals/{deal1_id}/comments/{internal_comment['id']}",
        json={"text": "Internal leadership discussion: updated margin"},
        headers=headers_mgmt,
    )
    assert r.status_code == 200

    r = client.delete(
        f"/api/custom-columns/deals/{deal1_id}/comments/{internal_comment['id']}",
        headers=headers_mgmt,
    )
    assert r.status_code == 200

    # 8. Management cannot delete admin's comment
    r = client.post(
        f"/api/custom-columns/deals/{deal1_id}/comments",
        json={"text": "Admin directive", "visibility": "internal"},
        headers=headers_admin,
    )
    admin_c = r.json()["comment"]
    r = client.delete(
        f"/api/custom-columns/deals/{deal1_id}/comments/{admin_c['id']}",
        headers=headers_mgmt,
    )
    assert r.status_code == 403
    assert "cannot delete admin" in r.json()["detail"].lower()


def test_kam_cannot_see_internal_custom_columns(client_and_users):
    client = client_and_users["client"]
    admin_token = client_and_users["admin_token"]
    kam_token = client_and_users["kam_token"]
    deal1_id = client_and_users["deal1"].opportunity_id_18

    headers_admin = {"Authorization": f"Bearer {admin_token}"}
    headers_kam = {"Authorization": f"Bearer {kam_token}"}

    # Create 1 internal column and 1 visible_to_owner column
    r = client.post(
        "/api/custom-columns",
        json={"label": "Secret Exec Score", "type": "number", "visibility": "internal"},
        headers=headers_admin,
    )
    internal_col = r.json()["column"]

    r = client.post(
        "/api/custom-columns",
        json={"label": "Target Contact Date", "type": "date", "visibility": "visible_to_owner"},
        headers=headers_admin,
    )
    shared_col = r.json()["column"]

    # Fill in values for both columns on deal1
    client.put(
        f"/api/custom-columns/deals/{deal1_id}/annotations/{internal_col['key']}",
        json={"value": "99"},
        headers=headers_admin,
    )
    client.put(
        f"/api/custom-columns/deals/{deal1_id}/annotations/{shared_col['key']}",
        json={"value": "2026-12-01"},
        headers=headers_admin,
    )

    # 1. KAM checks /api/custom-columns: should only see shared_col, NOT internal_col
    r = client.get("/api/custom-columns", headers=headers_kam)
    assert r.status_code == 200
    col_labels = [c["label"] for c in r.json()["columns"]]
    assert "Target Contact Date" in col_labels
    assert "Secret Exec Score" not in col_labels

    # 2. KAM checks /api/custom-columns/deals/{deal1_id}/annotations:
    # should only see shared_col value, NOT internal_col value
    r = client.get(f"/api/custom-columns/deals/{deal1_id}/annotations", headers=headers_kam)
    assert r.status_code == 200
    annots = r.json()["annotations"]
    assert shared_col["key"] in annots
    assert internal_col["key"] not in annots

    # 3. Admin checks: sees both
    r = client.get(f"/api/custom-columns/deals/{deal1_id}/annotations", headers=headers_admin)
    assert r.status_code == 200
    admin_annots = r.json()["annotations"]
    assert shared_col["key"] in admin_annots
    assert internal_col["key"] in admin_annots


def test_audit_log_records_role_and_user_for_all_events(client_and_users):
    client = client_and_users["client"]
    db = client_and_users["db"]
    mgmt_token = client_and_users["mgmt_token"]
    deal1_id = client_and_users["deal1"].opportunity_id_18

    headers_mgmt = {"Authorization": f"Bearer {mgmt_token}"}

    # Perform column creation, update, deal annotation, comment
    r = client.post(
        "/api/custom-columns",
        json={"label": "Audit Test Column", "type": "text", "visibility": "internal"},
        headers=headers_mgmt,
    )
    col = r.json()["column"]

    client.put(
        f"/api/custom-columns/deals/{deal1_id}/annotations/{col['key']}",
        json={"value": "First Value"},
        headers=headers_mgmt,
    )

    client.post(
        f"/api/custom-columns/deals/{deal1_id}/comments",
        json={"text": "Audit Comment", "visibility": "internal"},
        headers=headers_mgmt,
    )

    # Check database Audit records
    audits = db.query(AnnotationAudit).all()
    actions = [a.action for a in audits]
    assert "column added" in actions
    assert "value added" in actions
    assert "create" in actions

    # Verify user and role were logged
    mgmt_user = client_and_users["mgmt"]
    mgmt_audits = [a for a in audits if a.user_id in (mgmt_user.name, mgmt_user.email, str(mgmt_user.id))]
    assert len(mgmt_audits) >= 3
    for a in mgmt_audits:
        assert a.extra_info is not None
        assert a.extra_info.get("role") == "management"
