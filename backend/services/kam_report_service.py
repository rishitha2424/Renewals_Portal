"""
KAM Report Generation Service (Rebuilt with ReportLab Platypus & Polished PPTX).
Generates strictly-scoped, professionally styled PowerPoint (.pptx)
and multi-page PDF (.pdf) reports for a Key Account Manager's portfolio.
Matches the KAM Overview:
- Header shows full date labels with year (Data date & Compare to) and period
- Slide/Page 1: Cover slide (A4 Landscape, consistent margins, Mobileum branding)
- Slide/Page 2: Summary tiles (4x2 grid of equal cards) + progress + insights + region line
- Slide/Page 3: Forecast & Approval split + BU split + Top accounts (compact tables)
- Slide/Page 4: Portfolio Action Center (open deals only)
- Slide/Page 5: Deal Tracker (Monthly Calendar + Closing soon / Overdue)
- Slide/Page 6: Upcoming Service Expiry & Contract Expiry Explanation
- Slide/Page 7: What Changed (conditional if changes exist)
- Slide/Page 8: Messages, Comments & Data Notes
- Footer on every page/slide with page number, owner name, snapshot date, and Confidential notice.
"""
from __future__ import annotations

import io
import logging
import textwrap
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, List, Dict, Optional, Tuple

# PPTX styling & generation
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

# PDF generation via ReportLab Platypus
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_RIGHT, TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Table,
    TableStyle,
    Spacer,
    PageBreak,
)
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily
from PIL import Image as PILImage

from backend.services.deal_serializer import is_deal_open, is_deal_closed, is_deal_overdue
from backend.utils.excel_parser import parse_excel_date

log = logging.getLogger(__name__)

# Mobileum Brand Palette (PPTX RGBColor)
COLOR_NAVY = RGBColor(18, 40, 76)       # #12284C
COLOR_BLUE = RGBColor(0, 163, 173)      # #00A3AD (Teal / Cyan accent)
COLOR_DARK_BLUE = RGBColor(27, 54, 93)  # #1B365D
COLOR_GRAY = RGBColor(100, 116, 139)    # Slate
COLOR_LIGHT_BG = RGBColor(248, 250, 252)
COLOR_WHITE = RGBColor(255, 255, 255)
COLOR_AMBER = RGBColor(217, 119, 6)
COLOR_ROSE = RGBColor(225, 29, 72)
COLOR_EMERALD = RGBColor(16, 185, 129)

# ReportLab Colors
HEX_NAVY = colors.HexColor("#12284C")
HEX_BLUE = colors.HexColor("#00A3AD")
HEX_DARK_BLUE = colors.HexColor("#1B365D")
HEX_SLATE = colors.HexColor("#64748B")
HEX_LIGHT_BG = colors.HexColor("#F8FAFC")
HEX_GRID = colors.HexColor("#E2E8F0")
HEX_WHITE = colors.HexColor("#FFFFFF")
HEX_AMBER = colors.HexColor("#D97706")
HEX_ROSE = colors.HexColor("#E11D48")
HEX_EMERALD = colors.HexColor("#10B981")
HEX_TEXT_DARK = colors.HexColor("#0F172A")
HEX_TEAL_DARK = colors.HexColor("#0D9488")
HEX_MUTED_SLATE = colors.HexColor("#334155")
HEX_BORDER_SLATE = colors.HexColor("#CBD5E1")
HEX_PROGRESS_BG = colors.HexColor("#F1F5F9")
HEX_REGIONAL_BG = colors.HexColor("#F0FDFA")
HEX_REGIONAL_BORDER = colors.HexColor("#99F6E4")
HEX_CAPTION_BG = colors.HexColor("#F0F9FF")
HEX_CAPTION_BORDER = colors.HexColor("#BAE6FD")
HEX_CAPTION_TEXT = colors.HexColor("#0369A1")

# A4 Landscape Page Dimensions (Points)
PAGE_WIDTH_PT, PAGE_HEIGHT_PT = landscape(A4)  # 841.89 pt x 595.28 pt
PAGE_WIDTH_IN = PAGE_WIDTH_PT / 72.0
PAGE_HEIGHT_IN = PAGE_HEIGHT_PT / 72.0
MARGIN_PT = 36.0
CONTENT_WIDTH_PT = PAGE_WIDTH_PT - 2 * MARGIN_PT  # 769.89 pt
GAP_PT = 18.0
TWO_UP_WIDTH_PT = (CONTENT_WIDTH_PT - GAP_PT) / 2.0  # 375.945 pt

# Font configuration
FONTS_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"
REGULAR_TTF = FONTS_DIR / "Carlito-Regular.ttf"
BOLD_TTF = FONTS_DIR / "Carlito-Bold.ttf"
ITALIC_TTF = FONTS_DIR / "Carlito-Italic.ttf"
BOLDITALIC_TTF = FONTS_DIR / "Carlito-BoldItalic.ttf"

_FONTS_REGISTERED = False


def _register_carlito_fonts():
    global _FONTS_REGISTERED
    if _FONTS_REGISTERED:
        return
    try:
        import reportlab.rl_config
        if REGULAR_TTF.exists() and BOLD_TTF.exists():
            pdfmetrics.registerFont(TTFont("Carlito", str(REGULAR_TTF)))
            pdfmetrics.registerFont(TTFont("Carlito-Bold", str(BOLD_TTF)))
            if ITALIC_TTF.exists():
                pdfmetrics.registerFont(TTFont("Carlito-Italic", str(ITALIC_TTF)))
            if BOLDITALIC_TTF.exists():
                pdfmetrics.registerFont(TTFont("Carlito-BoldItalic", str(BOLDITALIC_TTF)))
            registerFontFamily(
                "Carlito",
                normal="Carlito",
                bold="Carlito-Bold",
                italic="Carlito-Italic" if ITALIC_TTF.exists() else "Carlito",
                boldItalic="Carlito-BoldItalic" if BOLDITALIC_TTF.exists() else "Carlito-Bold",
            )
            reportlab.rl_config.canvas_base_font = "Carlito"
            _FONTS_REGISTERED = True
    except Exception as e:
        log.warning(f"Failed to register Carlito fonts: {e}")


def _resolve_logo_path() -> Optional[str]:
    from backend.config import settings
    # 1. Config path
    if hasattr(settings, "REPORT_LOGO_PATH") and settings.REPORT_LOGO_PATH:
        p = Path(settings.REPORT_LOGO_PATH)
        if p.exists() and p.is_file():
            return str(p)
    # 2. backend/assets/logo.png
    p = Path(__file__).resolve().parent.parent / "assets" / "logo.png"
    if p.exists() and p.is_file():
        return str(p)
    # 3. ROOT/assets/logo.png
    p = Path(__file__).resolve().parent.parent.parent / "assets" / "logo.png"
    if p.exists() and p.is_file():
        return str(p)
    return None


def _format_currency(val: float | int | None) -> str:
    if val is None:
        return "$0.00"
    v = float(val)
    if v < 0:
        return f"-${abs(v):,.2f}"
    return f"${v:,.2f}"


def _format_date_with_year(d_str: str | None) -> str:
    if not d_str:
        return "—"
    try:
        clean = d_str[:10]
        dt = datetime.fromisoformat(clean)
        return dt.strftime("%b %d, %Y")
    except Exception:
        return str(d_str)


def _wrap_text(text: Any, max_len: int = 24, max_lines: int = 2) -> str:
    """Wrap text to avoid truncation, keeping it to at most max_lines."""
    s = str(text or "").strip()
    if not s or len(s) <= max_len:
        return s
    lines = textwrap.wrap(s, width=max_len)
    if len(lines) > max_lines:
        line1 = lines[0]
        line2 = " ".join(lines[1:])
        if len(line2) > max_len:
            line2 = line2[:max_len - 1] + "…"
        return f"{line1}\n{line2}"
    return "\n".join(lines)


def _is_numeric_header(h: str) -> bool:
    """Return True if column header indicates numeric content."""
    h_low = h.lower().strip()
    if any(k in h_low for k in ["name", "account", "opportunity", "type", "category", "status", "stage", "author", "comment", "details", "timeline", "date", "reason", "month"]):
        return False
    return any(k in h_low for k in ["acv", "deal", "count", "impact", "diff", "amount", "value", "$", "%", "days", "time to expiry"])


def _is_center_header(h: str) -> bool:
    """Return True if column header indicates dates or timeline content."""
    h_low = h.lower().strip()
    return any(k in h_low for k in ["close date", "service expiry date", "timeline", "date"])


class NumberedCanvas(canvas.Canvas):
    """
    Two-pass ReportLab Canvas that computes total page count (Page n of N),
    renders the cover page with vector branding and dark background on page 1,
    and draws the header logo and centered footer on all content pages.
    """
    def __init__(self, *args, **kwargs):
        kwargs["initialFontName"] = "Carlito" if _FONTS_REGISTERED else "Helvetica"
        kwargs["initialFontSize"] = 10
        super().__init__(*args, **kwargs)
        self._saved_page_states = []
        self.owner_name = ""
        self.kam_name = ""
        self.period_display = ""
        self.as_of_formatted = ""
        self.compare_formatted = ""
        self.logo_path = None

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_decorations(num_pages)
            super().showPage()
        super().save()

    def draw_decorations(self, num_pages: int):
        page_num = self._pageNumber
        font_regular = "Carlito" if _FONTS_REGISTERED else "Helvetica"
        font_bold = "Carlito-Bold" if _FONTS_REGISTERED else "Helvetica-Bold"

        if page_num == 1:
            # ---------------------------------------------------------
            # Cover Page: Dark Navy background, teal accent bar, logo, title & metadata
            # ---------------------------------------------------------
            self.saveState()
            self.setFillColor(HEX_NAVY)
            self.rect(0, 0, PAGE_WIDTH_PT, PAGE_HEIGHT_PT, fill=1, stroke=0)

            # Teal accent bar
            self.setFillColor(HEX_BLUE)
            self.rect(42, 110, 4, 380, fill=1, stroke=0)

            # Cover Logo (large)
            if self.logo_path and Path(self.logo_path).exists():
                try:
                    with PILImage.open(self.logo_path) as im:
                        orig_w, orig_h = im.size
                        logo_w = (orig_w / orig_h) * 50.0
                    self.drawImage(
                        self.logo_path,
                        60,
                        430,
                        width=logo_w,
                        height=50,
                        preserveAspectRatio=True,
                        mask="auto",
                    )
                except Exception as e:
                    log.warning(f"Error drawing cover logo: {e}")

            # Organization / Category
            self.setFillColor(HEX_BLUE)
            self.setFont(font_bold, 13)
            self.drawString(60, 395, "MOBILEUM HORIZON RENEWALS")

            # Report Title
            self.setFillColor(HEX_WHITE)
            self.setFont(font_bold, 32)
            self.drawString(60, 345, "Renewal Portfolio Report")

            # Owner
            self.setFont(font_regular, 18)
            owner_label = f"Owner: {self.owner_name}"
            if self.kam_name and self.kam_name != self.owner_name:
                owner_label += f" ({self.kam_name})"
            self.drawString(60, 305, owner_label)

            # Metadata scope line
            self.setFillColor(colors.HexColor("#94A3B8"))
            self.setFont(font_regular, 11)
            gen_date = datetime.now(timezone.utc).strftime("%b %d, %Y")
            meta_str = (
                f"Period: {self.period_display}   |   "
                f"Data date: {self.as_of_formatted}   |   "
                f"Compare to: {self.compare_formatted}   |   "
                f"Generated: {gen_date}"
            )
            self.drawString(60, 255, meta_str)

            # Confidential notice
            self.setFillColor(HEX_SLATE)
            self.setFont(font_regular, 8)
            self.drawString(60, 40, "Mobileum Confidential")
            self.restoreState()

        else:
            # ---------------------------------------------------------
            # Content Page: Top-right header logo & centered footer
            # ---------------------------------------------------------
            self.saveState()
            if self.logo_path and Path(self.logo_path).exists():
                try:
                    with PILImage.open(self.logo_path) as im:
                        orig_w, orig_h = im.size
                        logo_w = (orig_w / orig_h) * 32.0
                    self.drawImage(
                        self.logo_path,
                        PAGE_WIDTH_PT - MARGIN_PT - logo_w,
                        PAGE_HEIGHT_PT - MARGIN_PT - 32 + 4,
                        width=logo_w,
                        height=32,
                        preserveAspectRatio=True,
                        mask="auto",
                    )
                except Exception as e:
                    log.warning(f"Error drawing header logo: {e}")

            # Footer
            self.setFont(font_regular, 8)
            self.setFillColor(HEX_SLATE)
            footer_text = (
                f"Page {page_num} of {num_pages}   |   "
                f"Opportunity Owner: {self.owner_name}   |   "
                f"Snapshot Date: {self.as_of_formatted}   |   "
                f"Mobileum Confidential"
            )
            self.drawCentredString(PAGE_WIDTH_PT / 2.0, 20, footer_text)
            self.restoreState()


class KamReportService:
    @classmethod
    def generate_pptx_report(
        cls,
        kam_name: str,
        owner_name: str,
        period: str,
        as_of_date: str,
        overview_data: Dict[str, Any],
        deals: List[Dict[str, Any]],
        compare_as_of_date: Optional[str] = None,
    ) -> io.BytesIO:
        prs = Presentation()
        prs.slide_width = Inches(13.333)
        prs.slide_height = Inches(7.5)
        blank_slide_layout = prs.slide_layouts[6]

        kpis = overview_data.get("kpis") or overview_data.get("total") or {}
        tot_count = kpis.get("total_count", len(deals))
        tot_acv = kpis.get("total_acv", sum(float(d.get("forecast_acv_amount") or 0.0) for d in deals))

        as_of_formatted = _format_date_with_year(as_of_date)
        compare_formatted = _format_date_with_year(compare_as_of_date or overview_data.get("compare_as_of"))
        period_display = overview_data.get("period") or ("All periods" if period in ("all_open", "All open deals", "All periods") else period)

        logo_path = _resolve_logo_path()

        # -------------------------------------------------------------
        # Slide 1: Cover Slide
        # -------------------------------------------------------------
        s1 = prs.slides.add_slide(blank_slide_layout)
        bg = s1.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Inches(13.333), Inches(7.5))
        bg.fill.solid()
        bg.fill.fore_color.rgb = COLOR_NAVY
        bg.line.color.rgb = COLOR_NAVY

        bar = s1.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.8), Inches(1.2), Inches(0.15), Inches(5.0))
        bar.fill.solid()
        bar.fill.fore_color.rgb = COLOR_BLUE
        bar.line.fill.background()

        if logo_path and Path(logo_path).exists():
            try:
                s1.shapes.add_picture(logo_path, Inches(1.2), Inches(1.2), height=Inches(1.0))
            except Exception as e:
                log.warning(f"Error adding PPTX cover logo: {e}")

        txBox = s1.shapes.add_textbox(Inches(1.2), Inches(2.4), Inches(11.0), Inches(3.8))
        tf = txBox.text_frame
        tf.word_wrap = True

        p1 = tf.paragraphs[0]
        p1.text = "MOBILEUM HORIZON RENEWALS"
        p1.font.name = "Calibri"
        p1.font.size = Pt(14)
        p1.font.bold = True
        p1.font.color.rgb = COLOR_BLUE

        p2 = tf.add_paragraph()
        p2.text = "Renewal Portfolio Report"
        p2.font.name = "Calibri"
        p2.font.size = Pt(40)
        p2.font.bold = True
        p2.font.color.rgb = COLOR_WHITE
        p2.space_before = Pt(10)

        p3 = tf.add_paragraph()
        owner_display = f"Owner: {owner_name}"
        if kam_name and kam_name != owner_name:
            owner_display += f" ({kam_name})"
        p3.text = owner_display
        p3.font.name = "Calibri"
        p3.font.size = Pt(22)
        p3.font.color.rgb = COLOR_WHITE
        p3.space_before = Pt(8)

        p4 = tf.add_paragraph()
        p4.text = f"Period: {period_display}   |   Data date: {as_of_formatted}   |   Compare to: {compare_formatted}   |   Generated: {datetime.now(timezone.utc).strftime('%b %d, %Y')}"
        p4.font.name = "Calibri"
        p4.font.size = Pt(13)
        p4.font.color.rgb = RGBColor(148, 163, 184)
        p4.space_before = Pt(20)

        # -------------------------------------------------------------
        # Slide 2: 8 Summary Tiles + Insights + Progress + Region Line
        # -------------------------------------------------------------
        s2 = prs.slides.add_slide(blank_slide_layout)
        cls._add_slide_header(
            s2,
            "Portfolio Summary & Overview",
            f"{owner_name} — Key health metrics, executive observations, and regional footprint for {period_display}",
            logo_path=logo_path,
        )

        rp = overview_data.get("renewal_progress") or {}
        ac_conc = overview_data.get("account_concentration") or {}
        rp_text = rp.get("summary_sentence") or f"Showing {tot_count} {'deal' if tot_count == 1 else 'deals'} ({_format_currency(tot_acv)}) for {period_display}."
        if ac_conc.get("sentence"):
            rp_text += f"  ·  {ac_conc.get('sentence')}"

        prog_box = s2.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(1.3), Inches(11.733), Inches(0.42))
        prog_box.fill.solid()
        prog_box.fill.fore_color.rgb = RGBColor(241, 245, 249)
        prog_box.line.color.rgb = RGBColor(203, 213, 225)
        p_tf = prog_box.text_frame
        p_tf.word_wrap = True
        p_prog = p_tf.paragraphs[0]
        p_prog.text = rp_text
        p_prog.font.name = "Calibri"
        p_prog.font.size = Pt(10.5)
        p_prog.font.bold = True
        p_prog.font.color.rgb = COLOR_NAVY

        appr_2nd_count = kpis.get("approved_2nd_count", 0)
        appr_cnt = kpis.get('approved_count', 0)
        appr_cnt_str = f"{appr_cnt} {'deal' if appr_cnt == 1 else 'deals'}"
        if appr_2nd_count > 0:
            appr_cnt_str += f" (incl. {appr_2nd_count} 2nd)"

        cov_cnt = kpis.get('commit_coverage_count', 0)
        pend_cnt = kpis.get('pending_approval_count', 0)
        nsub_cnt = kpis.get('not_submitted_count', 0)
        del_cnt = kpis.get('delayed_count', 0)
        slip_cnt = kpis.get('slippage_count', 0)
        nrev_cnt = kpis.get('needs_review_count', 0)

        tile_defs = [
            ("MY PORTFOLIO", f"{tot_count} {'deal' if tot_count == 1 else 'deals'}", _format_currency(tot_acv), COLOR_NAVY),
            ("COMMIT COVERAGE", f"{cov_cnt} {'deal' if cov_cnt == 1 else 'deals'}", _format_currency(kpis.get('commit_coverage_acv', 0)), COLOR_BLUE),
            ("APPROVED", appr_cnt_str, _format_currency(kpis.get('approved_acv', 0)), COLOR_EMERALD),
            ("PENDING APPROVAL", f"{pend_cnt} {'deal' if pend_cnt == 1 else 'deals'}", _format_currency(kpis.get('pending_approval_acv', 0)), COLOR_AMBER),
            ("NOT SUBMITTED", f"{nsub_cnt} {'deal' if nsub_cnt == 1 else 'deals'}", _format_currency(kpis.get('not_submitted_acv', 0)), COLOR_GRAY),
            ("DELAYED RENEWALS", f"{del_cnt} {'deal' if del_cnt == 1 else 'deals'}", _format_currency(kpis.get('delayed_acv', 0)), COLOR_ROSE),
            ("SLIPPAGE", f"{slip_cnt} {'deal' if slip_cnt == 1 else 'deals'}", _format_currency(kpis.get('slippage_acv', 0)), COLOR_AMBER),
            ("NEEDS REVIEW", f"{nrev_cnt} {'deal' if nrev_cnt == 1 else 'deals'}", _format_currency(kpis.get('needs_review_acv', 0)), COLOR_DARK_BLUE),
        ]

        left_base = 0.8
        top_base = 1.85
        width = 2.75
        height = 1.22
        gap_x = 0.24
        for i, (label, count_str, acv_str, color) in enumerate(tile_defs):
            r = i // 4
            c = i % 4
            t_left = left_base + c * (width + gap_x)
            t_top = top_base + r * (height + 0.16)

            card = s2.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(t_left), Inches(t_top), Inches(width), Inches(height))
            card.fill.solid()
            card.fill.fore_color.rgb = COLOR_LIGHT_BG
            card.line.color.rgb = RGBColor(226, 232, 240)

            top_bar = s2.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(t_left), Inches(t_top), Inches(width), Inches(0.08))
            top_bar.fill.solid()
            top_bar.fill.fore_color.rgb = color
            top_bar.line.fill.background()

            tbox = s2.shapes.add_textbox(Inches(t_left + 0.12), Inches(t_top + 0.10), Inches(width - 0.24), Inches(height - 0.15))
            tf = tbox.text_frame
            tf.word_wrap = True

            p_lbl = tf.paragraphs[0]
            p_lbl.text = label
            p_lbl.font.name = "Calibri"
            p_lbl.font.size = Pt(11)
            p_lbl.font.bold = True
            p_lbl.font.color.rgb = COLOR_GRAY

            p_acv = tf.add_paragraph()
            p_acv.text = acv_str
            p_acv.font.name = "Calibri"
            p_acv.font.size = Pt(26)
            p_acv.font.bold = True
            p_acv.font.color.rgb = COLOR_NAVY
            p_acv.space_before = Pt(2)

            p_cnt = tf.add_paragraph()
            p_cnt.text = count_str
            p_cnt.font.name = "Calibri"
            p_cnt.font.size = Pt(11)
            p_cnt.font.color.rgb = COLOR_GRAY
            p_cnt.space_before = Pt(1)

        ins_top = 4.65
        ins_box = s2.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(ins_top), Inches(11.733), Inches(1.15))
        ins_box.fill.solid()
        ins_box.fill.fore_color.rgb = RGBColor(241, 245, 249)
        ins_box.line.color.rgb = RGBColor(203, 213, 225)

        ins_tx = s2.shapes.add_textbox(Inches(0.95), Inches(ins_top + 0.06), Inches(11.4), Inches(1.02))
        ins_tf = ins_tx.text_frame
        ins_tf.word_wrap = True

        p_ins_title = ins_tf.paragraphs[0]
        p_ins_title.text = "PORTFOLIO INSIGHTS"
        p_ins_title.font.name = "Calibri"
        p_ins_title.font.size = Pt(11)
        p_ins_title.font.bold = True
        p_ins_title.font.color.rgb = COLOR_NAVY

        insight_cards = overview_data.get("insight_cards") or [
            f"Portfolio contains {tot_count} opportunities totaling {_format_currency(tot_acv)}.",
            f"Approved deals total {kpis.get('approved_count', 0)} worth {_format_currency(kpis.get('approved_acv', 0))}.",
            f"Awaiting approval: {kpis.get('pending_approval_count', 0)} deals worth {_format_currency(kpis.get('pending_approval_acv', 0))}.",
        ]
        for ins in insight_cards[:3]:
            p = ins_tf.add_paragraph()
            p.text = f"•  {ins}"
            p.font.name = "Calibri"
            p.font.size = Pt(11)
            p.font.color.rgb = RGBColor(51, 65, 85)
            p.space_before = Pt(1)

        reg_top = 5.95
        reg_box = s2.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(reg_top), Inches(11.733), Inches(0.85))
        reg_box.fill.solid()
        reg_box.fill.fore_color.rgb = RGBColor(240, 253, 250)
        reg_box.line.color.rgb = RGBColor(153, 246, 228)

        reg_tx = s2.shapes.add_textbox(Inches(0.95), Inches(reg_top + 0.06), Inches(11.4), Inches(0.72))
        reg_tf = reg_tx.text_frame
        reg_tf.word_wrap = True

        p_reg_lbl = reg_tf.paragraphs[0]
        p_reg_lbl.text = "REGIONAL FOOTPRINT"
        p_reg_lbl.font.name = "Calibri"
        p_reg_lbl.font.size = Pt(11)
        p_reg_lbl.font.bold = True
        p_reg_lbl.font.color.rgb = RGBColor(13, 148, 136)

        region_line = overview_data.get("region_line") or {}
        if region_line.get("single_region") and region_line.get("summary_sentence"):
            reg_text = region_line.get("summary_sentence")
        else:
            regions_list = region_line.get("regions") or []
            chips_strs = [r.get("label", "") for r in regions_list if r.get("label")]
            reg_text = "  ·  ".join(chips_strs) if chips_strs else "No region breakdown available."

        p_reg_body = reg_tf.add_paragraph()
        p_reg_body.text = reg_text
        p_reg_body.font.name = "Calibri"
        p_reg_body.font.size = Pt(11)
        p_reg_body.font.color.rgb = RGBColor(15, 23, 42)
        p_reg_body.space_before = Pt(1)

        # -------------------------------------------------------------
        # Slide 3: Forecast, Approvals, BU Split & Top Accounts
        # -------------------------------------------------------------
        s3 = prs.slides.add_slide(blank_slide_layout)
        cls._add_slide_header(
            s3,
            "Forecast, Approvals, Business Units & Top Accounts",
            f"{owner_name} — Pipeline breakdown across approval states, business units, and key client accounts",
            logo_path=logo_path,
        )

        fc_data = overview_data.get("forecast_categories") or {}
        fc_rows = []
        for cat in ["Closed", "Commit", "Best Case", "Pipeline", "Not yet proposed"]:
            cnt = fc_data.get(cat, {}).get("count", 0)
            fc_rows.append([cat, f"{cnt} {'deal' if cnt == 1 else 'deals'}", _format_currency(fc_data.get(cat, {}).get("acv", 0.0))])

        cls._add_table(
            s3,
            left=0.8,
            top=1.8,
            width=5.7,
            headers=["Forecast Category", "Deals", "ACV"],
            rows=fc_rows,
            col_widths=[2.7, 1.3, 1.7],
        )

        st_data = overview_data.get("approval_statuses") or {}
        appr_breakdown = kpis.get("approved_2nd_breakdown")
        appr_cnt = st_data.get("Approved", {}).get("count", 0)
        pend_cnt = st_data.get("Pending Approval", {}).get("count", 0)
        nsub_cnt = st_data.get("Not submitted", {}).get("count", 0)

        cls._add_table(
            s3,
            left=6.8,
            top=1.8,
            width=5.7,
            headers=["Approval Status", "Deals", "ACV"],
            rows=[
                ["Approved", f"{appr_cnt} {'deal' if appr_cnt == 1 else 'deals'}", _format_currency(st_data.get("Approved", {}).get("acv", 0.0))],
                ["Pending Approval", f"{pend_cnt} {'deal' if pend_cnt == 1 else 'deals'}", _format_currency(st_data.get("Pending Approval", {}).get("acv", 0.0))],
                ["Not submitted", f"{nsub_cnt} {'deal' if nsub_cnt == 1 else 'deals'}", _format_currency(st_data.get("Not submitted", {}).get("acv", 0.0))],
            ],
            col_widths=[2.7, 1.3, 1.7],
        )

        if appr_breakdown:
            noteBox = s3.shapes.add_textbox(Inches(6.8), Inches(3.6), Inches(5.7), Inches(0.35))
            p_nt = noteBox.text_frame.paragraphs[0]
            p_nt.text = f"* Note: Approved includes {appr_breakdown}" if not appr_breakdown.startswith("incl.") else f"* Note: {appr_breakdown}"
            p_nt.font.name = "Calibri"
            p_nt.font.size = Pt(10)
            p_nt.font.italic = True
            p_nt.font.color.rgb = COLOR_GRAY

        charts = overview_data.get("charts") or {}
        bu_list = (charts.get("business_units") or [])[:5]
        bu_rows = []
        for b in bu_list:
            cnt = b.get("count", 0)
            bu_rows.append([b.get("bu") or b.get("business_unit") or "Unassigned", f"{cnt} {'deal' if cnt == 1 else 'deals'}", _format_currency(b.get("acv", 0.0))])

        cls._add_table(
            s3,
            left=0.8,
            top=4.3,
            width=5.7,
            headers=["Business Unit", "Deals", "ACV"],
            rows=bu_rows,
            empty_msg="No business units assigned in this portfolio.",
            col_widths=[2.7, 1.3, 1.7],
        )

        acc_list = (charts.get("top_accounts") or [])[:5]
        acc_rows = []
        for a in acc_list:
            cnt = a.get("count", 0)
            acc_rows.append([_wrap_text(a.get("account_name", ""), max_len=26), f"{cnt} {'deal' if cnt == 1 else 'deals'}", _format_currency(a.get("acv", 0.0))])

        cls._add_table(
            s3,
            left=6.8,
            top=4.3,
            width=5.7,
            headers=["Top Accounts", "Deals", "ACV"],
            rows=acc_rows,
            empty_msg="No customer accounts found in this portfolio.",
            col_widths=[2.7, 1.3, 1.7],
        )

        # -------------------------------------------------------------
        # Slide 4: Portfolio Action Center (Open Deals Only)
        # -------------------------------------------------------------
        s4 = prs.slides.add_slide(blank_slide_layout)
        cls._add_slide_header(
            s4,
            "Portfolio Action Center",
            f"{owner_name} — Priority open opportunities requiring attention, awaiting sign-off, or flagged for risk",
            logo_path=logo_path,
        )

        actions = overview_data.get("action_lists", {})
        urgent_candidates = actions.get("immediate_attention") or actions.get("delayed_deals") or []
        urgent = [d for d in urgent_candidates if is_deal_open(d)]
        if not urgent:
            urgent = [d for d in deals if is_deal_open(d) and d.get("approval_status") not in ("Approved", "Approved - 2nd")]
        if not urgent:
            urgent = [d for d in deals if is_deal_open(d)]

        urgent_rows = []
        for d in urgent[:8]:
            urgent_rows.append([
                _wrap_text(d.get("opportunity_name", ""), max_len=30),
                _wrap_text(d.get("account_name", ""), max_len=22),
                str(d.get("forecast_category", "")),
                str(d.get("approval_status", "")),
                _format_currency(d.get("forecast_acv_amount")),
                str(d.get("close_date", ""))[:10],
            ])

        cls._add_table(
            s4,
            left=0.8,
            top=1.8,
            width=11.733,
            headers=["Opportunity Name", "Account", "Forecast", "Status", "ACV", "Close Date"],
            rows=urgent_rows,
            empty_msg="No open opportunities requiring immediate attention. All items are current.",
            col_widths=[3.5, 2.5, 1.4, 1.5, 1.4, 1.433],
        )

        # -------------------------------------------------------------
        # Slide 5: Deal Tracker (Monthly Calendar & Closing Milestones)
        # -------------------------------------------------------------
        s_dt = prs.slides.add_slide(blank_slide_layout)
        cls._add_slide_header(
            s_dt,
            "Deal Tracker & Closing Milestones",
            f"{owner_name} — Monthly renewal schedule, upcoming close deadlines, and overdue portfolio items",
            logo_path=logo_path,
        )

        month_summary: Dict[str, Dict[str, Any]] = {}
        for d in deals:
            cd = (d.get("close_date") or "")[:7] or "Unscheduled"
            if cd not in month_summary:
                month_summary[cd] = {"count": 0, "acv": 0.0, "approved_acv": 0.0}
            month_summary[cd]["count"] += 1
            amt = float(d.get("forecast_acv_amount") or 0.0)
            month_summary[cd]["acv"] += amt
            if d.get("approval_status") in ("Approved", "Approved - 2nd"):
                month_summary[cd]["approved_acv"] += amt

        sorted_m = sorted(month_summary.keys(), key=lambda x: (1 if x == "Unscheduled" else 0, x))
        cal_rows = []
        tot_cnt = 0
        tot_appr = 0.0
        tot_sum_acv = 0.0
        for m in sorted_m:
            info = month_summary[m]
            lbl = m
            if m != "Unscheduled":
                try:
                    lbl = datetime.fromisoformat(f"{m}-01").strftime("%b %Y")
                except Exception:
                    pass
            tot_cnt += info["count"]
            tot_appr += info["approved_acv"]
            tot_sum_acv += info["acv"]
            cnt_str = f"{info['count']} {'deal' if info['count'] == 1 else 'deals'}"
            cal_rows.append([lbl, cnt_str, _format_currency(info["approved_acv"]), _format_currency(info["acv"])])

        tot_cnt_lbl = f"{tot_cnt} {'deal' if tot_cnt == 1 else 'deals'}"
        cal_rows.append(["Total", tot_cnt_lbl, _format_currency(tot_appr), _format_currency(tot_sum_acv)])

        cls._add_table(
            s_dt,
            left=0.8,
            top=1.8,
            width=5.7,
            headers=["Renewal Month", "Deals", "Approved ACV", "Total ACV"],
            rows=cal_rows,
            col_widths=[1.8, 1.1, 1.4, 1.4],
        )

        soon_rows = []
        ref_d_str = as_of_date[:10] if as_of_date else datetime.now(timezone.utc).strftime("%Y-%m-%d")
        try:
            ref_dt = parse_excel_date(ref_d_str)
            for d in sorted(deals, key=lambda x: x.get("close_date") or "9999"):
                if not is_deal_open(d):  # Closed deals NEVER show overdue or delayed
                    continue
                cd_str = (d.get("close_date") or "")[:10]
                if cd_str:
                    cd = parse_excel_date(cd_str)
                    if cd and ref_dt:
                        diff = (cd - ref_dt).days
                        opp_name = _wrap_text(d.get("opportunity_name", ""), max_len=24)
                        acc_name = _wrap_text(d.get("account_name", ""), max_len=18)
                        acv_str = _format_currency(d.get("forecast_acv_amount"))
                        if diff < 0:
                            soon_rows.append([opp_name, acc_name, acv_str, f"{abs(diff)}d overdue"])
                        elif 0 <= diff <= 30:
                            soon_rows.append([opp_name, acc_name, acv_str, f"{diff}d left" if diff > 0 else "Closes today"])
        except Exception as e:
            log.warning(f"Error computing soon_rows: {e}")

        cls._add_table(
            s_dt,
            left=6.8,
            top=1.8,
            width=5.7,
            headers=["Opportunity", "Account", "ACV", "Timeline Status"],
            rows=soon_rows[:8],
            empty_msg="No deals closing in the next 30 days. All renewal deadlines on track.",
            col_widths=[2.1, 1.5, 1.05, 1.05],
        )

        # -------------------------------------------------------------
        # Slide 6: Upcoming Service Expiry & Contract Expiry Explanation
        # -------------------------------------------------------------
        s_exp = prs.slides.add_slide(blank_slide_layout)
        cls._add_slide_header(
            s_exp,
            "Upcoming Service Expiry Schedule",
            f"{owner_name} — Service contracts expiring within the next 60 days",
            logo_path=logo_path,
        )

        upcoming_exp = overview_data.get("upcoming_service_expiry") or []
        exp_rows = []
        for item in upcoming_exp[:8]:
            d = item.get("deal") or item
            exp_rows.append([
                _wrap_text(d.get("opportunity_name", ""), max_len=30),
                _wrap_text(d.get("account_name", ""), max_len=22),
                _format_currency(d.get("forecast_acv_amount")),
                str(item.get("service_expiry_date", ""))[:10],
                str(item.get("days_label", "")),
            ])

        cls._add_table(
            s_exp,
            left=0.8,
            top=1.8,
            width=11.733,
            headers=["Opportunity Name", "Account", "ACV", "Service Expiry Date", "Time to Expiry"],
            rows=exp_rows,
            empty_msg="No upcoming service contract expirations in the next 60 days.",
            col_widths=[3.5, 2.5, 1.7, 2.0, 2.033],
        )

        # Caption note
        caption_box = s_exp.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(6.0), Inches(11.733), Inches(0.65))
        caption_box.fill.solid()
        caption_box.fill.fore_color.rgb = RGBColor(240, 249, 255)
        caption_box.line.color.rgb = RGBColor(186, 230, 253)
        c_tf = caption_box.text_frame
        c_tf.word_wrap = True
        p_c = c_tf.paragraphs[0]
        p_c.text = "Service expiry = end date of the current (expiring) contract. The renewal period starts the next day."
        p_c.font.name = "Calibri"
        p_c.font.size = Pt(11)
        p_c.font.bold = True
        p_c.font.color.rgb = RGBColor(3, 105, 161)

        # -------------------------------------------------------------
        # Slide 7: What Changed (Conditional if changes exist)
        # -------------------------------------------------------------
        what_changed = overview_data.get("what_changed") or {}
        if what_changed.get("has_changes"):
            s5 = prs.slides.add_slide(blank_slide_layout)
            cls._add_slide_header(
                s5,
                "What Changed",
                f"Modifications, movements, and new deals compared to {compare_formatted}",
                logo_path=logo_path,
            )

            change_rows = []
            for nd in (what_changed.get("new_deals") or [])[:4]:
                change_rows.append(["New Deal Added", _wrap_text(nd.get("opportunity_name", ""), max_len=28), _wrap_text(nd.get("account_name", ""), max_len=20), f"+{_format_currency(nd.get('acv'))}", nd.get("stage", "")])
            for ca in (what_changed.get("acv_changes") or [])[:4]:
                diff = ca.get("diff_acv", 0.0)
                diff_str = f"{'+' if diff > 0 else ''}{_format_currency(diff)}"
                change_rows.append(["ACV Change", _wrap_text(ca.get("opportunity_name", ""), max_len=28), _wrap_text(ca.get("account_name", ""), max_len=20), diff_str, f"{_format_currency(ca.get('old_acv'))} → {_format_currency(ca.get('new_acv'))}"])
            for st in (what_changed.get("stage_changes") or [])[:3]:
                change_rows.append(["Stage Change", _wrap_text(st.get("opportunity_name", ""), max_len=28), _wrap_text(st.get("account_name", ""), max_len=20), "—", f"{st.get('old_stage')} → {st.get('new_stage')}"])
            for cat in (what_changed.get("category_changes") or [])[:3]:
                change_rows.append(["Category Change", _wrap_text(cat.get("opportunity_name", ""), max_len=28), _wrap_text(cat.get("account_name", ""), max_len=20), "—", f"{cat.get('old_category')} → {cat.get('new_category')}"])
            for cw in (what_changed.get("closed_won") or [])[:3]:
                change_rows.append(["Closed Won", _wrap_text(cw.get("opportunity_name", ""), max_len=28), _wrap_text(cw.get("account_name", ""), max_len=20), _format_currency(cw.get("acv")), "Won"])
            for rm in (what_changed.get("removed_deals") or [])[:3]:
                change_rows.append(["Removed / Lost", _wrap_text(rm.get("opportunity_name", ""), max_len=28), _wrap_text(rm.get("account_name", ""), max_len=20), f"-{_format_currency(rm.get('acv'))}", rm.get("reason", "")])

            cls._add_table(
                s5,
                left=0.8,
                top=1.8,
                width=11.733,
                headers=["Change Type", "Opportunity Name", "Account", "ACV Impact", "Details"],
                rows=change_rows,
                empty_msg="No portfolio changes recorded since baseline snapshot.",
                col_widths=[2.1, 3.2, 2.2, 1.8, 2.433],
            )

        # -------------------------------------------------------------
        # Slide 8: Messages, Comments & Data Governance Notes
        # -------------------------------------------------------------
        s_msg = prs.slides.add_slide(blank_slide_layout)
        cls._add_slide_header(
            s_msg,
            "Messages, Management Feedback & Portfolio Notes",
            f"{owner_name} — Communication activity, recent management comments, and data governance notes",
            logo_path=logo_path,
        )

        msg_summary = overview_data.get("messages_and_comments_summary") or {}
        open_threads = msg_summary.get("open_threads", 0)
        unread_cnt = msg_summary.get("unread_count", 0)
        shared_cmts = msg_summary.get("latest_shared_comments") or []

        cmt_rows = []
        for c in shared_cmts[:6]:
            cmt_rows.append([
                _wrap_text(c.get("author", ""), max_len=20),
                _wrap_text(c.get("deal_name", ""), max_len=24),
                _wrap_text(c.get("text", ""), max_len=50),
                str(c.get("created_at_formatted", ""))[:12],
            ])

        cls._add_table(
            s_msg,
            left=0.8,
            top=1.8,
            width=11.733,
            headers=["Author", "Deal", "Management Shared Comment", "Date"],
            rows=cmt_rows,
            empty_msg="No comments in this period. All communication threads are up to date.",
            col_widths=[2.1, 2.9, 5.1, 1.633],
        )

        data_notes = overview_data.get("data_notes") or {}
        note_str = data_notes.get("note_text") or "All portfolio totals reflect active renewal records."
        threads_str = f"Open Communication Threads: {open_threads}   |   Unread Messages: {unread_cnt}"

        d_box = s_msg.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(5.8), Inches(11.733), Inches(0.85))
        d_box.fill.solid()
        d_box.fill.fore_color.rgb = RGBColor(248, 250, 252)
        d_box.line.color.rgb = RGBColor(226, 232, 240)
        d_tf = d_box.text_frame
        d_tf.word_wrap = True

        p_t1 = d_tf.paragraphs[0]
        p_t1.text = threads_str
        p_t1.font.name = "Calibri"
        p_t1.font.size = Pt(11)
        p_t1.font.bold = True
        p_t1.font.color.rgb = COLOR_NAVY

        p_t2 = d_tf.add_paragraph()
        p_t2.text = f"Data Notes: {note_str}"
        p_t2.font.name = "Calibri"
        p_t2.font.size = Pt(10)
        p_t2.font.color.rgb = COLOR_GRAY
        p_t2.space_before = Pt(3)

        # Footer on every slide
        total_slides = len(prs.slides)
        for idx, slide in enumerate(prs.slides, 1):
            cls._add_slide_footer(slide, idx, total_slides, owner_name, as_of_formatted)

        # Ensure 100% of runs have explicit Calibri font name
        cls._ensure_all_pptx_fonts(prs, "Calibri")

        out = io.BytesIO()
        prs.save(out)
        out.seek(0)
        return out

    @classmethod
    def _add_slide_header(cls, slide, title_text: str, subtitle_text: str, logo_path: Optional[str] = None):
        # Top-left Title & Subtitle
        txBox = slide.shapes.add_textbox(Inches(0.8), Inches(0.4), Inches(10.5), Inches(0.85))
        tf = txBox.text_frame
        tf.word_wrap = True

        p1 = tf.paragraphs[0]
        p1.text = title_text
        p1.font.name = "Calibri"
        p1.font.size = Pt(28)
        p1.font.bold = True
        p1.font.color.rgb = COLOR_NAVY

        p2 = tf.add_paragraph()
        p2.text = subtitle_text
        p2.font.name = "Calibri"
        p2.font.size = Pt(14)
        p2.font.color.rgb = COLOR_GRAY
        p2.space_before = Pt(2)

        # Top-right Logo
        if logo_path and Path(logo_path).exists():
            try:
                with PILImage.open(logo_path) as im:
                    orig_w, orig_h = im.size
                    logo_w_in = (orig_w / orig_h) * 0.5
                left_in = 13.333 - 0.8 - logo_w_in
                slide.shapes.add_picture(logo_path, Inches(left_in), Inches(0.4), height=Inches(0.5))
            except Exception as e:
                log.warning(f"Error adding PPTX header logo: {e}")

    @classmethod
    def _add_slide_footer(cls, slide, slide_num: int, total_slides: int, owner_name: str, as_of_formatted: str):
        txBox = slide.shapes.add_textbox(Inches(0.8), Inches(7.05), Inches(11.733), Inches(0.35))
        tf = txBox.text_frame
        p = tf.paragraphs[0]
        p.text = f"Slide {slide_num} of {total_slides}   |   Opportunity Owner: {owner_name}   |   Snapshot Date: {as_of_formatted}   |   Mobileum Confidential"
        p.font.name = "Calibri"
        p.font.size = Pt(10)
        p.font.color.rgb = COLOR_GRAY
        p.alignment = PP_ALIGN.CENTER

    @classmethod
    def _add_table(
        cls,
        slide,
        left: float,
        top: float,
        width: float,
        headers: List[str],
        rows: List[List[str]],
        empty_msg: Optional[str] = None,
        col_widths: Optional[List[float]] = None,
        height: Optional[float] = None,
    ):
        """
        Render a table with content-height rows, vertically centered text,
        proper column alignment, Calibri font on all runs, secondary lines styled grey,
        and an empty state callout box when rows are empty.
        """
        # Empty table state -> render styled callout box
        if not rows:
            msg = empty_msg or "No records in this section."
            box = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(left), Inches(top), Inches(width), Inches(0.75))
            box.fill.solid()
            box.fill.fore_color.rgb = RGBColor(248, 250, 252)
            box.line.color.rgb = RGBColor(226, 232, 240)
            tf = box.text_frame
            tf.word_wrap = True
            p = tf.paragraphs[0]
            p.text = msg
            p.font.name = "Calibri"
            p.font.size = Pt(13)
            p.font.color.rgb = COLOR_GRAY
            p.alignment = PP_ALIGN.CENTER
            return

        rows_count = len(rows) + 1
        cols_count = len(headers)

        header_h = Inches(0.45)
        row_h = Inches(0.40)
        total_h = header_h + len(rows) * row_h

        table_shape = slide.shapes.add_table(rows_count, cols_count, Inches(left), Inches(top), Inches(width), total_h)
        table = table_shape.table

        table.rows[0].height = header_h
        for r_idx in range(len(rows)):
            table.rows[r_idx + 1].height = row_h

        if col_widths and len(col_widths) == cols_count:
            for c_idx, cw in enumerate(col_widths):
                table.columns[c_idx].width = Inches(cw)

        # Style Header Row
        for c, h in enumerate(headers):
            cell = table.cell(0, c)
            cell.text = h
            cell.vertical_anchor = MSO_ANCHOR.MIDDLE
            cell.fill.solid()
            cell.fill.fore_color.rgb = COLOR_NAVY
            cell.margin_left = Inches(0.08)
            cell.margin_right = Inches(0.08)
            p = cell.text_frame.paragraphs[0]
            p.font.name = "Calibri"
            p.font.size = Pt(13)
            p.font.bold = True
            p.font.color.rgb = COLOR_WHITE
            if _is_numeric_header(h):
                p.alignment = PP_ALIGN.RIGHT
            elif _is_center_header(h):
                p.alignment = PP_ALIGN.CENTER
            else:
                p.alignment = PP_ALIGN.LEFT

        # Style Data Rows
        for r_idx, r_data in enumerate(rows):
            is_total_row = (r_data and str(r_data[0]).strip().lower() == "total")
            for c_idx, val in enumerate(r_data):
                cell = table.cell(r_idx + 1, c_idx)
                cell.vertical_anchor = MSO_ANCHOR.MIDDLE
                cell.fill.solid()
                cell.margin_left = Inches(0.08)
                cell.margin_right = Inches(0.08)
                if is_total_row:
                    cell.fill.fore_color.rgb = RGBColor(226, 232, 240)
                else:
                    cell.fill.fore_color.rgb = COLOR_WHITE if r_idx % 2 == 0 else COLOR_LIGHT_BG

                h_name = headers[c_idx] if c_idx < len(headers) else ""
                val_str = str(val or "")
                lines = val_str.split("\n")

                tf = cell.text_frame
                tf.clear()

                p0 = tf.paragraphs[0]
                p0.text = lines[0] if lines else ""
                p0.font.name = "Calibri"
                p0.font.size = Pt(13)
                if is_total_row:
                    p0.font.bold = True
                    p0.font.color.rgb = COLOR_NAVY
                else:
                    p0.font.color.rgb = COLOR_NAVY

                if _is_numeric_header(h_name):
                    p0.alignment = PP_ALIGN.RIGHT
                elif _is_center_header(h_name):
                    p0.alignment = PP_ALIGN.CENTER
                else:
                    p0.alignment = PP_ALIGN.LEFT

                # Multi-line cell support: secondary lines smaller and grey, same Calibri font!
                for extra_line in lines[1:]:
                    p_extra = tf.add_paragraph()
                    p_extra.text = extra_line
                    p_extra.font.name = "Calibri"
                    p_extra.font.size = Pt(10)
                    p_extra.font.color.rgb = COLOR_GRAY
                    p_extra.alignment = p0.alignment

    @classmethod
    def _ensure_all_pptx_fonts(cls, prs: Presentation, font_name: str = "Calibri"):
        """Recursively traverse all shapes, text frames, paragraphs, and runs to enforce font name."""
        for slide in prs.slides:
            for shape in slide.shapes:
                if shape.has_text_frame:
                    for p in shape.text_frame.paragraphs:
                        p.font.name = font_name
                        for r in p.runs:
                            r.font.name = font_name
                if shape.has_table:
                    for row in shape.table.rows:
                        for cell in row.cells:
                            for p in cell.text_frame.paragraphs:
                                p.font.name = font_name
                                for r in p.runs:
                                    r.font.name = font_name

    # =========================================================================
    # PDF GENERATION VIA REPORTLAB PLATYPUS
    # =========================================================================

    @classmethod
    def generate_pdf_report(
        cls,
        kam_name: str,
        owner_name: str,
        period: str,
        as_of_date: str,
        overview_data: Dict[str, Any],
        deals: List[Dict[str, Any]],
        compare_as_of_date: Optional[str] = None,
    ) -> io.BytesIO:
        """
        Generates a professional multi-page PDF document matching the KAM Overview layout.
        Uses A4 landscape on ALL pages, ReportLab Platypus, Carlito font family,
        2-up and single tables with repeatRows=1, 4x2 summary tiles, and Mobileum branding.
        """
        _register_carlito_fonts()

        kpis = overview_data.get("kpis") or overview_data.get("total") or {}
        tot_count = kpis.get("total_count", len(deals))
        tot_acv = kpis.get("total_acv", sum(float(d.get("forecast_acv_amount") or 0.0) for d in deals))

        as_of_formatted = _format_date_with_year(as_of_date)
        compare_formatted = _format_date_with_year(compare_as_of_date or overview_data.get("compare_as_of"))
        period_display = overview_data.get("period") or ("All periods" if period in ("all_open", "All open deals", "All periods") else period)

        logo_path = _resolve_logo_path()

        pdf_buffer = io.BytesIO()
        doc = SimpleDocTemplate(
            pdf_buffer,
            pagesize=landscape(A4),
            leftMargin=MARGIN_PT,
            rightMargin=MARGIN_PT,
            topMargin=MARGIN_PT,
            bottomMargin=MARGIN_PT,
        )

        font_reg = "Carlito" if _FONTS_REGISTERED else "Helvetica"
        font_bld = "Carlito-Bold" if _FONTS_REGISTERED else "Helvetica-Bold"

        # Typography Styles
        title_style = ParagraphStyle(
            "PageTitle",
            fontName=font_bld,
            fontSize=20,
            leading=24,
            textColor=HEX_NAVY,
        )
        subtitle_style = ParagraphStyle(
            "PageSubtitle",
            fontName=font_reg,
            fontSize=11,
            leading=14,
            textColor=HEX_SLATE,
        )
        table_hdr_l = ParagraphStyle(
            "THL",
            fontName=font_bld,
            fontSize=10,
            leading=13,
            textColor=HEX_WHITE,
            alignment=TA_LEFT,
        )
        table_hdr_r = ParagraphStyle(
            "THR",
            fontName=font_bld,
            fontSize=10,
            leading=13,
            textColor=HEX_WHITE,
            alignment=TA_RIGHT,
        )
        table_hdr_c = ParagraphStyle(
            "THC",
            fontName=font_bld,
            fontSize=10,
            leading=13,
            textColor=HEX_WHITE,
            alignment=TA_CENTER,
        )
        table_body_l = ParagraphStyle(
            "TDL",
            fontName=font_reg,
            fontSize=10,
            leading=13,
            textColor=HEX_NAVY,
            alignment=TA_LEFT,
        )
        table_body_r = ParagraphStyle(
            "TDR",
            fontName=font_reg,
            fontSize=10,
            leading=13,
            textColor=HEX_NAVY,
            alignment=TA_RIGHT,
        )
        table_body_c = ParagraphStyle(
            "TDC",
            fontName=font_reg,
            fontSize=10,
            leading=13,
            textColor=HEX_NAVY,
            alignment=TA_CENTER,
        )
        table_body_total_l = ParagraphStyle(
            "TDTL",
            fontName=font_bld,
            fontSize=10,
            leading=13,
            textColor=HEX_NAVY,
            alignment=TA_LEFT,
        )
        table_body_total_r = ParagraphStyle(
            "TDTR",
            fontName=font_bld,
            fontSize=10,
            leading=13,
            textColor=HEX_NAVY,
            alignment=TA_RIGHT,
        )

        def _make_section_header(title: str, subtitle: str) -> List[Any]:
            p1 = Paragraph(title, title_style)
            p2 = Paragraph(subtitle, subtitle_style)
            hdr_table = Table([[p1], [p2]], colWidths=[630])
            hdr_table.setStyle(TableStyle([
                ("FONTNAME", (0, 0), (-1, -1), font_reg),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
            ]))
            return [hdr_table, Spacer(1, 12)]

        def _build_pdf_table(
            headers: List[str],
            rows: List[List[str]],
            col_widths: List[float],
            empty_msg: Optional[str] = None,
            full_width: float = CONTENT_WIDTH_PT,
        ) -> Table:
            if not rows:
                msg = empty_msg or "No records in this section."
                empty_p = Paragraph(msg, ParagraphStyle("EmptyMsg", fontName=font_reg, fontSize=10, leading=13, textColor=HEX_SLATE, alignment=TA_CENTER))
                t_empty = Table([[empty_p]], colWidths=[full_width], rowHeights=[36])
                t_empty.setStyle(TableStyle([
                    ("FONTNAME", (0, 0), (-1, -1), font_reg),
                    ("BACKGROUND", (0, 0), (-1, -1), HEX_LIGHT_BG),
                    ("BOX", (0, 0), (-1, -1), 0.5, HEX_GRID),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 12),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 12),
                ]))
                return t_empty

            hdr_cells = []
            for h in headers:
                if _is_numeric_header(h):
                    hdr_cells.append(Paragraph(h, table_hdr_r))
                elif _is_center_header(h):
                    hdr_cells.append(Paragraph(h, table_hdr_c))
                else:
                    hdr_cells.append(Paragraph(h, table_hdr_l))

            body_cells = [hdr_cells]
            total_row_indices = []
            for r_idx, r_data in enumerate(rows):
                is_total = (r_data and str(r_data[0]).strip().lower() == "total")
                if is_total:
                    total_row_indices.append(r_idx + 1)
                row_items = []
                for c_idx, val in enumerate(r_data):
                    val_str = str(val or "")
                    # Long names wrap inside the cell, never truncate!
                    val_fmt = val_str.replace("\n", "<br/>")
                    h_name = headers[c_idx] if c_idx < len(headers) else ""
                    if is_total:
                        style = table_body_total_r if _is_numeric_header(h_name) else table_body_total_l
                    else:
                        if _is_numeric_header(h_name):
                            style = table_body_r
                        elif _is_center_header(h_name):
                            style = table_body_c
                        else:
                            style = table_body_l
                    row_items.append(Paragraph(val_fmt, style))
                body_cells.append(row_items)

            row_heights = [28] + [None] * len(rows)
            t = Table(body_cells, colWidths=col_widths, rowHeights=row_heights, repeatRows=1)
            t_style = [
                ("FONTNAME", (0, 0), (-1, -1), font_reg),
                ("BACKGROUND", (0, 0), (-1, 0), HEX_NAVY),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, HEX_GRID),
                ("BOX", (0, 0), (-1, -1), 0.5, HEX_GRID),
            ]
            for r_num in range(1, len(body_cells)):
                if r_num in total_row_indices:
                    t_style.append(("BACKGROUND", (0, r_num), (-1, r_num), HEX_GRID))
                else:
                    bg = HEX_WHITE if r_num % 2 == 1 else HEX_LIGHT_BG
                    t_style.append(("BACKGROUND", (0, r_num), (-1, r_num), bg))

            t.setStyle(TableStyle(t_style))
            return t

        story: List[Any] = []

        # =============================================================
        # Page 1: Cover Page (Handled by NumberedCanvas)
        # =============================================================
        story.append(PageBreak())

        # =============================================================
        # Page 2: Summary Tiles, Progress, Insights & Regional Footprint
        # =============================================================
        story.extend(_make_section_header(
            "Portfolio Summary & Overview",
            f"{owner_name} — Key health metrics, executive observations, and regional footprint for {period_display}",
        ))

        # Progress Banner
        rp = overview_data.get("renewal_progress") or {}
        ac_conc = overview_data.get("account_concentration") or {}
        rp_text = rp.get("summary_sentence") or f"Showing {tot_count} {'deal' if tot_count == 1 else 'deals'} ({_format_currency(tot_acv)}) for {period_display}."
        if ac_conc.get("sentence"):
            rp_text += f"  ·  {ac_conc.get('sentence')}"

        prog_p = Paragraph(rp_text, ParagraphStyle("ProgText", fontName=font_bld, fontSize=10, leading=13, textColor=HEX_NAVY))
        prog_t = Table([[prog_p]], colWidths=[CONTENT_WIDTH_PT])
        prog_t.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, -1), font_reg),
            ("BACKGROUND", (0, 0), (-1, -1), HEX_PROGRESS_BG),
            ("BOX", (0, 0), (-1, -1), 0.5, HEX_BORDER_SLATE),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ]))
        story.append(prog_t)
        story.append(Spacer(1, 10))

        # 8 KPI Tiles (4x2 Grid of Equal Cards)
        appr_2nd_count = kpis.get("approved_2nd_count", 0)
        appr_cnt = kpis.get('approved_count', 0)
        appr_cnt_str = f"{appr_cnt} {'deal' if appr_cnt == 1 else 'deals'}"
        if appr_2nd_count > 0:
            appr_cnt_str += f" (incl. {appr_2nd_count} 2nd)"

        cov_cnt = kpis.get('commit_coverage_count', 0)
        pend_cnt = kpis.get('pending_approval_count', 0)
        nsub_cnt = kpis.get('not_submitted_count', 0)
        del_cnt = kpis.get('delayed_count', 0)
        slip_cnt = kpis.get('slippage_count', 0)
        nrev_cnt = kpis.get('needs_review_count', 0)

        tile_defs = [
            ("MY PORTFOLIO", f"{tot_count} {'deal' if tot_count == 1 else 'deals'}", _format_currency(tot_acv), HEX_NAVY),
            ("COMMIT COVERAGE", f"{cov_cnt} {'deal' if cov_cnt == 1 else 'deals'}", _format_currency(kpis.get('commit_coverage_acv', 0)), HEX_BLUE),
            ("APPROVED", appr_cnt_str, _format_currency(kpis.get('approved_acv', 0)), HEX_EMERALD),
            ("PENDING APPROVAL", f"{pend_cnt} {'deal' if pend_cnt == 1 else 'deals'}", _format_currency(kpis.get('pending_approval_acv', 0)), HEX_AMBER),
            ("NOT SUBMITTED", f"{nsub_cnt} {'deal' if nsub_cnt == 1 else 'deals'}", _format_currency(kpis.get('not_submitted_acv', 0)), HEX_SLATE),
            ("DELAYED RENEWALS", f"{del_cnt} {'deal' if del_cnt == 1 else 'deals'}", _format_currency(kpis.get('delayed_acv', 0)), HEX_ROSE),
            ("SLIPPAGE", f"{slip_cnt} {'deal' if slip_cnt == 1 else 'deals'}", _format_currency(kpis.get('slippage_acv', 0)), HEX_AMBER),
            ("NEEDS REVIEW", f"{nrev_cnt} {'deal' if nrev_cnt == 1 else 'deals'}", _format_currency(kpis.get('needs_review_acv', 0)), HEX_DARK_BLUE),
        ]

        tile_col_w = CONTENT_WIDTH_PT / 4.0
        tile_cards = []
        gap_p0 = Paragraph("", ParagraphStyle("Bar0", fontName=font_reg, fontSize=1, leading=1))
        for label, count_str, acv_str, color in tile_defs:
            p_lbl = Paragraph(label, ParagraphStyle("TileLbl", fontName=font_bld, fontSize=9, leading=11, textColor=HEX_SLATE))
            p_val = Paragraph(acv_str, ParagraphStyle("TileVal", fontName=font_bld, fontSize=18, leading=22, textColor=HEX_NAVY))
            p_cnt = Paragraph(count_str, ParagraphStyle("TileCnt", fontName=font_reg, fontSize=9, leading=11, textColor=HEX_SLATE))
            card_inner = Table([
                [gap_p0],
                [p_lbl],
                [p_val],
                [p_cnt],
            ], colWidths=[tile_col_w - 6], rowHeights=[3, None, None, None])
            card_inner.setStyle(TableStyle([
                ("FONTNAME", (0, 0), (-1, -1), font_reg),
                ("BACKGROUND", (0, 0), (-1, 0), color),
                ("BACKGROUND", (0, 1), (-1, -1), HEX_LIGHT_BG),
                ("BOX", (0, 0), (-1, -1), 0.5, HEX_GRID),
                ("LEFTPADDING", (0, 1), (-1, -1), 8),
                ("RIGHTPADDING", (0, 1), (-1, -1), 8),
                ("TOPPADDING", (0, 1), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 1), (-1, -1), 5),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]))
            tile_cards.append(card_inner)

        tiles_table = Table([
            [tile_cards[0], tile_cards[1], tile_cards[2], tile_cards[3]],
            [tile_cards[4], tile_cards[5], tile_cards[6], tile_cards[7]],
        ], colWidths=[tile_col_w, tile_col_w, tile_col_w, tile_col_w])
        tiles_table.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, -1), font_reg),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 3),
            ("RIGHTPADDING", (0, 0), (-1, -1), 3),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]))
        story.append(tiles_table)
        story.append(Spacer(1, 10))

        # Insights Box
        insight_cards = overview_data.get("insight_cards") or [
            f"Portfolio contains {tot_count} opportunities totaling {_format_currency(tot_acv)}.",
            f"Approved deals total {kpis.get('approved_count', 0)} worth {_format_currency(kpis.get('approved_acv', 0))}.",
            f"Awaiting approval: {kpis.get('pending_approval_count', 0)} deals worth {_format_currency(kpis.get('pending_approval_acv', 0))}.",
        ]
        ins_p_title = Paragraph("PORTFOLIO INSIGHTS", ParagraphStyle("InsT", fontName=font_bld, fontSize=9, leading=11, textColor=HEX_NAVY))
        ins_rows = [[ins_p_title]]
        for ins in insight_cards[:3]:
            ins_p = Paragraph(f"•  {ins}", ParagraphStyle("InsB", fontName=font_reg, fontSize=9.5, leading=13, textColor=HEX_MUTED_SLATE))
            ins_rows.append([ins_p])

        ins_t = Table(ins_rows, colWidths=[CONTENT_WIDTH_PT])
        ins_t.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, -1), font_reg),
            ("BACKGROUND", (0, 0), (-1, -1), HEX_PROGRESS_BG),
            ("BOX", (0, 0), (-1, -1), 0.5, HEX_BORDER_SLATE),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        story.append(ins_t)
        story.append(Spacer(1, 10))

        # Regional Footprint Box
        region_line = overview_data.get("region_line") or {}
        if region_line.get("single_region") and region_line.get("summary_sentence"):
            reg_text = region_line.get("summary_sentence")
        else:
            regions_list = region_line.get("regions") or []
            chips_strs = [r.get("label", "") for r in regions_list if r.get("label")]
            reg_text = "  ·  ".join(chips_strs) if chips_strs else "No region breakdown available."

        reg_p_title = Paragraph("REGIONAL FOOTPRINT", ParagraphStyle("RegT", fontName=font_bld, fontSize=9, leading=11, textColor=HEX_TEAL_DARK))
        reg_p_body = Paragraph(reg_text, ParagraphStyle("RegB", fontName=font_reg, fontSize=9.5, leading=13, textColor=HEX_TEXT_DARK))
        reg_t = Table([[reg_p_title], [reg_p_body]], colWidths=[CONTENT_WIDTH_PT])
        reg_t.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, -1), font_reg),
            ("BACKGROUND", (0, 0), (-1, -1), HEX_REGIONAL_BG),
            ("BOX", (0, 0), (-1, -1), 0.5, HEX_REGIONAL_BORDER),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        story.append(reg_t)

        story.append(PageBreak())

        # =============================================================
        # Page 3: Forecast, Approvals, Business Units & Top Accounts (2-Up Tables)
        # =============================================================
        story.extend(_make_section_header(
            "Forecast, Approvals, Business Units & Top Accounts",
            f"{owner_name} — Pipeline breakdown across approval states, business units, and key client accounts",
        ))

        # Row 1: Forecast Category & Approval Status
        fc_data = overview_data.get("forecast_categories") or {}
        fc_rows = []
        for cat in ["Closed", "Commit", "Best Case", "Pipeline", "Not yet proposed"]:
            cnt = fc_data.get(cat, {}).get("count", 0)
            fc_rows.append([cat, f"{cnt} {'deal' if cnt == 1 else 'deals'}", _format_currency(fc_data.get(cat, {}).get("acv", 0.0))])

        fc_table = _build_pdf_table(
            headers=["Forecast Category", "Deals", "ACV"],
            rows=fc_rows,
            col_widths=[185.945, 85.0, 105.0],
            full_width=TWO_UP_WIDTH_PT,
        )

        st_data = overview_data.get("approval_statuses") or {}
        appr_breakdown = kpis.get("approved_2nd_breakdown")
        appr_cnt = st_data.get("Approved", {}).get("count", 0)
        pend_cnt = st_data.get("Pending Approval", {}).get("count", 0)
        nsub_cnt = st_data.get("Not submitted", {}).get("count", 0)

        st_rows = [
            ["Approved", f"{appr_cnt} {'deal' if appr_cnt == 1 else 'deals'}", _format_currency(st_data.get("Approved", {}).get("acv", 0.0))],
            ["Pending Approval", f"{pend_cnt} {'deal' if pend_cnt == 1 else 'deals'}", _format_currency(st_data.get("Pending Approval", {}).get("acv", 0.0))],
            ["Not submitted", f"{nsub_cnt} {'deal' if nsub_cnt == 1 else 'deals'}", _format_currency(st_data.get("Not submitted", {}).get("acv", 0.0))],
        ]

        st_table = _build_pdf_table(
            headers=["Approval Status", "Deals", "ACV"],
            rows=st_rows,
            col_widths=[185.945, 85.0, 105.0],
            full_width=TWO_UP_WIDTH_PT,
        )

        gap_p = Paragraph("", ParagraphStyle("GapCol", fontName=font_reg, fontSize=1, leading=1))
        two_up_row1 = Table([[fc_table, gap_p, st_table]], colWidths=[TWO_UP_WIDTH_PT, GAP_PT, TWO_UP_WIDTH_PT])
        two_up_row1.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, -1), font_reg),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        story.append(two_up_row1)
        story.append(Spacer(1, 18))

        # Row 2: Business Units & Top Accounts
        charts = overview_data.get("charts") or {}
        bu_list = (charts.get("business_units") or [])[:5]
        bu_rows = []
        for b in bu_list:
            cnt = b.get("count", 0)
            bu_rows.append([b.get("bu") or b.get("business_unit") or "Unassigned", f"{cnt} {'deal' if cnt == 1 else 'deals'}", _format_currency(b.get("acv", 0.0))])

        bu_table = _build_pdf_table(
            headers=["Business Unit", "Deals", "ACV"],
            rows=bu_rows,
            col_widths=[185.945, 85.0, 105.0],
            empty_msg="No business units assigned in this portfolio.",
            full_width=TWO_UP_WIDTH_PT,
        )

        acc_list = (charts.get("top_accounts") or [])[:5]
        acc_rows = []
        for a in acc_list:
            cnt = a.get("count", 0)
            acc_rows.append([a.get("account_name", ""), f"{cnt} {'deal' if cnt == 1 else 'deals'}", _format_currency(a.get("acv", 0.0))])

        acc_table = _build_pdf_table(
            headers=["Top Accounts", "Deals", "ACV"],
            rows=acc_rows,
            col_widths=[185.945, 85.0, 105.0],
            empty_msg="No customer accounts found in this portfolio.",
            full_width=TWO_UP_WIDTH_PT,
        )

        two_up_row2 = Table([[bu_table, gap_p, acc_table]], colWidths=[TWO_UP_WIDTH_PT, GAP_PT, TWO_UP_WIDTH_PT])
        two_up_row2.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, -1), font_reg),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        story.append(two_up_row2)

        story.append(PageBreak())

        # =============================================================
        # Page 4: Portfolio Action Center (Open Deals Only)
        # =============================================================
        story.extend(_make_section_header(
            "Portfolio Action Center",
            f"{owner_name} — Priority open opportunities requiring attention, awaiting sign-off, or flagged for risk",
        ))

        actions = overview_data.get("action_lists", {})
        urgent_candidates = actions.get("immediate_attention") or actions.get("delayed_deals") or []
        urgent = [d for d in urgent_candidates if is_deal_open(d)]
        if not urgent:
            urgent = [d for d in deals if is_deal_open(d) and d.get("approval_status") not in ("Approved", "Approved - 2nd")]
        if not urgent:
            urgent = [d for d in deals if is_deal_open(d)]

        urgent_rows = []
        for d in urgent:
            urgent_rows.append([
                str(d.get("opportunity_name", "")),
                str(d.get("account_name", "")),
                str(d.get("forecast_category", "")),
                str(d.get("approval_status", "")),
                _format_currency(d.get("forecast_acv_amount")),
                str(d.get("close_date", ""))[:10],
            ])

        # Widths: [220, 160, 95, 105, 95, 94.89] -> sum = 769.89 pt
        act_table = _build_pdf_table(
            headers=["Opportunity Name", "Account", "Forecast", "Status", "ACV", "Close Date"],
            rows=urgent_rows,
            col_widths=[220.0, 160.0, 95.0, 105.0, 95.0, 94.89],
            empty_msg="No open opportunities requiring immediate attention. All items are current.",
            full_width=CONTENT_WIDTH_PT,
        )
        story.append(act_table)

        story.append(PageBreak())

        # =============================================================
        # Page 5: Deal Tracker & Closing Milestones (2-Up Tables)
        # =============================================================
        story.extend(_make_section_header(
            "Deal Tracker & Closing Milestones",
            f"{owner_name} — Monthly renewal schedule, upcoming close deadlines, and overdue portfolio items",
        ))

        month_summary: Dict[str, Dict[str, Any]] = {}
        for d in deals:
            cd = (d.get("close_date") or "")[:7] or "Unscheduled"
            if cd not in month_summary:
                month_summary[cd] = {"count": 0, "acv": 0.0, "approved_acv": 0.0}
            month_summary[cd]["count"] += 1
            amt = float(d.get("forecast_acv_amount") or 0.0)
            month_summary[cd]["acv"] += amt
            if d.get("approval_status") in ("Approved", "Approved - 2nd"):
                month_summary[cd]["approved_acv"] += amt

        sorted_m = sorted(month_summary.keys(), key=lambda x: (1 if x == "Unscheduled" else 0, x))
        cal_rows = []
        tot_cnt = 0
        tot_appr = 0.0
        tot_sum_acv = 0.0
        for m in sorted_m:
            info = month_summary[m]
            lbl = m
            if m != "Unscheduled":
                try:
                    lbl = datetime.fromisoformat(f"{m}-01").strftime("%b %Y")
                except Exception:
                    pass
            tot_cnt += info["count"]
            tot_appr += info["approved_acv"]
            tot_sum_acv += info["acv"]
            cnt_str = f"{info['count']} {'deal' if info['count'] == 1 else 'deals'}"
            cal_rows.append([lbl, cnt_str, _format_currency(info["approved_acv"]), _format_currency(info["acv"])])

        tot_cnt_lbl = f"{tot_cnt} {'deal' if tot_cnt == 1 else 'deals'}"
        cal_rows.append(["Total", tot_cnt_lbl, _format_currency(tot_appr), _format_currency(tot_sum_acv)])

        # Col widths: [125, 65, 92, 93.945] -> sum = 375.945 pt. No collision on Approved ACV / Total ACV!
        cal_table = _build_pdf_table(
            headers=["Renewal Month", "Deals", "Approved ACV", "Total ACV"],
            rows=cal_rows,
            col_widths=[125.0, 65.0, 92.0, 93.945],
            full_width=TWO_UP_WIDTH_PT,
        )

        soon_rows = []
        ref_d_str = as_of_date[:10] if as_of_date else datetime.now(timezone.utc).strftime("%Y-%m-%d")
        try:
            ref_dt = parse_excel_date(ref_d_str)
            for d in sorted(deals, key=lambda x: x.get("close_date") or "9999"):
                if not is_deal_open(d):  # Closed deals NEVER show overdue or delayed
                    continue
                cd_str = (d.get("close_date") or "")[:10]
                if cd_str:
                    cd = parse_excel_date(cd_str)
                    if cd and ref_dt:
                        diff = (cd - ref_dt).days
                        opp_name = str(d.get("opportunity_name", ""))
                        acc_name = str(d.get("account_name", ""))
                        acv_str = _format_currency(d.get("forecast_acv_amount"))
                        if diff < 0:
                            soon_rows.append([opp_name, acc_name, acv_str, f"{abs(diff)}d overdue"])
                        elif 0 <= diff <= 30:
                            soon_rows.append([opp_name, acc_name, acv_str, f"{diff}d left" if diff > 0 else "Closes today"])
        except Exception as e:
            log.warning(f"Error computing soon_rows: {e}")

        # Col widths: [135, 105, 65, 70.945] -> sum = 375.945 pt
        soon_table = _build_pdf_table(
            headers=["Opportunity", "Account", "ACV", "Timeline Status"],
            rows=soon_rows,
            col_widths=[135.0, 105.0, 65.0, 70.945],
            empty_msg="No deals closing in the next 30 days. All renewal deadlines on track.",
            full_width=TWO_UP_WIDTH_PT,
        )

        gap_p_dt = Paragraph("", ParagraphStyle("GapDT", fontName=font_reg, fontSize=1, leading=1))
        two_up_dt = Table([[cal_table, gap_p_dt, soon_table]], colWidths=[TWO_UP_WIDTH_PT, GAP_PT, TWO_UP_WIDTH_PT])
        two_up_dt.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, -1), font_reg),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        story.append(two_up_dt)

        story.append(PageBreak())

        # =============================================================
        # Page 6: Upcoming Service Expiry Schedule
        # =============================================================
        story.extend(_make_section_header(
            "Upcoming Service Expiry Schedule",
            f"{owner_name} — Service contracts expiring within the next 60 days",
        ))

        upcoming_exp = overview_data.get("upcoming_service_expiry") or []
        exp_rows = []
        for item in upcoming_exp:
            d = item.get("deal") or item
            exp_rows.append([
                str(d.get("opportunity_name", "")),
                str(d.get("account_name", "")),
                _format_currency(d.get("forecast_acv_amount")),
                str(item.get("service_expiry_date", ""))[:10],
                str(item.get("days_label", "")),
            ])

        # Widths: [230, 170, 110, 130, 129.89] -> sum = 769.89 pt
        exp_table = _build_pdf_table(
            headers=["Opportunity Name", "Account", "ACV", "Service Expiry Date", "Time to Expiry"],
            rows=exp_rows,
            col_widths=[230.0, 170.0, 110.0, 130.0, 129.89],
            empty_msg="No upcoming service contract expirations in the next 60 days.",
            full_width=CONTENT_WIDTH_PT,
        )
        story.append(exp_table)
        story.append(Spacer(1, 12))

        # Caption note box
        caption_p = Paragraph(
            "Service expiry = end date of the current (expiring) contract. The renewal period starts the next day.",
            ParagraphStyle("CapNote", fontName=font_bld, fontSize=10, leading=13, textColor=HEX_CAPTION_TEXT)
        )
        caption_t = Table([[caption_p]], colWidths=[CONTENT_WIDTH_PT])
        caption_t.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, -1), font_reg),
            ("BACKGROUND", (0, 0), (-1, -1), HEX_CAPTION_BG),
            ("BOX", (0, 0), (-1, -1), 0.5, HEX_CAPTION_BORDER),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ]))
        story.append(caption_t)

        story.append(PageBreak())

        # =============================================================
        # Page 7: What Changed (Conditional if changes exist)
        # =============================================================
        what_changed = overview_data.get("what_changed") or {}
        if what_changed.get("has_changes"):
            story.extend(_make_section_header(
                "What Changed",
                f"Modifications, movements, and new deals compared to {compare_formatted}",
            ))

            change_rows = []
            for nd in (what_changed.get("new_deals") or [])[:6]:
                change_rows.append(["New Deal Added", str(nd.get("opportunity_name", "")), str(nd.get("account_name", "")), f"+{_format_currency(nd.get('acv'))}", str(nd.get("stage", ""))])
            for ca in (what_changed.get("acv_changes") or [])[:6]:
                diff = ca.get("diff_acv", 0.0)
                diff_str = f"{'+' if diff > 0 else ''}{_format_currency(diff)}"
                change_rows.append(["ACV Change", str(ca.get("opportunity_name", "")), str(ca.get("account_name", "")), diff_str, f"{_format_currency(ca.get('old_acv'))} → {_format_currency(ca.get('new_acv'))}"])
            for st in (what_changed.get("stage_changes") or [])[:4]:
                change_rows.append(["Stage Change", str(st.get("opportunity_name", "")), str(st.get("account_name", "")), "—", f"{st.get('old_stage')} → {st.get('new_stage')}"])
            for cat in (what_changed.get("category_changes") or [])[:4]:
                change_rows.append(["Category Change", str(cat.get("opportunity_name", "")), str(cat.get("account_name", "")), "—", f"{cat.get('old_category')} → {cat.get('new_category')}"])
            for cw in (what_changed.get("closed_won") or [])[:4]:
                change_rows.append(["Closed Won", str(cw.get("opportunity_name", "")), str(cw.get("account_name", "")), _format_currency(cw.get("acv")), "Won"])
            for rm in (what_changed.get("removed_deals") or [])[:4]:
                change_rows.append(["Removed / Lost", str(rm.get("opportunity_name", "")), str(rm.get("account_name", "")), f"-{_format_currency(rm.get('acv'))}", str(rm.get("reason", ""))])

            # Widths: [120, 220, 150, 120, 159.89] -> sum = 769.89 pt
            chg_table = _build_pdf_table(
                headers=["Change Type", "Opportunity Name", "Account", "ACV Impact", "Details"],
                rows=change_rows,
                col_widths=[120.0, 220.0, 150.0, 120.0, 159.89],
                empty_msg="No portfolio changes recorded since baseline snapshot.",
                full_width=CONTENT_WIDTH_PT,
            )
            story.append(chg_table)
            story.append(PageBreak())

        # =============================================================
        # Page 8: Messages, Comments & Data Governance Notes
        # =============================================================
        story.extend(_make_section_header(
            "Messages, Management Feedback & Portfolio Notes",
            f"{owner_name} — Communication activity, recent management comments, and data governance notes",
        ))

        msg_summary = overview_data.get("messages_and_comments_summary") or {}
        open_threads = msg_summary.get("open_threads", 0)
        unread_cnt = msg_summary.get("unread_count", 0)
        shared_cmts = msg_summary.get("latest_shared_comments") or []

        cmt_rows = []
        for c in shared_cmts:
            cmt_rows.append([
                str(c.get("author", "")),
                str(c.get("deal_name", "")),
                str(c.get("text", "")),
                str(c.get("created_at_formatted", ""))[:12],
            ])

        # Widths: [130, 190, 340, 109.89] -> sum = 769.89 pt
        cmt_table = _build_pdf_table(
            headers=["Author", "Deal", "Management Shared Comment", "Date"],
            rows=cmt_rows,
            col_widths=[130.0, 190.0, 340.0, 109.89],
            empty_msg="No comments in this period. All communication threads are up to date.",
            full_width=CONTENT_WIDTH_PT,
        )
        story.append(cmt_table)
        story.append(Spacer(1, 12))

        # Data Governance Notes Box
        data_notes = overview_data.get("data_notes") or {}
        note_str = data_notes.get("note_text") or "All portfolio totals reflect active renewal records."
        threads_str = f"Open Communication Threads: {open_threads}   |   Unread Messages: {unread_cnt}"

        d_p1 = Paragraph(threads_str, ParagraphStyle("ThreadP", fontName=font_bld, fontSize=10, leading=13, textColor=HEX_NAVY))
        d_p2 = Paragraph(f"Data Notes: {note_str}", ParagraphStyle("NoteP", fontName=font_reg, fontSize=9, leading=12, textColor=HEX_SLATE))
        d_table = Table([[d_p1], [d_p2]], colWidths=[CONTENT_WIDTH_PT])
        d_table.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, -1), font_reg),
            ("BACKGROUND", (0, 0), (-1, -1), HEX_LIGHT_BG),
            ("BOX", (0, 0), (-1, -1), 0.5, HEX_GRID),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))
        story.append(d_table)

        # Custom canvas factory closure to bind report metadata
        def _canvas_maker(*args, **kwargs):
            c = NumberedCanvas(*args, **kwargs)
            c.owner_name = owner_name
            c.kam_name = kam_name
            c.period_display = period_display
            c.as_of_formatted = as_of_formatted
            c.compare_formatted = compare_formatted
            c.logo_path = logo_path
            return c

        doc.build(story, canvasmaker=_canvas_maker)

        pdf_buffer.seek(0)
        return pdf_buffer
