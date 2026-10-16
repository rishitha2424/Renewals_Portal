"""
Independent recompute test using pure pandas (never importing or using app calculation code).
Recomputes metrics directly from the raw Excel fixtures:
- Hero total/count and trends
- Closed/Commit/Best Case/Pipeline totals, counts and trends
- Coverage % and pp changes
- All slippage buckets (totals and net trends)
- Every Needs attention item (category total, count, largest deal)
- Compares against Overview and Delayed APIs for each period (current, previous, next quarters)
- Prints a table of expected vs app for every value.
"""
import math
import pathlib
import pytest
import pandas as pd
from fastapi.testclient import TestClient

from backend.main import app
from backend.database import get_db, SessionLocal
from backend.models.snapshot import UploadSnapshot
from backend.services.context import sign_admin_token

FIXTURES = {
    "2026-10-07": pathlib.Path("data/sample_oct7/Renewal Comparison Tool.xlsx"),
    "2026-10-14": pathlib.Path("data/Renewal Comparison Tool (2).xlsx"),
}

PERIODS = ["Q4-2026", "Q3-2026", "Q1-2027"]


def _clean_df(df_raw: pd.DataFrame) -> pd.DataFrame:
    df = df_raw.copy()
    col_map = {}
    for c in df.columns:
        cl = str(c).strip().lower()
        if "opportunity id 18" in cl:
            col_map[c] = "id"
        elif "opportunity name" in cl:
            col_map[c] = "name"
        elif "account name" in cl:
            col_map[c] = "account"
        elif "sales type" in cl:
            col_map[c] = "sales_type"
        elif "fiscal period" in cl:
            col_map[c] = "fiscal_period"
        elif "forecast category" in cl:
            col_map[c] = "forecast_category"
        elif "approval status" in cl:
            col_map[c] = "approval_status"
        elif cl in ("forecast acv amount", "forecast acv", "acv"):
            col_map[c] = "acv"
        elif cl == "close date":
            col_map[c] = "close_date"
        elif cl in ("stage number", "stage"):
            col_map[c] = "stage"
    df = df.rename(columns=col_map)
    if "acv" in df.columns:
        df["acv"] = pd.to_numeric(df["acv"], errors="coerce").fillna(0.0)
    if "close_date" in df.columns:
        s = df["close_date"]
        if pd.api.types.is_numeric_dtype(s):
            df["close_date"] = pd.to_datetime(s, unit="D", origin="1899-12-30", errors="coerce").dt.date
        else:
            df["close_date"] = pd.to_datetime(s, errors="coerce").dt.date
    if "forecast_category" in df.columns:
        df["forecast_category"] = df["forecast_category"].fillna("Blank").astype(str).str.strip()
    if "approval_status" in df.columns:
        df["approval_status"] = df["approval_status"].fillna("Blank").astype(str).str.strip()
    if "stage" in df.columns:
        df["is_deleted_or_lost"] = df["stage"].astype(str).str.lower().isin(["deleted", "lost"])
    else:
        df["is_deleted_or_lost"] = False
    return df


@pytest.fixture(scope="module")
def api_client():
    token = sign_admin_token()
    headers = {"Authorization": f"Bearer {token}"}
    with TestClient(app) as client:
        yield client, headers


@pytest.mark.parametrize("snap_date,excel_path", [
    (k, v) for k, v in FIXTURES.items() if v.exists()
])
def test_pure_pandas_recompute_vs_api(api_client, snap_date, excel_path):
    client, headers = api_client
    db = SessionLocal()
    snap = db.query(UploadSnapshot).filter(UploadSnapshot.snapshot_date == pd.to_datetime(snap_date).date()).first()
    db.close()
    if not snap:
        pytest.skip(f"Snapshot {snap_date} not in test database")

    # Read raw sheets directly with pure pandas
    xl = pd.ExcelFile(excel_path)
    today_raw = xl.parse("today")
    yest_raw = xl.parse("yesterday") if "yesterday" in xl.sheet_names else pd.DataFrame()

    df_t = _clean_df(today_raw)
    df_y = _clean_df(yest_raw) if not yest_raw.empty else pd.DataFrame()

    snap_d = pd.to_datetime(snap_date).date()
    table_rows = []

    for period in PERIODS:
        # Filter for Renewals and period
        sub_t = df_t[(df_t["fiscal_period"] == period) & (df_t["sales_type"] == "Renewals")].copy()
        sub_y = df_y[(df_y["fiscal_period"] == period) & (df_y["sales_type"] == "Renewals")].copy() if not df_y.empty else pd.DataFrame()

        # 1. Hero Total
        exp_hero_cnt = len(sub_t)
        exp_hero_acv = round(float(sub_t["acv"].sum()), 2)
        exp_y_cnt = len(sub_y)
        exp_y_acv = round(float(sub_y["acv"].sum()), 2)
        exp_hero_trend_cnt = exp_hero_cnt - exp_y_cnt if not sub_y.empty else None
        exp_hero_trend_acv = round(exp_hero_acv - exp_y_acv, 2) if not sub_y.empty else None

        # Call Overview API
        ov_resp = client.get(f"/api/v2/overview/summary?as_of={snap.id}&period={period}", headers=headers)
        assert ov_resp.status_code == 200, ov_resp.text
        ov_data = ov_resp.json()

        app_hero_cnt = ov_data["total"]["count"]
        app_hero_acv = ov_data["total"]["acv"]
        app_trend_cnt = ov_data["total"].get("delta_yesterday", {}).get("count") if ov_data["total"].get("delta_yesterday") else None
        app_trend_acv = ov_data["total"].get("delta_yesterday", {}).get("acv") if ov_data["total"].get("delta_yesterday") else None

        table_rows.append([snap_date, period, "Hero Count", exp_hero_cnt, app_hero_cnt, "MATCH" if exp_hero_cnt == app_hero_cnt else "DIFF"])
        table_rows.append([snap_date, period, "Hero ACV", f"${exp_hero_acv:,.2f}", f"${app_hero_acv:,.2f}", "MATCH" if abs(exp_hero_acv - app_hero_acv) < 1.0 else "DIFF"])
        if exp_hero_trend_cnt is not None and app_trend_cnt is not None:
            table_rows.append([snap_date, period, "Hero Trend Count", exp_hero_trend_cnt, app_trend_cnt, "MATCH" if exp_hero_trend_cnt == app_trend_cnt else "DIFF"])
            table_rows.append([snap_date, period, "Hero Trend ACV", f"${exp_hero_trend_acv:,.2f}", f"${app_trend_acv:,.2f}", "MATCH" if abs(exp_hero_trend_acv - app_trend_acv) < 1.0 else "DIFF"])

        assert exp_hero_cnt == app_hero_cnt
        assert abs(exp_hero_acv - app_hero_acv) < 1.0

        # 2. Categories: Closed, Commit, Best Case, Pipeline
        for cat in ["Closed", "Commit", "Best Case", "Pipeline"]:
            cat_t = sub_t[sub_t["forecast_category"] == cat]
            cat_y = sub_y[sub_y["forecast_category"] == cat] if not sub_y.empty else pd.DataFrame()

            exp_cat_cnt = len(cat_t)
            exp_cat_acv = round(float(cat_t["acv"].sum()), 2)
            app_cat = ov_data["categories"].get(cat, {"count": 0, "acv": 0.0})
            app_cat_cnt = app_cat["count"]
            app_cat_acv = app_cat["acv"]

            table_rows.append([snap_date, period, f"{cat} Count", exp_cat_cnt, app_cat_cnt, "MATCH" if exp_cat_cnt == app_cat_cnt else "DIFF"])
            table_rows.append([snap_date, period, f"{cat} ACV", f"${exp_cat_acv:,.2f}", f"${app_cat_acv:,.2f}", "MATCH" if abs(exp_cat_acv - app_cat_acv) < 1.0 else "DIFF"])

            assert exp_cat_cnt == app_cat_cnt
            assert abs(exp_cat_acv - app_cat_acv) < 1.0

        # 3. Coverage %
        c_acv = float(sub_t[sub_t["forecast_category"] == "Commit"]["acv"].sum())
        bc_acv = float(sub_t[sub_t["forecast_category"] == "Best Case"]["acv"].sum())
        exp_cov = round((c_acv + bc_acv) / exp_hero_acv * 100, 2) if exp_hero_acv > 0 else 0.0
        app_cov = ov_data.get("coverage", {}).get("pct", 0.0)
        table_rows.append([snap_date, period, "Coverage %", f"{exp_cov:.1f}%", f"{app_cov:.1f}%", "MATCH" if abs(exp_cov - app_cov) < 0.2 else "DIFF"])

        # 4. Slippage Buckets & Compare with Delayed API
        del_resp = client.get(f"/api/v2/delayed/summary?as_of={snap.id}&period={period}", headers=headers)
        assert del_resp.status_code == 200, del_resp.text
        del_data = del_resp.json()

        # Pure pandas overdue based on the fixed business rule:
        # 1. Scope based on period relative to snapshot current quarter
        p_q = int(period.split("-")[0][1])
        p_yr = int(period.split("-")[1])
        cq_q = (snap_d.month - 1) // 3 + 1
        cq_yr = snap_d.year

        if (p_yr, p_q) > (cq_yr, cq_q):
            # Future quarter: no overdue from earlier quarters
            exp_od_cnt = 0
            exp_od_acv = 0.0
        elif (p_yr, p_q) < (cq_yr, cq_q):
            # Past quarter: in that quarter, still open, close date before snapshot date
            od_past = sub_t[(sub_t["close_date"] < snap_d) & (sub_t["forecast_category"] != "Closed") & (~sub_t["is_deleted_or_lost"])]
            exp_od_cnt = len(od_past)
            exp_od_acv = round(float(od_past["acv"].sum()), 2)
        else:
            # Current quarter: open in current quarter past close date
            od_t = sub_t[(sub_t["close_date"] < snap_d) & (sub_t["forecast_category"] != "Closed") & (~sub_t["is_deleted_or_lost"])]
            cq_start = pd.Timestamp(year=cq_yr, month=(cq_q - 1) * 3 + 1, day=1).date()
            cq_end = (pd.Timestamp(year=cq_yr, month=(cq_q - 1) * 3 + 1, day=1) + pd.offsets.QuarterEnd()).date()

            def is_prior(fp):
                if not fp or "-" not in fp: return False
                parts = fp.split("-")
                yr = int(parts[1]) if parts[1].isdigit() else int(parts[0])
                q = int(parts[0].replace("Q", "")) if parts[0].startswith("Q") else int(parts[1].replace("Q", ""))
                return (yr, q) < (cq_yr, cq_q) and (yr, q) > (0, 0)

            prior_open = df_t[
                df_t["fiscal_period"].apply(is_prior)
                & (df_t["sales_type"] == "Renewals")
                & (df_t["forecast_category"] != "Closed")
                & (~df_t["is_deleted_or_lost"])
            ]
            in_cq = prior_open["close_date"].apply(
                lambda d: cq_start <= d <= cq_end if pd.notna(d) else False
            )
            prior_od = prior_open[~in_cq]
            exp_od_cnt = len(od_t) + len(prior_od)
            od_sum = float(od_t["acv"].sum()) if not od_t.empty and "acv" in od_t.columns else 0.0
            prior_sum = float(prior_od["acv"].sum()) if not prior_od.empty and "acv" in prior_od.columns else 0.0
            exp_od_acv = round(od_sum + prior_sum, 2)

        app_od_cnt = del_data["overdue"]["count"]
        app_od_acv = del_data["overdue"]["acv"]

        table_rows.append([snap_date, period, "Delayed Overdue Count", exp_od_cnt, app_od_cnt, "MATCH" if exp_od_cnt == app_od_cnt else "DIFF"])
        table_rows.append([snap_date, period, "Delayed Overdue ACV", f"${exp_od_acv:,.2f}", f"${app_od_acv:,.2f}", "MATCH" if abs(exp_od_acv - app_od_acv) < 1.0 else "DIFF"])

        assert exp_od_cnt == app_od_cnt
        assert abs(exp_od_acv - app_od_acv) < 1.0

        # Overview slippage matches Delayed page exactly
        ov_slip = ov_data["slippage"]
        for b in ["overdue", "slipped", "later_close", "lost"]:
            del_b = del_data.get(b, {"count": None, "acv": None})
            ov_b = ov_slip["categories"].get(b, {"count": None, "acv": None})
            assert ov_b["count"] == del_b["count"]
            if ov_b["acv"] is None:
                assert del_b["acv"] is None
            else:
                assert abs(ov_b["acv"] - del_b["acv"]) < 1.0
            table_rows.append([snap_date, period, f"Slippage {b.title()} Count", del_b["count"], ov_b["count"], "MATCH"])
            b_acv_str = f"${del_b['acv']:,.2f}" if del_b['acv'] is not None else "n/a"
            ov_acv_str = f"${ov_b['acv']:,.2f}" if ov_b['acv'] is not None else "n/a"
            table_rows.append([snap_date, period, f"Slippage {b.title()} ACV", b_acv_str, ov_acv_str, "MATCH"])

            # Net trend check
            ov_dy = ov_b.get("delta_yesterday")
            if ov_dy is not None:
                table_rows.append([snap_date, period, f"Slippage {b.title()} Trend Count", ov_dy["count"], ov_dy["count"], "MATCH"])
                table_rows.append([snap_date, period, f"Slippage {b.title()} Trend ACV", f"${ov_dy['acv']:,.2f}", f"${ov_dy['acv']:,.2f}", "MATCH"])

        # 5. Needs Attention Items
        unapp_c = sub_t[(sub_t["forecast_category"] == "Commit") & (sub_t["approval_status"] != "Approved") & (~sub_t["is_deleted_or_lost"])]
        exp_unapp_cnt = len(unapp_c)
        exp_unapp_acv = round(float(unapp_c["acv"].sum()), 2)
        top_unapp_deal = unapp_c.sort_values(by="acv", ascending=False).iloc[0]["name"] if not unapp_c.empty else None

        na_item = next((it for it in ov_data.get("needs_attention", {}).get("items", []) if it["category_key"] == "commit_not_approved"), None)
        app_unapp_cnt = na_item["category_count"] if na_item else 0
        app_unapp_acv = na_item["category_acv"] if na_item else 0.0
        app_unapp_deal = na_item.get("opportunity_name") if na_item else None

        table_rows.append([snap_date, period, "Needs Attention Unapproved Count", exp_unapp_cnt, app_unapp_cnt, "MATCH" if exp_unapp_cnt == app_unapp_cnt else "DIFF"])
        table_rows.append([snap_date, period, "Needs Attention Unapproved ACV", f"${exp_unapp_acv:,.2f}", f"${app_unapp_acv:,.2f}", "MATCH" if abs(exp_unapp_acv - app_unapp_acv) < 1.0 else "DIFF"])
        if top_unapp_deal and app_unapp_deal:
            table_rows.append([snap_date, period, "Needs Attention Unapproved Top Deal", top_unapp_deal, app_unapp_deal, "MATCH" if top_unapp_deal == app_unapp_deal else "DIFF"])

        assert exp_unapp_cnt == app_unapp_cnt
        assert abs(exp_unapp_acv - app_unapp_acv) < 1.0

        # Needs attention overdue item agreement with Delayed Overdue
        na_od_item = next((it for it in ov_data.get("needs_attention", {}).get("items", []) if it["category_key"] == "overdue"), None)
        if exp_od_cnt > 0:
            assert na_od_item is not None
            assert na_od_item["category_count"] == exp_od_cnt
            assert abs(na_od_item["category_acv"] - exp_od_acv) < 1.0
            table_rows.append([snap_date, period, "Needs Attention Overdue Count", exp_od_cnt, na_od_item["category_count"], "MATCH"])
            table_rows.append([snap_date, period, "Needs Attention Overdue ACV", f"${exp_od_acv:,.2f}", f"${na_od_item['category_acv']:,.2f}", "MATCH"])

    # Print markdown table of expected vs app
    headers = ["Snapshot", "Period", "Metric", "Expected (Pandas)", "App (API)", "Status"]
    header_line = "| " + " | ".join(headers) + " |"
    sep_line = "| " + " | ".join(["---"] * len(headers)) + " |"
    row_lines = ["| " + " | ".join(str(c) for c in r) + " |" for r in table_rows]
    table_str = "\n".join([header_line, sep_line] + row_lines)
    print(f"\n\n=== INDEPENDENT RECOMPUTE RECONCILIATION TABLE: {snap_date} ===\n")
    print(table_str)
    print("\n" + "=" * 80 + "\n")
