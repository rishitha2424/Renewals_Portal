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

def test_v2_approvals_oct7(client_and_db):
    import pandas as pd
    import pathlib
    fixture_path = pathlib.Path("data/sample_oct7/Renewal Comparison Tool.xlsx")
    df = pd.read_excel(fixture_path, sheet_name="today")
    df_q4 = df[(df["Sales Type"] == "Renewals") & (df["Fiscal Period"] == "Q4-2026")]

    expected_total_count = len(df_q4)
    expected_total_acv = float(df_q4["Forecast ACV Amount"].fillna(0).sum())

    res = client_and_db.get("/api/v2/approvals/distribution?as_of=2026-10-07&exclude_deleted_lost=false")
    assert res.status_code == 200
    d = res.json()
    assert "error" not in d
    
    assert d["total"]["count"] == expected_total_count
    assert d["total"]["acv"] == pytest.approx(expected_total_acv, abs=0.01)
    
    stats = {s["status"]: s for s in d["statuses"]}
    assert "Blank" in stats
    blank_appr = df_q4[df_q4["Approval Status"].isna() | (df_q4["Approval Status"] == "Blank") | (df_q4["Approval Status"] == "")]
    expected_blank_count = len(blank_appr)
    expected_blank_acv = float(blank_appr["Forecast ACV Amount"].fillna(0).sum())
    assert stats["Blank"]["count"] == expected_blank_count
    assert stats["Blank"]["acv"] == pytest.approx(expected_blank_acv, abs=0.01)
    
    assert "Approved" in stats
    appr_df = df_q4[df_q4["Approval Status"] == "Approved"]
    expected_appr_count = len(appr_df)
    expected_appr_acv = float(appr_df["Forecast ACV Amount"].fillna(0).sum())
    assert stats["Approved"]["count"] == expected_appr_count
    assert stats["Approved"]["acv"] == pytest.approx(expected_appr_acv, abs=0.01)

    assert "Pending Approval" in stats
    pending_df = df_q4[df_q4["Approval Status"].isin(["Pending Approval", "Pending", "Submitted", "In Approval"])]
    expected_pending_count = len(pending_df)
    expected_pending_acv = float(pending_df["Forecast ACV Amount"].fillna(0).sum())
    assert stats["Pending Approval"]["count"] == expected_pending_count
    assert stats["Pending Approval"]["acv"] == pytest.approx(expected_pending_acv, abs=0.01)

    mat = d["matrix"]
    assert mat["Approved"]["Best Case"]["count"] == len(appr_df[appr_df["Forecast Category"] == "Best Case"])
    assert mat["Approved"]["Commit"]["count"] == len(appr_df[appr_df["Forecast Category"] == "Commit"])
    assert mat["Pending Approval"]["Best Case"]["count"] == len(pending_df[pending_df["Forecast Category"] == "Best Case"])
    assert mat["Pending Approval"]["Commit"]["count"] == len(pending_df[pending_df["Forecast Category"] == "Commit"])
    assert mat["Blank"]["Best Case"]["count"] == len(blank_appr[blank_appr["Forecast Category"] == "Best Case"])
    assert mat["Blank"]["Blank"]["count"] == len(blank_appr[~blank_appr["Forecast Category"].isin(["Best Case", "Commit", "Pipeline", "Closed"])])
    assert mat["Blank"]["Commit"]["count"] == len(blank_appr[blank_appr["Forecast Category"] == "Commit"])
    assert mat["Blank"]["Pipeline"]["count"] == len(blank_appr[blank_appr["Forecast Category"] == "Pipeline"])
    
    # Tests for get_deals
    def check_deals(qs, count, acv):
        res = client_and_db.get(f"/api/v2/approvals/deals?as_of=2026-10-07&exclude_deleted_lost=false{qs}")
        d = res.json()
        assert d["count"] == count
        assert round(d["acv"], 2) == round(acv, 2)
        assert len(d["deals"]) == count

    check_deals("&status=Blank&category=Commit", len(blank_appr[blank_appr["Forecast Category"] == "Commit"]), float(blank_appr[blank_appr["Forecast Category"] == "Commit"]["Forecast ACV Amount"].fillna(0).sum()))
    check_deals("&status=Blank&category=Blank", len(blank_appr[~blank_appr["Forecast Category"].isin(["Best Case", "Commit", "Pipeline", "Closed"])]), float(blank_appr[~blank_appr["Forecast Category"].isin(["Best Case", "Commit", "Pipeline", "Closed"])]["Forecast ACV Amount"].fillna(0).sum()))
    check_deals("&status=Approved", expected_appr_count, expected_appr_acv)
    check_deals("&status=Approved&category=Best Case", len(appr_df[appr_df["Forecast Category"] == "Best Case"]), float(appr_df[appr_df["Forecast Category"] == "Best Case"]["Forecast ACV Amount"].fillna(0).sum()))
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
