import pytest
from datetime import date, timedelta
from unittest.mock import patch
import pandas as pd

from backend.config import settings
from backend.models.opportunity import Opportunity
from backend.models.snapshot import UploadSnapshot
from backend.services.context import UserContext
from backend.services.v2_overview_service import V2OverviewService
from backend.tests.test_db_helper import get_test_engine_and_session


@pytest.fixture
def db_session(tmp_path_factory):
    engine, Session = get_test_engine_and_session("test_needs_attention", tmp_path_factory)
    db = Session()
    try:
        yield db
    finally:
        db.close()


def _create_snap(db, snap_date=date(2026, 10, 14), is_active=True, yesterday_date=date(2026, 10, 13)):
    snap = UploadSnapshot(
        snapshot_date=snap_date,
        yesterday_date=yesterday_date,
        is_active_today=is_active,
        label="Test Snap",
    )
    db.add(snap)
    db.commit()
    db.refresh(snap)
    return snap


def test_needs_attention_settings_config():
    """Verify config settings exist and are integers."""
    assert hasattr(settings, "NEEDS_ATTENTION_WINDOW_DAYS")
    assert isinstance(settings.NEEDS_ATTENTION_WINDOW_DAYS, int)
    assert hasattr(settings, "NEEDS_ATTENTION_MAX_ITEMS")
    assert isinstance(settings.NEEDS_ATTENTION_MAX_ITEMS, int)


def test_needs_attention_omits_biggest_drop_when_all_increases(db_session):
    """(a) All changes vs yesterday are increases, so 'biggest drop' is omitted."""
    y_snap = _create_snap(db_session, snap_date=date(2026, 10, 13), is_active=False, yesterday_date=None)
    t_snap = _create_snap(db_session, snap_date=date(2026, 10, 14), is_active=True, yesterday_date=date(2026, 10, 13))

    # Opp in yesterday with 100k
    o_y = Opportunity(
        snapshot_id=y_snap.id,
        opportunity_id_18="opp_inc_1",
        opportunity_name="Deal Inc",
        account_name="Acme",
        sales_type="Renewals",
        forecast_category="Commit",
        approval_status="Approved",
        forecast_acv_amount=100000.0,
        close_date=date(2026, 11, 1),
        fiscal_period="Q4-2026",
    )
    # Opp in today with 150k (increase of 50k, no drop)
    o_t = Opportunity(
        snapshot_id=t_snap.id,
        opportunity_id_18="opp_inc_1",
        opportunity_name="Deal Inc",
        account_name="Acme",
        sales_type="Renewals",
        forecast_category="Commit",
        approval_status="Approved",
        forecast_acv_amount=150000.0,
        close_date=date(2026, 11, 1),
        fiscal_period="Q4-2026",
    )
    db_session.add_all([o_y, o_t])
    db_session.commit()

    svc = V2OverviewService(db_session)
    res = svc.get_summary(UserContext(), as_of=t_snap.id)
    na = res["needs_attention"]
    cat_keys = [item["category_key"] for item in na["items"]]
    assert "biggest_drop" not in cat_keys, "'biggest_drop' should be omitted when all changes are increases"


def test_needs_attention_omits_commit_when_all_approved(db_session):
    """(b) No unapproved Commit deals, so that item is omitted."""
    snap = _create_snap(db_session, snap_date=date(2026, 10, 14), is_active=True, yesterday_date=None)
    o = Opportunity(
        snapshot_id=snap.id,
        opportunity_id_18="opp_appr_1",
        opportunity_name="Approved Commit Deal",
        account_name="Acme",
        sales_type="Renewals",
        forecast_category="Commit",
        approval_status="Approved",
        forecast_acv_amount=50000.0,
        close_date=date(2026, 11, 1),
        fiscal_period="Q4-2026",
    )
    db_session.add(o)
    db_session.commit()

    svc = V2OverviewService(db_session)
    res = svc.get_summary(UserContext(), as_of=snap.id)
    na = res["needs_attention"]
    cat_keys = [item["category_key"] for item in na["items"]]
    assert "commit_not_approved" not in cat_keys, "commit_not_approved must be omitted when all Commit deals are approved"


def test_needs_attention_hidden_when_nothing_requires_attention(db_session):
    """(c) Nothing at all, so items is empty and the panel will be hidden."""
    snap = _create_snap(db_session, snap_date=date(2026, 10, 14), is_active=True, yesterday_date=None)
    # Deal far in future, approved, commit, no drops
    o = Opportunity(
        snapshot_id=snap.id,
        opportunity_id_18="opp_clean_1",
        opportunity_name="Perfect Deal",
        account_name="Clean Co",
        sales_type="Renewals",
        forecast_category="Commit",
        approval_status="Approved",
        forecast_acv_amount=50000.0,
        close_date=date(2026, 12, 31),
        fiscal_period="Q4-2026",
    )
    db_session.add(o)
    db_session.commit()

    svc = V2OverviewService(db_session)
    res = svc.get_summary(UserContext(), as_of=snap.id)
    na = res["needs_attention"]
    assert len(na["items"]) == 0, "Needs attention items should be empty when no issues exist"


def test_needs_attention_no_duplicate_categories(db_session):
    """(d) Two lines never repeat a category."""
    snap = _create_snap(db_session, snap_date=date(2026, 10, 14), is_active=True, yesterday_date=None)
    # Add multiple unapproved commit deals
    o1 = Opportunity(
        snapshot_id=snap.id,
        opportunity_id_18="opp_dup_1",
        opportunity_name="Unapproved 1",
        account_name="Co 1",
        sales_type="Renewals",
        forecast_category="Commit",
        approval_status="Blank",
        forecast_acv_amount=80000.0,
        close_date=date(2026, 11, 20),
        fiscal_period="Q4-2026",
    )
    o2 = Opportunity(
        snapshot_id=snap.id,
        opportunity_id_18="opp_dup_2",
        opportunity_name="Unapproved 2",
        account_name="Co 2",
        sales_type="Renewals",
        forecast_category="Commit",
        approval_status="Pending Approval",
        forecast_acv_amount=60000.0,
        close_date=date(2026, 11, 25),
        fiscal_period="Q4-2026",
    )
    db_session.add_all([o1, o2])
    db_session.commit()

    svc = V2OverviewService(db_session)
    res = svc.get_summary(UserContext(), as_of=snap.id)
    na = res["needs_attention"]
    keys = [item["category_key"] for item in na["items"]]
    assert len(keys) == len(set(keys)), f"Duplicate category keys found in needs attention: {keys}"


def test_needs_attention_tag_normalizes_blank_to_not_submitted(db_session):
    """Tag replaces 'Blank' with 'Not submitted'."""
    snap = _create_snap(db_session, snap_date=date(2026, 10, 14), is_active=True, yesterday_date=None)
    o = Opportunity(
        snapshot_id=snap.id,
        opportunity_id_18="opp_blank_tag",
        opportunity_name="Blank Status Deal",
        account_name="Blank Corp",
        sales_type="Renewals",
        forecast_category="Commit",
        approval_status="Blank",
        forecast_acv_amount=99000.0,
        close_date=date(2026, 11, 1),
        fiscal_period="Q4-2026",
    )
    db_session.add(o)
    db_session.commit()

    svc = V2OverviewService(db_session)
    res = svc.get_summary(UserContext(), as_of=snap.id)
    na = res["needs_attention"]
    item = next(it for it in na["items"] if it["category_key"] == "commit_not_approved")
    assert "Not submitted" in item["badge"], f"Badge should contain 'Not submitted', got: {item['badge']}"
    assert "Blank" not in item["badge"], f"Badge must not contain literal 'Blank': {item['badge']}"
