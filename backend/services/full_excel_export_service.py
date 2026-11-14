"""
FullExcelExportService — streams a complete, high-performance export (Excel or CSV) for a snapshot.
Preserves:
- Exact 172 original columns in their exact upload order.
- Exact original row order (using _row_order).
- Native cell types (dates, numbers, strings).
- Appends added custom columns to the right with current values.
- Adds ' (added)' suffix only when an added column label clashes with an Excel header.
- Fix (a): empty Forecast Category / Approval Status written as empty string (never 'Blank').
- Fix (b): Reconciliation Entry '-' written without visible apostrophe; formula escaping only on real formula triggers.
- Fix (c): original row order matching uploaded workbook.
"""
from __future__ import annotations

import csv
import io
import logging
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional
import openpyxl
from openpyxl.cell import WriteOnlyCell
from openpyxl.styles import Font, PatternFill
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.models.opportunity import Opportunity
from backend.models.snapshot import UploadSnapshot
from backend.services.annotation_service import AnnotationService

log = logging.getLogger(__name__)

# Styling for Excel
NAVY_FILL = PatternFill(start_color="12284C", end_color="12284C", fill_type="solid")
WHITE_BOLD_FONT = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
CUSTOM_FILL = PatternFill(start_color="1F497D", end_color="1F497D", fill_type="solid")
GOLD_FONT = Font(name="Calibri", size=11, bold=True, color="FFD700")

FORMULA_TRIGGERS = ("=", "+", "-", "@")


def sanitize_formula_injection(val: Any) -> Any:
    """
    Protect against spreadsheet formula injection without visible characters.
    Treat a value as a formula ONLY when it really starts with =, +, -, @
    followed by formula-like content (e.g. letters, parentheses, symbols),
    NEVER a lone '-', '--', or a regular negative number like -123 or -123.45.
    """
    if isinstance(val, str) and val:
        val_clean = val.strip()
        if val_clean in ("-", "--", "---", "+", "@", "="):
            return val
        # Regular numeric values (including negative numbers)
        try:
            float(val_clean.replace(",", ""))
            return val
        except (ValueError, TypeError):
            pass
        if val_clean[0] in ("=", "+", "-", "@"):
            if len(val_clean) > 1 and (val_clean[1].isalnum() or val_clean[1] in ("(", "@", "$", "_")):
                return f"'{val}"
    return val


def pd_is_null(val: Any) -> bool:
    if val is None:
        return True
    try:
        import pandas as pd
        return pd.isna(val)
    except Exception:
        return False


class FullExcelExportService:
    def __init__(self, db: Session):
        self.db = db
        self.annot_svc = AnnotationService(db)

    def generate_export(
        self,
        snapshot_id: str | None = None,
        opp_ids: list[str] | None = None,
        export_format: str = "xlsx",
    ) -> tuple[io.BytesIO, str, str]:
        """
        Generate export for a snapshot in either 'xlsx' or 'csv' format.
        If opp_ids is provided, only those opportunities are exported;
        otherwise all opportunities of the snapshot are exported in original row order.
        """
        if snapshot_id:
            snap = self.db.query(UploadSnapshot).filter(UploadSnapshot.id == snapshot_id).first()
        else:
            snap = self.db.query(UploadSnapshot).order_by(UploadSnapshot.snapshot_date.desc()).first()

        if not snap:
            raise ValueError("No snapshot found for export.")

        # 1. Retrieve opportunities
        q = self.db.query(Opportunity).filter(Opportunity.snapshot_id == snap.id)
        if opp_ids is not None:
            clean_ids = [str(i).strip() for i in opp_ids if str(i).strip()]
            q = q.filter(Opportunity.opportunity_id_18.in_(clean_ids))
        else:
            from backend.services.settings_service import SettingsService
            if SettingsService.get_exclude_reconciliation_entry(self.db):
                q = q.filter(func.coalesce(Opportunity.is_reconciliation_entry, False) == False)

        opps = q.all()

        # Sort in exact original row order
        opps.sort(key=lambda o: (o.extra_attributes or {}).get("_row_order", 0))

        # 2. Determine original column order (all 172 columns)
        col_order: list[str] = []
        if snap.column_order and isinstance(snap.column_order, list) and len(snap.column_order) > 0:
            col_order = [str(c) for c in snap.column_order if str(c) != "_row_order"]
        elif opps and opps[0].extra_attributes:
            col_order = [k for k in opps[0].extra_attributes.keys() if k != "_row_order"]
        else:
            col_order = ["Opportunity ID 18 Digit", "Account Name", "Opportunity Name", "Forecast ACV Amount"]

        col_order_set = {c.strip().lower() for c in col_order}

        # 3. Retrieve added custom columns (excluding deleted)
        custom_cols = self.annot_svc.list_columns(include_deleted=False)

        # 4. Fetch annotations for all deals
        all_opp_ids = [o.opportunity_id_18 for o in opps if o.opportunity_id_18]
        deal_annots = self.annot_svc.enrich_deals_with_annotations(all_opp_ids)

        # Header definitions: original columns followed by added custom columns
        custom_header_labels: list[str] = []
        for cc in custom_cols:
            if cc.label.strip().lower() in col_order_set:
                custom_header_labels.append(f"{cc.label} (added)")
            else:
                custom_header_labels.append(cc.label)

        date_str = snap.snapshot_date.isoformat()
        is_csv = export_format.lower() == "csv"

        if is_csv:
            return self._build_csv(
                snap=snap,
                col_order=col_order,
                custom_cols=custom_cols,
                custom_headers=custom_header_labels,
                opps=opps,
                deal_annots=deal_annots,
            )
        else:
            return self._build_xlsx(
                snap=snap,
                col_order=col_order,
                custom_cols=custom_cols,
                custom_headers=custom_header_labels,
                opps=opps,
                deal_annots=deal_annots,
            )

    def _build_xlsx(
        self,
        snap: UploadSnapshot,
        col_order: list[str],
        custom_cols: list[Any],
        custom_headers: list[str],
        opps: list[Opportunity],
        deal_annots: dict[str, dict[str, Any]],
    ) -> tuple[io.BytesIO, str, str]:
        wb = openpyxl.Workbook(write_only=True)
        ws = wb.create_sheet(title="today")

        # Header Row
        header_row: list[WriteOnlyCell] = []
        for c_name in col_order:
            cell = WriteOnlyCell(ws, value=c_name)
            cell.fill = NAVY_FILL
            cell.font = WHITE_BOLD_FONT
            header_row.append(cell)

        for c_label in custom_headers:
            cell = WriteOnlyCell(ws, value=c_label)
            cell.fill = CUSTOM_FILL
            cell.font = GOLD_FONT
            header_row.append(cell)

        ws.append(header_row)

        # Data Rows
        for opp in opps:
            row_cells: list[Any] = []
            opp_id = opp.opportunity_id_18 or ""
            annots = deal_annots.get(opp_id, {})
            extra = opp.extra_attributes or {}

            # Original columns
            for c_name in col_order:
                val = extra.get(c_name)
                # Fix (a): empty Forecast Category and Approval Status cells written as empty ""
                if c_name in ("Forecast Category", "Opportunity Approval Status", "Approval Status"):
                    if val is None or str(val).strip().lower() in ("blank", "not yet proposed", "nan", "none", ""):
                        val = ""

                row_cells.append(self._format_cell_value(val))

            # Appended custom columns
            for cc in custom_cols:
                val = annots.get(cc.key, {}).get("value")
                row_cells.append(self._format_cell_value(val))

            ws.append(row_cells)

        output = io.BytesIO()
        wb.save(output)
        output.seek(0)

        filename = f"Renewals_Export_{snap.snapshot_date.isoformat()}.xlsx"
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        return output, filename, media_type

    def _build_csv(
        self,
        snap: UploadSnapshot,
        col_order: list[str],
        custom_cols: list[Any],
        custom_headers: list[str],
        opps: list[Opportunity],
        deal_annots: dict[str, dict[str, Any]],
    ) -> tuple[io.BytesIO, str, str]:
        string_buf = io.StringIO()
        writer = csv.writer(string_buf, quoting=csv.QUOTE_MINIMAL)

        # Headers
        all_headers = list(col_order) + list(custom_headers)
        writer.writerow(all_headers)

        # Data Rows
        for opp in opps:
            row_values: list[Any] = []
            opp_id = opp.opportunity_id_18 or ""
            annots = deal_annots.get(opp_id, {})
            extra = opp.extra_attributes or {}

            # Original columns
            for c_name in col_order:
                val = extra.get(c_name)
                if c_name in ("Forecast Category", "Opportunity Approval Status", "Approval Status"):
                    if val is None or str(val).strip().lower() in ("blank", "not yet proposed", "nan", "none", ""):
                        val = ""
                row_values.append(self._format_csv_value(val))

            # Custom columns
            for cc in custom_cols:
                val = annots.get(cc.key, {}).get("value")
                row_values.append(self._format_csv_value(val))

            writer.writerow(row_values)

        output = io.BytesIO(string_buf.getvalue().encode("utf-8-sig"))
        filename = f"Renewals_Export_{snap.snapshot_date.isoformat()}.csv"
        media_type = "text/csv"
        return output, filename, media_type

    def _format_cell_value(self, val: Any) -> Any:
        """Format cell value into native Excel type with formula injection protection."""
        if val is None or pd_is_null(val):
            return ""

        # Dates
        if isinstance(val, (date, datetime)):
            return val
        if isinstance(val, str):
            val_clean = val.strip()
            if not val_clean or val_clean.lower() in ("nan", "none"):
                return ""
            # Check for ISO date YYYY-MM-DD
            if len(val_clean) == 10 and val_clean[4] == "-" and val_clean[7] == "-":
                try:
                    return date.fromisoformat(val_clean)
                except ValueError:
                    pass

            # Neutralize formula injection
            sanitized = sanitize_formula_injection(val_clean)
            if sanitized != val_clean:
                return sanitized

            # Check numeric
            try:
                if "." in val_clean:
                    return float(val_clean.replace(",", ""))
                return int(val_clean.replace(",", ""))
            except (ValueError, TypeError):
                pass

            return val_clean

        if isinstance(val, (int, float, Decimal)):
            return float(val) if isinstance(val, Decimal) else val

        if isinstance(val, bool):
            return "TRUE" if val else "FALSE"

        return str(val)

    def _format_csv_value(self, val: Any) -> str:
        """Format cell value into CSV string with formula injection protection."""
        if val is None or pd_is_null(val):
            return ""
        if isinstance(val, (date, datetime)):
            return val.strftime("%Y-%m-%d")
        if isinstance(val, bool):
            return "TRUE" if val else "FALSE"
        if isinstance(val, (int, float, Decimal)):
            return str(val)

        val_str = str(val).strip()
        if val_str.lower() in ("nan", "none"):
            return ""
        return str(sanitize_formula_injection(val_str))

    def generate_full_excel(self, snapshot_id: str | None = None) -> tuple[io.BytesIO, str]:
        """Backward compatible wrapper for export_full_excel."""
        buf, filename, _ = self.generate_export(snapshot_id=snapshot_id, export_format="xlsx")
        return buf, filename
