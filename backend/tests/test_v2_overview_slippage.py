"""
Test for Overview Slippage section and reconciliation with Delayed tab.
Asserts:
1. Overview slippage totals tie directly to /api/v2/delayed/summary for the same snapshot and period.
2. Trends (vs yesterday and vs last week) are present for current (Q4-2026), previous (Q3-2026), and next (Q1-2027) quarters.
3. Handled gracefully when a period has no slipped deals ($0 and 0, no NaN).
4. Slipped / Delayed deal drawers return matching count and ACV.
"""
import math
import pathlib
import pytest

SAMPLE = pathlib.Path("data/sample_oct7")
pytestmark = pytest.mark.skipif(not SAMPLE.exists(), reason="real sample files not present")


@pytest.fixture(scope="module")
def client_and_db(tmp_path_factory):
    import os
    from fastapi.testclient import TestClient
    from backend.database import get_db
    from backend.main import app
    from backend.tests.test_db_helper import get_test_engine_and_session

    engine, Session = get_test_engine_and_session("test_v2_overview_slippage", tmp_path_factory)

    def override_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_db

    from backend.utils.excel_parser import detect_file_slot
    sample = pathlib.Path("data/sample_oct7")
    slots = {}
    for fp in sorted(sample.glob("*.xlsx")):
        slots[detect_file_slot(fp)[0]] = fp

    from backend.services.context import sign_admin_token
    token = sign_admin_token()
    headers = {"Authorization": f"Bearer {token}"}

    with TestClient(app) as client:
        files = [(slot, (fp.name, open(fp, "rb"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
                 for slot, fp in slots.items()]
        data = {"data_as_of_date": "2026-10-07", "yesterday_date": "2026-10-06"}
        vr = client.post("/api/snapshots/validate", data=data, files=files, headers=headers)
        assert vr.status_code == 200, vr.text
        session_id = vr.json()["session_id"]

        cr = client.post("/api/snapshots/commit", json={"session_id": session_id, "replace": False}, headers=headers)
        assert cr.status_code == 200, cr.text

        yield client, Session

    app.dependency_overrides.clear()


@pytest.mark.parametrize("period", ["Q4-2026", "Q3-2026", "Q1-2027"])
def test_overview_slippage_ties_to_delayed_page(client_and_db, period):
    client, _ = client_and_db

    # 1. Fetch Overview summary
    ov_resp = client.get(f"/api/v2/overview/summary?period={period}")
    assert ov_resp.status_code == 200, ov_resp.text
    ov_data = ov_resp.json()
    assert "slippage" in ov_data, "slippage block missing from overview summary"
    ov_slip = ov_data["slippage"]

    # 2. Fetch Delayed summary for same period
    del_resp = client.get(f"/api/v2/delayed/summary?period={period}")
    assert del_resp.status_code == 200, del_resp.text
    del_data = del_resp.json()

    # Rule caption must match
    assert ov_slip["rule_text"] == del_data["rule_text"]

    # Overall totals must tie exactly
    ov_overall = ov_slip["overall"]
    del_total = del_data["total"]
    assert ov_overall["count"] == del_total["count"]
    assert pytest.approx(ov_overall["acv"], abs=0.02) == del_total["acv"]

    # Category totals must tie exactly
    ov_cats = ov_slip["categories"]
    assert "slipped" in ov_cats and "overdue" in ov_cats and "later_close" in ov_cats

    assert ov_cats["slipped"]["count"] == del_data["slipped"]["count"]
    assert pytest.approx(ov_cats["slipped"]["acv"], abs=0.02) == del_data["slipped"]["acv"]

    assert ov_cats["overdue"]["count"] == del_data["overdue"]["count"]
    assert pytest.approx(ov_cats["overdue"]["acv"], abs=0.02) == del_data["overdue"]["acv"]

    assert ov_cats["later_close"]["count"] == del_data["later_close"]["count"]
    assert pytest.approx(ov_cats["later_close"]["acv"], abs=0.02) == del_data["later_close"]["acv"]

    # 3. Assert trends (vs yesterday and vs last week) are present
    for cat_key in ("slipped", "overdue", "later_close"):
        cat_info = ov_cats[cat_key]
        assert "delta_yesterday" in cat_info
        assert "delta_lastweek" in cat_info
        assert "count" in cat_info["delta_yesterday"]
        assert "acv" in cat_info["delta_yesterday"]
        assert "count" in cat_info["delta_lastweek"]
        assert "acv" in cat_info["delta_lastweek"]

        # Ensure no NaN
        assert not math.isnan(cat_info["acv"])
        assert not math.isnan(cat_info["delta_yesterday"]["acv"])
        assert not math.isnan(cat_info["delta_lastweek"]["acv"])


def test_overview_slippage_drawers(client_and_db):
    client, _ = client_and_db

    ov_resp = client.get("/api/v2/overview/summary?period=Q4-2026")
    ov_slip = ov_resp.json()["slippage"]

    # 1. Overall delayed deals drawer
    r_all = client.get("/api/v2/overview/deals?kind=delayed_all&period=Q4-2026")
    assert r_all.status_code == 200
    d_all = r_all.json()
    assert d_all["count"] == ov_slip["overall"]["count"]
    assert pytest.approx(d_all["acv"], abs=0.02) == ov_slip["overall"]["acv"]

    # 2. Slipped deals drawer
    r_slipped = client.get("/api/v2/overview/deals?kind=delayed_slipped&period=Q4-2026")
    assert r_slipped.status_code == 200
    d_slipped = r_slipped.json()
    assert d_slipped["count"] == ov_slip["categories"]["slipped"]["count"]
    assert pytest.approx(d_slipped["acv"], abs=0.02) == ov_slip["categories"]["slipped"]["acv"]

    # 3. Overdue deals drawer
    r_overdue = client.get("/api/v2/overview/deals?kind=delayed_overdue&period=Q4-2026")
    assert r_overdue.status_code == 200
    d_overdue = r_overdue.json()
    assert d_overdue["count"] == ov_slip["categories"]["overdue"]["count"]
    assert pytest.approx(d_overdue["acv"], abs=0.02) == ov_slip["categories"]["overdue"]["acv"]

    # 4. Later close deals drawer
    r_later = client.get("/api/v2/overview/deals?kind=delayed_later_close&period=Q4-2026")
    assert r_later.status_code == 200
    d_later = r_later.json()
    assert d_later["count"] == ov_slip["categories"]["later_close"]["count"]
    assert pytest.approx(d_later["acv"], abs=0.02) == ov_slip["categories"]["later_close"]["acv"]
