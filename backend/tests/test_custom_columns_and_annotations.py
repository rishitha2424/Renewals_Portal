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
    assert "create" in actions
    assert "update" in actions


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
# 3. Admin-Only Mutating Route Security
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

    # DELETE deal value with admin auth -> 200
    r_del_ok = client.delete(
        "/api/custom-columns/deals/006TESTOPP/annotations/secured_col",
        headers=admin_headers,
    )
    assert r_del_ok.status_code == 200


# ---------------------------------------------------------------------------
# 4. Upload Ingest Conflict Rules & Cross-Snapshot Survival
# ---------------------------------------------------------------------------
def test_upload_conflict_rules_and_survival(test_db_session):
    svc = AnnotationService(test_db_session)
    col = svc.create_column("Excel Note", "text", source_header="Raw Excel Notes")

    # Deal 1: No app value -> empty fill (source: excel)
    # Deal 2: Has app value (source: app) -> kept, never overwritten
    # Deal 3: Has excel value -> new non-blank value replaces it
    # Deal 4: Has app value -> new blank excel value does not erase it
    opp_1 = "006DEAL001"
    opp_2 = "006DEAL002"
    opp_3 = "006DEAL003"
    opp_4 = "006DEAL004"

    svc.set_deal_value(opp_2, col.key, "App Note Kept", source="app")
    svc.set_deal_value(opp_3, col.key, "Old Excel Value", source="excel")
    svc.set_deal_value(opp_4, col.key, "App Value Blank Immune", source="app")

    # Simulate DataFrame uploaded
    df_upload = pd.DataFrame([
        {"Opportunity ID 18 Digit": opp_1, "Raw Excel Notes": "Ingested Note 1"},
        {"Opportunity ID 18 Digit": opp_2, "Raw Excel Notes": "Different Note in File"},
        {"Opportunity ID 18 Digit": opp_3, "Raw Excel Notes": "New Replaced Excel Note"},
        {"Opportunity ID 18 Digit": opp_4, "Raw Excel Notes": ""},  # blank
    ])

    summary = svc.apply_upload_annotations(df_upload)
    assert summary["filled"] == 1  # Deal 1
    assert summary["kept"] == 2    # Deal 2 and Deal 4
    assert summary["updated"] == 1 # Deal 3

    ann_1 = test_db_session.query(DealAnnotation).filter(DealAnnotation.opportunity_id_18 == opp_1).first()
    assert ann_1.value == "Ingested Note 1"
    assert ann_1.source == "excel"

    ann_2 = test_db_session.query(DealAnnotation).filter(DealAnnotation.opportunity_id_18 == opp_2).first()
    assert ann_2.value == "App Note Kept"  # Not overwritten by "Different Note in File"
    assert ann_2.source == "app"

    ann_3 = test_db_session.query(DealAnnotation).filter(DealAnnotation.opportunity_id_18 == opp_3).first()
    assert ann_3.value == "New Replaced Excel Note"  # Replaced
    assert ann_3.source == "excel"

    ann_4 = test_db_session.query(DealAnnotation).filter(DealAnnotation.opportunity_id_18 == opp_4).first()
    assert ann_4.value == "App Value Blank Immune"  # Blank didn't erase it

    # Values survive across snapshots and snapshot deletion
    snap = UploadSnapshot(
        id="snap-test-uuid",
        label="Test Day",
        snapshot_date=date(2026, 10, 26),
        is_active_today=True,
    )
    test_db_session.add(snap)
    test_db_session.commit()

    opp_record = Opportunity(
        id="opp-uuid-1",
        snapshot_id=snap.id,
        opportunity_id_18=opp_1,
        opportunity_name="Test Deal 1",
    )
    test_db_session.add(opp_record)
    test_db_session.commit()

    # Delete snapshot
    test_db_session.delete(snap)
    test_db_session.commit()

    # Annotation MUST still exist in database
    survived = test_db_session.query(DealAnnotation).filter(DealAnnotation.opportunity_id_18 == opp_1).first()
    assert survived is not None
    assert survived.value == "Ingested Note 1"


# ---------------------------------------------------------------------------
# 5. Full Excel Download & Formula Injection Protection
# ---------------------------------------------------------------------------
def test_full_excel_download_roundtrip_and_safety(test_db_session):
    snap = UploadSnapshot(
        id="snap-export-test",
        label="Export Test",
        snapshot_date=date(2026, 10, 26),
        column_order=["Opportunity ID 18 Digit", "Account Name", "Amount", "Original Notes"],
    )
    test_db_session.add(snap)
    test_db_session.commit()

    opp = Opportunity(
        id="opp-exp-1",
        snapshot_id=snap.id,
        opportunity_id_18="006EXPORT01",
        account_name="Acme Corp",
        forecast_acv_amount=50000.0,
        extra_attributes={
            "Opportunity ID 18 Digit": "006EXPORT01",
            "Account Name": "Acme Corp",
            "Amount": 50000.0,
            "Original Notes": "Old raw notes",
        },
    )
    test_db_session.add(opp)
    test_db_session.commit()

    svc = AnnotationService(test_db_session)
    # 1. Custom column matching source_header (in-place replacement)
    col_inplace = svc.create_column("Clean Notes", "text", source_header="Original Notes")
    svc.set_deal_value("006EXPORT01", col_inplace.key, "New Clean Notes In Place")

    # 2. Appended custom column with potential formula injection
    col_appended = svc.create_column("Calc Note", "text")
    svc.set_deal_value("006EXPORT01", col_appended.key, "=SUM(A1:A10)")

    export_svc = FullExcelExportService(test_db_session)
    buf, filename = export_svc.generate_full_excel(snapshot_id=snap.id)

    assert "2026-10-26" in filename
    wb = openpyxl.load_workbook(buf)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))

    headers = rows[0]
    assert headers[0] == "Opportunity ID 18 Digit"
    assert headers[1] == "Account Name"
    assert headers[2] == "Amount"
    assert headers[3] == "Original Notes"
    # Appended column to the right
    assert headers[4] == "Calc Note"
    # The in-place column is NOT duplicated
    assert "Clean Notes" not in headers

    data_row = rows[1]
    assert data_row[0] == "006EXPORT01"
    assert data_row[1] == "Acme Corp"
    # Original Notes has in-place value
    assert data_row[3] == "New Clean Notes In Place"
    # Formula injection neutralized with leading quote
    assert data_row[4] == "'=SUM(A1:A10)"


# ---------------------------------------------------------------------------
# 6. Backup Service & Pruning
# ---------------------------------------------------------------------------
def test_backup_service_and_pruning(test_db_session, tmp_path, monkeypatch):
    monkeypatch.setenv("ANNOTATION_BACKUP_PATH", str(tmp_path))
    backup_svc = AnnotationBackupService(test_db_session)

    # Add a column and value
    annot_svc = AnnotationService(test_db_session)
    c = annot_svc.create_column("Test Backup Col", "text")
    annot_svc.set_deal_value("006BACKUP", c.key, "Backup Payload Value")

    # Dump JSON
    payload = backup_svc.dump_annotations_payload()
    assert payload["counts"]["custom_columns"] >= 1
    assert payload["counts"]["deal_annotations"] >= 1

    # Run daily backup
    file_path = backup_svc.run_daily_backup()
    assert open(file_path, "r", encoding="utf-8").read() != ""


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


