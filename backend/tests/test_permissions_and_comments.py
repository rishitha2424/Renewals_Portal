import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.services.context import sign_admin_token
from backend.services.settings_service import SettingsService
from backend.database import SessionLocal
from backend.models.opportunity import Opportunity
from backend.models.snapshot import UploadSnapshot

client = TestClient(app)


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def test_opp_id(db):
    opp = db.query(Opportunity).first()
    assert opp is not None, "At least one opportunity required in database"
    return opp.opportunity_id_18


@pytest.fixture
def admin_headers():
    token = sign_admin_token("TestAdmin")
    return {"Authorization": f"Bearer {token}"}


def test_anonymous_forbidden_on_admin_custom_column_actions(test_opp_id):
    # 1. Create Column
    r = client.post("/api/custom-columns", json={"label": "Anon Col", "type": "text"})
    assert r.status_code == 401, f"Expected 401, got {r.status_code}: {r.text}"

    # 2. Bulk Create
    r = client.post("/api/custom-columns/bulk", json={"columns": [{"label": "Bulk 1", "type": "text"}]})
    assert r.status_code == 401

    # 3. Rename
    r = client.post("/api/custom-columns/test_col/rename", json={"label": "New Name"})
    assert r.status_code == 401

    # 4. Move
    r = client.post("/api/custom-columns/test_col/move", json={"direction": "right"})
    assert r.status_code == 401

    # 5. Delete column
    r = client.delete("/api/custom-columns/test_col")
    assert r.status_code == 401

    # 6. Set deal annotation
    r = client.put(f"/api/custom-columns/deals/{test_opp_id}/annotations/test_col", json={"value": "foo"})
    assert r.status_code == 401

    # 7. Delete deal annotation
    r = client.delete(f"/api/custom-columns/deals/{test_opp_id}/annotations/test_col")
    assert r.status_code == 401


def test_viewer_can_read_custom_columns_and_annotations(test_opp_id):
    r_cols = client.get("/api/custom-columns")
    assert r_cols.status_code == 200
    assert "columns" in r_cols.json()

    r_annots = client.get(f"/api/custom-columns/deals/{test_opp_id}/annotations")
    assert r_annots.status_code == 200
    assert "annotations" in r_annots.json()

    r_comments = client.get(f"/api/custom-columns/deals/{test_opp_id}/comments")
    assert r_comments.status_code == 200
    assert "comments" in r_comments.json()


def test_admin_can_manage_custom_columns(admin_headers, test_opp_id):
    import uuid
    col_label = f"Admin Test Col {uuid.uuid4().hex[:6]}"

    # Create Column
    r = client.post("/api/custom-columns", json={"label": col_label, "type": "text"}, headers=admin_headers)
    assert r.status_code == 200, f"Failed create: {r.text}"
    col_data = r.json().get("column")
    col_id = col_data["id"]
    col_key = col_data["key"]

    try:
        # Admin can annotate deal with this custom column
        r_val = client.put(
            f"/api/custom-columns/deals/{test_opp_id}/annotations/{col_key}",
            json={"value": "Verified Value"},
            headers=admin_headers,
        )
        assert r_val.status_code == 200
        assert r_val.json().get("value") == "Verified Value"

        # Check annotation is visible to viewers
        r_read = client.get(f"/api/custom-columns/deals/{test_opp_id}/annotations")
        assert r_read.status_code == 200
        assert col_key in r_read.json()["annotations"]
        assert r_read.json()["annotations"][col_key]["value"] == "Verified Value"

        # Original Excel column editing is rejected
        r_excel_edit = client.put(
            f"/api/custom-columns/deals/{test_opp_id}/annotations/opportunity_name",
            json={"value": "Hacked Name"},
            headers=admin_headers,
        )
        assert r_excel_edit.status_code == 400
        assert "read-only" in r_excel_edit.text or "not exist" in r_excel_edit.text

    finally:
        # Clean up column
        client.delete(f"/api/custom-columns/{col_id}", headers=admin_headers)


def test_comments_persistence_and_audit(db, test_opp_id, admin_headers):
    # Ensure viewer comments are enabled
    SettingsService.set_setting(db, "allow_viewer_comments", "true")

    # Add comment as Viewer
    test_comment = f"Audited viewer comment {test_opp_id}"
    r_add = client.post(
        f"/api/custom-columns/deals/{test_opp_id}/comments",
        json={"text": test_comment, "author": "Analyst Alice"},
    )
    assert r_add.status_code == 200, f"Failed add comment: {r_add.text}"
    c_data = r_add.json()["comment"]
    c_id = c_data["id"]
    assert c_data["text"] == test_comment
    assert c_data["author"] == "Analyst Alice"

    # Verify comment persists when queried by another session
    r_list = client.get(f"/api/custom-columns/deals/{test_opp_id}/comments")
    assert r_list.status_code == 200
    texts = [c["text"] for c in r_list.json()["comments"]]
    assert test_comment in texts

    # Verify comment appears in global Audit Log
    r_audit = client.get("/api/custom-columns/audit")
    assert r_audit.status_code == 200
    audit_entries = r_audit.json()["audit"]
    found = any(e.get("entity_id") == c_id and e.get("new_value") == test_comment for e in audit_entries)
    assert found, "Comment creation audit entry not found in global audit log"

    # Test viewer comments setting toggle
    SettingsService.set_setting(db, "allow_viewer_comments", "false")
    r_blocked = client.post(
        f"/api/custom-columns/deals/{test_opp_id}/comments",
        json={"text": "Should be blocked", "author": "Viewer Bob"},
    )
    assert r_blocked.status_code == 403, "Viewer should receive 403 when comments disabled"

    # Admin can still add comments even when viewer comments are false
    r_admin_add = client.post(
        f"/api/custom-columns/deals/{test_opp_id}/comments",
        json={"text": "Admin override comment", "author": "Admin Super"},
        headers=admin_headers,
    )
    assert r_admin_add.status_code == 200

    # Reset setting back to true
    SettingsService.set_setting(db, "allow_viewer_comments", "true")

    # Clean up test comment
    client.delete(f"/api/custom-columns/deals/{test_opp_id}/comments/{c_id}")

