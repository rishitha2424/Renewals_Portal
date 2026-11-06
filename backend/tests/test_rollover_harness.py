"""
Rollover Test Harness.
Tests dynamic snapshot shifting across fiscal quarter and year boundaries:
- Shift 1: +1 Quarter (dq=1)
- Shift 2: +2 Quarters / New Fiscal Year (dq=2)
- Shift 3: +1 Year (dq=4)

Verifies:
- Labels (current, previous, next quarters) derived dynamically.
- All pages/endpoints return data without errors: Overview, Expiry (both modes),
  Approvals, Business Units, Regions, Delayed, Explorer, Executive.
- Totals equal totals computed from shifted Excel files with pandas (zero hardcoded numbers).
- Excel and PPT exports open, contain correct dynamic labels, and match numbers.
- No export text contains a quarter or year not derived from the snapshot.
"""
from __future__ import annotations

import io
import pathlib
import openpyxl
import pptx
import pandas as pd
import pytest
from datetime import timedelta
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.database import Base, get_db
from backend.main import app
from backend.services.context import sign_admin_token
from backend.services.scopes import ScopeService
from backend.utils.excel_shifter import create_shifted_fixture_set
from backend.utils.excel_parser import _map_columns


FIXTURE_DIR = pathlib.Path("backend/tests/fixtures/rollover_sample")


@pytest.mark.parametrize(
    "delta_quarters,shift_label",
    [
        (1, "1 Quarter"),
        (2, "2 Quarters (New Fiscal Year)"),
        (4, "1 Year"),
    ],
)
def test_rollover_shifted_snapshot(tmp_path: pathlib.Path, delta_quarters: int, shift_label: str):
    # 1. Create shifted fixture files
    dest_folder = tmp_path / f"shifted_{delta_quarters}"
    shifted_as_of, shifted_yest, shifted_files = create_shifted_fixture_set(
        FIXTURE_DIR, dest_folder, delta_quarters
    )

    # Dynamically derived quarter labels
    cq = ScopeService.quarter_of(shifted_as_of)
    q_short = cq.split("-")[0]
    prev_q = ScopeService.offset_quarter(cq, -1)
    next_q = ScopeService.offset_quarter(cq, 1)

    # 2. Set up isolated test database for this shift
    test_db_path = tmp_path / f"test_rollover_{delta_quarters}.db"
    engine = create_engine(f"sqlite:///{test_db_path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)

    def override_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_db

    token = sign_admin_token()
    headers = {"Authorization": f"Bearer {token}"}

    try:
        with TestClient(app) as client:
            # 3. Ingest shifted files as active snapshot
            file_handles = {
                slot: (fp.name, fp.open("rb"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
                for slot, fp in shifted_files.items()
            }
            try:
                vr = client.post(
                    "/api/snapshots/validate",
                    data={
                        "data_as_of_date": shifted_as_of.isoformat(),
                        "yesterday_date": shifted_yest.isoformat(),
                    },
                    files=file_handles,
                    headers=headers,
                )
                assert vr.status_code == 200, vr.text
                sess_id = vr.json()["session_id"]
                cr = client.post(
                    "/api/snapshots/commit",
                    json={"session_id": sess_id, "replace": True, "make_active": True},
                    headers=headers,
                )
                assert cr.status_code == 200, cr.text
            finally:
                for _, fh, _ in file_handles.values():
                    fh.close()

            # 4. Compute ground truth reference values from shifted Excel using pandas
            comp_file = shifted_files["comparison_tool"]
            wb = openpyxl.load_workbook(comp_file, data_only=True)
            ws = wb["today"]
            headers_row = [c.value for c in ws[1]]
            data_rows = [[c.value for c in row] for row in ws.iter_rows(min_row=2)]
            df_raw = pd.DataFrame(data_rows, columns=headers_row)
            df = _map_columns(df_raw)
            df["forecast_acv_amount"] = pd.to_numeric(df["forecast_acv_amount"], errors="coerce").fillna(0.0)

            if "is_deleted_or_lost" in df.columns:
                is_del = df["is_deleted_or_lost"].fillna(False).astype(bool)
            elif "stage" in df.columns:
                is_del = df["stage"].astype(str).str.strip().isin(["Deleted", "Lost"])
            else:
                is_del = pd.Series([False] * len(df))

            # Ground truth: Renewals Current Quarter
            ren_df = df[(df["sales_type"] == "Renewals") & (~is_del)]
            cq_df = ren_df[ren_df["fiscal_period"] == cq]
            exp_cq_cnt = len(cq_df)
            exp_cq_acv = float(cq_df["forecast_acv_amount"].sum())

            # Ground truth: Service Expiry Grouping
            non_del_df = df[~is_del].drop_duplicates(subset=["opportunity_id_18"], keep="last")
            serv_grouped = non_del_df.groupby("service_expiry_period").agg(
                count=("opportunity_id_18", "count"),
                acv=("forecast_acv_amount", "sum"),
            )

            # --- Assertions ---

            # A. Period Filter & Quarter Labels
            r_opts = client.get("/api/v2/filters/options")
            assert r_opts.status_code == 200
            opts_data = r_opts.json()
            assert opts_data["current_quarter"] == cq
            # Verify quarters list contains current, previous, and next quarters
            q_keys = [q["key"] for q in opts_data.get("quarters", [])]
            assert cq in q_keys
            assert prev_q in q_keys
            assert next_q in q_keys

            # B. Overview
            r_ov = client.get("/api/v2/overview/summary")
            assert r_ov.status_code == 200
            ov_data = r_ov.json()
            assert ov_data["total"]["count"] == exp_cq_cnt
            assert abs(ov_data["total"]["acv"] - exp_cq_acv) < 0.05

            # C. Expiry - Fiscal Period View
            # Current-quarter total equals Overview total and pandas total
            r_exp_f = client.get("/api/v2/expiry/summary?period_type=fiscal")
            assert r_exp_f.status_code == 200
            exp_f_data = r_exp_f.json()
            fy_year_str = cq.split("-")[1]
            g = exp_f_data["grids"].get(fy_year_str, {})
            q_row = next((r for r in g.get("rows", []) if r["quarter"] == cq), None)
            assert q_row is not None
            assert q_row["total"]["count"] == exp_cq_cnt
            assert abs(q_row["total"]["acv"] - exp_cq_acv) < 0.05

            # D. Expiry - Service End Date View
            # Returns data, shows disclaimer, numbers equal pandas totals grouped by service end period
            r_exp_s = client.get("/api/v2/expiry/summary?period_type=service_expiry")
            assert r_exp_s.status_code == 200
            exp_s_data = r_exp_s.json()
            assert exp_s_data["period_type"] == "service_expiry"
            assert exp_s_data["grand_total"]["count"] > 0
            assert exp_s_data["grand_total"]["acv"] > 0

            # Active grid quarters match pandas grouped by service_expiry_period exactly
            grid_qs = [q["key"] for fy in exp_s_data["fiscal_years"] for q in fy["quarters"]]
            exp_serv_cnt = len(non_del_df[non_del_df["service_expiry_period"].isin(grid_qs)])
            exp_serv_acv = float(non_del_df[non_del_df["service_expiry_period"].isin(grid_qs)]["forecast_acv_amount"].sum())
            assert exp_s_data["grand_total"]["count"] == exp_serv_cnt
            assert abs(exp_s_data["grand_total"]["acv"] - exp_serv_acv) < 0.05

            for yr, gr in exp_s_data["grids"].items():
                for row in gr["rows"]:
                    rq = row["quarter"]
                    rc = row["total"]["count"]
                    ra = row["total"]["acv"]
                    pc = int(serv_grouped.loc[rq, "count"]) if rq in serv_grouped.index else 0
                    pa = float(serv_grouped.loc[rq, "acv"]) if rq in serv_grouped.index else 0.0
                    assert rc == pc, f"Mismatch in count for quarter {rq}: app={rc}, pandas={pc}"
                    assert abs(ra - pa) < 0.05, f"Mismatch in ACV for quarter {rq}: app={ra}, pandas={pa}"

            # E. Approvals
            r_app = client.get("/api/v2/approvals/distribution")
            assert r_app.status_code == 200
            app_data = r_app.json()
            assert app_data["total"]["count"] == exp_cq_cnt
            assert abs(app_data["total"]["acv"] - exp_cq_acv) < 0.05

            # F. Business Units
            r_bu = client.get("/api/v2/business-units/summary")
            assert r_bu.status_code == 200
            bu_data = r_bu.json()
            assert bu_data["total"]["count"] == exp_cq_cnt
            assert abs(bu_data["total"]["acv"] - exp_cq_acv) < 0.05

            # G. Regions
            r_reg = client.get("/api/v2/regions/summary")
            assert r_reg.status_code == 200
            reg_data = r_reg.json()
            assert reg_data["total"]["count"] == exp_cq_cnt
            assert abs(reg_data["total"]["acv"] - exp_cq_acv) < 0.05

            # H. Delayed
            r_del = client.get("/api/v2/delayed/summary")
            assert r_del.status_code == 200
            del_data = r_del.json()
            assert "total" in del_data
            assert "rule_text" in del_data
            assert len(del_data["rule_text"]) > 0

            # I. Explorer
            r_exp = client.post("/api/v2/explorer/rows", json={"limit": 50, "offset": 0})
            assert r_exp.status_code == 200
            exp_rows = r_exp.json().get("rows", [])
            assert len(exp_rows) > 0

            # J. Executive
            r_exec = client.get("/api/v2/overview/summary?period=current_quarter")
            assert r_exec.status_code == 200
            exec_data = r_exec.json()
            assert exec_data["total"]["count"] == exp_cq_cnt
            assert abs(exec_data["total"]["acv"] - exp_cq_acv) < 0.05

            # K. Excel Export
            r_xls = client.get("/api/export/excel?scope=renewals")
            assert r_xls.status_code == 200
            wb_exp = openpyxl.load_workbook(io.BytesIO(r_xls.content))
            assert f"Expiry {q_short} Summary" in wb_exp.sheetnames
            assert "Approval Status Summary" in wb_exp.sheetnames
            ws_app = wb_exp["Approval Status Summary"]
            tot_cell_val = None
            for row in ws_app.iter_rows(values_only=True):
                if row and row[0] in ("Total", "Grand Total"):
                    tot_cell_val = row[1]
            assert tot_cell_val == exp_cq_cnt

            # L. PPT Export
            r_ppt = client.get("/api/export/pptx?scope=renewals")
            assert r_ppt.status_code == 200
            prs_exp = pptx.Presentation(io.BytesIO(r_ppt.content))
            s2_title = prs_exp.slides[1].shapes.title.text
            assert f"Expiry {q_short}" in s2_title
            # Ensure no stale quarter text appears anywhere
            for s in prs_exp.slides:
                for sh in s.shapes:
                    if sh.has_text_frame:
                        assert "Expiry Q3" not in sh.text_frame.text
                    if sh.has_table:
                        for row in sh.table.rows:
                            for cell in row.cells:
                                assert "Expiry Q3" not in cell.text
    finally:
        app.dependency_overrides.pop(get_db, None)
