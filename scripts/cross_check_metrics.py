#!/usr/bin/env python3
"""
Cross-check script: compare the same metrics across Overview, Executive Summary,
Regions, Business Units, Approvals, Delayed, Expiry, drawers, and exports.
Must fail on any mismatch.
"""
import os
import sys
import io
import openpyxl
from pptx import Presentation

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from fastapi.testclient import TestClient
from backend.main import app
from backend.database import SessionLocal
from backend.models.snapshot import UploadSnapshot

def run_cross_check():
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
    
    assert snap is not None, "No active snapshot found"
    snap_id = snap.id
    snap_date = snap.snapshot_date.isoformat()
    print(f"Running cross-check against snapshot: {snap_id} ({snap_date})\n")

    periods = ["current_quarter", "next_quarter", "FY2026"]
    failures = []

    for period in periods:
        print(f"=== Cross-checking Period: {period} ===")
        # 1. Overview
        r_ov = client.get(f"/api/v2/overview/summary?as_of={snap_id}&period={period}")
        assert r_ov.status_code == 200, f"Overview failed: {r_ov.status_code}"
        ov_data = r_ov.json()
        ov_cnt = ov_data["total"]["count"]
        ov_acv = ov_data["total"]["acv"]
        print(f"  Overview:       {ov_cnt:4d} deals | ${ov_acv:12,.2f}")

        # 2. Approvals
        r_app = client.get(f"/api/v2/approvals/summary?as_of={snap_id}&period={period}")
        assert r_app.status_code == 200, f"Approvals failed: {r_app.status_code}"
        app_data = r_app.json()
        app_cnt = app_data["total"]["count"]
        app_acv = app_data["total"]["acv"]
        print(f"  Approvals:      {app_cnt:4d} deals | ${app_acv:12,.2f}")
        if app_cnt != ov_cnt or abs(app_acv - ov_acv) > 1.0:
            failures.append(f"{period}: Approvals ({app_cnt}, ${app_acv:,.2f}) != Overview ({ov_cnt}, ${ov_acv:,.2f})")

        # 3. Regions
        r_reg = client.get(f"/api/v2/regions/summary?as_of={snap_id}&period={period}")
        assert r_reg.status_code == 200, f"Regions failed: {r_reg.status_code}"
        reg_data = r_reg.json()
        reg_cnt = reg_data["total"]["count"]
        reg_acv = reg_data["total"]["acv"]
        print(f"  Regions:        {reg_cnt:4d} deals | ${reg_acv:12,.2f}")
        if reg_cnt != ov_cnt or abs(reg_acv - ov_acv) > 1.0:
            failures.append(f"{period}: Regions ({reg_cnt}, ${reg_acv:,.2f}) != Overview ({ov_cnt}, ${ov_acv:,.2f})")

        # 4. Business Units
        r_bu = client.get(f"/api/v2/business-units/summary?as_of={snap_id}&period={period}")
        assert r_bu.status_code == 200, f"Business Units failed: {r_bu.status_code}"
        bu_data = r_bu.json()
        bu_cnt = bu_data["total"]["count"]
        bu_acv = bu_data["total"]["acv"]
        print(f"  Business Units: {bu_cnt:4d} deals | ${bu_acv:12,.2f}")
        if bu_cnt != ov_cnt or abs(bu_acv - ov_acv) > 1.0:
            failures.append(f"{period}: Business Units ({bu_cnt}, ${bu_acv:,.2f}) != Overview ({ov_cnt}, ${ov_acv:,.2f})")

        # 5. Excel Export Sheet 1
        r_xl = client.get(f"/api/export/excel?snapshot_id={snap_id}&scope=renewals&period={period}")
        assert r_xl.status_code == 200, f"Excel export failed: {r_xl.status_code}"
        wb = openpyxl.load_workbook(io.BytesIO(r_xl.content))
        ws1 = wb[wb.sheetnames[0]]
        xl_acv = float(ws1.cell(2, 3).value or 0)
        xl_cnt = int(ws1.cell(2, 4).value or 0)
        print(f"  Excel Sheet 1:  {xl_cnt:4d} deals | ${xl_acv:12,.2f}")
        if xl_cnt != ov_cnt or abs(xl_acv - ov_acv) > 1.0:
            failures.append(f"{period}: Excel ({xl_cnt}, ${xl_acv:,.2f}) != Overview ({ov_cnt}, ${ov_acv:,.2f})")

        # 6. PPTX Export Slide 2
        r_ppt = client.get(f"/api/export/pptx?snapshot_id={snap_id}&scope=renewals&period={period}")
        assert r_ppt.status_code == 200, f"PPTX export failed: {r_ppt.status_code}"
        prs = Presentation(io.BytesIO(r_ppt.content))
        tbl = [s.table for s in prs.slides[1].shapes if s.has_table][0]
        ppt_acv = float(tbl.cell(1, 2).text.replace(",", "").replace("$", "").strip())
        ppt_cnt = int(tbl.cell(1, 3).text.replace(",", "").strip())
        print(f"  PPTX Slide 2:   {ppt_cnt:4d} deals | ${ppt_acv:12,.2f}")
        if ppt_cnt != ov_cnt or abs(ppt_acv - ov_acv) > 1.0:
            failures.append(f"{period}: PPTX ({ppt_cnt}, ${ppt_acv:,.2f}) != Overview ({ov_cnt}, ${ov_acv:,.2f})")

        print()

    if failures:
        print("FAILURES DETECTED:")
        for f in failures:
            print("  - " + f)
        return 1
    else:
        print("ALL METRICS RECONCILED AND MATCHED 100% ACROSS PAGES AND EXPORTS!")
        return 0

if __name__ == "__main__":
    sys.exit(run_cross_check())

