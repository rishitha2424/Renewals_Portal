#!/usr/bin/env python3
"""
Smoke test script for testing multiple periods, types, and scope variations.
Ensures zero 4xx/5xx errors, valid JSON, and no NaN/Infinity.
"""
import os
import sys
import time

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from fastapi.testclient import TestClient
from backend.main import app
from backend.database import SessionLocal
from backend.models.snapshot import UploadSnapshot

def run_smoke_periods():
    client = TestClient(app)
    from backend.config import settings
    from backend.services.auth_service import ensure_default_accounts
    with SessionLocal() as db_init:
        accs = ensure_default_accounts(db_init)
        admin_user = accs.get("admin")
        owner_email = admin_user.email if admin_user else (settings.OWNER_EMAIL or "admin")
    login_resp = client.post("/api/auth/login", json={"email": owner_email, "password": settings.ADMIN_PASSWORD})
    if login_resp.status_code == 200:
        token = login_resp.cookies.get("auth_token") or login_resp.json().get("token")
        if token:
            client.cookies.set("auth_token", token)
            client.headers["Authorization"] = f"Bearer {token}"

    db = SessionLocal()
    snap = db.query(UploadSnapshot).filter(UploadSnapshot.is_active_today == True).first()
    if not snap:
        snap = db.query(UploadSnapshot).order_by(UploadSnapshot.snapshot_date.desc()).first()
    db.close()
    
    assert snap is not None, "No active or valid snapshot found"
    snap_id = snap.id
    snap_date = snap.snapshot_date.isoformat()
    print(f"Testing periods against snapshot: {snap_id} ({snap_date})")

    periods = ["current_quarter", "next_quarter", "last_quarter", "FY2026", "FY2027"]
    endpoints = [
        "/api/v2/overview/summary",
        "/api/v2/approvals/summary",
        "/api/v2/regions/summary",
        "/api/v2/business-units/summary",
        "/api/v2/delayed/summary",
        "/api/v2/expiry/summary",
    ]

    failures = 0
    total = 0

    for period in periods:
        for incl in [False, True]:
            for ep in endpoints:
                total += 1
                url = f"{ep}?as_of={snap_id}&period={period}&include_deleted_lost={'true' if incl else 'false'}"
                t0 = time.time()
                try:
                    r = client.get(url)
                    dur = (time.time() - t0) * 1000
                    if r.status_code != 200:
                        print(f"[FAIL] {ep} | {period} | incl={incl} -> HTTP {r.status_code} in {dur:.1f}ms: {r.text[:100]}")
                        failures += 1
                    else:
                        data = r.json()
                        raw_text = r.text
                        if "NaN" in raw_text or "Infinity" in raw_text:
                            print(f"[FAIL] {ep} | {period} | incl={incl} -> Contained NaN/Infinity!")
                            failures += 1
                        else:
                            print(f"[PASS] {ep} | {period} | incl={incl} -> 200 OK in {dur:.1f}ms")
                except Exception as exc:
                    print(f"[ERROR] {ep} | {period} | incl={incl} -> {exc}")
                    failures += 1

    print(f"\nCompleted {total} requests with {failures} failure(s).")
    return failures

if __name__ == "__main__":
    sys.exit(run_smoke_periods())

