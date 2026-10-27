"""
test_simplify_delayed_slippage.py
Comprehensive tests for:
1. Exact numbers for Delayed, Overdue, Ahead, Slippage, Slipped from years, Needs Review, and Newly delayed.
   Expected values are computed dynamically with pandas from the fixture workbook.
2. Year-shift invariance (+1y, +2y, +50y) with correct period format (e.g. Q4-2026).
3. Missing Group column fallback notice (never silent zero) covering both empty string and dropped Group column.
4. Drill-down deals queries.
"""
from datetime import date, timedelta
from pathlib import Path
from dateutil.relativedelta import relativedelta
import pytest
import pandas as pd
from backend.database import SessionLocal
from backend.models.snapshot import UploadSnapshot
from backend.services.v2_delayed_service import V2DelayedService, _opps_to_df
from backend.services.scopes import FilterSpec, ScopeService
from backend.utils.excel_parser import parse_excel_date


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def active_snap(db):
    snap = db.query(UploadSnapshot).filter(UploadSnapshot.is_active_today == True).first()
    if not snap:
        snap = db.query(UploadSnapshot).order_by(UploadSnapshot.snapshot_date.desc()).first()
    return snap


def _compute_pandas_fixture_ground_truth(snap_date: date):
    """
    Computes expected numbers dynamically using pandas from the snapshot workbook fixture.
    """
    candidates = [
        Path("data/Renewal Comparison Tool (1).xlsx"),
        Path("data/Renewal Comparison Tool.xlsx"),
        Path("data/sample_oct7/Renewal Comparison Tool.xlsx"),
    ]
    wb_path = next((p for p in candidates if p.exists()), None)
    assert wb_path is not None, "Fixture workbook not found"

    xf = pd.ExcelFile(wb_path)
    today_sheet = next((s for s in xf.sheet_names if s.lower() == "today"), xf.sheet_names[0])
    df_raw = xf.parse(today_sheet)
    cols = {str(c).lower().strip(): c for c in df_raw.columns}

    st_col = cols["sales type"]
    fc_col = cols["forecast category"]
    prob_col = cols.get("probability (%)") or cols.get("probability")
    stage_col = cols.get("stage number") or cols.get("stage")
    group_col = cols.get("group")
    type_col = cols.get("type")
    acv_col = cols["forecast acv amount"]
    close_col = cols["close date"]
    exp_col = cols["service expiry date"]
    start_col = cols.get("service start date")
    id_col = cols.get("opportunity id 18 digit") or cols.get("opportunity id")

    # 1. Open Renewals definition
    mask_open = (
        (df_raw[st_col].astype(str).str.strip().str.lower() == "renewals") &
        (df_raw[fc_col].astype(str).str.strip().str.lower() != "closed")
    )
    if prob_col:
        mask_open = mask_open & (pd.to_numeric(df_raw[prob_col], errors="coerce").fillna(0) < 100)
    if stage_col:
        stage_str = df_raw[stage_col].astype(str).str.lower()
        mask_open = mask_open & (~stage_str.str.contains("delete|lost|closed lost|won & closed|9. won", na=False))

    df_open = df_raw[mask_open].copy()

    # Dates
    c_dates = df_open[close_col].apply(parse_excel_date)
    raw_exp = df_open[exp_col].apply(parse_excel_date)
    raw_start = df_open[start_col].apply(parse_excel_date) if start_col else pd.Series(None, index=df_open.index)
    fallback_exp = raw_start.apply(lambda d: d - timedelta(days=1) if d else None)
    exp_dates = raw_exp.fillna(fallback_exp)

    df_open["_close_d"] = c_dates
    df_open["_exp_d"] = exp_dates
    df_open["_raw_exp"] = raw_exp
    df_open["_raw_start"] = raw_start

    # Types MR and R
    if type_col and type_col in df_open.columns:
        type_codes = df_open[type_col].astype(str).str.split("-").str[0].str.strip().str.upper()
    else:
        type_codes = pd.Series(["MR"] * len(df_open), index=df_open.index)
    df_open["_type_code"] = type_codes
    mr_r_mask = type_codes.isin(["MR", "R"])

    # Delayed Renewals (group contains delay, positive ACV, MR and R)
    if group_col and group_col in df_open.columns:
        delay_mask = df_open[group_col].astype(str).str.lower().str.contains("delay")
    else:
        delay_mask = df_open["_exp_d"].apply(lambda d: d < snap_date if d else False)

    df_delayed_cand = df_open[delay_mask & (df_open[acv_col] > 0)].copy()
    df_delayed = df_delayed_cand[df_delayed_cand["_type_code"].isin(["MR", "R"])].copy()
    df_overdue = df_delayed[df_delayed["_close_d"] < snap_date].copy()
    df_ahead = df_delayed[df_delayed["_close_d"] >= snap_date].copy()

    # Slippage (expiry <= snap year, close year == snap year + 1, MR/R, positive ACV)
    selected_year = snap_date.year
    next_year = selected_year + 1
    slip_mask = (
        df_open["_exp_d"].apply(lambda d: d.year <= selected_year if d else False) &
        df_open["_close_d"].apply(lambda d: d.year == next_year if d else False) &
        mr_r_mask &
        (df_open[acv_col] > 0)
    )
    df_slippage = df_open[slip_mask].copy()

    slipped_from = {}
    for ey in sorted(list(set(d.year for d in df_slippage["_exp_d"] if d))):
        sub = df_slippage[df_slippage["_exp_d"].apply(lambda d: d.year == ey if d else False)]
        slipped_from[ey] = {
            "count": len(sub),
            "acv": round(float(sub[acv_col].sum()), 2),
        }

    # Needs review: far ahead (close year >= selected_year + 2)
    far_ahead_mask = (
        df_open["_exp_d"].apply(lambda d: d.year <= selected_year if d else False) &
        df_open["_close_d"].apply(lambda d: d.year >= selected_year + 2 if d else False) &
        mr_r_mask &
        (df_open[acv_col] > 0)
    )
    df_far_ahead = df_open[far_ahead_mask].copy()

    # Missing service dates: open, included type (MR/R), both missing dates, ACV > 0
    missing_dates_mask = (
        raw_exp.isna() &
        raw_start.isna() &
        mr_r_mask &
        (df_open[acv_col] > 0)
    )
    df_missing_dates = df_open[missing_dates_mask].copy()

    # Other types (excluded from Delayed by Settings MR and R only)
    df_other_types = df_open[delay_mask & (df_open[acv_col] > 0) & (~mr_r_mask)].copy()

    return {
        "delayed_count": len(df_delayed),
        "delayed_acv": round(float(df_delayed[acv_col].sum()), 2),
        "overdue_count": len(df_overdue),
        "overdue_acv": round(float(df_overdue[acv_col].sum()), 2),
        "ahead_count": len(df_ahead),
        "ahead_acv": round(float(df_ahead[acv_col].sum()), 2),
        "slippage_count": len(df_slippage),
        "slippage_acv": round(float(df_slippage[acv_col].sum()), 2),
        "slipped_from": slipped_from,
        "missing_service_dates_count": len(df_missing_dates),
        "missing_service_dates_acv": round(float(df_missing_dates[acv_col].sum()), 2),
        "far_ahead_count": len(df_far_ahead),
        "far_ahead_acv": round(float(df_far_ahead[acv_col].sum()), 2),
        "other_types_count": len(df_other_types),
        "other_types_acv": round(float(df_other_types[acv_col].sum()), 2),
    }


def test_oct26_exact_numbers(db, active_snap):
    svc = V2DelayedService(db)
    fs = FilterSpec()
    summary = svc.get_summary(as_of=str(active_snap.id), filter_spec=fs)
    gt = _compute_pandas_fixture_ground_truth(active_snap.snapshot_date)

    # 1. Delayed Renewals (MR and R only)
    delayed_tot = summary["delayed_renewals"]["total"]
    assert delayed_tot["count"] == gt["delayed_count"]
    assert abs(delayed_tot["acv"] - gt["delayed_acv"]) < 0.02

    overdue = summary["delayed_renewals"]["overdue"]
    assert overdue["count"] == gt["overdue_count"]
    assert abs(overdue["acv"] - gt["overdue_acv"]) < 0.02

    ahead = summary["delayed_renewals"]["ahead"]
    assert ahead["count"] == gt["ahead_count"]
    assert abs(ahead["acv"] - gt["ahead_acv"]) < 0.02

    # 2. Slippage (Relative to selected year)
    slippage = summary["slippage"]
    exp_slip_cnt = sum(sf["count"] for sf in slippage["slipped_from"])
    assert slippage["total"]["count"] == exp_slip_cnt
    assert exp_slip_cnt == gt["slippage_count"]
    assert abs(slippage["total"]["acv"] - gt["slippage_acv"]) < 0.02

    slipped_from = {sf["expiry_year"]: sf for sf in slippage["slipped_from"]}
    for ey, exp_obj in gt["slipped_from"].items():
        assert slipped_from[ey]["count"] == exp_obj["count"]
        assert abs(slipped_from[ey]["acv"] - exp_obj["acv"]) < 0.02

    # 3. Needs Review items
    items = {item["type"]: item for item in summary["needs_review"]["items"]}
    assert "missing_service_dates" in items
    assert items["missing_service_dates"]["count"] == gt["missing_service_dates_count"]
    assert abs(items["missing_service_dates"]["acv"] - gt["missing_service_dates_acv"]) < 0.02

    assert "far_ahead" in items
    assert items["far_ahead"]["count"] == gt["far_ahead_count"]
    assert abs(items["far_ahead"]["acv"] - gt["far_ahead_acv"]) < 0.02

    assert "other_types" in items
    assert items["other_types"]["count"] == gt["other_types_count"]
    assert abs(items["other_types"]["acv"] - gt["other_types_acv"]) < 0.02

    # 4. Newly delayed ties to Overdue delta
    newly = summary["newly_delayed"]
    y_snap = svc.get_yesterday_baseline(active_snap)
    target_p_str = ScopeService.quarter_of(active_snap.snapshot_date)
    y_standing = svc._compute_snapshot_buckets(y_snap, target_p_str, filter_spec=fs, base_snap=None, no_baseline=True) if y_snap else None
    exp_newly_cnt = len(summary["overdue"]["count"] if isinstance(summary["overdue"], dict) else 0) if False else (
        gt["overdue_count"] - (len(y_standing["overdue"]) if y_standing else 0)
    )
    exp_newly_acv = round(gt["overdue_acv"] - (float(y_standing["overdue"]["forecast_acv_amount"].sum()) if y_standing else 0.0), 2)
    assert newly["count"] == exp_newly_cnt
    assert abs(newly["acv"] - exp_newly_acv) < 0.02


def test_deals_drill_endpoints(db, active_snap):
    svc = V2DelayedService(db)
    fs = FilterSpec()
    snap_id = str(active_snap.id)
    gt = _compute_pandas_fixture_ground_truth(active_snap.snapshot_date)

    # 1. Slipped from years
    for ey, exp_obj in gt["slipped_from"].items():
        d_ey = svc.get_deals(as_of=snap_id, kind="slipped_from_year", expiry_year=ey, filter_spec=fs)
        assert d_ey["count"] == exp_obj["count"]
        assert abs(d_ey["acv"] - exp_obj["acv"]) < 0.02

    # 2. Slippage total deals
    d_slip = svc.get_deals(as_of=snap_id, kind="slippage", filter_spec=fs)
    assert d_slip["count"] == gt["slippage_count"]
    assert abs(d_slip["acv"] - gt["slippage_acv"]) < 0.02

    # 3. Needs review missing_service_dates
    d_msd = svc.get_deals(as_of=snap_id, kind="needs_review", review_type="missing_service_dates", filter_spec=fs)
    assert d_msd["count"] == gt["missing_service_dates_count"]
    assert abs(d_msd["acv"] - gt["missing_service_dates_acv"]) < 0.02

    # 4. Needs review far_ahead
    d_far = svc.get_deals(as_of=snap_id, kind="needs_review", review_type="far_ahead", filter_spec=fs)
    assert d_far["count"] == gt["far_ahead_count"]
    assert abs(d_far["acv"] - gt["far_ahead_acv"]) < 0.02

    # 5. Needs review other_types
    d_oth = svc.get_deals(as_of=snap_id, kind="needs_review", review_type="other_types", filter_spec=fs)
    assert d_oth["count"] == gt["other_types_count"]
    assert abs(d_oth["acv"] - gt["other_types_acv"]) < 0.02

    # 6. Newly delayed
    d_new = svc.get_deals(as_of=snap_id, kind="newly_delayed", filter_spec=fs)
    y_snap = svc.get_yesterday_baseline(active_snap)
    target_p_str = ScopeService.quarter_of(active_snap.snapshot_date)
    y_standing = svc._compute_snapshot_buckets(y_snap, target_p_str, filter_spec=fs, base_snap=None, no_baseline=True) if y_snap else None
    exp_newly_cnt = gt["overdue_count"] - (len(y_standing["overdue"]) if y_standing else 0)
    exp_newly_acv = round(gt["overdue_acv"] - (float(y_standing["overdue"]["forecast_acv_amount"].sum()) if y_standing else 0.0), 2)
    assert d_new["count"] == exp_newly_cnt
    assert abs(d_new["acv"] - exp_newly_acv) < 0.02


def test_year_shift_invariance(db, active_snap):
    """
    Shifting all dates by +1y, +2y, or +50y must yield identical counts and ACV,
    with dynamically generated labels reflecting the shifted years.
    Uses the canonical period format (e.g. Q4-2026).
    """
    svc = V2DelayedService(db)
    df_raw = _opps_to_df(svc._get_opps(active_snap))
    base_quarter = ScopeService.quarter_of(active_snap.snapshot_date)
    base_buckets = svc._compute_snapshot_buckets(active_snap, base_quarter, preloaded_df=df_raw)

    base_delayed_cnt = len(base_buckets["delayed_total"])
    base_delayed_acv = float(base_buckets["delayed_total"]["forecast_acv_amount"].sum())
    base_overdue_cnt = len(base_buckets["overdue"])
    base_overdue_acv = float(base_buckets["overdue"]["forecast_acv_amount"].sum())
    base_ahead_cnt = len(base_buckets["ahead"])
    base_ahead_acv = float(base_buckets["ahead"]["forecast_acv_amount"].sum())
    base_slippage_cnt = len(base_buckets["slippage"])
    base_slippage_acv = float(base_buckets["slippage"]["forecast_acv_amount"].sum())
    base_far_close_cnt = len(base_buckets["review_far_close"])
    base_far_close_acv = float(base_buckets["review_far_close"]["forecast_acv_amount"].sum())
    base_exp_years = sorted(list(set(d.year for d in base_buckets["slippage"]["_service_expiry_date"] if d)))

    for shift_years in [1, 2, 50]:
        df_shifted = df_raw.copy()
        date_cols = ["_close_date", "_service_expiry_date", "_service_start_date"]
        for col in date_cols:
            df_shifted[col] = df_shifted[col].apply(
                lambda d: (d + relativedelta(years=shift_years)) if pd.notnull(d) else None
            )

        snap_date_shifted = active_snap.snapshot_date + relativedelta(years=shift_years)
        # Canonical quarter format: Q4-YYYY
        q_letter_and_num = ScopeService.quarter_of(active_snap.snapshot_date).split("-")[0]
        target_p_str = f"{q_letter_and_num}-{snap_date_shifted.year}"

        # Mock active snapshot with shifted snapshot_date
        class MockSnap:
            id = active_snap.id
            snapshot_date = snap_date_shifted

        mock_snap = MockSnap()
        buckets = svc._compute_snapshot_buckets(mock_snap, target_p_str, preloaded_df=df_shifted)

        # Delayed counts & ACV must match original dynamically
        assert len(buckets["delayed_total"]) == base_delayed_cnt
        assert abs(buckets["delayed_total"]["forecast_acv_amount"].sum() - base_delayed_acv) < 0.02

        assert len(buckets["overdue"]) == base_overdue_cnt
        assert abs(buckets["overdue"]["forecast_acv_amount"].sum() - base_overdue_acv) < 0.02

        assert len(buckets["ahead"]) == base_ahead_cnt
        assert abs(buckets["ahead"]["forecast_acv_amount"].sum() - base_ahead_acv) < 0.02

        # Slippage counts & ACV must match original dynamically
        assert len(buckets["slippage"]) == base_slippage_cnt
        assert abs(buckets["slippage"]["forecast_acv_amount"].sum() - base_slippage_acv) < 0.02

        # Needs review far close
        assert len(buckets["review_far_close"]) == base_far_close_cnt
        assert abs(buckets["review_far_close"]["forecast_acv_amount"].sum() - base_far_close_acv) < 0.02

        # Expiry years present in slippage must match shifted years
        exp_years = sorted(list(set(d.year for d in buckets["slippage"]["_service_expiry_date"] if d)))
        assert exp_years == [y + shift_years for y in base_exp_years]


def test_fallback_notice_when_group_missing(db, active_snap):
    """
    When Group column is missing (dropped or blank), the system must trigger fallback
    with an explicit notice and never return silent zero.
    Uses canonical period format.
    """
    svc = V2DelayedService(db)
    df_raw = _opps_to_df(svc._get_opps(active_snap))
    target_p_str = ScopeService.quarter_of(active_snap.snapshot_date)

    class MockSnap:
        id = active_snap.id
        snapshot_date = active_snap.snapshot_date

    # Case 1: Group column exists but is empty string
    df_blank_group = df_raw.copy()
    df_blank_group["group"] = ""
    buckets_blank = svc._compute_snapshot_buckets(MockSnap(), target_p_str, preloaded_df=df_blank_group)
    assert buckets_blank["fallback_used"] is True
    assert len(buckets_blank["delayed_total"]) > 0
    assert buckets_blank["delayed_total"]["forecast_acv_amount"].sum() > 0

    # Case 2: Group column is completely missing from DataFrame
    df_dropped_group = df_raw.copy().drop(columns=["group"])
    buckets_dropped = svc._compute_snapshot_buckets(MockSnap(), target_p_str, preloaded_df=df_dropped_group)
    assert buckets_dropped["fallback_used"] is True
    assert len(buckets_dropped["delayed_total"]) > 0
    assert buckets_dropped["delayed_total"]["forecast_acv_amount"].sum() > 0


def test_needs_review_excel_export_and_no_duplicates(db, active_snap):
    """
    Validates that:
    1. The Needs review Excel export sheet includes 'Missing service dates'
    2. Count and ACV match the pandas ground truth expectation
    3. Zero or negative ACV deals stay in 'Negative or zero ACV'
    4. No deal appears in two rows (strict deduplication)
    """
    import io
    import openpyxl
    from backend.services.excel_export_service import ExcelExportService

    gt = _compute_pandas_fixture_ground_truth(active_snap.snapshot_date)
    exporter = ExcelExportService(db)
    buf, filename = exporter.generate_excel(snapshot_id=active_snap.id, scope="renewals")

    wb = openpyxl.load_workbook(buf)
    assert "Needs review" in wb.sheetnames
    ws = wb["Needs review"]

    rows = list(ws.iter_rows(values_only=True))
    assert len(rows) > 1
    headers = [str(h).strip() for h in rows[0]]
    rev_idx = headers.index("Review Type")
    id_idx = headers.index("Opportunity ID 18 Digit")
    acv_idx = headers.index("Forecast ACV Amount")

    data_rows = rows[1:]
    # Check no duplicates across Needs review
    opp_ids = [r[id_idx] for r in data_rows if r[id_idx]]
    assert len(opp_ids) == len(set(opp_ids)), "A deal appeared in more than one Needs Review row"

    # Missing service dates row check
    msd_rows = [r for r in data_rows if r[rev_idx] == "Missing service dates"]
    assert len(msd_rows) == gt["missing_service_dates_count"]
    msd_acv = sum(float(r[acv_idx] or 0.0) for r in msd_rows)
    assert abs(msd_acv - gt["missing_service_dates_acv"]) < 0.02

    # Zero or negative ACV check: all negative_acv rows have ACV <= 0, others > 0
    for r in data_rows:
        acv = float(r[acv_idx] or 0.0)
        rev_type = r[rev_idx]
        if rev_type == "Negative or zero ACV":
            assert acv <= 0.0
        elif rev_type == "Missing service dates":
            assert acv > 0.0
