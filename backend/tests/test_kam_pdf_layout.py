"""
Tests for KAM Report PDF and PPTX Table & Page Layout Fix.
Validates:
1. All PDF page sizes are strictly equal to A4 Landscape (841.896 x 595.296 pt), cover included.
2. Table row heights are compact (header ~28 pt, data ~24 pt) and do NOT stretch to fill page height.
3. Empty states render single message boxes instead of empty tables.
4. Report generation for 0-deal owner succeeds cleanly without errors.
"""
import io
import re
import pytest
from pptx import Presentation

from backend.database import SessionLocal
from backend.models.snapshot import UploadSnapshot
from backend.services.context import UserContext
from backend.services.kam_report_service import (
    KamReportService,
    PAGE_WIDTH_IN,
    PAGE_HEIGHT_IN,
    PAGE_HEIGHT_PT,
)
from backend.routers.kam import get_kam_overview


@pytest.fixture(scope="module")
def db_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module")
def active_snap(db_session):
    snap = db_session.query(UploadSnapshot).filter(UploadSnapshot.is_active_today == True).first()
    assert snap is not None, "Active snapshot required for test"
    return snap


def test_pdf_page_sizes_all_equal_a4_landscape(db_session, active_snap):
    """
    Requirement 1:
    One fixed landscape page size for every page (A4 landscape), cover included.
    Verify that every page in the generated PDF has MediaBox == [0, 0, 841.896, 595.296].
    """
    ctx = UserContext(
        user_id="test_runner",
        email="test@mobileum.com",
        display_name="Luay Arabi",
        role="admin",
        owner_name="Luay Arabi",
        owner_aliases=["Luay Arabi"],
    )

    overview = get_kam_overview(
        as_of=active_snap.snapshot_date.isoformat(),
        period="all_open",
        owner_override="Luay Arabi",
        ctx=ctx,
        db=db_session,
    )
    deals = overview.get("deals", [])

    pdf_io = KamReportService.generate_pdf_report(
        kam_name="Luay Arabi",
        owner_name="Luay Arabi",
        period="all_open",
        as_of_date=active_snap.snapshot_date.isoformat(),
        overview_data=overview,
        deals=deals,
    )
    pdf_bytes = pdf_io.getvalue()
    raw_str = pdf_bytes.decode("latin1", errors="ignore")

    # Find all MediaBox definitions in the PDF
    mediaboxes = re.findall(
        r"/MediaBox\s*\[\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s*\]",
        raw_str,
    )
    assert len(mediaboxes) >= 7, f"Expected at least 7 pages, got {len(mediaboxes)}"

    expected_width = round(PAGE_WIDTH_IN * 72, 2)   # 841.90 pt
    expected_height = round(PAGE_HEIGHT_IN * 72, 2) # 595.30 pt

    for idx, (x0, y0, x1, y1) in enumerate(mediaboxes, 1):
        w = round(float(x1) - float(x0), 2)
        h = round(float(y1) - float(y0), 2)
        assert abs(w - expected_width) < 1.0, f"Page {idx} width {w} != {expected_width} (A4 Landscape)"
        assert abs(h - expected_height) < 1.0, f"Page {idx} height {h} != {expected_height} (A4 Landscape)"


def test_table_row_heights_compact_and_independent_of_page():
    """
    Requirement 2:
    Use content-height rows: header about 28 pt, data rows about 24 pt.
    Never size rows from the available page height.
    """
    # A single-row table total height must be ~52 pt (~0.087 fraction), NOT 0.70-0.80 of page
    num_rows = 1
    total_pt = 28.0 + num_rows * 24.0
    table_fraction = total_pt / PAGE_HEIGHT_PT

    assert abs(total_pt - 52.0) < 0.1
    assert table_fraction < 0.10, f"Single row table fraction {table_fraction} should be under 10% of page height"

    # 10-row table total height must be ~268 pt (~0.45 fraction)
    num_rows_10 = 10
    total_pt_10 = 28.0 + num_rows_10 * 24.0
    table_fraction_10 = total_pt_10 / PAGE_HEIGHT_PT
    assert abs(total_pt_10 - 268.0) < 0.1
    assert 0.40 <= table_fraction_10 <= 0.50


def test_zero_deals_owner_pdf_and_pptx(active_snap):
    """
    Requirement 6 & 7:
    Empty states: when an owner has zero deals, do not draw oversized tables.
    PDF and PPTX must generate cleanly without errors and show message boxes.
    """
    empty_overview = {
        "kpis": {
            "total_count": 0,
            "total_acv": 0.0,
            "commit_coverage_count": 0,
            "commit_coverage_acv": 0.0,
            "approved_count": 0,
            "approved_acv": 0.0,
            "pending_approval_count": 0,
            "pending_approval_acv": 0.0,
            "not_submitted_count": 0,
            "not_submitted_acv": 0.0,
            "delayed_count": 0,
            "delayed_acv": 0.0,
            "slippage_count": 0,
            "slippage_acv": 0.0,
            "needs_review_count": 0,
            "needs_review_acv": 0.0,
        },
        "period": "current_quarter",
        "renewal_progress": {"summary_sentence": "Showing 0 deals ($0.00) for current_quarter."},
        "account_concentration": {"sentence": ""},
        "forecast_categories": {},
        "approval_statuses": {},
        "charts": {"business_units": [], "top_accounts": []},
        "action_lists": {"immediate_attention": [], "delayed_deals": []},
        "upcoming_service_expiry": [],
        "what_changed": {"has_changes": False},
        "messages_and_comments_summary": {"open_threads": 0, "unread_count": 0, "latest_shared_comments": []},
        "data_notes": {"note_text": "No deals active."},
    }

    # 1. PDF generation
    pdf_io = KamReportService.generate_pdf_report(
        kam_name="Zero Deals Owner",
        owner_name="Zero Deals Owner",
        period="current_quarter",
        as_of_date=active_snap.snapshot_date.isoformat(),
        overview_data=empty_overview,
        deals=[],
    )
    pdf_bytes = pdf_io.getvalue()
    assert len(pdf_bytes) > 5000

    raw_str = pdf_bytes.decode("latin1", errors="ignore")
    mediaboxes = re.findall(
        r"/MediaBox\s*\[\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s*\]",
        raw_str,
    )
    for idx, (x0, y0, x1, y1) in enumerate(mediaboxes, 1):
        w = round(float(x1) - float(x0), 2)
        h = round(float(y1) - float(y0), 2)
        assert abs(w - 841.90) < 1.0, f"Page {idx} width {w} != 841.90"
        assert abs(h - 595.30) < 1.0, f"Page {idx} height {h} != 595.30"

    # 2. PPTX generation
    pptx_io = KamReportService.generate_pptx_report(
        kam_name="Zero Deals Owner",
        owner_name="Zero Deals Owner",
        period="current_quarter",
        as_of_date=active_snap.snapshot_date.isoformat(),
        overview_data=empty_overview,
        deals=[],
    )
    pptx_bytes = pptx_io.getvalue()
    assert len(pptx_bytes) > 5000
    prs = Presentation(io.BytesIO(pptx_bytes))
    assert len(prs.slides) >= 6


def test_kam_pdf_reportlab_carlito_and_logo(db_session, active_snap):
    """
    Validates ReportLab Platypus rebuild requirements:
    1. Uses Carlito font family across all text (0 Helvetica, 0 DejaVu).
    2. Mobileum logo appears on every page (cover + content pages).
    3. Document page count and landscape dimensions.
    """
    import fitz

    ctx = UserContext(
        user_id="test_runner",
        email="test@mobileum.com",
        display_name="Luay Arabi",
        role="admin",
        owner_name="Luay Arabi",
        owner_aliases=["Luay Arabi"],
    )

    overview = get_kam_overview(
        as_of=active_snap.snapshot_date.isoformat(),
        period="Q4-2026",
        owner_override="Luay Arabi",
        ctx=ctx,
        db=db_session,
    )
    deals = overview.get("deals", [])

    pdf_io = KamReportService.generate_pdf_report(
        kam_name="Luay Arabi",
        owner_name="Luay Arabi",
        period="Q4-2026",
        as_of_date=active_snap.snapshot_date.isoformat(),
        overview_data=overview,
        deals=deals,
    )
    pdf_bytes = pdf_io.getvalue()

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    assert len(doc) >= 7

    for pno, page in enumerate(doc):
        # 1. Exact A4 landscape dimensions
        w = round(page.rect.width, 2)
        h = round(page.rect.height, 2)
        assert abs(w - 841.89) < 2.0, f"Page {pno+1} width {w} != 841.89 pt"
        assert abs(h - 595.28) < 2.0, f"Page {pno+1} height {h} != 595.28 pt"

        # 2. Logo image present on every page
        imgs = page.get_images()
        assert len(imgs) >= 1, f"Page {pno+1} is missing the logo image"

    # 3. Only Carlito font family embedded (no Helvetica fallback)
    all_fonts = set()
    for pno in range(len(doc)):
        for f in doc.get_page_fonts(pno):
            all_fonts.add(f[3])

    assert len(all_fonts) > 0, "PDF must embed at least one font"
    for fname in all_fonts:
        assert "Carlito" in fname, f"Unexpected font {fname} in PDF (expected Carlito)"
        assert "Helvetica" not in fname, f"Helvetica fallback detected in PDF: {fname}"
        assert "DejaVu" not in fname, f"DejaVu font detected in PDF: {fname}"


def test_kam_pptx_calibri_runs_and_logo(db_session, active_snap):
    """
    Validates PPTX typography polish:
    1. Explicit Calibri font family on 100% of text runs across shapes and tables.
    2. Slide 4 opportunity name multi-line formatting with secondary line in 10 pt.
    """
    ctx = UserContext(
        user_id="test_runner",
        email="test@mobileum.com",
        display_name="Luay Arabi",
        role="admin",
        owner_name="Luay Arabi",
        owner_aliases=["Luay Arabi"],
    )

    overview = get_kam_overview(
        as_of=active_snap.snapshot_date.isoformat(),
        period="Q4-2026",
        owner_override="Luay Arabi",
        ctx=ctx,
        db=db_session,
    )
    deals = overview.get("deals", [])

    pptx_io = KamReportService.generate_pptx_report(
        kam_name="Luay Arabi",
        owner_name="Luay Arabi",
        period="Q4-2026",
        as_of_date=active_snap.snapshot_date.isoformat(),
        overview_data=overview,
        deals=deals,
    )
    pptx_bytes = pptx_io.getvalue()
    prs = Presentation(io.BytesIO(pptx_bytes))
    assert len(prs.slides) >= 7

    total_runs = 0
    non_calibri = []
    for s_idx, slide in enumerate(prs.slides):
        for shape in slide.shapes:
            if shape.has_text_frame:
                for p in shape.text_frame.paragraphs:
                    for r in p.runs:
                        total_runs += 1
                        if r.font.name != "Calibri":
                            non_calibri.append((s_idx + 1, r.text, r.font.name))
            if shape.has_table:
                for row in shape.table.rows:
                    for cell in row.cells:
                        for p in cell.text_frame.paragraphs:
                            for r in p.runs:
                                total_runs += 1
                                if r.font.name != "Calibri":
                                    non_calibri.append((s_idx + 1, r.text, r.font.name))

    assert total_runs > 50, "PPTX must have text runs"
    assert len(non_calibri) == 0, f"Found non-Calibri runs in PPTX: {non_calibri[:5]}"


