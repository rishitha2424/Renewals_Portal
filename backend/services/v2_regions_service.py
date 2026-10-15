from __future__ import annotations
import logging
import pandas as pd
from datetime import date, timedelta
from typing import Optional, Any
from sqlalchemy.orm import Session

from backend.models.opportunity import Opportunity
from backend.models.snapshot import UploadSnapshot
from backend.services.context import UserContext
from backend.services.scopes import ScopeService

log = logging.getLogger(__name__)

ALL_FC = ["Closed", "Commit", "Best Case", "Pipeline", "Blank"]
FUNNEL_STAGES = ["Approved", "Pending Approval", "Blank"]
REGION_ORDER = ["North America", "LATAM", "Middle East and North Africa", "APAC", "Europe", "Africa"]

def _sum(df: pd.DataFrame, col: str) -> float:
    if df.empty or col not in df.columns:
        return 0.0
    return float(df[col].sum())

def _norm_fc(s: str | None) -> str:
    if not s or str(s).strip() in ("", "nan", "None"):
        return "Blank"
    s = str(s).strip()
    if s not in ["Closed", "Commit", "Best Case", "Pipeline"]:
        return "Blank"
    return s

def _norm_approval(s: str | None) -> str:
    if not s or str(s).strip() in ("", "nan", "None", "Blank"):
        return "Blank"
    s = str(s).strip()
    if s in ("Approved", "Approved - 2nd"):
        return "Approved"
    if s in ("Pending Approval", "Pending-Approval"):
        return "Pending Approval"
    return s

def _map_region(s: str | None) -> str:
    if not s or str(s).strip() in ("", "nan", "None"):
        return "Other / Unmapped"
    s = str(s).strip()
    if s == "Europe": return "Europe"
    if s == "APAC": return "APAC"
    if s == "AFRICA": return "Africa"
    if s == "MENA": return "Middle East and North Africa"
    if s == "NAMR": return "North America"
    if s == "South America": return "LATAM"
    if s in REGION_ORDER:
        return s
    return s

def _opps_to_df(opps: list[Opportunity]) -> pd.DataFrame:
    if not opps:
        return pd.DataFrame()
    records = []
    for o in opps:
        records.append({
            "opportunity_id_18": o.opportunity_id_18,
            "opportunity_name": o.opportunity_name,
            "account_name": o.account_name,
            "forecast_acv_amount": float(o.forecast_acv_amount or 0.0),
            "forecast_category": _norm_fc(o.forecast_category),
            "business_unit": (o.business_unit_primary or "").strip() or "Unassigned",
            "is_deleted_or_lost": bool(o.is_deleted_or_lost),
            "fiscal_period": o.fiscal_period or "",
            "close_date": o.close_date,
            "approval_status": _norm_approval(o.approval_status),
            "region": _map_region(o.revised_sub_region),
            "raw_sub_region": o.revised_sub_region or "",
        })
    df = pd.DataFrame(records)
    df = df.drop_duplicates(subset=["opportunity_id_18"], keep="last")
    return df

class V2RegionsService:
    def __init__(self, db: Session):
        self.db = db

    def _active_snap(self, as_of: str | None = None) -> UploadSnapshot | None:
        q = self.db.query(UploadSnapshot)
        if as_of:
            try:
                d = date.fromisoformat(as_of)
                snap = q.filter(UploadSnapshot.snapshot_date <= d).order_by(UploadSnapshot.snapshot_date.desc()).first()
                if snap:
                    return snap
            except ValueError:
                pass
            by_id = q.filter(UploadSnapshot.id == as_of).first()
            if by_id:
                return by_id
        return (
            q.filter(UploadSnapshot.is_active_today == True)
            .order_by(UploadSnapshot.snapshot_date.desc())
            .first()
        )

    def _snap_by_date(self, d: date) -> UploadSnapshot | None:
        return self.db.query(UploadSnapshot).filter(UploadSnapshot.snapshot_date == d).first()

    def _scoped_opps(self, snap: UploadSnapshot, filter_spec: Optional[ScopeService.FilterSpec] = None, exclude_deleted: bool = False, target_date = None) -> tuple[list[Opportunity], Any]:
        from backend.services.scopes import FilterSpec
        eff_date = target_date
        if not eff_date and filter_spec and filter_spec.as_of:
            try:
                eff_date = date.fromisoformat(filter_spec.as_of)
            except ValueError:
                pass
        if not eff_date:
            eff_date = snap.snapshot_date
        fs = filter_spec.model_copy() if filter_spec else FilterSpec()
        if exclude_deleted:
            fs.include_deleted_lost = False
        res = ScopeService.resolve(fs, snapshot=snap, as_of_date=eff_date)
        q = (
            self.db.query(Opportunity)
            .filter(
                Opportunity.snapshot_id == snap.id,
                *res.conditions
            )
        )
        return q.all(), res

    def _q4_opps(self, snap: UploadSnapshot, exclude_deleted: bool = False, target_date = None) -> list[Opportunity]:
        opps, _ = self._scoped_opps(snap, exclude_deleted=exclude_deleted, target_date=target_date)
        return opps


    def _yesterday_snap(self, snap: UploadSnapshot) -> UploadSnapshot | None:
        return (
            self.db.query(UploadSnapshot)
            .filter(UploadSnapshot.snapshot_date < snap.snapshot_date)
            .order_by(UploadSnapshot.snapshot_date.desc())
            .first()
        )

    def _lastweek_snap(self, snap: UploadSnapshot) -> UploadSnapshot | None:
        target = snap.snapshot_date - timedelta(days=7)
        return (
            self.db.query(UploadSnapshot)
            .filter(UploadSnapshot.snapshot_date <= target)
            .order_by(UploadSnapshot.snapshot_date.desc())
            .first()
        )

    def get_summary(self, ctx: UserContext, as_of: Optional[str] = None, compare: Optional[str] = None, exclude_deleted_lost: bool = False, filter_spec: Optional[ScopeService.FilterSpec] = None) -> dict:
        from backend.services.scopes import FilterSpec
        fs = filter_spec.model_copy() if filter_spec else FilterSpec()
        if as_of:
            fs.as_of = as_of
        if compare:
            fs.compare = compare
        if exclude_deleted_lost:
            fs.include_deleted_lost = False

        snap = self._active_snap(fs.as_of)
        if not snap:
            return {"error": "no_snapshot"}

        eff_as_of_date = None
        if fs.as_of:
            try:
                eff_as_of_date = date.fromisoformat(fs.as_of)
            except ValueError:
                pass
        if not eff_as_of_date:
            eff_as_of_date = snap.snapshot_date

        opps, res = self._scoped_opps(snap, filter_spec=fs, target_date=eff_as_of_date)
        df = _opps_to_df(opps)

        y_snap = self._yesterday_snap(snap)
        lw_snap = self._lastweek_snap(snap)

        y_opps, _ = self._scoped_opps(y_snap, filter_spec=fs, target_date=eff_as_of_date) if y_snap else ([], None)
        lw_opps, _ = self._scoped_opps(lw_snap, filter_spec=fs, target_date=eff_as_of_date) if lw_snap else ([], None)
        y_df = _opps_to_df(y_opps)
        lw_df = _opps_to_df(lw_opps)

        grand_count = len(df)
        grand_acv = float(df["forecast_acv_amount"].sum()) if not df.empty else 0.0

        def _get_region_data(df_in: pd.DataFrame) -> dict:
            res = {}
            if df_in.empty: return res
            for r, grp in df_in.groupby("region"):
                res[r] = {
                    "count": len(grp),
                    "acv": float(grp["forecast_acv_amount"].sum()),
                    "cells": {fc: {"count": len(grp[grp["forecast_category"] == fc]), "acv": float(grp[grp["forecast_category"] == fc]["forecast_acv_amount"].sum())} for fc in ALL_FC},
                    "approval": {st: {"count": len(grp[grp["approval_status"] == st]), "acv": float(grp[grp["approval_status"] == st]["forecast_acv_amount"].sum())} for st in FUNNEL_STAGES}
                }
            return res

        today_reg = _get_region_data(df)
        y_reg = _get_region_data(y_df)
        lw_reg = _get_region_data(lw_df)

        found_regions = set()
        for r_map in (today_reg, y_reg, lw_reg):
            found_regions.update(r_map.keys())

        known_ordered = [r for r in REGION_ORDER]
        other_in_data = sorted([r for r in found_regions if r not in known_ordered and r not in ("Other / Unmapped", "Other")])
        
        all_ordered = known_ordered + other_in_data
        if "Other / Unmapped" in found_regions or "Other" in found_regions:
            all_ordered.append("Other / Unmapped")

        # Detect delayed deals: close_date < snap.snapshot_date, not Closed, not deleted/lost
        snap_date = snap.snapshot_date
        def _check_delayed_deal(row):
            cd = row.get("close_date")
            if pd.isna(cd): return False
            try:
                return pd.to_datetime(cd).date() < snap_date and row.get("forecast_category") != "Closed" and not row.get("is_deleted_or_lost")
            except Exception:
                return False

        delayed_mask = df.apply(_check_delayed_deal, axis=1) if not df.empty else pd.Series(dtype=bool)
        delayed_df = df[delayed_mask] if not df.empty else pd.DataFrame()

        regions_out = []
        for reg_name in all_ordered:
            if reg_name in today_reg:
                d_today = today_reg[reg_name]
            elif reg_name in ("Other / Unmapped", "Other") and "Other" in today_reg:
                d_today = today_reg["Other"]
            else:
                d_today = {"count": 0, "acv": 0.0, "cells": {fc: {"count": 0, "acv": 0.0} for fc in ALL_FC}, "approval": {st: {"count": 0, "acv": 0.0} for st in FUNNEL_STAGES}}

            if reg_name in y_reg:
                d_y = y_reg[reg_name]
            elif reg_name in ("Other / Unmapped", "Other") and "Other" in y_reg:
                d_y = y_reg["Other"]
            else:
                d_y = {"count": 0, "acv": 0.0, "cells": {fc: {"count": 0, "acv": 0.0} for fc in ALL_FC}}

            if reg_name in lw_reg:
                d_lw = lw_reg[reg_name]
            elif reg_name in ("Other / Unmapped", "Other") and "Other" in lw_reg:
                d_lw = lw_reg["Other"]
            else:
                d_lw = {"count": 0, "acv": 0.0, "cells": {fc: {"count": 0, "acv": 0.0} for fc in ALL_FC}}

            pct_acv = round((d_today["acv"] / grand_acv * 100) if grand_acv else 0, 1)
            commit_acv = d_today["cells"]["Commit"]["acv"] + d_today["cells"]["Closed"]["acv"]
            commit_pct = round((commit_acv / d_today["acv"] * 100) if d_today["acv"] else 0, 1)

            approved_acv = d_today["approval"].get("Approved", {}).get("acv", 0.0)
            approved_pct = round((approved_acv / d_today["acv"] * 100) if d_today["acv"] else 0, 1)

            reg_delayed = delayed_df[delayed_df["region"] == reg_name] if not delayed_df.empty else pd.DataFrame()
            if reg_delayed.empty and reg_name in ("Other / Unmapped", "Other"):
                reg_delayed = delayed_df[delayed_df["region"].isin(["Other", "Other / Unmapped"]) | (~delayed_df["region"].isin(known_ordered))] if not delayed_df.empty else pd.DataFrame()
            del_cnt = len(reg_delayed)
            del_acv = round(float(reg_delayed["forecast_acv_amount"].sum()) if not reg_delayed.empty else 0.0, 2)

            regions_out.append({
                "region": reg_name,
                "count": d_today["count"],
                "acv": round(d_today["acv"], 2),
                "pct_acv": pct_acv,
                "commit_pct": commit_pct,
                "approved_pct": approved_pct,
                "delayed_count": del_cnt,
                "delayed_acv": del_acv,
                "cells": {k: {"count": v["count"], "acv": round(v["acv"], 2)} for k, v in d_today["cells"].items()},
                "approval": {k: {"count": v["count"], "acv": round(v["acv"], 2)} for k, v in d_today["approval"].items()},
                "delta_yesterday": {"count": d_today["count"] - d_y["count"], "acv": round(d_today["acv"] - d_y["acv"], 2)},
                "delta_lastweek": {"count": d_today["count"] - d_lw["count"], "acv": round(d_today["acv"] - d_lw["acv"], 2)}
            })

        fc_totals = {}
        for fc in ALL_FC:
            fc_df = df[df["forecast_category"] == fc] if not df.empty else pd.DataFrame()
            fc_y = y_df[y_df["forecast_category"] == fc] if not y_df.empty else pd.DataFrame()
            fc_lw = lw_df[lw_df["forecast_category"] == fc] if not lw_df.empty else pd.DataFrame()
            fc_totals[fc] = {
                "count": len(fc_df),
                "acv": round(float(fc_df["forecast_acv_amount"].sum()) if not fc_df.empty else 0.0, 2),
                "delta_yesterday": {"count": len(fc_df) - len(fc_y), "acv": round(float(fc_df["forecast_acv_amount"].sum() if not fc_df.empty else 0.0) - float(fc_y["forecast_acv_amount"].sum() if not fc_y.empty else 0.0), 2)},
                "delta_lastweek": {"count": len(fc_df) - len(fc_lw), "acv": round(float(fc_df["forecast_acv_amount"].sum() if not fc_df.empty else 0.0) - float(fc_lw["forecast_acv_amount"].sum() if not fc_lw.empty else 0.0), 2)},
            }

        app_totals = {}
        for st in FUNNEL_STAGES:
            st_df = df[df["approval_status"] == st] if not df.empty else pd.DataFrame()
            st_y = y_df[y_df["approval_status"] == st] if not y_df.empty else pd.DataFrame()
            st_lw = lw_df[lw_df["approval_status"] == st] if not lw_df.empty else pd.DataFrame()
            app_totals[st] = {
                "count": len(st_df),
                "acv": round(float(st_df["forecast_acv_amount"].sum()) if not st_df.empty else 0.0, 2),
                "delta_yesterday": {"count": len(st_df) - len(st_y), "acv": round(float(st_df["forecast_acv_amount"].sum() if not st_df.empty else 0.0) - float(st_y["forecast_acv_amount"].sum() if not st_y.empty else 0.0), 2)},
                "delta_lastweek": {"count": len(st_df) - len(st_lw), "acv": round(float(st_df["forecast_acv_amount"].sum() if not st_df.empty else 0.0) - float(st_lw["forecast_acv_amount"].sum() if not st_lw.empty else 0.0), 2)},
            }

        total_commit_acv = fc_totals.get("Commit", {}).get("acv", 0.0) + fc_totals.get("Closed", {}).get("acv", 0.0)
        total_commit_pct = round((total_commit_acv / grand_acv * 100) if grand_acv else 0.0, 1)
        total_approved_acv = app_totals.get("Approved", {}).get("acv", 0.0)
        total_approved_pct = round((total_approved_acv / grand_acv * 100) if grand_acv else 0.0, 1)
        total_delayed_acv = round(float(delayed_df["forecast_acv_amount"].sum()) if not delayed_df.empty else 0.0, 2)
        total_delayed_count = len(delayed_df)

        known_set = set(REGION_ORDER)
        unmapped = {"count": 0, "acv": 0.0, "values": []}
        if not df.empty:
            other_df = df[~df["region"].isin(known_set)]
            unmapped["count"] = len(other_df)
            unmapped["acv"] = round(float(other_df["forecast_acv_amount"].sum()), 2)
            unmapped["values"] = sorted(list(set([str(x) for x in other_df["raw_sub_region"].unique() if pd.notna(x) and x != ""])))

        return {
            "snapshot_date": snap.snapshot_date.isoformat(),
            "requested_as_of": fs.as_of or snap.snapshot_date.isoformat(),
            "yesterday_date": y_snap.snapshot_date.isoformat() if y_snap else None,
            "lastweek_date": lw_snap.snapshot_date.isoformat() if lw_snap else None,
            "data_slice": res.data_slice,
            "data_slice_key": res.resolved_quarter,
            "filters_applied": res.filters_applied,
            "total": {
                "count": grand_count,
                "acv": round(grand_acv, 2),
                "commit_pct": total_commit_pct,
                "approved_pct": total_approved_pct,
                "delayed_count": total_delayed_count,
                "delayed_acv": total_delayed_acv,
                "delta_yesterday": {"count": grand_count - len(y_df), "acv": round(grand_acv - float(y_df["forecast_acv_amount"].sum() if not y_df.empty else 0.0), 2)},
                "delta_lastweek": {"count": grand_count - len(lw_df), "acv": round(grand_acv - float(lw_df["forecast_acv_amount"].sum() if not lw_df.empty else 0.0), 2)},
            },
            "regions": regions_out,
            "totals": {
                "categories": fc_totals,
                "approval": app_totals,
            },
            "unmapped": unmapped
        }

    def get_region_summary(self, ctx: UserContext, region: str, as_of: Optional[str] = None, exclude_deleted_lost: bool = False) -> dict:
        base = self.get_summary(ctx, as_of=as_of, exclude_deleted_lost=exclude_deleted_lost)
        if "error" in base:
            return base

        reg_data = next((r for r in base["regions"] if r["region"] == region), None)
        if not reg_data:
            return {"error": "not_found"}

        snap = self._active_snap(as_of)
        eff_date = snap.snapshot_date
        if as_of:
            try: eff_date = date.fromisoformat(as_of)
            except ValueError: pass
        
        opps = self._q4_opps(snap, exclude_deleted=exclude_deleted_lost, target_date=eff_date)
        df = _opps_to_df(opps)
        
        known_set = set(REGION_ORDER)
        if region in ("Other / Unmapped", "Other"):
            reg_df = df[df["region"].isin(["Other", "Other / Unmapped"]) | (~df["region"].isin(known_set))] if not df.empty else pd.DataFrame()
        else:
            reg_df = df[df["region"] == region] if not df.empty else pd.DataFrame()

        reg_acv = float(reg_df["forecast_acv_amount"].sum()) if not reg_df.empty else 0.0
        reg_count = len(reg_df)

        # 1. Forecast category split (Closed, Commit, Best Case, Pipeline, Not yet proposed, Blank)
        fc_split = []
        for fc in ["Closed", "Commit", "Best Case", "Pipeline", "Not yet proposed"]:
            sub = reg_df[reg_df["forecast_category"] == fc] if not reg_df.empty else pd.DataFrame()
            cnt = len(sub)
            acv = round(float(sub["forecast_acv_amount"].sum()) if not sub.empty else 0.0, 2)
            pct = round((acv / reg_acv * 100) if reg_acv else 0.0, 1)
            fc_split.append({
                "category": fc,
                "count": cnt,
                "acv": acv,
                "pct_acv": pct
            })
        blank_sub = reg_df[reg_df["forecast_category"].isin(["Blank", "", None]) | reg_df["forecast_category"].isna()] if not reg_df.empty else pd.DataFrame()
        if not blank_sub.empty:
            b_cnt = len(blank_sub)
            b_acv = round(float(blank_sub["forecast_acv_amount"].sum()), 2)
            fc_split.append({
                "category": "Blank",
                "count": b_cnt,
                "acv": b_acv,
                "pct_acv": round((b_acv / reg_acv * 100) if reg_acv else 0.0, 1)
            })

        # 2. Approval status split
        app_split = []
        for st in ["Approved", "Pending Approval", "Pending-Approval", "Approved - 2nd", "Not submitted", "Blank", "Rejected"]:
            sub = reg_df[reg_df["approval_status"] == st] if not reg_df.empty else pd.DataFrame()
            if not sub.empty or st in ["Approved", "Pending Approval", "Not submitted"]:
                cnt = len(sub)
                acv = round(float(sub["forecast_acv_amount"].sum()) if not sub.empty else 0.0, 2)
                pct = round((acv / reg_acv * 100) if reg_acv else 0.0, 1)
                app_split.append({
                    "status": st,
                    "count": cnt,
                    "acv": acv,
                    "pct_acv": pct
                })

        # 3. Commit coverage and approved % compared with portfolio average (gap)
        reg_commit_pct = reg_data.get("commit_pct", 0.0)
        port_commit_pct = base.get("total", {}).get("commit_pct", 0.0)
        commit_gap = round(reg_commit_pct - port_commit_pct, 1)

        reg_approved_pct = reg_data.get("approved_pct", 0.0)
        port_approved_pct = base.get("total", {}).get("approved_pct", 0.0)
        approved_gap = round(reg_approved_pct - port_approved_pct, 1)

        # 4. Expiry by quarter for that region
        exp_col = "service_expiry_period" if "service_expiry_period" in reg_df.columns and reg_df["service_expiry_period"].notna().any() else "fiscal_period"
        exp_quarters = []
        if not reg_df.empty and exp_col in reg_df.columns:
            for q, grp in reg_df.groupby(exp_col):
                if pd.notna(q) and str(q).strip():
                    q_acv = round(float(grp["forecast_acv_amount"].sum()), 2)
                    exp_quarters.append({
                        "quarter": str(q).strip(),
                        "count": len(grp),
                        "acv": q_acv,
                        "pct_acv": round((q_acv / reg_acv * 100) if reg_acv else 0.0, 1)
                    })
            exp_quarters.sort(key=lambda x: ScopeService.parse_quarter(x["quarter"]))

        # 5. Top 10 accounts by ACV
        top_accounts = []
        if not reg_df.empty and "account_name" in reg_df.columns:
            for acc, grp in reg_df.groupby("account_name"):
                if pd.notna(acc) and str(acc).strip():
                    acc_acv = round(float(grp["forecast_acv_amount"].sum()), 2)
                    top_accounts.append({
                        "account_name": str(acc).strip(),
                        "count": len(grp),
                        "acv": acc_acv,
                        "pct_acv": round((acc_acv / reg_acv * 100) if reg_acv else 0.0, 1)
                    })
            top_accounts.sort(key=lambda x: x["acv"], reverse=True)
            top_accounts = top_accounts[:10]

        # 6. Top BUs with share
        bus = []
        if not reg_df.empty:
            for bu, grp in reg_df.groupby("business_unit"):
                if pd.notna(bu) and str(bu).strip():
                    bu_acv = round(float(grp["forecast_acv_amount"].sum()), 2)
                    bus.append({
                        "bu": str(bu).strip(),
                        "count": len(grp),
                        "acv": bu_acv,
                        "share_pct": round((bu_acv / reg_acv * 100) if reg_acv else 0.0, 1)
                    })
            bus.sort(key=lambda x: x["acv"], reverse=True)

        # 7. Delayed/overdue deals in that region
        snap_date = snap.snapshot_date
        delayed_deals = []
        if not reg_df.empty:
            for _, r in reg_df.iterrows():
                c_date = r.get("close_date")
                if pd.notna(c_date):
                    try:
                        c_d = pd.to_datetime(c_date).date()
                        if c_d < snap_date and r.get("forecast_category") != "Closed" and not r.get("is_deleted_or_lost"):
                            days_over = (snap_date - c_d).days
                            delayed_deals.append({
                                "opportunity_id_18": r.get("opportunity_id_18"),
                                "opportunity_name": r.get("opportunity_name"),
                                "account_name": r.get("account_name"),
                                "business_unit": r.get("business_unit"),
                                "forecast_category": r.get("forecast_category"),
                                "approval_status": r.get("approval_status"),
                                "acv": round(float(r.get("forecast_acv_amount") or 0.0), 2),
                                "close_date": c_d.isoformat(),
                                "days_overdue": days_over,
                                "owner": r.get("opportunity_owner") or "-"
                            })
                    except Exception:
                        pass
        delayed_deals.sort(key=lambda x: x["acv"], reverse=True)
        delayed_total_acv = round(sum(d["acv"] for d in delayed_deals), 2)
        delayed_total_count = len(delayed_deals)

        # 8. Concentration ("top 3 deals = X% of region ACV")
        sorted_deals = reg_df.sort_values(by="forecast_acv_amount", ascending=False) if not reg_df.empty else pd.DataFrame()
        top1_acv = float(sorted_deals.iloc[0]["forecast_acv_amount"]) if len(sorted_deals) >= 1 else 0.0
        top1_acc = str(sorted_deals.iloc[0]["account_name"]) if len(sorted_deals) >= 1 else "-"
        top1_pct = round((top1_acv / reg_acv * 100) if reg_acv else 0.0, 1)

        top3_acv = float(sorted_deals.head(3)["forecast_acv_amount"].sum()) if not sorted_deals.empty else 0.0
        top3_pct = round((top3_acv / reg_acv * 100) if reg_acv else 0.0, 1)
        concentration_text = f"Top 3 deals = {top3_pct}% of region ACV"

        # 9. 2-3 plain-language insight lines per region generated from the data
        insights = []
        if commit_gap < 0:
            insights.append(f"Commit coverage is {abs(commit_gap)} pts below portfolio average ({reg_commit_pct}% vs {port_commit_pct}%)")
        else:
            insights.append(f"Commit coverage is {commit_gap} pts above portfolio average ({reg_commit_pct}% vs {port_commit_pct}%)")

        if top1_pct >= 25:
            insights.append(f"One deal ({top1_acc}) is {top1_pct}% of region ACV (${top1_acv:,.2f})")
        else:
            insights.append(f"Top 3 deals represent {top3_pct}% of region ACV (${top3_acv:,.2f})")

        if delayed_total_count > 0:
            insights.append(f"{delayed_total_count} overdue deal{'s' if delayed_total_count > 1 else ''} totaling ${delayed_total_acv:,.2f} require attention")
        else:
            d_y = reg_data.get("delta_yesterday", {})
            d_y_acv = d_y.get("acv", 0.0)
            if d_y_acv != 0:
                insights.append(f"{'+' if d_y_acv > 0 else ''}${d_y_acv:,.2f} ({'+' if d_y.get('count', 0) > 0 else ''}{d_y.get('count', 0)} deals) vs yesterday")
            else:
                insights.append(f"Approved status covers {reg_approved_pct}% of region ACV")

        reg_data["forecast_categories"] = fc_split
        reg_data["approval_statuses"] = app_split
        reg_data["commit_coverage"] = {
            "region_pct": reg_commit_pct,
            "portfolio_pct": port_commit_pct,
            "gap": commit_gap
        }
        reg_data["approved_pct_detail"] = {
            "region_pct": reg_approved_pct,
            "portfolio_pct": port_approved_pct,
            "gap": approved_gap
        }
        reg_data["expiry_quarters"] = exp_quarters
        reg_data["top_accounts"] = top_accounts
        reg_data["business_units"] = bus
        reg_data["delayed_deals"] = {
            "count": delayed_total_count,
            "acv": delayed_total_acv,
            "deals": delayed_deals
        }
        reg_data["concentration"] = {
            "top1_acv": round(top1_acv, 2),
            "top1_pct": top1_pct,
            "top1_account": top1_acc,
            "top3_acv": round(top3_acv, 2),
            "top3_pct": top3_pct,
            "summary_text": concentration_text
        }
        reg_data["insights"] = insights
        return reg_data

    def get_movements(self, ctx: UserContext, region: str, compare: str = "yesterday", exclude_deleted_lost: bool = False) -> dict:
        snap = self._active_snap()
        if not snap: return {"error": "no_snapshot"}

        comp_snap = self._yesterday_snap(snap) if compare == "yesterday" else self._lastweek_snap(snap)
        if not comp_snap:
            return {"category_moves": [], "approval_moves": [], "new_to_slice": [], "slipped_out": []}

        target_fp = ScopeService.current_quarter(snap.snapshot_date)
        
        t_opps = self._q4_opps(snap, exclude_deleted=exclude_deleted_lost, target_date=snap.snapshot_date)
        c_opps = self._q4_opps(comp_snap, exclude_deleted=exclude_deleted_lost, target_date=snap.snapshot_date)
        
        t_df = _opps_to_df(t_opps)
        c_df = _opps_to_df(c_opps)

        t_reg = t_df[t_df["region"] == region] if not t_df.empty else pd.DataFrame()
        c_reg = c_df[c_df["region"] == region] if not c_df.empty else pd.DataFrame()

        t_idx = set(t_reg["opportunity_id_18"].tolist()) if not t_reg.empty else set()
        c_idx = set(c_reg["opportunity_id_18"].tolist()) if not c_reg.empty else set()

        # new to slice (in t but not c)
        new_ids = t_idx - c_idx
        new_list = []
        if new_ids:
            for i in new_ids:
                row = t_reg[t_reg["opportunity_id_18"] == i].iloc[0]
                new_list.append({
                    "opportunity_id_18": i,
                    "opportunity_name": row["opportunity_name"],
                    "account_name": row["account_name"],
                    "forecast_acv_amount": float(row["forecast_acv_amount"]),
                    "forecast_category": row["forecast_category"]
                })
        
        # slipped out (in c but not t)
        slip_ids = c_idx - t_idx
        slip_list = []
        if slip_ids:
            for i in slip_ids:
                row = c_reg[c_reg["opportunity_id_18"] == i].iloc[0]
                slip_list.append({
                    "opportunity_id_18": i,
                    "opportunity_name": row["opportunity_name"],
                    "account_name": row["account_name"],
                    "forecast_acv_amount": float(row["forecast_acv_amount"]),
                    "forecast_category": row["forecast_category"]
                })

        cat_moves = []
        app_moves = []
        common_ids = t_idx.intersection(c_idx)
        for i in common_ids:
            t_row = t_reg[t_reg["opportunity_id_18"] == i].iloc[0]
            c_row = c_reg[c_reg["opportunity_id_18"] == i].iloc[0]
            
            if t_row["forecast_category"] != c_row["forecast_category"]:
                cat_moves.append({
                    "from_category": c_row["forecast_category"],
                    "to_category": t_row["forecast_category"],
                    "count": 1,
                    "acv": float(t_row["forecast_acv_amount"]),
                    "deals": [{
                        "opportunity_id_18": i,
                        "opportunity_name": t_row["opportunity_name"],
                        "account_name": t_row["account_name"],
                        "forecast_acv_amount": float(t_row["forecast_acv_amount"]),
                    }]
                })
            
            if t_row["approval_status"] != c_row["approval_status"]:
                app_moves.append({
                    "from_status": c_row["approval_status"],
                    "to_status": t_row["approval_status"],
                    "count": 1,
                    "acv": float(t_row["forecast_acv_amount"]),
                    "deals": [{
                        "opportunity_id_18": i,
                        "opportunity_name": t_row["opportunity_name"],
                        "account_name": t_row["account_name"],
                        "forecast_acv_amount": float(t_row["forecast_acv_amount"]),
                    }]
                })
        
        c_agg = {}
        for m in cat_moves:
            k = (m["from_category"], m["to_category"])
            if k not in c_agg:
                c_agg[k] = {"from_category": k[0], "to_category": k[1], "count": 0, "acv": 0.0, "deals": []}
            c_agg[k]["count"] += 1
            c_agg[k]["acv"] = round(c_agg[k]["acv"] + m["acv"], 2)
            c_agg[k]["deals"].extend(m["deals"])
            
        a_agg = {}
        for m in app_moves:
            k = (m["from_status"], m["to_status"])
            if k not in a_agg:
                a_agg[k] = {"from_status": k[0], "to_status": k[1], "count": 0, "acv": 0.0, "deals": []}
            a_agg[k]["count"] += 1
            a_agg[k]["acv"] = round(a_agg[k]["acv"] + m["acv"], 2)
            a_agg[k]["deals"].extend(m["deals"])

        return {
            "category_moves": list(c_agg.values()),
            "approval_moves": list(a_agg.values()),
            "new_to_slice": {"count": len(new_list), "acv": round(sum(d["forecast_acv_amount"] for d in new_list), 2), "deals": new_list},
            "slipped_out": {"count": len(slip_list), "acv": round(sum(d["forecast_acv_amount"] for d in slip_list), 2), "deals": slip_list}
        }

    def get_deals(
        self,
        ctx: UserContext,
        region: str = "",
        category: str = "",
        categories: str = "",
        status: str = "",
        bu: str = "",
        account_name: str = "",
        quarter: str = "",
        delayed: bool = False,
        as_of: str = "",
        filter_spec: Optional[ScopeService.FilterSpec] = None
    ) -> dict:
        from backend.services.scopes import FilterSpec
        fs = filter_spec.model_copy() if filter_spec else FilterSpec()
        if as_of: fs.as_of = as_of
        if region:
            if region in ("Other", "Other / Unmapped"):
                fs.regions = [] # Filter dynamically below
            else:
                fs.regions = [region]
        if category: fs.forecast_categories = [category]
        if status: fs.approval_statuses = [status]
        if bu: fs.business_units = [bu]

        snap = self._active_snap(fs.as_of)
        if not snap: return {"error": "no_snapshot"}
            
        opps, res = self._scoped_opps(snap, filter_spec=fs)
        df = _opps_to_df(opps)

        if not df.empty:
            known_set = set(REGION_ORDER)
            if region in ("Other", "Other / Unmapped"):
                df = df[df["region"].isin(["Other", "Other / Unmapped"]) | (~df["region"].isin(known_set))]
            elif region:
                df = df[df["region"] == region]

            if categories:
                cat_list = [c.strip() for c in categories.split(",") if c.strip()]
                df = df[df["forecast_category"].isin(cat_list)]

            if account_name:
                df = df[df["account_name"] == account_name]

            if quarter:
                exp_col = "service_expiry_period" if "service_expiry_period" in df.columns and df["service_expiry_period"].notna().any() else "fiscal_period"
                df = df[df[exp_col] == quarter]

            if delayed:
                snap_date = snap.snapshot_date
                def _check_del(row):
                    cd = row.get("close_date")
                    if pd.isna(cd): return False
                    try:
                        return pd.to_datetime(cd).date() < snap_date and row.get("forecast_category") != "Closed" and not row.get("is_deleted_or_lost")
                    except Exception:
                        return False
                df = df[df.apply(_check_del, axis=1)]
                
        deals = df.to_dict("records") if not df.empty else []
        for d in deals:
            d["id"] = d["opportunity_id_18"]
        return {
            "count": len(deals),
            "acv": round(float(df["forecast_acv_amount"].sum()) if not df.empty else 0.0, 2),
            "filters_applied": res.filters_applied,
            "deals": deals
        }

    def get_top_opportunities(self, ctx: UserContext, region: str, limit: int = 10) -> list[dict]:
        snap = self._active_snap()
        if not snap: return []
        
        opps = self._q4_opps(snap, exclude_deleted=True, target_date=snap.snapshot_date)
        df = _opps_to_df(opps)
        
        if df.empty: return []
        df = df[df["region"] == region]
        df = df.sort_values(by="forecast_acv_amount", ascending=False).head(limit)
        
        deals = df.to_dict("records")
        for d in deals:
            d["id"] = d["opportunity_id_18"]
        return deals
