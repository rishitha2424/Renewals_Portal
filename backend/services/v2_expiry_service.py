from __future__ import annotations
import logging
import re
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
                latest = self._get_snapshot(ctx)
                if not latest: return None
                return q.filter(UploadSnapshot.snapshot_date < latest.snapshot_date).order_by(UploadSnapshot.snapshot_date.desc()).first()
            elif target_date == "last_week":
                latest = self._get_snapshot(ctx)
                if not latest: return None
                target = latest.snapshot_date - pd.Timedelta(days=7)
                return q.filter(UploadSnapshot.snapshot_date <= target).order_by(UploadSnapshot.snapshot_date.desc()).first()
            else:
                by_id = q.filter(UploadSnapshot.id == target_date).first()
                if by_id:
                    return by_id
                try:
                    d = date.fromisoformat(target_date)
                    exact = q.filter(UploadSnapshot.snapshot_date == d).first()
                    if exact:
                        return exact
                    snap = q.filter(UploadSnapshot.snapshot_date <= d).order_by(UploadSnapshot.snapshot_date.desc()).first()
                    if snap:
                        return snap
                except ValueError:
                    pass
                return None
        active = q.filter(UploadSnapshot.is_active_today == True).first()
        if active:
            return active
        return q.order_by(UploadSnapshot.snapshot_date.desc()).first()

    def _window_opps(self, snap: UploadSnapshot, filter_spec: Optional[ScopeService.FilterSpec] = None, exclude_deleted_lost: bool = False, period_type: str = "fiscal") -> tuple[pd.DataFrame, list[str]]:
        from backend.services.scopes import FilterSpec
        fs = filter_spec.model_copy() if filter_spec else FilterSpec()
        if exclude_deleted_lost:
            fs.include_deleted_lost = False
            
        fs_for_expiry = fs.model_copy()
        fs_for_expiry.period = "all_periods"
        if period_type == "fiscal":
            fs_for_expiry.sales_types = ["Renewals"]
        res = ScopeService.resolve(fs_for_expiry, snapshot=snap, as_of_date=snap.snapshot_date, db=self.db)
        
        q = self.db.query(Opportunity).filter(
            Opportunity.snapshot_id == snap.id,
            *res.conditions
        )
        if period_type == "fiscal":
            q = q.filter(Opportunity.sales_type == "Renewals")
        
        opps = q.all()
        if not opps:
            return pd.DataFrame(), [], res
            
        data = []
        years_found = set()
        for o in opps:
            fc = o.forecast_category if o.forecast_category in ALL_FC else "Blank"
            if not o.forecast_category or str(o.forecast_category).strip() == "":
                fc = "Blank"
            elif o.forecast_category not in ["Closed", "Commit", "Best Case", "Pipeline"]:
                fc = "Blank"
                
            sep = o.service_expiry_period or "Blank"
            fp = o.fiscal_period or "Blank"
            p_val = fp if period_type == "fiscal" else sep
            if p_val and "-" in p_val:
                try:
                    parts = p_val.split("-")
                    if len(parts) == 2 and parts[1].isdigit():
                        years_found.add(parts[1])
                except:
                    pass
                    
            data.append({
                "id": o.id,
                "opportunity_id_18": o.opportunity_id_18,
                "forecast_category": fc,
                "forecast_acv_amount": float(o.forecast_acv_amount or 0),
                "service_expiry_period": sep,
                "fiscal_period": o.fiscal_period,
                "sales_type": o.sales_type,
                "close_date": o.close_date
            })
        
        df = pd.DataFrame(data)
        df = df.drop_duplicates(subset=["opportunity_id_18"], keep="last")
        sorted_years = sorted(list(years_found))
        return df, sorted_years, res

    def get_summary(
        self,
        ctx: UserContext,
        as_of: Optional[str] = None,
        compare: Optional[str] = None,
        exclude_deleted_lost: bool = False,
        period_type: str = "fiscal",
        filter_spec: Optional[ScopeService.FilterSpec] = None
    ) -> dict:
        eff_as_of = as_of or (filter_spec.as_of if filter_spec else None)
        eff_compare = compare or (filter_spec.compare if filter_spec else None)
        snap = self._get_snapshot(ctx, eff_as_of)
        if not snap:
            return {"error": "No snapshot found"}
            
        df, years_found, win_res = self._window_opps(snap, filter_spec=filter_spec, exclude_deleted_lost=exclude_deleted_lost, period_type=period_type)
        
        eff_date = snap.snapshot_date
        if eff_as_of:
            try:
                eff_date = date.fromisoformat(eff_as_of)
            except ValueError:
                pass
        target_quarter = ScopeService.current_quarter(eff_date)
        _, current_y_str = target_quarter.split("-") if (target_quarter and "-" in target_quarter) else ("", "2026")
        next_y_str = str(int(current_y_str) + 1)
        default_years = [current_y_str, next_y_str]
        
        fs_period = (filter_spec.period if filter_spec and filter_spec.period else "current_quarter").strip()
        if fs_period == "all_periods" or fs_period == "all":
            years_to_use = sorted(years_found) if years_found else default_years
        elif fs_period.upper().startswith("FY"):
            years_to_use = [fs_period[2:]]
        elif re.match(r"^Q[1-4]-\d{4}$", fs_period, re.IGNORECASE):
            years_to_use = [fs_period.split("-")[1]]
        else:
            # Default Expiry window: current FY + next FY
            years_to_use = default_years
            
        comp_snap = None
        if eff_compare:
            comp_snap = self._get_snapshot(ctx, eff_compare)
        comp_df = pd.DataFrame()
        if comp_snap:
            comp_df, _, _ = self._window_opps(comp_snap, filter_spec=filter_spec, exclude_deleted_lost=exclude_deleted_lost, period_type=period_type)
            
        snap_yest = self._get_snapshot(ctx, "yesterday")
        df_yest, _, _ = self._window_opps(snap_yest, filter_spec=filter_spec, exclude_deleted_lost=exclude_deleted_lost, period_type=period_type) if snap_yest else (pd.DataFrame(), [], None)
        
        snap_lw = self._get_snapshot(ctx, "last_week")
        df_lw, _, _ = self._window_opps(snap_lw, filter_spec=filter_spec, exclude_deleted_lost=exclude_deleted_lost, period_type=period_type) if snap_lw else (pd.DataFrame(), [], None)
        
        quarters = []
        for y_str in years_to_use:
            for q in range(1, 5):
                key = f"Q{q}-{y_str}"
                label = ScopeService.quarter_label(key)
                quarters.append({"key": key, "label": label, "fy": y_str})
                
        period_col = "fiscal_period" if period_type == "fiscal" else "service_expiry_period"

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
                q_df = target_df[target_df[period_col] == q["key"]] if (not target_df.empty and period_col in target_df.columns) else pd.DataFrame()
                
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
            
        grids = {}
        cgrids = {}
        yest_grids = {}
        lw_grids = {}
        deltas = {}
        acv_by_year = {}
        grand_total_count = 0
        grand_total_acv = 0.0

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

        for y_label in years_to_use:
            g = build_grid(df, y_label)
            grids[y_label] = g
            acv_by_year[y_label] = g["totals"]["grand"]
            grand_total_count += g["totals"]["grand"]["count"]
            grand_total_acv += g["totals"]["grand"]["acv"]
            
            cg = build_grid(comp_df, y_label) if not comp_df.empty else build_grid(pd.DataFrame(), y_label)
            yg = build_grid(df_yest, y_label) if not df_yest.empty else build_grid(pd.DataFrame(), y_label)
            lg = build_grid(df_lw, y_label) if not df_lw.empty else build_grid(pd.DataFrame(), y_label)
            
            y_deltas = {
                "yesterday": compute_deltas(g, yg),
                "lastweek": compute_deltas(g, lg)
            }
            if eff_compare:
                y_deltas["custom"] = compute_deltas(g, cg)
            deltas[y_label] = y_deltas
            
        # Compute Slippage using the shared V2DelayedService (Section A rule)
        from backend.services.v2_delayed_service import V2DelayedService
        delayed_svc = V2DelayedService(self.db)
        target_quarter = res.resolved_quarter if hasattr(res, "resolved_quarter") else target_quarter
        delayed_buckets = delayed_svc._compute_snapshot_buckets(snap, target_quarter, filter_spec=fs)
        slip_df = delayed_buckets.get("slippage_total", pd.DataFrame())
        slip_count = len(slip_df)
        slip_acv = round(float(slip_df["forecast_acv_amount"].sum()) if not slip_df.empty else 0.0, 2)
        
        slip_by_quarter = []
        if not slip_df.empty:
            for q in quarters:
                q_slip = slip_df[slip_df[period_col] == q["key"]] if period_col in slip_df.columns else pd.DataFrame()
                if not q_slip.empty:
                    slip_by_quarter.append({
                        "quarter": q["key"],
                        "count": len(q_slip),
                        "acv": round(_sum(q_slip, "forecast_acv_amount"), 2)
                    })
        
        # Build Profile Chart tied to Overview & Executive numbers (fiscal quarters for Renewals)
        chart_columns = []
        chart_df = df[df["sales_type"] == "Renewals"] if ("sales_type" in df.columns and not df.empty) else df

        for q in quarters:
            q_key = q["key"]
            q_label = q["label"]
            q_sub = chart_df[chart_df[period_col] == q_key] if (not chart_df.empty and period_col in chart_df.columns) else pd.DataFrame()

            q_tot_acv = round(_sum(q_sub, "forecast_acv_amount"), 2)
            q_deal_cnt = len(q_sub)

            # 5 categories in order: Closed, Commit, Best Case, Pipeline, Not yet proposed
            cats_breakdown = {}
            commit_acv = 0.0
            for fc_key, fc_label in [
                ("Closed", "Closed"),
                ("Commit", "Commit"),
                ("Best Case", "Best Case"),
                ("Pipeline", "Pipeline"),
                ("Blank", "Not yet proposed")
            ]:
                fc_sub = q_sub[q_sub["forecast_category"] == fc_key] if not q_sub.empty else pd.DataFrame()
                fc_cnt = len(fc_sub)
                fc_acv = round(_sum(fc_sub, "forecast_acv_amount"), 2)
                fc_pct = round((fc_acv / q_tot_acv * 100), 1) if q_tot_acv > 0 else 0.0
                if fc_key == "Commit":
                    commit_acv = fc_acv
                cats_breakdown[fc_label] = {
                    "count": fc_cnt,
                    "acv": fc_acv,
                    "pct": fc_pct,
                    "raw_category": fc_key
                }

            commit_cov_pct = round((commit_acv / q_tot_acv * 100), 1) if q_tot_acv > 0 else 0.0
            chart_columns.append({
                "quarter": q_key,
                "label": q_label,
                "is_current": (q_key == target_quarter),
                "total_acv": q_tot_acv,
                "deal_count": q_deal_cnt,
                "commit_coverage_pct": commit_cov_pct,
                "categories": cats_breakdown
            })

        from backend.services.scopes import FilterSpec
        fs = filter_spec.model_copy() if filter_spec else FilterSpec()
        res = ScopeService.resolve(fs, snapshot=snap, as_of_date=eff_date, db=self.db)

        other_types_excluded = None
        if res.effective_types is not None:
            base_opps = self.db.query(Opportunity).filter(
                Opportunity.snapshot_id == snap.id,
                *res.base_conditions
            ).all()
            excluded_opps = [
                o for o in base_opps
                if ScopeService.extract_type_code(
                    (o.extra_attributes or {}).get("Type") or (o.extra_attributes or {}).get("type") or o.sales_type
                ) not in res.effective_types
            ]
            if excluded_opps:
                exc_cnt = len(excluded_opps)
                exc_acv = round(sum(float(o.forecast_acv_amount or 0.0) for o in excluded_opps), 2)
                other_types_excluded = {
                    "count": exc_cnt,
                    "acv": exc_acv,
                    "note": f"Other types excluded: {exc_cnt} deals / ${exc_acv:,.2f}",
                    "deals": [
                        {
                            "id": o.opportunity_id_18,
                            "opportunity_id_18": o.opportunity_id_18,
                            "opportunity_name": o.opportunity_name,
                            "account_name": o.account_name,
                            "forecast_category": o.forecast_category,
                            "forecast_acv_amount": float(o.forecast_acv_amount or 0.0),
                            "sub_region": o.sub_region,
                            "business_unit_primary": o.business_unit_primary,
                            "approval_status": o.approval_status,
                            "close_date": o.close_date.isoformat() if hasattr(o.close_date, "isoformat") else str(o.close_date) if o.close_date else None,
                            "type": (o.extra_attributes or {}).get("Type") or (o.extra_attributes or {}).get("type"),
                        }
                        for o in excluded_opps
                    ]
                }

        return {
            "snapshot_date": snap.snapshot_date.isoformat(),
            "requested_as_of": eff_as_of or snap.snapshot_date.isoformat(),
            "compare_date": comp_snap.snapshot_date.isoformat() if comp_snap else None,
            "period_type": period_type,
            "data_slice": res.label,
            "data_slice_key": target_quarter,
            "filters_applied": res.filters_applied,
            "other_types_excluded": other_types_excluded,
            "fiscal_years": [
                {"label": y_label, "quarters": [{"key": q["key"], "label": q["label"]} for q in quarters if q["fy"] == y_label]}
                for y_label in years_to_use
            ],
            "categories": ALL_FC,
            "grids": grids,
            "profile_chart": chart_columns,
            "acv_by_year": acv_by_year,
            "grand_total": {
                "count": grand_total_count,
                "acv": round(grand_total_acv, 2)
            },
            "slippage": {
                "count": slip_count,
                "acv": round(slip_acv, 2),
                "by_quarter": slip_by_quarter
            },
            "deltas": deltas
        }
        
    def get_deals(
        self,
        ctx: UserContext,
        quarter: Optional[str] = None,
        category: Optional[str] = None,
        as_of: Optional[str] = None,
        exclude_deleted_lost: bool = False,
        slippage: bool = False,
        period_type: str = "fiscal",
        kind: Optional[str] = None,
        filter_spec: Optional[ScopeService.FilterSpec] = None
    ) -> list[dict]:
        eff_as_of = as_of or (filter_spec.as_of if filter_spec else None)
        snap = self._get_snapshot(ctx, eff_as_of)
        if not snap:
            return []
            
        from backend.services.scopes import FilterSpec
        fs = filter_spec.model_copy() if filter_spec else FilterSpec()
        if exclude_deleted_lost:
            fs.include_deleted_lost = False
        fs_for_expiry = fs.model_copy()
        fs_for_expiry.period = "all_periods"
        if period_type == "fiscal":
            fs_for_expiry.sales_types = ["Renewals"]
        res = ScopeService.resolve(fs_for_expiry, snapshot=snap, as_of_date=snap.snapshot_date, db=self.db)
        
        if kind == "other_types" or category == "other_types":
            deals = []
            if res.effective_types is not None:
                base_opps = self.db.query(Opportunity).filter(
                    Opportunity.snapshot_id == snap.id,
                    *res.base_conditions
                ).all()
                for o in base_opps:
                    raw_tp = (o.extra_attributes or {}).get("Type") or (o.extra_attributes or {}).get("type") or o.sales_type
                    if ScopeService.extract_type_code(raw_tp) not in res.effective_types:
                        deals.append({
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
                            "fiscal_period": o.fiscal_period,
                            "close_date": o.close_date.isoformat() if o.close_date else None,
                            "type": raw_tp,
                        })
            return deals

        q = self.db.query(Opportunity).filter(
            Opportunity.snapshot_id == snap.id,
            *res.conditions
        )
        if period_type == "fiscal":
            q = q.filter(Opportunity.sales_type == "Renewals")
            
        target_quarter = ScopeService.current_quarter(snap.snapshot_date)
        _, current_y_str = target_quarter.split("-") if (target_quarter and "-" in target_quarter) else ("", "2026")
        next_y_str = str(int(current_y_str) + 1)
        default_grid_quarters = [f"Q{q}-{y}" for y in [current_y_str, next_y_str] for q in range(1, 5)]

        period_col_attr = Opportunity.fiscal_period if period_type == "fiscal" else Opportunity.service_expiry_period

        if slippage or kind == "slippage":
            from backend.services.v2_delayed_service import V2DelayedService
            delayed_svc = V2DelayedService(self.db)
            target_quarter = res.resolved_quarter if hasattr(res, "resolved_quarter") else ScopeService.quarter_of(eff_as_of_date or snap.snapshot_date)
            delayed_buckets = delayed_svc._compute_snapshot_buckets(snap, target_quarter, filter_spec=fs)
            slip_df = delayed_buckets.get("slippage_total", pd.DataFrame())
            deals = slip_df.to_dict("records") if not slip_df.empty else []
            for d in deals:
                d["id"] = d.get("opportunity_id_18")
            return deals

        if quarter:
            q = q.filter(period_col_attr == quarter)
        elif not slippage:
            q = q.filter(period_col_attr.in_(default_grid_quarters))

        if category:
            if category in ("Blank", "Not yet proposed"):
                q = q.filter(or_(Opportunity.forecast_category == None, Opportunity.forecast_category == "", Opportunity.forecast_category == "Not yet proposed", Opportunity.forecast_category == "Blank", ~Opportunity.forecast_category.in_(["Closed", "Commit", "Best Case", "Pipeline"])))
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
                "fiscal_period": o.fiscal_period,
                "close_date": o.close_date.isoformat() if o.close_date else None
            }
        return [to_dict(o) for o in reversed(deduped)]