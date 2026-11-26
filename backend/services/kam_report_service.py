"""
KAM Report Generation Service (Round 22, 26, 29, and Layout Fix).
Generates strictly-scoped, professionally styled PowerPoint (.pptx)
and multi-page PDF (.pdf) reports for a Key Account Manager's portfolio.
Matches the KAM Overview:
- Header shows full date labels with year (Data date & Compare to) and period
- Slide/Page 1: Cover slide (A4 Landscape, consistent margins)
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
from typing import Any, List, Dict, Optional

# PPTX styling & generation
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

# PDF generation via matplotlib's vector PDF backend
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle, FancyBboxPatch
from matplotlib.backends.backend_pdf import PdfPages

from backend.services.deal_serializer import is_deal_open, is_deal_closed, is_deal_overdue
from backend.utils.excel_parser import parse_excel_date

log = logging.getLogger(__name__)

# Mobileum Brand Palette
COLOR_NAVY = RGBColor(18, 40, 76)       # #12284C
COLOR_BLUE = RGBColor(0, 163, 173)      # #00A3AD (Teal / Cyan accent)
COLOR_DARK_BLUE = RGBColor(27, 54, 93)  # #1B365D
COLOR_GRAY = RGBColor(100, 116, 139)    # Slate
COLOR_LIGHT_BG = RGBColor(248, 250, 252)
COLOR_WHITE = RGBColor(255, 255, 255)
COLOR_AMBER = RGBColor(217, 119, 6)
COLOR_ROSE = RGBColor(225, 29, 72)
COLOR_EMERALD = RGBColor(16, 185, 129)

# A4 Landscape Page Dimensions (Points & Inches)
PAGE_WIDTH_IN = 11.693    # 841.896 pt
PAGE_HEIGHT_IN = 8.268   # 595.296 pt
PAGE_HEIGHT_PT = 595.296
A4_LANDSCAPE = (PAGE_WIDTH_IN, PAGE_HEIGHT_IN)


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

        # -------------------------------------------------------------
        # Slide 1: Cover Slide (Preserved)
        # -------------------------------------------------------------
        s1 = prs.slides.add_slide(blank_slide_layout)
        bg = s1.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Inches(13.333), Inches(7.5))
        bg.fill.solid()
        bg.fill.fore_color.rgb = COLOR_NAVY
        bg.line.color.rgb = COLOR_NAVY

        bar = s1.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(1.2), Inches(1.5), Inches(0.15), Inches(4.5))
        bar.fill.solid()
        bar.fill.fore_color.rgb = COLOR_BLUE
        bar.line.fill.background()

        txBox = s1.shapes.add_textbox(Inches(1.6), Inches(1.8), Inches(10.5), Inches(3.8))
        tf = txBox.text_frame
        tf.word_wrap = True

        p1 = tf.paragraphs[0]
        p1.text = "MOBILEUM HORIZON RENEWALS"
        p1.font.size = Pt(13)
        p1.font.bold = True
        p1.font.color.rgb = COLOR_BLUE

        p2 = tf.add_paragraph()
        p2.text = "Renewal Portfolio Report"
        p2.font.size = Pt(36)
        p2.font.bold = True
        p2.font.color.rgb = COLOR_WHITE
        p2.space_before = Pt(10)

        p3 = tf.add_paragraph()
        p3.text = f"Owner: {owner_name} ({kam_name})"
        p3.font.size = Pt(20)
        p3.font.color.rgb = COLOR_WHITE
        p3.space_before = Pt(8)

        p4 = tf.add_paragraph()
        p4.text = f"Period: {period_display}   |   Data date: {as_of_formatted}   |   Compare to: {compare_formatted}   |   Generated: {datetime.now(timezone.utc).strftime('%b %d, %Y')}"
        p4.font.size = Pt(13)
        p4.font.color.rgb = RGBColor(148, 163, 184)
        p4.space_before = Pt(20)

        # -------------------------------------------------------------
        # Slide 2: 8 Summary Tiles + Insights + Progress + Region Line (Preserved)
        # -------------------------------------------------------------
        s2 = prs.slides.add_slide(blank_slide_layout)
        cls._add_slide_header(
            s2,
            "Portfolio Summary & Overview",
            f"{owner_name} — Key health metrics, executive observations, and regional footprint for {period_display}",
        )

        rp = overview_data.get("renewal_progress") or {}
        ac_conc = overview_data.get("account_concentration") or {}
        rp_text = rp.get("summary_sentence") or f"Showing {tot_count} {'deal' if tot_count == 1 else 'deals'} ({_format_currency(tot_acv)}) for {period_display}."
        if ac_conc.get("sentence"):
            rp_text += f"  ·  {ac_conc.get('sentence')}"

        prog_box = s2.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(1.3), Inches(11.6), Inches(0.42))
        prog_box.fill.solid()
        prog_box.fill.fore_color.rgb = RGBColor(241, 245, 249)
        prog_box.line.color.rgb = RGBColor(203, 213, 225)
        p_tf = prog_box.text_frame
        p_tf.word_wrap = True
        p_prog = p_tf.paragraphs[0]
        p_prog.text = rp_text
        p_prog.font.size = Pt(9.5)
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
        width = 2.7
        height = 1.15
        for i, (label, count_str, acv_str, color) in enumerate(tile_defs):
            r = i // 4
            c = i % 4
            t_left = left_base + c * (width + 0.25)
            t_top = top_base + r * (height + 0.18)

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
            p_lbl.font.size = Pt(8.5)
            p_lbl.font.bold = True
            p_lbl.font.color.rgb = COLOR_GRAY

            p_acv = tf.add_paragraph()
            p_acv.text = acv_str
            p_acv.font.size = Pt(14)
            p_acv.font.bold = True
            p_acv.font.color.rgb = COLOR_NAVY
            p_acv.space_before = Pt(2)

            p_cnt = tf.add_paragraph()
            p_cnt.text = count_str
            p_cnt.font.size = Pt(9)
            p_cnt.font.color.rgb = COLOR_GRAY
            p_cnt.space_before = Pt(1)

        ins_top = 4.45
        ins_box = s2.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(ins_top), Inches(11.6), Inches(1.15))
        ins_box.fill.solid()
        ins_box.fill.fore_color.rgb = RGBColor(241, 245, 249)
        ins_box.line.color.rgb = RGBColor(203, 213, 225)

        ins_tx = s2.shapes.add_textbox(Inches(0.95), Inches(ins_top + 0.06), Inches(11.3), Inches(1.02))
        ins_tf = ins_tx.text_frame
        ins_tf.word_wrap = True

        p_ins_title = ins_tf.paragraphs[0]
        p_ins_title.text = "PORTFOLIO INSIGHTS"
        p_ins_title.font.size = Pt(9)
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
            p.font.size = Pt(8.5)
            p.font.color.rgb = RGBColor(51, 65, 85)
            p.space_before = Pt(1)

        reg_top = 5.75
        reg_box = s2.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(reg_top), Inches(11.6), Inches(0.85))
        reg_box.fill.solid()
        reg_box.fill.fore_color.rgb = RGBColor(240, 253, 250)
        reg_box.line.color.rgb = RGBColor(153, 246, 228)

        reg_tx = s2.shapes.add_textbox(Inches(0.95), Inches(reg_top + 0.06), Inches(11.3), Inches(0.72))
        reg_tf = reg_tx.text_frame
        reg_tf.word_wrap = True

        p_reg_lbl = reg_tf.paragraphs[0]
        p_reg_lbl.text = "REGIONAL FOOTPRINT"
        p_reg_lbl.font.size = Pt(8.5)
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
        p_reg_body.font.size = Pt(9)
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
            width=5.6,
            headers=["Forecast Category", "Deals", "ACV"],
            rows=fc_rows,
            col_widths=[2.8, 1.3, 1.5],
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
            width=5.6,
            headers=["Approval Status", "Deals", "ACV"],
            rows=[
                ["Approved", f"{appr_cnt} {'deal' if appr_cnt == 1 else 'deals'}", _format_currency(st_data.get("Approved", {}).get("acv", 0.0))],
                ["Pending Approval", f"{pend_cnt} {'deal' if pend_cnt == 1 else 'deals'}", _format_currency(st_data.get("Pending Approval", {}).get("acv", 0.0))],
                ["Not submitted", f"{nsub_cnt} {'deal' if nsub_cnt == 1 else 'deals'}", _format_currency(st_data.get("Not submitted", {}).get("acv", 0.0))],
            ],
            col_widths=[2.8, 1.3, 1.5],
        )

        if appr_breakdown:
            noteBox = s3.shapes.add_textbox(Inches(6.8), Inches(3.6), Inches(5.6), Inches(0.35))
            p_nt = noteBox.text_frame.paragraphs[0]
            p_nt.text = f"* Note: Approved includes {appr_breakdown}" if not appr_breakdown.startswith("incl.") else f"* Note: {appr_breakdown}"
            p_nt.font.size = Pt(8)
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
            width=5.6,
            headers=["Business Unit", "Deals", "ACV"],
            rows=bu_rows,
            empty_msg="No business units assigned in this portfolio.",
            col_widths=[2.8, 1.3, 1.5],
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
            width=5.6,
            headers=["Top Accounts", "Deals", "ACV"],
            rows=acc_rows,
            empty_msg="No customer accounts found in this portfolio.",
            col_widths=[2.8, 1.3, 1.5],
        )

        # -------------------------------------------------------------
        # Slide 4: Portfolio Action Center (Open Deals Only)
        # -------------------------------------------------------------
        s4 = prs.slides.add_slide(blank_slide_layout)
        cls._add_slide_header(
            s4,
            "Portfolio Action Center",
            f"{owner_name} — Priority open opportunities requiring attention, awaiting sign-off, or flagged for risk",
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
            width=11.6,
            headers=["Opportunity Name", "Account", "Forecast", "Status", "ACV", "Close Date"],
            rows=urgent_rows,
            empty_msg="No open opportunities requiring immediate attention. All items are current.",
            col_widths=[3.4, 2.4, 1.4, 1.5, 1.4, 1.5],
        )

        # -------------------------------------------------------------
        # Slide 5: Deal Tracker (Monthly Calendar & Closing Milestones)
        # -------------------------------------------------------------
        s_dt = prs.slides.add_slide(blank_slide_layout)
        cls._add_slide_header(
            s_dt,
            "Deal Tracker & Closing Milestones",
            f"{owner_name} — Monthly renewal schedule, upcoming close deadlines, and overdue portfolio items",
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
            width=5.6,
            headers=["Renewal Month", "Deals", "Approved ACV", "Total ACV"],
            rows=cal_rows,
            col_widths=[1.8, 1.1, 1.35, 1.35],
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
            width=5.6,
            headers=["Opportunity", "Account", "ACV", "Timeline Status"],
            rows=soon_rows[:8],
            empty_msg="No deals closing in the next 30 days. All renewal deadlines on track.",
            col_widths=[2.1, 1.5, 1.0, 1.0],
        )

        # -------------------------------------------------------------
        # Slide 6: Upcoming Service Expiry & Contract Expiry Explanation
        # -------------------------------------------------------------
        s_exp = prs.slides.add_slide(blank_slide_layout)
        cls._add_slide_header(
            s_exp,
            "Upcoming Service Expiry Schedule",
            f"{owner_name} — Service contracts expiring within the next 60 days",
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
            width=11.6,
            headers=["Opportunity Name", "Account", "ACV", "Service Expiry Date", "Time to Expiry"],
            rows=exp_rows,
            empty_msg="No upcoming service contract expirations in the next 60 days.",
            col_widths=[3.4, 2.4, 1.6, 2.2, 2.0],
        )

        # Caption note
        caption_box = s_exp.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(5.9), Inches(11.6), Inches(0.7))
        caption_box.fill.solid()
        caption_box.fill.fore_color.rgb = RGBColor(240, 249, 255)
        caption_box.line.color.rgb = RGBColor(186, 230, 253)
        c_tf = caption_box.text_frame
        c_tf.word_wrap = True
        p_c = c_tf.paragraphs[0]
        p_c.text = "Service expiry = end date of the current (expiring) contract. The renewal period starts the next day."
        p_c.font.size = Pt(9.5)
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
                width=11.6,
                headers=["Change Type", "Opportunity Name", "Account", "ACV Impact", "Details"],
                rows=change_rows,
                empty_msg="No portfolio changes recorded since baseline snapshot.",
                col_widths=[2.0, 3.2, 2.2, 1.8, 2.4],
            )

        # -------------------------------------------------------------
        # Slide 8: Messages, Comments & Data Governance Notes
        # -------------------------------------------------------------
        s_msg = prs.slides.add_slide(blank_slide_layout)
        cls._add_slide_header(
            s_msg,
            "Messages, Management Feedback & Portfolio Notes",
            f"{owner_name} — Communication activity, recent management comments, and data governance notes",
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
            width=11.6,
            headers=["Author", "Deal", "Management Shared Comment", "Date"],
            rows=cmt_rows,
            empty_msg="No comments in this period. All communication threads are up to date.",
            col_widths=[2.0, 2.8, 5.2, 1.6],
        )

        data_notes = overview_data.get("data_notes") or {}
        note_str = data_notes.get("note_text") or "All portfolio totals reflect active renewal records."
        threads_str = f"Open Communication Threads: {open_threads}   |   Unread Messages: {unread_cnt}"

        d_box = s_msg.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(5.7), Inches(11.6), Inches(0.9))
        d_box.fill.solid()
        d_box.fill.fore_color.rgb = RGBColor(248, 250, 252)
        d_box.line.color.rgb = RGBColor(226, 232, 240)
        d_tf = d_box.text_frame
        d_tf.word_wrap = True

        p_t1 = d_tf.paragraphs[0]
        p_t1.text = threads_str
        p_t1.font.size = Pt(9.5)
        p_t1.font.bold = True
        p_t1.font.color.rgb = COLOR_NAVY

        p_t2 = d_tf.add_paragraph()
        p_t2.text = f"Data Notes: {note_str}"
        p_t2.font.size = Pt(8.5)
        p_t2.font.color.rgb = COLOR_GRAY
        p_t2.space_before = Pt(3)

        # Footer on every slide
        total_slides = len(prs.slides)
        for idx, slide in enumerate(prs.slides, 1):
            cls._add_slide_footer(slide, idx, total_slides, owner_name, as_of_formatted)

        out = io.BytesIO()
        prs.save(out)
        out.seek(0)
        return out

    @classmethod
    def _add_slide_header(cls, slide, title_text: str, subtitle_text: str):
        txBox = slide.shapes.add_textbox(Inches(0.8), Inches(0.4), Inches(11.6), Inches(0.8))
        tf = txBox.text_frame
        tf.word_wrap = True

        p1 = tf.paragraphs[0]
        p1.text = title_text
        p1.font.size = Pt(19)
        p1.font.bold = True
        p1.font.color.rgb = COLOR_NAVY

        p2 = tf.add_paragraph()
        p2.text = subtitle_text
        p2.font.size = Pt(9.5)
        p2.font.color.rgb = COLOR_GRAY
        p2.space_before = Pt(2)

    @classmethod
    def _add_slide_footer(cls, slide, slide_num: int, total_slides: int, owner_name: str, as_of_formatted: str):
        txBox = slide.shapes.add_textbox(Inches(0.8), Inches(7.05), Inches(11.6), Inches(0.35))
        tf = txBox.text_frame
        p = tf.paragraphs[0]
        p.text = f"Slide {slide_num} of {total_slides}   |   Opportunity Owner: {owner_name}   |   Snapshot Date: {as_of_formatted}   |   Mobileum Confidential"
        p.font.size = Pt(8)
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
        aligned columns, and an empty state callout box when rows are empty.
        """
        # Empty table state -> render styled callout box
        if not rows:
            msg = empty_msg or "No records in this section."
            box = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(left), Inches(top), Inches(width), Inches(0.65))
            box.fill.solid()
            box.fill.fore_color.rgb = RGBColor(248, 250, 252)
            box.line.color.rgb = RGBColor(226, 232, 240)
            tf = box.text_frame
            tf.word_wrap = True
            p = tf.paragraphs[0]
            p.text = msg
            p.font.size = Pt(9.5)
            p.font.color.rgb = COLOR_GRAY
            p.alignment = PP_ALIGN.CENTER
            return

        rows_count = len(rows) + 1
        cols_count = len(headers)

        header_h = Inches(0.38)
        row_h = Inches(0.34)
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
            p.font.size = Pt(9)
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
                cell.text = str(val)
                cell.vertical_anchor = MSO_ANCHOR.MIDDLE
                cell.fill.solid()
                cell.margin_left = Inches(0.08)
                cell.margin_right = Inches(0.08)
                if is_total_row:
                    cell.fill.fore_color.rgb = RGBColor(226, 232, 240)
                else:
                    cell.fill.fore_color.rgb = COLOR_WHITE if r_idx % 2 == 0 else COLOR_LIGHT_BG
                p = cell.text_frame.paragraphs[0]
                p.font.size = Pt(8.5)
                if is_total_row:
                    p.font.bold = True
                    p.font.color.rgb = COLOR_NAVY
                else:
                    p.font.color.rgb = COLOR_NAVY
                h_name = headers[c_idx] if c_idx < len(headers) else ""
                if _is_numeric_header(h_name):
                    p.alignment = PP_ALIGN.RIGHT
                elif _is_center_header(h_name):
                    p.alignment = PP_ALIGN.CENTER
                else:
                    p.alignment = PP_ALIGN.LEFT

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
        Uses A4 landscape on ALL pages, compact content-sized tables, wrapped cell names,
        4x2 metric cards on Page 2, and empty state message boxes.
        """
        kpis = overview_data.get("kpis") or overview_data.get("total") or {}
        tot_count = kpis.get("total_count", len(deals))
        tot_acv = kpis.get("total_acv", sum(float(d.get("forecast_acv_amount") or 0.0) for d in deals))

        as_of_formatted = _format_date_with_year(as_of_date)
        compare_formatted = _format_date_with_year(compare_as_of_date or overview_data.get("compare_as_of"))
        period_display = overview_data.get("period") or ("All periods" if period in ("all_open", "All open deals", "All periods") else period)

        pdf_buf = io.BytesIO()

        def _format_pdf_table(t, headers: list[str], num_rows: int, has_total_row: bool = False):
            t.auto_set_font_size(False)
            t.set_fontsize(7.5)
            total_pt = 28.0 + num_rows * 24.0
            header_frac = 28.0 / total_pt
            row_frac = 24.0 / total_pt

            for (r, c), cell in t.get_celld().items():
                cell.set_edgecolor("#CBD5E1")
                cell.set_linewidth(0.5)
                h_name = headers[c] if c < len(headers) else ""
                text = cell.get_text()

                if r == 0:
                    cell.set_height(header_frac)
                    cell.set_facecolor("#12284C")
                    text.set_color("white")
                    text.set_fontweight("bold")
                    text.set_fontsize(8.0)
                else:
                    cell.set_height(row_frac)
                    is_tot = (has_total_row and r == num_rows)
                    if is_tot:
                        cell.set_facecolor("#E2E8F0")
                        text.set_color("#12284C")
                        text.set_fontweight("bold")
                    elif r % 2 == 0:
                        cell.set_facecolor("#F8FAFC")
                        text.set_color("#12284C")
                    else:
                        cell.set_facecolor("#FFFFFF")
                        text.set_color("#12284C")
                    text.set_fontsize(7.5)

                if _is_numeric_header(h_name):
                    text.set_horizontalalignment("right")
                    text.set_x(0.92)
                elif _is_center_header(h_name):
                    text.set_horizontalalignment("center")
                    text.set_x(0.50)
                else:
                    text.set_horizontalalignment("left")
                    text.set_x(0.08)

        what_changed = overview_data.get("what_changed") or {}
        has_changes = bool(what_changed.get("has_changes"))
        total_pages = 7 if not has_changes else 8

        with PdfPages(pdf_buf) as pdf:
            current_page = 1

            # -------------------------------------------------------------
            # Page 1: Cover Page (Fixed A4 Landscape, centered brand block)
            # -------------------------------------------------------------
            fig, ax = plt.subplots(figsize=A4_LANDSCAPE)
            fig.patch.set_facecolor("#12284C")
            ax.set_facecolor("#12284C")
            ax.axis("off")

            # Brand accent vertical bar
            ax.plot([0.12, 0.12], [0.36, 0.74], color="#00A3AD", linewidth=6)

            # Left-aligned cover block inside consistent margins
            ax.text(0.16, 0.70, "MOBILEUM HORIZON RENEWALS", color="#00A3AD", fontsize=13, fontweight="bold")
            ax.text(0.16, 0.60, "Renewal Portfolio Report", color="white", fontsize=28, fontweight="bold")
            ax.text(0.16, 0.51, f"Opportunity Owner: {owner_name} ({kam_name})", color="white", fontsize=16)
            ax.text(
                0.16,
                0.40,
                f"Scope: {period_display}   |   Data date: {as_of_formatted}   |   Compare to: {compare_formatted}\nGenerated: {datetime.now(timezone.utc).strftime('%b %d, %Y')}",
                color="#94A3B8",
                fontsize=11,
            )

            # Footer
            fig.text(0.5, 0.035, f"Page {current_page} of {total_pages}   |   Opportunity Owner: {owner_name}   |   Snapshot: {as_of_formatted}   |   Mobileum Confidential", ha="center", fontsize=8, color="#94A3B8")
            pdf.savefig(fig)
            plt.close(fig)
            current_page += 1

            # -------------------------------------------------------------
            # Page 2: Summary Tiles (4x2 equal cards) + Insights + Regional Reach
            # -------------------------------------------------------------
            fig, ax = plt.subplots(figsize=A4_LANDSCAPE)
            ax.axis("off")

            ax.text(0.06, 0.94, f"Portfolio Summary & Overview — {owner_name}", color="#12284C", fontsize=15, fontweight="bold")

            rp = overview_data.get("renewal_progress") or {}
            ac_conc = overview_data.get("account_concentration") or {}
            rp_text = rp.get("summary_sentence") or f"Showing {tot_count} {'deal' if tot_count == 1 else 'deals'} ({_format_currency(tot_acv)}) for {period_display}."
            if ac_conc.get("sentence"):
                rp_text += f"  ·  {ac_conc.get('sentence')}"

            # Subtitle wrapped to fit inside margins
            rp_text_wrapped = _wrap_text(rp_text, max_len=110, max_lines=2)
            ax.text(0.06, 0.90, rp_text_wrapped, color="#00A3AD", fontsize=8.5, fontweight="bold")

            # 8 Summary Tiles in 4x2 grid of equal cards
            appr_2nd_count = kpis.get("approved_2nd_count", 0)
            appr_cnt = kpis.get('approved_count', 0)
            appr_cnt_str = f"{appr_cnt} {'deal' if appr_cnt == 1 else 'deals'}"
            if appr_2nd_count > 0:
                appr_cnt_str += f" (incl. {appr_2nd_count} 2nd)"

            tile_defs_pdf = [
                ("MY PORTFOLIO", f"{tot_count} {'deal' if tot_count == 1 else 'deals'}", _format_currency(tot_acv), "#12284C"),
                ("COMMIT COVERAGE", f"{kpis.get('commit_coverage_count', 0)} {'deal' if kpis.get('commit_coverage_count', 0) == 1 else 'deals'}", _format_currency(kpis.get('commit_coverage_acv', 0)), "#00A3AD"),
                ("APPROVED", appr_cnt_str, _format_currency(kpis.get('approved_acv', 0)), "#10B981"),
                ("PENDING APPROVAL", f"{kpis.get('pending_approval_count', 0)} {'deal' if kpis.get('pending_approval_count', 0) == 1 else 'deals'}", _format_currency(kpis.get('pending_approval_acv', 0)), "#D97706"),
                ("NOT SUBMITTED", f"{kpis.get('not_submitted_count', 0)} {'deal' if kpis.get('not_submitted_count', 0) == 1 else 'deals'}", _format_currency(kpis.get('not_submitted_acv', 0)), "#64748B"),
                ("DELAYED RENEWALS", f"{kpis.get('delayed_count', 0)} {'deal' if kpis.get('delayed_count', 0) == 1 else 'deals'}", _format_currency(kpis.get('delayed_acv', 0)), "#E11D48"),
                ("SLIPPAGE", f"{kpis.get('slippage_count', 0)} {'deal' if kpis.get('slippage_count', 0) == 1 else 'deals'}", _format_currency(kpis.get('slippage_acv', 0)), "#D97706"),
                ("NEEDS REVIEW", f"{kpis.get('needs_review_count', 0)} {'deal' if kpis.get('needs_review_count', 0) == 1 else 'deals'}", _format_currency(kpis.get('needs_review_acv', 0)), "#1B365D"),
            ]

            card_w = (0.88 - 3 * 0.015) / 4  # 0.20875
            card_h = 0.115
            top_r1 = 0.855
            bot_r1 = top_r1 - card_h
            top_r2 = 0.720
            bot_r2 = top_r2 - card_h

            for idx, (label, count_str, acv_str, color) in enumerate(tile_defs_pdf):
                row_idx = idx // 4
                col_idx = idx % 4
                card_x = 0.06 + col_idx * (card_w + 0.015)
                card_y = bot_r1 if row_idx == 0 else bot_r2
                card_top = top_r1 if row_idx == 0 else top_r2

                # Card background
                card_rect = FancyBboxPatch(
                    (card_x, card_y), card_w, card_h,
                    boxstyle="round,pad=0.005,rounding_size=0.008",
                    facecolor="#FFFFFF", edgecolor="#E2E8F0", linewidth=0.75,
                )
                ax.add_patch(card_rect)

                # Coloured top border
                bar_rect = Rectangle(
                    (card_x + 0.002, card_top - 0.008), card_w - 0.004, 0.006,
                    facecolor=color, edgecolor="none",
                )
                ax.add_patch(bar_rect)

                # Card text (label, amount, sub-line)
                ax.text(card_x + 0.010, card_top - 0.024, label, fontsize=7.5, fontweight="bold", color=color)
                ax.text(card_x + 0.010, card_top - 0.062, acv_str, fontsize=11.5, fontweight="bold", color="#12284C")
                count_subline = _wrap_text(count_str, max_len=26, max_lines=2)
                ax.text(card_x + 0.010, card_top - 0.092, count_subline, fontsize=7.0, color="#64748B")

            # Portfolio Insights Box (full width matching tiles: 0.88)
            ins_top = 0.585
            ins_h = 0.235
            ins_box = FancyBboxPatch(
                (0.06, ins_top - ins_h), 0.88, ins_h,
                boxstyle="round,pad=0.006,rounding_size=0.008",
                facecolor="#F8FAFC", edgecolor="#CBD5E1", linewidth=0.75,
            )
            ax.add_patch(ins_box)
            ax.text(0.075, ins_top - 0.028, "PORTFOLIO INSIGHTS", fontsize=8.5, fontweight="bold", color="#12284C")

            insights_list = overview_data.get("insight_cards") or [
                f"Portfolio contains {tot_count} opportunities totaling {_format_currency(tot_acv)}.",
                f"Approved deals total {kpis.get('approved_count', 0)} worth {_format_currency(kpis.get('approved_acv', 0))}.",
                f"Awaiting approval: {kpis.get('pending_approval_count', 0)} deals worth {_format_currency(kpis.get('pending_approval_acv', 0))}.",
            ]
            y_ins = ins_top - 0.065
            for ins in insights_list[:3]:
                ins_wrapped = _wrap_text(ins, max_len=115, max_lines=2)
                ax.text(0.075, y_ins, f"• {ins_wrapped}", fontsize=8.0, color="#334155")
                y_ins -= 0.052

            # Regional Footprint Box (full width matching tiles: 0.88)
            reg_top = 0.330
            reg_h = 0.220
            reg_box = FancyBboxPatch(
                (0.06, reg_top - reg_h), 0.88, reg_h,
                boxstyle="round,pad=0.006,rounding_size=0.008",
                facecolor="#F0FDFA", edgecolor="#99F6E4", linewidth=0.75,
            )
            ax.add_patch(reg_box)
            ax.text(0.075, reg_top - 0.028, "REGIONAL FOOTPRINT", fontsize=8.5, fontweight="bold", color="#0F766E")

            region_line = overview_data.get("region_line") or {}
            if region_line.get("single_region") and region_line.get("summary_sentence"):
                reg_text = region_line.get("summary_sentence")
            else:
                regions_list = region_line.get("regions") or []
                chips_strs = [r.get("label", "") for r in regions_list if r.get("label")]
                reg_text = "  ·  ".join(chips_strs) if chips_strs else "No region breakdown available."

            reg_wrapped = _wrap_text(reg_text, max_len=115, max_lines=3)
            ax.text(0.075, reg_top - 0.070, reg_wrapped, fontsize=8.5, color="#0F172A")

            fig.text(0.5, 0.035, f"Page {current_page} of {total_pages}   |   Opportunity Owner: {owner_name}   |   Snapshot: {as_of_formatted}   |   Mobileum Confidential", ha="center", fontsize=8, color="#64748B")
            pdf.savefig(fig)
            plt.close(fig)
            current_page += 1

            # -------------------------------------------------------------
            # Page 3: Pipeline, Approvals, BU & Top Accounts
            # -------------------------------------------------------------
            fig, ax = plt.subplots(figsize=A4_LANDSCAPE)
            ax.axis("off")

            ax.text(0.06, 0.94, f"Pipeline & Distributions — {owner_name}", color="#12284C", fontsize=15, fontweight="bold")
            ax.text(0.06, 0.91, "Forecast categories, approval sign-off status, business units, and key customer accounts", color="#64748B", fontsize=9)

            # 1. Forecast Categories Table
            fc_data = overview_data.get("forecast_categories") or {}
            fc_table_data = [["Forecast Category", "Deals", "ACV"]]
            for cat in ["Closed", "Commit", "Best Case", "Pipeline", "Not yet proposed"]:
                cnt = fc_data.get(cat, {}).get("count", 0)
                fc_table_data.append([cat, f"{cnt} {'deal' if cnt == 1 else 'deals'}", _format_currency(fc_data.get(cat, {}).get("acv", 0.0))])

            fc_h = (28.0 + 5 * 24.0) / PAGE_HEIGHT_PT
            t1 = ax.table(cellText=fc_table_data, colWidths=[0.22, 0.09, 0.11], loc="upper left", bbox=[0.06, 0.88 - fc_h, 0.42, fc_h])
            _format_pdf_table(t1, ["Forecast Category", "Deals", "ACV"], num_rows=5)

            # 2. Approval Status Table
            st_data = overview_data.get("approval_statuses") or {}
            appr_breakdown = kpis.get("approved_2nd_breakdown")
            appr_cnt = st_data.get("Approved", {}).get("count", 0)
            pend_cnt = st_data.get("Pending Approval", {}).get("count", 0)
            nsub_cnt = st_data.get("Not submitted", {}).get("count", 0)

            st_table_data = [
                ["Approval Status", "Deals", "ACV"],
                ["Approved", f"{appr_cnt} {'deal' if appr_cnt == 1 else 'deals'}", _format_currency(st_data.get("Approved", {}).get("acv", 0.0))],
                ["Pending Approval", f"{pend_cnt} {'deal' if pend_cnt == 1 else 'deals'}", _format_currency(st_data.get("Pending Approval", {}).get("acv", 0.0))],
                ["Not submitted", f"{nsub_cnt} {'deal' if nsub_cnt == 1 else 'deals'}", _format_currency(st_data.get("Not submitted", {}).get("acv", 0.0))],
            ]

            st_h = (28.0 + 3 * 24.0) / PAGE_HEIGHT_PT
            t2 = ax.table(cellText=st_table_data, colWidths=[0.22, 0.09, 0.11], loc="upper left", bbox=[0.52, 0.88 - st_h, 0.42, st_h])
            _format_pdf_table(t2, ["Approval Status", "Deals", "ACV"], num_rows=3)

            if appr_breakdown:
                note_str = f"* Note: Approved includes {appr_breakdown}" if not appr_breakdown.startswith("incl.") else f"* Note: {appr_breakdown}"
                ax.text(0.52, 0.88 - st_h - 0.03, note_str, fontsize=7.5, color="#64748B", style="italic")

            # 3. Business Units Table
            charts = overview_data.get("charts") or {}
            bu_list = (charts.get("business_units") or [])[:5]
            bu_table_data = [["Business Unit", "Deals", "ACV"]]
            for b in bu_list:
                cnt = b.get("count", 0)
                bu_table_data.append([_wrap_text(b.get("bu") or b.get("business_unit") or "Unassigned", max_len=24), f"{cnt} {'deal' if cnt == 1 else 'deals'}", _format_currency(b.get("acv", 0.0))])

            bu_rows_count = max(len(bu_table_data) - 1, 1)
            if len(bu_table_data) == 1:
                bu_table_data.append(["None", "0 deals", "$0.00"])

            bu_h = (28.0 + bu_rows_count * 24.0) / PAGE_HEIGHT_PT
            t3 = ax.table(cellText=bu_table_data, colWidths=[0.22, 0.09, 0.11], loc="upper left", bbox=[0.06, 0.54 - bu_h, 0.42, bu_h])
            _format_pdf_table(t3, ["Business Unit", "Deals", "ACV"], num_rows=bu_rows_count)

            # 4. Top Accounts Table
            acc_list = (charts.get("top_accounts") or [])[:5]
            acc_table_data = [["Top Account", "Deals", "ACV"]]
            for a in acc_list:
                cnt = a.get("count", 0)
                acc_table_data.append([_wrap_text(a.get("account_name", ""), max_len=24), f"{cnt} {'deal' if cnt == 1 else 'deals'}", _format_currency(a.get("acv", 0.0))])

            acc_rows_count = max(len(acc_table_data) - 1, 1)
            if len(acc_table_data) == 1:
                acc_table_data.append(["None", "0 deals", "$0.00"])

            acc_h = (28.0 + acc_rows_count * 24.0) / PAGE_HEIGHT_PT
            t4 = ax.table(cellText=acc_table_data, colWidths=[0.22, 0.09, 0.11], loc="upper left", bbox=[0.52, 0.54 - acc_h, 0.42, acc_h])
            _format_pdf_table(t4, ["Top Account", "Deals", "ACV"], num_rows=acc_rows_count)

            fig.text(0.5, 0.035, f"Page {current_page} of {total_pages}   |   Opportunity Owner: {owner_name}   |   Snapshot: {as_of_formatted}   |   Mobileum Confidential", ha="center", fontsize=8, color="#64748B")
            pdf.savefig(fig)
            plt.close(fig)
            current_page += 1

            # -------------------------------------------------------------
            # Page 4: Portfolio Action Center (Open Deals Only)
            # -------------------------------------------------------------
            fig, ax = plt.subplots(figsize=A4_LANDSCAPE)
            ax.axis("off")

            ax.text(0.06, 0.94, f"Portfolio Action Center — {owner_name}", color="#12284C", fontsize=15, fontweight="bold")
            ax.text(0.06, 0.91, "Priority open items requiring attention, pending sign-offs, or flagged for renewal risk", color="#64748B", fontsize=9)

            actions = overview_data.get("action_lists", {})
            urgent_candidates = actions.get("immediate_attention") or actions.get("delayed_deals") or []
            urgent = [d for d in urgent_candidates if is_deal_open(d)]
            if not urgent:
                urgent = [d for d in deals if is_deal_open(d) and d.get("approval_status") not in ("Approved", "Approved - 2nd")]
            if not urgent:
                urgent = [d for d in deals if is_deal_open(d)]

            if urgent:
                urg_data = [["Opportunity Name", "Account", "Forecast", "Status", "ACV", "Close Date"]]
                for d in urgent[:14]:
                    urg_data.append([
                        _wrap_text(d.get("opportunity_name", ""), max_len=28),
                        _wrap_text(d.get("account_name", ""), max_len=20),
                        str(d.get("forecast_category", "")),
                        str(d.get("approval_status", "")),
                        _format_currency(d.get("forecast_acv_amount")),
                        str(d.get("close_date", ""))[:10],
                    ])

                num_urg_rows = len(urg_data) - 1
                urg_h = (28.0 + num_urg_rows * 24.0) / PAGE_HEIGHT_PT
                t_action = ax.table(
                    cellText=urg_data,
                    colWidths=[0.30, 0.20, 0.12, 0.13, 0.13, 0.12],
                    loc="upper left",
                    bbox=[0.06, 0.88 - urg_h, 0.88, urg_h],
                )
                _format_pdf_table(t_action, ["Opportunity Name", "Account", "Forecast", "Status", "ACV", "Close Date"], num_rows=num_urg_rows)
            else:
                # Slim full-width message box for empty state
                ax.text(
                    0.06, 0.82,
                    "No open opportunities requiring immediate attention. All portfolio items are current or approved.",
                    fontsize=9.5, color="#64748B",
                    bbox=dict(boxstyle="round,pad=0.8", facecolor="#F8FAFC", edgecolor="#CBD5E1"),
                )

            fig.text(0.5, 0.035, f"Page {current_page} of {total_pages}   |   Opportunity Owner: {owner_name}   |   Snapshot: {as_of_formatted}   |   Mobileum Confidential", ha="center", fontsize=8, color="#64748B")
            pdf.savefig(fig)
            plt.close(fig)
            current_page += 1

            # -------------------------------------------------------------
            # Page 5: Deal Tracker (Monthly Calendar & Closing Milestones)
            # -------------------------------------------------------------
            fig, ax = plt.subplots(figsize=A4_LANDSCAPE)
            ax.axis("off")

            ax.text(0.06, 0.94, f"Deal Tracker & Milestones — {owner_name}", color="#12284C", fontsize=15, fontweight="bold")
            ax.text(0.06, 0.91, "Monthly renewal calendar breakdown and near-term closing deadlines", color="#64748B", fontsize=9)

            # Monthly summary table for ALL months
            month_summary_pdf: Dict[str, Dict[str, Any]] = {}
            for d in deals:
                cd = (d.get("close_date") or "")[:7] or "Unscheduled"
                if cd not in month_summary_pdf:
                    month_summary_pdf[cd] = {"count": 0, "acv": 0.0, "approved_acv": 0.0}
                month_summary_pdf[cd]["count"] += 1
                amt = float(d.get("forecast_acv_amount") or 0.0)
                month_summary_pdf[cd]["acv"] += amt
                if d.get("approval_status") in ("Approved", "Approved - 2nd"):
                    month_summary_pdf[cd]["approved_acv"] += amt

            sorted_m_pdf = sorted(month_summary_pdf.keys(), key=lambda x: (1 if x == "Unscheduled" else 0, x))
            cal_pdf_data = [["Month", "Deals", "Approved ACV", "Total ACV"]]
            tot_p_cnt = 0
            tot_p_appr = 0.0
            tot_p_acv = 0.0
            for m in sorted_m_pdf:
                info = month_summary_pdf[m]
                lbl = m
                if m != "Unscheduled":
                    try:
                        lbl = datetime.fromisoformat(f"{m}-01").strftime("%b %Y")
                    except Exception:
                        pass
                tot_p_cnt += info["count"]
                tot_p_appr += info["approved_acv"]
                tot_p_acv += info["acv"]
                cnt_str = f"{info['count']} {'deal' if info['count'] == 1 else 'deals'}"
                cal_pdf_data.append([lbl, cnt_str, _format_currency(info["approved_acv"]), _format_currency(info["acv"])])

            tot_p_lbl = f"{tot_p_cnt} {'deal' if tot_p_cnt == 1 else 'deals'}"
            cal_pdf_data.append(["Total", tot_p_lbl, _format_currency(tot_p_appr), _format_currency(tot_p_acv)])

            num_cal_rows = len(cal_pdf_data) - 1
            cal_h = (28.0 + num_cal_rows * 24.0) / PAGE_HEIGHT_PT
            t_cal = ax.table(
                cellText=cal_pdf_data,
                colWidths=[0.14, 0.08, 0.10, 0.10],
                loc="upper left",
                bbox=[0.06, 0.88 - cal_h, 0.42, cal_h],
            )
            _format_pdf_table(t_cal, ["Month", "Deals", "Approved ACV", "Total ACV"], num_rows=num_cal_rows, has_total_row=True)

            # Closing soon / Overdue table (OPEN DEALS ONLY)
            soon_pdf_data = [["Opportunity", "Account", "ACV", "Timeline"]]
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
                            opp_name = _wrap_text(d.get("opportunity_name", ""), max_len=20)
                            acc_name = _wrap_text(d.get("account_name", ""), max_len=14)
                            acv_str = _format_currency(d.get("forecast_acv_amount"))
                            if diff < 0:
                                soon_pdf_data.append([opp_name, acc_name, acv_str, f"{abs(diff)}d overdue"])
                            elif 0 <= diff <= 30:
                                soon_pdf_data.append([opp_name, acc_name, acv_str, f"{diff}d left" if diff > 0 else "Closes today"])
            except Exception as e:
                log.warning(f"Error computing soon_pdf_data: {e}")

            if len(soon_pdf_data) > 1:
                num_soon_rows = min(len(soon_pdf_data) - 1, 14)
                soon_h = (28.0 + num_soon_rows * 24.0) / PAGE_HEIGHT_PT
                t_soon = ax.table(
                    cellText=soon_pdf_data[:15],
                    colWidths=[0.17, 0.12, 0.09, 0.06],
                    loc="upper left",
                    bbox=[0.52, 0.88 - soon_h, 0.44, soon_h],
                )
                _format_pdf_table(t_soon, ["Opportunity", "Account", "ACV", "Timeline"], num_rows=num_soon_rows)
            else:
                # Slim message box on right side
                ax.text(
                    0.52, 0.82,
                    "No deals closing in the next 30 days.\nAll portfolio renewal deadlines are on track.",
                    fontsize=9.5, color="#64748B",
                    bbox=dict(boxstyle="round,pad=0.8", facecolor="#F8FAFC", edgecolor="#CBD5E1"),
                )

            fig.text(0.5, 0.035, f"Page {current_page} of {total_pages}   |   Opportunity Owner: {owner_name}   |   Snapshot: {as_of_formatted}   |   Mobileum Confidential", ha="center", fontsize=8, color="#64748B")
            pdf.savefig(fig)
            plt.close(fig)
            current_page += 1

            # -------------------------------------------------------------
            # Page 6: Upcoming Service Expiry & Contract Expiry Explanation
            # -------------------------------------------------------------
            fig, ax = plt.subplots(figsize=A4_LANDSCAPE)
            ax.axis("off")

            ax.text(0.06, 0.94, f"Upcoming Service Expiry Schedule — {owner_name}", color="#12284C", fontsize=15, fontweight="bold")
            ax.text(0.06, 0.91, "Service contracts expiring within the next 60 days", color="#64748B", fontsize=9)

            upcoming_exp = overview_data.get("upcoming_service_expiry") or []
            exp_pdf_data = [["Opportunity Name", "Account", "ACV", "Service Expiry Date", "Time to Expiry"]]
            for item in upcoming_exp[:12]:
                d = item.get("deal") or item
                exp_pdf_data.append([
                    _wrap_text(d.get("opportunity_name", ""), max_len=28),
                    _wrap_text(d.get("account_name", ""), max_len=20),
                    _format_currency(d.get("forecast_acv_amount")),
                    str(item.get("service_expiry_date", ""))[:10],
                    str(item.get("days_label", "")),
                ])

            if len(exp_pdf_data) > 1:
                num_exp_rows = len(exp_pdf_data) - 1
                exp_h = (28.0 + num_exp_rows * 24.0) / PAGE_HEIGHT_PT
                t_exp = ax.table(
                    cellText=exp_pdf_data,
                    colWidths=[0.30, 0.22, 0.14, 0.16, 0.18],
                    loc="upper left",
                    bbox=[0.06, 0.88 - exp_h, 0.88, exp_h],
                )
                _format_pdf_table(t_exp, ["Opportunity Name", "Account", "ACV", "Service Expiry Date", "Time to Expiry"], num_rows=num_exp_rows)
                caption_y = max(0.10, 0.88 - exp_h - 0.08)
            else:
                ax.text(
                    0.06, 0.82,
                    "No upcoming service contract expirations in the next 60 days.\nAll portfolio service contracts remain active.",
                    fontsize=9.5, color="#64748B",
                    bbox=dict(boxstyle="round,pad=0.8", facecolor="#F8FAFC", edgecolor="#CBD5E1"),
                )
                caption_y = 0.70

            caption_str = "Service expiry = end date of the current (expiring) contract. The renewal period starts the next day."
            ax.text(
                0.06, caption_y, caption_str,
                fontsize=9, color="#0369A1", fontweight="bold",
                bbox=dict(boxstyle="round,pad=0.6", facecolor="#F0F9FF", edgecolor="#BAE6FD"),
            )

            fig.text(0.5, 0.035, f"Page {current_page} of {total_pages}   |   Opportunity Owner: {owner_name}   |   Snapshot: {as_of_formatted}   |   Mobileum Confidential", ha="center", fontsize=8, color="#64748B")
            pdf.savefig(fig)
            plt.close(fig)
            current_page += 1

            # -------------------------------------------------------------
            # Page 7: What Changed (Conditional if changes exist)
            # -------------------------------------------------------------
            if has_changes:
                fig, ax = plt.subplots(figsize=A4_LANDSCAPE)
                ax.axis("off")

                ax.text(0.06, 0.94, f"What Changed Since {compare_formatted} — {owner_name}", color="#12284C", fontsize=15, fontweight="bold")
                ax.text(0.06, 0.91, "Summary of new deals, ACV modifications, stage changes, and portfolio movements", color="#64748B", fontsize=9)

                wc_data = [["Type", "Opportunity Name", "Account", "ACV Impact", "Details"]]
                for nd in (what_changed.get("new_deals") or [])[:5]:
                    wc_data.append(["New Deal", _wrap_text(nd.get("opportunity_name", ""), max_len=26), _wrap_text(nd.get("account_name", ""), max_len=18), f"+{_format_currency(nd.get('acv'))}", nd.get("stage", "")])
                for ca in (what_changed.get("acv_changes") or [])[:5]:
                    diff = ca.get("diff_acv", 0.0)
                    diff_str = f"{'+' if diff > 0 else ''}{_format_currency(diff)}"
                    wc_data.append(["ACV Change", _wrap_text(ca.get("opportunity_name", ""), max_len=26), _wrap_text(ca.get("account_name", ""), max_len=18), diff_str, f"{_format_currency(ca.get('old_acv'))} → {_format_currency(ca.get('new_acv'))}"])
                for st in (what_changed.get("stage_changes") or [])[:3]:
                    wc_data.append(["Stage Change", _wrap_text(st.get("opportunity_name", ""), max_len=26), _wrap_text(st.get("account_name", ""), max_len=18), "—", f"{st.get('old_stage')} → {st.get('new_stage')}"])
                for cat in (what_changed.get("category_changes") or [])[:3]:
                    wc_data.append(["Category Change", _wrap_text(cat.get("opportunity_name", ""), max_len=26), _wrap_text(cat.get("account_name", ""), max_len=18), "—", f"{cat.get('old_category')} → {cat.get('new_category')}"])
                for cw in (what_changed.get("closed_won") or [])[:3]:
                    wc_data.append(["Closed Won", _wrap_text(cw.get("opportunity_name", ""), max_len=26), _wrap_text(cw.get("account_name", ""), max_len=18), _format_currency(cw.get("acv")), "Won"])
                for rm in (what_changed.get("removed_deals") or [])[:3]:
                    wc_data.append(["Removed / Lost", _wrap_text(rm.get("opportunity_name", ""), max_len=26), _wrap_text(rm.get("account_name", ""), max_len=18), f"-{_format_currency(rm.get('acv'))}", rm.get("reason", "")])

                if len(wc_data) > 1:
                    num_wc_rows = len(wc_data) - 1
                    wc_h = (28.0 + num_wc_rows * 24.0) / PAGE_HEIGHT_PT
                    t_wc = ax.table(
                        cellText=wc_data,
                        colWidths=[0.16, 0.28, 0.18, 0.16, 0.22],
                        loc="upper left",
                        bbox=[0.06, 0.88 - wc_h, 0.88, wc_h],
                    )
                    _format_pdf_table(t_wc, ["Type", "Opportunity Name", "Account", "ACV Impact", "Details"], num_rows=num_wc_rows)
                else:
                    ax.text(
                        0.06, 0.82,
                        "No portfolio changes recorded since baseline snapshot.",
                        fontsize=9.5, color="#64748B",
                        bbox=dict(boxstyle="round,pad=0.8", facecolor="#F8FAFC", edgecolor="#CBD5E1"),
                    )

                fig.text(0.5, 0.035, f"Page {current_page} of {total_pages}   |   Opportunity Owner: {owner_name}   |   Snapshot: {as_of_formatted}   |   Mobileum Confidential", ha="center", fontsize=8, color="#64748B")
                pdf.savefig(fig)
                plt.close(fig)
                current_page += 1

            # -------------------------------------------------------------
            # Final Page: Messages, Feedback & Governance Notes
            # -------------------------------------------------------------
            fig, ax = plt.subplots(figsize=A4_LANDSCAPE)
            ax.axis("off")

            ax.text(0.06, 0.94, f"Messages, Feedback & Data Notes — {owner_name}", color="#12284C", fontsize=15, fontweight="bold")
            ax.text(0.06, 0.91, "Communication activity, management feedback comments, and portfolio data notes", color="#64748B", fontsize=9)

            msg_summary = overview_data.get("messages_and_comments_summary") or {}
            open_threads = msg_summary.get("open_threads", 0)
            unread_cnt = msg_summary.get("unread_count", 0)
            shared_cmts = msg_summary.get("latest_shared_comments") or []

            cmt_rows = [["Author", "Deal", "Management Shared Comment", "Date"]]
            for c in shared_cmts[:8]:
                cmt_rows.append([
                    _wrap_text(c.get("author", ""), max_len=18),
                    _wrap_text(c.get("deal_name", ""), max_len=22),
                    _wrap_text(c.get("text", ""), max_len=48),
                    str(c.get("created_at_formatted", ""))[:12],
                ])

            if len(cmt_rows) > 1:
                num_cmt_rows = len(cmt_rows) - 1
                cmt_h = (28.0 + num_cmt_rows * 24.0) / PAGE_HEIGHT_PT
                t_cmt = ax.table(
                    cellText=cmt_rows,
                    colWidths=[0.18, 0.24, 0.44, 0.14],
                    loc="upper left",
                    bbox=[0.06, 0.88 - cmt_h, 0.88, cmt_h],
                )
                _format_pdf_table(t_cmt, ["Author", "Deal", "Management Shared Comment", "Date"], num_rows=num_cmt_rows)
                notes_y = max(0.12, 0.88 - cmt_h - 0.10)
            else:
                ax.text(
                    0.06, 0.82,
                    "No shared management comments in this period. All communication threads are up to date.",
                    fontsize=9.5, color="#64748B",
                    bbox=dict(boxstyle="round,pad=0.8", facecolor="#F8FAFC", edgecolor="#CBD5E1"),
                )
                notes_y = 0.65

            # Data notes box
            data_notes = overview_data.get("data_notes") or {}
            note_str = data_notes.get("note_text") or "All portfolio totals reflect active renewal records."
            summary_info = f"Open Communication Threads: {open_threads}   |   Unread Messages: {unread_cnt}\nData Notes: {note_str}"

            ax.text(
                0.06, notes_y, summary_info,
                fontsize=9, color="#12284C",
                bbox=dict(boxstyle="round,pad=0.6", facecolor="#F8FAFC", edgecolor="#CBD5E1"),
            )

            fig.text(0.5, 0.035, f"Page {current_page} of {total_pages}   |   Opportunity Owner: {owner_name}   |   Snapshot: {as_of_formatted}   |   Mobileum Confidential", ha="center", fontsize=8, color="#64748B")
            pdf.savefig(fig)
            plt.close(fig)

        pdf_buf.seek(0)
        return pdf_buf
