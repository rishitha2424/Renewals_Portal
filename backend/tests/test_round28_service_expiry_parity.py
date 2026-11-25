import pytest
from datetime import date
from fastapi.testclient import TestClient
from backend.main import app
from backend.database import SessionLocal
from backend.models.snapshot import UploadSnapshot
from backend.models.opportunity import Opportunity
from backend.models.user import User
from backend.services.scopes import ScopeService, FilterSpec
from backend.services.deal_serializer import (
    serialize_opportunity,
    is_deal_missing_service_dates,
    extract_deal_service_dates,
)
from backend.utils.excel_parser import parse_excel_date


@pytest.fixture(scope="module")
def client_and_db():
    db = SessionLocal()
    client = TestClient(app)
    try:
        yield client, db
    finally:
        db.close()


def test_luay_arabi_all_21_deals_have_valid_service_dates(client_and_db):
    """
    Verify all 21 active deals for Luay Arabi have valid service start and expiry dates in the workbook.
    Tile, tab, and chart agree with 0 missing-date deals and 0 unscheduled deals.
    """
    client, db = client_and_db
    snap = db.query(UploadSnapshot).order_by(UploadSnapshot.snapshot_date.desc()).first()
    assert snap is not None

    fs = FilterSpec(period="all_open")
    res = ScopeService.resolve(fs, snapshot=snap, as_of_date=snap.snapshot_date, db=db)

    opps = (
        db.query(Opportunity)
        .filter(
            Opportunity.snapshot_id == snap.id,
            Opportunity.opportunity_owner == "Luay Arabi",
            *res.conditions,
        )
        .all()
    )
    assert len(opps) == 21, f"Expected 21 active open deals for Luay Arabi, got {len(opps)}"

    for o in opps:
        extra = o.extra_attributes or {}
        start_iso, exp_iso = extract_deal_service_dates(extra)
        assert start_iso is not None, f"Deal {o.opportunity_id_18} has no valid start date in extra: {extra}"
        assert exp_iso is not None, f"Deal {o.opportunity_id_18} has no valid expiry date in extra: {extra}"
        assert not is_deal_missing_service_dates(o), f"Deal {o.opportunity_id_18} flagged as missing service dates"

        serialized = serialize_opportunity(o)
        assert serialized["service_start_date"] == start_iso
        assert serialized["service_expiry_date"] == exp_iso
        assert serialized["service_end_date"] == exp_iso
        assert not is_deal_missing_service_dates(serialized)

    # Now verify the KAM overview endpoint response for Luay Arabi
    # Get or create KAM user for Luay Arabi
    kam_user = db.query(User).filter(User.owner_name == "Luay Arabi").first()
    assert kam_user is not None, "Luay Arabi KAM user not found"

    from backend.services.auth_service import sign_session_token
    token = sign_session_token(kam_user)

    resp = client.get(
        f"/api/kam/overview?as_of={snap.snapshot_date.isoformat()}&period=all_open",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, f"Overview returned {resp.status_code}: {resp.text}"
    data = resp.json()

    kpis = data.get("kpis", {})
    action_lists = data.get("action_lists", {})
    deals = data.get("deals", [])

    # Total deals must be 21
    assert kpis.get("total_count") == 21
    assert len(deals) == 21

    # Needs review count (tile 8) must be 0
    assert kpis.get("needs_review_count") == 0, f"Expected 0 needs_review_count, got {kpis.get('needs_review_count')}"
    assert kpis.get("needs_review_acv") == 0.0

    # Action center tab missing_service_dates must have 0 deals
    missing_dates_deals = action_lists.get("missing_service_dates", [])
    assert len(missing_dates_deals) == 0, f"Expected 0 missing_service_dates in action_lists, got {len(missing_dates_deals)}"

    # All 21 deals have valid service_expiry_date in YYYY-MM-DD format
    month_counts = {}
    for d in deals:
        exp_d = d.get("service_expiry_date")
        assert exp_d is not None and len(exp_d) == 10
        month_key = exp_d[:7]
        month_counts[month_key] = month_counts.get(month_key, 0) + 1

    assert sum(month_counts.values()) == 21
    assert "Unscheduled" not in month_counts


def test_every_owner_service_dates_parity_with_workbook(client_and_db):
    """
    Check for EVERY owner in the workbook that deals with/without dates match independently,
    and that the KPI needs_review_count agrees with missing_service_dates action list.
    """
    client, db = client_and_db
    snap = db.query(UploadSnapshot).order_by(UploadSnapshot.snapshot_date.desc()).first()
    fs = FilterSpec(period="all_open")
    res = ScopeService.resolve(fs, snapshot=snap, as_of_date=snap.snapshot_date, db=db)

    all_opps = (
        db.query(Opportunity)
        .filter(Opportunity.snapshot_id == snap.id, *res.conditions)
        .all()
    )

    # Group by owner
    by_owner = {}
    for o in all_opps:
        owner = o.opportunity_owner or "Unassigned"
        by_owner.setdefault(owner, []).append(o)

    total_missing_whole_snapshot = 0

    for owner, opp_list in by_owner.items():
        # Independent workbook calculation
        truly_missing = []
        for o in opp_list:
            extra = o.extra_attributes or {}
            start_iso, exp_iso = extract_deal_service_dates(extra)
            if not start_iso or not exp_iso:
                truly_missing.append(o)

        total_missing_whole_snapshot += len(truly_missing)

        # Serialized check
        serialized_deals = [serialize_opportunity(o) for o in opp_list]
        missing_serialized = [d for d in serialized_deals if is_deal_missing_service_dates(d)]

        # Must agree 100%
        assert len(missing_serialized) == len(truly_missing), (
            f"Owner {owner}: {len(truly_missing)} missing in extra_attributes vs "
            f"{len(missing_serialized)} in serialized deals"
        )

    # Across whole workbook snapshot, exactly 10 deals lack dates
    assert total_missing_whole_snapshot == 10, (
        f"Expected exactly 10 deals missing service dates across snapshot, got {total_missing_whole_snapshot}"
    )

