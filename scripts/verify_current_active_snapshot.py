import os
import sqlite3
import pandas as pd
from fastapi.testclient import TestClient
from backend.main import app
from backend.services.scopes import ScopeService
from backend.models.snapshot import UploadSnapshot
from backend.database import SessionLocal

def run_verification():
    db = SessionLocal()
    snap = db.query(UploadSnapshot).filter(UploadSnapshot.is_active_today == True).first()
    if not snap:
        snap = db.query(UploadSnapshot).order_by(UploadSnapshot.snapshot_date.desc()).first()
    
    snap_id = snap.id
    snap_date = snap.snapshot_date
    date_str = snap_date.isoformat()
    cq = ScopeService.quarter_of(snap_date)
    print(f"Active snapshot: id={snap_id}, date={date_str}, derived current quarter={cq}")

    con = sqlite3.connect("renewals.db")
    raw_df = pd.read_sql(
        "SELECT * FROM opportunities WHERE snapshot_id = ?",
        con,
        params=(snap_id,)
    )
    con.close()
    print(f"Total raw opportunities in snapshot: {len(raw_df)}")

    # Filter Sales Type == 'Renewals'
    raw_df = raw_df[raw_df["sales_type"] == "Renewals"].copy()

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

    raw_df["clean_bu"] = raw_df["business_unit_raw"].apply(norm_bu)
    raw_df["clean_fc"] = raw_df["forecast_category"].apply(norm_fc)
    raw_df["clean_acv"] = pd.to_numeric(raw_df["forecast_acv_amount"], errors="coerce").fillna(0.0)

    client = TestClient(app)

    categories = ["Closed", "Commit", "Best Case", "Pipeline", "Blank"]

    for scope_name, scope_period in [("Current Quarter", "current_quarter"), ("All Periods", "all_periods")]:
        print(f"\n=======================================================")
        print(f"SCOPE: {scope_name} (period='{scope_period}')")
        print(f"=======================================================")

        if scope_period == "current_quarter":
            df_scoped = raw_df[raw_df["fiscal_period"] == cq].copy()
        else:
            df_scoped = raw_df.copy()

        g = df_scoped.groupby(["clean_bu", "clean_fc"])["clean_acv"].agg(["count", "sum"])
        bu_tot = df_scoped.groupby("clean_bu")["clean_acv"].agg(["count", "sum"])
        grand_count = len(df_scoped)
        grand_acv = df_scoped["clean_acv"].sum()

        # Query app heatmap
        sum_res = client.get(
            "/api/v2/business-units/summary",
            params={"as_of": date_str, "period": scope_period}
        ).json()

        heatmap_rows = {r["bu"]: r for r in sum_res["rows"]}

        # Five largest BUs by ACV
        sorted_bus = bu_tot.sort_values(by="sum", ascending=False).index.tolist()
        top5_bus = sorted_bus[:5]

        print(f"\nFive largest BUs in this scope: {top5_bus}\n")
        print(f"{'BU':<28} | {'Category':<10} | {'Expected (Pandas)':<24} | {'App Heatmap':<24} | {'App Drawer':<24} | {'Status':<6}")
        print("-" * 125)

        for bu in top5_bus:
            # First row total
            exp_bu_c = int(bu_tot.loc[bu, "count"])
            exp_bu_a = float(bu_tot.loc[bu, "sum"])
            act_bu = heatmap_rows.get(bu, {"count": 0, "acv": 0.0, "cells": {}})

            drawer_bu = client.get(
                "/api/v2/business-units/deals",
                params={"as_of": date_str, "period": scope_period, "bu": bu}
            ).json()

            exp_str = f"{exp_bu_c} d / ${exp_bu_a:,.2f}"
            heat_str = f"{act_bu['count']} d / ${act_bu['acv']:,.2f}"
            draw_str = f"{drawer_bu['count']} d / ${drawer_bu['acv']:,.2f}"

            match = (
                exp_bu_c == act_bu["count"] == drawer_bu["count"] and
                abs(exp_bu_a - act_bu["acv"]) < 0.02 and
                abs(act_bu["acv"] - drawer_bu["acv"]) < 0.02
            )
            print(f"{bu:<28} | {'[TOTAL]':<10} | {exp_str:<24} | {heat_str:<24} | {draw_str:<24} | {'PASS' if match else 'FAIL':<6}")

            # Each category
            for fc in categories:
                exp_c = int(g.loc[(bu, fc), "count"]) if (bu, fc) in g.index else 0
                exp_a = float(g.loc[(bu, fc), "sum"]) if (bu, fc) in g.index else 0.0

                act_cell = act_bu.get("cells", {}).get(fc, {"count": 0, "acv": 0.0})

                drawer_cell = client.get(
                    "/api/v2/business-units/deals",
                    params={"as_of": date_str, "period": scope_period, "bu": bu, "category": fc}
                ).json()

                exp_str = f"{exp_c} d / ${exp_a:,.2f}"
                heat_str = f"{act_cell['count']} d / ${act_cell['acv']:,.2f}"
                draw_str = f"{drawer_cell['count']} d / ${drawer_cell['acv']:,.2f}"

                match = (
                    exp_c == act_cell["count"] == drawer_cell["count"] and
                    abs(exp_a - act_cell["acv"]) < 0.02 and
                    abs(act_cell["acv"] - drawer_cell["acv"]) < 0.02
                )
                print(f"{'  ' + bu[:26]:<28} | {fc:<10} | {exp_str:<24} | {heat_str:<24} | {draw_str:<24} | {'PASS' if match else 'FAIL':<6}")

        # Grand Total
        drawer_grand = client.get(
            "/api/v2/business-units/deals",
            params={"as_of": date_str, "period": scope_period}
        ).json()
        exp_str = f"{grand_count} d / ${grand_acv:,.2f}"
        heat_str = f"{sum_res['total']['count']} d / ${sum_res['total']['acv']:,.2f}"
        draw_str = f"{drawer_grand['count']} d / ${drawer_grand['acv']:,.2f}"
        match = (
            grand_count == sum_res['total']['count'] == drawer_grand['count'] and
            abs(grand_acv - sum_res['total']['acv']) < 0.02 and
            abs(sum_res['total']['acv'] - drawer_grand['acv']) < 0.02
        )
        print("-" * 125)
        print(f"{'[GRAND TOTAL]':<28} | {'ALL':<10} | {exp_str:<24} | {heat_str:<24} | {draw_str:<24} | {'PASS' if match else 'FAIL':<6}")

    db.close()

if __name__ == "__main__":
    run_verification()
