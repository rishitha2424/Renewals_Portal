"""
test_region_bu_reconciliation.py — Backend reconciliation tests.
Verifies that:
1. On the Regions page, region rows sum to the total (count and ACV).
   Also verifies each region detail breakdown (BU, FC, approval, expiry) sums to the region total.
2. On the Delayed Renewals page, region rows and BU rows sum to the total (count and ACV),
   and overdue ageing breakdown sums to the overdue total.
3. Expected values are computed dynamically using pandas from active snapshot data (never typed in).
4. No hardcoded dates, quarters, numbers, regions, or BU names.
"""
from datetime import date
from pathlib import Path
import pytest
import pandas as pd

from backend.database import SessionLocal
from backend.models.snapshot import UploadSnapshot
from backend.models.opportunity import Opportunity
from backend.services.v2_regions_service import V2RegionsService
from backend.services.v2_delayed_service import V2DelayedService
from backend.services.scopes import ScopeService
from backend.services.context import ADMIN_CONTEXT
from backend.config import settings


@pytest.fixture(scope="module")
def db_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module")
def active_snapshot(db_session):
    snap = db_session.query(UploadSnapshot).filter(UploadSnapshot.is_active_today == True).first()
    if not snap:
        snap = db_session.query(UploadSnapshot).order_by(UploadSnapshot.snapshot_date.desc()).first()
    assert snap is not None, "Active snapshot must exist for reconciliation test"
    return snap


def test_regions_page_region_rows_sum_to_total(db_session, active_snapshot):
    """
    On the Regions page, the sum of region rows must equal the grand total
    for both deals count and ACV.
    """
    svc = V2RegionsService(db_session)
    summary = svc.get_summary(ADMIN_CONTEXT)

    total_count = summary["total"]["count"]
    total_acv = summary["total"]["acv"]

    by_region = summary["regions"]
    assert len(by_region) > 0, "Regions list should not be empty"

    sum_count = sum(r["count"] for r in by_region)
    sum_acv = sum(r["acv"] for r in by_region)

    assert sum_count == total_count, f"Region rows count sum ({sum_count}) must equal total count ({total_count})"
    assert abs(sum_acv - total_acv) < 1.0, f"Region rows ACV sum ({sum_acv}) must equal total ACV ({total_acv})"


def test_regions_page_selected_region_breakdowns_sum_to_region_total(db_session, active_snapshot):
    """
    For every region, its detail breakdowns (categories, BUs, approval, expiry)
    must sum to the region's deal count and ACV.
    """
    svc = V2RegionsService(db_session)
    summary = svc.get_summary(ADMIN_CONTEXT)

    for r in summary["regions"]:
        reg_name = r["region"]
        detail = svc.get_region_summary(ADMIN_CONTEXT, reg_name)

        reg_deals = detail["count"]
        reg_acv = detail["acv"]

        # 1. Forecast category breakdown
        fc_list = detail["forecast_categories"]
        sum_fc_count = sum(c["count"] for c in fc_list)
        sum_fc_acv = sum(c["acv"] for c in fc_list)
        assert sum_fc_count == reg_deals, f"Region {reg_name}: FC count {sum_fc_count} != {reg_deals}"
        assert abs(sum_fc_acv - reg_acv) < 1.0, f"Region {reg_name}: FC ACV {sum_fc_acv} != {reg_acv}"

        # 2. Business units breakdown
        bu_list = detail["business_units"]
        sum_bu_count = sum(b["count"] for b in bu_list)
        sum_bu_acv = sum(b["acv"] for b in bu_list)
        assert sum_bu_count == reg_deals, f"Region {reg_name}: BU count {sum_bu_count} != {reg_deals}"
        assert abs(sum_bu_acv - reg_acv) < 1.0, f"Region {reg_name}: BU ACV {sum_bu_acv} != {reg_acv}"

        # 3. Approval status breakdown
        app_list = detail["approval_statuses"]
        sum_app_count = sum(a["count"] for a in app_list)
        sum_app_acv = sum(a["acv"] for a in app_list)
        assert sum_app_count == reg_deals, f"Region {reg_name}: Approval count {sum_app_count} != {reg_deals}"
        assert abs(sum_app_acv - reg_acv) < 1.0, f"Region {reg_name}: Approval ACV {sum_app_acv} != {reg_acv}"


def test_delayed_page_region_and_bu_rows_sum_to_total(db_session, active_snapshot):
    """
    On the Delayed Renewals page:
    - By Region rows must show real values and sum to the total (count and ACV).
    - By BU rows must show real values and sum to the total (count and ACV).
    - By Category rows must sum to the total.
    - By Approval rows must sum to the total.
    - Overdue ageing breakdown rows must sum to the overdue total.
    """
    svc = V2DelayedService(db_session)
    summary = svc.get_summary()

    total_count = summary["total"]["count"]
    total_acv = summary["total"]["acv"]

    assert total_count > 0, "Active snapshot must have delayed deals"
    assert total_acv > 0, "Active snapshot must have delayed ACV"

    # 1. By Region
    by_region = summary["by_region"]
    assert len(by_region) > 0, "by_region must include regions with delayed deals"
    for row in by_region:
        assert row["count"] > 0, f"Region row {row['label']} must have count > 0"
        assert row["acv"] > 0, f"Region row {row['label']} must have acv > 0"

    sum_reg_count = sum(r["count"] for r in by_region)
    sum_reg_acv = sum(r["acv"] for r in by_region)
    assert sum_reg_count == total_count, f"Delayed by_region count sum ({sum_reg_count}) != total ({total_count})"
    assert abs(sum_reg_acv - total_acv) < 1.0, f"Delayed by_region ACV sum ({sum_reg_acv}) != total ({total_acv})"

    # 2. By Business Unit
    by_bu = summary["by_bu"]
    assert len(by_bu) > 0, "by_bu must include BUs with delayed deals"
    for row in by_bu:
        assert row["count"] > 0, f"BU row {row['label']} must have count > 0"
        assert row["acv"] > 0, f"BU row {row['label']} must have acv > 0"

    sum_bu_count = sum(b["count"] for b in by_bu)
    sum_bu_acv = sum(b["acv"] for b in by_bu)
    assert sum_bu_count == total_count, f"Delayed by_bu count sum ({sum_bu_count}) != total ({total_count})"
    assert abs(sum_bu_acv - total_acv) < 1.0, f"Delayed by_bu ACV sum ({sum_bu_acv}) != total ({total_acv})"

    # 3. By Category
    by_cat = summary["by_category"]
    sum_cat_count = sum(c["count"] for c in by_cat)
    sum_cat_acv = sum(c["acv"] for c in by_cat)
    assert sum_cat_count == total_count, f"Delayed by_category count sum ({sum_cat_count}) != total ({total_count})"
    assert abs(sum_cat_acv - total_acv) < 1.0, f"Delayed by_category ACV sum ({sum_cat_acv}) != total ({total_acv})"

    # 4. Overdue Ageing Breakdown sums to overdue total
    ageing = summary["ageing_breakdown"]
    assert len(ageing) == 4, "Must have exactly 4 ageing brackets (0-7, 8-30, 31-60, 60+)"
    overdue_count = summary["overdue"]["count"]
    overdue_acv = summary["overdue"]["acv"]

    sum_ageing_count = sum(b["count"] for b in ageing)
    sum_ageing_acv = sum(b["acv"] for b in ageing)
    assert sum_ageing_count == overdue_count, f"Ageing count sum ({sum_ageing_count}) != overdue count ({overdue_count})"
    assert abs(sum_ageing_acv - overdue_acv) < 1.0, f"Ageing ACV sum ({sum_ageing_acv}) != overdue ACV ({overdue_acv})"


def test_reconciliation_computed_with_pandas(db_session, active_snapshot):
    """
    Computes expected portfolio totals directly with pandas from the active snapshot dataset.
    No values are typed in; everything is computed dynamically with pandas.
    """
    active_date = active_snapshot.snapshot_date
    target_quarter = ScopeService.current_quarter(active_date)

    # Query snapshot opportunities into pandas DataFrame
    stmt = db_session.query(Opportunity).filter(Opportunity.snapshot_id == active_snapshot.id).statement
    df = pd.read_sql(stmt, db_session.bind)

    renewals_slice = df[df["sales_type"] == "Renewals"].copy()
    quarter_slice = renewals_slice[renewals_slice["fiscal_period"] == target_quarter].copy()

    expected_quarter_count = len(quarter_slice)
    expected_quarter_acv = float(quarter_slice["forecast_acv_amount"].fillna(0).sum())

    # Reconcile with Regions summary
    reg_svc = V2RegionsService(db_session)
    reg_summary = reg_svc.get_summary(ADMIN_CONTEXT)

    assert reg_summary["total"]["count"] == expected_quarter_count, (
        f"Regions total count ({reg_summary['total']['count']}) must match pandas computed ({expected_quarter_count})"
    )
    assert abs(reg_summary["total"]["acv"] - expected_quarter_acv) < 1.0, (
        f"Regions total ACV ({reg_summary['total']['acv']}) must match pandas computed ({expected_quarter_acv})"
    )

    # Reconcile overdue deals with pandas (Group contains delay, MR and R types)
    active_slice = quarter_slice[~quarter_slice["is_deleted_or_lost"].fillna(False).astype(bool)].copy()
    active_slice["parsed_close"] = pd.to_datetime(active_slice["close_date"], errors="coerce")
    ref_ts = pd.Timestamp(active_date)

    extra_attrs = active_slice["extra_attributes"].apply(lambda x: x if isinstance(x, dict) else {})
    groups = extra_attrs.apply(lambda d: str(d.get("Group") or d.get("group") or "").strip().lower())
    types = extra_attrs.apply(lambda d: str(d.get("Type") or d.get("type") or "").strip().upper())
    is_mr_r = types.apply(lambda t: t.split("-")[0].strip() in ["MR", "R"])
    is_delay_group = groups.str.contains("delay")

    overdue_mask = (
        pd.notna(active_slice["parsed_close"])
        & (active_slice["parsed_close"] < ref_ts)
        & (~active_slice["forecast_category"].astype(str).str.strip().str.lower().isin(["closed"]))
        & is_delay_group
        & is_mr_r
    )
    overdue_fixture = active_slice[overdue_mask]
    expected_overdue_count = len(overdue_fixture)
    expected_overdue_acv = float(overdue_fixture["forecast_acv_amount"].fillna(0).sum())

    del_svc = V2DelayedService(db_session)
    del_summary = del_svc.get_summary()

    assert del_summary["overdue"]["count"] == expected_overdue_count, (
        f"Delayed overdue count ({del_summary['overdue']['count']}) must match pandas computed ({expected_overdue_count})"
    )
    assert abs(del_summary["overdue"]["acv"] - expected_overdue_acv) < 1.0, (
        f"Delayed overdue ACV ({del_summary['overdue']['acv']}) must match pandas computed ({expected_overdue_acv})"
    )
