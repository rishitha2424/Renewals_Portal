"""
KAM Report Generation Service (Round 22).
Generates strictly-scoped, professionally styled 4-6 slide PowerPoint (.pptx)
and multi-page PDF (.pdf) reports for a Key Account Manager's portfolio.
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
    ) -> io.BytesIO:
        prs = Presentation()
        prs.slide_width = Inches(13.333)
        prs.slide_height = Inches(7.5)
        blank_slide_layout = prs.slide_layouts[6]

        kpis = overview_data.get("kpis") or overview_data.get("total") or {}
        tot_count = kpis.get("total_count", len(deals))
        tot_acv = kpis.get("total_acv", sum(float(d.get("forecast_acv_amount") or 0.0) for d in deals))

        # -------------------------------------------------------------
        # Slide 1: Cover Slide
        # -------------------------------------------------------------
        s1 = prs.slides.add_slide(blank_slide_layout)
        # Background card
        bg = s1.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Inches(13.333), Inches(7.5))
        bg.fill.solid()
        bg.fill.fore_color.rgb = COLOR_NAVY
        bg.line.color.rgb = COLOR_NAVY

        # Accent bar
        bar = s1.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(1.2), Inches(1.5), Inches(0.15), Inches(4.5))
        bar.fill.solid()
        bar.fill.fore_color.rgb = COLOR_BLUE
        bar.line.fill.background()

        # Title text
        txBox = s1.shapes.add_textbox(Inches(1.6), Inches(1.8), Inches(10.5), Inches(3.8))
        tf = txBox.text_frame
        tf.word_wrap = True

        p1 = tf.paragraphs[0]
        p1.text = "MOBILEUM HORIZON RENEWALS"
        p1.font.size = Pt(13)
        p1.font.bold = True
        p1.font.color.rgb = COLOR_BLUE

        p2 = tf.add_paragraph()
        p2.text = f"Renewal Portfolio Report"
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
        p4.text = f"Period: {period}  |  Snapshot As of: {as_of_date}  |  Generated: {datetime.now(timezone.utc).strftime('%b %d, %Y')}"
        p4.font.size = Pt(13)
        p4.font.color.rgb = RGBColor(148, 163, 184)
        p4.space_before = Pt(20)

        # -------------------------------------------------------------
        # Slide 2: Portfolio KPI Summary
        # -------------------------------------------------------------
        s2 = prs.slides.add_slide(blank_slide_layout)
        cls._add_slide_header(s2, "Portfolio Summary", f"{owner_name} — Key renewal health and execution metrics for {period}")

        # Add 6 KPI tiles
        tile_defs = [
            ("TOTAL PORTFOLIO", str(tot_count), _format_currency(tot_acv), COLOR_NAVY),
            ("COMMIT COVERAGE", f"{kpis.get('commit_coverage_count', 0)} deals", _format_currency(kpis.get('commit_coverage_acv', 0)), COLOR_BLUE),
            ("APPROVED", f"{kpis.get('approved_count', 0)} deals", _format_currency(kpis.get('approved_acv', 0)), COLOR_EMERALD),
            ("PENDING APPROVAL", f"{kpis.get('pending_approval_count', 0)} deals", _format_currency(kpis.get('pending_approval_acv', 0)), COLOR_AMBER),
            ("DELAYED RENEWALS", f"{kpis.get('delayed_count', 0)} deals", _format_currency(kpis.get('delayed_acv', 0)), COLOR_ROSE),
            ("SLIPPAGE", f"{kpis.get('slippage_count', 0)} deals", _format_currency(kpis.get('slippage_acv', 0)), COLOR_DARK_BLUE),
        ]

        left_base = 1.0
        top_base = 2.0
        width = 3.4
        height = 2.0
        for i, (label, count_str, acv_str, color) in enumerate(tile_defs):
            r = i // 3
            c = i % 3
            t_left = left_base + c * (width + 0.5)
            t_top = top_base + r * (height + 0.5)

            card = s2.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(t_left), Inches(t_top), Inches(width), Inches(height))
            card.fill.solid()
            card.fill.fore_color.rgb = COLOR_LIGHT_BG
            card.line.color.rgb = RGBColor(226, 232, 240)

            top_bar = s2.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(t_left), Inches(t_top), Inches(width), Inches(0.1))
            top_bar.fill.solid()
            top_bar.fill.fore_color.rgb = color
            top_bar.line.fill.background()

            tbox = s2.shapes.add_textbox(Inches(t_left + 0.2), Inches(t_top + 0.25), Inches(width - 0.4), Inches(height - 0.4))
            tf = tbox.text_frame
            tf.word_wrap = True

            p_lbl = tf.paragraphs[0]
            p_lbl.text = label
            p_lbl.font.size = Pt(10)
            p_lbl.font.bold = True
            p_lbl.font.color.rgb = COLOR_GRAY

            p_acv = tf.add_paragraph()
            p_acv.text = acv_str
            p_acv.font.size = Pt(22)
            p_acv.font.bold = True
            p_acv.font.color.rgb = COLOR_NAVY
            p_acv.space_before = Pt(4)

            p_cnt = tf.add_paragraph()
            p_cnt.text = count_str
            p_cnt.font.size = Pt(11)
            p_cnt.font.color.rgb = COLOR_GRAY
            p_cnt.space_before = Pt(2)

        # -------------------------------------------------------------
        # Slide 3: Forecast & Approval Split
        # -------------------------------------------------------------
        s3 = prs.slides.add_slide(blank_slide_layout)
        cls._add_slide_header(s3, "Forecast Category & Approval Status Breakdown", f"{owner_name} — Distribution across pipeline stages and approval workflow")

        # Forecast Category Table
        fc_data = overview_data.get("forecast_categories") or {}
        cls._add_table(
            s3,
            left=1.0,
            top=2.0,
            width=5.3,
            height=4.6,
            headers=["Forecast Category", "Deals", "ACV"],
            rows=[
                [cat, str(fc_data.get(cat, {}).get("count", 0)), _format_currency(fc_data.get(cat, {}).get("acv", 0.0))]
                for cat in ["Closed", "Commit", "Best Case", "Pipeline", "Not yet proposed"]
            ]
        )

        # Approval Status Table
        st_data = overview_data.get("approval_statuses") or {}
        cls._add_table(
            s3,
            left=7.0,
            top=2.0,
            width=5.3,
            height=4.6,
            headers=["Approval Status", "Deals", "ACV"],
            rows=[
                [status, str(st_data.get(status, {}).get("count", 0)), _format_currency(st_data.get(status, {}).get("acv", 0.0))]
                for status in ["Approved", "Pending Approval", "Not submitted"]
            ]
        )

        # -------------------------------------------------------------
        # Slide 4: Priority & Action Deals
        # -------------------------------------------------------------
        s4 = prs.slides.add_slide(blank_slide_layout)
        cls._add_slide_header(s4, "Priority & Action Items", f"Deals requiring immediate attention, awaiting approvals, or flagged for risk")

        actions = overview_data.get("action_lists", {})
        urgent = actions.get("immediate_attention") or []
        if not urgent:
            # Fallback to deals not approved
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
            left=1.0,
            top=2.0,
            width=11.333,
            height=4.8,
            headers=["Opportunity Name", "Account", "Forecast", "Status", "ACV", "Close Date"],
            rows=urgent_rows or [["No urgent items", "—", "—", "—", "$0.00", "—"]]
        )

        # -------------------------------------------------------------
        # Slide 5: Complete Opportunity Portfolio Table
        # -------------------------------------------------------------
        s5 = prs.slides.add_slide(blank_slide_layout)
        cls._add_slide_header(s5, "Opportunity Portfolio", f"All active renewal opportunities for {owner_name} ({len(deals)} deals / {_format_currency(tot_acv)})")

        deal_rows = []
        for d in sorted(deals, key=lambda x: float(x.get("forecast_acv_amount") or 0.0), reverse=True)[:10]:
            deal_rows.append([
                str(d.get("opportunity_id_18", ""))[:18],
                str(d.get("opportunity_name", ""))[:24],
                str(d.get("account_name", ""))[:18],
                str(d.get("stage_number") or d.get("stage") or "")[:18],
                str(d.get("approval_status", "")),
                _format_currency(d.get("forecast_acv_amount")),
                str(d.get("close_date", ""))[:10],
            ])

        cls._add_table(
            s5,
            left=1.0,
            top=2.0,
            width=11.333,
            height=4.8,
            headers=["Opportunity ID", "Opportunity Name", "Account", "Stage", "Status", "ACV", "Close Date"],
            rows=deal_rows or [["—", "No opportunities in current filter scope", "—", "—", "—", "$0.00", "—"]]
        )

        out = io.BytesIO()
        prs.save(out)
        out.seek(0)
        return out

    @classmethod
    def _add_slide_header(cls, slide, title_text: str, subtitle_text: str):
        txBox = slide.shapes.add_textbox(Inches(1.0), Inches(0.6), Inches(11.333), Inches(1.1))
        tf = txBox.text_frame
        tf.word_wrap = True

        p1 = tf.paragraphs[0]
        p1.text = title_text
        p1.font.size = Pt(22)
        p1.font.bold = True
        p1.font.color.rgb = COLOR_NAVY

        p2 = tf.add_paragraph()
        p2.text = subtitle_text
        p2.font.size = Pt(11)
        p2.font.color.rgb = COLOR_GRAY
        p2.space_before = Pt(3)

    @classmethod
    def _add_table(cls, slide, left: float, top: float, width: float, height: float, headers: List[str], rows: List[List[str]]):
        rows_count = len(rows) + 1
        cols_count = len(headers)
        table_shape = slide.shapes.add_table(rows_count, cols_count, Inches(left), Inches(top), Inches(width), Inches(height))
        table = table_shape.table

        # Format header row
        for c, h in enumerate(headers):
            cell = table.cell(0, c)
            cell.text = h
            cell.fill.solid()
            cell.fill.fore_color.rgb = COLOR_NAVY
            p = cell.text_frame.paragraphs[0]
            p.font.size = Pt(10)
            p.font.bold = True
            p.font.color.rgb = COLOR_WHITE
            if "ACV" in h:
                p.alignment = PP_ALIGN.RIGHT

        # Format data rows
        for r_idx, r_data in enumerate(rows):
            for c_idx, val in enumerate(r_data):
                cell = table.cell(r_idx + 1, c_idx)
                cell.text = str(val)
                cell.fill.solid()
                cell.fill.fore_color.rgb = COLOR_WHITE if r_idx % 2 == 0 else COLOR_LIGHT_BG
                p = cell.text_frame.paragraphs[0]
                p.font.size = Pt(9.5)
                p.font.color.rgb = COLOR_NAVY
                if headers[c_idx] == "ACV":
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
    ) -> io.BytesIO:
        """Generates a professional 4-page PDF document using Matplotlib vector backend."""
        kpis = overview_data.get("kpis") or overview_data.get("total") or {}
        tot_count = kpis.get("total_count", len(deals))
        tot_acv = kpis.get("total_acv", sum(float(d.get("forecast_acv_amount") or 0.0) for d in deals))

        pdf_buf = io.BytesIO()
        with PdfPages(pdf_buf) as pdf:
            # -------------------------------------------------------------
            # Page 1: Cover & Summary Dashboard
            # -------------------------------------------------------------
            fig, ax = plt.subplots(figsize=(11, 8.5))
            ax.axis("off")

            # Navy Header Banner
            rect = plt.Rectangle((0, 0.78), 1, 0.22, transform=ax.transAxes, color="#12284C")
            ax.add_patch(rect)
            ax.text(0.06, 0.92, "MOBILEUM HORIZON RENEWALS", transform=ax.transAxes, color="#00A3AD", fontsize=11, fontweight="bold")
            ax.text(0.06, 0.84, f"Renewal Portfolio Report — {owner_name}", transform=ax.transAxes, color="white", fontsize=20, fontweight="bold")
            ax.text(0.06, 0.80, f"KAM: {kam_name}  |  Period: {period}  |  Snapshot: {as_of_date}  |  Generated: {datetime.now(timezone.utc).strftime('%b %d, %Y')}", transform=ax.transAxes, color="#CBD5E1", fontsize=9.5)

            # 6 Metric Tiles
            tile_specs = [
                ("Total Portfolio", str(tot_count), _format_currency(tot_acv), "#12284C"),
                ("Commit Coverage", f"{kpis.get('commit_coverage_count', 0)} deals", _format_currency(kpis.get('commit_coverage_acv', 0)), "#00A3AD"),
                ("Approved", f"{kpis.get('approved_count', 0)} deals", _format_currency(kpis.get('approved_acv', 0)), "#10B981"),
                ("Pending Approval", f"{kpis.get('pending_approval_count', 0)} deals", _format_currency(kpis.get('pending_approval_acv', 0)), "#D97706"),
                ("Delayed Renewals", f"{kpis.get('delayed_count', 0)} deals", _format_currency(kpis.get('delayed_acv', 0)), "#E11D48"),
                ("Slippage", f"{kpis.get('slippage_count', 0)} deals", _format_currency(kpis.get('slippage_acv', 0)), "#1B365D"),
            ]

            for i, (title, cnt_txt, acv_txt, accent_color) in enumerate(tile_specs):
                row = i // 3
                col = i % 3
                x = 0.06 + col * 0.31
                y = 0.48 - row * 0.22
                w = 0.27
                h = 0.18

                # Card box
                box = plt.Rectangle((x, y), w, h, transform=ax.transAxes, color="#F8FAFC", ec="#E2E8F0", lw=1.2)
                ax.add_patch(box)
                # Accent bar
                ax.add_patch(plt.Rectangle((x, y + h - 0.015), w, 0.015, transform=ax.transAxes, color=accent_color))
                # Text
                ax.text(x + 0.02, y + h - 0.045, title.upper(), transform=ax.transAxes, color="#64748B", fontsize=8, fontweight="bold")
                ax.text(x + 0.02, y + 0.07, acv_txt, transform=ax.transAxes, color="#0F172A", fontsize=15, fontweight="bold")
                ax.text(x + 0.02, y + 0.025, cnt_txt, transform=ax.transAxes, color="#64748B", fontsize=8.5)

            # Executive Insights Card
            ins_box = plt.Rectangle((0.06, 0.06), 0.89, 0.18, transform=ax.transAxes, color="#F1F5F9", ec="#CBD5E1", lw=1)
            ax.add_patch(ins_box)
            ax.text(0.08, 0.20, "PORTFOLIO HEALTH & OBSERVATIONS", transform=ax.transAxes, color="#12284C", fontsize=9.5, fontweight="bold")

            cards = overview_data.get("insight_cards") or [
                f"Portfolio holds {tot_count} opportunities totaling {_format_currency(tot_acv)}.",
                f"Approved deals total {kpis.get('approved_count', 0)} worth {_format_currency(kpis.get('approved_acv', 0))}.",
                f"Awaiting approval: {kpis.get('pending_approval_count', 0)} deals worth {_format_currency(kpis.get('pending_approval_acv', 0))}.",
            ]
            for idx, text in enumerate(cards[:3]):
                ax.text(0.09, 0.16 - idx * 0.04, f"• {text}", transform=ax.transAxes, color="#334155", fontsize=8.5)

            pdf.savefig(fig, bbox_inches="tight")
            plt.close(fig)

            # -------------------------------------------------------------
            # Page 2: Forecast Category & Approval Status Tables
            # -------------------------------------------------------------
            fig, ax = plt.subplots(figsize=(11, 8.5))
            ax.axis("off")

            # Header
            ax.text(0.06, 0.93, f"Forecast & Approval Distribution — {owner_name}", color="#12284C", fontsize=16, fontweight="bold")
            ax.text(0.06, 0.90, f"Breakdown of {period} pipeline by commit level and management sign-off", color="#64748B", fontsize=9.5)

            # Forecast Category Table
            fc_data = overview_data.get("forecast_categories") or {}
            fc_table_data = [["Forecast Category", "Deals", "ACV"]]
            for cat in ["Closed", "Commit", "Best Case", "Pipeline", "Not yet proposed"]:
                fc_table_data.append([
                    cat,
                    str(fc_data.get(cat, {}).get("count", 0)),
                    _format_currency(fc_data.get(cat, {}).get("acv", 0.0))
                ])

            table1 = ax.table(
                cellText=fc_table_data,
                colWidths=[0.3, 0.15, 0.25],
                loc="upper left",
                bbox=[0.06, 0.52, 0.42, 0.32],
            )
            table1.auto_set_font_size(False)
            table1.set_fontsize(8.5)
            for (row, col), cell in table1.get_celld().items():
                if row == 0:
                    cell.set_facecolor("#12284C")
                    cell.get_text().set_color("white")
                    cell.get_text().set_fontweight("bold")
                elif row % 2 == 0:
                    cell.set_facecolor("#F8FAFC")

            # Approval Status Table
            st_data = overview_data.get("approval_statuses") or {}
            st_table_data = [["Approval Status", "Deals", "ACV"]]
            for status in ["Approved", "Pending Approval", "Not submitted"]:
                st_table_data.append([
                    status,
                    str(st_data.get(status, {}).get("count", 0)),
                    _format_currency(st_data.get(status, {}).get("acv", 0.0))
                ])

            table2 = ax.table(
                cellText=st_table_data,
                colWidths=[0.3, 0.15, 0.25],
                loc="upper left",
                bbox=[0.53, 0.60, 0.42, 0.24],
            )
            table2.auto_set_font_size(False)
            table2.set_fontsize(8.5)
            for (row, col), cell in table2.get_celld().items():
                if row == 0:
                    cell.set_facecolor("#12284C")
                    cell.get_text().set_color("white")
                    cell.get_text().set_fontweight("bold")
                elif row % 2 == 0:
                    cell.set_facecolor("#F8FAFC")

            # Immediate Attention Table
            ax.text(0.06, 0.44, "Immediate Attention Items", color="#12284C", fontsize=13, fontweight="bold")
            urgent = (overview_data.get("action_lists") or {}).get("immediate_attention") or []
            if not urgent:
                urgent = [d for d in deals if d.get("approval_status") != "Approved"][:6]

            urg_data = [["Opportunity Name", "Account", "Forecast", "Status", "ACV", "Close Date"]]
            for d in urgent[:6]:
                urg_data.append([
                    str(d.get("opportunity_name", ""))[:26],
                    str(d.get("account_name", ""))[:20],
                    str(d.get("forecast_category", "")),
                    str(d.get("approval_status", "")),
                    _format_currency(d.get("forecast_acv_amount")),
                    str(d.get("close_date", ""))[:10],
                ])

            if len(urg_data) == 1:
                urg_data.append(["All deals approved & in-flight", "—", "—", "—", "$0.00", "—"])

            table3 = ax.table(
                cellText=urg_data,
                colWidths=[0.30, 0.20, 0.12, 0.13, 0.13, 0.12],
                loc="upper left",
                bbox=[0.06, 0.08, 0.89, 0.32],
            )
            table3.auto_set_font_size(False)
            table3.set_fontsize(8)
            for (row, col), cell in table3.get_celld().items():
                if row == 0:
                    cell.set_facecolor("#1B365D")
                    cell.get_text().set_color("white")
                    cell.get_text().set_fontweight("bold")
                elif row % 2 == 0:
                    cell.set_facecolor("#F8FAFC")

            pdf.savefig(fig, bbox_inches="tight")
            plt.close(fig)

            # -------------------------------------------------------------
            # Page 3: Full Opportunity List (Ranked by ACV)
            # -------------------------------------------------------------
            fig, ax = plt.subplots(figsize=(11, 8.5))
            ax.axis("off")

            ax.text(0.06, 0.93, f"Opportunity Portfolio Details — {owner_name}", color="#12284C", fontsize=16, fontweight="bold")
            ax.text(0.06, 0.90, f"Top renewal deals ranked by Annual Contract Value (ACV)", color="#64748B", fontsize=9.5)

            opp_table_data = [["Opp ID", "Opportunity Name", "Account", "Stage", "Status", "ACV", "Close Date"]]
            sorted_deals = sorted(deals, key=lambda x: float(x.get("forecast_acv_amount") or 0.0), reverse=True)[:18]
            for d in sorted_deals:
                opp_table_data.append([
                    str(d.get("opportunity_id_18", ""))[:18],
                    str(d.get("opportunity_name", ""))[:24],
                    str(d.get("account_name", ""))[:18],
                    str(d.get("stage_number") or d.get("stage") or "")[:18],
                    str(d.get("approval_status", "")),
                    _format_currency(d.get("forecast_acv_amount")),
                    str(d.get("close_date", ""))[:10],
                ])

            if len(opp_table_data) == 1:
                opp_table_data.append(["—", "No opportunities in current filter scope", "—", "—", "—", "$0.00", "—"])

            table4 = ax.table(
                cellText=opp_table_data,
                colWidths=[0.16, 0.24, 0.18, 0.14, 0.12, 0.12, 0.10],
                loc="upper left",
                bbox=[0.04, 0.08, 0.92, 0.78],
            )
            table4.auto_set_font_size(False)
            table4.set_fontsize(7.5)
            for (row, col), cell in table4.get_celld().items():
                if row == 0:
                    cell.set_facecolor("#12284C")
                    cell.get_text().set_color("white")
                    cell.get_text().set_fontweight("bold")
                elif row % 2 == 0:
                    cell.set_facecolor("#F8FAFC")

            pdf.savefig(fig, bbox_inches="tight")
            plt.close(fig)

        pdf_buf.seek(0)
        return pdf_buf

