import pytest
import os
import pathlib
import pandas as pd
from fastapi.testclient import TestClient

def test_executive_view_contracts_sqlite():
    """
    Headline numbers computed dynamically from fixture Excel via pandas.
    """
    from backend.main import app
    from backend.database import get_db, SessionLocal

    fixture_path = pathlib.Path("data/sample_oct7/Renewal Comparison Tool.xlsx")
    df = pd.read_excel(fixture_path, sheet_name="today")
    df_q4 = df[(df["Sales Type"] == "Renewals") & (df["Fiscal Period"] == "Q4-2026")]

    expected_total_count = len(df_q4)
    expected_total_acv = float(df_q4["Forecast ACV Amount"].fillna(0).sum())

    df_commit = df_q4[df_q4["Forecast Category"] == "Commit"]
    expected_commit_count = len(df_commit)
    expected_commit_acv = float(df_commit["Forecast ACV Amount"].fillna(0).sum())

    df_bc = df_q4[df_q4["Forecast Category"] == "Best Case"]
    expected_bc_count = len(df_bc)
    expected_bc_acv = float(df_bc["Forecast ACV Amount"].fillna(0).sum())

    df_pipe = df_q4[df_q4["Forecast Category"] == "Pipeline"]
    expected_pipe_count = len(df_pipe)
    expected_pipe_acv = float(df_pipe["Forecast ACV Amount"].fillna(0).sum())

    df_blank = df_q4[~df_q4["Forecast Category"].isin(["Commit", "Best Case", "Pipeline", "Closed"])]
    expected_blank_count = len(df_blank)
    expected_blank_acv = float(df_blank["Forecast ACV Amount"].fillna(0).sum())

    app.dependency_overrides.clear()
    try:
        with TestClient(app) as client:
            # 1. Overview summary check
            r_ov = client.get("/api/v2/overview/summary?as_of=2026-10-07")
        assert r_ov.status_code == 200, r_ov.text
        ov_data = r_ov.json()

        total = ov_data.get("total", {})
        assert total.get("count") == expected_total_count
        assert abs(total.get("acv") - expected_total_acv) < 0.1

        cats = ov_data.get("categories", {})
        assert cats["Commit"]["count"] == expected_commit_count
        assert abs(cats["Commit"]["acv"] - expected_commit_acv) < 0.1

        assert cats["Best Case"]["count"] == expected_bc_count
        assert abs(cats["Best Case"]["acv"] - expected_bc_acv) < 0.1

        assert cats["Pipeline"]["count"] == expected_pipe_count
        assert abs(cats["Pipeline"]["acv"] - expected_pipe_acv) < 0.1

        assert cats["Blank"]["count"] == expected_blank_count
        assert abs(cats["Blank"]["acv"] - expected_blank_acv) < 0.1

        # 2. Delayed summary check
        r_del = client.get("/api/v2/delayed/summary?as_of=2026-10-07&compare=yesterday")
        assert r_del.status_code == 200, r_del.text
        del_data = r_del.json()

        del_total = del_data.get("total", {})
        assert "count" in del_total and "acv" in del_total

        # 3. Risk block components: Executive 7a (Delayed), 7b (Slippage), 7c (Lost) match Delayed endpoint
        overdue = del_data.get("overdue", {})
        later_close = del_data.get("later_close", {})
        slipped = del_data.get("slipped", {})
        lost = del_data.get("lost", {})
        # 7a: Total Delayed Renewals equals Overdue + Later close date
        assert del_total.get("count") == overdue.get("count", 0) + later_close.get("count", 0)
        assert abs(del_total.get("acv", 0.0) - (overdue.get("acv", 0.0) + later_close.get("acv", 0.0))) < 0.05
        # 7b & 7c: Slippage and Lost are tracked independently with count and acv
        assert "count" in slipped and "acv" in slipped
        assert "count" in lost and "acv" in lost

        blank = cats["Blank"]
        assert blank.get("count") == expected_blank_count
        assert abs(blank.get("acv") - expected_blank_acv) < 0.1
    finally:
        app.dependency_overrides.clear()
