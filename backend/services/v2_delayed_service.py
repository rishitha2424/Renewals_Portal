from __future__ import annotations
import logging
import re
import pandas as pd
from datetime import date, timedelta
from typing import Optional, Any
from sqlalchemy.orm import Session

from backend.models.opportunity import Opportunity
from backend.models.snapshot import UploadSnapshot
from backend.services.context import UserContext
from backend.services.scopes import ScopeService

log = logging.getLogger(__name__)

def _parse_fp(fp: str) -> tuple[int, int]:
    """Qx-YYYY -> (YYYY, x)"""
    try:
        q, y = fp.split("-")
        return int(y), int(q[1])
    except:
        return (0, 0)

def _norm_fc(s: str | None) -> str:
    if not s or str(s).strip() in ("", "nan", "None"): return "Blank"
    s = str(s).strip()
    if s not in ["Closed", "Commit", "Best Case", "Pipeline"]: return "Blank"
    return s

def _norm_approval(s: str | None) -> str:
    if not s or str(s).strip() in ("", "nan", "None", "Blank"): return "Blank"
    s = str(s).strip()
    if s in ("Approved", "Approved - 2nd"): return "Approved"
    if s in ("Pending Approval", "Pending-Approval"): return "Pending Approval"
    return s

def _map_region(s: str | None) -> str:
    if not s or str(s).strip() in ("", "nan", "None"): return "Other / Unmapped"
    s = str(s).strip()
    if s == "Europe": return "Europe"
    if s == "APAC": return "APAC"
    if s == "AFRICA": return "Africa"
    if s == "MENA": return "Middle East and North Africa"
    if s == "NAMR": return "North America"
    if s == "South America": return "LATAM"
    if s in ("North America", "LATAM", "Middle East and North Africa", "APAC", "Europe", "Africa"):
        return s
    return s

def _safe_acv(df_in: pd.DataFrame | None) -> float:
    if df_in is None or df_in.empty or "forecast_acv_amount" not in df_in.columns:
        return 0.0
    return round(float(df_in["forecast_acv_amount"].sum()), 2)

def _opps_to_df(opps: list[Opportunity]) -> pd.DataFrame:
    if not opps:
        return pd.DataFrame()
    records = []
    for o in opps:
        records.append({
            "id": o.opportunity_id_18,
            "opportunity_id_18": o.opportunity_id_18,
            "opportunity_name": o.opportunity_name,
            "account_name": o.account_name,
            "forecast_acv_amount": float(o.forecast_acv_amount or 0.0),
            "forecast_category": _norm_fc(o.forecast_category),
            "business_unit": (o.business_unit_primary or "").strip() or "Unassigned",
            "business_unit_primary": (o.business_unit_primary or "").strip() or "Unassigned",
            "is_deleted_or_lost": bool(o.is_deleted_or_lost),
            "fiscal_period": o.fiscal_period or "",
            "close_date": pd.to_datetime(o.close_date) if o.close_date else pd.NaT,
            "approval_status": _norm_approval(o.approval_status),
            "region": _map_region(o.revised_sub_region),
            "sub_region": _map_region(o.revised_sub_region),
            "sales_type": o.sales_type or "",
            "owner": (o.opportunity_owner or "").strip(),
            "opportunity_owner": (o.opportunity_owner or "").strip()
        })
    df = pd.DataFrame(records)
    df = df.drop_duplicates(subset=["opportunity_id_18"], keep="last")
    return df

class V2DelayedService:
    def __init__(self, db: Session):
        self.db = db

    def _active_snap(self, as_of: str | None = None) -> UploadSnapshot | None:
        q = self.db.query(UploadSnapshot)
        if as_of:
            by_id = q.filter(UploadSnapshot.id == as_of).first()
            if by_id:
                return by_id
            try:
                d = date.fromisoformat(as_of)
                exact = q.filter(UploadSnapshot.snapshot_date == d).first()
                if exact:
                    return exact
                snap = q.filter(UploadSnapshot.snapshot_date <= d).order_by(UploadSnapshot.snapshot_date.desc()).first()
                if snap:
                    return snap
            except ValueError:
                pass
            return None
        return q.filter(UploadSnapshot.is_active_today == True).order_by(UploadSnapshot.snapshot_date.desc()).first()

    def _snap_by_date(self, d: date) -> UploadSnapshot | None:
        return self.db.query(UploadSnapshot).filter(UploadSnapshot.snapshot_date == d).first()

    def _get_comparison_snapshots(self, t_snap: UploadSnapshot) -> tuple[UploadSnapshot | None, UploadSnapshot | None]:
        y_snap = self.get_yesterday_baseline(t_snap)
        w_snap = self.get_lastweek_baseline(t_snap)
        return y_snap, w_snap

    def get_yesterday_baseline(self, snap: UploadSnapshot) -> UploadSnapshot | None:
        if getattr(snap, "yesterday_date", None):
            y = self._snap_by_date(snap.yesterday_date)
            if y and y.snapshot_date < snap.snapshot_date:
                return y
        return (
            self.db.query(UploadSnapshot)
            .filter(UploadSnapshot.snapshot_date < snap.snapshot_date)
            .order_by(UploadSnapshot.snapshot_date.desc())
            .first()
        )

    def get_lastweek_baseline(self, snap: UploadSnapshot) -> UploadSnapshot | None:
        target_w = snap.snapshot_date - timedelta(days=7)
        w_exact = self._snap_by_date(target_w)
        if w_exact and w_exact.snapshot_date < snap.snapshot_date:
            return w_exact
        return (
            self.db.query(UploadSnapshot)
            .filter(
                UploadSnapshot.snapshot_date <= target_w,
                UploadSnapshot.snapshot_date < snap.snapshot_date,
            )
            .order_by(UploadSnapshot.snapshot_date.desc())
            .first()
        )

    def get_period_start_baseline(self, snap: UploadSnapshot, start_date: date) -> tuple[UploadSnapshot | None, bool, str]:
        """
        Baseline for start of period:
        - latest snapshot on or before start_date, strictly before snap
        - if none exists, earliest snapshot inside period before snap (marked partial, 'tracked since <that date>')
        - if none exists, (None, False, 'n/a')
        """
        b = (
            self.db.query(UploadSnapshot)
            .filter(
                UploadSnapshot.snapshot_date <= start_date,
                UploadSnapshot.snapshot_date < snap.snapshot_date,
            )
            .order_by(UploadSnapshot.snapshot_date.desc())
            .first()
        )
        if b:
            return b, False, f"Since {b.snapshot_date.strftime('%d %b %Y')}"
            
        b_partial = (
            self.db.query(UploadSnapshot)
            .filter(
                UploadSnapshot.snapshot_date > start_date,
                UploadSnapshot.snapshot_date < snap.snapshot_date,
            )
            .order_by(UploadSnapshot.snapshot_date.asc())
            .first()
        )
        if b_partial:
            return b_partial, True, f"tracked since {b_partial.snapshot_date.strftime('%d %b %Y')}"
            
        return None, False, "n/a"

    def _get_opps(self, snap: UploadSnapshot) -> list[Opportunity]:
        return self.db.query(Opportunity).filter(Opportunity.snapshot_id == snap.id).all()
    
    def _filter_df(self, df: pd.DataFrame, filter_spec: Optional[ScopeService.FilterSpec] = None) -> pd.DataFrame:
        if df.empty:
            return df
        res_df = df
        from backend.services.scopes import FilterSpec
        fs = filter_spec or FilterSpec()
        
        # sales_types
        if fs.sales_types:
            res_df = res_df[res_df["sales_type"].isin(fs.sales_types)]
        # include_deleted_lost
        if not fs.include_deleted_lost:
            res_df = res_df[~res_df["is_deleted_or_lost"]]
        # regions
        if fs.regions:
            res_df = res_df[res_df["region"].isin(fs.regions) | res_df["sub_region"].isin(fs.regions)]
        # business_units
        if fs.business_units:
            res_df = res_df[res_df["business_unit"].isin(fs.business_units) | res_df["business_unit_primary"].isin(fs.business_units)]
        # forecast_categories
        if fs.forecast_categories:
            norm_cats = ["Blank" if c in ("Not yet proposed", "Blank", "") else c for c in fs.forecast_categories]
            res_df = res_df[res_df["forecast_category"].isin(norm_cats)]
        # approval_statuses
        if fs.approval_statuses:
            norm_apps = ["Blank" if a in ("Not submitted", "Blank", "") else a for a in fs.approval_statuses]
            res_df = res_df[res_df["approval_status"].isin(norm_apps)]
            
        return res_df

    def _slice_renewals(self, df: pd.DataFrame, filter_spec: Optional[ScopeService.FilterSpec] = None) -> pd.DataFrame:
        return self._filter_df(df, filter_spec)

    def _parse_period_info(self, target_p_str: str, snap_d: date) -> tuple[bool, Optional[int], tuple[int, int], date, date, str, str]:
        """
        Parses target period into:
        (is_year, target_year, target_parsed, start_date, end_date, ptype, label)
        ptype is one of: 'current_quarter', 'past_quarter', 'future_quarter', 'current_year', 'past_year', 'future_year'
        """
        snap_cq = ScopeService.quarter_of(snap_d)
        cq_parsed = ScopeService.parse_quarter(snap_cq)
        p_clean = str(target_p_str).strip()
        m_year = re.match(r"^(?:FY)?(\d{4})$", p_clean, re.IGNORECASE)
        if m_year:
            target_year = int(m_year.group(1))
            q1_str = f"Q1-{target_year}"
            q4_str = f"Q4-{target_year}"
            s_date, _ = ScopeService.quarter_bounds(q1_str)
            _, e_date = ScopeService.quarter_bounds(q4_str)
            label = f"FY{str(target_year)[-2:]}"
            if target_year == snap_d.year:
                ptype = "current_year"
            elif target_year < snap_d.year:
                ptype = "past_year"
            else:
                ptype = "future_year"
            return True, target_year, (target_year, 0), s_date, e_date, ptype, label
        else:
            tp = _parse_fp(p_clean)
            s_date, e_date = ScopeService.quarter_bounds(p_clean)
            label = ScopeService.quarter_label(p_clean)
            if tp == cq_parsed:
                ptype = "current_quarter"
            elif tp < cq_parsed:
                ptype = "past_quarter"
            else:
                ptype = "future_quarter"
            return False, None, tp, s_date, e_date, ptype, label

    def _compute_snapshot_buckets(
        self,
        snap: UploadSnapshot,
        target_q_str: str,
        filter_spec: Optional[ScopeService.FilterSpec] = None,
        base_snap: Optional[UploadSnapshot] = None,
        no_baseline: bool = False
    ) -> dict:
        t_df = _opps_to_df(self._get_opps(snap))
        t_ren = self._slice_renewals(t_df, filter_spec)
        t_snap_date = pd.Timestamp(snap.snapshot_date)
        
        is_year, target_year, target_parsed, s_date, e_date, ptype, p_label = self._parse_period_info(target_q_str, snap.snapshot_date)
        is_future = ptype in ("future_quarter", "future_year")

        from backend.config import settings
        include_prior_fy = getattr(settings, "DELAYED_INCLUDE_PRIOR_FY", True)

        overdue_df = pd.DataFrame()
        prior_slipped = pd.DataFrame()

        # 1. Overdue computation
        if is_future:
            overdue_df = pd.DataFrame()
        elif ptype == "past_quarter":
            # Rule 2: Past quarter selected: fiscal_period == that quarter, still open, close date before snapshot date
            t_q = t_ren[t_ren["fiscal_period"] == target_q_str] if not t_ren.empty else pd.DataFrame()
            if not t_q.empty:
                is_overdue = pd.notna(t_q["close_date"]) & (t_q["close_date"] < t_snap_date) & (t_q["forecast_category"] != "Closed") & (~t_q["is_deleted_or_lost"])
                overdue_df = t_q[is_overdue].copy()
                if not overdue_df.empty:
                    overdue_df["reason"] = "Overdue"
                    overdue_df["push_out_days"] = 0
                    overdue_df["days_overdue"] = overdue_df["close_date"].apply(
                        lambda d: max(0, (t_snap_date.date() - d.date()).days) if pd.notna(d) else 0
                    )
        elif ptype == "current_quarter":
            # Rule 1: Current quarter selected
            t_q = t_ren[t_ren["fiscal_period"] == target_q_str] if not t_ren.empty else pd.DataFrame()
            if not t_q.empty:
                is_overdue = pd.notna(t_q["close_date"]) & (t_q["close_date"] < t_snap_date) & (t_q["forecast_category"] != "Closed") & (~t_q["is_deleted_or_lost"])
                overdue_df = t_q[is_overdue].copy()
                if not overdue_df.empty:
                    overdue_df["reason"] = "Overdue"
                    overdue_df["push_out_days"] = 0
                    overdue_df["days_overdue"] = overdue_df["close_date"].apply(
                        lambda d: max(0, (t_snap_date.date() - d.date()).days) if pd.notna(d) else 0
                    )

            # Earlier open renewals:
            if not t_ren.empty:
                if include_prior_fy:
                    prior_open = t_ren[
                        t_ren["fiscal_period"].apply(lambda fp: (_parse_fp(fp) < target_parsed and _parse_fp(fp) > (0, 0)) if fp and "-" in fp else False)
                        & (t_ren["forecast_category"] != "Closed")
                        & (~t_ren["is_deleted_or_lost"])
                    ].copy()
                else:
                    prior_open = t_ren[
                        t_ren["fiscal_period"].apply(lambda fp: (_parse_fp(fp)[0] == target_parsed[0] and _parse_fp(fp)[1] < target_parsed[1]) if fp and "-" in fp else False)
                        & (t_ren["forecast_category"] != "Closed")
                        & (~t_ren["is_deleted_or_lost"])
                    ].copy()

                if not prior_open.empty:
                    in_cq = prior_open["close_date"].apply(
                        lambda d: (s_date <= d.date() <= e_date) if pd.notna(d) else False
                    )
                    prior_slipped = prior_open[in_cq].copy()
                    prior_od = prior_open[~in_cq].copy()

                    if not prior_od.empty:
                        prior_od["reason"] = "Overdue"
                        prior_od["push_out_days"] = 0
                        prior_od["days_overdue"] = prior_od["close_date"].apply(
                            lambda d: max(0, (t_snap_date.date() - d.date()).days) if pd.notna(d) else 0
                        )
                        overdue_df = pd.concat([overdue_df, prior_od], ignore_index=True).drop_duplicates(subset=["opportunity_id_18"], keep="first")

                    if not prior_slipped.empty:
                        prior_slipped["reason"] = "Slipped quarter"
                        prior_slipped["days_overdue"] = 0
                        prior_slipped["push_out_days"] = prior_slipped.apply(
                            lambda r: (r["close_date"].date() - ScopeService.quarter_bounds(r["fiscal_period"])[1]).days
                            if pd.notna(r.get("close_date")) and r.get("fiscal_period") else 0,
                            axis=1
                        )
        elif ptype in ("current_year", "past_year"):
            # Rule 4: Year selected
            t_yr = t_ren[t_ren["fiscal_period"].apply(lambda fp: _parse_fp(fp)[0] == target_year if fp and "-" in fp else False)] if not t_ren.empty else pd.DataFrame()
            if not t_yr.empty:
                is_overdue = pd.notna(t_yr["close_date"]) & (t_yr["close_date"] < t_snap_date) & (t_yr["forecast_category"] != "Closed") & (~t_yr["is_deleted_or_lost"])
                overdue_df = t_yr[is_overdue].copy()
                if not overdue_df.empty:
                    overdue_df["reason"] = "Overdue"
                    overdue_df["push_out_days"] = 0
                    overdue_df["days_overdue"] = overdue_df["close_date"].apply(
                        lambda d: max(0, (t_snap_date.date() - d.date()).days) if pd.notna(d) else 0
                    )

            if include_prior_fy and ptype == "current_year" and not t_ren.empty:
                prior_open = t_ren[
                    t_ren["fiscal_period"].apply(lambda fp: (_parse_fp(fp)[0] < target_year and _parse_fp(fp) > (0, 0)) if fp and "-" in fp else False)
                    & (t_ren["forecast_category"] != "Closed")
                    & (~t_ren["is_deleted_or_lost"])
                ].copy()
                if not prior_open.empty:
                    in_yr = prior_open["close_date"].apply(lambda d: (s_date <= d.date() <= e_date) if pd.notna(d) else False)
                    prior_slipped = prior_open[in_yr].copy()
                    prior_od = prior_open[~in_yr].copy()

                    if not prior_od.empty:
                        prior_od["reason"] = "Overdue"
                        prior_od["push_out_days"] = 0
                        prior_od["days_overdue"] = prior_od["close_date"].apply(
                            lambda d: max(0, (t_snap_date.date() - d.date()).days) if pd.notna(d) else 0
                        )
                        overdue_df = pd.concat([overdue_df, prior_od], ignore_index=True).drop_duplicates(subset=["opportunity_id_18"], keep="first")

                    if not prior_slipped.empty:
                        prior_slipped["reason"] = "Slipped year"
                        prior_slipped["days_overdue"] = 0
                        prior_slipped["push_out_days"] = 0

        # 2. Event buckets: Slipped, Later close, Lost
        slipped_df = pd.DataFrame()
        slipped_next_year_df = pd.DataFrame()
        slipped_next_quarter_df = pd.DataFrame()
        slipped_later_quarter_df = pd.DataFrame()
        later_df = pd.DataFrame()
        lost_df = pd.DataFrame()

        if is_future or no_baseline or (base_snap is None):
            pass
        elif base_snap and not t_ren.empty:
            base_ren = self._slice_renewals(_opps_to_df(self._get_opps(base_snap)), filter_spec)
            if not base_ren.empty:
                if is_year:
                    base_deals = base_ren[base_ren["fiscal_period"].apply(lambda fp: _parse_fp(fp)[0] == target_year if fp and "-" in fp else False) & (~base_ren["is_deleted_or_lost"])]
                else:
                    base_deals = base_ren[(base_ren["fiscal_period"] == target_q_str) & (~base_ren["is_deleted_or_lost"])]

                if not base_deals.empty:
                    base_idx = base_deals.set_index("opportunity_id_18")
                    t_idx = t_ren.set_index("opportunity_id_18")

                    slipped_next_year_rows = []
                    slipped_next_quarter_rows = []
                    slipped_later_quarter_rows = []
                    later_rows = []
                    lost_rows = []

                    for opp_id, b_row in base_idx.iterrows():
                        if opp_id not in t_idx.index or t_idx.loc[opp_id]["is_deleted_or_lost"]:
                            r = b_row.copy()
                            r["opportunity_id_18"] = opp_id
                            r["reason"] = "Lost/removed"
                            r["push_out_days"] = 0
                            r["days_overdue"] = 0
                            lost_rows.append(r)
                            continue

                        t_row = t_idx.loc[opp_id]
                        t_fp = t_row["fiscal_period"]
                        if not t_fp or "-" not in t_fp: continue
                        t_p = _parse_fp(t_fp)

                        if is_year:
                            is_slipped = (t_p[0] > target_year)
                            is_later = (t_p[0] == target_year) and pd.notna(t_row["close_date"]) and pd.notna(b_row["close_date"]) and (t_row["close_date"] > b_row["close_date"])
                        else:
                            is_slipped = (t_p[0] > target_parsed[0]) or (t_p[0] == target_parsed[0] and t_p[1] > target_parsed[1])
                            is_later = (t_p == target_parsed) and pd.notna(t_row["close_date"]) and pd.notna(b_row["close_date"]) and (t_row["close_date"] > b_row["close_date"])

                        if is_slipped:
                            r = t_row.copy()
                            r["opportunity_id_18"] = opp_id
                            r["push_out_days"] = (t_row["close_date"] - b_row["close_date"]).days if pd.notna(t_row["close_date"]) and pd.notna(b_row["close_date"]) else 0
                            r["days_overdue"] = 0
                            if is_year:
                                r["reason"] = "Slipped to next fiscal year"
                                r["slippage_type"] = "slipped_next_year"
                                slipped_next_year_rows.append(r)
                            else:
                                if t_p[0] > target_parsed[0]:
                                    r["reason"] = "Slipped to next fiscal year"
                                    r["slippage_type"] = "slipped_next_year"
                                    slipped_next_year_rows.append(r)
                                elif t_p[0] == target_parsed[0] and t_p[1] == target_parsed[1] + 1:
                                    r["reason"] = "Slipped to next quarter"
                                    r["slippage_type"] = "slipped_next_quarter"
                                    slipped_next_quarter_rows.append(r)
                                else:
                                    r["reason"] = "Slipped to a later quarter, same year"
                                    r["slippage_type"] = "slipped_later_quarter"
                                    slipped_later_quarter_rows.append(r)
                        elif is_later:
                            r = t_row.copy()
                            r["opportunity_id_18"] = opp_id
                            r["reason"] = "Later close date"
                            r["push_out_days"] = (t_row["close_date"] - b_row["close_date"]).days
                            c_date = r.get("close_date")
                            r["days_overdue"] = max(0, (t_snap_date.date() - c_date.date()).days) if pd.notna(c_date) and c_date < t_snap_date else 0
                            later_rows.append(r)

                    slipped_next_year_df = pd.DataFrame(slipped_next_year_rows)
                    slipped_next_quarter_df = pd.DataFrame(slipped_next_quarter_rows)
                    slipped_later_quarter_df = pd.DataFrame(slipped_later_quarter_rows)
                    later_df = pd.DataFrame(later_rows)
                    lost_df = pd.DataFrame(lost_rows)
        else:
            slipped_next_year_df = pd.DataFrame()
            slipped_next_quarter_df = pd.DataFrame()
            slipped_later_quarter_df = pd.DataFrame()

        if not prior_slipped.empty:
            for _, r in prior_slipped.iterrows():
                fp = r.get("fiscal_period")
                tp = _parse_fp(fp) if fp else (0, 0)
                r_dict = dict(r)
                if tp[0] > target_parsed[0]:
                    slipped_next_year_df = pd.concat([slipped_next_year_df, pd.DataFrame([r_dict])], ignore_index=True)
                elif tp[0] == target_parsed[0] and tp[1] == target_parsed[1] + 1:
                    slipped_next_quarter_df = pd.concat([slipped_next_quarter_df, pd.DataFrame([r_dict])], ignore_index=True)
                else:
                    slipped_later_quarter_df = pd.concat([slipped_later_quarter_df, pd.DataFrame([r_dict])], ignore_index=True)

        # De-duplicate each slippage bucket
        slipped_next_year_df = slipped_next_year_df.drop_duplicates(subset=["opportunity_id_18"], keep="first") if not slipped_next_year_df.empty else pd.DataFrame()
        slipped_next_quarter_df = slipped_next_quarter_df.drop_duplicates(subset=["opportunity_id_18"], keep="first") if not slipped_next_quarter_df.empty else pd.DataFrame()
        slipped_later_quarter_df = slipped_later_quarter_df.drop_duplicates(subset=["opportunity_id_18"], keep="first") if not slipped_later_quarter_df.empty else pd.DataFrame()

        # Combine slippage
        slip_parts = [p for p in (slipped_next_year_df, slipped_next_quarter_df, slipped_later_quarter_df) if not p.empty]
        slipped_df = pd.concat(slip_parts, ignore_index=True).drop_duplicates(subset=["opportunity_id_18"], keep="first") if slip_parts else pd.DataFrame()

        # Priority de-duplication: overdue > slipped > later_close
        od_ids = set(overdue_df["opportunity_id_18"]) if not overdue_df.empty else set()
        if not slipped_df.empty and od_ids:
            slipped_df = slipped_df[~slipped_df["opportunity_id_18"].isin(od_ids)]
            if not slipped_next_year_df.empty: slipped_next_year_df = slipped_next_year_df[~slipped_next_year_df["opportunity_id_18"].isin(od_ids)]
            if not slipped_next_quarter_df.empty: slipped_next_quarter_df = slipped_next_quarter_df[~slipped_next_quarter_df["opportunity_id_18"].isin(od_ids)]
            if not slipped_later_quarter_df.empty: slipped_later_quarter_df = slipped_later_quarter_df[~slipped_later_quarter_df["opportunity_id_18"].isin(od_ids)]

        slip_ids = set(slipped_df["opportunity_id_18"]) if not slipped_df.empty else set()
        if not later_df.empty and (od_ids or slip_ids):
            later_df = later_df[~later_df["opportunity_id_18"].isin(od_ids.union(slip_ids))]

        # DELAYED RENEWALS = Overdue + Later Close Date (Postponed)
        delayed_parts = [p for p in (overdue_df, later_df) if not p.empty]
        delayed_total_df = pd.concat(delayed_parts, ignore_index=True).drop_duplicates(subset=["opportunity_id_18"], keep="first") if delayed_parts else pd.DataFrame()

        # Slippage total = slipped_df (all 3 destinations)
        slippage_total_df = slipped_df

        return {
            "total": delayed_total_df,
            "delayed_total": delayed_total_df,
            "overdue": overdue_df,
            "later_close": later_df,
            "slippage_total": slippage_total_df,
            "slipped": slippage_total_df,
            "slipped_next_year": slipped_next_year_df,
            "slipped_next_quarter": slipped_next_quarter_df,
            "slipped_later_quarter": slipped_later_quarter_df,
            "lost": lost_df,
            "t_ren": t_ren,
            "ptype": ptype,
            "is_future": is_future,
            "has_baseline": (base_snap is not None and not no_baseline),
        }

    def _compute_delayed_and_overdue(self, data: dict, filter_spec: Optional[ScopeService.FilterSpec] = None, target_q_str: Optional[str] = None):
        t_snap = data["t_snap"]
        y_snap = data.get("y_snap")
        w_snap = data.get("w_snap")
        if not target_q_str:
            if filter_spec and filter_spec.period and filter_spec.period.startswith("Q") and "-" in filter_spec.period:
                target_q_str = filter_spec.period
            else:
                target_q_str = ScopeService.current_quarter(t_snap.snapshot_date)
        t_buckets = self._compute_snapshot_buckets(t_snap, target_q_str, filter_spec=filter_spec, base_snap=y_snap)
        overdue_df = t_buckets["overdue"]
        delayed_y = t_buckets["total"]
        delayed_w = self._compute_snapshot_buckets(t_snap, target_q_str, filter_spec=filter_spec, base_snap=w_snap)["total"] if w_snap else delayed_y
        return overdue_df, delayed_y, delayed_w

    def _compute_snapshot_trend(self, current_snap: UploadSnapshot, target_q_str: str, filter_spec: Optional[ScopeService.FilterSpec] = None) -> list[dict]:
        snaps = self.db.query(UploadSnapshot).filter(
            UploadSnapshot.snapshot_date <= current_snap.snapshot_date
        ).order_by(UploadSnapshot.snapshot_date.asc()).all()
        if not snaps:
            return []
        snaps = snaps[-6:]

        trend = []
        for i, s in enumerate(snaps):
            prev_s = snaps[i - 1] if i > 0 else None
            buckets = self._compute_snapshot_buckets(s, target_q_str, filter_spec=filter_spec, base_snap=prev_s)
            d_total = buckets["total"]
            trend.append({
                "snapshot_date": s.snapshot_date.isoformat(),
                "count": len(d_total),
                "acv": _safe_acv(d_total),
            })
        return trend

    def get_summary(self, as_of: str | None = None, compare: str | None = None, filter_spec: Optional[ScopeService.FilterSpec] = None) -> dict:
        eff_as_of = as_of or (filter_spec.as_of if filter_spec else None)
        eff_compare = compare or (filter_spec.compare if filter_spec else "yesterday")
        t_snap = self._active_snap(eff_as_of)
        if not t_snap: return {"error": "No data"}
        
        from backend.services.scopes import FilterSpec
        fs = filter_spec.model_copy() if filter_spec else FilterSpec()
        res = ScopeService.resolve(fs, snapshot=t_snap, as_of_date=t_snap.snapshot_date)
        
        target_p_str = fs.period if fs.period and (fs.period.startswith("Q") or fs.period.startswith("FY") or len(fs.period) == 4) else res.period
        if not target_p_str or target_p_str in ("current_quarter", "all_periods", "all"):
            target_p_str = ScopeService.current_quarter(t_snap.snapshot_date)

        is_year, target_year, target_parsed, s_date, e_date, ptype, target_q_label = self._parse_period_info(target_p_str, t_snap.snapshot_date)
        is_future = ptype in ("future_quarter", "future_year")

        # 3 baselines
        b_period_start, is_partial, period_start_label = self.get_period_start_baseline(t_snap, s_date)
        y_snap = self.get_yesterday_baseline(t_snap)
        w_snap = self.get_lastweek_baseline(t_snap)
        p_snap = w_snap if eff_compare == "last_week" else y_snap

        # Buckets against period_start (MAIN FIGURE)
        main_buckets = self._compute_snapshot_buckets(t_snap, target_p_str, filter_spec=fs, base_snap=b_period_start, no_baseline=(b_period_start is None))

        # Event buckets against yesterday and last_week
        y_event_buckets = self._compute_snapshot_buckets(t_snap, target_p_str, filter_spec=fs, base_snap=y_snap, no_baseline=(y_snap is None)) if y_snap else None
        w_event_buckets = self._compute_snapshot_buckets(t_snap, target_p_str, filter_spec=fs, base_snap=w_snap, no_baseline=(w_snap is None)) if w_snap else None

        # Standing buckets of comparison snapshots (for signed net changes in Overdue & Total Delayed)
        y_standing = self._compute_snapshot_buckets(y_snap, target_p_str, filter_spec=fs, base_snap=None, no_baseline=True) if y_snap else None
        w_standing = self._compute_snapshot_buckets(w_snap, target_p_str, filter_spec=fs, base_snap=None, no_baseline=True) if w_snap else None

        delayed_active = main_buckets["total"]
        overdue_df = main_buckets["overdue"]
        t_ren = main_buckets["t_ren"]

        # Delta calculations
        # 1. Overdue: signed net change
        delta_y_od = None
        if y_standing is not None and not is_future:
            delta_y_od = {
                "count": len(main_buckets["overdue"]) - len(y_standing["overdue"]),
                "acv": round(_safe_acv(main_buckets["overdue"]) - _safe_acv(y_standing["overdue"]), 2),
            }
        delta_w_od = None
        if w_standing is not None and not is_future:
            delta_w_od = {
                "count": len(main_buckets["overdue"]) - len(w_standing["overdue"]),
                "acv": round(_safe_acv(main_buckets["overdue"]) - _safe_acv(w_standing["overdue"]), 2),
            }

        # 2. Slipped by destination: main figure is since period start, boxes are event buckets since yesterday & last week
        slip_has_base = (b_period_start is not None) and (not is_future)
        slip_ny_cnt = len(main_buckets["slipped_next_year"]) if slip_has_base else (0 if is_future else None)
        slip_ny_acv = _safe_acv(main_buckets["slipped_next_year"]) if slip_has_base else (0.0 if is_future else None)
        delta_y_slip_ny = None
        if y_event_buckets is not None and not is_future:
            delta_y_slip_ny = {
                "count": len(y_event_buckets["slipped_next_year"]),
                "acv": _safe_acv(y_event_buckets["slipped_next_year"]),
            }
        delta_w_slip_ny = None
        if w_event_buckets is not None and not is_future:
            delta_w_slip_ny = {
                "count": len(w_event_buckets["slipped_next_year"]),
                "acv": _safe_acv(w_event_buckets["slipped_next_year"]),
            }

        slip_nq_cnt = len(main_buckets["slipped_next_quarter"]) if slip_has_base else (0 if is_future else None)
        slip_nq_acv = _safe_acv(main_buckets["slipped_next_quarter"]) if slip_has_base else (0.0 if is_future else None)
        delta_y_slip_nq = None
        if y_event_buckets is not None and not is_future:
            delta_y_slip_nq = {
                "count": len(y_event_buckets["slipped_next_quarter"]),
                "acv": _safe_acv(y_event_buckets["slipped_next_quarter"]),
            }
        delta_w_slip_nq = None
        if w_event_buckets is not None and not is_future:
            delta_w_slip_nq = {
                "count": len(w_event_buckets["slipped_next_quarter"]),
                "acv": _safe_acv(w_event_buckets["slipped_next_quarter"]),
            }

        slip_lq_cnt = len(main_buckets["slipped_later_quarter"]) if slip_has_base else (0 if is_future else None)
        slip_lq_acv = _safe_acv(main_buckets["slipped_later_quarter"]) if slip_has_base else (0.0 if is_future else None)
        delta_y_slip_lq = None
        if y_event_buckets is not None and not is_future:
            delta_y_slip_lq = {
                "count": len(y_event_buckets["slipped_later_quarter"]),
                "acv": _safe_acv(y_event_buckets["slipped_later_quarter"]),
            }
        delta_w_slip_lq = None
        if w_event_buckets is not None and not is_future:
            delta_w_slip_lq = {
                "count": len(w_event_buckets["slipped_later_quarter"]),
                "acv": _safe_acv(w_event_buckets["slipped_later_quarter"]),
            }

        slip_tot_cnt = len(main_buckets["slippage_total"]) if slip_has_base else (0 if is_future else None)
        slip_tot_acv = _safe_acv(main_buckets["slippage_total"]) if slip_has_base else (0.0 if is_future else None)
        delta_y_slip_tot = None
        if y_event_buckets is not None and not is_future:
            delta_y_slip_tot = {
                "count": len(y_event_buckets["slippage_total"]),
                "acv": _safe_acv(y_event_buckets["slippage_total"]),
            }
        delta_w_slip_tot = None
        if w_event_buckets is not None and not is_future:
            delta_w_slip_tot = {
                "count": len(w_event_buckets["slippage_total"]),
                "acv": _safe_acv(w_event_buckets["slippage_total"]),
            }

        # 3. Later Close: main figure is since period start
        later_has_base = (b_period_start is not None) and (not is_future)
        later_cnt = len(main_buckets["later_close"]) if later_has_base else (0 if is_future else None)
        later_acv = _safe_acv(main_buckets["later_close"]) if later_has_base else (0.0 if is_future else None)
        delta_y_later = None
        if y_event_buckets is not None and not is_future:
            delta_y_later = {
                "count": len(y_event_buckets["later_close"]),
                "acv": _safe_acv(y_event_buckets["later_close"]),
            }
        delta_w_later = None
        if w_event_buckets is not None and not is_future:
            delta_w_later = {
                "count": len(w_event_buckets["later_close"]),
                "acv": _safe_acv(w_event_buckets["later_close"]),
            }

        # 4. Lost: main figure is since period start
        lost_has_base = (b_period_start is not None) and (not is_future)
        lost_cnt = len(main_buckets["lost"]) if lost_has_base else (0 if is_future else None)
        lost_acv = _safe_acv(main_buckets["lost"]) if lost_has_base else (0.0 if is_future else None)
        delta_y_lost = None
        if y_event_buckets is not None and not is_future:
            delta_y_lost = {
                "count": len(y_event_buckets["lost"]),
                "acv": _safe_acv(y_event_buckets["lost"]),
            }
        delta_w_lost = None
        if w_event_buckets is not None and not is_future:
            delta_w_lost = {
                "count": len(w_event_buckets["lost"]),
                "acv": _safe_acv(w_event_buckets["lost"]),
            }

        # 5. Delayed Renewals Total (Overdue + Later Close)
        delayed_tot_cnt = 0 if is_future else (None if (b_period_start is None and main_buckets["delayed_total"].empty) else len(main_buckets["delayed_total"]))
        delayed_tot_acv = 0.0 if is_future else (None if (b_period_start is None and main_buckets["delayed_total"].empty) else _safe_acv(main_buckets["delayed_total"]))
        delta_y_delayed_tot = None
        if y_standing is not None and not is_future:
            delta_y_delayed_tot = {
                "count": len(main_buckets["delayed_total"]) - len(y_standing["delayed_total"]),
                "acv": round(_safe_acv(main_buckets["delayed_total"]) - _safe_acv(y_standing["delayed_total"]), 2),
            }
        delta_w_delayed_tot = None
        if w_standing is not None and not is_future:
            delta_w_delayed_tot = {
                "count": len(main_buckets["delayed_total"]) - len(w_standing["delayed_total"]),
                "acv": round(_safe_acv(main_buckets["delayed_total"]) - _safe_acv(w_standing["delayed_total"]), 2),
            }

        def _aggregate_by(col: str):
            res_agg = []
            if delayed_active.empty: return res_agg
            col_series = delayed_active[col].fillna("Unassigned")
            unique_vals = sorted(col_series.unique().tolist())
            y_tot = y_standing["delayed_total"] if y_standing is not None else None
            w_tot = w_standing["delayed_total"] if w_standing is not None else None
            for val in unique_vals:
                d = delayed_active[delayed_active[col].fillna("Unassigned") == val]
                d_y = y_tot[y_tot[col].fillna("Unassigned") == val] if (y_tot is not None and not y_tot.empty) else pd.DataFrame()
                d_w = w_tot[w_tot[col].fillna("Unassigned") == val] if (w_tot is not None and not w_tot.empty) else pd.DataFrame()
                
                cats = {}
                ALL_FC = ["Commit", "Best Case", "Pipeline", "Closed", "Blank"]
                for cat in ALL_FC:
                    d_cat = d[d["forecast_category"] == cat]
                    dy_cat = d_y[d_y["forecast_category"] == cat] if not d_y.empty else pd.DataFrame()
                    dw_cat = d_w[d_w["forecast_category"] == cat] if not d_w.empty else pd.DataFrame()

                    delta_y_cat = {"count": len(d_cat) - len(dy_cat), "acv": round(_safe_acv(d_cat) - _safe_acv(dy_cat), 2)} if y_standing is not None else None
                    delta_w_cat = {"count": len(d_cat) - len(dw_cat), "acv": round(_safe_acv(d_cat) - _safe_acv(dw_cat), 2)} if w_standing is not None else None
                    cats[cat] = {
                        "count": len(d_cat),
                        "acv": round(_safe_acv(d_cat), 2),
                        "delayed_vs_yesterday": delta_y_cat,
                        "delayed_vs_lastweek": delta_w_cat,
                    }
                    
                delta_y_grp = {"count": len(d) - len(d_y), "acv": round(_safe_acv(d) - _safe_acv(d_y), 2)} if y_standing is not None else None
                delta_w_grp = {"count": len(d) - len(d_w), "acv": round(_safe_acv(d) - _safe_acv(d_w), 2)} if w_standing is not None else None

                res_agg.append({
                    "label": val,
                    "count": len(d),
                    "acv": round(float(d["forecast_acv_amount"].sum()), 2) if not d.empty else 0.0,
                    "avg_push_out": round(float(d["push_out_days"].mean()), 1) if len(d) > 0 and "push_out_days" in d.columns else 0,
                    "max_push_out": int(d["push_out_days"].max()) if len(d) > 0 and "push_out_days" in d.columns else 0,
                    "categories": cats,
                    "delayed_vs_yesterday": delta_y_grp,
                    "delayed_vs_lastweek": delta_w_grp,
                })
            return sorted(res_agg, key=lambda x: x["acv"], reverse=True)

        # Ageing breakdown of overdue deals (0-7, 8-30, 31-60, 60+ days past close date)
        if not overdue_df.empty:
            b_0_7 = overdue_df[overdue_df["days_overdue"] <= 7]
            b_8_30 = overdue_df[(overdue_df["days_overdue"] > 7) & (overdue_df["days_overdue"] <= 30)]
            b_31_60 = overdue_df[(overdue_df["days_overdue"] > 30) & (overdue_df["days_overdue"] <= 60)]
            b_60_plus = overdue_df[overdue_df["days_overdue"] > 60]
            ageing_breakdown = [
                {"bracket": "0-7", "label": "0–7 Days", "count": len(b_0_7), "acv": round(float(b_0_7["forecast_acv_amount"].sum()), 2)},
                {"bracket": "8-30", "label": "8–30 Days", "count": len(b_8_30), "acv": round(float(b_8_30["forecast_acv_amount"].sum()), 2)},
                {"bracket": "31-60", "label": "31–60 Days", "count": len(b_31_60), "acv": round(float(b_31_60["forecast_acv_amount"].sum()), 2)},
                {"bracket": "60+", "label": "60+ Days", "count": len(b_60_plus), "acv": round(float(b_60_plus["forecast_acv_amount"].sum()), 2)},
            ]
        else:
            ageing_breakdown = [
                {"bracket": "0-7", "label": "0–7 Days", "count": 0, "acv": 0.0},
                {"bracket": "8-30", "label": "8–30 Days", "count": 0, "acv": 0.0},
                {"bracket": "31-60", "label": "31–60 Days", "count": 0, "acv": 0.0},
                {"bracket": "60+", "label": "60+ Days", "count": 0, "acv": 0.0},
            ]

        # Newly delayed vs yesterday
        newly_delayed_deals = []
        newly_delayed_count = 0
        newly_delayed_acv = 0.0
        if y_standing is not None and not delayed_active.empty:
            y_tot_ids = set(y_standing["delayed_total"]["opportunity_id_18"]) if not y_standing["delayed_total"].empty else set()
            newly_df = delayed_active[~delayed_active["opportunity_id_18"].isin(y_tot_ids)]
            if not newly_df.empty:
                newly_df_export = newly_df.copy()
                if "close_date" in newly_df_export.columns:
                    newly_df_export["close_date"] = newly_df_export["close_date"].apply(lambda x: x.strftime("%Y-%m-%d") if pd.notna(x) and hasattr(x, 'strftime') else (str(x)[:10] if pd.notna(x) else ""))
                newly_delayed_deals = newly_df_export.fillna("").to_dict("records")
                newly_delayed_count = len(newly_df)
                newly_delayed_acv = round(float(newly_df["forecast_acv_amount"].sum()), 2)

        newly_delayed = {
            "count": newly_delayed_count,
            "acv": newly_delayed_acv,
            "deals": newly_delayed_deals
        }

        # Quarter total ACV (ties exactly to Overview)
        if is_year:
            t_period_deals = t_ren[t_ren["fiscal_period"].apply(lambda fp: _parse_fp(fp)[0] == target_year if fp and "-" in fp else False)] if not t_ren.empty else pd.DataFrame()
        else:
            t_period_deals = t_ren[(t_ren["fiscal_period"] == target_p_str)] if not t_ren.empty else pd.DataFrame()
        quarter_total_acv = round(float(t_period_deals["forecast_acv_amount"].sum()), 2) if not t_period_deals.empty else 0.0
        total_delayed_acv = float(delayed_active["forecast_acv_amount"].sum()) if not delayed_active.empty else 0.0
        delayed_pct_of_quarter = round((total_delayed_acv / quarter_total_acv * 100), 1) if quarter_total_acv > 0 and total_delayed_acv else 0.0
        slippage_pct_of_quarter = round((slip_tot_acv / quarter_total_acv * 100), 1) if quarter_total_acv > 0 and slip_tot_acv else 0.0

        # Snapshot trend
        trend = self._compute_snapshot_trend(t_snap, target_p_str, filter_spec=fs)

        # Top 10 delayed deals with owner, region, days_overdue, push_out_days
        if not delayed_active.empty:
            top_df = delayed_active.sort_values(by="forecast_acv_amount", ascending=False).head(10).copy()
            if "close_date" in top_df.columns:
                top_df["close_date"] = top_df["close_date"].apply(lambda x: x.strftime("%Y-%m-%d") if pd.notna(x) and hasattr(x, 'strftime') else (str(x)[:10] if pd.notna(x) else ""))
            top_deals = top_df.fillna("").to_dict("records")
        else:
            top_deals = []

        from backend.config import settings
        include_prior_fy = getattr(settings, "DELAYED_INCLUDE_PRIOR_FY", True)
        if ptype in ("future_quarter", "future_year"):
            rule_text = "Future period selected: renewals have not entered delay tracking yet."
        elif ptype == "past_quarter":
            rule_text = "Past quarter selected: open renewals in this quarter past expected close date count as overdue."
        else:
            rule_text = (
                "Open deals whose fiscal period is before the current quarter (including previous fiscal year) count as delayed."
                if include_prior_fy
                else "Open deals whose fiscal period is before the current quarter of the same fiscal year count as delayed."
            )

        delayed_renewals = {
            "heading": "Delayed Renewals",
            "rule_caption": "Deals that stay in the selected quarter but are late: either the close date has passed (Overdue) or the close date was pushed later within the same quarter (Postponed).",
            "total": {
                "count": delayed_tot_cnt,
                "acv": delayed_tot_acv,
                "pct_of_quarter": delayed_pct_of_quarter,
                "delayed_vs_yesterday": delta_y_delayed_tot,
                "delayed_vs_lastweek": delta_w_delayed_tot,
            },
            "overdue": {
                "count": 0 if is_future else len(overdue_df),
                "acv": 0.0 if is_future else _safe_acv(overdue_df),
                "baseline_label": "Current",
                "delayed_vs_yesterday": delta_y_od,
                "delayed_vs_lastweek": delta_w_od,
            },
            "later_close": {
                "count": later_cnt,
                "acv": later_acv,
                "baseline_label": "n/a" if is_future else period_start_label,
                "delayed_vs_yesterday": delta_y_later,
                "delayed_vs_lastweek": delta_w_later,
            },
        }

        slippage = {
            "heading": "Slippage",
            "rule_caption": "Deals that moved out of the selected quarter into a later one, split by destination.",
            "total": {
                "count": slip_tot_cnt,
                "acv": slip_tot_acv,
                "pct_of_quarter": slippage_pct_of_quarter,
                "delayed_vs_yesterday": delta_y_slip_tot,
                "delayed_vs_lastweek": delta_w_slip_tot,
            },
            "slipped_next_year": {
                "count": slip_ny_cnt,
                "acv": slip_ny_acv,
                "baseline_label": "n/a" if is_future else period_start_label,
                "delayed_vs_yesterday": delta_y_slip_ny,
                "delayed_vs_lastweek": delta_w_slip_ny,
            },
            "slipped_next_quarter": {
                "count": slip_nq_cnt,
                "acv": slip_nq_acv,
                "baseline_label": "n/a" if is_future else period_start_label,
                "delayed_vs_yesterday": delta_y_slip_nq,
                "delayed_vs_lastweek": delta_w_slip_nq,
            },
            "slipped_later_quarter": {
                "count": slip_lq_cnt,
                "acv": slip_lq_acv,
                "baseline_label": "n/a" if is_future else period_start_label,
                "delayed_vs_yesterday": delta_y_slip_lq,
                "delayed_vs_lastweek": delta_w_slip_lq,
            },
        }

        lost_card = {
            "heading": "Lost / Removed",
            "rule_caption": "Deals deleted or lost since the baseline period.",
            "count": lost_cnt,
            "acv": lost_acv,
            "baseline_label": "n/a" if is_future else period_start_label,
            "delayed_vs_yesterday": delta_y_lost,
            "delayed_vs_lastweek": delta_w_lost,
        }

        return {
            "data_slice": target_q_label,
            "data_slice_key": target_p_str,
            "period_type": ptype,
            "is_future": is_future,
            "rule_text": rule_text,
            "delayed_include_prior_fy": include_prior_fy,
            "filters_applied": res.filters_applied,
            "snapshot_date": t_snap.snapshot_date.isoformat(),
            "period_start_baseline_date": b_period_start.snapshot_date.isoformat() if b_period_start else None,
            "period_start_baseline_label": period_start_label,
            "period_start_is_partial": is_partial,
            "compare_date": p_snap.snapshot_date.isoformat() if p_snap else None,
            "yesterday_date": y_snap.snapshot_date.isoformat() if y_snap else None,
            "lastweek_date": w_snap.snapshot_date.isoformat() if w_snap else None,
            "quarter_total_acv": quarter_total_acv,
            "delayed_pct_of_quarter": delayed_pct_of_quarter,
            "slippage_pct_of_quarter": slippage_pct_of_quarter,
            "delayed_renewals": delayed_renewals,
            "slippage": slippage,
            "delayed_renewals_total": delayed_renewals["total"],
            "slippage_total": slippage["total"],
            "total": delayed_renewals["total"],
            "overdue": delayed_renewals["overdue"],
            "slipped": slippage["total"],
            "slipped_next_year": slippage["slipped_next_year"],
            "slipped_next_quarter": slippage["slipped_next_quarter"],
            "slipped_later_quarter": slippage["slipped_later_quarter"],
            "later_close": delayed_renewals["later_close"],
            "lost": lost_card,
            "by_region": _aggregate_by("region"),
            "by_bu": _aggregate_by("business_unit"),
            "by_category": _aggregate_by("forecast_category"),
            "by_approval": _aggregate_by("approval_status"),
            "ageing_breakdown": ageing_breakdown,
            "newly_delayed": newly_delayed,
            "trend": trend,
            "top_deals": top_deals
        }

    def get_deals(
        self,
        as_of: str | None = None,
        compare: str | None = None,
        kind: str = "all",
        region: str | None = None,
        category: str | None = None,
        status: str | None = None,
        bu: str | None = None,
        ageing: str | None = None,
        newly_delayed: bool = False,
        filter_spec: Optional[ScopeService.FilterSpec] = None
    ) -> dict:
        eff_as_of = as_of or (filter_spec.as_of if filter_spec else None)
        eff_compare = compare if compare is not None else "period_start"
        t_snap = self._active_snap(eff_as_of)
        if not t_snap: return {"count": 0, "acv": 0.0, "deals": []}
        
        from backend.services.scopes import FilterSpec
        fs = filter_spec.model_copy() if filter_spec else FilterSpec()
        res = ScopeService.resolve(fs, snapshot=t_snap, as_of_date=t_snap.snapshot_date)
        
        target_p_str = fs.period if fs.period and (fs.period.startswith("Q") or fs.period.startswith("FY") or len(fs.period) == 4) else res.period
        if not target_p_str or target_p_str in ("current_quarter", "all_periods", "all"):
            target_p_str = ScopeService.current_quarter(t_snap.snapshot_date)

        is_year, target_year, target_parsed, s_date, e_date, ptype, target_q_label = self._parse_period_info(target_p_str, t_snap.snapshot_date)
        is_future = ptype in ("future_quarter", "future_year")

        if is_future:
            return {"count": 0, "acv": 0.0, "deals": []}

        # 3 baselines
        b_period_start, is_partial, period_start_label = self.get_period_start_baseline(t_snap, s_date)
        y_snap = self.get_yesterday_baseline(t_snap)
        w_snap = self.get_lastweek_baseline(t_snap)

        today_buckets = self._compute_snapshot_buckets(t_snap, target_p_str, filter_spec=fs, base_snap=b_period_start, no_baseline=(b_period_start is None))

        is_delta = kind.endswith("_delta")
        base_kind = kind.replace("delayed_", "").replace("_delta", "")
        if base_kind in ("all", "total"):
            base_kind = "total"

        # Delta mode handling
        if is_delta:
            comp_snap = w_snap if eff_compare == "last_week" else y_snap
            if not comp_snap:
                return {"count": 0, "acv": 0.0, "deals": []}
            
            comp_standing = self._compute_snapshot_buckets(comp_snap, target_p_str, filter_spec=fs, base_snap=None, no_baseline=True)

            t_df = today_buckets.get(base_kind, today_buckets["total"]).copy()
            c_df = comp_standing.get(base_kind, comp_standing["total"]).copy()

            def _apply_subfilters(df_sub):
                if df_sub.empty: return df_sub
                if ageing:
                    if "days_overdue" not in df_sub.columns:
                        t_snap_date = pd.Timestamp(t_snap.snapshot_date)
                        df_sub["days_overdue"] = df_sub["close_date"].apply(lambda d: max(0, (t_snap_date.date() - d.date()).days) if pd.notna(d) else 0)
                    if ageing == "0-7": df_sub = df_sub[df_sub["days_overdue"] <= 7]
                    elif ageing == "8-30": df_sub = df_sub[(df_sub["days_overdue"] > 7) & (df_sub["days_overdue"] <= 30)]
                    elif ageing == "31-60": df_sub = df_sub[(df_sub["days_overdue"] > 30) & (df_sub["days_overdue"] <= 60)]
                    elif ageing == "60+": df_sub = df_sub[df_sub["days_overdue"] > 60]
                if region and region != "All":
                    df_sub = df_sub[df_sub["region"] == region]
                if category and category != "All":
                    df_sub = df_sub[df_sub["forecast_category"] == category]
                if status and status != "All":
                    df_sub = df_sub[df_sub["approval_status"] == status]
                if bu and bu != "All":
                    df_sub = df_sub[df_sub["business_unit"] == bu]
                return df_sub

            t_df = _apply_subfilters(t_df)
            c_df = _apply_subfilters(c_df)

            t_map = {str(r["opportunity_id_18"]): r for _, r in t_df.iterrows()} if not t_df.empty else {}
            c_map = {str(r["opportunity_id_18"]): r for _, r in c_df.iterrows()} if not c_df.empty else {}

            added_deals = []
            for oid, tr in t_map.items():
                if oid not in c_map:
                    d = dict(tr)
                    d["delta_group"] = f"Added to {base_kind}"
                    d["delta_acv_change"] = float(tr.get("forecast_acv_amount", 0.0) or 0.0)
                    added_deals.append(d)

            left_deals = []
            for oid, cr in c_map.items():
                if oid not in t_map:
                    d = dict(cr)
                    d["delta_group"] = f"Left {base_kind}"
                    d["delta_acv_change"] = -float(cr.get("forecast_acv_amount", 0.0) or 0.0)
                    left_deals.append(d)

            changed_deals = []
            for oid in t_map:
                if oid in c_map:
                    diff = round(float(t_map[oid].get("forecast_acv_amount", 0.0) or 0.0) - float(c_map[oid].get("forecast_acv_amount", 0.0) or 0.0), 2)
                    if abs(diff) > 0.001:
                        d = dict(t_map[oid])
                        d["delta_group"] = "Amount changed"
                        d["delta_acv_change"] = diff
                        changed_deals.append(d)

            net_count = len(t_df) - len(c_df)
            net_acv = round(float(t_df["forecast_acv_amount"].sum() if not t_df.empty else 0.0) - float(c_df["forecast_acv_amount"].sum() if not c_df.empty else 0.0), 2)

            for d in added_deals + left_deals + changed_deals:
                if pd.notna(d.get("close_date")) and hasattr(d["close_date"], "strftime"):
                    d["close_date"] = d["close_date"].strftime("%Y-%m-%d")
                elif pd.notna(d.get("close_date")):
                    d["close_date"] = str(d["close_date"])[:10]

            delta_groups = {
                "added": {"name": f"Added ({len(added_deals)})", "count": len(added_deals), "acv": round(sum(d["forecast_acv_amount"] for d in added_deals), 2), "deals": added_deals},
                "left": {"name": f"Left ({len(left_deals)})", "count": len(left_deals), "acv": round(sum(d["forecast_acv_amount"] for d in left_deals), 2), "deals": left_deals},
                "amount_changed": {"name": f"Amount changed ({len(changed_deals)})", "count": len(changed_deals), "acv": round(sum(d["delta_acv_change"] for d in changed_deals), 2), "deals": changed_deals},
                "net": {"count": net_count, "acv": net_acv},
            }

            return {
                "count": net_count,
                "acv": net_acv,
                "delta_groups": delta_groups,
                "deals": added_deals + left_deals + changed_deals
            }

        # Regular standing/event bucket deals
        df = pd.DataFrame()
        if kind == "newly_delayed" or newly_delayed:
            if y_snap:
                y_standing = self._compute_snapshot_buckets(y_snap, target_p_str, filter_spec=fs, base_snap=None, no_baseline=True)
                y_tot_ids = set(y_standing["total"]["opportunity_id_18"]) if not y_standing["total"].empty else set()
                df = today_buckets["total"][~today_buckets["total"]["opportunity_id_18"].isin(y_tot_ids)].copy()
        elif base_kind in ("slipped", "slippage_total", "slipped_next_year", "slipped_next_quarter", "slipped_later_quarter", "later_close", "lost"):
            # Select baseline comparison snapshot
            if eff_compare == "yesterday" and y_snap:
                b_ev = self._compute_snapshot_buckets(t_snap, target_p_str, filter_spec=fs, base_snap=y_snap)
                df = b_ev.get(base_kind, pd.DataFrame()).copy()
            elif eff_compare == "last_week" and w_snap:
                b_ev = self._compute_snapshot_buckets(t_snap, target_p_str, filter_spec=fs, base_snap=w_snap)
                df = b_ev.get(base_kind, pd.DataFrame()).copy()
            else:
                # Default is period_start
                df = today_buckets.get(base_kind, pd.DataFrame()).copy()
        elif base_kind in ("delayed_total", "delayed_renewals_total", "total", "all"):
            df = today_buckets["delayed_total"].copy()
        elif base_kind in today_buckets:
            df = today_buckets[base_kind].copy()

        if df.empty:
            return {"count": 0, "acv": 0.0, "deals": []}

        if ageing:
            if "days_overdue" not in df.columns:
                t_snap_date = pd.Timestamp(t_snap.snapshot_date)
                df["days_overdue"] = df["close_date"].apply(lambda d: max(0, (t_snap_date.date() - d.date()).days) if pd.notna(d) else 0)
            if ageing == "0-7": df = df[df["days_overdue"] <= 7]
            elif ageing == "8-30": df = df[(df["days_overdue"] > 7) & (df["days_overdue"] <= 30)]
            elif ageing == "31-60": df = df[(df["days_overdue"] > 30) & (df["days_overdue"] <= 60)]
            elif ageing == "60+": df = df[df["days_overdue"] > 60]

        if region and region != "All":
            df = df[df["region"] == region]
        if category and category != "All":
            df = df[df["forecast_category"] == category]
        if status and status != "All":
            df = df[df["approval_status"] == status]
        if bu and bu != "All":
            df = df[df["business_unit"] == bu]

        if df.empty:
            return {"count": 0, "acv": 0.0, "deals": []}

        df["close_date"] = df["close_date"].apply(lambda x: x.strftime('%Y-%m-%d') if pd.notna(x) and hasattr(x, 'strftime') else (str(x)[:10] if pd.notna(x) else None))
        df = df.fillna("")
        deals = df.to_dict("records")
        return {
            "count": len(deals),
            "acv": round(float(df["forecast_acv_amount"].sum()), 2),
            "deals": deals
        }
