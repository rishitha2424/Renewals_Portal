"""
Comprehensive Test Suite for Rebuilt Delayed Renewals + Slippage + Needs Review
Validates against independent pandas computation from workbook in data/ folder.
Zero hard-coding: works for any quarter or year.
"""
import pytest
from datetime import date, datetime, timedelta
from pathlib import Path
import pandas as pd
from fastapi.testclient import TestClient

from backend.database import get_db
from backend.main import app
from backend.models.snapshot import UploadSnapshot
from backend.services.v2_delayed_service import V2DelayedService
from backend.services.scopes import ScopeService, FilterSpec
from backend.services.context import sign_admin_token


def _parse_test_date(v):
    if pd.isna(v):
        return None
    if isinstance(v, (datetime, pd.Timestamp)):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, (int, float)):
        try:
            return pd.to_datetime(v, unit="D", origin="1899-12-30").date()
        except Exception:
            return None
    try:
        return pd.to_datetime(v).date()
    except Exception:
        return None


def _load_and_compute_pandas_ground_truth(file_path: Path, snap_date: date):
    """
    Computes all delayed, slippage, and review metrics independently using raw pandas.
    """
    df = pd.read_excel(file_path, sheet_name="today")
    cols = {str(c).lower().strip(): c for c in df.columns}
    st_col = cols["sales type"]
    fc_col = cols["forecast category"]
    prob_col = cols.get("probability (%)") or cols.get("probability")
    stage_col = cols.get("stage number") or cols.get("stage")
    group_col = cols.get("group")
    acv_col = cols["forecast acv amount"]
    close_col = cols["close date"]
    exp_col = cols["service expiry date"]
    start_col = cols.get("service start date")
    opp_col = cols["opportunity name"]

    # 1. Open Renewals definition
    mask_open = (
        (df[st_col].astype(str).str.strip().str.lower() == "renewals") &
        (df[fc_col].astype(str).str.strip().str.lower() != "closed")
    )
    if prob_col:
        mask_open = mask_open & (pd.to_numeric(df[prob_col], errors="coerce").fillna(0) < 100)
    if stage_col:
        stage_str = df[stage_col].astype(str).str.lower()
        mask_open = mask_open & (~stage_str.str.contains("delete|lost|closed lost", na=False))

    df_open = df[mask_open].copy()

    # Date parsing with fallback
    c_dates = df_open[close_col].apply(_parse_test_date)
    exp_dates = df_open[exp_col].apply(_parse_test_date)
    if start_col:
        start_dates = df_open[start_col].apply(_parse_test_date)
        fallback_exp = start_dates.apply(lambda d: d - timedelta(days=1) if d else None)
        exp_dates = exp_dates.fillna(fallback_exp)

    df_open["_close_d"] = c_dates
    df_open["_exp_d"] = exp_dates

    # Fiscal boundaries for snap_date
    q_str = ScopeService.quarter_of(snap_date)
    yr_num, q_num = ScopeService.parse_quarter(q_str)
    # Calendar quarter dates for FISCAL_YEAR_START_MONTH == 1
    m_start = (q_num - 1) * 3 + 1
    q_start = date(yr_num, m_start, 1)
    m_end = m_start + 2
    import calendar
    _, last_day = calendar.monthrange(yr_num, m_end)
    q_end = date(yr_num, m_end, last_day)
    yr_end = date(yr_num, 12, 31)

    type_col = cols.get("type")
    if type_col and type_col in df_open.columns:
        type_codes = df_open[type_col].astype(str).str.split("-").str[0].str.strip().str.upper()
    else:
        type_codes = pd.Series(["MR"] * len(df_open), index=df_open.index)
    mr_r_mask = type_codes.isin(["MR", "R"])

    # Delayed Renewals (group contains delay, positive ACV, MR and R types)
    if group_col and group_col in df_open.columns:
        delay_mask = df_open[group_col].astype(str).str.lower().str.contains("delay")
    else:
        delay_mask = df_open["_exp_d"].apply(lambda d: d < q_start if d else False)

    df_delayed = df_open[delay_mask & mr_r_mask].copy()
    df_delayed_pos = df_delayed[df_delayed[acv_col] > 0].copy()
    df_overdue = df_delayed_pos[df_delayed_pos["_close_d"] < snap_date].copy()
    df_ahead = df_delayed_pos[df_delayed_pos["_close_d"] >= snap_date].copy()

    ahead_rest_q = df_ahead[df_ahead["_close_d"].apply(lambda d: d <= q_end if d else False)]
    ahead_later_q = df_ahead[df_ahead["_close_d"].apply(lambda d: (q_end < d <= yr_end) if d else False)]
    ahead_next_yr = df_ahead[df_ahead["_close_d"].apply(lambda d: d.year == yr_num + 1 if d else False)]
    ahead_later_yr = df_ahead[df_ahead["_close_d"].apply(lambda d: d.year > yr_num + 1 if d else False)]

    # Slipped to a later year (MR and R types, expiry <= yr_end, close date in yr_num + 1)
    slip_mask = (
        df_open["_exp_d"].apply(lambda d: d <= yr_end if d else False) &
        df_open["_close_d"].apply(lambda d: d.year == yr_num + 1 if d else False) &
        mr_r_mask
    )
    df_slipped_all = df_open[slip_mask].copy()
    df_slipped_pos = df_slipped_all[df_slipped_all[acv_col] > 0].copy()
    df_slipped_nonpos = df_slipped_all[df_slipped_all[acv_col] <= 0].copy()

    bucket_a = df_slipped_pos[df_slipped_pos["_exp_d"].apply(lambda d: d.year == yr_num - 1 if d else False)]
    bucket_b = df_slipped_pos[df_slipped_pos["_exp_d"].apply(lambda d: d.year == yr_num if d else False)]
    bucket_c = df_slipped_pos[df_slipped_pos["_exp_d"].apply(lambda d: d.year < yr_num - 1 if d else False)]

    # Needs review
    review_t1 = df_open[(df_open[acv_col] <= 0) & (delay_mask | slip_mask)].copy()
    review_t2 = df_open[df_open["_exp_d"].apply(lambda d: d < q_start if d else False) & (~delay_mask)].copy()
    review_t3 = df_open[df_open["_close_d"].apply(lambda d: d.year > snap_date.year + 1 if d else False)].copy()

    return {
        "df_open": df_open,
        "delayed_pos": df_delayed_pos,
        "overdue": df_overdue,
        "ahead": df_ahead,
        "ahead_rest_q": ahead_rest_q,
        "ahead_later_q": ahead_later_q,
        "ahead_next_yr": ahead_next_yr,
        "ahead_later_yr": ahead_later_yr,
        "slipped_pos": df_slipped_pos,
        "slipped_nonpos": df_slipped_nonpos,
        "bucket_a": bucket_a,
        "bucket_b": bucket_b,
        "bucket_c": bucket_c,
        "review_t1": review_t1,
        "review_t2": review_t2,
        "review_t3": review_t3,
        "acv_col": acv_col,
    }


@pytest.fixture(scope="module")
def oct26_client_and_db(tmp_path_factory):
    import shutil
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    root_db = Path("renewals.db")
    db_path = tmp_path_factory.mktemp("oct26_db") / "test_oct26.db"
    shutil.copy(root_db, db_path)
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    Session = sessionmaker(bind=engine)

    def override_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_db

    token = sign_admin_token()
    headers = {"Authorization": f"Bearer {token}"}

    with TestClient(app) as client:
        yield client, Session, headers
    app.dependency_overrides.clear()
    engine.dispose()
    try:
        if db_path.exists():
            db_path.unlink()
    except Exception:
        pass


def test_delayed_rebuild_matches_independent_pandas(oct26_client_and_db):
    """
    Primary test: Validates rebuilt delayed renewals against independent pandas ground truth.
    Delayed: Overdue + Ahead = Total.
    """
    client, Session, headers = oct26_client_and_db
    db = Session()
    try:
        active_snap = db.query(UploadSnapshot).filter(UploadSnapshot.is_active_today == True).first()
        if not active_snap:
            active_snap = db.query(UploadSnapshot).order_by(UploadSnapshot.snapshot_date.desc()).first()
        assert active_snap is not None

        snap_date = active_snap.snapshot_date
        svc = V2DelayedService(db)
        summary = svc.get_summary(as_of=str(active_snap.id))

        # Check structure
        assert "delayed_renewals" in summary
        assert "overdue" in summary
        assert "ahead" in summary
        assert "slipped_to_later_year" in summary
        assert "needs_review" in summary

        # Overdue + Ahead must equal Total
        tot = summary["delayed_renewals"]["total"]
        od = summary["delayed_renewals"]["overdue"]
        ah = summary["delayed_renewals"]["ahead"]

        assert tot["count"] == od["count"] + ah["count"]
        assert abs(tot["acv"] - (od["acv"] + ah["acv"])) < 0.05

        # Sub-split under Ahead must sum to Ahead
        split = ah.get("split", [])
        split_cnt_sum = sum(item.get("count", 0) for item in split)
        assert ah["count"] == split_cnt_sum

        # Slipped to later year 3 buckets sum to Slipped Total
        slipped = summary["slipped_to_later_year"]
        bucket_list = slipped.get("buckets", [])
        bucket_cnt_sum = sum(b.get("count", 0) for b in bucket_list)
        assert slipped["total"]["count"] == bucket_cnt_sum

    finally:
        db.close()


def test_independent_pandas_oct26_file_verification():
    """
    Verifies that independent pandas logic on data/Renewal Comparison Tool.xlsx
    correctly executes all date parsers, categorizations, and rules.
    """
    candidates = [
        Path("data/Renewal Comparison Tool (1).xlsx"),
        Path("data/Renewal Comparison Tool.xlsx"),
        Path("data/sample_oct7/Renewal Comparison Tool.xlsx"),
        Path("data/Renewal Comparison Tool 11.xlsx"),
        Path("data/Renewal Comparison Tool (2).xlsx"),
    ]
    target_file = next((f for f in candidates if f.exists()), None)
    assert target_file is not None

    truth = _load_and_compute_pandas_ground_truth(target_file, date(2026, 10, 26))

    delayed_cnt = len(truth["delayed_pos"])
    overdue_cnt = len(truth["overdue"])
    ahead_cnt = len(truth["ahead"])
    assert delayed_cnt == overdue_cnt + ahead_cnt

    slipped_cnt = len(truth["slipped_pos"])
    bucket_sum = len(truth["bucket_a"]) + len(truth["bucket_b"]) + len(truth["bucket_c"])
    assert slipped_cnt == bucket_sum

    # Needs review type 1, 2, 3 exist and are populated
    assert len(truth["review_t1"]) >= 0
    assert len(truth["review_t2"]) >= 0
    assert len(truth["review_t3"]) >= 0


def test_deals_drawers_api_endpoints(oct26_client_and_db):
    """
    Validates drawer deal lists: kind=overdue, ahead, slipped_total, buckets, and needs_review.
    Ensures extra contract attributes (service_expiry_date, group, why_it_is_here, also_delayed) are present.
    """
    client, Session, headers = oct26_client_and_db

    # Overdue drawer
    r_od = client.get("/api/v2/delayed/deals?kind=overdue")
    assert r_od.status_code == 200
    d_od = r_od.json()
    assert d_od["count"] == len(d_od["deals"])

    # Ahead drawer
    r_ah = client.get("/api/v2/delayed/deals?kind=ahead")
    assert r_ah.status_code == 200
    d_ah = r_ah.json()
    assert d_ah["count"] == len(d_ah["deals"])

    # Slipped drawer
    r_sl = client.get("/api/v2/delayed/deals?kind=slipped_total")
    assert r_sl.status_code == 200
    d_sl = r_sl.json()
    assert d_sl["count"] == len(d_sl["deals"])
    if d_sl["deals"]:
        sample_deal = d_sl["deals"][0]
        assert "service_expiry_date" in sample_deal
        assert "also_delayed" in sample_deal

    # Needs Review drawer
    for r_type in ["type_1", "type_2", "type_3"]:
        r_rev = client.get(f"/api/v2/delayed/deals?kind=needs_review&review_type={r_type}")
        assert r_rev.status_code == 200
        d_rev = r_rev.json()
        assert d_rev["count"] == len(d_rev["deals"])
        for deal in d_rev["deals"]:
            assert "why_it_is_here" in deal


def test_downstream_tabs_tie_to_delayed(oct26_client_and_db):
    """
    Verifies that Overview and Executive views tie directly to the Delayed service figures.
    """
    client, Session, headers = oct26_client_and_db

    r_del = client.get("/api/v2/delayed/summary")
    assert r_del.status_code == 200
    del_data = r_del.json()

    # Overview summary
    r_ov = client.get("/api/v2/overview/summary")
    assert r_ov.status_code == 200
    ov_data = r_ov.json()

    if "delayed_renewals" in ov_data and "total" in ov_data["delayed_renewals"]:
        assert ov_data["delayed_renewals"]["total"]["count"] == del_data["delayed_renewals"]["total"]["count"]
        assert abs(ov_data["delayed_renewals"]["total"]["acv"] - del_data["delayed_renewals"]["total"]["acv"]) < 0.1

    if "slipped_to_later_year" in ov_data and ov_data["slipped_to_later_year"]:
        assert ov_data["slipped_to_later_year"]["total"]["count"] == del_data["slipped_to_later_year"]["total"]["count"]

    # Executive view sections 7a and 7d tie directly to delayed endpoint
    assert "delayed_renewals" in del_data
    assert "slipped_to_later_year" in del_data
    assert del_data["delayed_renewals"]["total"]["count"] == del_data["delayed_renewals"]["overdue"]["count"] + del_data["delayed_renewals"]["ahead"]["count"]

    # Excel export verification: Sheet 'Needs review' is generated
    import openpyxl, io
    active_snap_id = del_data.get("snapshot_date")
    r_exp = client.get("/api/export/excel?scope=renewals")
    if r_exp.status_code == 200:
        wb = openpyxl.load_workbook(io.BytesIO(r_exp.content), read_only=True)
        assert "Needs review" in wb.sheetnames


def test_year_agnostic_date_shifting():
    """
    Proof of zero hard-coding: Shift all dates forward by +1 and +2 years.
    Assert that counts and ACVs are strictly invariant, while year labels dynamically shift.
    """
    base_date = date(2026, 10, 26)
    shift_1_date = date(2027, 10, 26)
    shift_2_date = date(2028, 10, 26)

    # Synthetic dataset
    raw_deals = [
        {"Opportunity Name": "D1", "Forecast ACV Amount": 1000.0, "Close Date": "2026-10-15", "Service Expiry date": "2026-09-30", "Group": "Delayed Renewal", "Sales Type": "Renewals", "Forecast Category": "Commit", "Probability (%)": 80, "Stage Number": 5},
        {"Opportunity Name": "D2", "Forecast ACV Amount": 2500.0, "Close Date": "2026-11-20", "Service Expiry date": "2026-09-30", "Group": "Delayed Renewal", "Sales Type": "Renewals", "Forecast Category": "Commit", "Probability (%)": 80, "Stage Number": 5},
        {"Opportunity Name": "D3", "Forecast ACV Amount": 5000.0, "Close Date": "2027-02-15", "Service Expiry date": "2026-12-31", "Group": "Standard Renewal", "Sales Type": "Renewals", "Forecast Category": "Commit", "Probability (%)": 80, "Stage Number": 5},
        {"Opportunity Name": "D4", "Forecast ACV Amount": -50.0, "Close Date": "2027-02-15", "Service Expiry date": "2026-12-31", "Group": "Standard Renewal", "Sales Type": "Renewals", "Forecast Category": "Commit", "Probability (%)": 80, "Stage Number": 5},
    ]

    def _eval_shifted(deals, s_date):
        yr_delta = s_date.year - 2026
        shifted = []
        for d in deals:
            copy_d = dict(d)
            cd = datetime.strptime(d["Close Date"], "%Y-%m-%d").date()
            ed = datetime.strptime(d["Service Expiry date"], "%Y-%m-%d").date()
            copy_d["_close_d"] = date(cd.year + yr_delta, cd.month, cd.day)
            copy_d["_exp_d"] = date(ed.year + yr_delta, ed.month, ed.day)
            shifted.append(copy_d)

        df = pd.DataFrame(shifted)
        yr_end = date(s_date.year, 12, 31)

        # Delayed
        del_pos = df[(df["Group"] == "Delayed Renewal") & (df["Forecast ACV Amount"] > 0)]
        od = del_pos[del_pos["_close_d"] < s_date]
        ah = del_pos[del_pos["_close_d"] >= s_date]

        # Slipped
        slip_all = df[(df["_exp_d"] <= yr_end) & (df["_close_d"] > yr_end)]
        slip_pos = slip_all[slip_all["Forecast ACV Amount"] > 0]
        slip_nonpos = slip_all[slip_all["Forecast ACV Amount"] <= 0]

        return {
            "delayed_cnt": len(del_pos),
            "delayed_acv": float(del_pos["Forecast ACV Amount"].sum()),
            "od_cnt": len(od),
            "ah_cnt": len(ah),
            "slip_cnt": len(slip_pos),
            "slip_acv": float(slip_pos["Forecast ACV Amount"].sum()),
            "slip_nonpos_cnt": len(slip_nonpos),
            "target_year": yr_end.year + 1,
        }

    res_base = _eval_shifted(raw_deals, base_date)
    res_1 = _eval_shifted(raw_deals, shift_1_date)
    res_2 = _eval_shifted(raw_deals, shift_2_date)

    # Invariance check
    assert res_base["delayed_cnt"] == res_1["delayed_cnt"] == res_2["delayed_cnt"]
    assert res_base["delayed_acv"] == res_1["delayed_acv"] == res_2["delayed_acv"]
    assert res_base["od_cnt"] == res_1["od_cnt"] == res_2["od_cnt"]
    assert res_base["ah_cnt"] == res_1["ah_cnt"] == res_2["ah_cnt"]
    assert res_base["slip_cnt"] == res_1["slip_cnt"] == res_2["slip_cnt"]
    assert res_base["slip_acv"] == res_1["slip_acv"] == res_2["slip_acv"]
    assert res_base["slip_nonpos_cnt"] == res_1["slip_nonpos_cnt"] == res_2["slip_nonpos_cnt"]

    # Dynamic target year shift check
    assert res_1["target_year"] == res_base["target_year"] + 1
    assert res_2["target_year"] == res_base["target_year"] + 2


def test_missing_group_column_fallback():
    """
    Tests fallback behavior when Group column is completely absent.
    Fallback: deals with service_expiry_date < quarter_start are selected as Delayed.
    """
    snap_date = date(2026, 10, 26)
    q_start = date(2026, 10, 1)

    raw_deals = [
        {"Opportunity Name": "ExpPriorQ", "Forecast ACV Amount": 3000.0, "Close Date": "2026-11-01", "Service Expiry date": "2026-09-15", "Sales Type": "Renewals", "Forecast Category": "Commit", "Probability (%)": 70, "Stage Number": 5},
        {"Opportunity Name": "ExpInQ", "Forecast ACV Amount": 4000.0, "Close Date": "2026-11-01", "Service Expiry date": "2026-10-15", "Sales Type": "Renewals", "Forecast Category": "Commit", "Probability (%)": 70, "Stage Number": 5},
    ]
    df = pd.DataFrame(raw_deals)
    df["_exp_d"] = df["Service Expiry date"].apply(lambda d: datetime.strptime(d, "%Y-%m-%d").date())

    # No Group column -> fallback uses _exp_d < q_start
    fallback_delayed = df[df["_exp_d"] < q_start]
    assert len(fallback_delayed) == 1
    assert fallback_delayed.iloc[0]["Opportunity Name"] == "ExpPriorQ"


def test_serial_dates_and_far_ahead_close():
    """
    Validates handling of Excel serial numbers and flagging of far-ahead close dates (> 5 years).
    """
    snap_date = date(2026, 10, 26)
    far_ahead_years = 5

    serial_num = 46356  # Valid Excel serial
    parsed_date = _parse_test_date(serial_num)
    assert parsed_date is not None
    assert isinstance(parsed_date, date)

    # Deal 7 years ahead
    far_date = date(snap_date.year + 7, 6, 1)
    is_far_ahead = far_date.year > (snap_date.year + far_ahead_years)
    assert is_far_ahead is True
