"""
FullExcelExportService — streams a complete, high-performance Excel workbook for a snapshot.
Appends custom columns to the right in sort order, merges in-place for source_header matches,
protects against formula injection, and writes real dates and numbers using openpyxl write-only mode.
"""
from __future__ import annotations

import io
import logging
from datetime import date, datetime
from decimal import Decimal
from typing import Any
import openpyxl
from openpyxl.cell import WriteOnlyCell
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from sqlalchemy.orm import Session

from backend.models.opportunity import Opportunity
from backend.models.snapshot import UploadSnapshot
from backend.services.annotation_service import AnnotationService
from backend.utils.excel_parser import parse_excel_date

log = logging.getLogger(__name__)

# Styling
NAVY_FILL = PatternFill(start_color="12284C", end_color="12284C", fill_type="solid")
WHITE_BOLD_FONT = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
CUSTOM_FILL = PatternFill(start_color="1F497D", end_color="1F497D", fill_type="solid")
GOLD_FONT = Font(name="Calibri", size=11, bold=True, color="FFD700")

FORMULA_TRIGGERS = ("=", "+", "-", "@")


def sanitize_formula_injection(val: Any) -> Any:
    """Neutralize spreadsheet formula injection by prefixing triggering characters with a single quote."""
    if isinstance(val, str) and val and val[0] in FORMULA_TRIGGERS:
        # Check if it's a plain negative number (e.g. -123 or -123.45)
        try:
            float(val.replace(",", ""))
            return val
        except ValueError:
            return f"'{val}"
    return val


class FullExcelExportService:
    def __init__(self, db: Session):
        self.db = db
        self.annot_svc = AnnotationService(db)

    def generate_full_excel(self, snapshot_id: str | None = None) -> tuple[io.BytesIO, str]:
        """Generate full Excel export with original columns and custom columns."""
        if snapshot_id:
            snap = self.db.query(UploadSnapshot).filter(UploadSnapshot.id == snapshot_id).first()
        else:
            snap = self.db.query(UploadSnapshot).order_by(UploadSnapshot.snapshot_date.desc()).first()

        if not snap:
            raise ValueError("No snapshot found for export.")

        # 1. Retrieve all opportunities for this snapshot in row order
        opps = (
            self.db.query(Opportunity)
            .filter(Opportunity.snapshot_id == snap.id)
            .order_by(Opportunity.id.asc())
            .all()
        )

        # 2. Determine original column order
        col_order: list[str] = []
        if snap.column_order and isinstance(snap.column_order, list):
            col_order = list(snap.column_order)
        elif opps and opps[0].extra_attributes:
            col_order = list(opps[0].extra_attributes.keys())
        else:
            col_order = ["Opportunity ID 18 Digit", "Account Name", "Opportunity Name", "Forecast ACV Amount"]

        # 3. Retrieve custom columns
        custom_cols = self.annot_svc.list_columns(include_deleted=False)

        # Map source_header to column_order index
        col_order_lower_map = {str(c).strip().lower(): idx for idx, c in enumerate(col_order)}
        in_place_cols: dict[int, Any] = {}  # index in col_order -> custom_column
        appended_custom_cols: list[Any] = []

        for cc in custom_cols:
            if cc.source_header:
                sh_low = cc.source_header.strip().lower()
                if sh_low in col_order_lower_map:
                    in_place_cols[col_order_lower_map[sh_low]] = cc
                    continue
            appended_custom_cols.append(cc)

        # 4. Fetch annotations for all deals
        opp_ids = [o.opportunity_id_18 for o in opps if o.opportunity_id_18]
        deal_annots = self.annot_svc.enrich_deals_with_annotations(opp_ids)

        # 5. Build Workbook in write-only mode for maximum performance & low memory
        wb = openpyxl.Workbook(write_only=True)
        ws = wb.create_sheet(title="today")

        # Header Row
        header_row: list[WriteOnlyCell] = []
        for c_idx, c_name in enumerate(col_order):
            cell = WriteOnlyCell(ws, value=c_name)
            cell.fill = NAVY_FILL
            cell.font = WHITE_BOLD_FONT
            header_row.append(cell)

        for cc in appended_custom_cols:
            cell = WriteOnlyCell(ws, value=cc.label)
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
            for c_idx, c_name in enumerate(col_order):
                if c_idx in in_place_cols:
                    cc_match = in_place_cols[c_idx]
                    val = annots.get(cc_match.key, {}).get("value")
                    if val is None:
                        val = extra.get(c_name)
                else:
                    val = extra.get(c_name)

                row_cells.append(self._format_cell_value(val))

            # Appended custom columns
            for cc in appended_custom_cols:
                val = annots.get(cc.key, {}).get("value")
                row_cells.append(self._format_cell_value(val))

            ws.append(row_cells)

        output = io.BytesIO()
        wb.save(output)
        output.seek(0)

        filename = f"Renewals_Full_Export_{snap.snapshot_date.isoformat()}.xlsx"
        return output, filename

    def _format_cell_value(self, val: Any) -> Any:
        """Format cell value into native Excel type with formula injection protection."""
        if val is None:
            return ""

        # Dates
        if isinstance(val, (date, datetime)):
            return val
        if isinstance(val, str):
            val_clean = val.strip()
            if not val_clean:
                return ""
            # Check for date YYYY-MM-DD
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
