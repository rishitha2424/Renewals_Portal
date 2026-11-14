#!/usr/bin/env python3
"""
Smoke test script for Mobileum Horizon page endpoints.
Hits every core page endpoint for the latest snapshot:
  - Health
  - Settings
  - Uploads history
  - Overview
  - Approvals
  - Regions (list)
  - Regions (detail for first region)
  - Business Units
  - Delayed Renewals
  - Expiry
  - Explorer
  - Executive (Reconcile / Executive view)

All must return HTTP 200. Prints status + duration per endpoint.
Exits with code 0 on success, non-zero on any failure.
"""
from __future__ import annotations

import os
import sys
import time

# Ensure repository root is on path
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from fastapi.testclient import TestClient
from backend.main import app
from backend.database import SessionLocal
from backend.models.snapshot import UploadSnapshot


def _extract_deal_count(name: str, data: Any) -> str:
    if not isinstance(data, dict):
        return ""
    if name == "Overview":
        cnt = data.get("total", {}).get("count")
        return f"({cnt} deals)" if cnt is not None else ""
    elif name == "Approvals":
        cnt = data.get("total", {}).get("count") or data.get("overview_reconciliation", {}).get("approvals_count")
        return f"({cnt} deals)" if cnt is not None else ""
    elif name == "Regions (list)":
        cnt = data.get("total", {}).get("count") or sum(r.get("count", 0) for r in data.get("regions", []))
        return f"({cnt} deals)" if cnt is not None else ""
    elif name == "Regions detail":
        cnt = data.get("count") or data.get("total_count")
        return f"({cnt} deals)" if cnt is not None else ""
    elif name == "Business Units":
        cnt = data.get("totals", {}).get("grand", {}).get("count") or data.get("total", {}).get("count")
        return f"({cnt} deals)" if cnt is not None else ""
    elif name == "Delayed Renewals":
        cnt = data.get("delayed_renewals", {}).get("total", {}).get("count")
        return f"({cnt} deals)" if cnt is not None else ""
    elif name == "Expiry":
        grid = data.get("grids", {})
        cnt = None
        for y, g in grid.items():
            if isinstance(g, dict) and "totals" in g:
                cnt = g.get("totals", {}).get("grand", {}).get("count")
                break
        return f"({cnt} deals)" if cnt is not None else ""
    elif name == "Explorer":
        cnt = data.get("total_rows")
        return f"({cnt} rows)" if cnt is not None else ""
    elif name == "Executive":
        cnt = data.get("whole_snapshot", {}).get("total_rows")
        return f"({cnt} rows)" if cnt is not None else ""
    elif name == "Uploads history":
        snaps = data.get("snapshots", [])
        return f"({len(snaps)} snapshots)"
    return ""


def run_smoke_tests() -> int:
    client = TestClient(app)
    db = SessionLocal()

    # Find latest snapshot
    latest_snap = (
        db.query(UploadSnapshot)
        .filter(UploadSnapshot.is_active_today == True)
        .first()
    )
    if not latest_snap:
        latest_snap = (
            db.query(UploadSnapshot)
            .order_by(UploadSnapshot.snapshot_date.desc())
            .first()
        )
    snap_id = latest_snap.id if latest_snap else None
    snap_date_str = latest_snap.snapshot_date.isoformat() if latest_snap else None
    db.close()

    print(f"Running smoke tests against latest snapshot: {snap_id} ({snap_date_str})\n" + "=" * 65)

    endpoints = [
        ("Health", "/api/health"),
        ("Settings", "/api/settings"),
        ("Uploads history", "/api/snapshots/history"),
        ("Overview", f"/api/v2/overview/summary{f'?as_of={snap_id}' if snap_id else ''}"),
        ("Approvals", f"/api/v2/approvals/summary{f'?as_of={snap_id}' if snap_id else ''}"),
        ("Regions (list)", f"/api/v2/regions/summary{f'?as_of={snap_id}' if snap_id else ''}"),
        ("Business Units", f"/api/v2/business-units/summary{f'?as_of={snap_id}' if snap_id else ''}"),
        ("Delayed Renewals", f"/api/v2/delayed/summary{f'?as_of={snap_id}' if snap_id else ''}"),
        ("Expiry", f"/api/v2/expiry/summary{f'?as_of={snap_id}' if snap_id else ''}"),
        ("Explorer", f"/api/v2/explorer/rows{f'?as_of={snap_id}' if snap_id else ''}"),
        ("Executive", f"/api/v2/explorer/reconcile{f'?as_of={snap_id}' if snap_id else ''}"),
    ]

    failures = 0
    total_start = time.perf_counter()

    for name, path in endpoints:
        start_t = time.perf_counter()
        try:
            resp = client.get(path)
            duration_ms = (time.perf_counter() - start_t) * 1000
            status = resp.status_code
            if status == 200:
                cnt_str = _extract_deal_count(name, resp.json())
                print(f"[PASS] {name:<22} -> HTTP {status} {cnt_str:<16} in {duration_ms:6.1f} ms ({path})")
            else:
                print(f"[FAIL] {name:<22} -> HTTP {status} in {duration_ms:6.1f} ms ({path})")
                print(f"       Response: {resp.text[:200]}")
                failures += 1

            # If this is Regions list, also hit detail for first region
            if name == "Regions (list)" and status == 200:
                data = resp.json()
                reg_list = data.get("regions", [])
                first_reg_name = None
                if reg_list and isinstance(reg_list, list) and isinstance(reg_list[0], dict):
                    first_reg_name = reg_list[0].get("region")
                if not first_reg_name:
                    first_reg_name = "Europe"

                reg_detail_path = f"/api/v2/regions/{first_reg_name}/summary{f'?as_of={snap_id}' if snap_id else ''}"
                start_rd = time.perf_counter()
                resp_rd = client.get(reg_detail_path)
                dur_rd = (time.perf_counter() - start_rd) * 1000
                if resp_rd.status_code == 200:
                    rd_cnt_str = _extract_deal_count("Regions detail", resp_rd.json())
                    print(f"[PASS] {'Regions detail':<22} -> HTTP {resp_rd.status_code} {rd_cnt_str:<16} in {dur_rd:6.1f} ms ({reg_detail_path})")
                else:
                    print(f"[FAIL] {'Regions detail':<22} -> HTTP {resp_rd.status_code} in {dur_rd:6.1f} ms ({reg_detail_path})")
                    print(f"       Response: {resp_rd.text[:200]}")
                    failures += 1
        except Exception as exc:
            duration_ms = (time.perf_counter() - start_t) * 1000
            print(f"[EXC]  {name:<22} -> Exception after {duration_ms:6.1f} ms: {exc}")
            failures += 1

    total_duration = time.perf_counter() - total_start
    print("=" * 65)
    print(f"Smoke test completed in {total_duration:.2f}s with {failures} failure(s).")
    return 1 if failures > 0 else 0


if __name__ == "__main__":
    sys.exit(run_smoke_tests())
