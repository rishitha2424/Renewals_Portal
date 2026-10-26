import pytest
from datetime import date
import pandas as pd

@pytest.fixture(scope="module")
def client_and_db(tmp_path_factory):
    """Upload Oct-7 files and return TestClient + Session factory."""
    import pathlib, os, shutil
    from fastapi.testclient import TestClient
    from backend.database import get_db
    from backend.main import app
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from backend.models.snapshot import UploadSnapshot

    root_db = pathlib.Path("renewals.db")
    if root_db.exists() and tmp_path_factory:
        db_path = tmp_path_factory.mktemp("db") / "test_v2_delayed.db"
        shutil.copy(root_db, db_path)
        engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
        Session = sessionmaker(bind=engine)
        # Ensure Oct 7 snapshot is active for tests
        s = Session()
        s.query(UploadSnapshot).update({"is_active_today": False})
        s.query(UploadSnapshot).filter(UploadSnapshot.snapshot_date == date(2026, 10, 7)).update({"is_active_today": True})
        s.commit()
        s.close()
    else:
        from backend.tests.test_db_helper import get_test_engine_and_session
        engine, Session = get_test_engine_and_session("test_v2_delayed", tmp_path_factory)

    def override_db():
        db = Session()
        try: yield db
        finally: db.close()

    app.dependency_overrides[get_db] = override_db

    # If Oct 7 was already present, we don't need to re-validate and re-commit
    check_session = Session()
    oct7_exists = check_session.query(UploadSnapshot).filter(UploadSnapshot.snapshot_date == date(2026, 10, 7)).first() is not None
    check_session.close()

    from backend.services.context import sign_admin_token
    token = sign_admin_token()
    headers = {"Authorization": f"Bearer {token}"}

    with TestClient(app) as client:
        if not oct7_exists:
            from backend.utils.excel_parser import detect_file_slot
            sample = pathlib.Path("data/sample_oct7")
            slots = {}
            for fp in sorted(sample.glob("*.xlsx")):
                slots[detect_file_slot(fp)[0]] = fp
            files = [(slot, (fp.name, open(fp, "rb"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")) for slot, fp in slots.items()]
            data = {"data_as_of_date": "2026-10-07", "yesterday_date": "2026-10-06"}
            vr = client.post("/api/snapshots/validate", data=data, files=files, headers=headers)
            assert vr.status_code == 200, vr.text
            session_id = vr.json()["session_id"]

            cr = client.post("/api/snapshots/commit", json={"session_id": session_id, "replace": False}, headers=headers)
            assert cr.status_code == 200, cr.text

        yield client, Session

def test_delayed_summary_yesterday(client_and_db):
    client, _ = client_and_db
    r = client.get("/api/v2/delayed/summary?compare=yesterday")
    assert r.status_code == 200
    d = r.json()
    assert "delayed_vs_yesterday" in d["total"]
    
    # Deals endpoint for yesterday matches yesterday window in summary
    r_sl = client.get("/api/v2/delayed/deals?compare=yesterday&kind=slipped")
    assert r_sl.status_code == 200
    assert d["slipped"]["delayed_vs_yesterday"]["count"] == r_sl.json()["count"]
    assert abs(d["slipped"]["delayed_vs_yesterday"]["acv"] - r_sl.json()["acv"]) < 0.1

    # Deals endpoint for period_start matches main figure in summary
    r_sl_main = client.get("/api/v2/delayed/deals?compare=period_start&kind=slipped")
    assert r_sl_main.status_code == 200
    assert d["slipped"]["count"] == r_sl_main.json()["count"]
    assert abs(d["slipped"]["acv"] - r_sl_main.json()["acv"]) < 0.1
    
    # Overdue should match overdue deals endpoint (standing current count)
    r_od = client.get("/api/v2/delayed/deals?compare=yesterday&kind=overdue")
    assert r_od.status_code == 200
    assert d["overdue"]["count"] == r_od.json()["count"]
    assert abs(d["overdue"]["acv"] - r_od.json()["acv"]) < 0.1

def test_delayed_summary_last_week(client_and_db):
    client, _ = client_and_db
    r = client.get("/api/v2/delayed/summary?compare=last_week")
    assert r.status_code == 200
    d = r.json()
    assert "delayed_vs_lastweek" in d["total"]

    # Slipped deals endpoint for last_week matches last_week window in summary
    r_sl = client.get("/api/v2/delayed/deals?compare=last_week&kind=slipped")
    assert r_sl.status_code == 200
    assert d["slipped"]["delayed_vs_lastweek"]["count"] == r_sl.json()["count"]
    assert abs(d["slipped"]["delayed_vs_lastweek"]["acv"] - r_sl.json()["acv"]) < 0.1
    
    # Total delayed vs last week (slipped + later close + overdue) matches kind=all
    r_all = client.get("/api/v2/delayed/deals?compare=last_week&kind=all")
    assert r_all.status_code == 200
    assert d["total"]["delayed_vs_lastweek"]["count"] == r_all.json()["count"]
    assert abs(d["total"]["delayed_vs_lastweek"]["acv"] - r_all.json()["acv"]) < 0.1

def test_delayed_deals_endpoint(client_and_db):
    client, _ = client_and_db
    # Test a combination of filters to ensure they match summary output
    r_all = client.get("/api/v2/delayed/deals?compare=yesterday&kind=all&region=Europe&category=Commit")
    assert r_all.status_code == 200
    data_all = r_all.json()
    assert data_all["count"] == len(data_all["deals"])
    
    r_od = client.get("/api/v2/delayed/deals?compare=yesterday&kind=overdue&region=Europe&category=Commit")
    assert r_od.status_code == 200
    data_od = r_od.json()
    assert data_od["count"] == len(data_od["deals"])

    r_sl = client.get("/api/v2/delayed/deals?compare=yesterday&kind=slipped&region=Europe&category=Commit")
    assert r_sl.status_code == 200
    data_sl = r_sl.json()
    assert data_sl["count"] == len(data_sl["deals"])

    r_later = client.get("/api/v2/delayed/deals?compare=yesterday&kind=later_close&region=Europe&category=Commit")
    assert r_later.status_code == 200
    data_later = r_later.json()
    assert data_later["count"] == len(data_later["deals"])

    # Under Slippage/Delayed split: kind=all represents Delayed Renewals (overdue + later_close)
    # Slipped is tracked separately under kind=slipped (Slippage)
    assert data_all["count"] == data_od["count"] + data_later["count"]
    
def test_lost_deals_endpoint(client_and_db):
    client, _ = client_and_db
    # Lost vs last week
    r = client.get("/api/v2/delayed/deals?compare=last_week&kind=lost")
    assert r.status_code == 200
    r_s = client.get("/api/v2/delayed/summary?compare=last_week")
    assert r_s.status_code == 200
    assert r.json()["count"] == r_s.json()["lost"]["delayed_vs_lastweek"]["count"]
    assert abs(r.json()["acv"] - r_s.json()["lost"]["delayed_vs_lastweek"]["acv"]) < 0.1

    # Lost vs yesterday matches summary
    r_y = client.get("/api/v2/delayed/deals?compare=yesterday&kind=lost")
    assert r_y.status_code == 200
    r_sy = client.get("/api/v2/delayed/summary?compare=yesterday")
    assert r_sy.status_code == 200
    assert r_y.json()["count"] == r_sy.json()["lost"]["delayed_vs_yesterday"]["count"]
    
def test_delayed_deals_no_snapshot(client_and_db):
    # Time travel to a date with NO compare snapshots
    client, _ = client_and_db
    r = client.get("/api/v2/delayed/deals?as_of=2000-01-01&compare=yesterday&kind=all")
    assert r.status_code == 200
    assert r.json()["count"] == 0

def test_delayed_summary_uuid_compare_not_500(client_and_db):
    client, _ = client_and_db
    # GET /api/v2/delayed/summary?compare=<uuid> must not 500
    r = client.get("/api/v2/delayed/summary?compare=59d7e47e-c9e1-4bbd-9c80-33f756c17a33")
    assert r.status_code != 500
