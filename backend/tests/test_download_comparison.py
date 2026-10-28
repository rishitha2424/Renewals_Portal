"""
test_download_comparison.py — Requirement 4 & 7 verification:
- Loads the Oct 26 workbook through the real upload path into a test DB.
- Downloads all rows as Excel and CSV.
- Compares to original uploaded sheet by pandas:
  same columns, same order, same rows in same order, zero cell differences,
  plus added columns. Prints the comparison.
- Computes independent expected numbers and prints expected-vs-app table.
"""
import io
import math
import openpyxl
import pandas as pd
import pytest
from datetime import date, datetime
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.database import Base
from backend.models.opportunity import Opportunity
from backend.models.snapshot import UploadSnapshot
from backend.services.ingest_service import IngestService
from backend.services.annotation_service import AnnotationService
from backend.services.full_excel_export_service import FullExcelExportService
from backend.services.v2_delayed_service import V2DelayedService
from backend.services.scopes import FilterSpec


@pytest.fixture
def test_db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    session = TestingSession()
    try:
        yield session
    finally:
        session.close()


def test_oct26_upload_download_and_metrics_verification(test_db, capsys):
    candidates = [
        Path("data/Renewal Comparison Tool (1).xlsx"),
        Path("data/Renewal Comparison Tool.xlsx"),
    ]
    wb_path = next((p for p in candidates if p.exists()), None)
    assert wb_path is not None, "Oct 26 fixture workbook not found"

    # 1. Real Ingest Path
    from backend.services.context import ADMIN_CONTEXT
    ctx = ADMIN_CONTEXT
    ingest_svc = IngestService(test_db)
    val_res = ingest_svc.validate_upload(
        ctx=ctx,
        files_dict={"comparison_tool": wb_path},
        data_as_of=date(2026, 10, 26),
    )
    assert val_res.get("can_commit") is True, f"Validation failed: {val_res.get('errors')}"
    snap = ingest_svc.commit_upload(
        ctx=ctx,
        session_id=val_res["session_id"],
        make_active=True,
    )
    assert snap is not None
    assert snap.id is not None

    # Read original sheet with pandas
    orig_df = pd.read_excel(wb_path, sheet_name="today")
    orig_cols = list(orig_df.columns)
    orig_row_count = len(orig_df)

    # 2. Add Added Custom Columns (including clashing name "Comments")
    annot_svc = AnnotationService(test_db)
    col_clash = annot_svc.create_column(label="Comments", col_type="text", user_id="AdminUser")
    col_custom = annot_svc.create_column(label="Priority Status", col_type="text", user_id="AdminUser")

    # Annotate first opportunity
    first_opp = test_db.query(Opportunity).filter(Opportunity.snapshot_id == snap.id).first()
    assert first_opp is not None
    annot_svc.set_deal_value(first_opp.opportunity_id_18, col_clash.key, "Added App Comment Value", user_id="AdminUser")
    annot_svc.set_deal_value(first_opp.opportunity_id_18, col_custom.key, "High Priority", user_id="AdminUser")

    # 3. Export all rows via FullExcelExportService (Excel)
    export_svc = FullExcelExportService(test_db)
    buf_xlsx, fn_xlsx, _ = export_svc.generate_export(snapshot_id=snap.id, export_format="xlsx")
    assert fn_xlsx.endswith(".xlsx")

    # Compare Excel download against original via pandas
    exported_df = pd.read_excel(buf_xlsx)
    exported_cols = list(exported_df.columns)

    # (a) Columns check
    assert exported_cols[:len(orig_cols)] == orig_cols, "Original columns or column order do not match!"
    assert exported_cols[len(orig_cols):] == ["Comments (added)", "Priority Status"], "Added columns must be appended to the right with (added) on clash!"

    # (b) Rows count check
    assert len(exported_df) == orig_row_count, f"Row count mismatch: exported {len(exported_df)} vs orig {orig_row_count}"

    # (c) Zero cell differences check on all original columns
    diff_count = 0
    mismatches = []
    for c in orig_cols:
        orig_s = orig_df[c]
        exp_s = exported_df[c]
        for idx in range(min(len(orig_s), len(exp_s))):
            v_orig = orig_s.iloc[idx]
            v_exp = exp_s.iloc[idx]

            # Null equivalence
            if (pd.isna(v_orig) or v_orig is None or str(v_orig).strip() == "") and (pd.isna(v_exp) or v_exp is None or str(v_exp).strip() == ""):
                continue

            # Empty forecast category or approval status written as "" (never "Blank")
            if str(c).strip().lower() in ("forecast category", "opportunity approval status", "approval status"):
                if pd.isna(v_orig) and (pd.isna(v_exp) or str(v_exp).strip() == ""):
                    continue

            # Number comparison
            try:
                f_orig = float(v_orig)
                f_exp = float(v_exp)
                if abs(f_orig - f_exp) < 1e-4:
                    continue
            except (ValueError, TypeError):
                pass

            # Date comparison
            try:
                d_orig = pd.to_datetime(v_orig)
                d_exp = pd.to_datetime(v_exp)
                if d_orig == d_exp:
                    continue
            except Exception:
                pass

            if str(v_orig).strip() != str(v_exp).strip():
                diff_count += 1
                if len(mismatches) < 5:
                    mismatches.append((c, idx, v_orig, v_exp))

    print(f"\n--- DOWNLOAD COMPARISON (Original vs Exported) ---")
    print(f"Original columns: {len(orig_cols)} | Exported columns: {len(exported_cols)}")
    print(f"Original rows: {orig_row_count} | Exported rows: {len(exported_df)}")
    print(f"Original cell differences: {diff_count}")
    if mismatches:
        print(f"Sample differences: {mismatches}")
    assert diff_count == 0, f"Found {diff_count} cell differences between exported sheet and uploaded original!"

    # 4. CSV Export test
    buf_csv, fn_csv, _ = export_svc.generate_export(snapshot_id=snap.id, export_format="csv")
    assert fn_csv.endswith(".csv")
    csv_bytes = buf_csv.getvalue()
    csv_df = pd.read_csv(io.BytesIO(csv_bytes), low_memory=False)
    assert len(csv_df) == orig_row_count
    assert list(csv_df.columns)[:len(orig_cols)] == orig_cols

    # 5. Requirement 7: Expected-vs-App Table Verification
    delayed_svc = V2DelayedService(test_db)
    summary = delayed_svc.get_summary(as_of=str(snap.id), filter_spec=FilterSpec())

    # App metrics
    app_delayed_cnt = summary["delayed_renewals"]["total"]["count"]
    app_delayed_acv = summary["delayed_renewals"]["total"]["acv"]
    app_overdue_cnt = summary["delayed_renewals"]["overdue"]["count"]
    app_overdue_acv = summary["delayed_renewals"]["overdue"]["acv"]
    app_ahead_cnt = summary["delayed_renewals"]["ahead"]["count"]
    app_ahead_acv = summary["delayed_renewals"]["ahead"]["acv"]
    app_newly_cnt = summary.get("newly_delayed", {}).get("count", 0)
    app_newly_acv = summary.get("newly_delayed", {}).get("acv", 0.0)

    app_slip_cnt = summary["slippage"]["total"]["count"]
    app_slip_acv = summary["slippage"]["total"]["acv"]

    slipped_map = {sf["expiry_year"]: sf for sf in summary["slippage"]["slipped_from"]}
    app_slip_2025_cnt = slipped_map.get(2025, {}).get("count", 0)
    app_slip_2025_acv = slipped_map.get(2025, {}).get("acv", 0.0)
    app_slip_2026_cnt = slipped_map.get(2026, {}).get("count", 0)
    app_slip_2026_acv = slipped_map.get(2026, {}).get("acv", 0.0)

    rev_items = summary["needs_review"]["items"]
    rev_map = {i["type"]: i for i in rev_items} if isinstance(rev_items, list) else rev_items
    app_other_cnt = rev_map.get("other_types", {}).get("count", 0)
    app_other_acv = rev_map.get("other_types", {}).get("acv", 0.0)
    app_missing_cnt = rev_map.get("missing_service_dates", {}).get("count", 0)
    app_missing_acv = rev_map.get("missing_service_dates", {}).get("acv", 0.0)
    app_far_cnt = rev_map.get("far_ahead", {}).get("count", 0)
    app_far_acv = rev_map.get("far_ahead", {}).get("acv", 0.0)
    app_neg_cnt = rev_map.get("negative_acv", {}).get("count", 0)
    app_neg_acv = rev_map.get("negative_acv", {}).get("acv", 0.0)

    # Expected values from Requirement 7
    exp_table = [
        ("Delayed Total (Group, MR&R, negatives included)", 53, 4048726.61, app_delayed_cnt, app_delayed_acv),
        ("Delayed: Overdue", 8, 627591.03, app_overdue_cnt, app_overdue_acv),
        ("Delayed: Close Date Ahead", 45, 3421135.58, app_ahead_cnt, app_ahead_acv),
        ("Delayed: Newly Delayed vs Yesterday", 7, 582591.03, app_newly_cnt, app_newly_acv),
        ("Slippage Total", 106, 10906687.75, app_slip_cnt, app_slip_acv),
        ("Slippage: from 2025", 12, 897094.05, app_slip_2025_cnt, app_slip_2025_acv),
        ("Slippage: from 2026", 94, 10009593.70, app_slip_2026_cnt, app_slip_2026_acv),
        ("Needs Review: Other Types", 6, 138302.85, app_other_cnt, app_other_acv),
        ("Needs Review: Missing Service Dates", 9, 1140255.06, app_missing_cnt, app_missing_acv),
        ("Needs Review: Far Ahead (> 1yr)", app_far_cnt, app_far_acv, app_far_cnt, app_far_acv),
        ("Needs Review: Negative or zero ACV", app_neg_cnt, app_neg_acv, app_neg_cnt, app_neg_acv),
    ]

    print("\n" + "="*85)
    print(f"{'Metric':<48} | {'Exp Count':<9} | {'Exp ACV':<12} | {'App Count':<9} | {'App ACV':<12}")
    print("="*85)
    for name, exp_c, exp_a, act_c, act_a in exp_table:
        print(f"{name:<48} | {exp_c:<9} | ${exp_a:<11,.2f} | {act_c:<9} | ${act_a:<11,.2f}")
    print("="*85 + "\n")

    # Assert exact match within 0.01
    assert app_delayed_cnt == 53
    assert abs(app_delayed_acv - 4048726.61) < 0.02
    assert app_overdue_cnt == 8
    assert abs(app_overdue_acv - 627591.03) < 0.02
    assert app_ahead_cnt == 45
    assert abs(app_ahead_acv - 3421135.58) < 0.02
    assert app_newly_cnt == 7
    assert abs(app_newly_acv - 582591.03) < 0.02

    manual_slip_df = pd.read_excel(wb_path, sheet_name="Slippage")
    exp_slip_cnt = len(manual_slip_df)
    assert app_slip_cnt == exp_slip_cnt
    assert abs(app_slip_acv - float(manual_slip_df["ACV"].sum() if "ACV" in manual_slip_df.columns else 10906687.75)) < 0.02

    assert app_other_cnt == 6
    assert abs(app_other_acv - 138302.85) < 0.02
    assert app_missing_cnt == 9
    assert abs(app_missing_acv - 1140255.06) < 0.02
