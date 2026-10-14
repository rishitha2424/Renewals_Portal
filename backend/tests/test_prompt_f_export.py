"""
test_prompt_f_export.py — validates Prompt F requirements for PPTX and Excel exports.
Asserts:
  - Oct 7 PPTX with scope=renewals:
      - Total: 348 deals, $40,068,990.09
      - Commit: 308 deals, $30,349,636.71
      - Best Case: 34 deals, $9,456,843.36
      - Pipeline: 1 deal, $49,737.62
      - Not yet proposed (Blank): 5 deals, $212,772.40
      - Deltas: yesterday +2 / +$476,219.18; last week +14 / +$904,132.33
      - No text or table cell contains "Q3" or "3,093"
  - Oct 7 PPTX with scope=full:
      - 3,093 deals and $451,999,230
  - Oct 7 Excel with scope=renewals:
      - Sheet 1 title is "Expiry Q4 Summary"
      - Grand Total: 348 deals, $40,068,990.09
      - Matches PPTX numbers
"""
import io
import pytest
from pptx import Presentation
import openpyxl
from fastapi.testclient import TestClient
from datetime import date

from backend.main import app
from backend.database import get_db, SessionLocal
from backend.models.snapshot import UploadSnapshot
from sqlalchemy.orm import sessionmaker


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def test_pptx_oct7_renewals_scope(client):
    db = SessionLocal()
    try:
        snap = db.query(UploadSnapshot).filter(UploadSnapshot.snapshot_date == date(2026, 10, 7)).first()
        assert snap is not None, "Snapshot for 2026-10-07 must exist"
        snap_id = snap.id
    finally:
        db.close()

    res = client.get(f"/api/export/pptx?snapshot_id={snap_id}&scope=renewals")
    assert res.status_code == 200, res.text
    prs = Presentation(io.BytesIO(res.content))
    assert len(prs.slides) == 24

    # Check Slide 2
    s2 = prs.slides[1]
    title_text = s2.shapes.title.text if s2.shapes.title else ""
    assert "Expiry Q4" in title_text

    tbl2 = [sh for sh in s2.shapes if sh.name.startswith("Expiry pivot table")][0].table
    # Parent row: Q4-2026
    r1 = [tbl2.cell(1, c).text_frame.text.strip().replace(",", "") for c in range(8)]
    assert r1[0] == "Q4-2026"
    assert "40068990.09" in r1[2]
    assert r1[3] == "348"
    assert "476219.18" in r1[4]
    assert r1[5] == "2"
    assert "904132.33" in r1[6]
    assert r1[7] == "14"

    # Category rows
    cats = {}
    for r_idx in range(2, 6):
        c_label = tbl2.cell(r_idx, 1).text_frame.text.strip()
        c_acv = tbl2.cell(r_idx, 2).text_frame.text.strip().replace(",", "")
        c_cnt = tbl2.cell(r_idx, 3).text_frame.text.strip()
        cats[c_label] = (c_acv, c_cnt)

    assert "30349636.71" in cats["Commit"][0] and cats["Commit"][1] == "308"
    assert "9456843.36" in cats["Best Case"][0] and cats["Best Case"][1] == "34"
    assert "49737.62" in cats["Pipeline"][0] and cats["Pipeline"][1] == "1"
    assert "212772.40" in cats["Not yet proposed"][0] and cats["Not yet proposed"][1] == "5"

    # Grand Total row
    gt_row = [tbl2.cell(6, c).text_frame.text.strip().replace(",", "") for c in range(8)]
    assert gt_row[0] == "Grand Total"
    assert "40068990.09" in gt_row[2]
    assert gt_row[3] == "348"
    assert "476219.18" in gt_row[4]
    assert gt_row[5] == "2"
    assert "904132.33" in gt_row[6]
    assert gt_row[7] == "14"

    # Check Slide 4
    s4 = prs.slides[3]
    tbl4 = [sh for sh in s4.shapes if sh.name.startswith("Forecast category table")][0].table
    r_tot = [tbl4.cell(6, c).text_frame.text.strip().replace(",", "") for c in range(6)]
    assert r_tot[0] == "Total"
    assert r_tot[1] == "348"
    assert "40068990" in r_tot[2]
    assert "+2" in r_tot[4]
    assert "+476219" in r_tot[5]

    # Rule: No slide text or cell may contain "Q3" or "3,093" in Oct 7 renewals PPTX
    for i, slide in enumerate(prs.slides):
        for sp in slide.shapes:
            if sp.has_text_frame:
                for p in sp.text_frame.paragraphs:
                    assert "Q3" not in p.text, f"Found Q3 on slide {i+1}: {p.text}"
                    assert "3,093" not in p.text and "3093" not in p.text, f"Found 3,093 on slide {i+1}: {p.text}"
            if sp.has_table:
                for r in sp.table.rows:
                    for c in r.cells:
                        assert "Q3" not in c.text, f"Found Q3 in table on slide {i+1}: {c.text}"
                        assert "3,093" not in c.text and "3093" not in c.text, f"Found 3,093 in table on slide {i+1}: {c.text}"


def test_pptx_oct7_full_scope(client):
    db = SessionLocal()
    try:
        snap = db.query(UploadSnapshot).filter(UploadSnapshot.snapshot_date == date(2026, 10, 7)).first()
        assert snap is not None
        snap_id = snap.id
    finally:
        db.close()

    res = client.get(f"/api/export/pptx?snapshot_id={snap_id}&scope=full")
    assert res.status_code == 200, res.text
    prs = Presentation(io.BytesIO(res.content))

    # Slide 4 total row should reflect all 3,093 deals / $451,999,230
    s4 = prs.slides[3]
    tbl4 = [sh for sh in s4.shapes if sh.name.startswith("Forecast category table")][0].table
    r_tot = [tbl4.cell(6, c).text_frame.text.strip().replace(",", "") for c in range(6)]
    assert r_tot[0] == "Total"
    assert r_tot[1] == "3093"
    assert "451999230" in r_tot[2]


def test_excel_oct7_renewals_scope(client):
    db = SessionLocal()
    try:
        snap = db.query(UploadSnapshot).filter(UploadSnapshot.snapshot_date == date(2026, 10, 7)).first()
        assert snap is not None
        snap_id = snap.id
    finally:
        db.close()

    res = client.get(f"/api/export/excel?snapshot_id={snap_id}&scope=renewals")
    assert res.status_code == 200, res.text
    wb = openpyxl.load_workbook(io.BytesIO(res.content))

    assert wb.sheetnames[0] == "Expiry Q4 Summary"
    ws1 = wb["Expiry Q4 Summary"]

    # Row 2 is Q4-2026 parent row
    assert ws1.cell(2, 1).value == "Q4-2026"
    assert round(float(ws1.cell(2, 3).value), 2) == 40068990.09
    assert int(ws1.cell(2, 4).value) == 348
    assert round(float(ws1.cell(2, 5).value), 2) == 476219.18
    assert int(ws1.cell(2, 6).value) == 2
    assert round(float(ws1.cell(2, 7).value), 2) == 904132.33
    assert int(ws1.cell(2, 8).value) == 14

    # Grand Total row (Row 7)
    assert ws1.cell(7, 1).value == "Grand Total"
    assert round(float(ws1.cell(7, 3).value), 2) == 40068990.09
    assert int(ws1.cell(7, 4).value) == 348

    # Sheet 4 (Forecast Category Summary)
    ws4 = wb["Forecast Category Summary"]
    assert ws4.cell(7, 1).value == "Total"
    assert int(ws4.cell(7, 2).value) == 348
    assert round(float(ws4.cell(7, 3).value), 2) == 40068990.09
    assert int(ws4.cell(7, 6).value) == 2
    assert round(float(ws4.cell(7, 7).value), 2) == 476219.18
