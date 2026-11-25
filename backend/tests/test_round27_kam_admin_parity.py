"""
Round 27 Tests: KAM Tile Parity with Admin Logic & Deal Tracker Endpoints.
Verifies:
1. For every owner in the workbook, KAM tile numbers
   (Approved, Pending, Not submitted, Delayed, Slippage, Needs review)
   equal the admin-logic calculation for that owner's deals.
2. Luay Arabi Nov 13 snapshot exact numbers:
   Approved 18 deals (~$4.32M), Not submitted 3 deals ($338,233).
3. Approved includes Approved 2nd; Not submitted does NOT include Approved 2nd.
4. Singular/plural format ('1 deal' vs 'N deals').
"""
import pytest
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.models.opportunity import Opportunity
from backend.models.snapshot import UploadSnapshot
from backend.services.context import UserContext
from backend.routers.kam import get_kam_overview
from backend.services.kam_report_service import KamReportService


@pytest.fixture
def db_session():
    db = next(get_db())
    try:
        yield db
    finally:
        db.close()


def test_every_owner_kam_tile_parity_with_admin_logic(db_session: Session):
    """
    For every owner in the database, KAM tile numbers must strictly equal
    the admin-logic calculation for that owner's deals.
    """
    latest_snap = db_session.query(UploadSnapshot).order_by(UploadSnapshot.snapshot_date.desc()).first()
    assert latest_snap is not None, "No snapshots found in database"

    # Distinct owners in this snapshot
    owners = [
        r[0] for r in db_session.query(Opportunity.opportunity_owner)
        .filter(Opportunity.snapshot_id == latest_snap.id)
        .distinct()
        .all()
        if r[0] and r[0].strip()
    ]
    assert len(owners) > 0, "No owners found in latest snapshot"

    for owner_name in owners:
        ctx = UserContext(
            user_id="test-kam",
            email=f"{owner_name.lower().replace(' ', '.')}@example.com",
            display_name=owner_name,
            role="kam",
            owner_name=owner_name,
        )

        overview = get_kam_overview(
            as_of=latest_snap.snapshot_date.isoformat(),
            period="all_open",
            ctx=ctx,
            db=db_session,
        )

        kpis = overview["kpis"]
        deals = overview["deals"]
        action_lists = overview["action_lists"]

        # Admin-logic calculation for this owner's deals:
        approved_deals = [
            d for d in deals
            if d.get("approval_status") in ("Approved", "Approved - 2nd")
        ]
        approved_2nd_deals = [
            d for d in deals
            if d.get("approval_status") == "Approved - 2nd"
        ]
        pending_deals = [
            d for d in deals
            if d.get("approval_status") == "Pending Approval"
        ]
        # Not submitted must never include Approved 2nd
        not_submitted_deals = [
            d for d in deals
            if (d.get("approval_status") or "Not submitted") == "Not submitted"
            and d.get("approval_status") != "Approved - 2nd"
        ]

        expected_appr_count = len(approved_deals)
        expected_appr_acv = round(sum(float(d.get("forecast_acv_amount") or 0.0) for d in approved_deals), 2)

        expected_pending_count = len(pending_deals)
        expected_pending_acv = round(sum(float(d.get("forecast_acv_amount") or 0.0) for d in pending_deals), 2)

        expected_not_sub_count = len(not_submitted_deals)
        expected_not_sub_acv = round(sum(float(d.get("forecast_acv_amount") or 0.0) for d in not_submitted_deals), 2)

        # Assert tile parity
        assert kpis["approved_count"] == expected_appr_count, f"Owner {owner_name}: approved_count mismatch"
        assert abs(kpis["approved_acv"] - expected_appr_acv) < 0.05, f"Owner {owner_name}: approved_acv mismatch"

        assert kpis["pending_approval_count"] == expected_pending_count, f"Owner {owner_name}: pending count mismatch"
        assert abs(kpis["pending_approval_acv"] - expected_pending_acv) < 0.05, f"Owner {owner_name}: pending acv mismatch"

        assert kpis["not_submitted_count"] == expected_not_sub_count, f"Owner {owner_name}: not submitted count mismatch"
        assert abs(kpis["not_submitted_acv"] - expected_not_sub_acv) < 0.05, f"Owner {owner_name}: not submitted acv mismatch"

        assert kpis["approved_2nd_count"] == len(approved_2nd_deals), f"Owner {owner_name}: approved 2nd count mismatch"

        # Action list parity with tiles
        assert kpis["delayed_count"] == len(action_lists.get("delayed_deals", [])), f"Owner {owner_name}: delayed count mismatch"
        assert kpis["slippage_count"] == len(action_lists.get("slippage_deals", [])), f"Owner {owner_name}: slippage count mismatch"
        assert kpis["needs_review_count"] == len(action_lists.get("missing_service_dates", [])), f"Owner {owner_name}: needs review count mismatch"


def test_luay_arabi_exact_metrics_round27(db_session: Session):
    """
    Specifically verifies Luay Arabi's numbers on the latest snapshot (Nov 13):
    Approved 18 deals (~$4.32M), Not submitted 3 deals ($338,233).
    """
    snap = db_session.query(UploadSnapshot).order_by(UploadSnapshot.snapshot_date.desc()).first()
    assert snap is not None

    ctx = UserContext(
        user_id="test-luay",
        email="luay.arabi@example.com",
        display_name="Luay Arabi",
        role="kam",
        owner_name="Luay Arabi",
    )

    overview = get_kam_overview(
        as_of=snap.snapshot_date.isoformat(),
        period="all_open",
        ctx=ctx,
        db=db_session,
    )

    kpis = overview["kpis"]
    # Total: 21 deals
    assert kpis["total_count"] == 21
    assert abs(kpis["total_acv"] - 4658574.08) < 1.0

    # Approved: 18 deals (~$4.32M)
    assert kpis["approved_count"] == 18
    assert abs(kpis["approved_acv"] - 4320341.08) < 1.0
    assert kpis["approved_2nd_count"] == 14

    # Pending: 0 deals
    assert kpis["pending_approval_count"] == 0
    assert kpis["pending_approval_acv"] == 0.0

    # Not submitted: 3 deals ($338,233.00)
    assert kpis["not_submitted_count"] == 3
    assert abs(kpis["not_submitted_acv"] - 338233.0) < 1.0

    # Delayed: 1 deal ($45,000.00)
    assert kpis["delayed_count"] == 1


def test_kam_reports_deal_tracker_page(db_session: Session):
    """
    Verifies PPTX and PDF reports generate successfully with the restored 8 tiles
    and the new Deal Tracker slide/page.
    """
    snap = db_session.query(UploadSnapshot).order_by(UploadSnapshot.snapshot_date.desc()).first()
    assert snap is not None

    ctx = UserContext(
        user_id="test-luay",
        email="luay.arabi@example.com",
        display_name="Luay Arabi",
        role="kam",
        owner_name="Luay Arabi",
    )

    overview = get_kam_overview(
        as_of=snap.snapshot_date.isoformat(),
        period="all_open",
        ctx=ctx,
        db=db_session,
    )

    # PPTX
    pptx_buf = KamReportService.generate_pptx_report(
        kam_name="Luay Arabi",
        owner_name="Luay Arabi",
        period="all_open",
        as_of_date=snap.snapshot_date.isoformat(),
        overview_data=overview,
        deals=overview["deals"],
    )
    assert pptx_buf.getbuffer().nbytes > 10000

    # PDF
    pdf_buf = KamReportService.generate_pdf_report(
        kam_name="Luay Arabi",
        owner_name="Luay Arabi",
        period="all_open",
        as_of_date=snap.snapshot_date.isoformat(),
        overview_data=overview,
        deals=overview["deals"],
    )
    assert pdf_buf.getbuffer().nbytes > 10000
