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

    sample_dir = pathlib.Path("data/sample_oct7")
    fixture_files = sorted(sample_dir.glob("*.xlsx"))
    assert len(fixture_files) >= 1, "Repository fixture files not found in data/sample_oct7"

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
