from __future__ import annotations
import logging
from datetime import date
from typing import Optional
import pandas as pd
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_
from backend.models.opportunity import Opportunity
from backend.models.snapshot import UploadSnapshot
from backend.services.context import UserContext
from backend.services.scopes import ScopeService

def _sum(df: pd.DataFrame, col: str) -> float:
    if df.empty or col not in df.columns:
        return 0.0
    return float(df[col].sum())

log = logging.getLogger(__name__)

ALL_FC = ["Closed", "Commit", "Best Case", "Pipeline", "Blank"]

class V2ExpiryService:
    def __init__(self, db: Session):
        self.db = db

    def _get_snapshot(self, ctx: UserContext, target_date: Optional[str] = None) -> Optional[UploadSnapshot]:
        q = self.db.query(UploadSnapshot)
        if target_date:
            if target_date == "yesterday":
                latest = q.order_by(UploadSnapshot.snapshot_date.desc()).first()
                if not latest: return None
                return q.filter(UploadSnapshot.snapshot_date < latest.snapshot_date).order_by(UploadSnapshot.snapshot_date.desc()).first()
            elif target_date == "last_week":
                latest = q.order_by(UploadSnapshot.snapshot_date.desc()).first()
                if not latest: return None
                target = latest.snapshot_date - pd.Timedelta(days=7)
                return q.filter(UploadSnapshot.snapshot_date <= target).order_by(UploadSnapshot.snapshot_date.desc()).first()
            else:
                try:
                    d = date.fromisoformat(target_date)
                    return q.filter(UploadSnapshot.snapshot_date <= d).order_by(UploadSnapshot.snapshot_date.desc()).first()
                except ValueError:
                    return None
        return q.order_by(UploadSnapshot.snapshot_date.desc()).first()

    def _window_opps(self, snap: UploadSnapshot, quarter: str, exclude_deleted_lost: bool) -> pd.DataFrame:
        q = self.db.query(Opportunity).filter(
            Opportunity.snapshot_id == snap.id,
            ScopeService.expiry_window(quarter)
        )
        if exclude_deleted_lost:
            q = q.filter(Opportunity.is_deleted_or_lost == False)
        
        opps = q.all()
        if not opps:
            return pd.DataFrame()
            
        data = []
        for o in opps:
            fc = o.forecast_category if o.forecast_category in ALL_FC else "Blank"
            if not o.forecast_category or str(o.forecast_category).strip() == "":
                fc = "Blank"
            elif o.forecast_category not in ["Closed", "Commit", "Best Case", "Pipeline"]:
                fc = "Blank"
                
            data.append({
                "id": o.id,
                "opportunity_id_18": o.opportunity_id_18,
                "forecast_category": fc,
                "forecast_acv_amount": float(o.forecast_acv_amount or 0),
                "service_expiry_period": o.service_expiry_period or "Blank",
                "close_date": o.close_date
            })
        
        df = pd.DataFrame(data)
        df = df.drop_duplicates(subset=["opportunity_id_18"], keep="last")
        return df

    def get_summary(
        self,
        ctx: UserContext,
        as_of: Optional[str] = None,
        compare: Optional[str] = None,
        exclude_deleted_lost: bool = False
    ) -> dict:
        snap = self._get_snapshot(ctx, as_of)
        if not snap:
            return {"error": "No snapshot found"}
            
        eff_date = snap.snapshot_date
        if as_of:
            from datetime import date
            try: eff_date = date.fromisoformat(as_of)
            except ValueError: pass
        target_quarter = ScopeService.current_quarter(eff_date)
        if not target_quarter or "-" not in target_quarter:
            return {"error": "Invalid current quarter"}
            
        _, current_y_str = target_quarter.split("-")
        current_y = int(current_y_str)
        next_y = current_y + 1
        
        df = self._window_opps(snap, target_quarter, exclude_deleted_lost)
        
        comp_snap = None
        if compare:
            comp_snap = self._get_snapshot(ctx, compare)
        comp_df = pd.DataFrame()
        if comp_snap:
            comp_df = self._window_opps(comp_snap, target_quarter, exclude_deleted_lost)
            
        snap_yest = self._get_snapshot(ctx, "yesterday")
        df_yest = self._window_opps(snap_yest, target_quarter, exclude_deleted_lost) if snap_yest else pd.DataFrame()
        
        snap_lw = self._get_snapshot(ctx, "last_week")
        df_lw = self._window_opps(snap_lw, target_quarter, exclude_deleted_lost) if snap_lw else pd.DataFrame()
        
        fy1_label = str(current_y)
        fy2_label = str(next_y)
        
        quarters = []
        for y in (current_y, next_y):
            for q in range(1, 5):
                key = f"Q{q}-{y}"
                label = ScopeService.quarter_label(key)
                quarters.append({"key": key, "label": label, "fy": str(y)})
                
        def build_grid(target_df: pd.DataFrame, y_label: str):
            rows = []
            fy_qs = [q for q in quarters if q["fy"] == y_label]
            grid_count = 0
            grid_acv = 0.0
            cat_totals = {fc: {"count": 0, "acv": 0.0} for fc in ALL_FC}
            
            for q in fy_qs:
                cells = {}
                row_count = 0
                row_acv = 0.0
                q_df = target_df[target_df["service_expiry_period"] == q["key"]] if not target_df.empty else pd.DataFrame()
                
                for fc in ALL_FC:
                    fc_df = q_df[q_df["forecast_category"] == fc] if not q_df.empty else pd.DataFrame()
                    c = len(fc_df)
                    a = round(_sum(fc_df, "forecast_acv_amount"), 2)
                    cells[fc] = {"count": c, "acv": a}
                    row_count += c
                    row_acv += a
                    
                    cat_totals[fc]["count"] += c
                    cat_totals[fc]["acv"] += a
                    
                rows.append({
                    "quarter": q["key"],
                    "label": q["label"],
                    "cells": cells,
                    "total": {"count": row_count, "acv": round(row_acv, 2)}
                })
                grid_count += row_count
                grid_acv += row_acv
                
            return {
                "rows": rows,
                "totals": {
                    "category": cat_totals,
                    "grand": {"count": grid_count, "acv": round(grid_acv, 2)}
                }
            }
            
        grid_current = build_grid(df, fy1_label)
        grid_next = build_grid(df, fy2_label)
        
        cgrid_current = build_grid(comp_df, fy1_label) if not comp_df.empty else build_grid(pd.DataFrame(), fy1_label)
        cgrid_next = build_grid(comp_df, fy2_label) if not comp_df.empty else build_grid(pd.DataFrame(), fy2_label)
        
        yest_grid_current = build_grid(df_yest, fy1_label) if not df_yest.empty else build_grid(pd.DataFrame(), fy1_label)
        yest_grid_next = build_grid(df_yest, fy2_label) if not df_yest.empty else build_grid(pd.DataFrame(), fy2_label)
        
        lw_grid_current = build_grid(df_lw, fy1_label) if not df_lw.empty else build_grid(pd.DataFrame(), fy1_label)
        lw_grid_next = build_grid(df_lw, fy2_label) if not df_lw.empty else build_grid(pd.DataFrame(), fy2_label)
        
        def compute_deltas(grid, cgrid):
            deltas = {
                "grand": {
                    "count": grid["totals"]["grand"]["count"] - cgrid["totals"]["grand"]["count"], 
                    "acv": round(grid["totals"]["grand"]["acv"] - cgrid["totals"]["grand"]["acv"], 2)
                },
                "category": {},
                "quarters": {}
            }
            for fc in ALL_FC:
                deltas["category"][fc] = {
                    "count": grid["totals"]["category"][fc]["count"] - cgrid["totals"]["category"][fc]["count"],
                    "acv": round(grid["totals"]["category"][fc]["acv"] - cgrid["totals"]["category"][fc]["acv"], 2)
                }
            for i, r in enumerate(grid["rows"]):
                cr = cgrid["rows"][i]
                deltas["quarters"][r["quarter"]] = {
                    "count": r["total"]["count"] - cr["total"]["count"],
                    "acv": round(r["total"]["acv"] - cr["total"]["acv"], 2)
                }
            return deltas
            
        deltas_current = {}
        deltas_next = {}
        if compare:
            deltas_current["custom"] = compute_deltas(grid_current, cgrid_current)
            deltas_next["custom"] = compute_deltas(grid_next, cgrid_next)
        
        deltas_current["yesterday"] = compute_deltas(grid_current, yest_grid_current)
        deltas_current["lastweek"] = compute_deltas(grid_current, lw_grid_current)
        
        deltas_next["yesterday"] = compute_deltas(grid_next, yest_grid_next)
        deltas_next["lastweek"] = compute_deltas(grid_next, lw_grid_next)
        
        _, fy_end_date = ScopeService.quarter_bounds(f"Q4-{current_y}")
        slip_df = df[df["close_date"] > fy_end_date] if not df.empty else pd.DataFrame()
        slip_count = len(slip_df)
        slip_acv = _sum(slip_df, "forecast_acv_amount")
        
        slip_by_quarter = []
        if not slip_df.empty:
            for q in quarters:
                q_slip = slip_df[slip_df["service_expiry_period"] == q["key"]]
                if not q_slip.empty:
                    slip_by_quarter.append({
                        "quarter": q["key"],
                        "count": len(q_slip),
                        "acv": round(_sum(q_slip, "forecast_acv_amount"), 2)
                    })
        
        return {
            "snapshot_date": snap.snapshot_date.isoformat(),
            "compare_date": comp_snap.snapshot_date.isoformat() if comp_snap else None,
            "data_slice": ScopeService.quarter_label(target_quarter),
            "data_slice_key": target_quarter,
            "fiscal_years": [
                {"label": fy1_label, "quarters": [{"key": q["key"], "label": q["label"]} for q in quarters if q["fy"] == fy1_label]},
                {"label": fy2_label, "quarters": [{"key": q["key"], "label": q["label"]} for q in quarters if q["fy"] == fy2_label]}
            ],
            "categories": ALL_FC,
            "grids": {
                fy1_label: grid_current,
                fy2_label: grid_next
            },
            "acv_by_year": {
                fy1_label: grid_current["totals"]["grand"],
                fy2_label: grid_next["totals"]["grand"]
            },
            "grand_total": {
                "count": grid_current["totals"]["grand"]["count"] + grid_next["totals"]["grand"]["count"],
                "acv": round(grid_current["totals"]["grand"]["acv"] + grid_next["totals"]["grand"]["acv"], 2)
            },
            "slippage": {
                "count": slip_count,
                "acv": round(slip_acv, 2),
                "by_quarter": slip_by_quarter
            },
            "deltas": {
                fy1_label: deltas_current,
                fy2_label: deltas_next
            }
        }
        
    def get_deals(
        self,
        ctx: UserContext,
        quarter: Optional[str] = None,
        category: Optional[str] = None,
        as_of: Optional[str] = None,
        exclude_deleted_lost: bool = False,
        slippage: bool = False
    ) -> list[dict]:
        snap = self._get_snapshot(ctx, as_of)
        if not snap:
            return []
            
        target_quarter = ScopeService.current_quarter(snap.snapshot_date)
        q = self.db.query(Opportunity).filter(
            Opportunity.snapshot_id == snap.id,
            ScopeService.expiry_window(target_quarter)
        )
        if exclude_deleted_lost:
            q = q.filter(Opportunity.is_deleted_or_lost == False)
            
        if slippage:
            _, current_y_str = target_quarter.split("-")
            _, fy_end_date = ScopeService.quarter_bounds(f"Q4-{current_y_str}")
            q = q.filter(Opportunity.close_date > fy_end_date)

        if quarter:
            q = q.filter(Opportunity.service_expiry_period == quarter)
        if category:
            if category == "Blank":
                q = q.filter(or_(Opportunity.forecast_category == None, Opportunity.forecast_category == "", ~Opportunity.forecast_category.in_(["Closed", "Commit", "Best Case", "Pipeline"])))
            else:
                q = q.filter(Opportunity.forecast_category == category)
                
        opps = q.all()
        seen = set()
        deduped = []
        for o in reversed(opps): 
            if o.opportunity_id_18 not in seen:
                seen.add(o.opportunity_id_18)
                deduped.append(o)
        
        def to_dict(o):
            return {
                "id": o.id,
                "opportunity_id_18": o.opportunity_id_18,
                "opportunity_name": o.opportunity_name,
                "account_name": o.account_name,
                "forecast_category": o.forecast_category,
                "forecast_acv_amount": float(o.forecast_acv_amount or 0),
                "approval_status": o.approval_status,
                "sub_region": o.sub_region,
                "business_unit_primary": o.business_unit_primary,
                "service_expiry_period": o.service_expiry_period,
                "close_date": o.close_date.isoformat() if o.close_date else None
            }
        return [to_dict(o) for o in reversed(deduped)]