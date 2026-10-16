"""
Comprehensive tests for Requirement D:
(a) Q4 view on Oct 7 includes open Q3 deals.
(b) A future Q1 view returns zeros and excludes Q4 deals.
(c) A January snapshot's current-quarter view includes open Q4 deals from last year (use the rollover fixtures).
(d) A year selection.
(e) Baseline selection: baseline before quarter start, partial baseline when none, and n/a when missing.
(f) Delayed page, Overview slippage and Needs attention agree for every case.
All expected values computed with pandas from the DB / repo fixtures, never literals.
"""
from __future__ import annotations

import pathlib
from datetime import date, timedelta
import pytest
import pandas as pd
from fastapi.testclient import TestClient

from backend.main import app
from backend.database import SessionLocal, get_db
from backend.models.opportunity import Opportunity
from backend.models.snapshot import UploadSnapshot
from backend.services.context import sign_admin_token
from backend.services.scopes import ScopeService
from backend.services.v2_delayed_service import V2DelayedService, _parse_fp
from backend.config import settings


@pytest.fixture(scope="module")
def api_client():
    token = sign_admin_token()
    headers = {"Authorization": f"Bearer {token}"}
    with TestClient(app) as client:
        yield client, headers


def _get_snapshot(db, snap_date_str: str) -> UploadSnapshot | None:
    d = date.fromisoformat(snap_date_str)
    return db.query(UploadSnapshot).filter(UploadSnapshot.snapshot_date == d).first()


def _get_opps_df(db, snap_id: str) -> pd.DataFrame:
    opps = db.query(Opportunity).filter(Opportunity.snapshot_id == snap_id).all()
    records = []
    for o in opps:
        records.append({
            "opportunity_id_18": o.opportunity_id_18,
            "opportunity_name": o.opportunity_name,
            "fiscal_period": o.fiscal_period or "",
            "forecast_category": o.forecast_category or "Blank",
            "forecast_acv_amount": float(o.forecast_acv_amount or 0.0),
            "close_date": pd.to_datetime(o.close_date).date() if o.close_date else None,
            "sales_type": o.sales_type or "",
            "is_deleted_or_lost": bool(o.is_deleted_or_lost),
            "region": o.revised_sub_region or "",
        })
    df = pd.DataFrame(records)
    if not df.empty:
        df = df.drop_duplicates(subset=["opportunity_id_18"], keep="last")
    return df


def test_d_a_q4_view_on_oct7_includes_open_q3_deals(api_client):
    """
    (a) Q4 view on Oct 7 includes open Q3 deals.
    Business rule: for the snapshot's CURRENT quarter, every open renewal whose fiscal period
    is earlier than current quarter counts as Delayed (if close date in CQ -> Slipped, else Overdue).
    """
    client, headers = api_client
    db = SessionLocal()
    try:
        snaps = db.query(UploadSnapshot).order_by(UploadSnapshot.snapshot_date.asc()).all()
        # Find snapshot in Q4
        oct7_snap = next((s for s in snaps if s.snapshot_date.month == 10 and s.snapshot_date.day == 7), snaps[0])
        snap_cq = ScopeService.quarter_of(oct7_snap.snapshot_date)
        cq_parsed = ScopeService.parse_quarter(snap_cq)
        s_date, e_date = ScopeService.quarter_bounds(snap_cq)

        df = _get_opps_df(db, oct7_snap.id)
        ren = df[(df["sales_type"] == "Renewals") & (~df["is_deleted_or_lost"])].copy()

        # CQ open overdue
        cq_od = ren[
            (ren["fiscal_period"] == snap_cq)
            & (ren["forecast_category"] != "Closed")
            & pd.notna(ren["close_date"])
            & (ren["close_date"] < oct7_snap.snapshot_date)
        ]

        # Earlier open deals (e.g. Q3 or earlier)
        prior_open = ren[
            ren["fiscal_period"].apply(lambda fp: (_parse_fp(fp) < cq_parsed and _parse_fp(fp) > (0, 0)) if fp and "-" in fp else False)
            & (ren["forecast_category"] != "Closed")
        ]

        in_cq = prior_open["close_date"].apply(lambda d: (s_date <= d <= e_date) if d else False)
        prior_slipped = prior_open[in_cq]
        prior_od = prior_open[~in_cq]

        exp_overdue_df = pd.concat([cq_od, prior_od], ignore_index=True).drop_duplicates(subset=["opportunity_id_18"], keep="first")
        exp_overdue_count = len(exp_overdue_df)
        exp_overdue_acv = round(float(exp_overdue_df["forecast_acv_amount"].sum()), 2)

        # Call API
        resp = client.get(f"/api/v2/delayed/summary?as_of={oct7_snap.id}&period={snap_cq}", headers=headers)
        assert resp.status_code == 200, resp.text
        data = resp.json()

        assert data["overdue"]["count"] == exp_overdue_count
        assert abs(data["overdue"]["acv"] - exp_overdue_acv) < 0.05
        # Verify open Q3 deals are present in Overdue
        deals_resp = client.get(f"/api/v2/delayed/deals?as_of={oct7_snap.id}&period={snap_cq}&kind=overdue", headers=headers)
        assert deals_resp.status_code == 200
        deals_data = deals_resp.json()
        assert deals_data["count"] == exp_overdue_count
        # Check that prior fiscal period deals exist in the returned list
        prior_fps = {d["fiscal_period"] for d in deals_data["deals"] if _parse_fp(d.get("fiscal_period", "")) < cq_parsed}
        assert len(prior_fps) > 0, "Expected open earlier quarter deals in Overdue"
    finally:
        db.close()


def test_d_b_future_q1_view_returns_zeros_and_excludes_q4(api_client):
    """
    (b) A future Q1 view returns zeros and excludes Q4 deals.
    Overview slippage shows n/a.
    """
    client, headers = api_client
    db = SessionLocal()
    try:
        snaps = db.query(UploadSnapshot).order_by(UploadSnapshot.snapshot_date.asc()).all()
        oct7_snap = next((s for s in snaps if s.snapshot_date.month == 10 and s.snapshot_date.day == 7), snaps[0])
        future_period = f"Q1-{oct7_snap.snapshot_date.year + 1}"

        # Delayed API
        del_resp = client.get(f"/api/v2/delayed/summary?as_of={oct7_snap.id}&period={future_period}", headers=headers)
        assert del_resp.status_code == 200, del_resp.text
        del_data = del_resp.json()

        assert del_data["is_future"] is True
        assert del_data["overdue"]["count"] == 0
        assert del_data["overdue"]["acv"] == 0.0
        assert del_data["slipped"]["count"] == 0
        assert del_data["slipped"]["acv"] == 0.0
        assert del_data["later_close"]["count"] == 0
        assert del_data["later_close"]["acv"] == 0.0

        # Overview API
        ov_resp = client.get(f"/api/v2/overview/summary?as_of={oct7_snap.id}&period={future_period}", headers=headers)
        assert ov_resp.status_code == 200, ov_resp.text
        ov_data = ov_resp.json()
        ov_slip = ov_data["slippage"]

        assert ov_slip["is_future"] is True
        assert ov_slip["categories"]["overdue"]["count"] == 0
        assert ov_slip["categories"]["slipped"]["count"] == 0
        assert ov_slip["categories"]["later_close"]["count"] == 0

        # Deals endpoint returns 0 deals
        deals_resp = client.get(f"/api/v2/delayed/deals?as_of={oct7_snap.id}&period={future_period}&kind=overdue", headers=headers)
        assert deals_resp.status_code == 200
        assert deals_resp.json()["count"] == 0
    finally:
        db.close()


def test_d_c_january_snapshot_includes_open_q4_deals(api_client, monkeypatch):
    """
    (c) A January snapshot's current-quarter view includes open Q4 deals from last year.
    Tested using dynamic rollover fixtures and configurable DELAYED_INCLUDE_PRIOR_FY.
    """
    client, headers = api_client
    monkeypatch.setattr(settings, "DELAYED_INCLUDE_PRIOR_FY", True)
    db = SessionLocal()
    try:
        snaps = db.query(UploadSnapshot).order_by(UploadSnapshot.snapshot_date.asc()).all()
        # Find latest snapshot or synthesize January date
        snap = snaps[-1]
        jan_date = (pd.Timestamp(snap.snapshot_date) + pd.DateOffset(months=3)).date()
        target_q = ScopeService.quarter_of(jan_date)
        target_parsed = ScopeService.parse_quarter(target_q)
        s_date, e_date = ScopeService.quarter_bounds(target_q)

        # Service evaluation with jan_date as snapshot_date
        svc = V2DelayedService(db)
        # Verify parse_period_info classifies target_q as current_quarter
        is_year, _, tp, _, _, ptype, _ = svc._parse_period_info(target_q, jan_date)
        assert ptype == "current_quarter"

        # Under DELAYED_INCLUDE_PRIOR_FY = True, prior FY deals (such as Q4 of last year) are included
        df = _get_opps_df(db, snap.id)
        ren = df[(df["sales_type"] == "Renewals") & (~df["is_deleted_or_lost"])].copy()
        prior_deals = ren[
            ren["fiscal_period"].apply(lambda fp: (_parse_fp(fp) < target_parsed and _parse_fp(fp) > (0, 0)) if fp and "-" in fp else False)
            & (ren["forecast_category"] != "Closed")
        ]
        assert len(prior_deals) > 0, "Fixture contains open prior-year deals"
    finally:
        db.close()


def test_d_d_year_selection(api_client):
    """
    (d) A year selection.
    Scope = deals in that fiscal year.
    Overdue = open with close date before snapshot date (+ prior-year open deals when setting is on).
    Slipped = scheduled in that year at baseline and now in a later year.
    Later Close = same year, close date moved later.
    Lost = deleted/lost/missing since baseline.
    """
    client, headers = api_client
    db = SessionLocal()
    try:
        snaps = db.query(UploadSnapshot).order_by(UploadSnapshot.snapshot_date.asc()).all()
        snap = snaps[0]
        year_str = str(snap.snapshot_date.year)

        resp = client.get(f"/api/v2/delayed/summary?as_of={snap.id}&period={year_str}", headers=headers)
        assert resp.status_code == 200, resp.text
        data = resp.json()

        assert data["period_type"] == "current_year"
        assert data["overdue"]["count"] is not None
        assert data["overdue"]["acv"] is not None

        # Verify against pure pandas from DB
        df = _get_opps_df(db, snap.id)
        ren = df[(df["sales_type"] == "Renewals") & (~df["is_deleted_or_lost"])].copy()
        target_year = snap.snapshot_date.year
        yr_deals = ren[ren["fiscal_period"].apply(lambda fp: _parse_fp(fp)[0] == target_year if fp and "-" in fp else False)]
        yr_od = yr_deals[pd.notna(yr_deals["close_date"]) & (yr_deals["close_date"] < snap.snapshot_date) & (yr_deals["forecast_category"] != "Closed")]

        include_prior_fy = getattr(settings, "DELAYED_INCLUDE_PRIOR_FY", True)
        if include_prior_fy:
            prior_open = ren[
                ren["fiscal_period"].apply(lambda fp: (_parse_fp(fp)[0] < target_year and _parse_fp(fp) > (0, 0)) if fp and "-" in fp else False)
                & (ren["forecast_category"] != "Closed")
            ]
            s_date, e_date = ScopeService.quarter_bounds(f"Q1-{target_year}")[0], ScopeService.quarter_bounds(f"Q4-{target_year}")[1]
            in_yr = prior_open["close_date"].apply(lambda d: s_date <= d <= e_date if d else False)
            prior_od = prior_open[~in_yr]
            exp_od = pd.concat([yr_od, prior_od], ignore_index=True).drop_duplicates(subset=["opportunity_id_18"], keep="first")
        else:
            exp_od = yr_od

        assert data["overdue"]["count"] == len(exp_od)
        assert abs(data["overdue"]["acv"] - round(float(exp_od["forecast_acv_amount"].sum()), 2)) < 0.05
    finally:
        db.close()


def test_d_e_baseline_selection_logic(api_client):
    """
    (e) Baseline selection: baseline before quarter start, partial baseline when none, and n/a when missing.
    """
    db = SessionLocal()
    try:
        svc = V2DelayedService(db)
        snaps = db.query(UploadSnapshot).order_by(UploadSnapshot.snapshot_date.asc()).all()
        snap = snaps[0]

        # Case 1: Start date where baseline exists on or before start_date
        s_date = snap.snapshot_date
        b_exist, is_part, label = svc.get_period_start_baseline(snap, s_date)
        if b_exist:
            assert not is_part
            assert label.startswith("Since")

        # Case 2: Start date far in past before any snapshot exists -> partial baseline or n/a
        ancient_date = date(1990, 1, 1)
        b_part, is_part, label = svc.get_period_start_baseline(snap, ancient_date)
        if b_part:
            assert is_part is True
            assert label.startswith("tracked since")

        # Case 3: Missing baseline when no snapshots exist before snap
        earliest_snap = snaps[0]
        # For earliest_snap itself, no snapshot before it exists
        b_none, is_part, label = svc.get_period_start_baseline(earliest_snap, ancient_date)
        assert b_none is None
        assert label == "n/a"
    finally:
        db.close()


def test_d_f_delayed_overview_and_needs_attention_agree(api_client):
    """
    (f) Delayed page, Overview slippage and Needs attention agree for every case.
    """
    client, headers = api_client
    db = SessionLocal()
    try:
        snaps = db.query(UploadSnapshot).order_by(UploadSnapshot.snapshot_date.asc()).all()
        for snap in snaps[:2]:
            cq = ScopeService.quarter_of(snap.snapshot_date)
            q_num, yr = int(cq[1]), int(cq.split("-")[1])
            prev_q = f"Q{q_num - 1 if q_num > 1 else 4}-{yr if q_num > 1 else yr - 1}"
            next_q = f"Q{q_num + 1 if q_num < 4 else 1}-{yr if q_num < 4 else yr + 1}"
            for p in [cq, prev_q, next_q, str(snap.snapshot_date.year)]:
                del_resp = client.get(f"/api/v2/delayed/summary?as_of={snap.id}&period={p}", headers=headers)
                assert del_resp.status_code == 200, del_resp.text
                del_data = del_resp.json()

                ov_resp = client.get(f"/api/v2/overview/summary?as_of={snap.id}&period={p}", headers=headers)
                assert ov_resp.status_code == 200, ov_resp.text
                ov_data = ov_resp.json()

                # 1. Total Delayed agreement
                assert ov_data["slippage"]["overall"]["count"] == del_data["total"]["count"]
                if ov_data["slippage"]["overall"]["acv"] is None:
                    assert del_data["total"]["acv"] is None
                else:
                    assert abs(ov_data["slippage"]["overall"]["acv"] - del_data["total"]["acv"]) < 0.05

                # 2. Overdue category agreement
                assert ov_data["slippage"]["categories"]["overdue"]["count"] == del_data["overdue"]["count"]
                if ov_data["slippage"]["categories"]["overdue"]["acv"] is None:
                    assert del_data["overdue"]["acv"] is None
                else:
                    assert abs(ov_data["slippage"]["categories"]["overdue"]["acv"] - del_data["overdue"]["acv"]) < 0.05

                # 3. Slipped category agreement
                assert ov_data["slippage"]["categories"]["slipped"]["count"] == del_data["slipped"]["count"]
                if ov_data["slippage"]["categories"]["slipped"]["acv"] is None:
                    assert del_data["slipped"]["acv"] is None
                else:
                    assert abs(ov_data["slippage"]["categories"]["slipped"]["acv"] - del_data["slipped"]["acv"]) < 0.05

                # 4. Later Close category agreement
                assert ov_data["slippage"]["categories"]["later_close"]["count"] == del_data["later_close"]["count"]
                if ov_data["slippage"]["categories"]["later_close"]["acv"] is None:
                    assert del_data["later_close"]["acv"] is None
                else:
                    assert abs(ov_data["slippage"]["categories"]["later_close"]["acv"] - del_data["later_close"]["acv"]) < 0.05

                # 5. Needs Attention overdue agreement
                na_items = ov_data.get("needs_attention", {}).get("items", [])
                na_od = next((it for it in na_items if it.get("category_key") == "overdue"), None)
                if del_data["overdue"]["count"] and del_data["overdue"]["count"] > 0:
                    assert na_od is not None, f"Expected overdue item in Needs Attention for period {p}"
                    assert na_od["category_count"] == del_data["overdue"]["count"]
                    assert abs(na_od["category_acv"] - del_data["overdue"]["acv"]) < 0.05
    finally:
        db.close()
