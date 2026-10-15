import pytest
from datetime import date
from fastapi.testclient import TestClient

from backend.main import app
from backend.database import get_db
from backend.models.opportunity import Opportunity
from backend.models.snapshot import UploadSnapshot
from backend.services.context import UserContext, sign_admin_token
from backend.services.v2_overview_service import V2OverviewService
from backend.services.v2_expiry_service import V2ExpiryService
from backend.services.v2_approvals_service import V2ApprovalsService
from backend.services.v2_business_units_service import V2BusinessUnitsService
from backend.services.v2_regions_service import V2RegionsService
from backend.services.v2_delayed_service import V2DelayedService
from backend.services.explorer_service import ExplorerService
from backend.tests.test_db_helper import get_test_engine_and_session


@pytest.fixture
def test_setup(tmp_path_factory):
    engine, Session = get_test_engine_and_session("test_snapshot_sync", tmp_path_factory)
    db = Session()

    # Seed 3 snapshots: Oct 7, Oct 14, Oct 15
    # Oct 14 is active today, so if Oct 7 or Oct 15 falls back to active, it would wrongly return Oct 14.
    s_oct7 = UploadSnapshot(snapshot_date=date(2026, 10, 7), is_active_today=False, label="Oct 7")
    s_oct14 = UploadSnapshot(snapshot_date=date(2026, 10, 14), is_active_today=True, label="Oct 14")
    s_oct15 = UploadSnapshot(snapshot_date=date(2026, 10, 15), is_active_today=False, label="Oct 15")
    db.add_all([s_oct7, s_oct14, s_oct15])
    db.commit()
    for s in (s_oct7, s_oct14, s_oct15):
        db.refresh(s)

    # Add distinct deals
    for s, tag in [(s_oct7, "OCT7"), (s_oct14, "OCT14"), (s_oct15, "OCT15")]:
        o = Opportunity(
            snapshot_id=s.id,
            opportunity_id_18=f"opp_{tag}",
            opportunity_name=f"Deal {tag}",
            account_name=f"Account {tag}",
            sales_type="Renewals",
            forecast_category="Commit",
            approval_status="Approved",
            forecast_acv_amount=100000.0,
            close_date=s.snapshot_date,
            fiscal_period="Q4-2026",
            sub_region="North America",
            business_unit_primary="Digital",
        )
        db.add(o)
    db.commit()

    def override_db():
        d = Session()
        try:
            yield d
        finally:
            d.close()

    app.dependency_overrides[get_db] = override_db
    client = TestClient(app)

    yield {
        "db": db,
        "client": client,
        "snapshots": {
            "2026-10-07": s_oct7,
            "2026-10-14": s_oct14,
            "2026-10-15": s_oct15,
        }
    }

    app.dependency_overrides.clear()
    db.close()


@pytest.mark.parametrize("target_date", ["2026-10-07", "2026-10-14", "2026-10-15"])
def test_all_pages_sync_to_as_of_snapshot(test_setup, target_date):
    """
    Test that Overview, Expiry, Approvals, Business Units, Regions, Delayed,
    Executive, and Data Explorer each return data for the snapshot passed as as_of
    (Oct 7, Oct 14, Oct 15), never falling back to active-today (Oct 14).
    """
    db = test_setup["db"]
    client = test_setup["client"]
    ctx = UserContext()

    # 1. Overview
    ov_svc = V2OverviewService(db)
    ov_res = ov_svc.get_summary(ctx, as_of=target_date)
    assert ov_res["snapshot_date"] == target_date, f"Overview expected {target_date}, got {ov_res.get('snapshot_date')}"

    # 2. Expiry
    exp_svc = V2ExpiryService(db)
    exp_res = exp_svc.get_summary(ctx, as_of=target_date)
    assert exp_res["snapshot_date"] == target_date, f"Expiry expected {target_date}, got {exp_res.get('snapshot_date')}"

    # 3. Approvals
    appr_svc = V2ApprovalsService(db)
    appr_res = appr_svc.get_distribution(ctx, as_of=target_date)
    assert appr_res["snapshot_date"] == target_date, f"Approvals expected {target_date}, got {appr_res.get('snapshot_date')}"

    # 4. Business Units
    bu_svc = V2BusinessUnitsService(db)
    bu_res = bu_svc.get_summary(ctx, as_of=target_date)
    assert bu_res["snapshot_date"] == target_date, f"Business Units expected {target_date}, got {bu_res.get('snapshot_date')}"

    # 5. Regions
    reg_svc = V2RegionsService(db)
    reg_res = reg_svc.get_summary(ctx, as_of=target_date)
    assert reg_res["snapshot_date"] == target_date, f"Regions expected {target_date}, got {reg_res.get('snapshot_date')}"

    # 6. Delayed
    del_svc = V2DelayedService(db)
    del_res = del_svc.get_summary(as_of=target_date)
    assert del_res["snapshot_date"] == target_date, f"Delayed expected {target_date}, got {del_res.get('snapshot_date')}"

    # 7. Executive (via API overview endpoint which executive view uses)
    token = sign_admin_token()
    headers = {"Authorization": f"Bearer {token}"}
    exec_ov = client.get(f"/api/v2/overview/summary?as_of={target_date}", headers=headers)
    assert exec_ov.status_code == 200
    assert exec_ov.json()["snapshot_date"] == target_date

    # 8. Data Explorer
    exp_svc = ExplorerService(db)
    snap = exp_svc.resolve_snapshot(target_date)
    assert snap is not None
    assert snap.snapshot_date.isoformat() == target_date

    col_res = client.get(f"/api/v2/explorer/columns?as_of={target_date}", headers=headers)
    assert col_res.status_code == 200
    assert col_res.json()["snapshot_date"] == target_date


def test_no_fallback_to_active_today_on_unknown_snapshot(test_setup):
    """
    Test that when an invalid / nonexistent snapshot is passed, services do NOT
    silently fall back to active today.
    """
    db = test_setup["db"]
    ctx = UserContext()

    ov_svc = V2OverviewService(db)
    ov_res = ov_svc.get_summary(ctx, as_of="2020-01-01")
    assert "error" in ov_res or ov_res.get("snapshot_date") != "2026-10-14"

    exp_svc = ExplorerService(db)
    snap = exp_svc.resolve_snapshot("2020-01-01")
    assert snap is None, "ExplorerService should return None for nonexistent snapshot, not active today"
