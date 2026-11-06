"""
Excel Fixture Shifter Utility.
Moves all dates and fiscal periods forward by specified quarters.
Supports dynamic rollover testing across fiscal quarter and year boundaries.
"""
from __future__ import annotations

import os
import re
import shutil
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

import openpyxl
import pandas as pd
from dateutil.relativedelta import relativedelta

from backend.services.scopes import ScopeService
from backend.utils.excel_parser import detect_file_slot, detect_suggested_snapshot_date


def shift_quarter_string(val: str, delta_quarters: int) -> str:
    """Shift Qx-YYYY forward by delta_quarters."""
    s = str(val).strip()
    m = re.match(r"^Q([1-4])-(\d{4})$", s, re.IGNORECASE)
    if not m:
        # Check FYxx or Qx FYxx pattern
        m_q_fy = re.match(r"^Q([1-4])\s+FY(\d{2})$", s, re.IGNORECASE)
        if m_q_fy:
            q, yy = int(m_q_fy.group(1)), int(m_q_fy.group(2))
            full_y = 2000 + yy
            tot = full_y * 4 + (q - 1) + delta_quarters
            new_y = tot // 4
            new_q = (tot % 4) + 1
            return f"Q{new_q} FY{str(new_y)[-2:]}"
        return s

    q, y = int(m.group(1)), int(m.group(2))
    tot = y * 4 + (q - 1) + delta_quarters
    new_y = tot // 4
    new_q = (tot % 4) + 1
    return f"Q{new_q}-{new_y}"


def shift_excel_workbook(
    src_path: Path,
    dest_path: Path,
    delta_quarters: int,
) -> None:
    """
    Load workbook, shift all date, period, and fiscal year cells by delta_quarters, and save.
    """
    delta_months = delta_quarters * 3
    wb = openpyxl.load_workbook(src_path)

    for sname in wb.sheetnames:
        ws = wb[sname]
        if ws.max_row < 1:
            continue

        headers = [cell.value for cell in ws[1]]
        date_col_indices = [
            idx + 1 for idx, h in enumerate(headers)
            if h and any(k in str(h).lower() for k in ["date"])
        ]
        fp_col_indices = [
            idx + 1 for idx, h in enumerate(headers)
            if h and any(k in str(h).lower() for k in ["period", "quarter"])
        ]
        year_col_indices = [
            idx + 1 for idx, h in enumerate(headers)
            if h and any(k in str(h).lower() for k in ["closing year", "fiscal year"])
        ]

        for row in ws.iter_rows(min_row=2):
            # Shift dates
            for cidx in date_col_indices:
                cell = row[cidx - 1]
                v = cell.value
                if isinstance(v, (datetime, date)):
                    cell.value = v + relativedelta(months=delta_months)
                elif isinstance(v, str) and len(v) >= 8:
                    try:
                        parsed_dt = pd.to_datetime(v)
                        if pd.notna(parsed_dt):
                            cell.value = (parsed_dt + relativedelta(months=delta_months)).strftime("%Y-%m-%d")
                    except Exception:
                        pass

            # Shift fiscal periods
            for cidx in fp_col_indices:
                cell = row[cidx - 1]
                v = cell.value
                if v and isinstance(v, str):
                    cell.value = shift_quarter_string(v, delta_quarters)

            # Shift closing year
            for cidx in year_col_indices:
                cell = row[cidx - 1]
                v = cell.value
                if v is not None:
                    try:
                        y_int = int(float(str(v).strip()))
                        # Shift year based on quarter shift
                        # e.g. 4 quarters = 1 year, 1-2 quarters crossing boundary
                        y_shift = delta_quarters // 4
                        if delta_quarters % 4 != 0:
                            # If Q4 shifted +1Q -> next year
                            y_shift = max(1, (delta_quarters + 2) // 4)
                        cell.value = str(y_int + y_shift)
                    except Exception:
                        pass

    dest_path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(dest_path)


def create_shifted_fixture_set(
    src_dir: Path,
    dest_dir: Path,
    delta_quarters: int,
    base_date: Optional[date] = None,
) -> tuple[date, date, dict[str, Path]]:
    """
    Create shifted fixture files moved forward by delta_quarters.
    Returns (shifted_as_of, shifted_yesterday, dict of slot -> shifted file path).
    """
    src_files = sorted(src_dir.glob("*.xlsx"))
    if not src_files:
        raise ValueError(f"No Excel files found in {src_dir}")

    # Determine base date
    if not base_date:
        for f in src_files:
            sd = detect_suggested_snapshot_date(f)
            if sd:
                base_date = sd
                break
    if not base_date:
        base_date = ScopeService.quarter_bounds(ScopeService.current_quarter())[0]

    delta_months = delta_quarters * 3
    shifted_as_of = (pd.Timestamp(base_date) + pd.DateOffset(months=delta_months)).date()
    shifted_yesterday = shifted_as_of - timedelta(days=1)

    dest_dir.mkdir(parents=True, exist_ok=True)
    shifted_files: dict[str, Path] = {}

    for src_file in src_files:
        dest_file = dest_dir / src_file.name
        shift_excel_workbook(src_file, dest_file, delta_quarters)
        slot, _ = detect_file_slot(dest_file)
        slot_key = slot if slot != "unknown" else src_file.stem
        shifted_files[slot_key] = dest_file

    return shifted_as_of, shifted_yesterday, shifted_files
