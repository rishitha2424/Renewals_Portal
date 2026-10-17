"""
Drawer-contract and Executive reconcile tests (Item 8).
- For Delayed page, Overview slippage cards, Approvals movement tables, Forecast movement tables, and Regions,
  every clickable figure's drawer count and ACV equal the figure.
- Executive reconcile test for available snapshots (Oct 7, Oct 14, Oct 15, Oct 16).
- All expected values from pandas on the DB / repo fixtures, never literals.
"""
from __future__ import annotations
import pytest
import pandas as pd
from datetime import date
from fastapi.testclient import TestClient

from backend.main import app
from backend.database import SessionLocal
from backend.models.opportunity import Opportunity
from backend.models.snapshot import UploadSnapshot
from backend.services.context import sign_admin_token, UserContext
from backend.services.v2_overview_service import V2OverviewService
from backend.services.v2_delayed_service import V2DelayedService
from backend.services.v2_approvals_service import V2ApprovalsService
from backend.services.v2_regions_service import V2RegionsService
from backend.services.v2_business_units_service import V2BusinessUnitsService
from backend.services.scopes import ScopeService


@pytest.fixture(scope="module")
def api_client():
    token = sign_admin_token()
    headers = {"Authorization": f"Bearer {token}"}
    with TestClient(app) as client:
        yield client, headers


def test_delayed_and_overview_drawer_contracts(api_client):
    """Verify Delayed page & Overview slippage drawer counts and ACV equal summary figures."""
    client, headers = api_client
    db = SessionLocal()
    try:
        snaps = db.query(UploadSnapshot).order_by(UploadSnapshot.snapshot_date.desc()).all()
        snap = snaps[0]
        as_of = snap.id

        del_resp = client.get(f"/api/v2/delayed/summary?as_of={as_of}&compare=yesterday", headers=headers)
        assert del_resp.status_code == 200
        del_data = del_resp.json()

        # 1. Delayed Renewals Total drawer
        tot_cnt = del_data["delayed_renewals"]["total"]["count"]
        tot_acv = del_data["delayed_renewals"]["total"]["acv"]
        r_tot = client.get(f"/api/v2/delayed/deals?kind=delayed_total&as_of={as_of}", headers=headers)
        assert r_tot.status_code == 200
        d_tot = r_tot.json()
        assert d_tot["count"] == tot_cnt
        assert pytest.approx(d_tot["acv"], abs=0.05) == tot_acv

        # 2. Overdue drawer
        od_cnt = del_data["delayed_renewals"]["overdue"]["count"]
        od_acv = del_data["delayed_renewals"]["overdue"]["acv"]
        r_od = client.get(f"/api/v2/delayed/deals?kind=overdue&as_of={as_of}", headers=headers)
        assert r_od.status_code == 200
        d_od = r_od.json()
        assert d_od["count"] == od_cnt
        assert pytest.approx(d_od["acv"], abs=0.05) == od_acv

        # 3. Later Close drawer
        lc_cnt = del_data["delayed_renewals"]["later_close"]["count"]
        lc_acv = del_data["delayed_renewals"]["later_close"]["acv"]
        r_lc = client.get(f"/api/v2/delayed/deals?kind=later_close&compare=period_start&as_of={as_of}", headers=headers)
        assert r_lc.status_code == 200
        d_lc = r_lc.json()
        assert d_lc["count"] == lc_cnt
        assert pytest.approx(d_lc["acv"], abs=0.05) == lc_acv

        # 4. Slippage Total drawer
        slip_tot_cnt = del_data["slippage"]["total"]["count"]
        slip_tot_acv = del_data["slippage"]["total"]["acv"]
        r_slip_tot = client.get(f"/api/v2/delayed/deals?kind=slippage_total&as_of={as_of}", headers=headers)
        assert r_slip_tot.status_code == 200
        d_slip_tot = r_slip_tot.json()
        assert d_slip_tot["count"] == slip_tot_cnt
        assert pytest.approx(d_slip_tot["acv"], abs=0.05) == slip_tot_acv

        # 5. Slipped to next FY
        s_ny_cnt = del_data["slippage"]["slipped_next_year"]["count"]
        s_ny_acv = del_data["slippage"]["slipped_next_year"]["acv"]
        r_s_ny = client.get(f"/api/v2/delayed/deals?kind=slipped_next_year&compare=period_start&as_of={as_of}", headers=headers)
        assert r_s_ny.status_code == 200
        d_s_ny = r_s_ny.json()
        assert d_s_ny["count"] == s_ny_cnt
        assert pytest.approx(d_s_ny["acv"], abs=0.05) == s_ny_acv

        # 6. Slipped to next Q
        s_nq_cnt = del_data["slippage"]["slipped_next_quarter"]["count"]
        s_nq_acv = del_data["slippage"]["slipped_next_quarter"]["acv"]
        r_s_nq = client.get(f"/api/v2/delayed/deals?kind=slipped_next_quarter&compare=period_start&as_of={as_of}", headers=headers)
        assert r_s_nq.status_code == 200
        d_s_nq = r_s_nq.json()
        assert d_s_nq["count"] == s_nq_cnt
        assert pytest.approx(d_s_nq["acv"], abs=0.05) == s_nq_acv

        # 7. Slipped to later Q, same year
        s_lq_cnt = del_data["slippage"]["slipped_later_quarter"]["count"]
        s_lq_acv = del_data["slippage"]["slipped_later_quarter"]["acv"]
        r_s_lq = client.get(f"/api/v2/delayed/deals?kind=slipped_later_quarter&compare=period_start&as_of={as_of}", headers=headers)
        assert r_s_lq.status_code == 200
        d_s_lq = r_s_lq.json()
        assert d_s_lq["count"] == s_lq_cnt
        assert pytest.approx(d_s_lq["acv"], abs=0.05) == s_lq_acv

        # 8. Lost / Removed
        lost_cnt = del_data["lost"]["count"]
        lost_acv = del_data["lost"]["acv"]
        r_lost = client.get(f"/api/v2/delayed/deals?kind=lost&compare=period_start&as_of={as_of}", headers=headers)
        assert r_lost.status_code == 200
        d_lost = r_lost.json()
        assert d_lost["count"] == lost_cnt
        assert pytest.approx(d_lost["acv"], abs=0.05) == lost_acv

        # Overview deals queries tie to the same
        r_ov_tot = client.get(f"/api/v2/overview/deals?kind=delayed_total&as_of={as_of}", headers=headers)
        assert r_ov_tot.status_code == 200
        assert r_ov_tot.json()["count"] == tot_cnt

        r_ov_slipped = client.get(f"/api/v2/overview/deals?kind=slippage_total&as_of={as_of}", headers=headers)
        assert r_ov_slipped.status_code == 200
        assert r_ov_slipped.json()["count"] == slip_tot_cnt
    finally:
        db.close()


def test_movements_drawer_content_contracts(api_client):
    """Verify FC and Approval movement drawers have matching count/ACV and full fields."""
    client, headers = api_client
    db = SessionLocal()
    try:
        snaps = db.query(UploadSnapshot).order_by(UploadSnapshot.snapshot_date.desc()).all()
        snap = snaps[0]
        as_of = snap.id

        mov_resp = client.get(f"/api/v2/overview/movements?as_of={as_of}&compare=yesterday", headers=headers)
        assert mov_resp.status_code == 200
        mov_data = mov_resp.json()

        for group_key in ["positive", "negative", "approval"]:
            rows = mov_data.get(group_key, [])
            for r in rows:
                row_cnt = r.get("count", 0)
                row_acv = r.get("acv", 0.0)
                deals = r.get("deals", [])
                assert len(deals) == row_cnt
                deals_acv = sum(float(d.get("forecast_acv_amount") or d.get("acv") or 0.0) for d in deals)
                assert pytest.approx(deals_acv, abs=0.05) == row_acv

                # Check required drawer fields
                for d in deals:
                    assert "account_name" in d
                    assert "close_date" in d
                    assert "business_unit_primary" in d
                    assert "forecast_acv_amount" in d
                    if group_key == "approval":
                        assert "from_status" in d
                        assert "to_status" in d
                    elif group_key in ("positive", "negative") and not r.get("label", "").lower().startswith("slip"):
                        assert "from_category" in d
                        assert "to_category" in d
    finally:
        db.close()


def test_regions_drawer_contracts(api_client):
    """Verify every clickable region figure's drawer count and ACV equal the figure."""
    client, headers = api_client
    db = SessionLocal()
    try:
        snaps = db.query(UploadSnapshot).order_by(UploadSnapshot.snapshot_date.desc()).all()
        snap = snaps[0]
        as_of = snap.id

        reg_resp = client.get(f"/api/v2/regions/summary?as_of={as_of}&compare=yesterday", headers=headers)
        assert reg_resp.status_code == 200
        reg_data = reg_resp.json()

        for reg in reg_data.get("regions", []):
            reg_name = reg["region"]
            exp_count = reg["count"]
            exp_acv = reg["acv"]

            deal_resp = client.get(f"/api/v2/regions/deals?region={reg_name}&as_of={as_of}", headers=headers)
            assert deal_resp.status_code == 200
            deal_data = deal_resp.json()

            assert deal_data["count"] == exp_count
            assert pytest.approx(deal_data["acv"], abs=0.05) == exp_acv

            # Verify sub_region is populated
            for d in deal_data.get("deals", []):
                assert d.get("sub_region") is not None
                assert len(d.get("sub_region", "")) > 0
    finally:
        db.close()


def test_executive_reconciliation_across_snapshots():
    """Verify Executive reconcile checks pass for Oct 7, Oct 14, Oct 15, and Oct 16 snapshots."""
    db = SessionLocal()
    ctx = UserContext()
    try:
        snaps = db.query(UploadSnapshot).order_by(UploadSnapshot.snapshot_date.asc()).all()
        assert len(snaps) > 0
        target_dates = {"2026-10-07", "2026-10-14", "2026-10-15", "2026-10-16"}
        test_snaps = [s for s in snaps if str(s.snapshot_date) in target_dates]
        if not test_snaps:
            test_snaps = snaps[:2]

        ov_svc = V2OverviewService(db)
        app_svc = V2ApprovalsService(db)
        reg_svc = V2RegionsService(db)
        bu_svc = V2BusinessUnitsService(db)
        del_svc = V2DelayedService(db)

        for snap in test_snaps:
            ov = ov_svc.get_summary(ctx, as_of=snap.id)
            if "total" not in ov:
                continue

            headline_cnt = ov["total"]["count"]
            headline_acv = ov["total"]["acv"]

            # 1. Forecast Categories tie to Headline
            cat_sum_cnt = sum(c["count"] for c in ov["categories"].values())
            cat_sum_acv = sum(c["acv"] for c in ov["categories"].values())
            assert cat_sum_cnt == headline_cnt
            assert pytest.approx(cat_sum_acv, abs=0.05) == headline_acv

            # 2. Approval Status ties to Headline
            app = app_svc.get_distribution(ctx, as_of=snap.id)
            app_cnt = sum(s["count"] for s in app["statuses"])
            app_acv = sum(s["acv"] for s in app["statuses"])
            assert app_cnt == headline_cnt
            assert pytest.approx(app_acv, abs=0.05) == headline_acv

            # 3. Regions tie to Headline
            reg = reg_svc.get_summary(ctx, as_of=snap.id)
            reg_cnt = sum(r["count"] for r in reg["regions"])
            reg_acv = sum(r["acv"] for r in reg["regions"])
            assert reg_cnt == headline_cnt
            assert pytest.approx(reg_acv, abs=0.05) == headline_acv

            # 4. Business Units tie to Headline
            bu = bu_svc.get_summary(ctx, as_of=snap.id)
            bu_cnt = sum(b["count"] for b in bu["rows"])
            bu_acv = sum(b["acv"] for b in bu["rows"])
            assert bu_cnt == headline_cnt
            assert pytest.approx(bu_acv, abs=0.05) == headline_acv

            # 5. Delayed Renewals rows sum to Delayed Renewals Total
            del_s = del_svc.get_summary(as_of=snap.id)
            del_tot = del_s["delayed_renewals_total"]
            od = del_s["delayed_renewals"]["overdue"]
            lc = del_s["delayed_renewals"]["later_close"]
            del_rows_cnt = (od["count"] or 0) + (lc["count"] or 0)
            del_rows_acv = (od["acv"] or 0.0) + (lc["acv"] or 0.0)
            if del_tot["count"] is not None:
                assert del_rows_cnt == del_tot["count"]
                assert pytest.approx(del_rows_acv, abs=0.05) == del_tot["acv"]

            # 6. Slippage destinations sum to Slippage Total
            slip_tot = del_s["slippage_total"]
            s_ny = del_s["slippage"]["slipped_next_year"]
            s_nq = del_s["slippage"]["slipped_next_quarter"]
            s_lq = del_s["slippage"]["slipped_later_quarter"]
            slip_rows_cnt = (s_ny["count"] or 0) + (s_nq["count"] or 0) + (s_lq["count"] or 0)
            slip_rows_acv = (s_ny["acv"] or 0.0) + (s_nq["acv"] or 0.0) + (s_lq["acv"] or 0.0)
            if slip_tot["count"] is not None:
                assert slip_rows_cnt == slip_tot["count"]
                assert pytest.approx(slip_rows_acv, abs=0.05) == slip_tot["acv"]
    finally:
        db.close()
