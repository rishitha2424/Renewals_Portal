"""
Test suite for Round 26 features:
- KAM Overview Two-Tab structure support (region_line, what_changed, movements)
- Single region sentence & country counts (e.g. Luay Arabi MEA breakdown)
- Forecast category & approval status chart data structures
- Period label rename to "All periods" (no raw 'all_open')
- Admin anonymity for non-admin callers (messages, recipients, comments, notifications)
- Duplicate display name prevention per role
- PPTX and PDF report generation matching new layout
"""
import pytest
from datetime import date, datetime
from unittest.mock import MagicMock
from sqlalchemy.orm import Session
from fastapi import HTTPException

from backend.database import SessionLocal
from backend.models.opportunity import Opportunity
from backend.models.snapshot import UploadSnapshot
from backend.models.user import User
from backend.services.context import UserContext
from backend.routers.kam import get_kam_overview, get_kam_report_pptx, get_kam_report_pdf
from backend.routers.messages import get_message_recipients
from backend.routers.admin_users import create_user, CreateUserRequest
from backend.services.kam_report_service import KamReportService


@pytest.fixture
def db():
    session = SessionLocal()
    yield session
    session.close()


def test_kam_overview_region_line_and_movements(db: Session):
    """Verify KAM Overview computes region line, what_changed, and movements."""
    snap = db.query(UploadSnapshot).filter(UploadSnapshot.id == "fb8dddb1-309d-491d-a8b0-9d96377f2ab4").first()
    if not snap:
        snap = db.query(UploadSnapshot).order_by(UploadSnapshot.snapshot_date.desc()).first()
    assert snap is not None

    kam_ctx = UserContext(
        user_id="kam-luay",
        email="luay@mobileum.com",
        role="kam",
        roles=["kam"],
        display_name="Luay Arabi",
        owner_name="Luay Arabi",
        owner_aliases=[],
    )

    overview = get_kam_overview(
        as_of=snap.snapshot_date.isoformat(),
        period="all_open",
        compare="yesterday",
        ctx=kam_ctx,
        db=db,
    )

    assert "kpis" in overview
    assert "region_line" in overview
    assert "what_changed" in overview
    assert "movements" in overview

    # Verify period label is "All periods"
    assert overview["period"] == "All periods"
    assert overview["period_info"]["period_label"] == "All periods"

    # Verify region line
    reg_line = overview["region_line"]
    assert "regions" in reg_line
    if overview["total"]["count"] == 21:
        assert reg_line["single_region"] is True
        assert "All 21 deals are in MEA:" in reg_line["summary_sentence"]
        assert "Saudi Arabia 11" in reg_line["summary_sentence"]
        assert "Morocco 4" in reg_line["summary_sentence"]

    # Verify movements
    mov = overview["movements"]
    assert "delta_compare" in mov
    assert "delta_yesterday" in mov
    assert "delta_lastweek" in mov

    # Verify charts have deal arrays and Approved 2nd tracking
    charts = overview["charts"]
    assert "forecast_category" in charts
    assert len(charts["forecast_category"]) == 5
    assert all("deals" in c for c in charts["forecast_category"])

    assert "approval_status" in charts
    assert len(charts["approval_status"]) == 3
    assert all("deals" in s for s in charts["approval_status"])


def test_admin_anonymity_in_recipients(db: Session):
    """Verify non-admin callers only see a single 'Admin' entry with no real name or email."""
    kam_ctx = UserContext(
        user_id="kam-test",
        email="kam@test.com",
        role="kam",
        roles=["kam"],
        display_name="Test KAM",
        owner_name="Test KAM",
        owner_aliases=[],
    )

    res = get_message_recipients(deal_id=None, ctx=kam_ctx, db=db)
    admins = res.get("admins", [])

    assert len(admins) == 1
    admin_entry = admins[0]
    assert admin_entry["id"] == "admin"
    assert admin_entry["name"] == "Admin"
    assert "email" not in admin_entry or admin_entry["email"] is None or admin_entry["email"] == ""


def test_duplicate_display_name_prevention(db: Session):
    """Verify creating a user with an identical display name in the same role raises 400 Bad Request."""
    admin_ctx = UserContext(
        user_id="admin-owner",
        email="admin@mobileum.com",
        role="admin",
        roles=["admin"],
        display_name="Admin User",
    )

    # Find an existing management or KAM user
    existing = db.query(User).filter(User.role == "management").first()
    if existing:
        req = CreateUserRequest(
            email="unique_new_email@mobileum.com",
            name=existing.name,
            role="management",
        )
        with pytest.raises(HTTPException) as exc_info:
            create_user(req, ctx=admin_ctx, db=db)
        assert exc_info.value.status_code == 400
        assert "already exists" in exc_info.value.detail


def test_kam_report_generation(db: Session):
    """Verify PowerPoint and PDF reports generate successfully with new layout data."""
    snap = db.query(UploadSnapshot).order_by(UploadSnapshot.snapshot_date.desc()).first()
    assert snap is not None

    kam_ctx = UserContext(
        user_id="kam-luay",
        email="luay@mobileum.com",
        role="kam",
        roles=["kam"],
        display_name="Luay Arabi",
        owner_name="Luay Arabi",
        owner_aliases=[],
    )

    overview = get_kam_overview(
        as_of=snap.snapshot_date.isoformat(),
        period="all_open",
        compare="yesterday",
        ctx=kam_ctx,
        db=db,
    )

    deals = overview.get("deals", [])

    pptx_buf = KamReportService.generate_pptx_report(
        kam_name="Luay Arabi",
        owner_name="Luay Arabi",
        period=overview.get("period", "All periods"),
        as_of_date=overview.get("as_of", snap.snapshot_date.isoformat()),
        overview_data=overview,
        deals=deals,
        compare_as_of_date=overview.get("compare_as_of"),
    )
    assert pptx_buf is not None
    assert pptx_buf.getbuffer().nbytes > 1000

    pdf_buf = KamReportService.generate_pdf_report(
        kam_name="Luay Arabi",
        owner_name="Luay Arabi",
        period=overview.get("period", "All periods"),
        as_of_date=overview.get("as_of", snap.snapshot_date.isoformat()),
        overview_data=overview,
        deals=deals,
        compare_as_of_date=overview.get("compare_as_of"),
    )
    assert pdf_buf is not None
    assert pdf_buf.getbuffer().nbytes > 1000
