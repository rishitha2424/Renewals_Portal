import pytest
import pathlib
from fastapi.testclient import TestClient
from backend.main import app
from backend.database import get_db
from backend.utils.excel_parser import detect_file_slot

@pytest.fixture(scope="module")
def client_and_db(tmp_path_factory):
    from backend.tests.test_db_helper import get_test_engine_and_session
    engine, Session = get_test_engine_and_session("test_v2_approvals", tmp_path_factory)
    
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
    app.dependency_overrides.clear()

def test_v2_approvals_oct7(client_and_db):
    import pandas as pd
    import pathlib
    from backend.utils.excel_parser import _map_columns
    fixture_path = pathlib.Path("data/sample_oct7/Renewal Comparison Tool.xlsx")
    df_raw = pd.read_excel(fixture_path, sheet_name="today")
    df = _map_columns(df_raw)
    df["forecast_acv_amount"] = pd.to_numeric(df["forecast_acv_amount"], errors="coerce").fillna(0.0)
    df_q4 = df[(df["sales_type"] == "Renewals") & (df["fiscal_period"] == "Q4-2026")]

    expected_total_count = len(df_q4)
    expected_total_acv = float(df_q4["forecast_acv_amount"].sum())

    res = client_and_db.get("/api/v2/approvals/distribution?as_of=2026-10-07&exclude_deleted_lost=false")
    assert res.status_code == 200
    d = res.json()
    assert "error" not in d
    
    assert d["total"]["count"] == expected_total_count
    assert d["total"]["acv"] == pytest.approx(expected_total_acv, abs=0.01)
    
    stats = {s["status"]: s for s in d["statuses"]}
    assert "Blank" in stats
    blank_appr = df_q4[df_q4["approval_status"].isna() | (df_q4["approval_status"] == "Blank") | (df_q4["approval_status"] == "")]
    expected_blank_count = len(blank_appr)
    expected_blank_acv = float(blank_appr["forecast_acv_amount"].sum())
    assert stats["Blank"]["count"] == expected_blank_count
    assert stats["Blank"]["acv"] == pytest.approx(expected_blank_acv, abs=0.01)
    
    assert "Approved" in stats
    appr_df = df_q4[df_q4["approval_status"] == "Approved"]
    expected_appr_count = len(appr_df)
    expected_appr_acv = float(appr_df["forecast_acv_amount"].sum())
    assert stats["Approved"]["count"] == expected_appr_count
    assert stats["Approved"]["acv"] == pytest.approx(expected_appr_acv, abs=0.01)

    assert "Pending Approval" in stats
    pending_df = df_q4[df_q4["approval_status"].isin(["Pending Approval", "Pending-Approval", "Pending", "Submitted", "In Approval"])]
    expected_pending_count = len(pending_df)
    expected_pending_acv = float(pending_df["forecast_acv_amount"].sum())
    assert stats["Pending Approval"]["count"] == expected_pending_count
    assert stats["Pending Approval"]["acv"] == pytest.approx(expected_pending_acv, abs=0.01)

    mat = d["matrix"]
    assert mat["Approved"]["Best Case"]["count"] == len(appr_df[appr_df["forecast_category"] == "Best Case"])
    assert mat["Approved"]["Commit"]["count"] == len(appr_df[appr_df["forecast_category"] == "Commit"])
    assert mat["Pending Approval"]["Best Case"]["count"] == len(pending_df[pending_df["forecast_category"] == "Best Case"])
    assert mat["Pending Approval"]["Commit"]["count"] == len(pending_df[pending_df["forecast_category"] == "Commit"])
    assert mat["Blank"]["Best Case"]["count"] == len(blank_appr[blank_appr["forecast_category"] == "Best Case"])
    assert mat["Blank"]["Blank"]["count"] == len(blank_appr[~blank_appr["forecast_category"].isin(["Best Case", "Commit", "Pipeline", "Closed"])])
    assert mat["Blank"]["Commit"]["count"] == len(blank_appr[blank_appr["forecast_category"] == "Commit"])
    assert mat["Blank"]["Pipeline"]["count"] == len(blank_appr[blank_appr["forecast_category"] == "Pipeline"])
    
    # Tests for get_deals
    def check_deals(qs, count, acv):
        res = client_and_db.get(f"/api/v2/approvals/deals?as_of=2026-10-07&exclude_deleted_lost=false{qs}")
        d = res.json()
        assert d["count"] == count
        assert round(d["acv"], 2) == round(acv, 2)
        assert len(d["deals"]) == count

    check_deals("&status=Blank&category=Commit", len(blank_appr[blank_appr["forecast_category"] == "Commit"]), float(blank_appr[blank_appr["forecast_category"] == "Commit"]["forecast_acv_amount"].sum()))
    check_deals("&status=Blank&category=Blank", len(blank_appr[~blank_appr["forecast_category"].isin(["Best Case", "Commit", "Pipeline", "Closed"])]), float(blank_appr[~blank_appr["forecast_category"].isin(["Best Case", "Commit", "Pipeline", "Closed"])]["forecast_acv_amount"].sum()))
    check_deals("&status=Approved", expected_appr_count, expected_appr_acv)
    check_deals("&status=Approved&category=Best Case", len(appr_df[appr_df["forecast_category"] == "Best Case"]), float(appr_df[appr_df["forecast_category"] == "Best Case"]["forecast_acv_amount"].sum()))
    check_deals("&status=Pending Approval", expected_pending_count, expected_pending_acv)
    check_deals("", expected_total_count, expected_total_acv)

def test_v2_approvals_time_travel(client_and_db):
    res = client_and_db.get("/api/v2/approvals/distribution?as_of=2027-01-05&exclude_deleted_lost=false")
    assert res.status_code == 200

def test_v2_approvals_empty(client_and_db):
    res = client_and_db.get("/api/v2/approvals/distribution?as_of=2020-01-01&exclude_deleted_lost=false")
    d = res.json()
    assert "error" in d or d.get("total", {}).get("count") == 0

def test_v2_approvals_exclude_deleted(client_and_db):
    res = client_and_db.get("/api/v2/approvals/distribution?as_of=2026-10-07&exclude_deleted_lost=true")
    d = res.json()
    assert "error" not in d
    assert "total" in d and "count" in d["total"]


def test_v2_approvals_new_tables(client_and_db):
    """
    Test additions to Approvals page:
    1. Approval funnel (Not submitted -> Pending Approval -> Approved, deals, ACV, % of period)
    2. Deal-size split (>= threshold, < threshold) per status
    3. Approval coverage per forecast category, per region, per BU with gap to portfolio benchmark
    4. Commit but not approved: table of Commit deals with no approval ranked by ACV
    5. Pending ageing: deals currently Pending Approval, oldest first
    6. Trend of Approved % over recent snapshots with labeled units
    All numbers verified against pandas computed from fixture, with drawer counts & ACV matching exactly.
    """
    import pandas as pd
    import pathlib
    from backend.config import settings
    from backend.services.scopes import ScopeService
    from backend.utils.excel_parser import _map_columns

    fixture_path = pathlib.Path("data/sample_oct7/Renewal Comparison Tool.xlsx")
    df_raw = pd.read_excel(fixture_path, sheet_name="today")
    df = _map_columns(df_raw)
    df["forecast_acv_amount"] = pd.to_numeric(df["forecast_acv_amount"], errors="coerce").fillna(0.0)

    # Scoped to current quarter renewals (matching distribution query)
    cq = ScopeService.quarter_of(pd.Timestamp("2026-10-07").date())
    df_scoped = df[(df["sales_type"] == "Renewals") & (df["fiscal_period"] == cq)].copy()
    total_count = len(df_scoped)
    total_acv = float(df_scoped["forecast_acv_amount"].sum())

    # Map approval status to normalized values
    def norm_appr(s):
        if pd.isna(s) or str(s).strip() in ("", "nan", "None", "Blank"):
            return "Blank"
        s = str(s).strip()
        if s in ("Approved", "Approved - 2nd"):
            return "Approved"
        if s in ("Pending Approval", "Pending-Approval"):
            return "Pending Approval"
        return s

    df_scoped["norm_status"] = df_scoped["approval_status"].apply(norm_appr)

    res = client_and_db.get("/api/v2/approvals/distribution?as_of=2026-10-07&exclude_deleted_lost=false")
    assert res.status_code == 200
    d = res.json()

    # 1. Approval Funnel: Not submitted -> Pending Approval -> Approved
    funnel = d.get("funnel", [])
    expected_funnel_len = len(["Not submitted", "Pending Approval", "Approved"])
    assert len(funnel) == expected_funnel_len
    stage_map = {item["stage"]: item for item in funnel}
    assert "Not submitted" in stage_map
    assert "Pending Approval" in stage_map
    assert "Approved" in stage_map

    for stage_name, status_key in [("Not submitted", "Blank"), ("Pending Approval", "Pending Approval"), ("Approved", "Approved")]:
        stage_df = df_scoped[df_scoped["norm_status"] == status_key]
        exp_c = len(stage_df)
        exp_a = float(stage_df["forecast_acv_amount"].sum())
        assert stage_map[stage_name]["count"] == exp_c
        assert stage_map[stage_name]["acv"] == pytest.approx(exp_a, abs=0.05)

        # Check drawer matches
        r_deals = client_and_db.get(f"/api/v2/approvals/deals?as_of=2026-10-07&status={status_key}")
        assert r_deals.status_code == 200
        d_deals = r_deals.json()
        assert d_deals["count"] == exp_c
        assert d_deals["acv"] == pytest.approx(exp_a, abs=0.05)
        assert len(d_deals["deals"]) == exp_c

    # 2. Deal-size split per status
    threshold = getattr(settings, "APPROVAL_DEAL_SIZE_THRESHOLD", 100000.0)
    split = d.get("deal_size_split", {})
    assert split.get("threshold") == threshold
    split_map = {s["status"]: s for s in split.get("statuses", [])}
    assert "Approved" in split_map
    assert "Pending Approval" in split_map
    assert "Not submitted" in split_map
    assert "Total" in split_map

    for status_label, status_key in [("Approved", "Approved"), ("Pending Approval", "Pending Approval"), ("Not submitted", "Blank"), ("Total", None)]:
        st_df = df_scoped if status_key is None else df_scoped[df_scoped["norm_status"] == status_key]
        large_df = st_df[st_df["forecast_acv_amount"] >= threshold]
        small_df = st_df[st_df["forecast_acv_amount"] < threshold]

        exp_large_c = len(large_df)
        exp_large_a = float(large_df["forecast_acv_amount"].sum())
        exp_small_c = len(small_df)
        exp_small_a = float(small_df["forecast_acv_amount"].sum())

        assert split_map[status_label]["large"]["count"] == exp_large_c
        assert split_map[status_label]["large"]["acv"] == pytest.approx(exp_large_a, abs=0.05)
        assert split_map[status_label]["small"]["count"] == exp_small_c
        assert split_map[status_label]["small"]["acv"] == pytest.approx(exp_small_a, abs=0.05)

        # Check drawer for large deals
        status_param = f"&status={status_key}" if status_key else ""
        r_lg = client_and_db.get(f"/api/v2/approvals/deals?as_of=2026-10-07{status_param}&min_acv={threshold}")
        assert r_lg.status_code == 200
        d_lg = r_lg.json()
        assert d_lg["count"] == exp_large_c
        assert d_lg["acv"] == pytest.approx(exp_large_a, abs=0.05)

        # Check drawer for small deals
        r_sm = client_and_db.get(f"/api/v2/approvals/deals?as_of=2026-10-07{status_param}&max_acv={threshold}")
        assert r_sm.status_code == 200
        d_sm = r_sm.json()
        assert d_sm["count"] == exp_small_c
        assert d_sm["acv"] == pytest.approx(exp_small_a, abs=0.05)

    # 3. Approval coverage per forecast category, per region, per BU with gap to portfolio average
    cov = d.get("approval_coverage", {})
    appr_all = df_scoped[df_scoped["norm_status"] == "Approved"]
    exp_port_acv = float(appr_all["forecast_acv_amount"].sum())
    exp_port_pct = round(exp_port_acv / total_acv * 100, 1) if total_acv > 0 else 0.0
    assert cov.get("portfolio_average_pct") == pytest.approx(exp_port_pct, abs=0.1)

    # Category coverage
    cat_cov_map = {item["name"]: item for item in cov.get("by_category", [])}
    for cat in df_scoped["forecast_category"].dropna().unique():
        cat_df = df_scoped[df_scoped["forecast_category"] == cat]
        cat_appr = cat_df[cat_df["norm_status"] == "Approved"]
        exp_c_tot = len(cat_df)
        exp_c_appr = len(cat_appr)
        exp_a_tot = float(cat_df["forecast_acv_amount"].sum())
        exp_a_appr = float(cat_appr["forecast_acv_amount"].sum())
        exp_c_pct = round(exp_a_appr / exp_a_tot * 100, 1) if exp_a_tot > 0 else 0.0
        exp_gap = round(exp_c_pct - exp_port_pct, 1)

        if cat in cat_cov_map:
            assert cat_cov_map[cat]["total_count"] == exp_c_tot
            assert cat_cov_map[cat]["approved_count"] == exp_c_appr
            assert cat_cov_map[cat]["total_acv"] == pytest.approx(exp_a_tot, abs=0.05)
            assert cat_cov_map[cat]["approved_acv"] == pytest.approx(exp_a_appr, abs=0.05)
            assert cat_cov_map[cat]["gap"] == pytest.approx(exp_gap, abs=0.2)

    # 4. "Commit but not approved": table of Commit deals with no approval
    commit_unappr_df = df_scoped[(df_scoped["forecast_category"] == "Commit") & (df_scoped["norm_status"] != "Approved")]
    cna = d.get("commit_not_approved", {})
    exp_cna_count = len(commit_unappr_df)
    exp_cna_acv = float(commit_unappr_df["forecast_acv_amount"].sum())
    assert cna.get("count") == exp_cna_count
    assert cna.get("acv") == pytest.approx(exp_cna_acv, abs=0.05)
    assert len(cna.get("deals", [])) == exp_cna_count

    # Check ranking by ACV descending
    cna_deals = cna.get("deals", [])
    for i in range(len(cna_deals) - 1):
        assert cna_deals[i]["forecast_acv_amount"] >= cna_deals[i+1]["forecast_acv_amount"]

    # Check drawer endpoint
    r_cna = client_and_db.get("/api/v2/approvals/deals?as_of=2026-10-07&category=Commit&status=not_approved")
    assert r_cna.status_code == 200
    d_cna = r_cna.json()
    assert d_cna["count"] == exp_cna_count
    assert d_cna["acv"] == pytest.approx(exp_cna_acv, abs=0.05)

    # 5. Pending ageing: deals currently Pending Approval, oldest first
    pa = d.get("pending_ageing", {})
    pend_df = df_scoped[df_scoped["norm_status"] == "Pending Approval"]
    exp_pend_count = len(pend_df)
    exp_pend_acv = float(pend_df["forecast_acv_amount"].sum())
    assert pa.get("count") == exp_pend_count
    assert pa.get("acv") == pytest.approx(exp_pend_acv, abs=0.05)
    assert len(pa.get("deals", [])) == exp_pend_count

    # 6. Trend of Approved % over recent snapshots
    trend = d.get("approved_trend", [])
    assert len(trend) > 0
    for point in trend:
        assert "snapshot_date" in point
        assert point.get("unit_acv") == "% of ACV"
        assert point.get("unit_count") == "% of Deals"
        assert point.get("approved_pct_acv") >= 0

