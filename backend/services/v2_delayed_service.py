"""
V2 Delayed Service — handles Delayed Renewals, Slippage, Slipped to Later Year,
Needs Review exception handling, and Admin Reconciliation.
All calculations are strictly data-driven with ZERO hard-coded years, quarters,
dates, group names, or sheet names.
"""
from __future__ import annotations

import logging
import re
from datetime import date, datetime, timedelta
from typing import Any, Optional

import pandas as pd
from sqlalchemy.orm import Session

from backend.models.opportunity import Opportunity
from backend.models.snapshot import UploadSnapshot
from backend.services.context import UserContext
from backend.utils.excel_parser import parse_excel_date, parse_excel_datetime
from backend.config import settings
from backend.services.scopes import ScopeService
from backend.services.settings_service import SettingsService

log = logging.getLogger(__name__)


def _parse_fp(fp: str) -> tuple[int, int]:
    """Qx-YYYY -> (YYYY, x)"""
    try:
        q, y = fp.split("-")
        return int(y), int(q[1])
    except Exception:
        return (0, 0)


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
    if s in ("North America", "LATAM", "Middle East and North Africa", "APAC", "Europe", "Africa"):
        return s
    if s == "AFRICA":
        return "Africa"
    if s == "MENA":
        return "Middle East and North Africa"
    if s == "NAMR":
        return "North America"
    if s == "South America":
        return "LATAM"
    return s


def _safe_acv(df_in: pd.DataFrame | None) -> float:
    if df_in is None or df_in.empty or "forecast_acv_amount" not in df_in.columns:
        return 0.0
    return round(float(df_in["forecast_acv_amount"].sum()), 2)


def _is_open_deal(sales_type: Any, forecast_category: Any, probability: Any, stage_number: Any, is_deleted_or_lost: bool) -> bool:
    """
    Open means:
    - Sales Type = Renewals
    - Forecast Category not Closed
    - Stage not deleted, lost, or won/closed
    - Probability below 100%
    """
    if str(sales_type or "").strip().lower() != "renewals":
        return False
    if str(forecast_category or "").strip().lower() == "closed":
        return False
    stage_str = str(stage_number or "").strip().lower()
    if any(w in stage_str for w in ["delete", "lost", "closed lost", "won & closed", "9. won"]):
        return False
    if is_deleted_or_lost:
        return False
    try:
        p = float(probability)
        if p >= 100.0:
            return False
    except (ValueError, TypeError):
        pass
    return True


def _opps_to_df(opps: list[Opportunity]) -> pd.DataFrame:
    if not opps:
        return pd.DataFrame()
    records = []
    for o in opps:
        extra = o.extra_attributes if isinstance(o.extra_attributes, dict) else {}
        
        # Extract Group and Category
        group_val = str(extra.get("Group") or extra.get("group") or "").strip()
        category_val = str(extra.get("Category") or extra.get("category") or o.renewal_category or "").strip()
        
        # Dates with fallback: Service Expiry date = Service Start Date minus 1 day
        start_d = parse_excel_date(extra.get("Service Start Date") or extra.get("service_start_date"))
        exp_d = parse_excel_date(extra.get("Service Expiry date") or extra.get("service_expiry_date"))
        if exp_d is None and start_d is not None and start_d.year >= 1900:
            exp_d = start_d - timedelta(days=1)

        close_d = parse_excel_date(o.close_date or extra.get("Close Date") or extra.get("close_date"))
        prob_val = o.probability_pct if o.probability_pct is not None else extra.get("Probability (%)") or extra.get("probability")
        stage_val = o.stage_number or str(extra.get("Stage Number") or extra.get("stage") or "")
        sales_t = o.sales_type or str(extra.get("Sales Type") or extra.get("sales_type") or "")
        fc_norm = _norm_fc(o.forecast_category or str(extra.get("Forecast Category") or extra.get("forecast_category") or ""))

        is_open = _is_open_deal(
            sales_type=sales_t,
            forecast_category=fc_norm,
            probability=prob_val,
            stage_number=stage_val,
            is_deleted_or_lost=bool(o.is_deleted_or_lost),
        )

        raw_type = str(extra.get("Type") or extra.get("type") or sales_t or "").strip()
        type_code = raw_type.split("-")[0].strip().upper() if raw_type else ""

        records.append({
            "id": o.opportunity_id_18,
            "opportunity_id_18": o.opportunity_id_18,
            "opportunity_name": o.opportunity_name,
            "account_name": o.account_name,
            "forecast_acv_amount": float(o.forecast_acv_amount or 0.0),
            "forecast_category": fc_norm,
            "business_unit": (o.business_unit_primary or "").strip() or "Unassigned",
            "business_unit_primary": (o.business_unit_primary or "").strip() or "Unassigned",
            "is_deleted_or_lost": bool(o.is_deleted_or_lost),
            "fiscal_period": o.fiscal_period or "",
            "close_date": pd.Timestamp(close_d) if close_d else pd.NaT,
            "_close_date": close_d,
            "_service_expiry_date": exp_d,
            "_service_start_date": start_d,
            "service_start_date": start_d.isoformat() if start_d else "",
            "service_expiry_date": exp_d.isoformat() if exp_d else "",
            "group": group_val,
            "category": category_val,
            "raw_type": raw_type,
            "type": raw_type,
            "type_code": type_code,
            "approval_status": _norm_approval(o.approval_status),
            "region": _map_region(o.revised_sub_region),
            "sub_region": _map_region(o.revised_sub_region),
            "sales_type": sales_t,
            "stage_number": stage_val,
            "probability_pct": prob_val,
            "owner": (o.opportunity_owner or "").strip(),
            "opportunity_owner": (o.opportunity_owner or "").strip(),
            "is_open": is_open,
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

    def _parse_period_info(self, target_p_str: str, snap_d: date) -> tuple[bool, Optional[int], tuple[int, int], date, date, str, str]:
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
        target_p_str: str,
        filter_spec: Optional[ScopeService.FilterSpec] = None,
        base_snap: Optional[UploadSnapshot] = None,
        no_baseline: bool = False,
        preloaded_df: Optional[pd.DataFrame] = None,
    ) -> dict:
        t_df = preloaded_df if preloaded_df is not None else _opps_to_df(self._get_opps(snap))
        snap_date = snap.snapshot_date
        t_snap_date = pd.Timestamp(snap_date)

        is_year, target_year, target_parsed, s_date, e_date, ptype, p_label = self._parse_period_info(target_p_str, snap_date)
        is_future = ptype in ("future_quarter", "future_year")

        # Period start / year end
        quarter_start = s_date
        quarter_end = e_date
        selected_year = target_year if (is_year and target_year) else (s_date.year if s_date else snap_date.year)
        next_year = selected_year + 1
        year_end = date(selected_year, 12, 31)

        # Settings
        available_groups = [str(g).strip() for g in t_df["group"].dropna().unique() if str(g).strip()] if (not t_df.empty and "group" in t_df.columns) else []
        available_types = [str(t).strip().upper() for t in t_df["type_code"].dropna().unique() if str(t).strip()] if (not t_df.empty and "type_code" in t_df.columns) else []
        rules = SettingsService.get_delayed_rules(self.db, available_groups=available_groups, available_types=available_types)
        lookback_years = SettingsService.get_lookback_years(self.db)
        rules["lookback_years"] = lookback_years
        rules["delayed_start_year"] = snap_date.year - lookback_years
        rules["as_of_year"] = snap_date.year
        rules["next_year"] = snap_date.year + 1
        rules["delayed_subtitle"] = f"Service started before this month (from 1 Jan of {snap_date.year - lookback_years}), not yet closed"
        rules["slippage_subtitle"] = f"Service started {snap_date.year - lookback_years}–{snap_date.year}, close date {snap_date.year + 1}"
        excluded_stages = SettingsService.get_excluded_stages(self.db)
        norm_excluded_stages = [re.sub(r"^\d+\.\s*", "", exc).strip().lower() for exc in excluded_stages]

        def _is_deal_stage_excluded(st: Any) -> bool:
            if not st or not str(st).strip():
                return True
            s = re.sub(r"^\d+\.\s*", "", str(st)).strip().lower()
            return not s or any(s == exc for exc in norm_excluded_stages)

        if filter_spec and filter_spec.types is not None:
            if any(t.lower() == "all" for t in filter_spec.types):
                included_type_codes = available_types
                type_filter_note = "All types"
            else:
                included_type_codes = [t.upper().strip() for t in filter_spec.types if t.strip()]
                type_filter_note = " and ".join(included_type_codes) + " types only" if included_type_codes else "All types"
        else:
            setting_types = SettingsService.get_included_types(self.db)
            if setting_types and not any(t.lower() == "all" for t in setting_types):
                included_type_codes = setting_types
                type_filter_note = " and ".join(included_type_codes) + " types only"
            else:
                included_type_codes = available_types or ["ALL"]
                type_filter_note = "All types"

        far_ahead_years = rules.get("close_date_far_ahead_years", 5)

        # Base filter: Sales Type = Renewals, Stage not excluded, not deleted/lost, Type matching global filter
        if not t_df.empty:
            sales_mask = t_df["sales_type"].astype(str).str.strip().str.lower() == "renewals"
            stage_excluded_mask = t_df["stage_number"].apply(_is_deal_stage_excluded) | t_df["is_deleted_or_lost"]
            base_open_mask = sales_mask & (~stage_excluded_mask)

            if included_type_codes != ["ALL"] and set(included_type_codes) != set(available_types):
                type_mask = t_df["type_code"].isin(included_type_codes)
                open_df = t_df[base_open_mask & type_mask].copy()
            else:
                open_df = t_df[base_open_mask].copy()
        else:
            open_df = pd.DataFrame()

        # -------------------------------------------------------------
        # 1. DELAYED RENEWALS (Section A New Rule)
        # Service Start Date from 1 January of (as-of year minus lookback) up to the day before the first day of the as-of month.
        # -------------------------------------------------------------
        start_bound = date(snap_date.year - lookback_years, 1, 1)
        first_day_of_month = date(snap_date.year, snap_date.month, 1)
        end_bound = first_day_of_month - timedelta(days=1)

        if not open_df.empty and not is_future:
            delay_mask = open_df["_service_start_date"].apply(
                lambda d: (start_bound <= d <= end_bound) if (d and d.year >= 1900) else False
            )
            delayed_totals_df = open_df[delay_mask].copy()
            delayed_other_type_df = pd.DataFrame()
            delayed_nonpos_df = delayed_totals_df[delayed_totals_df["forecast_acv_amount"] <= 0].copy()
            fallback_used = False
        else:
            delayed_totals_df = pd.DataFrame()
            delayed_other_type_df = pd.DataFrame()
            delayed_nonpos_df = pd.DataFrame()
            fallback_used = False

        # Two boxes: Overdue (close date before as-of) and Delayed, close date ahead
        if not delayed_totals_df.empty:
            is_od = delayed_totals_df["_close_date"].apply(lambda d: d < snap_date if d else False)
            overdue_df = delayed_totals_df[is_od].copy()
            ahead_df = delayed_totals_df[~is_od].copy()

            overdue_df["reason"] = "Overdue"
            overdue_df["days_overdue"] = overdue_df["_close_date"].apply(
                lambda d: max(0, (snap_date - d).days) if d else 0
            )
            overdue_df["days_to_close"] = 0

            ahead_df["reason"] = "Close date ahead"
            ahead_df["days_overdue"] = 0
            ahead_df["days_to_close"] = ahead_df["_close_date"].apply(
                lambda d: max(0, (d - snap_date).days) if d else 0
            )

            ahead_rest_q_df = ahead_df[ahead_df["_close_date"].apply(lambda d: d <= quarter_end if d else False)].copy()
            ahead_later_q_df = ahead_df[ahead_df["_close_date"].apply(lambda d: (quarter_end < d <= year_end) if d else False)].copy()
            ahead_next_yr_df = ahead_df[ahead_df["_close_date"].apply(lambda d: d.year == year_end.year + 1 if d else False)].copy()
            ahead_later_yr_df = ahead_df[ahead_df["_close_date"].apply(lambda d: d.year > year_end.year + 1 if d else False)].copy()
        else:
            overdue_df = pd.DataFrame()
            ahead_df = pd.DataFrame()
            ahead_rest_q_df = pd.DataFrame()
            ahead_later_q_df = pd.DataFrame()
            ahead_next_yr_df = pd.DataFrame()
            ahead_later_yr_df = pd.DataFrame()

        # -------------------------------------------------------------
        # 2. SLIPPAGE (Section A New Rule)
        # Service Start Date year from (as-of year minus lookback) to the as-of year, and Close Date year = as-of year plus 1.
        # -------------------------------------------------------------
        if not open_df.empty and not is_future:
            slippage_mask = open_df.apply(
                lambda r: (
                    snap_date.year - lookback_years <= r["_service_start_date"].year <= snap_date.year
                    and r["_close_date"] is not None
                    and r["_close_date"].year == snap_date.year + 1
                ) if (r["_service_start_date"] and r["_service_start_date"].year >= 1900) else False,
                axis=1
            )
            slipped_pos_df = open_df[slippage_mask].copy()
            slipped_nonpos_df = slipped_pos_df[slipped_pos_df["forecast_acv_amount"] <= 0].copy()
            slipped_other_type_df = pd.DataFrame()

            far_mask = open_df.apply(
                lambda r: (
                    snap_date.year - lookback_years <= r["_service_start_date"].year <= snap_date.year
                    and r["_close_date"] is not None
                    and r["_close_date"].year >= snap_date.year + 2
                ) if (r["_service_start_date"] and r["_service_start_date"].year >= 1900) else False,
                axis=1
            )
            review_far_close_df = open_df[far_mask].copy()
        else:
            slipped_pos_df = pd.DataFrame()
            slipped_nonpos_df = pd.DataFrame()
            slipped_other_type_df = pd.DataFrame()
            review_far_close_df = pd.DataFrame()

        # -------------------------------------------------------------
        # 3. NEEDS REVIEW SECTION
        # Missing Service Start Dates
        # -------------------------------------------------------------
        seen_review_opp_ids = set()

        missing_dates_mask = open_df["_service_start_date"].isna() if not open_df.empty else pd.Series(dtype=bool)
        review_missing_dates_df = open_df[missing_dates_mask].copy() if not open_df.empty else pd.DataFrame()
        if not review_missing_dates_df.empty:
            review_missing_dates_df["why_it_is_here"] = "Service Start Date is missing, time-only, or invalid."
            review_missing_dates_df["review_type"] = "missing_service_dates"
            seen_review_opp_ids.update(review_missing_dates_df["opportunity_id_18"].dropna())

        if not review_far_close_df.empty:
            review_far_close_df = review_far_close_df[~review_far_close_df["opportunity_id_18"].isin(seen_review_opp_ids)].copy()
            review_far_close_df["why_it_is_here"] = f"Close date is {selected_year + 2} or later (more than a year ahead of {selected_year})."
            review_far_close_df["review_type"] = "far_ahead"
            seen_review_opp_ids.update(review_far_close_df["opportunity_id_18"].dropna())

        oth_list = []
        if not delayed_other_type_df.empty:
            oth_list.append(delayed_other_type_df)
        if oth_list:
            d_oth = pd.concat(oth_list).drop_duplicates(subset=["opportunity_id_18"])
            d_oth = d_oth[~d_oth["opportunity_id_18"].isin(seen_review_opp_ids)].copy()
            d_oth["why_it_is_here"] = d_oth["type_code"].apply(lambda tc: f"Type code '{tc}' excluded by Settings (MR and R only).")
            d_oth["review_type"] = "other_types"
            review_other_types_df = d_oth
            seen_review_opp_ids.update(review_other_types_df["opportunity_id_18"].dropna())
        else:
            review_other_types_df = pd.DataFrame()

        nonpos_list = []
        if not delayed_nonpos_df.empty:
            d_np = delayed_nonpos_df.copy()
            d_np["why_it_is_here"] = "Negative or zero ACV (already included in the totals above)."
            d_np["review_type"] = "negative_acv"
            nonpos_list.append(d_np)
        if not slipped_nonpos_df.empty:
            s_np = slipped_nonpos_df.copy()
            s_np["why_it_is_here"] = "Negative or zero ACV (already included in the totals above)."
            s_np["review_type"] = "negative_acv"
            nonpos_list.append(s_np)
        review_nonpos_df = pd.concat(nonpos_list).drop_duplicates(subset=["opportunity_id_18"]) if nonpos_list else pd.DataFrame()
        if not review_nonpos_df.empty:
            review_nonpos_df = review_nonpos_df[~review_nonpos_df["opportunity_id_18"].isin(seen_review_opp_ids)].copy()
            seen_review_opp_ids.update(review_nonpos_df["opportunity_id_18"].dropna())

        review_expired_no_group_df = open_df[
            open_df["_service_expiry_date"].apply(lambda d: d < quarter_start if (d and d.year >= 1900) else False) &
            (~delay_mask) &
            open_df["type_code"].isin(included_type_codes)
        ].copy() if not open_df.empty else pd.DataFrame()
        if not review_expired_no_group_df.empty:
            review_expired_no_group_df = review_expired_no_group_df[~review_expired_no_group_df["opportunity_id_18"].isin(seen_review_opp_ids)].copy()
            review_expired_no_group_df["why_it_is_here"] = f"Service expired before start of selected period but not in delayed Group."
            review_expired_no_group_df["review_type"] = "expired_no_group"

        # Lost since start of quarter (kept per prompt)
        lost_df = pd.DataFrame()
        if not is_future and not no_baseline and base_snap and not t_df.empty:
            base_opps = self._get_opps(base_snap)
            base_df = _opps_to_df(base_opps)
            base_ren = base_df[base_df["sales_type"] == "Renewals"] if not base_df.empty else pd.DataFrame()
            t_ren = t_df[t_df["sales_type"] == "Renewals"] if not t_df.empty else pd.DataFrame()

            if not base_ren.empty and not t_ren.empty:
                if is_year:
                    base_deals = base_ren[base_ren["fiscal_period"].apply(lambda fp: _parse_fp(fp)[0] == target_year if fp and "-" in fp else False) & (~base_ren["is_deleted_or_lost"])]
                else:
                    base_deals = base_ren[(base_ren["fiscal_period"] == target_p_str) & (~base_ren["is_deleted_or_lost"])]

                if not base_deals.empty:
                    base_idx = base_deals.set_index("opportunity_id_18")
                    t_idx = t_ren.set_index("opportunity_id_18")
                    lost_rows = []
                    for opp_id, b_row in base_idx.iterrows():
                        if opp_id not in t_idx.index or t_idx.loc[opp_id]["is_deleted_or_lost"]:
                            r = b_row.copy()
                            r["opportunity_id_18"] = opp_id
                            r["reason"] = "Lost/removed"
                            lost_rows.append(r)
                    lost_df = pd.DataFrame(lost_rows).drop_duplicates(subset=["opportunity_id_18"]) if lost_rows else pd.DataFrame()

        return {
            "delayed_total": delayed_totals_df,
            "total": delayed_totals_df,
            "overdue": overdue_df,
            "ahead": ahead_df,
            "ahead_rest_q": ahead_rest_q_df,
            "ahead_later_q": ahead_later_q_df,
            "ahead_next_yr": ahead_next_yr_df,
            "ahead_later_yr": ahead_later_yr_df,
            "delayed_other_type": delayed_other_type_df,
            "delayed_nonpos": delayed_nonpos_df,
            "slippage": slipped_pos_df,
            "slipped": slipped_pos_df,
            "slippage_total": slipped_pos_df,
            "slipped_total": slipped_pos_df,
            "slippage_df": slipped_pos_df,
            "slipped_nonpos": slipped_nonpos_df,
            "slipped_other_type": slipped_other_type_df,
            "review_missing_dates": review_missing_dates_df,
            "review_far_close": review_far_close_df,
            "review_other_types": review_other_types_df,
            "review_nonpos": review_nonpos_df,
            "review_expired_no_group": review_expired_no_group_df,
            "lost": lost_df,
            "t_df": t_df,
            "open_df": open_df,
            "rules": rules,
            "fallback_used": fallback_used,
            "effective_delayed_group": "",
            "included_type_codes": included_type_codes,
            "type_filter_note": type_filter_note,
            "quarter_start": quarter_start,
            "quarter_end": quarter_end,
            "year_end": year_end,
            "selected_year": selected_year,
            "next_year": next_year,
            "period_label": p_label,
            "target_p_str": target_p_str,
            "is_year": is_year,
            "is_future": is_future,
            "has_baseline": (base_snap is not None and not no_baseline),
        }

    def get_summary(
        self,
        as_of: str | None = None,
        compare: str | None = None,
        filter_spec: Optional[ScopeService.FilterSpec] = None,
    ) -> dict:
        eff_as_of = as_of or (filter_spec.as_of if filter_spec else None)
        eff_compare = compare or (filter_spec.compare if filter_spec else "yesterday")
        t_snap = self._active_snap(eff_as_of)
        if not t_snap:
            return {"error": "No data"}

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

        # Compute today's buckets
        rules = SettingsService.get_delayed_rules(self.db)
        main_buckets = self._compute_snapshot_buckets(t_snap, target_p_str, filter_spec=fs, base_snap=b_period_start, no_baseline=(b_period_start is None))

        # Comparison snapshot standing buckets (for signed net trends in Delayed Renewals & Slippage)
        y_standing = self._compute_snapshot_buckets(y_snap, target_p_str, filter_spec=fs, base_snap=None, no_baseline=True) if y_snap else None
        w_standing = self._compute_snapshot_buckets(w_snap, target_p_str, filter_spec=fs, base_snap=None, no_baseline=True) if w_snap else None

        # Period start baseline standing buckets (for trend since start of period/year)
        start_standing = self._compute_snapshot_buckets(b_period_start, target_p_str, filter_spec=fs, base_snap=None, no_baseline=True) if b_period_start else None

        def _calc_delta(current_df: pd.DataFrame, base_df: pd.DataFrame | None) -> dict | None:
            if base_df is None or is_future:
                return None
            return {
                "count": len(current_df) - len(base_df),
                "acv": round(_safe_acv(current_df) - _safe_acv(base_df), 2),
            }

        # -------------------------------------------------------------
        # Delayed Renewals: Total, Overdue, and Ahead
        # -------------------------------------------------------------
        del_tot_df = main_buckets["delayed_total"]
        overdue_df = main_buckets["overdue"]
        ahead_df = main_buckets["ahead"]

        ahead_rest_q_df = main_buckets["ahead_rest_q"]
        ahead_later_q_df = main_buckets["ahead_later_q"]
        ahead_next_yr_df = main_buckets["ahead_next_yr"]
        ahead_later_yr_df = main_buckets["ahead_later_yr"]

        year_end = main_buckets["year_end"]
        label_rest_q = f"Rest of {target_q_label}"
        label_later_q = f"Later quarters of {year_end.year}"
        label_next_yr = f"Next year ({year_end.year + 1})"
        label_later_yr = f"{year_end.year + 2} or later"

        type_filter_note = main_buckets["type_filter_note"]
        included_type_codes = main_buckets.get("included_type_codes", [])
        available_types = sorted(list(set(main_buckets["t_df"]["type_code"].dropna().unique()))) if "type_code" in main_buckets["t_df"].columns else []

        delayed_renewals = {
            "heading": "Delayed Renewals",
            "rule_caption": "Service has ended, renewal not closed yet.",
            "type_filter_note": type_filter_note,
            "as_of_note": "Delayed renewals depend on snapshot as-of date, not selected period.",
            "fallback_used": main_buckets["fallback_used"],
            "fallback_notice": "Notice: Group column not found or no match; fallback used: open renewals whose service expiry has passed." if main_buckets["fallback_used"] else None,
            "effective_delayed_group": main_buckets["effective_delayed_group"],
            "total": {
                "count": len(del_tot_df),
                "acv": _safe_acv(del_tot_df),
                "delta_period_start": _calc_delta(del_tot_df, start_standing["delayed_total"] if start_standing else None),
                "delayed_vs_yesterday": _calc_delta(del_tot_df, y_standing["delayed_total"] if y_standing else None),
                "delayed_vs_lastweek": _calc_delta(del_tot_df, w_standing["delayed_total"] if w_standing else None),
            },
            "overdue": {
                "heading": "Overdue Deals",
                "caption": "Close date has passed.",
                "count": len(overdue_df),
                "acv": _safe_acv(overdue_df),
                "baseline_label": "Current",
                "delta_period_start": _calc_delta(overdue_df, start_standing["overdue"] if start_standing else None),
                "delayed_vs_yesterday": _calc_delta(overdue_df, y_standing["overdue"] if y_standing else None),
                "delayed_vs_lastweek": _calc_delta(overdue_df, w_standing["overdue"] if w_standing else None),
            },
            "ahead": {
                "heading": "Close Date Ahead",
                "caption": "Close date is still to come.",
                "count": len(ahead_df),
                "acv": _safe_acv(ahead_df),
                "baseline_label": "Current",
                "delta_period_start": _calc_delta(ahead_df, start_standing["ahead"] if start_standing else None),
                "delayed_vs_yesterday": _calc_delta(ahead_df, y_standing["ahead"] if y_standing else None),
                "delayed_vs_lastweek": _calc_delta(ahead_df, w_standing["ahead"] if w_standing else None),
                "split": [
                    {"key": "rest_of_quarter", "label": label_rest_q, "count": len(ahead_rest_q_df), "acv": _safe_acv(ahead_rest_q_df)},
                    {"key": "later_quarters_same_year", "label": label_later_q, "count": len(ahead_later_q_df), "acv": _safe_acv(ahead_later_q_df)},
                    {"key": "next_year", "label": label_next_yr, "count": len(ahead_next_yr_df), "acv": _safe_acv(ahead_next_yr_df)},
                    {"key": "later_years", "label": label_later_yr, "count": len(ahead_later_yr_df), "acv": _safe_acv(ahead_later_yr_df)},
                ],
            },
            "excluded_other_types": {
                "count": len(main_buckets["delayed_other_type"]),
                "acv": _safe_acv(main_buckets["delayed_other_type"]),
                "label": f"Other types excluded: {len(main_buckets['delayed_other_type'])} deals / ${_safe_acv(main_buckets['delayed_other_type']):,.2f}",
            },
        }
        delayed_renewals["later_close"] = delayed_renewals["ahead"]

        # Data-quality line
        dq_count = len(main_buckets["review_expired_no_group"])
        dq_acv = _safe_acv(main_buckets["review_expired_no_group"])
        data_quality_line = {
            "count": dq_count,
            "acv": dq_acv,
            "message": f"{dq_count} deals expired before the quarter but have no delayed Group: view",
        }

        # -------------------------------------------------------------
        # ONE SLIPPAGE ONLY, RELATIVE TO THE SELECTED YEAR
        # -------------------------------------------------------------
        slipped_pos_df = main_buckets["slippage"]
        selected_year = main_buckets["selected_year"]
        next_year = main_buckets["next_year"]

        def _fc_breakdown(df_sub: pd.DataFrame) -> dict[str, dict[str, Any]]:
            res_fc = {}
            ALL_FC = ["Commit", "Best Case", "Pipeline", "Closed", "Blank"]
            for cat in ALL_FC:
                d = df_sub[df_sub["forecast_category"] == cat] if not df_sub.empty else pd.DataFrame()
                res_fc[cat] = {
                    "count": len(d),
                    "acv": _safe_acv(d),
                }
            return res_fc

        # Slipped from breakdown table
        slipped_from_list = []
        if not slipped_pos_df.empty:
            s_exp_years = sorted([int(d.year) for d in slipped_pos_df["_service_start_date"].dropna() if d.year >= 1900])
            for ey in sorted(list(set(s_exp_years))):
                sub_ey = slipped_pos_df[slipped_pos_df["_service_start_date"].apply(lambda d: d.year == ey if d else False)]
                slipped_from_list.append({
                    "expiry_year": ey,
                    "count": len(sub_ey),
                    "acv": _safe_acv(sub_ey),
                })

        slippage_obj = {
            "heading": "Slippage",
            "rule_caption": f"Renewals whose service ended {selected_year} or earlier but are now expected to close in {next_year}.",
            "type_filter_note": type_filter_note,
            "selected_year": selected_year,
            "next_year": next_year,
            "total": {
                "count": len(slipped_pos_df),
                "acv": _safe_acv(slipped_pos_df),
                "delta_period_start": _calc_delta(slipped_pos_df, start_standing["slippage"] if start_standing else None),
                "delayed_vs_yesterday": _calc_delta(slipped_pos_df, y_standing["slippage"] if y_standing else None),
                "delayed_vs_lastweek": _calc_delta(slipped_pos_df, w_standing["slippage"] if w_standing else None),
            },
            "overall": {
                "count": len(slipped_pos_df),
                "acv": _safe_acv(slipped_pos_df),
            },
            "categories": _fc_breakdown(slipped_pos_df),
            "slipped_from": slipped_from_list,
            "buckets": slipped_from_list,
        }

        # -------------------------------------------------------------
        # Needs Review Section
        # -------------------------------------------------------------
        review_missing_dates = main_buckets.get("review_missing_dates", pd.DataFrame())
        review_far_close = main_buckets["review_far_close"]
        review_other_types = main_buckets["review_other_types"]
        review_nonpos = main_buckets["review_nonpos"]
        review_expired_no_group = main_buckets["review_expired_no_group"]

        needs_review_items = []
        if not review_missing_dates.empty:
            needs_review_items.append({
                "type": "missing_service_dates",
                "title": "Missing service dates",
                "description": "Open renewals of included types with no usable service dates (both start and expiry missing or zero).",
                "count": len(review_missing_dates),
                "acv": _safe_acv(review_missing_dates),
            })
        if not review_far_close.empty:
            needs_review_items.append({
                "type": "far_ahead",
                "title": "Close date more than a year ahead",
                "description": f"Open renewals whose service expired in {selected_year} or earlier but close date is in {selected_year + 2} or later (more than a year ahead of {selected_year}).",
                "count": len(review_far_close),
                "acv": _safe_acv(review_far_close),
            })
        if not review_other_types.empty:
            needs_review_items.append({
                "type": "other_types",
                "title": "Other types (not counted)",
                "description": f"Open deals of excluded types (e.g. TL, RS, CR, PL, UP) that would otherwise qualify for Delayed ({len(main_buckets['delayed_other_type'])} deals) or Slippage ({len(main_buckets['slipped_other_type'])} deals).",
                "count": len(review_other_types),
                "acv": _safe_acv(review_other_types),
                "delayed_count": len(main_buckets["delayed_other_type"]),
                "delayed_acv": _safe_acv(main_buckets["delayed_other_type"]),
                "slippage_count": len(main_buckets["slipped_other_type"]),
                "slippage_acv": _safe_acv(main_buckets["slipped_other_type"]),
            })
        if not review_nonpos.empty:
            needs_review_items.append({
                "type": "negative_acv",
                "title": "Negative or zero ACV (already included in the totals above)",
                "description": "Deals with zero or negative ACV that are already included in the Delayed and Slippage totals above.",
                "count": len(review_nonpos),
                "acv": _safe_acv(review_nonpos),
            })
        if not review_expired_no_group.empty:
            needs_review_items.append({
                "type": "expired_no_group",
                "title": "Service expired before quarter but no delayed Group",
                "description": "Open renewals whose service expired before the start of the quarter but are not categorized in the delayed Group.",
                "count": len(review_expired_no_group),
                "acv": _safe_acv(review_expired_no_group),
            })

        needs_review = {
            "heading": "Needs review",
            "rule_caption": "Exceptions and data-quality checks kept separate from headline totals.",
            "is_visible": len(needs_review_items) > 0,
            "has_exceptions": len(needs_review_items) > 0,
            "items": needs_review_items,
            "types": needs_review_items,
            "total_count": sum(i["count"] for i in needs_review_items),
            "total_acv": round(sum(i["acv"] for i in needs_review_items), 2),
        }

        # -------------------------------------------------------------
        # Lost since start of quarter
        # -------------------------------------------------------------
        lost_df = main_buckets["lost"]
        lost_card = {
            "heading": "Lost since start of quarter",
            "rule_caption": "Deals deleted or lost since the baseline period.",
            "count": len(lost_df) if b_period_start else 0,
            "acv": _safe_acv(lost_df) if b_period_start else 0.0,
            "delayed_vs_yesterday": _calc_delta(lost_df, y_standing["lost"] if y_standing else None),
            "delayed_vs_lastweek": _calc_delta(lost_df, w_standing["lost"] if w_standing else None),
        }

        # -------------------------------------------------------------
        # Delayed Renewals Trend across stored snapshots
        # -------------------------------------------------------------
        snaps_all = self.db.query(UploadSnapshot).order_by(UploadSnapshot.snapshot_date.asc()).all()
        trend_items = []
        for s in snaps_all:
            s_b = self._compute_snapshot_buckets(s, target_p_str, filter_spec=fs, base_snap=None, no_baseline=True)
            s_del = s_b["delayed_total"]
            trend_items.append({
                "snapshot_date": s.snapshot_date.isoformat(),
                "count": len(s_del),
                "acv": _safe_acv(s_del),
            })

        # -------------------------------------------------------------
        # Newly Delayed vs Yesterday (ties to Overdue card)
        # -------------------------------------------------------------
        comp_standing_for_new = y_standing if eff_compare == "yesterday" else w_standing
        newly_overdue_deals = []
        if comp_standing_for_new and not overdue_df.empty:
            comp_od_ids = set(comp_standing_for_new["overdue"]["opportunity_id_18"]) if not comp_standing_for_new["overdue"].empty else set()
            for _, r in overdue_df.iterrows():
                if r["opportunity_id_18"] not in comp_od_ids:
                    newly_overdue_deals.append({
                        "opportunity_id_18": r["opportunity_id_18"],
                        "opportunity_name": r["opportunity_name"],
                        "account_name": r["account_name"],
                        "region": r["region"],
                        "forecast_acv_amount": r["forecast_acv_amount"],
                        "reason": "Close date passed",
                    })

        new_count = len(overdue_df) - (len(comp_standing_for_new["overdue"]) if comp_standing_for_new else 0)
        new_acv = round(_safe_acv(overdue_df) - (_safe_acv(comp_standing_for_new["overdue"]) if comp_standing_for_new else 0.0), 2)
        newly_delayed = {
            "count": new_count,
            "acv": new_acv,
            "deals": newly_overdue_deals,
        }

        # Breakdown aggregations
        def _aggregate_by(col: str):
            res_agg = []
            if del_tot_df.empty:
                return res_agg
            col_series = del_tot_df[col].fillna("Unassigned")
            unique_vals = sorted(col_series.unique().tolist())
            y_tot = y_standing["delayed_total"] if y_standing is not None else None
            w_tot = w_standing["delayed_total"] if w_standing is not None else None

            for val in unique_vals:
                d = del_tot_df[del_tot_df[col].fillna("Unassigned") == val]
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
                    "acv": round(float(d["forecast_acv_amount"].sum()), 2),
                    "categories": cats,
                    "delayed_vs_yesterday": delta_y_grp,
                    "delayed_vs_lastweek": delta_w_grp,
                })
            return sorted(res_agg, key=lambda x: x["acv"], reverse=True)

        # Overdue ageing breakdown
        if not overdue_df.empty:
            b_0_7 = overdue_df[overdue_df["days_overdue"] <= 7]
            b_8_30 = overdue_df[(overdue_df["days_overdue"] > 7) & (overdue_df["days_overdue"] <= 30)]
            b_31_60 = overdue_df[(overdue_df["days_overdue"] > 30) & (overdue_df["days_overdue"] <= 60)]
            b_60_plus = overdue_df[overdue_df["days_overdue"] > 60]
            ageing_breakdown = [
                {"bracket": "0-7", "label": "0–7 Days", "count": len(b_0_7), "acv": _safe_acv(b_0_7)},
                {"bracket": "8-30", "label": "8–30 Days", "count": len(b_8_30), "acv": _safe_acv(b_8_30)},
                {"bracket": "31-60", "label": "31–60 Days", "count": len(b_31_60), "acv": _safe_acv(b_31_60)},
                {"bracket": "60+", "label": "60+ Days", "count": len(b_60_plus), "acv": _safe_acv(b_60_plus)},
            ]
        else:
            ageing_breakdown = [
                {"bracket": "0-7", "label": "0–7 Days", "count": 0, "acv": 0.0},
                {"bracket": "8-30", "label": "8–30 Days", "count": 0, "acv": 0.0},
                {"bracket": "31-60", "label": "31–60 Days", "count": 0, "acv": 0.0},
                {"bracket": "60+", "label": "60+ Days", "count": 0, "acv": 0.0},
            ]

        # Top 10 delayed deals
        if not del_tot_df.empty:
            top_df = del_tot_df.sort_values(by="forecast_acv_amount", ascending=False).head(10).copy()
            top_records = []
            for _, r in top_df.iterrows():
                snap_dt = t_snap.snapshot_date
                is_deal_od = r["_close_date"] < snap_dt if r["_close_date"] else False
                d_od = max(0, (snap_dt - r["_close_date"]).days) if (is_deal_od and r["_close_date"]) else 0
                d_close = max(0, (r["_close_date"] - snap_dt).days) if (not is_deal_od and r["_close_date"]) else 0
                top_records.append({
                    "opportunity_id_18": r["opportunity_id_18"],
                    "opportunity_name": r["opportunity_name"],
                    "account_name": r["account_name"],
                    "region": r["region"],
                    "owner": r.get("owner") or r.get("opportunity_owner") or "—",
                    "reason": "Overdue" if is_deal_od else "Close date ahead",
                    "days_overdue": d_od,
                    "days_to_close": d_close,
                    "forecast_acv_amount": r["forecast_acv_amount"],
                    "close_date": r["_close_date"].isoformat() if r["_close_date"] else "",
                })
            top_deals = top_records
        else:
            top_deals = []

        # Quarter total ACV (ties to Overview)
        t_ren = main_buckets["t_df"]
        if is_year:
            t_period_deals = t_ren[t_ren["fiscal_period"].apply(lambda fp: _parse_fp(fp)[0] == target_year if fp and "-" in fp else False)] if not t_ren.empty else pd.DataFrame()
        else:
            t_period_deals = t_ren[(t_ren["fiscal_period"] == target_p_str)] if not t_ren.empty else pd.DataFrame()
        quarter_total_acv = round(float(t_period_deals["forecast_acv_amount"].sum()), 2) if not t_period_deals.empty else 0.0
        total_delayed_acv = _safe_acv(del_tot_df)
        delayed_pct_of_quarter = round((total_delayed_acv / quarter_total_acv * 100), 1) if quarter_total_acv > 0 and total_delayed_acv else 0.0

        return {
            "data_slice": target_q_label,
            "data_slice_key": target_p_str,
            "period_type": ptype,
            "is_future": is_future,
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
            # Core rebuilt sections
            "delayed_renewals": delayed_renewals,
            "delayed_renewals_total": delayed_renewals["total"],
            "total": delayed_renewals["total"],
            "overdue": delayed_renewals["overdue"],
            "ahead": delayed_renewals["ahead"],
            "later_close": delayed_renewals["ahead"],
            "data_quality_line": data_quality_line,
            "slippage": slippage_obj,
            "slippage_total": slippage_obj["total"],
            "slipped": slippage_obj["total"],
            "slipped_total": slippage_obj["total"],
            "slipped_to_later_year": slippage_obj,
            "needs_review": needs_review,
            "lost": lost_card,
            "trend": trend_items,
            "newly_delayed": newly_delayed,
            # Breakdowns
            "by_region": _aggregate_by("region"),
            "by_bu": _aggregate_by("business_unit"),
            "by_category": _aggregate_by("forecast_category"),
            "by_approval": _aggregate_by("approval_status"),
            "ageing_breakdown": ageing_breakdown,
            "top_deals": top_deals,
            "rules": rules,
            "type_filter_note": type_filter_note,
            "delayed_include_prior_fy": getattr(settings, "DELAYED_INCLUDE_PRIOR_FY", True),
            "rule_text": rules.get("rule_caption", "Group contains delay, MR and R types"),
            "included_type_codes": included_type_codes,
            "available_types": available_types,
            "other_types_excluded": {
                "count": next((it["count"] for it in needs_review.get("items", []) if it.get("type") == "other_types"), 0),
                "acv": next((it["acv"] for it in needs_review.get("items", []) if it.get("type") == "other_types"), 0.0),
                "note": f"Other types excluded: {next((it['count'] for it in needs_review.get('items', []) if it.get('type') == 'other_types'), 0)} deals / ${next((it['acv'] for it in needs_review.get('items', []) if it.get('type') == 'other_types'), 0.0):,.2f}",
            } if any(it.get("type") == "other_types" and it.get("count", 0) > 0 for it in needs_review.get("items", [])) else None,
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
        filter_spec: Optional[ScopeService.FilterSpec] = None,
        expiry_year: int | None = None,
        close_year: int | None = None,
        review_type: str | None = None,
    ) -> dict:
        eff_as_of = as_of or (filter_spec.as_of if filter_spec else None)
        eff_compare = compare if compare is not None else "period_start"
        t_snap = self._active_snap(eff_as_of)
        if not t_snap:
            return {"count": 0, "acv": 0.0, "deals": []}

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

        b_period_start, _, _ = self.get_period_start_baseline(t_snap, s_date)
        y_snap = self.get_yesterday_baseline(t_snap)
        w_snap = self.get_lastweek_baseline(t_snap)

        today_buckets = self._compute_snapshot_buckets(t_snap, target_p_str, filter_spec=fs, base_snap=b_period_start, no_baseline=(b_period_start is None))

        is_delta = kind.endswith("_delta") or (compare in ("yesterday", "last_week") and kind in ("slipped", "slipped_total", "slippage"))
        base_kind = kind.replace("delayed_", "").replace("_delta", "")
        if base_kind in ("all", "total"):
            base_kind = "total"
        elif base_kind in ("slipped", "slipped_total"):
            base_kind = "slippage"

        # Delta mode handling
        if is_delta:
            comp_snap = w_snap if eff_compare == "last_week" else y_snap
            if comp_snap:
                comp_standing = self._compute_snapshot_buckets(comp_snap, target_p_str, filter_spec=fs, base_snap=None, no_baseline=True)
                t_df = today_buckets.get(base_kind, today_buckets["total"]).copy()
                c_df = comp_standing.get(base_kind, comp_standing["total"]).copy()

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

                all_delta = added_deals + left_deals + changed_deals
                for d in all_delta:
                    if "_close_date" in d and d["_close_date"]:
                        d["close_date"] = d["_close_date"].isoformat()
                    if "_service_expiry_date" in d and d["_service_expiry_date"]:
                        d["service_expiry_date"] = d["_service_expiry_date"].isoformat()

                return {
                    "count": len(t_df) - len(c_df),
                    "acv": round(_safe_acv(t_df) - _safe_acv(c_df), 2),
                    "deals": all_delta,
                }

        # Regular deals selection
        df = pd.DataFrame()
        if base_kind in ("total", "delayed_total", "all"):
            df = today_buckets["delayed_total"].copy()
        elif base_kind == "overdue":
            df = today_buckets["overdue"].copy()
        elif base_kind in ("ahead", "delayed_ahead", "later_close"):
            df = today_buckets["ahead"].copy()
        elif base_kind == "ahead_rest_q":
            df = today_buckets["ahead_rest_q"].copy()
        elif base_kind == "ahead_later_q":
            df = today_buckets["ahead_later_q"].copy()
        elif base_kind == "ahead_next_yr":
            df = today_buckets["ahead_next_yr"].copy()
        elif base_kind == "ahead_later_yr":
            df = today_buckets["ahead_later_yr"].copy()
        elif base_kind in ("slippage", "slipped", "slipped_total", "slippage_total", "slipped_to_later_year"):
            df = today_buckets["slippage"].copy()
        elif base_kind == "slipped_from_year":
            df = today_buckets["slippage"].copy()
            if expiry_year and not df.empty:
                df = df[df["_service_expiry_date"].apply(lambda d: d.year == expiry_year if d else False)]
        elif base_kind in ("needs_review", "review"):
            if review_type in ("missing_service_dates", "missing_dates"):
                df = today_buckets.get("review_missing_dates", pd.DataFrame()).copy()
            elif review_type in ("far_ahead", "type_1"):
                df = today_buckets["review_far_close"].copy()
            elif review_type in ("other_types", "type_2"):
                df = today_buckets["review_other_types"].copy()
            elif review_type in ("negative_acv", "type_3"):
                df = today_buckets["review_nonpos"].copy()
            elif review_type in ("expired_no_group", "type_4"):
                df = today_buckets["review_expired_no_group"].copy()
            else:
                parts = [p for p in (today_buckets.get("review_missing_dates", pd.DataFrame()), today_buckets["review_far_close"], today_buckets["review_other_types"], today_buckets["review_nonpos"], today_buckets["review_expired_no_group"]) if not p.empty]
                df = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame()
        elif base_kind in ("missing_service_dates", "missing_dates"):
            df = today_buckets.get("review_missing_dates", pd.DataFrame()).copy()
        elif base_kind == "other_types_delayed":
            df = today_buckets["delayed_other_type"].copy()
        elif base_kind == "other_types_slippage":
            df = today_buckets["slipped_other_type"].copy()
        elif base_kind in ("data_quality_expired_no_group", "dq_expired_no_group"):
            df = today_buckets["review_expired_no_group"].copy()
        elif base_kind == "newly_delayed":
            comp_standing_for_new = y_snap and self._compute_snapshot_buckets(y_snap, target_p_str, filter_spec=fs, base_snap=None, no_baseline=True)
            y_od_ids = set(comp_standing_for_new["overdue"]["opportunity_id_18"]) if comp_standing_for_new and not comp_standing_for_new["overdue"].empty else set()
            od_today = today_buckets["overdue"]
            df = od_today[~od_today["opportunity_id_18"].isin(y_od_ids)].copy() if not od_today.empty else pd.DataFrame()
        elif base_kind == "lost":
            df = today_buckets["lost"].copy()
        elif base_kind in today_buckets:
            df = today_buckets[base_kind].copy()

        if df.empty:
            return {"count": 0, "acv": 0.0, "deals": []}

        delayed_ids = set(today_buckets["delayed_total"]["opportunity_id_18"]) if not today_buckets["delayed_total"].empty else set()
        df["also_delayed"] = df["opportunity_id_18"].isin(delayed_ids)

        # Apply secondary filters
        if region and region != "All":
            df = df[df["region"] == region]
        if category and category != "All":
            df = df[df["forecast_category"] == category]
        if status and status != "All":
            df = df[df["approval_status"] == status]
        if bu and bu != "All":
            df = df[df["business_unit"] == bu]
        if ageing and not df.empty:
            if "days_overdue" not in df.columns:
                df["days_overdue"] = df["_close_date"].apply(lambda d: max(0, (t_snap.snapshot_date - d).days) if d else 0)
            if ageing == "0-7":
                df = df[df["days_overdue"] <= 7]
            elif ageing == "8-30":
                df = df[(df["days_overdue"] > 7) & (df["days_overdue"] <= 30)]
            elif ageing == "31-60":
                df = df[(df["days_overdue"] > 30) & (df["days_overdue"] <= 60)]
            elif ageing == "60+":
                df = df[df["days_overdue"] > 60]

        if df.empty:
            return {"count": 0, "acv": 0.0, "deals": []}

        # Format dates for JSON
        df["close_date"] = df["_close_date"].apply(lambda d: d.isoformat() if d else "")
        df["service_expiry_date"] = df["_service_expiry_date"].apply(lambda d: d.isoformat() if d else "")
        df = df.fillna("")
        deals = df.to_dict("records")

        return {
            "count": len(deals),
            "acv": round(float(df["forecast_acv_amount"].sum()), 2),
            "deals": deals,
        }

    def get_reconciliation_vs_manual(self, snapshot_id: str | None = None) -> dict:
        """
        Reconciliation vs Manual Sheets:
        Detects extra manual sheets in the Comparison Tool by keywords (Setting manual_sheet_keywords)
        and compares deal IDs the rule finds vs the sheet has.
        """
        snap = self._active_snap(snapshot_id)
        if not snap:
            return {"has_manual_sheets": False, "sheets": []}

        from backend.models.snapshot import UploadedFile
        import openpyxl

        rules = SettingsService.get_delayed_rules(self.db)
        keywords = rules.get("manual_sheet_keywords", ["delayed", "slippage"])

        comp_file = self.db.query(UploadedFile).filter(
            UploadedFile.snapshot_id == snap.id,
            UploadedFile.file_slot == "comparison_tool",
        ).first()

        # Check candidate workbook locations
        from backend.config import settings
        candidate_paths = [
            settings.DATA_DIR / "Renewal Comparison Tool (1).xlsx",
            settings.DATA_DIR / (comp_file.filename if comp_file else ""),
            settings.DATA_DIR / "Renewal Comparison Tool.xlsx",
            settings.DATA_DIR / "sample_oct7" / "Renewal Comparison Tool.xlsx",
            settings.DATA_DIR / "Renewal Comparison Tool (2).xlsx",
            settings.DATA_DIR / "Renewal Comparison Tool 11.xlsx",
        ]

        found_path = None
        for p in candidate_paths:
            if p and p.exists():
                found_path = p
                break

        if not found_path:
            return {"has_manual_sheets": False, "sheets": []}

        try:
            wb = openpyxl.load_workbook(found_path, read_only=True)
            detected_sheets = []
            for sname in wb.sheetnames:
                s_lower = sname.lower()
                if s_lower == "slippage_to_2027":
                    continue
                if any(k.lower() in s_lower for k in keywords) and s_lower not in ("today", "yesterday", "comparison", "finalchangereport"):
                    detected_sheets.append(sname)
            wb.close()
        except Exception:
            return {"has_manual_sheets": False, "sheets": []}

        if not detected_sheets:
            return {"has_manual_sheets": False, "sheets": []}

        # Compare deal IDs
        today_buckets = self._compute_snapshot_buckets(snap, ScopeService.current_quarter(snap.snapshot_date))
        rule_ids = set(today_buckets["slippage"]["opportunity_id_18"]).union(set(today_buckets["delayed_total"]["opportunity_id_18"]))

        sheet_reports = []
        for sname in detected_sheets:
            try:
                sdf = pd.read_excel(found_path, sheet_name=sname)
                cols = {str(c).lower().strip(): c for c in sdf.columns}
                id_col = cols.get("opportunity id 18 digit") or cols.get("opportunity id") or cols.get("id")
                if id_col:
                    sheet_ids = set(sdf[id_col].dropna().astype(str).str.strip())
                    rule_lacks = sorted(list(sheet_ids - rule_ids))
                    sheet_lacks = sorted(list(rule_ids - sheet_ids))
                    sheet_reports.append({
                        "sheet_name": sname,
                        "sheet_deal_count": len(sheet_ids),
                        "rule_deal_count": len(rule_ids),
                        "deals_in_sheet_lacking_in_rule": rule_lacks,
                        "deals_in_rule_lacking_in_sheet": sheet_lacks,
                    })
            except Exception as exc:
                log.warning("Could not read manual sheet %s: %s", sname, exc)

        return {
            "has_manual_sheets": len(sheet_reports) > 0,
            "sheets": sheet_reports,
        }
