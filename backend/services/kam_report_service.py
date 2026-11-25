"""
KAM Report Generation Service (Round 22 & Round 26).
Generates strictly-scoped, professionally styled PowerPoint (.pptx)
and multi-page PDF (.pdf) reports for a Key Account Manager's portfolio.
Matches the KAM Overview:
- Header shows full date labels with year (Data date & Compare to) and period
- Slide/Page 1: 8 summary tiles + 3 insight sentences + region line
- Slide/Page 2: Forecast & Approval split + BU split + Top accounts
- Slide/Page 3: Portfolio Action Center (active action list)
- Slide/Page 4: "What changed" (if changes exist between snapshots)
"""
from __future__ import annotations

import io
from datetime import datetime, timezone
from typing import Any, List, Dict, Optional

# PPTX styling & generation
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.enum.shapes import MSO_SHAPE

# PDF generation via matplotlib's vector PDF backend
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages


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


def _format_currency(val: float | int | None) -> str:
    if val is None:
        return "$0.00"
    return f"${float(val):,.2f}"


def _format_date_with_year(d_str: str | None) -> str:
    if not d_str:
        return "—"
    try:
        clean = d_str[:10]
        dt = datetime.fromisoformat(clean)
        return dt.strftime("%b %d, %Y")
    except Exception:
        return str(d_str)


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
        period_display = "All periods" if period in ("all_open", "All open deals", "All periods") else period

        # -------------------------------------------------------------
        # Slide 1: Cover Slide
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
        # Slide 2: 8 Summary Tiles + 3 Insight Sentences + Region Line
        # -------------------------------------------------------------
        s2 = prs.slides.add_slide(blank_slide_layout)
        cls._add_slide_header(
            s2,
            "Portfolio Summary & Overview",
            f"{owner_name} — Key health metrics, executive observations, and regional footprint for {period_display}",
        )

        # 8 KPI Tiles (2 rows of 4)
        tile_defs = [
            ("TOTAL PORTFOLIO", str(tot_count), _format_currency(tot_acv), COLOR_NAVY),
            ("COMMIT COVERAGE", f"{kpis.get('commit_coverage_count', 0)} deals", _format_currency(kpis.get('commit_coverage_acv', 0)), COLOR_BLUE),
            ("COMMIT", f"{kpis.get('commit_count', 0)} deals", _format_currency(kpis.get('commit_acv', 0)), COLOR_DARK_BLUE),
            ("CLOSED", f"{kpis.get('closed_count', 0)} deals", _format_currency(kpis.get('closed_acv', 0)), COLOR_EMERALD),
            ("BEST CASE", f"{kpis.get('best_case_count', 0)} deals", _format_currency(kpis.get('best_case_acv', 0)), COLOR_BLUE),
            ("PIPELINE", f"{kpis.get('pipeline_count', 0)} deals", _format_currency(kpis.get('pipeline_acv', 0)), COLOR_GRAY),
            ("DELAYED RENEWALS", f"{kpis.get('delayed_count', 0)} deals", _format_currency(kpis.get('delayed_acv', 0)), COLOR_ROSE),
            ("APPROVALS NEEDED", f"{kpis.get('pending_approval_count', 0) + kpis.get('not_submitted_count', 0)} deals", _format_currency(kpis.get('pending_approval_acv', 0) + kpis.get('not_submitted_acv', 0)), COLOR_AMBER),
        ]

        left_base = 0.8
        top_base = 1.6
        width = 2.7
        height = 1.2
        for i, (label, count_str, acv_str, color) in enumerate(tile_defs):
            r = i // 4
            c = i % 4
            t_left = left_base + c * (width + 0.25)
            t_top = top_base + r * (height + 0.2)

            card = s2.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(t_left), Inches(t_top), Inches(width), Inches(height))
            card.fill.solid()
            card.fill.fore_color.rgb = COLOR_LIGHT_BG
            card.line.color.rgb = RGBColor(226, 232, 240)

            top_bar = s2.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(t_left), Inches(t_top), Inches(width), Inches(0.08))
            top_bar.fill.solid()
            top_bar.fill.fore_color.rgb = color
            top_bar.line.fill.background()

            tbox = s2.shapes.add_textbox(Inches(t_left + 0.15), Inches(t_top + 0.12), Inches(width - 0.3), Inches(height - 0.2))
            tf = tbox.text_frame
            tf.word_wrap = True

            p_lbl = tf.paragraphs[0]
            p_lbl.text = label
            p_lbl.font.size = Pt(8.5)
            p_lbl.font.bold = True
            p_lbl.font.color.rgb = COLOR_GRAY

            p_acv = tf.add_paragraph()
            p_acv.text = acv_str
            p_acv.font.size = Pt(15)
            p_acv.font.bold = True
            p_acv.font.color.rgb = COLOR_NAVY
            p_acv.space_before = Pt(2)

            p_cnt = tf.add_paragraph()
            p_cnt.text = count_str
            p_cnt.font.size = Pt(9.5)
            p_cnt.font.color.rgb = COLOR_GRAY
            p_cnt.space_before = Pt(1)

        # 3 Insight Sentences Box
        ins_top = 4.6
        ins_box = s2.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(ins_top), Inches(11.6), Inches(1.2))
        ins_box.fill.solid()
        ins_box.fill.fore_color.rgb = RGBColor(241, 245, 249)
        ins_box.line.color.rgb = RGBColor(203, 213, 225)

        ins_tx = s2.shapes.add_textbox(Inches(0.95), Inches(ins_top + 0.08), Inches(11.3), Inches(1.04))
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
            p.font.size = Pt(9)
            p.font.color.rgb = RGBColor(51, 65, 85)
            p.space_before = Pt(1)

        # Region Line Box
        reg_top = 6.0
        reg_box = s2.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(reg_top), Inches(11.6), Inches(0.95))
        reg_box.fill.solid()
        reg_box.fill.fore_color.rgb = RGBColor(240, 253, 250)
        reg_box.line.color.rgb = RGBColor(153, 246, 228)

        reg_tx = s2.shapes.add_textbox(Inches(0.95), Inches(reg_top + 0.08), Inches(11.3), Inches(0.8))
        reg_tf = reg_tx.text_frame
        reg_tf.word_wrap = True

        p_reg_lbl = reg_tf.paragraphs[0]
        p_reg_lbl.text = "REGIONAL FOOTPRINT"
        p_reg_lbl.font.size = Pt(9)
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
        p_reg_body.font.size = Pt(9.5)
        p_reg_body.font.color.rgb = RGBColor(15, 23, 42)
        p_reg_body.space_before = Pt(2)

        # -------------------------------------------------------------
        # Slide 3: Forecast & Approval Split + BU Split + Top Accounts
        # -------------------------------------------------------------
        s3 = prs.slides.add_slide(blank_slide_layout)
        cls._add_slide_header(
            s3,
            "Forecast, Approvals, Business Units & Top Accounts",
            f"{owner_name} — Pipeline breakdown across approval states, business units, and key client accounts",
        )

        fc_data = overview_data.get("forecast_categories") or {}
        cls._add_table(
            s3,
            left=0.8,
            top=1.8,
            width=5.6,
            height=2.3,
            headers=["Forecast Category", "Deals", "ACV"],
            rows=[
                [cat, str(fc_data.get(cat, {}).get("count", 0)), _format_currency(fc_data.get(cat, {}).get("acv", 0.0))]
                for cat in ["Closed", "Commit", "Best Case", "Pipeline", "Not yet proposed"]
            ],
        )

        st_data = overview_data.get("approval_statuses") or {}
        appr_breakdown = kpis.get("approved_2nd_breakdown")
        appr_label = f"Approved ({appr_breakdown})" if appr_breakdown else "Approved"
        cls._add_table(
            s3,
            left=6.8,
            top=1.8,
            width=5.6,
            height=2.3,
            headers=["Approval Status", "Deals", "ACV"],
            rows=[
                [appr_label, str(st_data.get("Approved", {}).get("count", 0)), _format_currency(st_data.get("Approved", {}).get("acv", 0.0))],
                ["Pending Approval", str(st_data.get("Pending Approval", {}).get("count", 0)), _format_currency(st_data.get("Pending Approval", {}).get("acv", 0.0))],
                ["Not submitted", str(st_data.get("Not submitted", {}).get("count", 0)), _format_currency(st_data.get("Not submitted", {}).get("acv", 0.0))],
            ],
        )

        charts = overview_data.get("charts") or {}
        bu_list = (charts.get("business_units") or [])[:5]
        bu_rows = [[b.get("bu") or b.get("business_unit") or "Unassigned", str(b.get("count", 0)), _format_currency(b.get("acv", 0.0))] for b in bu_list] or [["None", "0", "$0.00"]]
        cls._add_table(
            s3,
            left=0.8,
            top=4.5,
            width=5.6,
            height=2.4,
            headers=["Business Unit", "Deals", "ACV"],
            rows=bu_rows,
        )

        acc_list = (charts.get("top_accounts") or [])[:5]
        acc_rows = [[str(a.get("account_name", ""))[:24], str(a.get("count", 0)), _format_currency(a.get("acv", 0.0))] for a in acc_list] or [["None", "0", "$0.00"]]
        cls._add_table(
            s3,
            left=6.8,
            top=4.5,
            width=5.6,
            height=2.4,
            headers=["Top Accounts", "Deals", "ACV"],
            rows=acc_rows,
        )

        # -------------------------------------------------------------
        # Slide 4: Portfolio Action Center
        # -------------------------------------------------------------
        s4 = prs.slides.add_slide(blank_slide_layout)
        cls._add_slide_header(
            s4,
            "Portfolio Action Center",
            f"Opportunities requiring attention, awaiting sign-off, or flagged for renewal risk",
        )

        actions = overview_data.get("action_lists", {})
        urgent = actions.get("immediate_attention") or actions.get("delayed_deals") or []
        if not urgent:
            urgent = [d for d in deals if d.get("approval_status") != "Approved"][:8]

        urgent_rows = []
        for d in urgent[:8]:
            urgent_rows.append([
                str(d.get("opportunity_name", ""))[:28],
                str(d.get("account_name", ""))[:20],
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
            height=5.0,
            headers=["Opportunity Name", "Account", "Forecast", "Status", "ACV", "Close Date"],
            rows=urgent_rows or [["Nothing needs attention", "—", "—", "—", "$0.00", "—"]],
        )

        # -------------------------------------------------------------
        # Slide 5: What Changed (Conditional if changes exist)
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
                change_rows.append(["New Deal Added", str(nd.get("opportunity_name", ""))[:24], str(nd.get("account_name", ""))[:18], f"+{_format_currency(nd.get('acv'))}", nd.get("stage", "")])
            for ca in (what_changed.get("acv_changes") or [])[:4]:
                diff = ca.get("diff_acv", 0.0)
                diff_str = f"{'+' if diff > 0 else ''}{_format_currency(diff)}"
                change_rows.append(["ACV Change", str(ca.get("opportunity_name", ""))[:24], str(ca.get("account_name", ""))[:18], diff_str, f"{_format_currency(ca.get('old_acv'))} → {_format_currency(ca.get('new_acv'))}"])
            for st in (what_changed.get("stage_changes") or [])[:3]:
                change_rows.append(["Stage Change", str(st.get("opportunity_name", ""))[:24], str(st.get("account_name", ""))[:18], "—", f"{st.get('old_stage')} → {st.get('new_stage')}"])
            for cat in (what_changed.get("category_changes") or [])[:3]:
                change_rows.append(["Category Change", str(cat.get("opportunity_name", ""))[:24], str(cat.get("account_name", ""))[:18], "—", f"{cat.get('old_category')} → {cat.get('new_category')}"])
            for cw in (what_changed.get("closed_won") or [])[:3]:
                change_rows.append(["Closed Won", str(cw.get("opportunity_name", ""))[:24], str(cw.get("account_name", ""))[:18], _format_currency(cw.get("acv")), "Won"])
            for rm in (what_changed.get("removed_deals") or [])[:3]:
                change_rows.append(["Removed / Lost", str(rm.get("opportunity_name", ""))[:24], str(rm.get("account_name", ""))[:18], f"-{_format_currency(rm.get('acv'))}", rm.get("reason", "")])

            cls._add_table(
                s5,
                left=0.8,
                top=1.8,
                width=11.6,
                height=5.0,
                headers=["Change Type", "Opportunity Name", "Account", "ACV Impact", "Details"],
                rows=change_rows or [["No changes", "—", "—", "$0.00", "—"]],
            )

        out = io.BytesIO()
        prs.save(out)
        out.seek(0)
        return out

    @classmethod
    def _add_slide_header(cls, slide, title_text: str, subtitle_text: str):
        txBox = slide.shapes.add_textbox(Inches(0.8), Inches(0.5), Inches(11.6), Inches(1.0))
        tf = txBox.text_frame
        tf.word_wrap = True

        p1 = tf.paragraphs[0]
        p1.text = title_text
        p1.font.size = Pt(20)
        p1.font.bold = True
        p1.font.color.rgb = COLOR_NAVY

        p2 = tf.add_paragraph()
        p2.text = subtitle_text
        p2.font.size = Pt(10.5)
        p2.font.color.rgb = COLOR_GRAY
        p2.space_before = Pt(3)

    @classmethod
    def _add_table(cls, slide, left: float, top: float, width: float, height: float, headers: List[str], rows: List[List[str]]):
        rows_count = len(rows) + 1
        cols_count = len(headers)
        table_shape = slide.shapes.add_table(rows_count, cols_count, Inches(left), Inches(top), Inches(width), Inches(height))
        table = table_shape.table

        for c, h in enumerate(headers):
            cell = table.cell(0, c)
            cell.text = h
            cell.fill.solid()
            cell.fill.fore_color.rgb = COLOR_NAVY
            p = cell.text_frame.paragraphs[0]
            p.font.size = Pt(9.5)
            p.font.bold = True
            p.font.color.rgb = COLOR_WHITE
            if "ACV" in h:
                p.alignment = PP_ALIGN.RIGHT

        for r_idx, r_data in enumerate(rows):
            for c_idx, val in enumerate(r_data):
                cell = table.cell(r_idx + 1, c_idx)
                cell.text = str(val)
                cell.fill.solid()
                cell.fill.fore_color.rgb = COLOR_WHITE if r_idx % 2 == 0 else COLOR_LIGHT_BG
                p = cell.text_frame.paragraphs[0]
                p.font.size = Pt(9)
                p.font.color.rgb = COLOR_NAVY
                if "ACV" in headers[c_idx] or "Impact" in headers[c_idx]:
                    p.alignment = PP_ALIGN.RIGHT

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
        """Generates a professional multi-page PDF document matching the KAM Overview layout."""
        kpis = overview_data.get("kpis") or overview_data.get("total") or {}
        tot_count = kpis.get("total_count", len(deals))
        tot_acv = kpis.get("total_acv", sum(float(d.get("forecast_acv_amount") or 0.0) for d in deals))

        as_of_formatted = _format_date_with_year(as_of_date)
        compare_formatted = _format_date_with_year(compare_as_of_date or overview_data.get("compare_as_of"))
        period_display = "All periods" if period in ("all_open", "All open deals", "All periods") else period

        pdf_buf = io.BytesIO()
        with PdfPages(pdf_buf) as pdf:
            # -------------------------------------------------------------
            # Page 1: 8 Tiles + 3 Insight Sentences + Region Line
            # -------------------------------------------------------------
            fig, ax = plt.subplots(figsize=(11, 8.5))
            ax.axis("off")

            # Cover Bar
            ax.add_patch(plt.Rectangle((0.04, 0.88), 0.92, 0.10, transform=ax.transAxes, color="#12284C"))
            ax.text(0.06, 0.94, "MOBILEUM HORIZON RENEWALS — PORTFOLIO REPORT", transform=ax.transAxes, color="#00A3AD", fontsize=11, fontweight="bold")
            ax.text(0.06, 0.90, f"Owner: {owner_name} ({kam_name})   |   Period: {period_display}   |   Data date: {as_of_formatted}   |   Compare to: {compare_formatted}", transform=ax.transAxes, color="#CBD5E1", fontsize=8.5)

            # 8 Tiles (2 rows of 4)
            tile_specs = [
                ("Total Portfolio", str(tot_count), _format_currency(tot_acv), "#12284C"),
                ("Commit Coverage", f"{kpis.get('commit_coverage_count', 0)} deals", _format_currency(kpis.get('commit_coverage_acv', 0)), "#00A3AD"),
                ("Commit", f"{kpis.get('commit_count', 0)} deals", _format_currency(kpis.get('commit_acv', 0)), "#1B365D"),
                ("Closed", f"{kpis.get('closed_count', 0)} deals", _format_currency(kpis.get('closed_acv', 0)), "#10B981"),
                ("Best Case", f"{kpis.get('best_case_count', 0)} deals", _format_currency(kpis.get('best_case_acv', 0)), "#0284C7"),
                ("Pipeline", f"{kpis.get('pipeline_count', 0)} deals", _format_currency(kpis.get('pipeline_acv', 0)), "#64748B"),
                ("Delayed Renewals", f"{kpis.get('delayed_count', 0)} deals", _format_currency(kpis.get('delayed_acv', 0)), "#E11D48"),
                ("Approvals Needed", f"{kpis.get('pending_approval_count', 0) + kpis.get('not_submitted_count', 0)} deals", _format_currency(kpis.get('pending_approval_acv', 0) + kpis.get('not_submitted_acv', 0)), "#D97706"),
            ]

            for i, (title, cnt_txt, acv_txt, accent_color) in enumerate(tile_specs):
                row = i // 4
                col = i % 4
                x = 0.04 + col * 0.235
                y = 0.69 - row * 0.165
                w = 0.215
                h = 0.14

                box = plt.Rectangle((x, y), w, h, transform=ax.transAxes, color="#F8FAFC", ec="#E2E8F0", lw=1.2)
                ax.add_patch(box)
                ax.add_patch(plt.Rectangle((x, y + h - 0.012), w, 0.012, transform=ax.transAxes, color=accent_color))
                ax.text(x + 0.015, y + h - 0.038, title.upper(), transform=ax.transAxes, color="#64748B", fontsize=7.5, fontweight="bold")
                ax.text(x + 0.015, y + 0.052, acv_txt, transform=ax.transAxes, color="#0F172A", fontsize=12, fontweight="bold")
                ax.text(x + 0.015, y + 0.018, cnt_txt, transform=ax.transAxes, color="#64748B", fontsize=8)

            # Insights Box
            ins_box = plt.Rectangle((0.04, 0.25), 0.92, 0.22, transform=ax.transAxes, color="#F1F5F9", ec="#CBD5E1", lw=1)
            ax.add_patch(ins_box)
            ax.text(0.06, 0.43, "PORTFOLIO INSIGHTS", transform=ax.transAxes, color="#12284C", fontsize=9.5, fontweight="bold")

            cards = overview_data.get("insight_cards") or [
                f"Portfolio holds {tot_count} opportunities totaling {_format_currency(tot_acv)}.",
                f"Approved deals total {kpis.get('approved_count', 0)} worth {_format_currency(kpis.get('approved_acv', 0))}.",
                f"Awaiting approval: {kpis.get('pending_approval_count', 0)} deals worth {_format_currency(kpis.get('pending_approval_acv', 0))}.",
            ]
            for idx, text in enumerate(cards[:3]):
                ax.text(0.06, 0.38 - idx * 0.05, f"• {text}", transform=ax.transAxes, color="#334155", fontsize=8.5)

            # Region Line Box
            reg_box = plt.Rectangle((0.04, 0.08), 0.92, 0.14, transform=ax.transAxes, color="#F0FDF4", ec="#86EFAC", lw=1)
            ax.add_patch(reg_box)
            ax.text(0.06, 0.18, "REGIONAL FOOTPRINT", transform=ax.transAxes, color="#15803D", fontsize=9.5, fontweight="bold")

            region_line = overview_data.get("region_line") or {}
            if region_line.get("single_region") and region_line.get("summary_sentence"):
                reg_text = region_line.get("summary_sentence")
            else:
                regions_list = region_line.get("regions") or []
                chips_strs = [r.get("label", "") for r in regions_list if r.get("label")]
                reg_text = "   ·   ".join(chips_strs) if chips_strs else "No region breakdown available."

            ax.text(0.06, 0.12, reg_text, transform=ax.transAxes, color="#0F172A", fontsize=9)

            pdf.savefig(fig, bbox_inches="tight")
            plt.close(fig)

            # -------------------------------------------------------------
            # Page 2: Forecast, Approvals, BU & Top Accounts
            # -------------------------------------------------------------
            fig, ax = plt.subplots(figsize=(11, 8.5))
            ax.axis("off")

            ax.text(0.04, 0.94, f"Pipeline & Account Breakdown — {owner_name}", color="#12284C", fontsize=15, fontweight="bold")
            ax.text(0.04, 0.91, "Distribution across forecast categories, approval status, business units, and top accounts", color="#64748B", fontsize=9)

            # Forecast Category Table
            fc_data = overview_data.get("forecast_categories") or {}
            fc_table_data = [["Forecast Category", "Deals", "ACV"]]
            for cat in ["Closed", "Commit", "Best Case", "Pipeline", "Not yet proposed"]:
                fc_table_data.append([
                    cat,
                    str(fc_data.get(cat, {}).get("count", 0)),
                    _format_currency(fc_data.get(cat, {}).get("acv", 0.0)),
                ])

            t1 = ax.table(cellText=fc_table_data, colWidths=[0.24, 0.10, 0.16], loc="upper left", bbox=[0.04, 0.52, 0.44, 0.35])
            t1.auto_set_font_size(False)
            t1.set_fontsize(8)
            for (r, c), cell in t1.get_celld().items():
                if r == 0:
                    cell.set_facecolor("#12284C")
                    cell.get_text().set_color("white")
                    cell.get_text().set_fontweight("bold")
                elif r % 2 == 0:
                    cell.set_facecolor("#F8FAFC")

            # Approval Status Table
            st_data = overview_data.get("approval_statuses") or {}
            appr_breakdown = kpis.get("approved_2nd_breakdown")
            appr_label = f"Approved ({appr_breakdown})" if appr_breakdown else "Approved"
            st_table_data = [
                ["Approval Status", "Deals", "ACV"],
                [appr_label, str(st_data.get("Approved", {}).get("count", 0)), _format_currency(st_data.get("Approved", {}).get("acv", 0.0))],
                ["Pending Approval", str(st_data.get("Pending Approval", {}).get("count", 0)), _format_currency(st_data.get("Pending Approval", {}).get("acv", 0.0))],
                ["Not submitted", str(st_data.get("Not submitted", {}).get("count", 0)), _format_currency(st_data.get("Not submitted", {}).get("acv", 0.0))],
            ]

            t2 = ax.table(cellText=st_table_data, colWidths=[0.24, 0.10, 0.16], loc="upper left", bbox=[0.52, 0.58, 0.44, 0.29])
            t2.auto_set_font_size(False)
            t2.set_fontsize(8)
            for (r, c), cell in t2.get_celld().items():
                if r == 0:
                    cell.set_facecolor("#12284C")
                    cell.get_text().set_color("white")
                    cell.get_text().set_fontweight("bold")
                elif r % 2 == 0:
                    cell.set_facecolor("#F8FAFC")

            # Business Units Table
            charts = overview_data.get("charts") or {}
            bu_list = (charts.get("business_units") or [])[:5]
            bu_table_data = [["Business Unit", "Deals", "ACV"]]
            for b in bu_list:
                bu_table_data.append([b.get("bu") or b.get("business_unit") or "Unassigned", str(b.get("count", 0)), _format_currency(b.get("acv", 0.0))])
            if len(bu_table_data) == 1:
                bu_table_data.append(["None", "0", "$0.00"])

            t3 = ax.table(cellText=bu_table_data, colWidths=[0.24, 0.10, 0.16], loc="upper left", bbox=[0.04, 0.08, 0.44, 0.38])
            t3.auto_set_font_size(False)
            t3.set_fontsize(8)
            for (r, c), cell in t3.get_celld().items():
                if r == 0:
                    cell.set_facecolor("#1B365D")
                    cell.get_text().set_color("white")
                    cell.get_text().set_fontweight("bold")
                elif r % 2 == 0:
                    cell.set_facecolor("#F8FAFC")

            # Top Accounts Table
            acc_list = (charts.get("top_accounts") or [])[:5]
            acc_table_data = [["Top Account", "Deals", "ACV"]]
            for a in acc_list:
                acc_table_data.append([str(a.get("account_name", ""))[:20], str(a.get("count", 0)), _format_currency(a.get("acv", 0.0))])
            if len(acc_table_data) == 1:
                acc_table_data.append(["None", "0", "$0.00"])

            t4 = ax.table(cellText=acc_table_data, colWidths=[0.24, 0.10, 0.16], loc="upper left", bbox=[0.52, 0.08, 0.44, 0.38])
            t4.auto_set_font_size(False)
            t4.set_fontsize(8)
            for (r, c), cell in t4.get_celld().items():
                if r == 0:
                    cell.set_facecolor("#1B365D")
                    cell.get_text().set_color("white")
                    cell.get_text().set_fontweight("bold")
                elif r % 2 == 0:
                    cell.set_facecolor("#F8FAFC")

            pdf.savefig(fig, bbox_inches="tight")
            plt.close(fig)

            # -------------------------------------------------------------
            # Page 3: Portfolio Action Center
            # -------------------------------------------------------------
            fig, ax = plt.subplots(figsize=(11, 8.5))
            ax.axis("off")

            ax.text(0.04, 0.94, f"Portfolio Action Center — {owner_name}", color="#12284C", fontsize=15, fontweight="bold")
            ax.text(0.04, 0.91, "Priority items requiring attention, pending sign-offs, or flagged for risk", color="#64748B", fontsize=9)

            actions = overview_data.get("action_lists", {})
            urgent = actions.get("immediate_attention") or actions.get("delayed_deals") or []
            if not urgent:
                urgent = [d for d in deals if d.get("approval_status") != "Approved"][:14]

            urg_data = [["Opportunity Name", "Account", "Forecast", "Status", "ACV", "Close Date"]]
            for d in urgent[:14]:
                urg_data.append([
                    str(d.get("opportunity_name", ""))[:26],
                    str(d.get("account_name", ""))[:20],
                    str(d.get("forecast_category", "")),
                    str(d.get("approval_status", "")),
                    _format_currency(d.get("forecast_acv_amount")),
                    str(d.get("close_date", ""))[:10],
                ])

            if len(urg_data) == 1:
                urg_data.append(["Nothing needs attention", "—", "—", "—", "$0.00", "—"])

            t_action = ax.table(
                cellText=urg_data,
                colWidths=[0.30, 0.20, 0.12, 0.13, 0.13, 0.12],
                loc="upper left",
                bbox=[0.04, 0.08, 0.92, 0.80],
            )
            t_action.auto_set_font_size(False)
            t_action.set_fontsize(7.5)
            for (r, c), cell in t_action.get_celld().items():
                if r == 0:
                    cell.set_facecolor("#12284C")
                    cell.get_text().set_color("white")
                    cell.get_text().set_fontweight("bold")
                elif r % 2 == 0:
                    cell.set_facecolor("#F8FAFC")

            pdf.savefig(fig, bbox_inches="tight")
            plt.close(fig)

            # -------------------------------------------------------------
            # Page 4: What Changed (Conditional if changes exist)
            # -------------------------------------------------------------
            what_changed = overview_data.get("what_changed") or {}
            if what_changed.get("has_changes"):
                fig, ax = plt.subplots(figsize=(11, 8.5))
                ax.axis("off")

                ax.text(0.04, 0.94, f"What Changed Since {compare_formatted} — {owner_name}", color="#12284C", fontsize=15, fontweight="bold")
                ax.text(0.04, 0.91, "Summary of new deals, ACV modifications, stage changes, and portfolio movements", color="#64748B", fontsize=9)

                wc_data = [["Type", "Opportunity Name", "Account", "ACV Impact", "Details"]]
                for nd in (what_changed.get("new_deals") or [])[:5]:
                    wc_data.append(["New Deal", str(nd.get("opportunity_name", ""))[:24], str(nd.get("account_name", ""))[:18], f"+{_format_currency(nd.get('acv'))}", nd.get("stage", "")])
                for ca in (what_changed.get("acv_changes") or [])[:5]:
                    diff = ca.get("diff_acv", 0.0)
                    diff_str = f"{'+' if diff > 0 else ''}{_format_currency(diff)}"
                    wc_data.append(["ACV Change", str(ca.get("opportunity_name", ""))[:24], str(ca.get("account_name", ""))[:18], diff_str, f"{_format_currency(ca.get('old_acv'))} → {_format_currency(ca.get('new_acv'))}"])
                for st in (what_changed.get("stage_changes") or [])[:3]:
                    wc_data.append(["Stage Change", str(st.get("opportunity_name", ""))[:24], str(st.get("account_name", ""))[:18], "—", f"{st.get('old_stage')} → {st.get('new_stage')}"])
                for cat in (what_changed.get("category_changes") or [])[:3]:
                    wc_data.append(["Category Change", str(cat.get("opportunity_name", ""))[:24], str(cat.get("account_name", ""))[:18], "—", f"{cat.get('old_category')} → {cat.get('new_category')}"])
                for cw in (what_changed.get("closed_won") or [])[:3]:
                    wc_data.append(["Closed Won", str(cw.get("opportunity_name", ""))[:24], str(cw.get("account_name", ""))[:18], _format_currency(cw.get("acv")), "Won"])
                for rm in (what_changed.get("removed_deals") or [])[:3]:
                    wc_data.append(["Removed / Lost", str(rm.get("opportunity_name", ""))[:24], str(rm.get("account_name", ""))[:18], f"-{_format_currency(rm.get('acv'))}", rm.get("reason", "")])

                if len(wc_data) == 1:
                    wc_data.append(["No changes", "—", "—", "$0.00", "—"])

                t_wc = ax.table(
                    cellText=wc_data,
                    colWidths=[0.16, 0.28, 0.18, 0.16, 0.22],
                    loc="upper left",
                    bbox=[0.04, 0.08, 0.92, 0.80],
                )
                t_wc.auto_set_font_size(False)
                t_wc.set_fontsize(7.5)
                for (r, c), cell in t_wc.get_celld().items():
                    if r == 0:
                        cell.set_facecolor("#12284C")
                        cell.get_text().set_color("white")
                        cell.get_text().set_fontweight("bold")
                    elif r % 2 == 0:
                        cell.set_facecolor("#F8FAFC")

                pdf.savefig(fig, bbox_inches="tight")
                plt.close(fig)

        pdf_buf.seek(0)
        return pdf_buf
