import pytest
import pathlib
import pandas as pd
from datetime import timedelta
from fastapi.testclient import TestClient
from backend.main import app
from backend.database import get_db
from backend.utils.excel_parser import detect_file_slot, _map_columns, parse_excel_date

@pytest.fixture(scope="module")
def client_and_db(tmp_path_factory):
    from backend.tests.test_db_helper import get_test_engine_and_session
    engine, Session = get_test_engine_and_session("test_v2_overview_b7_b8", tmp_path_factory)

    def override_db():
        db = Session()
        try: yield db
        finally: db.close()

    app.dependency_overrides[get_db] = override_db

    sample = pathlib.Path("data/sample_oct7")
    slots = {}
    for fp in sorted(sample.glob("*.xlsx")):
        slots[detect_file_slot(fp)[0]] = fp

    with TestClient(app) as test_client:
        files = [(slot, (fp.name, open(fp, "rb"),
                 "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
                 for slot, fp in slots.items()]
        data = {"data_as_of_date": "2026-10-07", "yesterday_date": "2026-10-06"}
        vr = test_client.post("/api/snapshots/validate", data=data, files=files)
        assert vr.status_code == 200, vr.text
        session_id = vr.json()["session_id"]

        cr = test_client.post("/api/snapshots/commit",
                         json={"session_id": session_id, "replace": False})
        assert cr.status_code == 200, cr.text

        yield test_client


def test_b8_coverage_line_from_pandas(client_and_db):
    """
    B8. Coverage line: Commit + Best Case as % of total ACV for selected period,
    with change vs yesterday and vs last week (percentage-point change),
    clickable to the deals involved.
    All assertions derived dynamically with pandas from fixture files (never literals).
    """
    fixture_path = pathlib.Path("data/sample_oct7/Renewal Comparison Tool.xlsx")
    assert fixture_path.exists(), "Repository fixture required"

    # Compute ground truth reference directly from pandas on the Excel fixture
    df_today_raw = pd.read_excel(fixture_path, sheet_name="today")
    df_today = _map_columns(df_today_raw)
    df_today["forecast_acv_amount"] = pd.to_numeric(df_today["forecast_acv_amount"], errors="coerce").fillna(0.0)
    
    # Scoped to renewals and Q4
    target_q = "Q4-2026"
    today_scoped = df_today[(df_today["sales_type"] == "Renewals") & (df_today["fiscal_period"] == target_q)].copy()
    today_scoped = today_scoped.drop_duplicates(subset=["opportunity_id_18"], keep="last")
    
    exp_tot_acv = float(today_scoped["forecast_acv_amount"].sum())
    commit_bc_df = today_scoped[today_scoped["forecast_category"].isin(["Commit", "Best Case"])]
    exp_cov_acv = float(commit_bc_df["forecast_acv_amount"].sum())
    exp_cov_count = len(commit_bc_df)
    exp_cov_pct = round(exp_cov_acv / exp_tot_acv * 100, 2) if exp_tot_acv > 0 else 0.0

    # Yesterday
    df_yest_raw = pd.read_excel(fixture_path, sheet_name="yesterday")
    df_yest = _map_columns(df_yest_raw)
    df_yest["forecast_acv_amount"] = pd.to_numeric(df_yest["forecast_acv_amount"], errors="coerce").fillna(0.0)
    yest_scoped = df_yest[(df_yest["sales_type"] == "Renewals") & (df_yest["fiscal_period"] == target_q)].copy()
    yest_scoped = yest_scoped.drop_duplicates(subset=["opportunity_id_18"], keep="last")
    
    y_tot_acv = float(yest_scoped["forecast_acv_amount"].sum())
    y_commit_bc_df = yest_scoped[yest_scoped["forecast_category"].isin(["Commit", "Best Case"])]
    y_cov_acv = float(y_commit_bc_df["forecast_acv_amount"].sum())
    y_cov_pct = round(y_cov_acv / y_tot_acv * 100, 2) if y_tot_acv > 0 else 0.0
    exp_delta_y_pp = round(exp_cov_pct - y_cov_pct, 2)

    # API response
    r = client_and_db.get("/api/v2/overview/summary?as_of=2026-10-07")
    assert r.status_code == 200, r.text
    summary = r.json()
    assert "coverage" in summary
    cov = summary["coverage"]

    # Verify Coverage values against pandas ground truth
    assert cov["count"] == exp_cov_count
    assert abs(cov["acv"] - exp_cov_acv) < 0.05
    assert abs(cov["pct"] - exp_cov_pct) < 0.05
    assert cov["delta_yesterday_pp"] is not None
    assert abs(cov["delta_yesterday_pp"] - exp_delta_y_pp) < 0.05

    # Verify coverage drawer deals (/api/v2/overview/deals?kind=coverage)
    r_deals = client_and_db.get("/api/v2/overview/deals?kind=coverage&as_of=2026-10-07")
    assert r_deals.status_code == 200, r_deals.text
    d_cov = r_deals.json()
    assert d_cov["count"] == exp_cov_count
    assert abs(d_cov["acv"] - exp_cov_acv) < 0.05
    deals_ids = {d["opportunity_id_18"] for d in d_cov["deals"]}
    expected_ids = set(commit_bc_df["opportunity_id_18"])
    assert deals_ids == expected_ids


def test_b7_needs_attention_panel_from_pandas(client_and_db):
    """
    B7. Needs attention panel on Overview with up to 5 data-generated items:
    1. largest Commit deals not approved (same definition as Approvals page)
    2. largest overdue deals
    3. biggest drop vs yesterday
    4. deals closing within 14 days with no approval
    Every line links to the matching deals drawer.
    All assertions derived dynamically with pandas from fixture files (never literals).
    """
    fixture_path = pathlib.Path("data/sample_oct7/Renewal Comparison Tool.xlsx")
    df_today_raw = pd.read_excel(fixture_path, sheet_name="today")
    df_today = _map_columns(df_today_raw)
    df_today["forecast_acv_amount"] = pd.to_numeric(df_today["forecast_acv_amount"], errors="coerce").fillna(0.0)
    
    target_q = "Q4-2026"
    today_scoped = df_today[(df_today["sales_type"] == "Renewals") & (df_today["fiscal_period"] == target_q)].copy()
    today_scoped = today_scoped.drop_duplicates(subset=["opportunity_id_18"], keep="last")
    snap_date = pd.Timestamp("2026-10-07").date()

    # Normalize approval status
    def norm_appr(s):
        if pd.isna(s) or str(s).strip() in ("", "nan", "None", "Blank"):
            return "Blank"
        s = str(s).strip()
        if s in ("Approved", "Approved - 2nd"):
            return "Approved"
        if s in ("Pending Approval", "Pending-Approval"):
            return "Pending Approval"
        return s

    today_scoped["norm_status"] = today_scoped["approval_status"].apply(norm_appr)
    today_scoped["parsed_close_date"] = today_scoped["close_date"].apply(parse_excel_date)

    stage_col = "stage_number" if "stage_number" in today_scoped.columns else "stage"
    is_del = today_scoped[stage_col].astype(str).str.lower().isin(["deleted", "lost"])

    # 1. Commit deals not approved
    commit_unappr = today_scoped[(today_scoped["forecast_category"] == "Commit") & (today_scoped["norm_status"] != "Approved")].copy()
    commit_unappr = commit_unappr.sort_values(by="forecast_acv_amount", ascending=False)
    exp_cna_count = len(commit_unappr)
    exp_cna_acv = float(commit_unappr["forecast_acv_amount"].sum())
    exp_top_cna_deal = commit_unappr.iloc[0]["opportunity_id_18"]
    exp_top_cna_acv = float(commit_unappr.iloc[0]["forecast_acv_amount"])

    # 2. Overdue deals: open, Renewals, not Closed, not deleted/lost, close date before snapshot date; largest ACV first
    df_today_ren = df_today[df_today["sales_type"] == "Renewals"].copy().drop_duplicates(subset=["opportunity_id_18"], keep="last")
    is_del_all = df_today_ren[stage_col].astype(str).str.lower().isin(["deleted", "lost"])
    df_today_ren["parsed_close_date"] = df_today_ren["close_date"].apply(parse_excel_date)
    overdue_df = df_today_ren[(df_today_ren["parsed_close_date"] < snap_date) & (df_today_ren["forecast_category"] != "Closed") & (~is_del_all)].copy()
    overdue_df = overdue_df.sort_values(by=["forecast_acv_amount", "opportunity_id_18"], ascending=[False, True])
    exp_od_count = len(overdue_df)
    exp_od_acv = float(overdue_df["forecast_acv_amount"].sum())
    exp_top_od_deal = overdue_df.iloc[0]["opportunity_id_18"]
    exp_top_od_acv = float(overdue_df.iloc[0]["forecast_acv_amount"])

    # 3. Biggest drop vs yesterday
    df_yest_raw = pd.read_excel(fixture_path, sheet_name="yesterday")
    df_yest = _map_columns(df_yest_raw)
    df_yest["forecast_acv_amount"] = pd.to_numeric(df_yest["forecast_acv_amount"], errors="coerce").fillna(0.0)
    yest_scoped = df_yest[(df_yest["sales_type"] == "Renewals") & (df_yest["fiscal_period"] == target_q)].copy()
    yest_scoped = yest_scoped.drop_duplicates(subset=["opportunity_id_18"], keep="last")

    t_map = {str(r["opportunity_id_18"]): float(r["forecast_acv_amount"]) for _, r in today_scoped.iterrows()}
    drops = []
    for _, r in yest_scoped.iterrows():
        oid = str(r["opportunity_id_18"])
        p_acv = float(r["forecast_acv_amount"] or 0)
        c_acv = t_map.get(oid, 0.0)
        diff = p_acv - c_acv
        if diff > 0.01:
            drops.append({"id": oid, "drop": diff})
    drops_sorted = sorted(drops, key=lambda x: x["drop"], reverse=True)
    exp_dr_count = len(drops_sorted)
    exp_dr_acv = float(sum(d["drop"] for d in drops_sorted))
    exp_top_drop_deal = drops_sorted[0]["id"]
    exp_top_drop_amount = float(drops_sorted[0]["drop"])

    # 4. Closing within 14 days with no approval
    closing_14d = today_scoped[
        (today_scoped["parsed_close_date"] >= snap_date) &
        (today_scoped["parsed_close_date"] <= snap_date + timedelta(days=14)) &
        (today_scoped["norm_status"] != "Approved") &
        (today_scoped["forecast_category"] != "Closed") &
        (~is_del)
    ].copy()
    closing_14d = closing_14d.sort_values(by="forecast_acv_amount", ascending=False)
    exp_cl_count = len(closing_14d)
    exp_cl_acv = float(closing_14d["forecast_acv_amount"].sum())
    exp_top_cl_deal = closing_14d.iloc[0]["opportunity_id_18"]
    exp_top_cl_acv = float(closing_14d.iloc[0]["forecast_acv_amount"])

    # Query API summary
    r = client_and_db.get("/api/v2/overview/summary?as_of=2026-10-07")
    assert r.status_code == 200
    summary = r.json()
    assert "needs_attention" in summary
    na = summary["needs_attention"]
    items = na.get("items", [])
    
    # Assert at most 5 data-generated items
    assert 0 < len(items) <= 5
    cat_keys = {it["category_key"] for it in items}

    # Verify Commit not approved item
    assert "commit_not_approved" in cat_keys
    cna_item = next(it for it in items if it["category_key"] == "commit_not_approved")
    assert cna_item["opportunity_id_18"] == exp_top_cna_deal
    assert abs(cna_item["acv"] - exp_top_cna_acv) < 0.05
    assert cna_item["category_count"] == exp_cna_count
    assert abs(cna_item["category_acv"] - exp_cna_acv) < 0.05

    # Verify drawer endpoint for commit_not_approved
    r_cna_drawer = client_and_db.get("/api/v2/overview/deals?kind=commit_not_approved&as_of=2026-10-07")
    assert r_cna_drawer.status_code == 200
    d_cna = r_cna_drawer.json()
    assert d_cna["count"] == exp_cna_count
    assert abs(d_cna["acv"] - exp_cna_acv) < 0.05

    # Verify Overdue deal item
    assert "overdue" in cat_keys
    od_item = next(it for it in items if it["category_key"] == "overdue")
    assert od_item["opportunity_id_18"] == exp_top_od_deal
    assert abs(od_item["acv"] - exp_top_od_acv) < 0.05
    assert od_item["category_count"] == exp_od_count
    assert abs(od_item["category_acv"] - exp_od_acv) < 0.05

    # Verify drawer endpoint for overdue
    r_od_drawer = client_and_db.get("/api/v2/overview/deals?kind=overdue&as_of=2026-10-07")
    assert r_od_drawer.status_code == 200
    d_od = r_od_drawer.json()
    assert d_od["count"] == exp_od_count
    assert abs(d_od["acv"] - exp_od_acv) < 0.05

    # Verify Biggest drop item
    assert "biggest_drop" in cat_keys
    drop_item = next(it for it in items if it["category_key"] == "biggest_drop")
    assert drop_item["opportunity_id_18"] == exp_top_drop_deal
    assert abs(drop_item["acv"] - exp_top_drop_amount) < 0.05
    assert drop_item["category_count"] == exp_dr_count

    # Verify drawer endpoint for biggest_drop
    r_drop_drawer = client_and_db.get("/api/v2/overview/deals?kind=biggest_drop&as_of=2026-10-07")
    assert r_drop_drawer.status_code == 200
    d_dr = r_drop_drawer.json()
    assert d_dr["count"] == exp_dr_count

    # Verify Closing within 14 days item
    assert "closing_14d_unapproved" in cat_keys
    cl_item = next(it for it in items if it["category_key"] == "closing_14d_unapproved")
    assert cl_item["opportunity_id_18"] == exp_top_cl_deal
    assert abs(cl_item["acv"] - exp_top_cl_acv) < 0.05
    assert cl_item["category_count"] == exp_cl_count
    assert abs(cl_item["category_acv"] - exp_cl_acv) < 0.05

    # Verify drawer endpoint for closing_14d_unapproved
    r_cl_drawer = client_and_db.get("/api/v2/overview/deals?kind=closing_14d_unapproved&as_of=2026-10-07")
    assert r_cl_drawer.status_code == 200
    d_cl = r_cl_drawer.json()
    assert d_cl["count"] == exp_cl_count
    assert abs(d_cl["acv"] - exp_cl_acv) < 0.05
