import io
import pytest
import openpyxl
from pptx import Presentation
from fastapi.testclient import TestClient
from backend.main import app
from backend.database import SessionLocal
from backend.models.snapshot import UploadSnapshot
from backend.services.scopes import FilterSpec
from backend.services.v2_overview_service import V2OverviewService
from backend.services.context import ADMIN_CONTEXT

client = TestClient(app)


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def active_snap(db):
    snap = db.query(UploadSnapshot).filter(UploadSnapshot.is_active_today == True).first()
    assert snap is not None, "Active snapshot required in database"
    return snap


def test_pptx_export_current_quarter_renewals(active_snap, db):
    ov_svc = V2OverviewService(db)
    fs = FilterSpec(sales_types=["Renewals"], period="current_quarter", include_deleted_lost=False)
    gt = ov_svc.get_summary(ADMIN_CONTEXT, as_of=active_snap.snapshot_date.isoformat(), filter_spec=fs)
    exp_cnt = gt["total"]["count"]
    exp_acv = gt["total"]["acv"]

    r = client.get(f"/api/export/pptx?snapshot_id={active_snap.id}&scope=renewals&period=current_quarter")
    assert r.status_code == 200
    prs = Presentation(io.BytesIO(r.content))
    assert len(prs.slides) == 24, "PPTX must contain 24 slides"

    # Slide 2 table
    s2 = prs.slides[1]
    tables = [s.table for s in s2.shapes if s.has_table]
    assert len(tables) > 0, "Slide 2 must have an expiry table"
    tbl = tables[0]

    parent_acv = float(tbl.cell(1, 2).text.replace(",", "").replace("$", "").strip())
    parent_cnt = int(tbl.cell(1, 3).text.replace(",", "").strip())

    assert parent_cnt == exp_cnt, f"Slide 2 count mismatch: {parent_cnt} vs {exp_cnt}"
    assert abs(parent_acv - exp_acv) < 1.0, f"Slide 2 ACV mismatch: {parent_acv} vs {exp_acv}"


def test_excel_export_current_quarter_renewals(active_snap, db):
    ov_svc = V2OverviewService(db)
    fs = FilterSpec(sales_types=["Renewals"], period="current_quarter", include_deleted_lost=False)
    gt = ov_svc.get_summary(ADMIN_CONTEXT, as_of=active_snap.snapshot_date.isoformat(), filter_spec=fs)
    exp_cnt = gt["total"]["count"]
    exp_acv = gt["total"]["acv"]

    r = client.get(f"/api/export/excel?snapshot_id={active_snap.id}&scope=renewals&period=current_quarter")
    assert r.status_code == 200
    wb = openpyxl.load_workbook(io.BytesIO(r.content))
    assert len(wb.sheetnames) >= 10, f"Excel must have at least 10 sheets, got {len(wb.sheetnames)}"

    # Sheet 1 totals
    ws1 = wb[wb.sheetnames[0]]
    sheet1_acv = ws1.cell(2, 3).value
    sheet1_cnt = ws1.cell(2, 4).value

    assert sheet1_cnt == exp_cnt, f"Sheet 1 count mismatch: {sheet1_cnt} vs {exp_cnt}"
    assert abs((sheet1_acv or 0) - exp_acv) < 1.0, f"Sheet 1 ACV mismatch: {sheet1_acv} vs {exp_acv}"


def test_data_explorer_export_xlsx_and_csv(active_snap):
    # XLSX Export
    payload = {
        "filter_spec": {
            "period": "current_quarter",
            "sales_types": ["Renewals"],
            "as_of": active_snap.snapshot_date.isoformat(),
        },
        "filters": [],
        "format": "xlsx",
    }
    r = client.post("/api/v2/explorer/export", json=payload)
    assert r.status_code == 200, f"XLSX export failed: {r.status_code} {r.text}"
    wb = openpyxl.load_workbook(io.BytesIO(r.content))
    ws = wb.active
    # Row 1 is header, followed by data rows
    assert ws.max_row == 332, f"Expected 332 rows (1 header + 331 deals), got {ws.max_row}"

    # CSV Export
    payload["format"] = "csv"
    r_csv = client.post("/api/v2/explorer/export", json=payload)
    assert r_csv.status_code == 200, f"CSV export failed: {r_csv.status_code} {r_csv.text}"
    assert len(r_csv.content) > 1000, "CSV export should contain full deal records"

