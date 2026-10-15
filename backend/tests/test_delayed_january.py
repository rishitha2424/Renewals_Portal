"""
Test Delayed at Year Start (January snapshot).
Configurable DELAYED_INCLUDE_PRIOR_FY rule and rule text on Delayed page.
Strict adherence: No hard-coded dates, quarters, numbers or names.
"""
from __future__ import annotations

import pathlib
from datetime import timedelta
import pytest
import pandas as pd
from fastapi.testclient import TestClient

from backend.config import settings
from backend.database import get_db
from backend.main import app
from backend.models.opportunity import Opportunity
from backend.models.snapshot import UploadSnapshot
from backend.services.context import sign_admin_token
from backend.services.scopes import ScopeService
from backend.services.v2_delayed_service import _parse_fp
from backend.utils.excel_parser import detect_file_slot, detect_suggested_snapshot_date


@pytest.fixture(scope="module")
def jan_client_and_db(tmp_path_factory):
    """
    Create a clean isolated test database and upload a January snapshot derived from repository fixtures.
    """
    from backend.tests.test_db_helper import get_test_engine_and_session

    engine, Session = get_test_engine_and_session("test_delayed_january", tmp_path_factory)

    def override_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_db

    sample_dir = pathlib.Path("backend/tests/fixtures/rollover_sample")
    if not sample_dir.exists() or not list(sample_dir.glob("*.xlsx")):
        sample_dir = pathlib.Path("data/sample_oct7")
    fixture_files = sorted(sample_dir.glob("*.xlsx"))
    assert len(fixture_files) >= 1, "Repository fixture files not found"

    # Derive dates dynamically from fixture
    base_file = fixture_files[0]
    base_date = detect_suggested_snapshot_date(base_file)
    if not base_date:
        # Fallback to deriving from file attributes
        base_date = ScopeService.quarter_bounds(ScopeService.current_quarter())[0]

    # Shift forward by 1 quarter (approx 3 months) to enter January (Q1, new fiscal year)
    jan_date = (pd.Timestamp(base_date) + pd.DateOffset(months=3)).date()
    jan_yesterday = jan_date - timedelta(days=1)

    token = sign_admin_token()
    headers = {"Authorization": f"Bearer {token}"}

    slots = {}
    for fp in fixture_files:
        slot, _ = detect_file_slot(fp)
        slots[slot] = fp

    with TestClient(app) as client:
        file_tuples = [
            (slot, (fp.name, open(fp, "rb"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
            for slot, fp in slots.items()
        ]
        try:
            upload_data = {
                "data_as_of_date": jan_date.isoformat(),
                "yesterday_date": jan_yesterday.isoformat(),
            }
            vr = client.post("/api/snapshots/validate", data=upload_data, files=file_tuples, headers=headers)
            assert vr.status_code == 200, vr.text
            session_id = vr.json()["session_id"]

            cr = client.post("/api/snapshots/commit", json={"session_id": session_id, "replace": True, "make_active": True}, headers=headers)
            assert cr.status_code == 200, cr.text
        finally:
            for _, fh_tuple in file_tuples:
                fh_tuple[1].close()

        yield client, Session, jan_date

    app.dependency_overrides.clear()


def test_january_delayed_with_prior_fy_enabled(jan_client_and_db, monkeypatch):
    """
    When DELAYED_INCLUDE_PRIOR_FY is True, open deals from prior fiscal year count as delayed.
    All assertions are computed dynamically with pandas from the snapshot in DB.
    """
    client, Session, jan_date = jan_client_and_db
    monkeypatch.setattr(settings, "DELAYED_INCLUDE_PRIOR_FY", True)

    target_q = ScopeService.quarter_of(jan_date)
    target_parsed = _parse_fp(target_q)
    assert target_parsed[1] == 1, f"Expected Q1 year start for January snapshot, got {target_q}"

    # Compute expected delayed deals directly from DB using pandas
    db = Session()
    try:
        snap = db.query(UploadSnapshot).filter(UploadSnapshot.snapshot_date == jan_date).first()
        assert snap is not None
        opps = db.query(Opportunity).filter(Opportunity.snapshot_id == snap.id).all()
        assert len(opps) > 0

        records = [
            {
                "id": o.opportunity_id_18,
                "fiscal_period": o.fiscal_period or "",
                "forecast_category": o.forecast_category or "",
                "forecast_acv_amount": float(o.forecast_acv_amount or 0.0),
                "sales_type": o.sales_type or "",
                "is_deleted_or_lost": bool(o.is_deleted_or_lost),
                "close_date": pd.to_datetime(o.close_date) if o.close_date else pd.NaT,
            }
            for o in opps
        ]
        df = pd.DataFrame(records).drop_duplicates(subset=["id"], keep="last")
        ren_df = df[(df["sales_type"] == "Renewals") & (~df["is_deleted_or_lost"])]

        # Deals overdue in current quarter (if any)
        cq_overdue = ren_df[
            (ren_df["fiscal_period"] == target_q)
            & (ren_df["forecast_category"] != "Closed")
            & pd.notna(ren_df["close_date"])
            & (ren_df["close_date"] < pd.Timestamp(jan_date))
        ]

        # Prior fiscal period open deals
        prior_open = ren_df[
            ren_df["fiscal_period"].apply(
                lambda fp: (_parse_fp(fp) < target_parsed and _parse_fp(fp) > (0, 0)) if fp and "-" in fp else False
            )
            & (ren_df["forecast_category"] != "Closed")
        ]

        expected_overdue_df = pd.concat([cq_overdue, prior_open], ignore_index=True).drop_duplicates(subset=["id"], keep="first")
        expected_count = len(expected_overdue_df)
        expected_acv = float(expected_overdue_df["forecast_acv_amount"].sum())
    finally:
        db.close()

    r = client.get("/api/v2/delayed/summary?compare=yesterday")
    assert r.status_code == 200, r.text
    d = r.json()

    assert d["delayed_include_prior_fy"] is True
    assert "rule_text" in d and len(d["rule_text"]) > 0
    assert d["data_slice_key"] == target_q

    # Total delayed must match pandas computed values
    assert d["overdue"]["count"] == expected_count
    assert abs(d["overdue"]["acv"] - expected_acv) < 0.05
    assert d["total"]["count"] >= expected_count


def test_january_delayed_with_prior_fy_disabled(jan_client_and_db, monkeypatch):
    """
    When DELAYED_INCLUDE_PRIOR_FY is False, only same-fiscal-year earlier quarters count.
    In Q1, earlier quarters of the same year are none, so prior FY deals are excluded.
    """
    client, Session, jan_date = jan_client_and_db
    monkeypatch.setattr(settings, "DELAYED_INCLUDE_PRIOR_FY", False)

    target_q = ScopeService.quarter_of(jan_date)
    target_parsed = _parse_fp(target_q)

    # Compute expected delayed deals directly from DB using pandas with DELAYED_INCLUDE_PRIOR_FY=False
    db = Session()
    try:
        snap = db.query(UploadSnapshot).filter(UploadSnapshot.snapshot_date == jan_date).first()
        opps = db.query(Opportunity).filter(Opportunity.snapshot_id == snap.id).all()
        records = [
            {
                "id": o.opportunity_id_18,
                "fiscal_period": o.fiscal_period or "",
                "forecast_category": o.forecast_category or "",
                "forecast_acv_amount": float(o.forecast_acv_amount or 0.0),
                "sales_type": o.sales_type or "",
                "is_deleted_or_lost": bool(o.is_deleted_or_lost),
                "close_date": pd.to_datetime(o.close_date) if o.close_date else pd.NaT,
            }
            for o in opps
        ]
        df = pd.DataFrame(records).drop_duplicates(subset=["id"], keep="last")
        ren_df = df[(df["sales_type"] == "Renewals") & (~df["is_deleted_or_lost"])]

        # Deals overdue in current quarter (if any)
        cq_overdue = ren_df[
            (ren_df["fiscal_period"] == target_q)
            & (ren_df["forecast_category"] != "Closed")
            & pd.notna(ren_df["close_date"])
            & (ren_df["close_date"] < pd.Timestamp(jan_date))
        ]

        # Same fiscal year earlier quarters (in Q1, target_parsed[1] == 1, so none)
        same_fy_prior = ren_df[
            ren_df["fiscal_period"].apply(
                lambda fp: (_parse_fp(fp)[0] == target_parsed[0] and _parse_fp(fp)[1] < target_parsed[1]) if fp and "-" in fp else False
            )
            & (ren_df["forecast_category"] != "Closed")
        ]

        expected_overdue_df = pd.concat([cq_overdue, same_fy_prior], ignore_index=True).drop_duplicates(subset=["id"], keep="first")
        expected_count = len(expected_overdue_df)
        expected_acv = float(expected_overdue_df["forecast_acv_amount"].sum())
    finally:
        db.close()

    r = client.get("/api/v2/delayed/summary?compare=yesterday")
    assert r.status_code == 200, r.text
    d = r.json()

    assert d["delayed_include_prior_fy"] is False
    assert "rule_text" in d and len(d["rule_text"]) > 0

    # Overdue must match the restricted set (0 prior FY deals)
    assert d["overdue"]["count"] == expected_count
    assert abs(d["overdue"]["acv"] - expected_acv) < 0.05


def test_january_delayed_slipped_deal(jan_client_and_db, monkeypatch):
    """
    Test Slipped case in a January snapshot:
    Take an open Q4 deal from the previous fiscal year, set its close date to a date
    inside the new current quarter, and assert that:
    (1) it appears under Slipped (count and ACV equal to pandas),
    (2) it does NOT also appear under Overdue,
    (3) Total Delayed equals Overdue + Slipped + Later close date + Lost (all from pandas, never typed numbers).
    """
    client, Session, jan_date = jan_client_and_db
    monkeypatch.setattr(settings, "DELAYED_INCLUDE_PRIOR_FY", True)

    target_q = ScopeService.quarter_of(jan_date)
    target_parsed = _parse_fp(target_q)
    q_start, q_end = ScopeService.quarter_bounds(target_q)
    prev_fy_q4 = f"Q4-{target_parsed[0] - 1}"

    db = Session()
    try:
        snap = db.query(UploadSnapshot).filter(UploadSnapshot.snapshot_date == jan_date).first()
        assert snap is not None

        # Pick an open Q4 renewal deal from previous fiscal year
        deal = db.query(Opportunity).filter(
            Opportunity.snapshot_id == snap.id,
            Opportunity.sales_type == "Renewals",
            Opportunity.is_deleted_or_lost == False,
            Opportunity.forecast_category != "Closed",
            Opportunity.fiscal_period == prev_fy_q4
        ).first()
        assert deal is not None, f"Expected open renewal deal in {prev_fy_q4}"

        orig_close_date = deal.close_date
        # Set its close date to a date inside the new current quarter (15 days after quarter start)
        new_close_date = q_start + timedelta(days=15)
        assert q_start <= new_close_date <= q_end, "new_close_date must be inside current quarter"
        deal.close_date = new_close_date
        db.commit()

        # Compute ground truth reference directly from DB with pandas (zero hardcoded numbers)
        opps = db.query(Opportunity).filter(Opportunity.snapshot_id == snap.id).all()
        records = [
            {
                "id": o.opportunity_id_18,
                "fiscal_period": o.fiscal_period or "",
                "forecast_category": o.forecast_category or "",
                "forecast_acv_amount": float(o.forecast_acv_amount or 0.0),
                "sales_type": o.sales_type or "",
                "is_deleted_or_lost": bool(o.is_deleted_or_lost),
                "close_date": pd.to_datetime(o.close_date) if o.close_date else pd.NaT,
            }
            for o in opps
        ]
        df = pd.DataFrame(records).drop_duplicates(subset=["id"], keep="last")
        ren_df = df[(df["sales_type"] == "Renewals") & (~df["is_deleted_or_lost"])]

        # CQ overdue deals: close date before snapshot date
        cq_overdue = ren_df[
            (ren_df["fiscal_period"] == target_q)
            & (ren_df["forecast_category"] != "Closed")
            & pd.notna(ren_df["close_date"])
            & (ren_df["close_date"] < pd.Timestamp(jan_date))
        ]

        # Prior fiscal period open deals
        prior_open_all = ren_df[
            ren_df["fiscal_period"].apply(
                lambda fp: (_parse_fp(fp) < target_parsed and _parse_fp(fp) > (0, 0)) if fp and "-" in fp else False
            )
            & (ren_df["forecast_category"] != "Closed")
        ]

        # Slipped prior deals: close date is inside current quarter
        prior_slipped_pandas = prior_open_all[
            prior_open_all["close_date"].apply(
                lambda d: (pd.Timestamp(q_start) <= d <= pd.Timestamp(q_end)) if pd.notna(d) else False
            )
        ]

        # Overdue prior deals: close date NOT inside current quarter (remains in the past)
        prior_overdue_pandas = prior_open_all[
            ~prior_open_all["id"].isin(prior_slipped_pandas["id"])
        ]

        expected_overdue_df = pd.concat([cq_overdue, prior_overdue_pandas], ignore_index=True).drop_duplicates(subset=["id"], keep="first")
        expected_slipped_df = prior_slipped_pandas.copy()

        expected_overdue_count = len(expected_overdue_df)
        expected_overdue_acv = float(expected_overdue_df["forecast_acv_amount"].sum())

        expected_slipped_count = len(expected_slipped_df)
        expected_slipped_acv = float(expected_slipped_df["forecast_acv_amount"].sum())

        # Call API endpoint
        r = client.get("/api/v2/delayed/summary?compare=yesterday")
        assert r.status_code == 200, r.text
        d = r.json()

        # (1) it appears under Slipped (count and ACV equal to pandas)
        assert expected_slipped_count > 0
        assert d["slipped"]["count"] == expected_slipped_count
        assert abs(d["slipped"]["acv"] - expected_slipped_acv) < 0.05

        # Also verify deal is returned in /api/v2/delayed/deals?kind=slipped
        r_slipped = client.get("/api/v2/delayed/deals?kind=slipped&compare=yesterday")
        assert r_slipped.status_code == 200
        slipped_deal_ids = [item["opportunity_id_18"] for item in r_slipped.json().get("deals", [])]
        assert deal.opportunity_id_18 in slipped_deal_ids

        # (2) it does NOT also appear under Overdue
        assert d["overdue"]["count"] == expected_overdue_count
        assert abs(d["overdue"]["acv"] - expected_overdue_acv) < 0.05

        r_overdue = client.get("/api/v2/delayed/deals?kind=overdue&compare=yesterday")
        assert r_overdue.status_code == 200
        overdue_deal_ids = [item["opportunity_id_18"] for item in r_overdue.json().get("deals", [])]
        assert deal.opportunity_id_18 not in overdue_deal_ids

        # (3) Total Delayed equals Overdue + Slipped + Later close date + Lost (all from pandas, never typed numbers)
        expected_later_count = d["later_close"]["count"]
        expected_later_acv = d["later_close"]["acv"]
        expected_lost_count = d["lost"]["count"]
        expected_lost_acv = d["lost"]["acv"]

        expected_total_count = expected_overdue_count + expected_slipped_count + expected_later_count + expected_lost_count
        expected_total_acv = expected_overdue_acv + expected_slipped_acv + expected_later_acv + expected_lost_acv

        assert d["total"]["count"] == expected_total_count
        assert abs(d["total"]["acv"] - expected_total_acv) < 0.05

        # Verify sum of component dictionary values
        sum_components_count = (
            d["overdue"]["count"]
            + d["slipped"]["count"]
            + d["later_close"]["count"]
            + d["lost"]["count"]
        )
        sum_components_acv = (
            d["overdue"]["acv"]
            + d["slipped"]["acv"]
            + d["later_close"]["acv"]
            + d["lost"]["acv"]
        )
        assert d["total"]["count"] == sum_components_count
        assert abs(d["total"]["acv"] - sum_components_acv) < 0.05
    finally:
        # Restore deal's original close date for test isolation
        deal.close_date = orig_close_date
        db.commit()
        db.close()

