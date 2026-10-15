from __future__ import annotations
from typing import Optional, Any
import pandas as pd
from datetime import date
from sqlalchemy.orm import Session
from backend.models.snapshot import UploadSnapshot
from backend.models.opportunity import Opportunity
from backend.services.scopes import ScopeService
from backend.services.context import UserContext

ALL_FC = ["Best Case", "Blank", "Closed", "Commit", "Pipeline"]

def _parse_fp(fp: str) -> tuple[int, int]:
    """Parse 'Qx-YYYY' into (YYYY, x)."""
    if not fp or "-" not in fp:
        return (0, 0)
    q_str, y_str = fp.split("-")
    return (int(y_str), int(q_str[1:]))

def _opps_to_df(opps: list[Opportunity]) -> pd.DataFrame:
    if not opps:
        return pd.DataFrame()
    records = []
    for o in opps:
        fc = (o.forecast_category or "Blank").strip()
        if fc in ("", "Not yet proposed"):
            fc = "Blank"
            
        bu = str(o.business_unit_raw).strip() if o.business_unit_raw else "Unassigned"
        if bu == "" or bu.lower() == "nan":
            bu = "Unassigned"

        records.append({
            "opportunity_id_18": o.opportunity_id_18,
            "opportunity_name": o.opportunity_name,
            "account_name": o.account_name,
            "forecast_acv_amount": float(o.forecast_acv_amount or 0.0),
            "forecast_category": fc,
            "business_unit": bu,
            "business_unit_primary": o.business_unit_primary or bu,
            "sub_region": o.revised_sub_region or "",
            "is_deleted_or_lost": bool(o.is_deleted_or_lost),
            "fiscal_period": o.fiscal_period or "",
            "close_date": o.close_date,
            "approval_status": o.approval_status or "",
        })
    return pd.DataFrame(records)


class V2BusinessUnitsService:
    def __init__(self, db: Session):
        self.db = db

    def _active_snap(self, as_of: str = None) -> UploadSnapshot | None:
        if as_of:
            try:
                d = date.fromisoformat(as_of)
                snap = self.db.query(UploadSnapshot).filter(UploadSnapshot.snapshot_date <= d).order_by(UploadSnapshot.snapshot_date.desc()).first()
                if snap:
                    return snap
            except ValueError:
                pass
            by_id = self.db.query(UploadSnapshot).filter(UploadSnapshot.id == as_of).first()
            if by_id:
                return by_id
        return (
            self.db.query(UploadSnapshot)
            .filter(UploadSnapshot.is_active_today == True)
            .order_by(UploadSnapshot.snapshot_date.desc())
            .first()
        )

    def _yesterday_snap(self, snap: UploadSnapshot) -> UploadSnapshot | None:
        from datetime import timedelta
        yd = getattr(snap, "yesterday_date", None)
        if yd:
            return self.db.query(UploadSnapshot).filter(UploadSnapshot.snapshot_date == yd).first()
        for i in range(1, 5):
            d = snap.snapshot_date - timedelta(days=i)
            s = self.db.query(UploadSnapshot).filter(UploadSnapshot.snapshot_date == d).first()
            if s:
                return s
        return None

    def _lastweek_snap(self, snap: UploadSnapshot) -> UploadSnapshot | None:
        from datetime import timedelta
        ld = getattr(snap, "last_week_date", None)
        if ld:
            return self.db.query(UploadSnapshot).filter(UploadSnapshot.snapshot_date == ld).first()
        d = snap.snapshot_date - timedelta(days=7)
        s = self.db.query(UploadSnapshot).filter(UploadSnapshot.snapshot_date == d).first()
        if s: return s
        for i in range(6, 9):
            d = snap.snapshot_date - timedelta(days=i)
            s = self.db.query(UploadSnapshot).filter(UploadSnapshot.snapshot_date == d).first()
            if s: return s
        return None

    def _build_filter_spec(
        self,
        filter_spec: Optional[ScopeService.FilterSpec] = None,
        as_of: Optional[str] = None,
        compare: Optional[str] = None,
        period: Optional[str] = None,
        bu: Optional[str] = None,
        category: Optional[str] = None,
        status: Optional[str] = None,
        include_deleted_lost: Optional[bool] = None,
        exclude_deleted_lost: bool = False,
    ) -> ScopeService.FilterSpec:
        from backend.services.scopes import FilterSpec
        fs = filter_spec.model_copy() if filter_spec else FilterSpec()
        if as_of:
            fs.as_of = as_of
        if compare:
            fs.compare = compare
        if period:
            fs.period = period
        if include_deleted_lost is not None:
            fs.include_deleted_lost = bool(include_deleted_lost)
        elif exclude_deleted_lost:
            fs.include_deleted_lost = False

        if bu and bu not in ("All", "Total", "Grand Total"):
            fs.business_units = [bu]
        elif bu in ("All", "Total", "Grand Total"):
            fs.business_units = []

        if category and category not in ("All", "Total", "Grand Total"):
            fs.forecast_categories = [category]
        elif category in ("All", "Total", "Grand Total"):
            fs.forecast_categories = []

        if status and status not in ("All", "Total"):
            fs.approval_statuses = [status]

        if not fs.sales_types:
            fs.sales_types = ["Renewals"]

        return fs

    def _scoped_opps(self, snap: UploadSnapshot, filter_spec: Optional[ScopeService.FilterSpec] = None, exclude_deleted: bool = False, target_date = None) -> tuple[list[Opportunity], Any]:
        from backend.services.scopes import FilterSpec
        fs = filter_spec.model_copy() if filter_spec else FilterSpec()
        if exclude_deleted:
            fs.include_deleted_lost = False
        eff_date = target_date
        if not eff_date and fs.as_of:
            try:
                eff_date = date.fromisoformat(fs.as_of)
            except ValueError:
                pass
        if not eff_date:
            eff_date = snap.snapshot_date
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


    def get_summary(
        self,
        ctx: UserContext,
        as_of: str = None,
        compare: str = None,
        period: str = None,
        exclude_deleted_lost: bool = False,
        include_deleted_lost: Optional[bool] = None,
        filter_spec: Optional[ScopeService.FilterSpec] = None,
    ) -> dict:
        fs = self._build_filter_spec(
            filter_spec=filter_spec,
            as_of=as_of,
            compare=compare,
            period=period,
            exclude_deleted_lost=exclude_deleted_lost,
            include_deleted_lost=include_deleted_lost,
        )

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

        comp = fs.compare if fs.compare in ("yesterday", "last_week") else "yesterday"
        y_snap = self._yesterday_snap(snap)
        lw_snap = self._lastweek_snap(snap)

        y_opps, _ = self._scoped_opps(y_snap, filter_spec=fs, target_date=eff_as_of_date) if y_snap else ([], None)
        lw_opps, _ = self._scoped_opps(lw_snap, filter_spec=fs, target_date=eff_as_of_date) if lw_snap else ([], None)
        y_df = _opps_to_df(y_opps)
        lw_df = _opps_to_df(lw_opps)

        def _get_bu_totals(df_in: pd.DataFrame) -> dict:
            if df_in.empty: return {}
            # Group by BU and Forecast Category
            g = df_in.groupby(["business_unit", "forecast_category"])["forecast_acv_amount"].agg(["count", "sum"])
            # Unstack for matrix
            counts = g["count"].unstack(fill_value=0)
            sums = g["sum"].unstack(fill_value=0.0)
            
            # Row totals
            row_counts = counts.sum(axis=1)
            row_sums = sums.sum(axis=1)
            
            res = {}
            for bu in counts.index:
                cells = {}
                for fc in counts.columns:
                    cells[fc] = {"count": int(counts.loc[bu, fc]), "acv": float(sums.loc[bu, fc])}
                res[bu] = {
                    "count": int(row_counts[bu]),
                    "acv": float(row_sums[bu]),
                    "cells": cells
                }
            return res

        today_totals = _get_bu_totals(df)
        y_totals = _get_bu_totals(y_df)
        lw_totals = _get_bu_totals(lw_df)
        
        all_bus = list(today_totals.keys())
        # Sort all_bus by today's ACV descending
        all_bus.sort(key=lambda bu: today_totals[bu]["acv"], reverse=True)

        rows = []
        grand_count = 0
        grand_acv = 0.0
        
        fc_grand_totals = {fc: {"count": 0, "acv": 0.0} for fc in ALL_FC}
        
        if not df.empty:
            grand_count = len(df)
            grand_acv = float(df["forecast_acv_amount"].sum())
            for fc in ALL_FC:
                fc_df = df[df["forecast_category"] == fc]
                fc_grand_totals[fc]["count"] = len(fc_df)
                fc_grand_totals[fc]["acv"] = float(fc_df["forecast_acv_amount"].sum())

        def _calc_delta(td, prev):
            if not prev: return {"count": 0, "acv": 0.0}
            c = td.get("count", 0) - prev.get("count", 0)
            a = td.get("acv", 0.0) - prev.get("acv", 0.0)
            return {"count": c, "acv": round(a, 2)}
            
        def _get_grand_delta(fc, df_in, prev_df_in):
            td_c = len(df_in[df_in["forecast_category"] == fc]) if not df_in.empty else 0
            td_a = float(df_in[df_in["forecast_category"] == fc]["forecast_acv_amount"].sum()) if not df_in.empty else 0.0
            
            pr_c = len(prev_df_in[prev_df_in["forecast_category"] == fc]) if not prev_df_in.empty else 0
            pr_a = float(prev_df_in[prev_df_in["forecast_category"] == fc]["forecast_acv_amount"].sum()) if not prev_df_in.empty else 0.0
            
            return {"count": td_c - pr_c, "acv": round(td_a - pr_a, 2)}

        for bu in all_bus:
            t = today_totals[bu]
            yt = y_totals.get(bu, {})
            lwt = lw_totals.get(bu, {})
            
            cells = {fc: {"count": 0, "acv": 0.0} for fc in ALL_FC}
            for fc, c_data in t["cells"].items():
                if fc in cells:
                    cells[fc] = c_data
            
            # calculate deltas per cell
            for fc in ALL_FC:
                y_cell = yt.get("cells", {}).get(fc, {})
                lw_cell = lwt.get("cells", {}).get(fc, {})
                cells[fc]["delta_yesterday"] = _calc_delta(cells[fc], y_cell)
                cells[fc]["delta_lastweek"] = _calc_delta(cells[fc], lw_cell)

            commit_acv = cells["Commit"]["acv"]
            commit_pct = round((commit_acv / t["acv"] * 100), 1) if t["acv"] > 0 else 0.0
            
            rows.append({
                "bu": bu,
                "count": t["count"],
                "acv": round(t["acv"], 2),
                "pct_acv": round((t["acv"] / grand_acv * 100), 1) if grand_acv > 0 else 0.0,
                "commit_pct": commit_pct,
                "cells": cells,
                "delta_yesterday": _calc_delta(t, yt),
                "delta_lastweek": _calc_delta(t, lwt),
                "yesterday_date": y_snap.snapshot_date.isoformat() if y_snap else None,
                "lastweek_date": lw_snap.snapshot_date.isoformat() if lw_snap else None,
            })

        # Calculate category and grand totals
        totals = {
            "categories": {},
            "grand": {
                "count": grand_count,
                "acv": round(grand_acv, 2),
                "delta_yesterday": _calc_delta({"count": grand_count, "acv": grand_acv}, {"count": len(y_df) if not y_df.empty else 0, "acv": float(y_df["forecast_acv_amount"].sum()) if not y_df.empty else 0.0}),
                "delta_lastweek": _calc_delta({"count": grand_count, "acv": grand_acv}, {"count": len(lw_df) if not lw_df.empty else 0, "acv": float(lw_df["forecast_acv_amount"].sum()) if not lw_df.empty else 0.0})
            }
        }
        
        for fc in ALL_FC:
            totals["categories"][fc] = {
                "count": fc_grand_totals[fc]["count"],
                "acv": round(fc_grand_totals[fc]["acv"], 2),
                "delta_yesterday": _get_grand_delta(fc, df, y_df),
                "delta_lastweek": _get_grand_delta(fc, df, lw_df),
            }

        target_fp = res.resolved_quarter
        summary_payload = {
            "snapshot_date": snap.snapshot_date.isoformat(),
            "requested_as_of": fs.as_of or snap.snapshot_date.isoformat(),
            "compare_date": None,
            "yesterday_date": y_snap.snapshot_date.isoformat() if y_snap else None,
            "lastweek_date": lw_snap.snapshot_date.isoformat() if lw_snap else None,
            "data_slice": res.data_slice,
            "data_slice_key": target_fp,
            "filters_applied": res.filters_applied,
            "total": {
                "count": grand_count,
                "acv": round(grand_acv, 2)
            },
            "categories": ALL_FC,
            "rows": rows,
            "totals": totals
        }
        summary_payload["source_check"] = self.recompute_and_reconcile(
            ctx, filter_spec=fs, summary_to_check=summary_payload
        )
        return summary_payload

    def recompute_and_reconcile(
        self,
        ctx: UserContext,
        filter_spec: Optional[ScopeService.FilterSpec] = None,
        summary_to_check: Optional[dict] = None,
    ) -> dict:
        """
        Runtime independent recompute of BU x forecast-category counts and ACV
        directly from the raw snapshot rows (pandas groupby on stored rows, with the same scope),
        and compares them to what the service returns.
        Works for whatever snapshot is active, with no fixed numbers.
        """
        fs = self._build_filter_spec(filter_spec=filter_spec)
        snap = self._active_snap(fs.as_of)
        if not snap:
            return {
                "status": "error",
                "badge": "none",
                "message": "no_snapshot",
                "diffs": [],
                "total_checked": 0,
            }

        summary = summary_to_check or self.get_summary(ctx, filter_spec=fs)
        if "error" in summary:
            return {
                "status": "error",
                "badge": "none",
                "message": summary["error"],
                "diffs": [],
                "total_checked": 0,
            }

        # Query raw snapshot rows using the exact same scope
        opps, _ = self._scoped_opps(snap, filter_spec=fs, target_date=snap.snapshot_date)
        df = _opps_to_df(opps)

        diffs = []
        if df.empty:
            if summary["total"]["count"] != 0 or summary["total"]["acv"] != 0:
                diffs.append({
                    "cell": "Grand Total",
                    "expected": {"count": 0, "acv": 0.0},
                    "actual": summary["total"]
                })
        else:
            g = df.groupby(["business_unit", "forecast_category"])["forecast_acv_amount"].agg(["count", "sum"])
            bu_totals = df.groupby("business_unit")["forecast_acv_amount"].agg(["count", "sum"])
            fc_totals = df.groupby("forecast_category")["forecast_acv_amount"].agg(["count", "sum"])
            exp_grand_count = int(len(df))
            exp_grand_acv = float(round(df["forecast_acv_amount"].sum(), 2))

            # 1. Grand Total
            if summary["total"]["count"] != exp_grand_count:
                diffs.append({
                    "cell": "Grand Total Count",
                    "expected": exp_grand_count,
                    "actual": summary["total"]["count"]
                })
            if abs(summary["total"]["acv"] - exp_grand_acv) > 0.01:
                diffs.append({
                    "cell": "Grand Total ACV",
                    "expected": exp_grand_acv,
                    "actual": summary["total"]["acv"]
                })

            # 2. Rows and Cells
            rows_dict = {r["bu"]: r for r in summary.get("rows", [])}
            all_expected_bus = list(bu_totals.index)
            for bu in all_expected_bus:
                exp_c = int(bu_totals.loc[bu, "count"])
                exp_a = float(round(bu_totals.loc[bu, "sum"], 2))
                act_row = rows_dict.get(bu)
                if not act_row:
                    diffs.append({
                        "cell": f"{bu} Row",
                        "expected": {"count": exp_c, "acv": exp_a},
                        "actual": "missing"
                    })
                    continue
                if act_row["count"] != exp_c:
                    diffs.append({
                        "cell": f"{bu} Row Count",
                        "expected": exp_c,
                        "actual": act_row["count"]
                    })
                if abs(act_row["acv"] - exp_a) > 0.01:
                    diffs.append({
                        "cell": f"{bu} Row ACV",
                        "expected": exp_a,
                        "actual": act_row["acv"]
                    })

                # Check each category cell
                for fc in ALL_FC:
                    exp_cell_c = int(g.loc[(bu, fc), "count"]) if (bu, fc) in g.index else 0
                    exp_cell_a = float(round(g.loc[(bu, fc), "sum"], 2)) if (bu, fc) in g.index else 0.0
                    act_cell = act_row.get("cells", {}).get(fc, {"count": 0, "acv": 0.0})
                    if act_cell["count"] != exp_cell_c:
                        diffs.append({
                            "cell": f"{bu} x {fc} Count",
                            "expected": exp_cell_c,
                            "actual": act_cell["count"]
                        })
                    if abs(act_cell["acv"] - exp_cell_a) > 0.01:
                        diffs.append({
                            "cell": f"{bu} x {fc} ACV",
                            "expected": exp_cell_a,
                            "actual": act_cell["acv"]
                        })

            # 3. Column totals
            for fc in ALL_FC:
                exp_fc_c = int(fc_totals.loc[fc, "count"]) if fc in fc_totals.index else 0
                exp_fc_a = float(round(fc_totals.loc[fc, "sum"], 2)) if fc in fc_totals.index else 0.0
                act_cat = summary.get("totals", {}).get("categories", {}).get(fc, {"count": 0, "acv": 0.0})
                if act_cat["count"] != exp_fc_c:
                    diffs.append({
                        "cell": f"Column Total {fc} Count",
                        "expected": exp_fc_c,
                        "actual": act_cat["count"]
                    })
                if abs(act_cat["acv"] - exp_fc_a) > 0.01:
                    diffs.append({
                        "cell": f"Column Total {fc} ACV",
                        "expected": exp_fc_a,
                        "actual": act_cat["acv"]
                    })

        total_checked = len(summary.get("rows", [])) * 6 + 6 + 1
        is_reconciled = len(diffs) == 0
        return {
            "status": "reconciles" if is_reconciled else "mismatch",
            "badge": "green" if is_reconciled else "red",
            "message": "reconciles" if is_reconciled else f"{len(diffs)} cell(s) differ",
            "diffs": diffs,
            "total_cells_checked": total_checked,
            "slice": summary.get("data_slice"),
            "snapshot_date": snap.snapshot_date.isoformat(),
        }

    def get_deals(
        self,
        ctx: UserContext,
        bu: str = None,
        category: str = None,
        status: str = None,
        as_of: str = None,
        period: str = None,
        exclude_deleted_lost: bool = False,
        include_deleted_lost: Optional[bool] = None,
        filter_spec: Optional[ScopeService.FilterSpec] = None,
    ) -> dict:
        fs = self._build_filter_spec(
            filter_spec=filter_spec,
            as_of=as_of,
            period=period,
            bu=bu,
            category=category,
            status=status,
            exclude_deleted_lost=exclude_deleted_lost,
            include_deleted_lost=include_deleted_lost,
        )

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
        
        if df.empty:
            return {"count": 0, "acv": 0.0, "filters_applied": res.filters_applied, "deals": []}

        df = df.sort_values("forecast_acv_amount", ascending=False)
        deals = df.to_dict(orient="records")
        for d in deals:
            if d["close_date"]: d["close_date"] = d["close_date"].isoformat()
            
        return {
            "count": len(deals),
            "acv": round(float(df["forecast_acv_amount"].sum()) if not df.empty else 0.0, 2),
            "filters_applied": res.filters_applied,
            "deals": deals
        }
        
    def get_top_opportunities(
        self,
        ctx: UserContext,
        bu: str = None,
        limit: int = 10,
        as_of: str = None,
        filter_spec: Optional[ScopeService.FilterSpec] = None,
    ) -> dict:
        from backend.services.scopes import FilterSpec
        fs = filter_spec.model_copy() if filter_spec else FilterSpec()
        fs.include_deleted_lost = False
        if as_of:
            fs.as_of = as_of
        if bu and bu != "All":
            fs.business_units = [bu]

        snap = self._active_snap(fs.as_of)
        if not snap:
            return {"error": "no_snapshot"}
            
        opps, _ = self._scoped_opps(snap, filter_spec=fs)
        df = _opps_to_df(opps)
        
        if df.empty:
            return {"deals": []}
            
        df = df.sort_values("forecast_acv_amount", ascending=False).head(limit)
        deals = df.to_dict(orient="records")
        for d in deals:
            if d["close_date"]: d["close_date"] = d["close_date"].isoformat()
            
        return {"deals": deals}

