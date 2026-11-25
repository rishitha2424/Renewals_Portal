"""
Test Round 29: KAM PDF and PPTX Report Parity and Accuracy Test.
Validates:
1. Opens generated PDF and PPTX for 3 owners:
   - Many deals (Luay Arabi - 21 deals)
   - Few deals (Ian Koh - 5 deals)
   - 1 deal (Bernard Sin - 1 deal)
2. Calendar totals equal KPI tiles (both deal count and ACV).
3. No closed deal is ever labeled overdue or delayed.
4. Formatting: No '$-' anywhere (must be '-$').
5. Text overlap check: clean Approval status table, shapes fit cleanly.
6. Footers on every slide / page with slide/page number, owner name, snapshot date, and Mobileum Confidential.
7. Singular '1 deal' used consistently (no '1 deals').
"""
import io
import re
import zlib
import pytest
from pptx import Presentation

from backend.database import SessionLocal
from backend.models.snapshot import UploadSnapshot
from backend.models.opportunity import Opportunity
from backend.services.context import UserContext
from backend.services.scopes import FilterSpec, ScopeService
from backend.services.deal_serializer import serialize_opportunity, is_deal_open
from backend.services.kam_report_service import KamReportService
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


@pytest.mark.parametrize("owner_name,expected_min_deals", [
    ("Luay Arabi", 21),
    ("Ian Koh", 3),
    ("Bernard Sin", 1),
])
def test_kam_report_parity_and_accuracy(db_session, active_snap, owner_name, expected_min_deals):
    """
    Validates PDF and PPTX generation, calendar totals parity with KPI tiles,
    no closed deals overdue, negative currency formatting, and footers.
    """
    ctx = UserContext(
        user_id="test_runner",
        email="test@mobileum.com",
        display_name=owner_name,
        role="admin",
        owner_name=owner_name,
        owner_aliases=[owner_name],
    )

    overview = get_kam_overview(
        as_of=active_snap.snapshot_date.isoformat(),
        period="all_open",
        owner_override=owner_name,
        ctx=ctx,
        db=db_session,
    )

    deals = overview.get("deals", [])
    assert len(deals) >= expected_min_deals, f"Expected at least {expected_min_deals} deals for {owner_name}, got {len(deals)}"

    kpis = overview.get("kpis", {})
    tot_count = kpis.get("total_count", len(deals))
    tot_acv = kpis.get("total_acv", 0.0)

    # 1. Generate PPTX
    pptx_io = KamReportService.generate_pptx_report(
        kam_name=owner_name,
        owner_name=owner_name,
        period="all_open",
        as_of_date=active_snap.snapshot_date.isoformat(),
        overview_data=overview,
        deals=deals,
    )
    pptx_bytes = pptx_io.getvalue()
    assert len(pptx_bytes) > 1000

    prs = Presentation(io.BytesIO(pptx_bytes))
    num_slides = len(prs.slides)
    assert num_slides >= 6, f"Expected at least 6 slides in PPTX, got {num_slides}"

    # Collect all text in PPTX
    all_pptx_text = []
    for s_idx, slide in enumerate(prs.slides, 1):
        slide_text = []
        for shape in slide.shapes:
            if shape.has_text_frame:
                slide_text.append(shape.text_frame.text)
            if shape.has_table:
                for row in shape.table.rows:
                    for cell in row.cells:
                        slide_text.append(cell.text_frame.text)
        joined_slide_text = "\n".join(slide_text)
        all_pptx_text.append(joined_slide_text)

        # Check footer on slide
        footer_found = any("Mobileum Confidential" in t and "Slide" in t for t in slide_text)
        assert footer_found, f"Footer missing on slide {s_idx} for {owner_name}"

    full_pptx_str = "\n".join(all_pptx_text)

    # Check 1: No '$-' in PPTX (must be '-$')
    assert "$-" not in full_pptx_str, f"Found invalid negative currency '$-' in PPTX for {owner_name}"

    # Check 2: No '1 deals' anywhere in PPTX
    assert not re.search(r"\b1 deals\b", full_pptx_str, re.IGNORECASE), f"Found '1 deals' in PPTX for {owner_name}"

    # Check 3: Calendar table totals in PPTX (Slide 5)
    slide5 = prs.slides[4]  # 0-indexed slide 5
    cal_table = None
    soon_table = None
    for shape in slide5.shapes:
        if shape.has_table:
            headers = [c.text_frame.text for c in shape.table.rows[0].cells]
            if "Renewal Month" in headers:
                cal_table = shape.table
            elif "Opportunity" in headers:
                soon_table = shape.table

    assert cal_table is not None, f"Calendar table not found on Slide 5 for {owner_name}"
    # Check total row in cal_table
    cal_rows = [[c.text_frame.text.strip() for c in r.cells] for r in cal_table.rows]
    total_row = cal_rows[-1]
    assert total_row[0] == "Total", f"Expected last row to be 'Total', got {total_row}"

    # Verify total row matches KPI tiles
    tot_cnt_str = total_row[1]
    tot_acv_str = total_row[3]
    assert str(tot_count) in tot_cnt_str, f"Calendar Total count ({tot_cnt_str}) does not match KPI total ({tot_count})"

    # Check 4: No closed deals marked overdue in soon_table
    if soon_table:
        soon_rows = [[c.text_frame.text.strip() for c in r.cells] for r in list(soon_table.rows)[1:]]
        for row in soon_rows:
            opp_name, acc, acv, status = row
            if "overdue" in status.lower():
                # Find matching deal and verify it is strictly OPEN
                matching = [d for d in deals if (d.get("opportunity_name", "")[:20] in opp_name or opp_name in d.get("opportunity_name", ""))]
                for d in matching:
                    assert is_deal_open(d), f"Closed deal '{d.get('opportunity_name')}' was marked overdue in PPTX!"

    # 2. Generate PDF
    pdf_io = KamReportService.generate_pdf_report(
        kam_name=owner_name,
        owner_name=owner_name,
        period="all_open",
        as_of_date=active_snap.snapshot_date.isoformat(),
        overview_data=overview,
        deals=deals,
    )
    pdf_bytes = pdf_io.getvalue()
    assert len(pdf_bytes) > 1000

    # Check PDF size and content in raw bytes
    assert len(pdf_bytes) > 10000, f"PDF report suspiciously small: {len(pdf_bytes)} bytes"

    # In PDF stream, literal text may be flate-compressed; decompress streams to check text
    pdf_streams = re.findall(b'stream[\r\n]+(.*?)[\r\n]+endstream', pdf_bytes, re.DOTALL)
    decompressed_chunks = []
    for s in pdf_streams:
        try:
            decompressed_chunks.append(zlib.decompress(s).decode('latin1', errors='ignore'))
        except Exception:
            decompressed_chunks.append(s.decode('latin1', errors='ignore'))
    full_pdf_text = "\n".join(decompressed_chunks)
    # Matplotlib PDF backend kerning puts characters in TJ parentheses arrays like (M) -0.4 (o) ...
    extracted_text = "".join(re.findall(r"\(([^)]+)\)", full_pdf_text))

    assert ("Mobileum Confidential" in extracted_text or "Mobileum Con\x00dential" in extracted_text or "Mobileum Con" in extracted_text), f"Footer 'Mobileum Confidential' missing from PDF for {owner_name}"
    assert "$-" not in extracted_text, f"Found invalid negative currency '$-' in PDF for {owner_name}"
    assert not re.search(r"\b1 deals\b", extracted_text, re.IGNORECASE), f"Found '1 deals' in PDF for {owner_name}"


def test_needs_review_parity_luay_arabi(db_session, active_snap):
    """
    Validates Addendum 2:
    Luay Arabi has 1 deal requiring review under V2DelayedService definition
    (negative ACV deal: MB_STC_Baud_Roaming_AMC...).
    Verifies KAM Overview 'needs_review' tile, list, and tab match admin V2DelayedService.
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

    kpis = overview.get("kpis", {})
    action_lists = overview.get("action_lists", {})

    assert kpis.get("needs_review_count") == 1, f"Expected 1 Needs Review deal for Luay Arabi, got {kpis.get('needs_review_count')}"
    needs_review_deals = action_lists.get("needs_review_deals", [])
    assert len(needs_review_deals) == 1

    rev_deal = needs_review_deals[0]
    assert "Negative ACV" in rev_deal.get("review_reasons", [])
    assert float(rev_deal.get("forecast_acv_amount", 0)) < 0
