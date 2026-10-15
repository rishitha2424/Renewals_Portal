import pytest
from datetime import date
from pathlib import Path
import pandas as pd
from backend.models.snapshot import UploadSnapshot
from backend.services.scopes import ScopeService
from backend.utils.excel_parser import detect_file_slot, detect_suggested_snapshot_date

ACV_ABS = 0.01

def get_fixture_comparison_file() -> tuple[Path, date]:
    """Finds the Comparison Tool workbook in data/sample_oct7 or data/ and detects snapshot date."""
    search_dirs = [Path("data/sample_oct7"), Path("data")]
    for s_dir in search_dirs:
        if s_dir.exists():
            for fp in sorted(s_dir.glob("*.xlsx")):
                slot, _ = detect_file_slot(fp)
                if slot == "comparison_tool":
                    d = detect_suggested_snapshot_date(fp)
                    if d:
                        return fp, d
    # Fallback to any comparison file
    for s_dir in search_dirs:
        if s_dir.exists():
            for fp in sorted(s_dir.glob("*.xlsx")):
                d = detect_suggested_snapshot_date(fp)
                if d:
                    return fp, d
    raise FileNotFoundError("No comparison tool fixture found")

def build_expected_matrix_from_excel(comp_file: Path, scope_period: str, snap_date: date):
    """
    Builds the expected BU x forecast-category matrix with pandas directly from the fixture Excel file.
    Does NOT hardcode any numbers, quarter names, or business unit names.
    """
    df_raw = pd.read_excel(comp_file, sheet_name="today")

    # Dynamically find column names
    bu_col = [c for c in df_raw.columns if str(c).lower().strip() in ("business unit", "business_unit")][0]
    fc_col = [c for c in df_raw.columns if str(c).lower().strip() in ("forecast category", "forecast_category")][0]
    acv_col = [c for c in df_raw.columns if str(c).lower().strip() in ("forecast acv amount", "forecast_acv_amount")][0]
    st_col = [c for c in df_raw.columns if str(c).lower().strip() in ("sales type", "sales_type")][0]
    fp_col = [c for c in df_raw.columns if str(c).lower().strip() in ("fiscal period", "fiscal_period")][0]

    # Filter Sales Type == 'Renewals'
    df = df_raw[df_raw[st_col] == "Renewals"].copy()

    # Scope period filter
    if scope_period == "current_quarter":
        cq = ScopeService.quarter_of(snap_date)
        df = df[df[fp_col] == cq].copy()
    elif scope_period in ("all", "all_periods"):
        pass # All periods included

    def norm_bu(v):
        if pd.isna(v): return "Unassigned"
        s = str(v).strip()
        if s in ("", "nan", "None"): return "Unassigned"
        return s

    def norm_fc(v):
        if pd.isna(v): return "Blank"
        s = str(v).strip()
        if s in ("", "Not yet proposed", "nan", "None"): return "Blank"
        return s

    df["clean_bu"] = df[bu_col].apply(norm_bu)
    df["clean_fc"] = df[fc_col].apply(norm_fc)
    df["clean_acv"] = pd.to_numeric(df[acv_col], errors="coerce").fillna(0.0)

    g = df.groupby(["clean_bu", "clean_fc"])["clean_acv"].agg(["count", "sum"])
    bu_tot = df.groupby("clean_bu")["clean_acv"].agg(["count", "sum"])
    fc_tot = df.groupby("clean_fc")["clean_acv"].agg(["count", "sum"])

    return {
        "df": df,
        "grouped": g,
        "bu_totals": bu_tot,
        "fc_totals": fc_tot,
        "grand_count": int(len(df)),
        "grand_acv": float(round(df["clean_acv"].sum(), 2)),
    }


@pytest.fixture(scope="module")
def client_and_db(tmp_path_factory):
    """Upload fixture files and return TestClient + Session factory."""
    import os
    os.environ.setdefault("DATABASE_URL", "sqlite:///./test_v2_business_units.db")

    from fastapi.testclient import TestClient
    from backend.database import get_db
    from backend.main import app
    from backend.tests.test_db_helper import get_test_engine_and_session

    engine, Session = get_test_engine_and_session("test_v2_business_units", tmp_path_factory)

    def override_db():
        db = Session()
        try: yield db
        finally: db.close()

    app.dependency_overrides[get_db] = override_db

    sample = Path("data/sample_oct7")
    slots = {}
    snap_date = None
    for fp in sorted(sample.glob("*.xlsx")):
        slot, _ = detect_file_slot(fp)
        slots[slot] = fp
        if not snap_date:
            sd = detect_suggested_snapshot_date(fp)
            if sd:
                snap_date = sd

    date_str = snap_date.isoformat() if snap_date else "2026-10-07"

    with TestClient(app) as client:
        # Validate
        files = [(slot, (fp.name, open(fp, "rb"),
                 "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
                 for slot, fp in slots.items()]
        data = {"data_as_of_date": date_str}
        vr = client.post("/api/snapshots/validate", data=data, files=files)
        assert vr.status_code == 200, vr.text
        session_id = vr.json()["session_id"]

        # Commit
        cr = client.post("/api/snapshots/commit",
                         json={"session_id": session_id, "replace": False})
        assert cr.status_code == 200, cr.text

        yield client, Session()

    # Cleanup
    app.dependency_overrides.clear()


@pytest.mark.parametrize("scope_period", ["current_quarter", "all_periods"])
def test_bu_heatmap_and_drawer_tie_to_excel(client_and_db, scope_period):
    """
    Test that for ANY uploaded day:
    1. Expected matrix is built directly with pandas from the fixture Excel file.
    2. Heatmap cell count and ACV == expected from Excel.
    3. Drawer count and ACV == heatmap cell exactly.
    4. Row totals, column totals, and grand total match under both current quarter and all periods.
    5. Multi-value BUs (e.g. 'Roaming; Security') are retained as distinct rows and match.
    6. Independent runtime recompute (/reconcile) returns 'reconciles' with 0 diffs.
    """
    client, _ = client_and_db
    comp_file, snap_date = get_fixture_comparison_file()
    date_str = snap_date.isoformat()

    # 1. Build expected matrix from Excel with pandas
    expected = build_expected_matrix_from_excel(comp_file, scope_period, snap_date)

    # 2. Query heatmap summary from service
    sum_res = client.get(
        "/api/v2/business-units/summary",
        params={"as_of": date_str, "period": scope_period}
    ).json()

    # 3. Assert Grand Total: heatmap == expected
    assert sum_res["total"]["count"] == expected["grand_count"]
    assert sum_res["total"]["acv"] == pytest.approx(expected["grand_acv"], abs=ACV_ABS)

    # Drawer grand total == heatmap
    drawer_grand = client.get(
        "/api/v2/business-units/deals",
        params={"as_of": date_str, "period": scope_period}
    ).json()
    assert drawer_grand["count"] == sum_res["total"]["count"]
    assert drawer_grand["acv"] == pytest.approx(sum_res["total"]["acv"], abs=ACV_ABS)

    # 4. Assert every BU row and every category cell
    heatmap_rows = {r["bu"]: r for r in sum_res["rows"]}
    all_expected_bus = list(expected["bu_totals"].index)

    # Multi-value BUs must be present if in Excel
    multi_bus = [b for b in all_expected_bus if ";" in b]
    for mb in multi_bus:
        assert mb in heatmap_rows, f"Multi-value BU '{mb}' missing from heatmap"

    for bu in all_expected_bus:
        exp_bu = expected["bu_totals"].loc[bu]
        act_row = heatmap_rows.get(bu)
        assert act_row is not None, f"BU '{bu}' missing from heatmap rows"

        # Row total: heatmap == expected
        assert act_row["count"] == int(exp_bu["count"])
        assert act_row["acv"] == pytest.approx(float(exp_bu["sum"]), abs=ACV_ABS)

        # Drawer row total == heatmap
        drawer_row = client.get(
            "/api/v2/business-units/deals",
            params={"as_of": date_str, "period": scope_period, "bu": bu}
        ).json()
        assert drawer_row["count"] == act_row["count"]
        assert drawer_row["acv"] == pytest.approx(act_row["acv"], abs=ACV_ABS)

        # Each category cell
        for fc in ["Closed", "Commit", "Best Case", "Pipeline", "Blank"]:
            exp_cell_count = int(expected["grouped"].loc[(bu, fc), "count"]) if (bu, fc) in expected["grouped"].index else 0
            exp_cell_acv = float(expected["grouped"].loc[(bu, fc), "sum"]) if (bu, fc) in expected["grouped"].index else 0.0

            act_cell = act_row["cells"].get(fc, {"count": 0, "acv": 0.0})
            assert act_cell["count"] == exp_cell_count, f"Cell count mismatch for ({bu}, {fc})"
            assert act_cell["acv"] == pytest.approx(exp_cell_acv, abs=ACV_ABS), f"Cell ACV mismatch for ({bu}, {fc})"

            # Drawer cell == heatmap cell
            drawer_cell = client.get(
                "/api/v2/business-units/deals",
                params={"as_of": date_str, "period": scope_period, "bu": bu, "category": fc}
            ).json()
            assert drawer_cell["count"] == act_cell["count"], f"Drawer count mismatch for ({bu}, {fc})"
            assert drawer_cell["acv"] == pytest.approx(act_cell["acv"], abs=ACV_ABS), f"Drawer ACV mismatch for ({bu}, {fc})"

    # 5. Assert Column totals
    for fc, cat_tot in sum_res["totals"]["categories"].items():
        exp_col_count = int(expected["fc_totals"].loc[fc, "count"]) if fc in expected["fc_totals"].index else 0
        exp_col_acv = float(expected["fc_totals"].loc[fc, "sum"]) if fc in expected["fc_totals"].index else 0.0

        assert cat_tot["count"] == exp_col_count
        assert cat_tot["acv"] == pytest.approx(exp_col_acv, abs=ACV_ABS)

        drawer_col = client.get(
            "/api/v2/business-units/deals",
            params={"as_of": date_str, "period": scope_period, "category": fc}
        ).json()
        assert drawer_col["count"] == cat_tot["count"]
        assert drawer_col["acv"] == pytest.approx(cat_tot["acv"], abs=ACV_ABS)

    # 6. Verify independent runtime recompute (Source check badge)
    reconcile_res = client.get(
        "/api/v2/business-units/reconcile",
        params={"as_of": date_str, "period": scope_period}
    ).json()
    assert reconcile_res["status"] == "reconciles"
    assert reconcile_res["badge"] == "green"
    assert len(reconcile_res["diffs"]) == 0
    assert sum_res["source_check"]["status"] == "reconciles"


def test_bu_exclude_deleted(client_and_db):
    client, _ = client_and_db
    comp_file, snap_date = get_fixture_comparison_file()
    r = client.get(f"/api/v2/business-units/summary?as_of={snap_date.isoformat()}&exclude_deleted_lost=true")
    assert r.status_code == 200
    d = r.json()
    assert "rows" in d
    assert d["source_check"]["status"] == "reconciles"


def test_bu_time_travel_dynamic(client_and_db):
    client, db = client_and_db
    future_date = date(2027, 1, 5)
    snap = UploadSnapshot(snapshot_date=future_date, label="Dummy Future", is_active_today=False)
    db.add(snap)
    db.commit()

    r = client.get(f"/api/v2/business-units/summary?as_of={future_date.isoformat()}")
    assert r.status_code == 200
    d = r.json()
    assert d["data_slice_key"] == ScopeService.quarter_of(future_date)


def test_top_opportunities_dynamic(client_and_db):
    client, _ = client_and_db
    comp_file, snap_date = get_fixture_comparison_file()
    # Pick first BU from summary
    sum_res = client.get(f"/api/v2/business-units/summary?as_of={snap_date.isoformat()}").json()
    assert len(sum_res["rows"]) > 0
    first_bu = sum_res["rows"][0]["bu"]

    r = client.get(f"/api/v2/business-units/top-opportunities?as_of={snap_date.isoformat()}&bu={first_bu}")
    assert r.status_code == 200
    d = r.json()
    deals = d["deals"]
    assert len(deals) > 0
    # Deals should be sorted by ACV descending
    acvs = [dl["forecast_acv_amount"] for dl in deals if dl.get("forecast_acv_amount") is not None]
    assert acvs == sorted(acvs, reverse=True)
