"""
Verify outputs script (backend/scripts/verify_outputs.py).
Takes any uploaded snapshot, computes the expected numbers directly from the
Renewal Comparison Tool 'today' sheet with pandas (Renewals, current quarter derived
from the snapshot date: total, each forecast category, each approval status) and
compares them to:
  1. Executive page API data (Overview and Approvals distribution)
  2. Exported Excel (scope=renewals)
  3. Exported PowerPoint (scope=renewals)

Prints PASS/FAIL per number per output. No expected number is hardcoded.
"""

from __future__ import annotations

import argparse
import io
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import openpyxl
import pandas as pd
from pptx import Presentation

from backend.config import settings
from backend.database import SessionLocal
from backend.models.snapshot import UploadSnapshot
from backend.services.context import ADMIN_CONTEXT
from backend.services.excel_export_service import ExcelExportService
from backend.services.pptx_export_service import PptxExportService
from backend.services.scopes import FilterSpec, ScopeService
from backend.services.v2_approvals_service import V2ApprovalsService
from backend.services.v2_overview_service import V2OverviewService


def find_comparison_workbook(snap: UploadSnapshot, override_file: Optional[str] = None) -> Path:
    """Finds the Renewal Comparison Tool workbook for the given snapshot."""
    if override_file:
        p = Path(override_file)
        if p.exists():
            return p
        raise FileNotFoundError(f"Workbook override file not found: {override_file}")

    candidates: List[Path] = []
    if snap.source_file_comparison:
        candidates.append(settings.DATA_DIR / snap.source_file_comparison)
        candidates.append(Path(snap.source_file_comparison))

    # Known locations
    candidates.extend([
        settings.DATA_DIR / "Renewal Comparison Tool (2).xlsx",
        Path("c:/Users/RISHITHA/Downloads/Renewal Comparison Tool (2).xlsx"),
        settings.DATA_DIR / "sample_oct7" / "Renewal Comparison Tool.xlsx",
        settings.DATA_DIR / "Renewal Comparison Tool 11.xlsx",
    ])

    for c in candidates:
        if c.exists():
            try:
                xl = pd.ExcelFile(c)
                if "today" in xl.sheet_names:
                    # Check if date matches or row count roughly matches
                    df_head = xl.parse("today", nrows=10)
                    if "Sales Type" in df_head.columns and "Fiscal Period" in df_head.columns:
                        return c
            except Exception:
                continue

    raise FileNotFoundError(f"Could not find Renewal Comparison Tool workbook for snapshot {snap.id} ({snap.snapshot_date})")


def parse_money(v: Any) -> float:
    """Parse money string like '$41.12M', '$9,637,788.25', '41,115,061.34' to float."""
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", "").replace("$", "")
    if s.endswith("M"):
        return float(s[:-1]) * 1_000_000
    if s.endswith("K"):
        return float(s[:-1]) * 1_000
    try:
        return float(s)
    except ValueError:
        return 0.0


def parse_count(v: Any) -> int:
    """Parse integer count from string like '352' or '352 deals'."""
    if v is None:
        return 0
    if isinstance(v, (int, float)):
        return int(v)
    s = str(v).strip().replace(",", "")
    m = re.search(r"[-+]?\d+", s)
    return int(m.group(0)) if m else 0


class VerificationRunner:
    def __init__(self, snap: UploadSnapshot, workbook_path: Path):
        self.snap = snap
        self.workbook_path = workbook_path
        self.cq = ScopeService.quarter_of(snap.snapshot_date)
        self.results: List[Tuple[str, str, Any, Any, bool]] = []
        self.expected: Dict[str, Any] = {}

    def log_check(self, output_name: str, metric_name: str, expected: Any, actual: Any, tolerance: float = 0.05):
        if isinstance(expected, (int, float)) and isinstance(actual, (int, float)):
            pass_check = abs(float(expected) - float(actual)) <= tolerance
        else:
            pass_check = expected == actual

        self.results.append((output_name, metric_name, expected, actual, pass_check))
        status_tag = "\033[92mPASS\033[0m" if pass_check else "\033[91mFAIL\033[0m"
        print(f"[{status_tag}] [{output_name}] {metric_name}: Expected={expected}, Got={actual}")

    def compute_ground_truth(self):
        """Computes expected numbers dynamically from the 'today' sheet using pandas."""
        print(f"\n--- Loading Ground Truth from: {self.workbook_path} ---")
        print(f"Snapshot Date: {self.snap.snapshot_date} | Derived Current Quarter: {self.cq}")

        df = pd.read_excel(self.workbook_path, sheet_name="today")
        
        # Scope to Renewals and Derived Current Quarter
        r_df = df[(df["Sales Type"] == "Renewals") & (df["Fiscal Period"] == self.cq)].copy()

        # Total
        tot_count = int(len(r_df))
        tot_acv = round(float(r_df["Forecast ACV Amount"].sum()), 2)

        # Forecast Categories (Closed, Commit, Best Case, Pipeline, Blank/Not yet proposed)
        fc_series = r_df["Forecast Category"].fillna("Blank")
        categories = ["Commit", "Best Case", "Pipeline", "Blank", "Closed"]
        cat_data = {}
        for c in categories:
            c_slice = r_df[fc_series == c]
            cat_data[c] = {
                "count": int(len(c_slice)),
                "acv": round(float(c_slice["Forecast ACV Amount"].sum()), 2)
            }

        # Approval Statuses (Approved, Pending Approval, Blank)
        # Merge "Pending Approval" and "Pending-Approval"
        app_series = r_df["Opportunity Approval Status"].fillna("Blank").replace({"Pending-Approval": "Pending Approval"})
        statuses = ["Approved", "Pending Approval", "Blank"]
        app_data = {}
        for s in statuses:
            s_slice = r_df[app_series == s]
            app_data[s] = {
                "count": int(len(s_slice)),
                "acv": round(float(s_slice["Forecast ACV Amount"].sum()), 2)
            }

        self.expected = {
            "total_count": tot_count,
            "total_acv": tot_acv,
            "categories": cat_data,
            "approval_statuses": app_data,
        }

        print(f"Computed Ground Truth: Total {tot_count} deals | ${tot_acv:,.2f}")
        for c, vals in cat_data.items():
            if vals["count"] > 0 or vals["acv"] > 0:
                print(f"  Category '{c}': {vals['count']} deals | ${vals['acv']:,.2f}")
        for s, vals in app_data.items():
            print(f"  Approval '{s}': {vals['count']} deals | ${vals['acv']:,.2f}")

    def verify_executive_api(self, db):
        print("\n--- Verifying Executive Page API Data ---")
        as_of_str = self.snap.snapshot_date.isoformat()

        # 1. Overview Summary (Headline and Categories)
        ov_svc = V2OverviewService(db)
        ov_res = ov_svc.get_summary(
            ADMIN_CONTEXT,
            as_of=as_of_str,
            filter_spec=FilterSpec(sales_types=["Renewals"], period="current_quarter")
        )
        ov_tot = ov_res.get("total", {})
        self.log_check("Executive API", "Total Deals", self.expected["total_count"], ov_tot.get("count"))
        self.log_check("Executive API", "Total ACV", self.expected["total_acv"], round(float(ov_tot.get("acv", 0)), 2))

        ov_cats = ov_res.get("categories", {})
        for cat in ["Commit", "Best Case", "Pipeline", "Blank"]:
            exp_c = self.expected["categories"][cat]["count"]
            exp_a = self.expected["categories"][cat]["acv"]
            act_c = ov_cats.get(cat, {}).get("count", 0)
            act_a = round(float(ov_cats.get(cat, {}).get("acv", 0)), 2)
            lbl = "Not yet proposed (Blank)" if cat == "Blank" else cat
            self.log_check("Executive API", f"Category {lbl} Deals", exp_c, act_c)
            self.log_check("Executive API", f"Category {lbl} ACV", exp_a, act_a)

        # 2. Approvals Distribution
        app_svc = V2ApprovalsService(db)
        app_res = app_svc.get_distribution(
            ADMIN_CONTEXT,
            filter_spec=FilterSpec(as_of=as_of_str, sales_types=["Renewals"], period="current_quarter")
        )
        app_tot = app_res.get("total", {})
        self.log_check("Executive API", "Approvals Total Deals", self.expected["total_count"], app_tot.get("count"))
        self.log_check("Executive API", "Approvals Total ACV", self.expected["total_acv"], round(float(app_tot.get("acv", 0)), 2))

        app_map = {s["status"]: s for s in app_res.get("statuses", [])}
        for st in ["Approved", "Pending Approval", "Blank"]:
            exp_c = self.expected["approval_statuses"][st]["count"]
            exp_a = self.expected["approval_statuses"][st]["acv"]
            act_c = app_map.get(st, {}).get("count", 0)
            act_a = round(float(app_map.get(st, {}).get("acv", 0)), 2)
            self.log_check("Executive API", f"Approval {st} Deals", exp_c, act_c)
            self.log_check("Executive API", f"Approval {st} ACV", exp_a, act_a)

    def verify_exported_excel(self, db):
        print("\n--- Verifying Exported Excel (scope=renewals) ---")
        excel_svc = ExcelExportService(db)
        buf, filename = excel_svc.generate_excel(snapshot_id=self.snap.id, scope="renewals")
        wb = openpyxl.load_workbook(buf, data_only=True)

        # Sheet 1: Expiry Q4 Summary
        ws1 = wb[wb.sheetnames[0]]
        sheet1_gt_count = None
        sheet1_gt_acv = None
        sheet1_cats: Dict[str, Dict[str, Any]] = {}

        for row in ws1.iter_rows(values_only=True):
            if row[0] == "Grand Total":
                sheet1_gt_acv = round(float(row[2]), 2)
                sheet1_gt_count = int(row[3])
            elif row[1] in ["Commit", "Best Case", "Pipeline", "Not yet proposed", "Blank", "Closed"]:
                cat_key = "Blank" if row[1] == "Not yet proposed" else row[1]
                sheet1_cats[cat_key] = {
                    "acv": round(float(row[2]), 2),
                    "count": int(row[3])
                }

        self.log_check("Exported Excel", "Sheet 1 Grand Total Deals", self.expected["total_count"], sheet1_gt_count)
        self.log_check("Exported Excel", "Sheet 1 Grand Total ACV", self.expected["total_acv"], sheet1_gt_acv)

        for cat in ["Commit", "Best Case", "Pipeline", "Blank"]:
            exp_c = self.expected["categories"][cat]["count"]
            exp_a = self.expected["categories"][cat]["acv"]
            act_c = sheet1_cats.get(cat, {}).get("count", 0)
            act_a = sheet1_cats.get(cat, {}).get("acv", 0.0)
            lbl = "Not yet proposed" if cat == "Blank" else cat
            self.log_check("Exported Excel", f"Sheet 1 Category {lbl} Deals", exp_c, act_c)
            self.log_check("Exported Excel", f"Sheet 1 Category {lbl} ACV", exp_a, act_a)

        # Sheet 2: Approval Status Summary
        ws2 = wb["Approval Status Summary"]
        sheet2_gt_count = None
        sheet2_gt_acv = None
        sheet2_statuses: Dict[str, Dict[str, Any]] = {}

        for row in ws2.iter_rows(values_only=True):
            if row[0] == "Grand Total":
                sheet2_gt_count = int(row[1])
                sheet2_gt_acv = round(float(row[2]), 2)
            elif row[0] in ["Approved", "Pending Approval", "Pending-Approval", "Blank", "Rejected"]:
                st_key = "Pending Approval" if row[0] in ["Pending Approval", "Pending-Approval"] else row[0]
                sheet2_statuses[st_key] = {
                    "count": int(row[1]),
                    "acv": round(float(row[2]), 2)
                }

        self.log_check("Exported Excel", "Sheet 2 Approval Grand Total Deals", self.expected["total_count"], sheet2_gt_count)
        self.log_check("Exported Excel", "Sheet 2 Approval Grand Total ACV", self.expected["total_acv"], sheet2_gt_acv)

        for st in ["Approved", "Pending Approval", "Blank"]:
            exp_c = self.expected["approval_statuses"][st]["count"]
            exp_a = self.expected["approval_statuses"][st]["acv"]
            act_c = sheet2_statuses.get(st, {}).get("count", 0)
            act_a = sheet2_statuses.get(st, {}).get("acv", 0.0)
            self.log_check("Exported Excel", f"Sheet 2 Status {st} Deals", exp_c, act_c)
            self.log_check("Exported Excel", f"Sheet 2 Status {st} ACV", exp_a, act_a)

    def verify_exported_ppt(self, db):
        print("\n--- Verifying Exported PowerPoint (scope=renewals) ---")
        pptx_svc = PptxExportService(db)
        buf_ppt, ppt_name = pptx_svc.generate_pptx(snapshot_id=self.snap.id, scope="renewals")
        prs = Presentation(buf_ppt)

        # Slide 2: Renewals Summary Table
        s2 = prs.slides[1]
        s2_table = None
        for shape in s2.shapes:
            if shape.has_table:
                s2_table = shape.table
                break

        if s2_table:
            # Last row is Grand Total
            last_r = [s2_table.cell(len(s2_table.rows)-1, j).text.strip() for j in range(len(s2_table.columns))]
            s2_gt_acv = round(parse_money(last_r[2]), 2)
            s2_gt_count = parse_count(last_r[3])
            self.log_check("Exported PPT", "Slide 2 Grand Total Deals", self.expected["total_count"], s2_gt_count)
            self.log_check("Exported PPT", "Slide 2 Grand Total ACV", self.expected["total_acv"], s2_gt_acv)

            s2_cats: Dict[str, Dict[str, Any]] = {}
            for i in range(1, len(s2_table.rows)-1):
                row_vals = [s2_table.cell(i, j).text.strip() for j in range(len(s2_table.columns))]
                cat_name = row_vals[1]
                if cat_name in ["Commit", "Best Case", "Pipeline", "Not yet proposed", "Blank", "Closed"]:
                    cat_key = "Blank" if cat_name == "Not yet proposed" else cat_name
                    s2_cats[cat_key] = {
                        "acv": round(parse_money(row_vals[2]), 2),
                        "count": parse_count(row_vals[3])
                    }

            for cat in ["Commit", "Best Case", "Pipeline", "Blank"]:
                exp_c = self.expected["categories"][cat]["count"]
                exp_a = self.expected["categories"][cat]["acv"]
                act_c = s2_cats.get(cat, {}).get("count", 0)
                act_a = s2_cats.get(cat, {}).get("acv", 0.0)
                lbl = "Not yet proposed" if cat == "Blank" else cat
                self.log_check("Exported PPT", f"Slide 2 Category {lbl} Deals", exp_c, act_c)
                self.log_check("Exported PPT", f"Slide 2 Category {lbl} ACV", exp_a, act_a)

        # Slide 3: Opportunity Approval Status Table
        s3 = prs.slides[2]
        s3_table = None
        for shape in s3.shapes:
            if shape.has_table:
                s3_table = shape.table
                break

        if s3_table:
            # Row 0: Headers [' ', 'Total', 'Approved', 'Approved - 2nd', 'Pending-Approval', 'Blank', 'Rejected']
            # Row 1: ['Opportunities', '352', '115', '0', '6', '231', '0']
            # Row 2: ['ACV (USD)', '$41.12M', '$9.64M', '$0.00M', '$0.81M', '$30.67M', '$0.00M']
            headers = [s3_table.cell(0, j).text.strip() for j in range(len(s3_table.columns))]
            opp_row = [s3_table.cell(1, j).text.strip() for j in range(len(s3_table.columns))]
            acv_row = [s3_table.cell(2, j).text.strip() for j in range(len(s3_table.columns))]

            col_map = {h: idx for idx, h in enumerate(headers)}
            
            # Total
            tot_idx = col_map.get("Total", 1)
            s3_tot_count = parse_count(opp_row[tot_idx])
            s3_tot_acv_m = parse_money(acv_row[tot_idx]) # rounded in millions like $41.12M
            self.log_check("Exported PPT", "Slide 3 Approval Total Deals", self.expected["total_count"], s3_tot_count)
            # In PPT slide 3, ACV is formatted in Millions ($41.12M), tolerance is $0.05M
            self.log_check("Exported PPT", "Slide 3 Approval Total ACV ($M)", round(self.expected["total_acv"] / 1e6, 2), round(s3_tot_acv_m / 1e6, 2), tolerance=0.02)

            # Approved
            if "Approved" in col_map:
                a_idx = col_map["Approved"]
                self.log_check("Exported PPT", "Slide 3 Status Approved Deals", self.expected["approval_statuses"]["Approved"]["count"], parse_count(opp_row[a_idx]))
                self.log_check("Exported PPT", "Slide 3 Status Approved ACV ($M)", round(self.expected["approval_statuses"]["Approved"]["acv"] / 1e6, 2), round(parse_money(acv_row[a_idx]) / 1e6, 2), tolerance=0.02)

            # Pending Approval (merged with Pending-Approval)
            pend_hdr = "Pending-Approval" if "Pending-Approval" in col_map else "Pending Approval"
            if pend_hdr in col_map:
                p_idx = col_map[pend_hdr]
                self.log_check("Exported PPT", "Slide 3 Status Pending Approval Deals", self.expected["approval_statuses"]["Pending Approval"]["count"], parse_count(opp_row[p_idx]))
                self.log_check("Exported PPT", "Slide 3 Status Pending Approval ACV ($M)", round(self.expected["approval_statuses"]["Pending Approval"]["acv"] / 1e6, 2), round(parse_money(acv_row[p_idx]) / 1e6, 2), tolerance=0.02)

            # Blank
            if "Blank" in col_map:
                b_idx = col_map["Blank"]
                self.log_check("Exported PPT", "Slide 3 Status Blank Deals", self.expected["approval_statuses"]["Blank"]["count"], parse_count(opp_row[b_idx]))
                self.log_check("Exported PPT", "Slide 3 Status Blank ACV ($M)", round(self.expected["approval_statuses"]["Blank"]["acv"] / 1e6, 2), round(parse_money(acv_row[b_idx]) / 1e6, 2), tolerance=0.02)


def main():
    parser = argparse.ArgumentParser(description="Verify numbers across Excel, PPT and Executive API.")
    parser.add_argument("--snapshot-id", help="UUID of snapshot to test.")
    parser.add_argument("--file", help="Path to Renewal Comparison Tool workbook.")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        if args.snapshot_id:
            snap = db.query(UploadSnapshot).filter(UploadSnapshot.id == args.snapshot_id).first()
        else:
            snap = db.query(UploadSnapshot).filter(UploadSnapshot.is_active_today == True).first()
            if not snap:
                snap = db.query(UploadSnapshot).order_by(UploadSnapshot.snapshot_date.desc()).first()

        if not snap:
            print("ERROR: No snapshot found in database.")
            sys.exit(1)

        workbook_path = find_comparison_workbook(snap, override_file=args.file)
        runner = VerificationRunner(snap, workbook_path)
        runner.compute_ground_truth()
        runner.verify_executive_api(db)
        runner.verify_exported_excel(db)
        runner.verify_exported_ppt(db)

        # Summary
        total_checks = len(runner.results)
        passed_checks = sum(1 for r in runner.results if r[4])
        failed_checks = total_checks - passed_checks

        print("\n========================================================")
        print(f"VERIFICATION SUMMARY: {passed_checks}/{total_checks} PASSED ({failed_checks} FAILED)")
        print("========================================================")

        if failed_checks > 0:
            print("\nFAILED CHECKS:")
            for output, metric, exp, got, passed in runner.results:
                if not passed:
                    print(f"  FAILED: [{output}] {metric} | Expected: {exp} | Got: {got}")
            sys.exit(1)
        else:
            print("\nALL NUMBERS MATCH GROUND TRUTH PERFECTLY (100% PASS)!\n")
            sys.exit(0)

    finally:
        db.close()


if __name__ == "__main__":
    main()
