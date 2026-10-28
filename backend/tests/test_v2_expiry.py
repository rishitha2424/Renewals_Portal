import pytest
import pathlib
import pandas as pd
from datetime import date
from fastapi.testclient import TestClient

from backend.main import app
from backend.database import get_db
from backend.utils.excel_parser import detect_file_slot

client = TestClient(app)

@pytest.fixture(scope="module")
def oct7_fixture_df():
    p = pathlib.Path("data/sample_oct7/Renewal Comparison Tool.xlsx")
    return pd.read_excel(p, sheet_name="today")

@pytest.fixture(scope="module")
def client_and_db(tmp_path_factory):
    from backend.tests.test_db_helper import get_test_engine_and_session
    engine, Session = get_test_engine_and_session("test_v2_expiry", tmp_path_factory)
    
    def override_db():
        db = Session()
        try: yield db
        finally: db.close()

    app.dependency_overrides[get_db] = override_db

    sample = pathlib.Path("data/sample_oct7")
    slots = {}
    for fp in sorted(sample.glob("*.xlsx")):
        slots[detect_file_slot(fp)[0]] = fp
    assert "comparison_tool" in slots
    expected_summary_slots_len = len([s for s in slots if s.startswith("renewals_summary:")])
    assert expected_summary_slots_len == len([fp for fp in sample.glob("Renewals Summary*.xlsx")])

    from backend.services.context import sign_admin_token
    token = sign_admin_token()
    headers = {"Authorization": f"Bearer {token}"}

    with TestClient(app) as test_client:
        files = [(slot, (fp.name, open(fp, "rb"),
                 "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
                 for slot, fp in slots.items()]
        data = {"data_as_of_date": "2026-10-07", "yesterday_date": "2026-10-06"}
        vr = test_client.post("/api/snapshots/validate", data=data, files=files, headers=headers)
        assert vr.status_code == 200, vr.text
        session_id = vr.json()["session_id"]

        cr = test_client.post("/api/snapshots/commit",
                         json={"session_id": session_id, "replace": False}, headers=headers)
        assert cr.status_code == 200, cr.text

        yield test_client
    app.dependency_overrides.clear()

class TestExpirySummary:
    def test_full_grid(self, client_and_db, oct7_fixture_df):
        res = client_and_db.get("/api/v2/expiry/summary?exclude_deleted_lost=false")
        assert res.status_code == 200
        d = res.json()

        df_fiscal = oct7_fixture_df[oct7_fixture_df["Sales Type"] == "Renewals"].copy()

        def q_stats(sub):
            return len(sub), round(float(sub["Forecast ACV Amount"].fillna(0).sum()), 2)

        g26 = d["grids"]["2026"]
        g27 = d["grids"]["2027"]

        # Q1 FY26
        q1_sub = df_fiscal[df_fiscal["Fiscal Period"] == "Q1-2026"]
        exp_q1_cnt, exp_q1_acv = q_stats(q1_sub)
        exp_q1_closed_cnt, exp_q1_closed_acv = q_stats(q1_sub[q1_sub["Forecast Category"] == "Closed"])
        exp_q1_commit_cnt, exp_q1_commit_acv = q_stats(q1_sub[q1_sub["Forecast Category"] == "Commit"])
        exp_q1_bc_cnt, exp_q1_bc_acv = q_stats(q1_sub[q1_sub["Forecast Category"] == "Best Case"])
        exp_q1_pipe_cnt, exp_q1_pipe_acv = q_stats(q1_sub[q1_sub["Forecast Category"] == "Pipeline"])

        q1_26 = next(r for r in g26["rows"] if r["quarter"] == "Q1-2026")
        assert q1_26["cells"]["Best Case"]["count"] == exp_q1_bc_cnt
        assert q1_26["cells"]["Closed"]["count"] == exp_q1_closed_cnt
        assert q1_26["cells"]["Commit"]["count"] == exp_q1_commit_cnt
        assert q1_26["cells"]["Pipeline"]["count"] == exp_q1_pipe_cnt
        assert q1_26["total"]["count"] == exp_q1_cnt
        assert q1_26["total"]["acv"] == pytest.approx(exp_q1_acv, abs=0.01)

        # Q4 FY26
        q4_sub = df_fiscal[df_fiscal["Fiscal Period"] == "Q4-2026"]
        exp_q4_cnt, exp_q4_acv = q_stats(q4_sub)
        exp_q4_commit_cnt, exp_q4_commit_acv = q_stats(q4_sub[q4_sub["Forecast Category"] == "Commit"])
        exp_q4_closed_cnt, exp_q4_closed_acv = q_stats(q4_sub[q4_sub["Forecast Category"] == "Closed"])
        exp_q4_bc_cnt, exp_q4_bc_acv = q_stats(q4_sub[q4_sub["Forecast Category"] == "Best Case"])
        exp_q4_pipe_cnt, exp_q4_pipe_acv = q_stats(q4_sub[q4_sub["Forecast Category"] == "Pipeline"])

        q4_26 = next(r for r in g26["rows"] if r["quarter"] == "Q4-2026")
        assert q4_26["cells"]["Best Case"]["count"] == exp_q4_bc_cnt
        assert q4_26["cells"]["Closed"]["count"] == exp_q4_closed_cnt
        assert q4_26["cells"]["Commit"]["count"] == exp_q4_commit_cnt
        assert q4_26["cells"]["Pipeline"]["count"] == exp_q4_pipe_cnt
        assert q4_26["total"]["count"] == exp_q4_cnt
        assert q4_26["total"]["acv"] == pytest.approx(exp_q4_acv, abs=0.01)

        # FY26 and FY27 grand totals
        fy26_sub = df_fiscal[df_fiscal["Fiscal Period"].isin(["Q1-2026", "Q2-2026", "Q3-2026", "Q4-2026"])]
        exp_g26_cnt, exp_g26_acv = q_stats(fy26_sub)
        assert g26["totals"]["grand"]["count"] == exp_g26_cnt
        assert g26["totals"]["grand"]["acv"] == pytest.approx(exp_g26_acv, abs=0.01)

        fy27_sub = df_fiscal[df_fiscal["Fiscal Period"].isin(["Q1-2027", "Q2-2027", "Q3-2027", "Q4-2027"])]
        exp_g27_cnt, exp_g27_acv = q_stats(fy27_sub)
        assert g27["totals"]["grand"]["count"] == exp_g27_cnt
        assert g27["totals"]["grand"]["acv"] == pytest.approx(exp_g27_acv, abs=0.01)

        # Grand total
        exp_grand_cnt = exp_g26_cnt + exp_g27_cnt
        exp_grand_acv = round(exp_g26_acv + exp_g27_acv, 2)
        assert d["grand_total"]["count"] == exp_grand_cnt
        assert d["grand_total"]["acv"] == pytest.approx(exp_grand_acv, abs=0.01)

        # Verify row sums == column sums == grand total
        total_row_count = sum(r["total"]["count"] for r in g26["rows"]) + sum(r["total"]["count"] for r in g27["rows"])
        total_col_count = sum(c["count"] for c in g26["totals"]["category"].values()) + sum(c["count"] for c in g27["totals"]["category"].values())
        assert total_row_count == d["grand_total"]["count"]
        assert total_col_count == d["grand_total"]["count"]

        # Category ACV totals dynamically computed
        for cat in ["Best Case", "Closed", "Commit", "Pipeline"]:
            cat_fy26 = fy26_sub[fy26_sub["Forecast Category"] == cat]
            cat_fy27 = fy27_sub[fy27_sub["Forecast Category"] == cat]
            exp_cat_acv = round(float(cat_fy26["Forecast ACV Amount"].fillna(0).sum()) + float(cat_fy27["Forecast ACV Amount"].fillna(0).sum()), 2)
            actual_cat_acv = round(g26["totals"]["category"][cat]["acv"] + g27["totals"]["category"][cat]["acv"], 2)
            assert actual_cat_acv == pytest.approx(exp_cat_acv, abs=0.01)

        # Last-week deltas present
        assert "lastweek" in d["deltas"]["2026"]

    def test_service_expiry_view(self, client_and_db, oct7_fixture_df):
        res = client_and_db.get("/api/v2/expiry/summary?period_type=service_expiry&exclude_deleted_lost=false")
        assert res.status_code == 200
        d = res.json()
        assert d.get("period_type") == "service_expiry"

        g26 = d["grids"]["2026"]
        q4_26 = next(r for r in g26["rows"] if r["quarter"] == "Q4-2026")
        df_renewals = oct7_fixture_df[oct7_fixture_df["Sales Type"] == "Renewals"]
        exp_se_q4_cnt = len(df_renewals[df_renewals["Service Expiry Period"] == "Q4-2026"])
        assert q4_26["total"]["count"] == exp_se_q4_cnt

    def test_exclude_deleted_lost(self, client_and_db):
        res = client_and_db.get("/api/v2/expiry/summary?exclude_deleted_lost=false")
        d_incl = res.json()

        res = client_and_db.get("/api/v2/expiry/summary?exclude_deleted_lost=true")
        d_excl = res.json()

        assert d_excl["grand_total"]["count"] <= d_incl["grand_total"]["count"]
        assert d_excl["grand_total"]["acv"] <= d_incl["grand_total"]["acv"]

        g26 = d_excl["grids"]["2026"]
        g27 = d_excl["grids"]["2027"]
        total_row_count = sum(r["total"]["count"] for r in g26["rows"]) + sum(r["total"]["count"] for r in g27["rows"])
        total_col_count = sum(c["count"] for c in g26["totals"]["category"].values()) + sum(c["count"] for c in g27["totals"]["category"].values())
        assert total_row_count == d_excl["grand_total"]["count"]
        assert total_col_count == d_excl["grand_total"]["count"]

    def test_time_travel(self, client_and_db):
        res = client_and_db.get("/api/v2/expiry/summary?exclude_deleted_lost=false&as_of=2027-01-05")
        assert res.status_code == 200

    def test_deals(self, client_and_db, oct7_fixture_df):
        res = client_and_db.get("/api/v2/expiry/deals?quarter=Q1-2026&category=Closed&exclude_deleted_lost=false")
        assert res.status_code == 200
        deals = res.json()
        
        df_fiscal = oct7_fixture_df[oct7_fixture_df["Sales Type"] == "Renewals"]
        expected_q1_closed = df_fiscal[(df_fiscal["Fiscal Period"] == "Q1-2026") & (df_fiscal["Forecast Category"] == "Closed")]
        assert len(deals) == len(expected_q1_closed)
        acv = round(sum(d.get("forecast_acv_amount", 0) for d in deals), 2)
        expected_acv = round(float(expected_q1_closed["Forecast ACV Amount"].fillna(0).sum()), 2)
        assert acv == pytest.approx(expected_acv, abs=0.01)

    def test_q4_chart_grid_card_drawer_consistency(self, client_and_db, oct7_fixture_df):
        """
        Verify: on the Expiry page the Q4 chart column, the grid total, the card
        and the drawer count must all show the same total.
        """
        res_sum = client_and_db.get("/api/v2/expiry/summary?period_type=fiscal&exclude_deleted_lost=false")
        assert res_sum.status_code == 200
        sum_data = res_sum.json()

        # 1. Q4 chart column
        chart_cols = sum_data.get("profile_chart", [])
        q4_chart = next(c for c in chart_cols if c["quarter"] == "Q4-2026")
        q4_chart_count = q4_chart["deal_count"]
        q4_chart_acv = q4_chart["total_acv"]

        # 2. Grid total for Q4
        g26 = sum_data["grids"]["2026"]
        q4_grid = next(r for r in g26["rows"] if r["quarter"] == "Q4-2026")
        q4_grid_count = q4_grid["total"]["count"]
        q4_grid_acv = q4_grid["total"]["acv"]

        # 3. Deals drawer endpoint for Q4 (default period_type = fiscal)
        res_deals = client_and_db.get("/api/v2/expiry/deals?quarter=Q4-2026&period_type=fiscal&exclude_deleted_lost=false")
        assert res_deals.status_code == 200
        deals = res_deals.json()
        drawer_count = len(deals)
        drawer_acv = round(sum(d.get("forecast_acv_amount", 0) for d in deals), 2)

        # 4. Check that chart, grid, and drawer all tie to each other
        assert q4_chart_count == q4_grid_count
        assert q4_grid_count == drawer_count
        assert q4_chart_acv == pytest.approx(q4_grid_acv, abs=0.01)
        assert q4_grid_acv == pytest.approx(drawer_acv, abs=0.01)

        # 5. Check against pandas dynamic computation from fixture Excel
        df_fiscal = oct7_fixture_df[oct7_fixture_df["Sales Type"] == "Renewals"]
        expected_q4_df = df_fiscal[df_fiscal["Fiscal Period"] == "Q4-2026"]
        assert q4_chart_count == len(expected_q4_df)
        expected_acv = round(float(expected_q4_df["Forecast ACV Amount"].fillna(0).sum()), 2)
        assert q4_chart_acv == pytest.approx(expected_acv, abs=0.01)