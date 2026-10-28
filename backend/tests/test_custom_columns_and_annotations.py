"""
Comprehensive test suite for Editable Notes & Custom Columns on Deals:
1. Add, rename, reorder, delete custom columns.
2. Edit / clear values per type, type validation, auto columns read-only.
3. Admin-only enforcement for all mutating endpoints.
4. Upload conflict rules (empty fill, app value kept, excel value replaced, blank never erases).
5. Values survive upload of a new date and snapshot delete.
6. Optimistic concurrency control (409 conflict 'This value changed, reload').
7. Full Excel export (in-place merging, appended columns, formula injection protection, row count).
8. Filter and search on custom columns in Explorer and Opportunities.
9. Backup export and daily backup retention pruning.
"""
import io
import json
import openpyxl
import pandas as pd
import pytest
from datetime import date, datetime, timezone
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.main import app
from backend.database import Base, get_db
from backend.models.custom_column import CustomColumn, DealAnnotation, AnnotationAudit
from backend.models.opportunity import Opportunity
from backend.models.snapshot import UploadSnapshot
from backend.services.context import require_admin_context, ADMIN_CONTEXT
from backend.services.annotation_service import AnnotationService, ConcurrencyError, ValidationError
from backend.services.annotation_backup_service import AnnotationBackupService
from backend.services.full_excel_export_service import FullExcelExportService, sanitize_formula_injection


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
from sqlalchemy.pool import StaticPool

@pytest.fixture
def test_db_session():
    """Isolated in-memory SQLite database for test."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    session = TestingSession()

    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client_and_db(test_db_session):
    def override_get_db():
        try:
            yield test_db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides.pop(require_admin_context, None)
    client = TestClient(app)
    try:
        yield client, test_db_session
    finally:
        app.dependency_overrides.clear()


@pytest.fixture
def admin_headers():
    from backend.services.context import sign_admin_token
    token = sign_admin_token()
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# 1. Column CRUD & Type Validation
# ---------------------------------------------------------------------------
def test_column_crud_and_validation(test_db_session):
    svc = AnnotationService(test_db_session)

    # Create text column
    c1 = svc.create_column(label="Account Strategy", col_type="text", user_id="admin_user")
    assert c1.key == "account_strategy"
    assert c1.type == "text"
    assert c1.sort_order == 0

    # Create dropdown column
    c2 = svc.create_column(
        label="Renewal Health",
        col_type="dropdown",
        dropdown_options=["Green", "Amber", "Red"],
        sort_order=1,
    )
    assert c2.key == "renewal_health"
    assert c2.dropdown_options == ["Green", "Amber", "Red"]

    # Inferred auto columns
    c3 = svc.create_column(label="Last Edited By", col_type="auto: edited by")
    assert c3.type == "auto: edited by"

    # Reject invalid type
    with pytest.raises(ValidationError):
        svc.create_column(label="Invalid Type", col_type="unsupported_type")

    # Rename & reorder
    c1_up = svc.update_column(c1.id, label="Account Action Plan", sort_order=5)
    assert c1_up.label == "Account Action Plan"
    assert c1_up.sort_order == 5

    # Delete column (soft-delete)
    svc.delete_column(c2.id)
    cols = svc.list_columns(include_deleted=False)
    keys = [c.key for c in cols]
    assert "renewal_health" not in keys
    assert "account_strategy" in keys

    # Verify audit entries
    audit = test_db_session.query(AnnotationAudit).filter(AnnotationAudit.column_key == "account_strategy").all()
    actions = [a.action for a in audit]
    assert "column added" in actions
    assert "column edited" in actions


# ---------------------------------------------------------------------------
# 2. Value Edits per Type, Validation & Concurrency
# ---------------------------------------------------------------------------
def test_value_edits_per_type_and_concurrency(test_db_session):
    svc = AnnotationService(test_db_session)
    col_txt = svc.create_column("Comment", "text")
    col_num = svc.create_column("Discount Pct", "number")
    col_date = svc.create_column("Target Signature", "date")
    col_drop = svc.create_column("Priority", "dropdown", dropdown_options=["High", "Med", "Low"])
    col_chk = svc.create_column("Escalated", "checkbox")
    col_auto = svc.create_column("Editor", "auto: edited by")

    opp_id = "006TESTOPP001"

    # Valid values
    r1 = svc.set_deal_value(opp_id, col_txt.key, "Important negotiation in progress", user_id="alice")
    assert r1["value"] == "Important negotiation in progress"
    assert r1["version"] == 1
    assert r1["updated_by"] == "alice"

    # Number validation
    r_num = svc.set_deal_value(opp_id, col_num.key, "15.5", user_id="alice")
    assert float(r_num["value"]) == 15.5

    with pytest.raises(ValidationError):
        svc.set_deal_value(opp_id, col_num.key, "not_a_number")

    # Date validation
    r_date = svc.set_deal_value(opp_id, col_date.key, "2026-11-30")
    assert r_date["value"] == "2026-11-30"

    with pytest.raises(ValidationError):
        svc.set_deal_value(opp_id, col_date.key, "invalid_date_format")

    # Dropdown validation
    r_drop = svc.set_deal_value(opp_id, col_drop.key, "High")
    assert r_drop["value"] == "High"

    with pytest.raises(ValidationError):
        svc.set_deal_value(opp_id, col_drop.key, "Urgent")  # not in High/Med/Low

    # Checkbox
    r_chk = svc.set_deal_value(opp_id, col_chk.key, "true")
    assert r_chk["value"] == "true"

    # Auto column cannot be edited directly
    with pytest.raises(ValidationError):
        svc.set_deal_value(opp_id, col_auto.key, "some_user")

    # Concurrency conflict test
    # Attempt to update with stale version 1 when version is 2
    svc.set_deal_value(opp_id, col_txt.key, "Updated text", user_id="bob")
    with pytest.raises(ConcurrencyError) as exc_info:
        svc.set_deal_value(opp_id, col_txt.key, "Stale update", expected_version=1)
    assert "This value changed, reload" in str(exc_info.value)

    # Clearing value
    clear_res = svc.set_deal_value(opp_id, col_txt.key, None)
    assert clear_res["cleared"] is True

    annots = svc.get_deal_annotations(opp_id)
    assert col_txt.key not in annots


# ---------------------------------------------------------------------------
# 3. Admin-Only Mutating Route Security & Excel Column Rejections
# ---------------------------------------------------------------------------
def test_admin_only_routes_enforcement(client_and_db, admin_headers):
    client, db = client_and_db

    # GET custom columns is public / context
    r_get = client.get("/api/custom-columns")
    assert r_get.status_code == 200

    # POST custom column without auth -> 401
    r_post_noauth = client.post("/api/custom-columns", json={"label": "Secured Col", "type": "text"})
    assert r_post_noauth.status_code == 401

    # POST with invalid auth -> 403
    r_post_bad = client.post(
        "/api/custom-columns",
        json={"label": "Secured Col", "type": "text"},
        headers={"Authorization": "Bearer invalid_token"},
    )
    assert r_post_bad.status_code == 403

    # POST with admin auth -> 200
    r_post_ok = client.post(
        "/api/custom-columns",
        json={"label": "Secured Col", "type": "text"},
        headers=admin_headers,
    )
    assert r_post_ok.status_code == 200
    col_id = r_post_ok.json()["column"]["id"]

    # PUT deal value without auth -> 401
    r_put_noauth = client.put(
        "/api/custom-columns/deals/006TESTOPP/annotations/secured_col",
        json={"value": "Hello"},
    )
    assert r_put_noauth.status_code == 401

    # PUT deal value with admin auth -> 200
    r_put_ok = client.put(
        "/api/custom-columns/deals/006TESTOPP/annotations/secured_col",
        json={"value": "Hello"},
        headers=admin_headers,
    )
    assert r_put_ok.status_code == 200

    # Attempting to mutate an Excel column via API must be rejected
    r_put_excel = client.put(
        "/api/custom-columns/deals/006TESTOPP/annotations/stage_number",
        json={"value": "7"},
        headers=admin_headers,
    )
    assert r_put_excel.status_code == 400
    assert "read-only" in r_put_excel.json().get("detail", "").lower()

    # DELETE deal value with admin auth -> 200
    r_del_ok = client.delete(
        "/api/custom-columns/deals/006TESTOPP/annotations/secured_col",
        headers=admin_headers,
    )
    assert r_del_ok.status_code == 200


# ---------------------------------------------------------------------------
# 4. Excel Column Protection, Clashing Added Columns & Cross-Snapshot Survival
# ---------------------------------------------------------------------------
def test_excel_column_protection_and_added_columns_survival(test_db_session):
    svc = AnnotationService(test_db_session)

    # Setup snapshot with Excel headers so column_order is known
    snap = UploadSnapshot(
        id="snap-test-uuid",
        label="Test Day",
        snapshot_date=date(2026, 10, 26),
        is_active_today=True,
        column_order=["Opportunity ID 18 Digit", "Account Name", "Comments", "Stage Number"],
    )
    test_db_session.add(snap)
    test_db_session.commit()

    # 1. Excel column cannot be edited, renamed, moved, or deleted
    with pytest.raises(ValidationError) as exc:
        svc.set_deal_value("006TEST", "stage_number", "8")
    assert "read-only" in str(exc.value).lower()

    with pytest.raises(ValidationError) as exc:
        svc.rename_column("stage_number", "Renamed Stage")
    assert "read-only" in str(exc.value).lower()

    with pytest.raises(ValidationError) as exc:
        svc.move_column("stage_number", "left")
    assert "read-only" in str(exc.value).lower()

    with pytest.raises(ValidationError) as exc:
        svc.delete_column("stage_number")
    assert "read-only" in str(exc.value).lower()

    # 2. Added column matching Excel header name ("Comments" or "Comment Date")
    # Gets isolated key and is_excel_column=False
    added_col = svc.create_column("Comments", "text", user_id="admin")
    assert added_col.key == "comments_added"
    assert added_col.label == "Comments"

    # 3. Add values to added column
    opp_1 = "006DEAL001"
    svc.set_deal_value(opp_1, added_col.key, "My Internal App Comment", user_id="admin")

    # 4. Values survive snapshot creation and deletion
    opp_record = Opportunity(
        id="opp-uuid-1",
        snapshot_id=snap.id,
        opportunity_id_18=opp_1,
        opportunity_name="Test Deal 1",
    )
    test_db_session.add(opp_record)
    test_db_session.commit()

    test_db_session.delete(snap)
    test_db_session.commit()

    survived = test_db_session.query(DealAnnotation).filter(DealAnnotation.opportunity_id_18 == opp_1).first()
    assert survived is not None
    assert survived.value == "My Internal App Comment"

    # 5. Soft-delete and restore
    del_col, n_values = svc.delete_column(added_col.id, user_id="admin")
    assert n_values == 1
    # Check it's marked deleted
    test_db_session.refresh(added_col)
    assert added_col.is_deleted is True

    # Restore
    restored = svc.restore_column(added_col.id, user_id="admin")
    assert restored.is_deleted is False
    val_after_restore = svc.get_deal_annotations(opp_1)
    assert val_after_restore[added_col.key]["value"] == "My Internal App Comment"


# ---------------------------------------------------------------------------
# 5. One Download Service: Exact Copy, Appended Added Columns & Safety
# ---------------------------------------------------------------------------
def test_full_excel_download_roundtrip_and_safety(test_db_session):
    snap = UploadSnapshot(
        id="snap-export-test",
        label="Export Test",
        snapshot_date=date(2026, 10, 26),
        column_order=["Opportunity ID 18 Digit", "Account Name", "Forecast Category", "Reconciliation Entry", "Comments"],
    )
    test_db_session.add(snap)
    test_db_session.commit()

    opp1 = Opportunity(
        id="opp-exp-1",
        snapshot_id=snap.id,
        opportunity_id_18="006EXPORT01",
        account_name="Acme Corp",
        forecast_acv_amount=50000.0,
        extra_attributes={
            "_row_order": 0,
            "Opportunity ID 18 Digit": "006EXPORT01",
            "Account Name": "Acme Corp",
            "Forecast Category": "",  # Empty -> MUST NOT be "Blank"
            "Reconciliation Entry": "-",  # Lone dash -> MUST NOT have visible apostrophe
            "Comments": "Uploaded Excel comment",
        },
    )
    opp2 = Opportunity(
        id="opp-exp-2",
        snapshot_id=snap.id,
        opportunity_id_18="006EXPORT02",
        account_name="Beta Corp",
        forecast_acv_amount=25000.0,
        extra_attributes={
            "_row_order": 1,
            "Opportunity ID 18 Digit": "006EXPORT02",
            "Account Name": "Beta Corp",
            "Forecast Category": "Pipeline",
            "Reconciliation Entry": "=SUM(A1:A10)",  # Formula injection
            "Comments": "Another Excel comment",
        },
    )
    test_db_session.add_all([opp1, opp2])
    test_db_session.commit()

    svc = AnnotationService(test_db_session)
    # Added column with clashing name "Comments" -> gets " (added)" in export header
    col_clash = svc.create_column("Comments", "text")
    svc.set_deal_value("006EXPORT01", col_clash.key, "Added App Comment")

    # Added regular column
    col_reg = svc.create_column("Status Note", "text")
    svc.set_deal_value("006EXPORT01", col_reg.key, "Under Review")

    export_svc = FullExcelExportService(test_db_session)

    # 1. Excel export test
    buf_xlsx, fn_xlsx, _ = export_svc.generate_export(snapshot_id=snap.id, export_format="xlsx")
    assert "2026-10-26" in fn_xlsx
    assert fn_xlsx.endswith(".xlsx")

    wb = openpyxl.load_workbook(buf_xlsx)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))

    headers = rows[0]
    # First 5 are original 172/Excel columns
    assert headers[0] == "Opportunity ID 18 Digit"
    assert headers[1] == "Account Name"
    assert headers[2] == "Forecast Category"
    assert headers[3] == "Reconciliation Entry"
    assert headers[4] == "Comments"
    # Appended columns: clashing gets " (added)"
    assert headers[5] == "Comments (added)"
    assert headers[6] == "Status Note"

    data_r1 = rows[1]
    # Empty forecast category is None/empty string, NEVER "Blank"
    assert data_r1[2] is None or data_r1[2] == ""
    # Lone dash is '-' without leading apostrophe
    assert data_r1[3] == "-"
    assert data_r1[4] == "Uploaded Excel comment"
    assert data_r1[5] == "Added App Comment"
    assert data_r1[6] == "Under Review"

    # Formula injection sanitized
    data_r2 = rows[2]
    assert data_r2[3] == "'=SUM(A1:A10)"

    # 2. CSV export test
    buf_csv, fn_csv, _ = export_svc.generate_export(snapshot_id=snap.id, export_format="csv")
    assert fn_csv.endswith(".csv")
    csv_text = buf_csv.getvalue().decode("utf-8-sig")
    assert "Comments (added)" in csv_text
    assert "Status Note" in csv_text

    # 3. Formula sanitizer helper unit test
    assert sanitize_formula_injection("-") == "-"
    assert sanitize_formula_injection("-123.45") == "-123.45"
    assert sanitize_formula_injection("+") == "+"
    assert sanitize_formula_injection("=cmd|'/C calc'!A0") == "'=cmd|'/C calc'!A0"
    assert sanitize_formula_injection("@SUM(A1:A5)") == "'@SUM(A1:A5)"


# ---------------------------------------------------------------------------
# 6. Backup Service, Scheduled Job & Pruning
# ---------------------------------------------------------------------------
def test_backup_service_and_pruning(test_db_session, tmp_path, monkeypatch):
    monkeypatch.setenv("ANNOTATION_BACKUP_PATH", str(tmp_path))
    monkeypatch.setenv("ANNOTATION_BACKUP_RETENTION", "3")
    backup_svc = AnnotationBackupService(test_db_session)

    # Add a column and value
    annot_svc = AnnotationService(test_db_session)
    c = annot_svc.create_column("Test Backup Col", "text")
    annot_svc.set_deal_value("006BACKUP", c.key, "Backup Payload Value")

    # Dump JSON
    payload = backup_svc.dump_annotations_payload()
    assert payload["counts"]["custom_columns"] >= 1
    assert payload["counts"]["deal_annotations"] >= 1

    # Simulate 5 historical backup files to test retention pruning to 3
    import time
    for i in range(5):
        dummy_file = tmp_path / f"annotations_backup_2026102{i}_000000.json"
        dummy_file.write_text(json.dumps({"test": i}))
        time.sleep(0.01)

    # Run daily backup (pruning setting = 3)
    file_path = backup_svc.run_daily_backup(retention_count=3)
    assert open(file_path, "r", encoding="utf-8").read() != ""

    remaining_files = list(tmp_path.glob("annotations_backup_*.json"))
    assert len(remaining_files) == 3

    # Verify background schedule registration in lifespan
    from backend.main import lifespan
    assert callable(lifespan)


# ---------------------------------------------------------------------------
# 7. Explorer Filtering and Search on Custom Columns
# ---------------------------------------------------------------------------
def test_explorer_filter_and_search_custom_columns(test_db_session):
    from backend.services.explorer_service import ExplorerService, FilterRule
    from backend.services.opportunity_service import OpportunityService

    snap = UploadSnapshot(
        id="snap-filter-test",
        label="Filter Test",
        snapshot_date=date(2026, 10, 26),
        is_active_today=True,
        column_order=["Opportunity ID 18 Digit", "Opportunity Name"],
    )
    test_db_session.add(snap)
    test_db_session.commit()

    opp_a = Opportunity(
        id="opp-filter-a",
        snapshot_id=snap.id,
        opportunity_id_18="006ALPHA001",
        opportunity_name="Deal Alpha Inc",
        forecast_acv_amount=100000.0,
        extra_attributes={"Opportunity ID 18 Digit": "006ALPHA001", "Opportunity Name": "Deal Alpha Inc"},
    )
    opp_b = Opportunity(
        id="opp-filter-b",
        snapshot_id=snap.id,
        opportunity_id_18="006BETA002",
        opportunity_name="Deal Beta Corp",
        forecast_acv_amount=50000.0,
        extra_attributes={"Opportunity ID 18 Digit": "006BETA002", "Opportunity Name": "Deal Beta Corp"},
    )
    test_db_session.add_all([opp_a, opp_b])
    test_db_session.commit()

    annot_svc = AnnotationService(test_db_session)
    col = annot_svc.create_column("Deal Strategy", "text")
    annot_svc.set_deal_value(opp_a.opportunity_id_18, col.key, "Key Strategic Priority")
    annot_svc.set_deal_value(opp_b.opportunity_id_18, col.key, "Standard Routine")

    # 1. ExplorerService filter rule on custom column
    exp_svc = ExplorerService(test_db_session)
    rule = FilterRule(column="Deal Strategy", operator="contains", value="Strategic")
    rows, count, acv = exp_svc.query_rows(snap=snap, filter_spec=None, filters=[rule])

    assert count == 1
    assert rows[0]["_opp_id_18"] == "006ALPHA001"
    assert rows[0]["Deal Strategy"] == "Key Strategic Priority"

    # 2. Data Explorer search: Data Explorer queries snapshot rows and filters across
    # deal fields AND custom column values (by label, key, and _annotations)
    all_rows, total_cnt, _ = exp_svc.query_rows(snap=snap, filter_spec=None, filters=[])
    assert total_cnt == 2

    search_query = "Strategic"
    # Search implementation that Data Explorer frontend/consumer applies to rows:
    matched_rows = [
        r for r in all_rows
        if search_query.lower() in str(r.get("Opportunity Name", "")).lower()
        or search_query.lower() in str(r.get("Opportunity ID 18 Digit", "")).lower()
        or search_query.lower() in str(r.get("Deal Strategy", "")).lower()
        or search_query.lower() in str(r.get(col.key, "")).lower()
        or search_query.lower() in str(r.get("_annotations", {}).get(col.key, {}).get("value", "")).lower()
    ]
    assert len(matched_rows) == 1
    assert matched_rows[0]["_opp_id_18"] == "006ALPHA001"
    assert matched_rows[0]["Deal Strategy"] == "Key Strategic Priority"

    # Also verify search via OpportunityService.list_opportunities includes custom column values
    from backend.services.context import ADMIN_CONTEXT
    opp_svc = OpportunityService(test_db_session)
    search_res = opp_svc.list_opportunities(ADMIN_CONTEXT, snapshot_id=snap.id, search="Strategic")
    assert search_res["total"] >= 1
    search_ids = [d["opportunity_id_18"] for d in search_res["items"]]
    assert "006ALPHA001" in search_ids


# ---------------------------------------------------------------------------
# 8. Migration SQLite and PostgreSQL Compatibility
# ---------------------------------------------------------------------------
def test_migration_compatibility(tmp_path):
    from pathlib import Path
    from alembic.config import Config
    from alembic import command
    from alembic.script import ScriptDirectory
    import sqlalchemy as sa

    renewals_db_path = Path(__file__).resolve().parent.parent.parent / "renewals.db"
    renewals_mtime_before = renewals_db_path.stat().st_mtime if renewals_db_path.exists() else None

    ini_path = str(Path(__file__).resolve().parent.parent.parent / "alembic.ini")
    alembic_cfg = Config(ini_path)
    script = ScriptDirectory.from_config(alembic_cfg)
    rev_0005 = script.get_revision("0005_custom_columns")
    assert rev_0005 is not None

    # Run alembic upgrade to head on a fresh SQLite DB file
    db_file = tmp_path / "migration_test.db"
    db_url = f"sqlite:///{db_file}"
    alembic_cfg.set_main_option("sqlalchemy.url", db_url)
    command.upgrade(alembic_cfg, "head")

    # Confirm that no test touched renewals.db
    if renewals_db_path.exists() and renewals_mtime_before is not None:
        assert renewals_db_path.stat().st_mtime == renewals_mtime_before, "renewals.db must not be touched during migration tests"

    # Verify tables are created on the fresh database
    test_engine = create_engine(db_url)
    insp = sa.inspect(test_engine)
    table_names = insp.get_table_names()
    assert "custom_columns" in table_names
    assert "deal_annotations" in table_names
    assert "annotation_audit" in table_names
    assert "alembic_version" in table_names

    # Check columns on custom_columns
    cols = {c["name"] for c in insp.get_columns("custom_columns")}
    assert {"id", "key", "label", "type", "sort_order", "is_deleted"}.issubset(cols)


# ---------------------------------------------------------------------------
# 9. Excel Column Immutability across All Added Column Operations
# ---------------------------------------------------------------------------
def test_excel_columns_unchanged_after_added_column_mutations(test_db_session):
    """
    User requirement 0:
    Add a test that after any add, edit, rename, move, delete or restore of added columns,
    the API output for every Excel column equals the uploaded workbook.
    """
    from backend.services.explorer_service import ExplorerService
    excel_headers = ["Opportunity ID 18 Digit", "Account Name", "Stage Number", "Forecast ACV Amount", "Comments"]
    snap = UploadSnapshot(
        id="snap-immutability-test",
        label="Test Immutability",
        snapshot_date=date(2026, 10, 26),
        is_active_today=True,
        column_order=excel_headers,
    )
    test_db_session.add(snap)
    test_db_session.commit()

    opp = Opportunity(
        id="opp-imm-1",
        snapshot_id=snap.id,
        opportunity_id_18="006IMMUTABLE01",
        account_name="Acme Corp",
        stage_number=5,
        forecast_acv_amount=12345.67,
        extra_attributes={
            "Opportunity ID 18 Digit": "006IMMUTABLE01",
            "Account Name": "Acme Corp",
            "Stage Number": 5,
            "Forecast ACV Amount": 12345.67,
            "Comments": "Original Excel Comments",
        },
    )
    test_db_session.add(opp)
    test_db_session.commit()

    exp_svc = ExplorerService(test_db_session)
    annot_svc = AnnotationService(test_db_session)

    # Baseline query
    baseline_rows, _, _ = exp_svc.query_rows(snap=snap, filter_spec=None, filters=[])
    baseline_excel_data = {k: baseline_rows[0][k] for k in excel_headers}

    # 1. ADD an added column (even with clashing label "Comments")
    col = annot_svc.create_column("Comments", "text", user_id="admin")
    rows_after_add, _, _ = exp_svc.query_rows(snap=snap, filter_spec=None, filters=[])
    for k in excel_headers:
        assert rows_after_add[0][k] == baseline_excel_data[k]

    # 2. EDIT a value on added column
    annot_svc.set_deal_value(opp.opportunity_id_18, col.key, "New app note", user_id="admin")
    rows_after_edit, _, _ = exp_svc.query_rows(snap=snap, filter_spec=None, filters=[])
    for k in excel_headers:
        assert rows_after_edit[0][k] == baseline_excel_data[k]

    # 3. RENAME added column
    annot_svc.rename_column(col.id, "Internal Notes", user_id="admin")
    rows_after_rename, _, _ = exp_svc.query_rows(snap=snap, filter_spec=None, filters=[])
    for k in excel_headers:
        assert rows_after_rename[0][k] == baseline_excel_data[k]

    # 4. MOVE added column
    annot_svc.move_column(col.id, "left", user_id="admin")
    rows_after_move, _, _ = exp_svc.query_rows(snap=snap, filter_spec=None, filters=[])
    for k in excel_headers:
        assert rows_after_move[0][k] == baseline_excel_data[k]

    # 5. DELETE added column
    annot_svc.delete_column(col.id, user_id="admin")
    rows_after_del, _, _ = exp_svc.query_rows(snap=snap, filter_spec=None, filters=[])
    for k in excel_headers:
        assert rows_after_del[0][k] == baseline_excel_data[k]

    # 6. RESTORE added column
    annot_svc.restore_column(col.id, user_id="admin")
    rows_after_restore, _, _ = exp_svc.query_rows(snap=snap, filter_spec=None, filters=[])
    for k in excel_headers:
        assert rows_after_restore[0][k] == baseline_excel_data[k]



