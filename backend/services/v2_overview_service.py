"""
V2 Overview Service — powers Tab 1 (Overview / Dashboard).

Data slice: opportunities scoped by ScopeService (period derived from snapshot date),
deduped by opportunity_id_18 (multiple snapshots may contain the same opp; we always use
the LATEST record for a given opp_id within the active snapshot).

Deleted/Lost: INCLUDED by default (matches Excel pivots).
Movements: computed by diffing two scoped snapshots by Opportunity ID —
  NOT from change_logs (unscoped, only exists for yesterday).
Blank category: treated as its own column alongside Closed/Commit/Best Case/Pipeline.
Slippage: opportunities whose close date moved beyond the target period.
Region mapping: EXACT match on revised_sub_region value.
"""
from __future__ import annotations

import logging
from datetime import date
from typing import Optional

import pandas as pd
from sqlalchemy.orm import Session

from backend.models.opportunity import Opportunity
from backend.models.snapshot import UploadSnapshot
from backend.services.context import UserContext
from backend.services.scopes import ScopeService


def _sum(df: pd.DataFrame, col: str) -> float:
    if df.empty or col not in df.columns:
        return 0.0
    return float(df[col].sum())

log = logging.getLogger(__name__)

# ── Region normalisation (EXACT match as specified) ──────────────────────────
REGION_MAP: dict[str, str] = {
    "Europe":        "Europe",
    "APAC":          "APAC",
    "AFRICA":        "Africa",
    "MENA":          "Middle East and North Africa",
    "NAMR":          "North America",
    "South America": "LATAM",
}
CANONICAL_REGIONS = list(REGION_MAP.values())  # preserves insertion order
ALL_FC = ["Closed", "Commit", "Best Case", "Pipeline", "Blank"]
APPROVAL_STATUSES = ["Approved", "Pending Approval", "Blank", "Rejected"]


def _norm_approval(s: str | None) -> str:
    if not s or str(s).strip() in ("", "nan", "None", "Blank"):
        return "Blank"
    s = s.strip()
    if s in ("Approved", "Approved - 2nd"):
        return "Approved"
    if s in ("Pending Approval", "Pending-Approval"):
        return "Pending Approval"
    return s  # Rejected or anything else


def _norm_fc(s: str | None) -> str:
    if not s or str(s).strip() in ("", "nan", "None"):
        return "Blank"
    return s.strip()


def _norm_region(revised_sub_region: str | None) -> str:
    """Exact-match region mapping; returns 'Other / Unmapped' if empty/null, or preserves unmapped region."""
    if not revised_sub_region or str(revised_sub_region).strip() in ("", "nan", "None"):
        return "Other / Unmapped"
    s = str(revised_sub_region).strip()
    if s in REGION_MAP:
        return REGION_MAP[s]
    if s in CANONICAL_REGIONS:
        return s
    return s


def _opps_to_df(opps: list[Opportunity]) -> pd.DataFrame:
    if not opps:
        return pd.DataFrame()
    records = []
    for o in opps:
        records.append({
            "opportunity_id_18": o.opportunity_id_18 or "",
            "opportunity_name":  o.opportunity_name or "",
            "account_name":      o.account_name or "",
            "revised_sub_region": o.revised_sub_region or "",
            "canonical_region":   _norm_region(o.revised_sub_region),
            "business_unit_primary": o.business_unit_primary or "",
            "forecast_category":  _norm_fc(o.forecast_category),
            "forecast_acv_amount": float(o.forecast_acv_amount or 0),
            "approval_status":    _norm_approval(o.approval_status),
            "close_date":         o.close_date,
            "close_year":         o.close_date.year if o.close_date else None,
            "is_deleted_or_lost": bool(o.is_deleted_or_lost),
            "fiscal_period":      o.fiscal_period or "",
            "sales_type":         o.sales_type or "",
        })
    return pd.DataFrame(records)


class V2OverviewService:
    def __init__(self, db: Session):
        self.db = db

    # ── snapshot helpers ──────────────────────────────────────────────────────

    def _active_snap(self, as_of: str | None = None) -> UploadSnapshot | None:
        q = self.db.query(UploadSnapshot)
        if as_of:
            by_id = q.filter(UploadSnapshot.id == as_of).first()
            if by_id:
                return by_id
            try:
                from datetime import date
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
        return (
            q.filter(UploadSnapshot.is_active_today == True)  # noqa: E712
            .order_by(UploadSnapshot.snapshot_date.desc())
            .first()
        )

    def _snap_by_date(self, d: date) -> UploadSnapshot | None:
        return (
            self.db.query(UploadSnapshot)
            .filter(UploadSnapshot.snapshot_date == d)
            .first()
        )

    def _opp_to_deal_dict(self, o: Opportunity) -> dict:
        raw_type = (o.extra_attributes or {}).get("Type") or (o.extra_attributes or {}).get("type") or o.sales_type or ""
        type_code = ScopeService.extract_type_code(raw_type)
        return {
            "id": o.opportunity_id_18 or o.id,
            "opportunity_id_18": o.opportunity_id_18,
            "opportunity_name": o.opportunity_name,
            "account_name": o.account_name,
            "forecast_category": o.forecast_category,
            "forecast_acv_amount": float(o.forecast_acv_amount or 0.0),
            "sub_region": o.revised_sub_region or o.sub_region,
            "region": o.revised_sub_region or o.sub_region,
            "business_unit_primary": o.business_unit_primary,
            "business_unit": o.business_unit_primary,
            "approval_status": o.approval_status,
            "type": raw_type,
            "type_code": type_code,
            "close_date": o.close_date.isoformat() if hasattr(o.close_date, "isoformat") else str(o.close_date) if o.close_date else None,
            "owner": o.opportunity_owner,
            "opportunity_owner": o.opportunity_owner,
        }

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
        res = ScopeService.resolve(fs, snapshot=snap, as_of_date=eff_date, db=self.db)
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
        from datetime import timedelta
        # Try yesterday_date attribute first, then date-1
        if getattr(snap, "yesterday_date", None):
            s = self._snap_by_date(snap.yesterday_date)
            if s:
                return s
        return self._snap_by_date(snap.snapshot_date - timedelta(days=1))

    def _lastweek_snap(self, snap: UploadSnapshot) -> UploadSnapshot | None:
        from datetime import timedelta
        return self._snap_by_date(snap.snapshot_date - timedelta(days=7))

    # ── core aggregation helpers ──────────────────────────────────────────────

    def _category_summary(self, df: pd.DataFrame) -> dict:
        """Count + ACV per forecast category including Blank and any dynamic/new categories (Addendum C)."""
        result = {fc: {"count": 0, "acv": 0.0} for fc in ALL_FC}
        if df.empty or "forecast_category" not in df.columns:
            return result
        
        # Standard ALL_FC
        for fc in ALL_FC:
            sub = df[df["forecast_category"] == fc]
            result[fc] = {
                "count": len(sub),
                "acv": round(_sum(sub, "forecast_acv_amount"), 2),
            }
        
        # Dynamic / new categories (Addendum C: new category gets its own entry/card)
        all_unique = df["forecast_category"].dropna().unique()
        for cat in all_unique:
            cat_str = str(cat).strip()
            if cat_str and cat_str not in result:
                sub = df[df["forecast_category"] == cat_str]
                result[cat_str] = {
                    "count": len(sub),
                    "acv": round(_sum(sub, "forecast_acv_amount"), 2),
                }
        return result

    def _movements(
        self,
        today_df: pd.DataFrame,
        prev_df: pd.DataFrame,
        today_all_df: pd.DataFrame,
        target_fp: str,
    ) -> dict:
        """
        Compute forecast category and approval movements by diffing two scoped DataFrames.
        Joins on opportunity_id_18.
        Returns positive_moves, negative_moves, approval_moves lists.
        """
        if today_df.empty or prev_df.empty:
            return {
                "positive": [], "negative": [], "approval": [],
                "slippage_to_2027": {"count": 0, "acv": 0.0},
                "slipped_later_quarter": {"count": 0, "acv": 0.0},
                "slipped_earlier": {"count": 0, "acv": 0.0},
            }

        t = today_df.set_index("opportunity_id_18")
        p = prev_df.set_index("opportunity_id_18")
        common = t.index.intersection(p.index)

        positive: list[dict] = []
        negative: list[dict] = []
        approval_moves: list[dict] = []

        # Config order for category movements:
        CATEGORY_CONFIG_ORDER = ["Closed", "Commit", "Best Case", "Pipeline", "Blank"]
        APPROVAL_CONFIG_ORDER = ["Approved", "Pending Approval", "Blank", "Rejected"]

        # Derive categories actually present in data
        present_cats = set()
        if not today_df.empty and "forecast_category" in today_df.columns:
            present_cats.update(today_df["forecast_category"].dropna().unique())
        if not prev_df.empty and "forecast_category" in prev_df.columns:
            present_cats.update(prev_df["forecast_category"].dropna().unique())

        mapped_present = set()
        for c in present_cats:
            c_str = str(c).strip()
            if c_str in CATEGORY_CONFIG_ORDER:
                mapped_present.add(c_str)
            elif c_str:
                mapped_present.add("Other")

        ordered_cats = [c for c in CATEGORY_CONFIG_ORDER if c in mapped_present]
        if "Other" in mapped_present and "Other" not in ordered_cats:
            ordered_cats.append("Other")

        # Standard forecast ladder from config order (preserving Closed for upgrades to Closed so both tables align)
        ladder = [c for c in CATEGORY_CONFIG_ORDER if c in ("Closed", "Commit", "Best Case", "Pipeline")]
        for c in ordered_cats:
            if c not in ladder and c != "Blank":
                ladder.append(c)

        # Derive adjacent transition pairs dynamically
        pos_pairs = [(ladder[i+1], ladder[i]) for i in range(len(ladder)-1)]
        commit_idx = ladder.index("Commit") if "Commit" in ladder else 0
        neg_pairs = [(ladder[i], ladder[i+1]) for i in range(commit_idx, min(commit_idx + 2, len(ladder)-1))]

        pos_buckets: dict[tuple, list] = {m: [] for m in pos_pairs}
        neg_buckets: dict[tuple, list] = {m: [] for m in neg_pairs}
        app_buckets: dict[tuple, list] = {}

        def _cat_rank(c: str) -> int:
            return CATEGORY_CONFIG_ORDER.index(c) if c in CATEGORY_CONFIG_ORDER else 99

        for opp_id in common:
            tr = t.loc[opp_id]
            pr = p.loc[opp_id]
            tr_row = tr if isinstance(tr, pd.Series) else tr.iloc[0]
            pr_row = pr if isinstance(pr, pd.Series) else pr.iloc[0]

            fc_now  = str(tr_row["forecast_category"]) if pd.notna(tr_row["forecast_category"]) else "Blank"
            fc_prev = str(pr_row["forecast_category"]) if pd.notna(pr_row["forecast_category"]) else "Blank"
            acv     = float(tr_row["forecast_acv_amount"]) if pd.notna(tr_row["forecast_acv_amount"]) else 0.0
            name    = str(tr_row["opportunity_name"]) if pd.notna(tr_row["opportunity_name"]) else ""
            acc_name = str(tr_row["account_name"]) if pd.notna(tr_row["account_name"]) else ""
            bu      = str(tr_row["business_unit_primary"]) if pd.notna(tr_row["business_unit_primary"]) else ""
            region  = str(tr_row["canonical_region"]) if pd.notna(tr_row["canonical_region"]) else ""
            ap_now  = str(tr_row["approval_status"]) if pd.notna(tr_row["approval_status"]) else "Blank"
            ap_prev = str(pr_row["approval_status"]) if pd.notna(pr_row["approval_status"]) else "Blank"
            c_date  = tr_row["close_date"]
            close_date_str = (c_date.isoformat() if hasattr(c_date, "isoformat") else str(c_date)[:10]) if (c_date is not None and not pd.isna(c_date)) else None

            base_deal = {
                "opportunity_id_18": opp_id,
                "id": opp_id,
                "opportunity_name": name,
                "account_name": acc_name,
                "forecast_acv_amount": acv,
                "acv": acv,
                "close_date": close_date_str,
                "business_unit_primary": bu,
                "business_unit": bu,
                "forecast_category": fc_now,
                "approval_status": ap_now,
                "region": region,
                "sub_region": region,
            }

            fc_prev_mapped = fc_prev if fc_prev in CATEGORY_CONFIG_ORDER else "Other"
            fc_now_mapped = fc_now if fc_now in CATEGORY_CONFIG_ORDER else "Other"

            if fc_prev != fc_now:
                deal = dict(base_deal)
                deal["from_category"] = fc_prev
                deal["to_category"] = fc_now
                move_key = (fc_prev_mapped, fc_now_mapped)
                if move_key in pos_buckets:
                    pos_buckets[move_key].append(deal)
                elif move_key in neg_buckets:
                    neg_buckets[move_key].append(deal)
                elif _cat_rank(fc_now_mapped) < _cat_rank(fc_prev_mapped):
                    if move_key not in pos_buckets:
                        pos_buckets[move_key] = []
                    pos_buckets[move_key].append(deal)
                elif _cat_rank(fc_now_mapped) > _cat_rank(fc_prev_mapped):
                    if move_key not in neg_buckets:
                        neg_buckets[move_key] = []
                    neg_buckets[move_key].append(deal)

            if ap_now != ap_prev:
                ap_prev_mapped = ap_prev if ap_prev in APPROVAL_CONFIG_ORDER else "Other"
                ap_now_mapped = ap_now if ap_now in APPROVAL_CONFIG_ORDER else "Other"
                ak = (ap_prev_mapped, ap_now_mapped)
                if ak not in app_buckets:
                    app_buckets[ak] = []
                deal = dict(base_deal)
                deal["from_status"] = ap_prev
                deal["to_status"] = ap_now
                app_buckets[ak].append(deal)

        def _bucket_summary(bucket: list[dict]) -> dict:
            return {
                "count": len(bucket),
                "acv": round(sum(d["forecast_acv_amount"] for d in bucket), 2),
                "deals": bucket,
            }

        for (f, t_), deals in pos_buckets.items():
            positive.append({
                "from_category": f, "to_category": t_,
                **_bucket_summary(deals),
            })
        for (f, t_), deals in neg_buckets.items():
            negative.append({
                "from_category": f, "to_category": t_,
                **_bucket_summary(deals),
            })

        # Sort approval moves according to APPROVAL_CONFIG_ORDER
        def _ap_sort_key(k: tuple[str, str]) -> tuple[int, int]:
            from_st, to_st = k
            idx_from = APPROVAL_CONFIG_ORDER.index(from_st) if from_st in APPROVAL_CONFIG_ORDER else 99
            idx_to = APPROVAL_CONFIG_ORDER.index(to_st) if to_st in APPROVAL_CONFIG_ORDER else 99
            return (idx_from, idx_to)

        for (fa, ta) in sorted(app_buckets.keys(), key=_ap_sort_key):
            deals = app_buckets[(fa, ta)]
            approval_moves.append({
                "from_status": fa, "to_status": ta,
                **_bucket_summary(deals),
            })

        # New Slippage logic
        def _parse_fp(fp: str):
            if not fp or '-' not in fp: return (0, 0)
            q, y = fp.split('-')
            return (int(y), int(q.replace('Q', '')))

        target_parsed = _parse_fp(target_fp)
        
        slipped_next_year_deals = []
        slipped_later_quarter_same_year_deals = []
        slipped_earlier_quarter_deals = []

        if not prev_df.empty and not today_all_df.empty:
            t_all = today_all_df.set_index("opportunity_id_18")
            for opp_id in p.index:
                if opp_id in t_all.index:
                    t_opp = t_all.loc[opp_id]
                    t_fp = str(t_opp["fiscal_period"] if isinstance(t_opp, pd.Series) else t_opp.iloc[0]["fiscal_period"])
                    if not t_fp or '-' not in t_fp: continue
                    t_parsed = _parse_fp(t_fp)
                    
                    deal = {
                        "opportunity_id_18": opp_id,
                        "opportunity_name": str(t_opp["opportunity_name"] if isinstance(t_opp, pd.Series) else t_opp.iloc[0]["opportunity_name"]),
                        "account_name": str(t_opp["account_name"] if isinstance(t_opp, pd.Series) else t_opp.iloc[0]["account_name"]),
                        "canonical_region": str(t_opp["canonical_region"] if isinstance(t_opp, pd.Series) else t_opp.iloc[0]["canonical_region"]),
                        "forecast_category": str(t_opp["forecast_category"] if isinstance(t_opp, pd.Series) else t_opp.iloc[0]["forecast_category"]),
                        "forecast_acv_amount": float(t_opp["forecast_acv_amount"] if isinstance(t_opp, pd.Series) else t_opp.iloc[0]["forecast_acv_amount"]),
                        "approval_status": str(t_opp["approval_status"] if isinstance(t_opp, pd.Series) else t_opp.iloc[0]["approval_status"]),
                        "business_unit_primary": str(t_opp["business_unit_primary"] if isinstance(t_opp, pd.Series) else t_opp.iloc[0]["business_unit_primary"]),
                        "fiscal_period": t_fp,
                        "close_date": (t_opp["close_date"].isoformat() if hasattr(t_opp["close_date"], "isoformat") else str(t_opp["close_date"])) if (t_opp["close_date"] is not None and not pd.isna(t_opp["close_date"])) else None,
                    }

                    
                    if t_parsed[0] > target_parsed[0]:
                        slipped_next_year_deals.append(deal)
                    elif t_parsed[0] == target_parsed[0] and t_parsed[1] > target_parsed[1]:
                        slipped_later_quarter_same_year_deals.append(deal)
                    elif t_parsed < target_parsed:
                        slipped_earlier_quarter_deals.append(deal)

        slippage = {
            "label": "Slipped to next year",
            "count": len(slipped_next_year_deals),
            "acv": round(sum(d["forecast_acv_amount"] for d in slipped_next_year_deals), 2),
            "deals": slipped_next_year_deals,
        }
        
        later_q = {
            "label": "Slipped to a later quarter, same year",
            "count": len(slipped_later_quarter_same_year_deals),
            "acv": round(sum(d["forecast_acv_amount"] for d in slipped_later_quarter_same_year_deals), 2),
            "deals": slipped_later_quarter_same_year_deals,
        }
        
        earlier_q = {
            "label": "Moved to earlier quarter",
            "count": len(slipped_earlier_quarter_deals),
            "acv": round(sum(d["forecast_acv_amount"] for d in slipped_earlier_quarter_deals), 2),
            "deals": slipped_earlier_quarter_deals,
        }

        # Append slippage as the third negative row
        negative.append(slippage)

        return {
            "positive": positive,
            "negative": negative,
            "approval": approval_moves,
            "slippage_to_2027": slippage,
            "slipped_later_quarter": later_q,
            "slipped_earlier": earlier_q,
        }

    # ── public API ────────────────────────────────────────────────────────────

    def get_summary(
        self,
        ctx: UserContext,
        exclude_deleted: bool = False,
        as_of: str | None = None,
        filter_spec: Optional[ScopeService.FilterSpec] = None,
    ) -> dict:
        """
        Main Overview summary:
        - Section 1: Total ACV + count + Δ yesterday + Δ last week
        - Section 2: 5 category cards (Closed/Commit/BC/Pipeline/Blank)
        - Section 3: Slippage
        - Snapshot metadata (date, files, uploaded_at)
        """
        from backend.services.scopes import FilterSpec
        fs = filter_spec.model_copy() if filter_spec else FilterSpec()
        if as_of:
            fs.as_of = as_of
        if exclude_deleted:
            fs.include_deleted_lost = False

        snap = self._active_snap(fs.as_of)
        if snap is None:
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

        total_count = len(df)
        total_acv   = round(_sum(df, "forecast_acv_amount"), 2) if not df.empty else 0.0
        cats = self._category_summary(df)

        target_fp = res.resolved_quarter
        data_slice = res.data_slice

        # ── Other types excluded note ─────────────────────────────────────────
        other_types_excluded = None
        if res.effective_types is not None:
            base_opps = self.db.query(Opportunity).filter(
                Opportunity.snapshot_id == snap.id,
                *res.base_conditions
            ).all()
            excluded_opps = [
                o for o in base_opps
                if ScopeService.extract_type_code(
                    (o.extra_attributes or {}).get("Type") or (o.extra_attributes or {}).get("type")
                ) not in res.effective_types
            ]
            if excluded_opps:
                exc_cnt = len(excluded_opps)
                exc_acv = round(sum(float(o.forecast_acv_amount or 0.0) for o in excluded_opps), 2)
                other_types_excluded = {
                    "count": exc_cnt,
                    "acv": exc_acv,
                    "note": f"Other types excluded: {exc_cnt} deals / ${exc_acv:,.2f}",
                    "deals": [self._opp_to_deal_dict(o) for o in excluded_opps],
                }

        # ── Delayed / Slippage summary tying directly to Delayed page ──────────
        from backend.services.v2_delayed_service import V2DelayedService
        delayed_svc = V2DelayedService(self.db)
        del_sum = delayed_svc.get_summary(as_of=fs.as_of or snap.id, filter_spec=fs)

        del_overall = del_sum.get("total", {"count": 0, "acv": 0.0})
        del_slipped = del_sum.get("slipped", {"count": 0, "acv": 0.0})
        del_overdue = del_sum.get("overdue", {"count": 0, "acv": 0.0})
        del_later = del_sum.get("later_close", {"count": 0, "acv": 0.0})
        del_rule = del_sum.get("rule_text", "All renewals in active quarter that are overdue, slipped, or postponed.")

        del_lost = del_sum.get("lost", {"count": 0, "acv": 0.0})
        slippage_data = {
            "overall": {
                "count": del_overall.get("count"),
                "acv": round(float(del_overall.get("acv")), 2) if del_overall.get("acv") is not None else None,
                "baseline_label": del_overall.get("baseline_label", "Total Delayed"),
                "delta_yesterday": del_overall.get("delayed_vs_yesterday"),
                "delta_lastweek": del_overall.get("delayed_vs_lastweek"),
            },
            "categories": {
                "slipped": {
                    "label": "Slipped to Next Year / Quarter",
                    "count": del_slipped.get("count"),
                    "acv": round(float(del_slipped.get("acv")), 2) if del_slipped.get("acv") is not None else None,
                    "baseline_label": del_slipped.get("baseline_label"),
                    "delta_yesterday": del_slipped.get("delayed_vs_yesterday"),
                    "delta_lastweek": del_slipped.get("delayed_vs_lastweek"),
                },
                "overdue": {
                    "label": "Overdue Deals",
                    "count": del_overdue.get("count"),
                    "acv": round(float(del_overdue.get("acv")), 2) if del_overdue.get("acv") is not None else None,
                    "baseline_label": del_overdue.get("baseline_label", "Current"),
                    "delta_yesterday": del_overdue.get("delayed_vs_yesterday"),
                    "delta_lastweek": del_overdue.get("delayed_vs_lastweek"),
                },
                "later_close": {
                    "label": "Later Close Date (Postponed)",
                    "count": del_later.get("count"),
                    "acv": round(float(del_later.get("acv")), 2) if del_later.get("acv") is not None else None,
                    "baseline_label": del_later.get("baseline_label"),
                    "delta_yesterday": del_later.get("delayed_vs_yesterday"),
                    "delta_lastweek": del_later.get("delayed_vs_lastweek"),
                },
                "lost": {
                    "label": "Lost / Removed",
                    "count": del_lost.get("count"),
                    "acv": round(float(del_lost.get("acv")), 2) if del_lost.get("acv") is not None else None,
                    "baseline_label": del_lost.get("baseline_label"),
                    "delta_yesterday": del_lost.get("delayed_vs_yesterday"),
                    "delta_lastweek": del_lost.get("delayed_vs_lastweek"),
                },
            },
            "rule_text": del_rule,
            "is_future": del_sum.get("is_future", False),
            "period_type": del_sum.get("period_type"),
            "period_start_baseline_label": del_sum.get("period_start_baseline_label"),
            "period_start_baseline_date": del_sum.get("period_start_baseline_date"),
            "period_start_is_partial": del_sum.get("period_start_is_partial", False),
            "yesterday_date": del_sum.get("yesterday_date"),
            "lastweek_date": del_sum.get("lastweek_date"),
        }

        # Legacy slippage count for fallback
        _, q_end_date = ScopeService.quarter_bounds(target_fp)
        slip_df = df[pd.to_datetime(df["close_date"], errors="coerce") > pd.Timestamp(q_end_date)] if (not df.empty and "close_date" in df.columns) else pd.DataFrame()
        leg_cnt = del_slipped.get("count") if del_slipped.get("count") is not None else len(slip_df)
        leg_acv = del_slipped.get("acv") if del_slipped.get("acv") is not None else _sum(slip_df, "forecast_acv_amount")
        slippage = {
            "count": leg_cnt,
            "acv": round(float(leg_acv or 0.0), 2),
        }

        # ── Yesterday deltas ──────────────────────────────────────────────────
        yest_snap = self._yesterday_snap(snap)
        delta_yesterday = None
        cats_delta_yesterday = None
        slip_delta_yesterday = None
        if yest_snap:
            y_opps, _ = self._scoped_opps(yest_snap, filter_spec=fs, target_date=eff_as_of_date)
            y_df   = _opps_to_df(y_opps)
            y_total_count = len(y_df)
            y_total_acv   = round(_sum(y_df, "forecast_acv_amount"), 2) if not y_df.empty else 0.0
            y_cats = self._category_summary(y_df)
            y_slip_df = y_df[pd.to_datetime(y_df["close_date"]).dt.date > q_end_date] if not y_df.empty else pd.DataFrame()
            delta_yesterday = {
                "count": total_count - y_total_count,
                "acv":   round(total_acv - y_total_acv, 2),
                "snapshot_date": yest_snap.snapshot_date.isoformat(),
            }
            cats_delta_yesterday = {
                fc: {
                    "count": cats[fc]["count"] - y_cats[fc]["count"],
                    "acv":   round(cats[fc]["acv"] - y_cats[fc]["acv"], 2),
                }
                for fc in ALL_FC
            }
            slip_delta_yesterday = {
                "count": slippage["count"] - len(y_slip_df),
                "acv":   round(slippage["acv"] - _sum(y_slip_df, "forecast_acv_amount"), 2),
            }

        # ── Last-week deltas ──────────────────────────────────────────────────
        lw_snap = self._lastweek_snap(snap)
        delta_lastweek = None
        cats_delta_lastweek = None
        slip_delta_lastweek = None
        if lw_snap:
            lw_opps, _ = self._scoped_opps(lw_snap, filter_spec=fs, target_date=eff_as_of_date)
            lw_df   = _opps_to_df(lw_opps)
            lw_total_count = len(lw_df)
            lw_total_acv   = round(_sum(lw_df, "forecast_acv_amount"), 2) if not lw_df.empty else 0.0
            lw_cats = self._category_summary(lw_df)
            lw_slip_df = lw_df[pd.to_datetime(lw_df["close_date"]).dt.date > q_end_date] if not lw_df.empty else pd.DataFrame()
            delta_lastweek = {
                "count": total_count - lw_total_count,
                "acv":   round(total_acv - lw_total_acv, 2),
                "snapshot_date": lw_snap.snapshot_date.isoformat(),
            }
            cats_delta_lastweek = {
                fc: {
                    "count": cats[fc]["count"] - lw_cats[fc]["count"],
                    "acv":   round(cats[fc]["acv"] - lw_cats[fc]["acv"], 2),
                }
                for fc in ALL_FC
            }
            slip_delta_lastweek = {
                "count": slippage["count"] - len(lw_slip_df),
                "acv":   round(slippage["acv"] - _sum(lw_slip_df, "forecast_acv_amount"), 2),
            }

        other_count = 0
        if not df.empty and "canonical_region" in df.columns:
            other_count = int(df["canonical_region"].isin(["Other", "Other / Unmapped"]).sum())

        # Proposal confirmation totals for summary
        prop_totals = {
            "approved_count": int((df["approval_status"] == "Approved").sum()) if not df.empty and "approval_status" in df.columns else 0,
            "pending_count":  int((df["approval_status"] == "Pending Approval").sum()) if not df.empty and "approval_status" in df.columns else 0,
            "blank_count":    int((df["approval_status"] == "Blank").sum()) if not df.empty and "approval_status" in df.columns else 0,
            "approved_acv":   _sum(df[df["approval_status"] == "Approved"] if not df.empty and "approval_status" in df.columns else pd.DataFrame(), "forecast_acv_amount"),
            "pending_acv":    _sum(df[df["approval_status"] == "Pending Approval"] if not df.empty and "approval_status" in df.columns else pd.DataFrame(), "forecast_acv_amount"),
            "blank_acv":      _sum(df[df["approval_status"] == "Blank"] if not df.empty and "approval_status" in df.columns else pd.DataFrame(), "forecast_acv_amount"),
        }

        # ── B8 Coverage: Commit + Best Case % of Total ACV ────────────────────
        c_df = df[df["forecast_category"] == "Commit"] if not df.empty else pd.DataFrame()
        bc_df = df[df["forecast_category"] == "Best Case"] if not df.empty else pd.DataFrame()
        cov_deals = df[df["forecast_category"].isin(["Commit", "Best Case"])] if not df.empty else pd.DataFrame()
        cov_count = len(cov_deals)
        cov_acv = round(_sum(c_df, "forecast_acv_amount") + _sum(bc_df, "forecast_acv_amount"), 2)
        cov_pct = round(cov_acv / total_acv * 100, 2) if total_acv > 0 else 0.0

        cov_delta_yesterday_pp = None
        if yest_snap and not y_df.empty:
            y_tot_acv = _sum(y_df, "forecast_acv_amount")
            y_c = _sum(y_df[y_df["forecast_category"] == "Commit"], "forecast_acv_amount")
            y_bc = _sum(y_df[y_df["forecast_category"] == "Best Case"], "forecast_acv_amount")
            y_cov_pct = round((y_c + y_bc) / y_tot_acv * 100, 2) if y_tot_acv > 0 else 0.0
            cov_delta_yesterday_pp = round(cov_pct - y_cov_pct, 2)

        cov_delta_lastweek_pp = None
        if lw_snap and not lw_df.empty:
            lw_tot_acv = _sum(lw_df, "forecast_acv_amount")
            lw_c = _sum(lw_df[lw_df["forecast_category"] == "Commit"], "forecast_acv_amount")
            lw_bc = _sum(lw_df[lw_df["forecast_category"] == "Best Case"], "forecast_acv_amount")
            lw_cov_pct = round((lw_c + lw_bc) / lw_tot_acv * 100, 2) if lw_tot_acv > 0 else 0.0
            cov_delta_lastweek_pp = round(cov_pct - lw_cov_pct, 2)

        coverage = {
            "count": cov_count,
            "acv": cov_acv,
            "pct": cov_pct,
            "delta_yesterday_pp": cov_delta_yesterday_pp,
            "delta_lastweek_pp": cov_delta_lastweek_pp,
            "deal_ids": [str(d) for d in cov_deals["opportunity_id_18"]] if not cov_deals.empty else [],
        }

        # ── B7 Needs attention panel (up to settings.NEEDS_ATTENTION_MAX_ITEMS) ──────
        from datetime import timedelta
        from backend.config import settings
        window_days = getattr(settings, "NEEDS_ATTENTION_WINDOW_DAYS", 14)
        max_items = getattr(settings, "NEEDS_ATTENTION_MAX_ITEMS", 5)

        items = []
        category_summaries = {}
        seen_categories = set()

        def _add_item(item_dict):
            if item_dict["category_key"] not in seen_categories:
                seen_categories.add(item_dict["category_key"])
                items.append(item_dict)

        # 1. Commit deals not approved
        commit_unappr = df[(df["forecast_category"] == "Commit") & (df["approval_status"] != "Approved")].copy() if not df.empty else pd.DataFrame()
        if not commit_unappr.empty:
            commit_unappr = commit_unappr.sort_values(by="forecast_acv_amount", ascending=False)
            c_cnt = len(commit_unappr)
            c_tot_acv = round(float(_sum(commit_unappr, "forecast_acv_amount")), 2)
            top_c = commit_unappr.iloc[0]
            raw_app = str(top_c.get("approval_status", "")).strip()
            norm_app = "Not submitted" if raw_app in ("Blank", "Not submitted", "", "None") else raw_app
            category_summaries["commit_not_approved"] = {
                "count": c_cnt,
                "acv": c_tot_acv,
                "deal_ids": [str(d) for d in commit_unappr["opportunity_id_18"]],
            }
            _add_item({
                "category_key": "commit_not_approved",
                "category_label": "Commit not approved",
                "opportunity_id_18": str(top_c["opportunity_id_18"]),
                "opportunity_name": str(top_c["opportunity_name"]),
                "account_name": str(top_c["account_name"]),
                "acv": round(float(top_c["forecast_acv_amount"]), 2),
                "category_count": c_cnt,
                "category_acv": c_tot_acv,
                "badge": f"Commit · {norm_app}",
                "detail": f"{c_cnt} unapproved Commit deals totaling ${c_tot_acv:,.2f}",
                "kind": "commit_not_approved",
                "deal_ids": [str(d) for d in commit_unappr["opportunity_id_18"]],
            })

        # 2. Largest overdue deals across all renewals in snapshot
        all_opps_q = self.db.query(Opportunity).filter(
            Opportunity.snapshot_id == snap.id,
            Opportunity.sales_type == "Renewals",
        ).all()
        all_df = _opps_to_df(all_opps_q)
        overdue_df = pd.DataFrame()
        if not all_df.empty and "close_date" in all_df.columns:
            cd = pd.to_datetime(all_df["close_date"], errors="coerce").dt.date
            overdue_df = all_df[(cd < snap.snapshot_date) & (all_df["forecast_category"] != "Closed") & (~all_df["is_deleted_or_lost"])].copy()
            overdue_df = overdue_df.drop_duplicates(subset=["opportunity_id_18"], keep="last")
        if not overdue_df.empty:
            overdue_df = overdue_df.sort_values(by=["forecast_acv_amount", "opportunity_id_18"], ascending=[False, True])
            od_cnt = len(overdue_df)
            od_tot_acv = round(float(_sum(overdue_df, "forecast_acv_amount")), 2)
            top_od = overdue_df.iloc[0]
            top_od_date = pd.to_datetime(top_od["close_date"]).date() if top_od["close_date"] else snap.snapshot_date
            days_od = max(1, (snap.snapshot_date - top_od_date).days)
            category_summaries["overdue"] = {
                "count": od_cnt,
                "acv": od_tot_acv,
                "deal_ids": [str(d) for d in overdue_df["opportunity_id_18"]],
            }
            _add_item({
                "category_key": "overdue",
                "category_label": "Overdue deal",
                "opportunity_id_18": str(top_od["opportunity_id_18"]),
                "opportunity_name": str(top_od["opportunity_name"]),
                "account_name": str(top_od["account_name"]),
                "acv": round(float(top_od["forecast_acv_amount"]), 2),
                "category_count": od_cnt,
                "category_acv": od_tot_acv,
                "badge": f"{days_od}d past close date",
                "detail": f"{od_cnt} overdue deals totaling ${od_tot_acv:,.2f}",
                "kind": "overdue",
                "deal_ids": [str(d) for d in overdue_df["opportunity_id_18"]],
            })

        # 3. Biggest drop vs yesterday
        drops = []
        if yest_snap and not y_df.empty:
            t_map = {str(r["opportunity_id_18"]): r for _, r in df.iterrows()}
            p_map = {str(r["opportunity_id_18"]): r for _, r in y_df.iterrows()}
            for oid, pr in p_map.items():
                prev_acv = float(pr["forecast_acv_amount"] or 0)
                if oid not in t_map:
                    drops.append({
                        "opportunity_id_18": str(oid),
                        "opportunity_name": str(pr["opportunity_name"]),
                        "account_name": str(pr["account_name"]),
                        "drop_amount": round(prev_acv, 2),
                        "prev_acv": round(prev_acv, 2),
                        "current_acv": 0.0,
                        "forecast_category": str(pr["forecast_category"]),
                        "approval_status": str(pr["approval_status"]),
                        "sub_region": str(pr.get("canonical_region", "")),
                        "business_unit_primary": str(pr.get("business_unit_primary", "")),
                        "close_date": pr["close_date"].isoformat() if hasattr(pr["close_date"], "isoformat") else str(pr["close_date"]) if pr["close_date"] else None,
                        "reason": "Left period / dropped from forecast",
                    })
                else:
                    curr_acv = float(t_map[oid]["forecast_acv_amount"] or 0)
                    if prev_acv - curr_acv > 0.01:
                        drops.append({
                            "opportunity_id_18": str(oid),
                            "opportunity_name": str(pr["opportunity_name"]),
                            "account_name": str(pr["account_name"]),
                            "drop_amount": round(prev_acv - curr_acv, 2),
                            "prev_acv": round(prev_acv, 2),
                            "current_acv": round(curr_acv, 2),
                            "forecast_category": str(t_map[oid]["forecast_category"]),
                            "approval_status": str(t_map[oid]["approval_status"]),
                            "sub_region": str(t_map[oid].get("canonical_region", "")),
                            "business_unit_primary": str(t_map[oid].get("business_unit_primary", "")),
                            "close_date": t_map[oid]["close_date"].isoformat() if hasattr(t_map[oid]["close_date"], "isoformat") else str(t_map[oid]["close_date"]) if t_map[oid]["close_date"] else None,
                            "reason": f"ACV decreased (-${round(prev_acv - curr_acv, 2):,})",
                        })
        if drops:
            drops_sorted = sorted(drops, key=lambda x: x["drop_amount"], reverse=True)
            top_drop = drops_sorted[0]
            dr_count = len(drops)
            dr_acv = round(sum(d["drop_amount"] for d in drops), 2)
            category_summaries["biggest_drop"] = {
                "count": dr_count,
                "acv": dr_acv,
                "deal_ids": [d["opportunity_id_18"] for d in drops_sorted],
            }
            _add_item({
                "category_key": "biggest_drop",
                "category_label": "Biggest drop vs yesterday",
                "opportunity_id_18": top_drop["opportunity_id_18"],
                "opportunity_name": top_drop["opportunity_name"],
                "account_name": top_drop["account_name"],
                "acv": top_drop["drop_amount"],
                "category_count": dr_count,
                "category_acv": dr_acv,
                "badge": f"-${top_drop['drop_amount']:,.0f} vs yesterday",
                "detail": top_drop["reason"],
                "kind": "biggest_drop",
                "deal_ids": [d["opportunity_id_18"] for d in drops_sorted],
            })

        # 4. Deals closing within window_days with no approval
        closing_14d_df = pd.DataFrame()
        if not df.empty and "close_date" in df.columns:
            cd = pd.to_datetime(df["close_date"], errors="coerce")
            snap_ts = pd.Timestamp(snap.snapshot_date)
            closing_14d_df = df[
                (cd >= snap_ts) &
                (cd <= snap_ts + pd.Timedelta(days=window_days)) &
                (df["approval_status"] != "Approved") &
                (df["forecast_category"] != "Closed") &
                (~df["is_deleted_or_lost"])
            ].copy()
        if not closing_14d_df.empty:
            closing_14d_df = closing_14d_df.sort_values(by="forecast_acv_amount", ascending=False)
            cl_cnt = len(closing_14d_df)
            cl_tot_acv = round(float(_sum(closing_14d_df, "forecast_acv_amount")), 2)
            top_cl = closing_14d_df.iloc[0]
            raw_cl_app = str(top_cl.get("approval_status", "")).strip()
            norm_cl_app = "Not submitted" if raw_cl_app in ("Blank", "Not submitted", "", "None") else raw_cl_app
            top_cl_date = pd.to_datetime(top_cl["close_date"]).date() if top_cl["close_date"] else snap.snapshot_date
            days_to_close = max(0, (top_cl_date - snap.snapshot_date).days)
            category_summaries["closing_14d_unapproved"] = {
                "count": cl_cnt,
                "acv": cl_tot_acv,
                "deal_ids": [str(d) for d in closing_14d_df["opportunity_id_18"]],
            }
            _add_item({
                "category_key": "closing_14d_unapproved",
                "category_label": f"Closing within {window_days} days (no approval)",
                "opportunity_id_18": str(top_cl["opportunity_id_18"]),
                "opportunity_name": str(top_cl["opportunity_name"]),
                "account_name": str(top_cl["account_name"]),
                "acv": round(float(top_cl["forecast_acv_amount"]), 2),
                "category_count": cl_cnt,
                "category_acv": cl_tot_acv,
                "badge": f"Closes in {days_to_close}d · {norm_cl_app}",
                "detail": f"{cl_cnt} deals closing within {window_days}d unapproved totaling ${cl_tot_acv:,.2f}",
                "kind": "closing_14d_unapproved",
                "deal_ids": [str(d) for d in closing_14d_df["opportunity_id_18"]],
            })

        needs_attention = {
            "items": items[:max_items],
            "category_summaries": category_summaries,
            "total_items": len(items[:max_items]),
        }

        return {
            "snapshot_date":    snap.snapshot_date.isoformat(),
            "requested_as_of":  fs.as_of or snap.snapshot_date.isoformat(),
            "snapshot_id":      snap.id,
            "data_slice":       data_slice,
            "data_slice_key":   target_fp,
            "exclude_deleted":  not fs.include_deleted_lost,
            "other_region_count": other_count,
            "filters_applied":  res.filters_applied,
            "other_types_excluded": other_types_excluded,
            # Section 1
            "total": {
                "count": total_count,
                "acv":   total_acv,
                "delta_yesterday": delta_yesterday,
                "delta_lastweek":  delta_lastweek,
            },
            # B8 Coverage line
            "coverage": coverage,
            # B7 Needs attention panel
            "needs_attention": needs_attention,
            # Section 2 — category cards (standard ALL_FC + any dynamic new categories)
            "categories": {
                fc: {
                    **cats[fc],
                    "delta_yesterday": cats_delta_yesterday.get(fc) if cats_delta_yesterday else None,
                    "delta_lastweek":  cats_delta_lastweek.get(fc) if cats_delta_lastweek else None,
                }
                for fc in cats.keys()
            },
            # Section 3 — slippage & delayed renewals separated
            "slippage": slippage_data,
            "slippage_section": del_sum.get("slippage"),
            "delayed_renewals": del_sum.get("delayed_renewals"),
            "delayed_renewals_total": del_sum.get("delayed_renewals_total"),
            "needs_review": del_sum.get("needs_review"),
            "lost_card": del_sum.get("lost"),
            "slippage_total": del_sum.get("slippage_total"),
            "delayed_pct_of_quarter": del_sum.get("delayed_pct_of_quarter"),
            "slippage_pct_of_quarter": del_sum.get("slippage_pct_of_quarter"),
            "quarter_total_acv": del_sum.get("quarter_total_acv"),
            "proposal_confirmation_totals": prop_totals,
            "source_checks": {
                "total": len(snap.checks),
                "passed": sum(1 for c in snap.checks if c.status == "pass"),
                "failed": sum(1 for c in snap.checks if c.status == "fail"),
                "badge": "red" if any(c.status == "fail" for c in snap.checks) else ("green" if len(snap.checks) > 0 else "none"),
                "failed_items": [c.metric_name for c in snap.checks if c.status == "fail"],
            },
        }

    def get_movements(
        self,
        ctx: UserContext,
        compare: Optional[str] = None,
        exclude_deleted: bool = False,
        filter_spec: Optional[ScopeService.FilterSpec] = None,
    ) -> dict:
        """
        Section 4: Forecast Category Movement + Approval Movement.
        compare: 'yesterday' | 'last_week'
        """
        from backend.services.scopes import FilterSpec
        fs = filter_spec.model_copy() if filter_spec else FilterSpec()
        if compare:
            fs.compare = compare
        if exclude_deleted:
            fs.include_deleted_lost = False

        snap = self._active_snap(fs.as_of)
        if snap is None:
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
        today_df = _opps_to_df(opps)

        comp = fs.compare if fs.compare in ("yesterday", "last_week") else "yesterday"
        prev_snap = self._yesterday_snap(snap) if comp == "yesterday" else self._lastweek_snap(snap)
        if prev_snap is None:
            return {
                "compare": comp,
                "compare_date": None,
                "data_slice": res.data_slice,
                "filters_applied": res.filters_applied,
                "positive": [], "negative": [], "approval": [],
                "slippage_to_2027": {"count": 0, "acv": 0.0},
                "slipped_later_quarter": {"count": 0, "acv": 0.0},
                "slipped_earlier": {"count": 0, "acv": 0.0},
            }

        prev_opps, _ = self._scoped_opps(prev_snap, filter_spec=fs, target_date=eff_as_of_date)
        prev_df   = _opps_to_df(prev_opps)

        # Get ALL renewals opps for today to see where prev_df deals went
        q = self.db.query(Opportunity).filter(
            Opportunity.snapshot_id == snap.id,
            ScopeService.is_renewals()
        )
        if not fs.include_deleted_lost:
            q = q.filter(Opportunity.is_deleted_or_lost == False)
        today_all_df = _opps_to_df(q.all())

        target_fp = res.resolved_quarter
        moves = self._movements(today_df, prev_df, today_all_df, target_fp)
        return {
            "compare": comp,
            "compare_date": prev_snap.snapshot_date.isoformat(),
            "data_slice": res.data_slice,
            "filters_applied": res.filters_applied,
            **moves,
        }

    def get_regional_breakdown(
        self,
        ctx: UserContext,
        exclude_deleted: bool = False,
        filter_spec: Optional[ScopeService.FilterSpec] = None,
    ) -> dict:
        from backend.services.scopes import FilterSpec
        fs = filter_spec.model_copy() if filter_spec else FilterSpec()
        if exclude_deleted:
            fs.include_deleted_lost = False

        snap = self._active_snap(fs.as_of)
        if snap is None:
            return {"error": "no_snapshot"}

        opps, res = self._scoped_opps(snap, filter_spec=fs)
        df = _opps_to_df(opps)
        
        yest_snap = self._yesterday_snap(snap)
        y_opps, _ = self._scoped_opps(yest_snap, filter_spec=fs, target_date=snap.snapshot_date) if yest_snap else ([], None)
        y_df = _opps_to_df(y_opps)
        
        lw_snap = self._lastweek_snap(snap)
        lw_opps, _ = self._scoped_opps(lw_snap, filter_spec=fs, target_date=snap.snapshot_date) if lw_snap else ([], None)
        lw_df = _opps_to_df(lw_opps)

        found_regions = set()
        for d in (df, y_df, lw_df):
            if not d.empty and "canonical_region" in d.columns:
                found_regions.update(d["canonical_region"].unique())

        known_regions = list(CANONICAL_REGIONS)
        other_regions = sorted([r for r in found_regions if r not in known_regions and r not in ("Other", "Other / Unmapped")])
        regions = known_regions + other_regions
        if "Other / Unmapped" in found_regions or "Other" in found_regions:
            regions.append("Other / Unmapped")

        prop_rows = []
        for region in regions:
            r_df = df[df["canonical_region"] == region] if not df.empty else pd.DataFrame()
            prop_rows.append({
                "region": region,
                "total_acv":    round(_sum(r_df, "forecast_acv_amount"), 2),
                "approved_count": int((r_df["approval_status"] == "Approved").sum()) if not r_df.empty and "approval_status" in r_df.columns else 0,
                "pending_count":  int((r_df["approval_status"] == "Pending Approval").sum()) if not r_df.empty and "approval_status" in r_df.columns else 0,
                "blank_count":    int((r_df["approval_status"] == "Blank").sum()) if not r_df.empty and "approval_status" in r_df.columns else 0,
                "approved_acv":  round(_sum(r_df[r_df["approval_status"] == "Approved"] if not r_df.empty and "approval_status" in r_df.columns else pd.DataFrame(), "forecast_acv_amount"), 2),
                "pending_acv":   round(_sum(r_df[r_df["approval_status"] == "Pending Approval"] if not r_df.empty and "approval_status" in r_df.columns else pd.DataFrame(), "forecast_acv_amount"), 2),
                "blank_acv":     round(_sum(r_df[r_df["approval_status"] == "Blank"] if not r_df.empty and "approval_status" in r_df.columns else pd.DataFrame(), "forecast_acv_amount"), 2),
            })

        prop_totals = {
            "region": "Total",
            "total_acv":     round(_sum(df, "forecast_acv_amount"), 2),
            "approved_count": int((df["approval_status"] == "Approved").sum()) if not df.empty and "approval_status" in df.columns else 0,
            "pending_count":  int((df["approval_status"] == "Pending Approval").sum()) if not df.empty and "approval_status" in df.columns else 0,
            "blank_count":    int((df["approval_status"] == "Blank").sum()) if not df.empty and "approval_status" in df.columns else 0,
        }

        trend_rows = []
        for region in regions:
            r_df = df[df["canonical_region"] == region] if not df.empty else pd.DataFrame()
            y_r_df = y_df[y_df["canonical_region"] == region] if not y_df.empty else pd.DataFrame()
            lw_r_df = lw_df[lw_df["canonical_region"] == region] if not lw_df.empty else pd.DataFrame()
            
            row = {
                "region":       region,
                "total_count":  len(r_df),
                "total_acv":    round(_sum(r_df, "forecast_acv_amount"), 2),
                "y_total_count": len(y_r_df),
                "y_total_acv":  round(_sum(y_r_df, "forecast_acv_amount"), 2),
                "lw_total_count": len(lw_r_df),
                "lw_total_acv": round(_sum(lw_r_df, "forecast_acv_amount"), 2),
            }
            for fc in ALL_FC:
                fc_key = fc.lower().replace(" ", "_")
                
                fc_df = r_df[r_df["forecast_category"] == fc] if not r_df.empty and "forecast_category" in r_df.columns else pd.DataFrame()
                row[f"{fc_key}_count"] = len(fc_df)
                row[f"{fc_key}_acv"]   = round(_sum(fc_df, "forecast_acv_amount"), 2)
                
                y_fc_df = y_r_df[y_r_df["forecast_category"] == fc] if not y_r_df.empty and "forecast_category" in y_r_df.columns else pd.DataFrame()
                row[f"y_{fc_key}_count"] = len(y_fc_df)
                row[f"y_{fc_key}_acv"]   = round(_sum(y_fc_df, "forecast_acv_amount"), 2)
                
                lw_fc_df = lw_r_df[lw_r_df["forecast_category"] == fc] if not lw_r_df.empty and "forecast_category" in lw_r_df.columns else pd.DataFrame()
                row[f"lw_{fc_key}_count"] = len(lw_fc_df)
                row[f"lw_{fc_key}_acv"]   = round(_sum(lw_fc_df, "forecast_acv_amount"), 2)
                
            trend_rows.append(row)

        total_row = {"region": "Total", "total_count": len(df), "total_acv": round(_sum(df, "forecast_acv_amount"), 2),
                     "y_total_count": len(y_df), "y_total_acv": round(_sum(y_df, "forecast_acv_amount"), 2),
                     "lw_total_count": len(lw_df), "lw_total_acv": round(_sum(lw_df, "forecast_acv_amount"), 2)}
                     
        for fc in ALL_FC:
            fc_key = fc.lower().replace(" ", "_")
            fc_df = df[df["forecast_category"] == fc] if not df.empty and "forecast_category" in df.columns else pd.DataFrame()
            total_row[f"{fc_key}_count"] = len(fc_df)
            total_row[f"{fc_key}_acv"]   = round(_sum(fc_df, "forecast_acv_amount"), 2)
            
            y_fc_df = y_df[y_df["forecast_category"] == fc] if not y_df.empty and "forecast_category" in y_df.columns else pd.DataFrame()
            total_row[f"y_{fc_key}_count"] = len(y_fc_df)
            total_row[f"y_{fc_key}_acv"]   = round(_sum(y_fc_df, "forecast_acv_amount"), 2)
            
            lw_fc_df = lw_df[lw_df["forecast_category"] == fc] if not lw_df.empty and "forecast_category" in lw_df.columns else pd.DataFrame()
            total_row[f"lw_{fc_key}_count"] = len(lw_fc_df)
            total_row[f"lw_{fc_key}_acv"]   = round(_sum(lw_fc_df, "forecast_acv_amount"), 2)

        regional_sum = sum(r["total_acv"] for r in trend_rows)
        check_passes = abs(regional_sum - total_row["total_acv"]) < 0.01

        return {
            "data_slice": res.data_slice,
            "filters_applied": res.filters_applied,
            "proposal_confirmation": prop_rows,
            "proposal_confirmation_totals": prop_totals,
            "regional_trend": trend_rows,
            "regional_trend_totals": total_row,
            "regional_sum": round(regional_sum, 2),
            "total_acv_check_passes": check_passes,
            "other_count": int((df["canonical_region"] == "Other").sum()) if not df.empty and "canonical_region" in df.columns else 0,
        }

    def get_deals(
        self,
        ctx: UserContext,
        category: str | None = None,
        region: str | None = None,
        approval_status: str | None = None,
        kind: str | None = None,
        compare: str | None = None,
        exclude_deleted: bool = False,
        as_of: str | None = None,
        filter_spec: Optional[ScopeService.FilterSpec] = None,
        deal_ids: Optional[list[str]] = None,
    ) -> dict:
        from backend.services.scopes import FilterSpec
        fs = filter_spec.model_copy() if filter_spec else FilterSpec()
        if as_of:
            fs.as_of = as_of
        if exclude_deleted:
            fs.include_deleted_lost = False
        if category:
            fs.forecast_categories = [category]
        if region:
            fs.regions = [region]
        if approval_status:
            fs.approval_statuses = [approval_status]

        snap = self._active_snap(fs.as_of)
        if snap is None:
            return {"count": 0, "acv": 0.0, "filters_applied": {}, "deals": []}

        filters_applied: dict[str, str] = {}
        if category:
            filters_applied["category"] = category
        if region:
            filters_applied["region"] = region
        if approval_status:
            filters_applied["approval_status"] = approval_status
        if kind:
            filters_applied["kind"] = kind
        if compare:
            filters_applied["compare"] = compare

        # ── Kind: delayed deals (all, slipped, overdue, later_close, and deltas) ──
        if kind in ("delayed_overdue", "slippage_total", "delayed_total", "delayed_renewals_total", "lost", "later_close") or (kind and (kind.startswith("delayed_") or kind.startswith("slipped_") or (kind == "slipped" and not compare))):
            target_kind = kind.replace("delayed_", "") if kind.startswith("delayed_") else kind
            from backend.services.v2_delayed_service import V2DelayedService
            del_svc = V2DelayedService(self.db)
            return del_svc.get_deals(
                as_of=fs.as_of or snap.id,
                compare=compare,
                kind=target_kind,
                region=region,
                category=category,
                status=approval_status,
                bu=None,
                filter_spec=fs,
            )

        # ── Kind: slipped ─────────────────────────────────────────────────────
        if kind == "slipped":
            comp = compare if compare in ("yesterday", "last_week") else "yesterday"
            moves = self.get_movements(ctx, compare=comp, exclude_deleted=exclude_deleted)
            slip = moves.get("slippage_to_2027") or {"count": 0, "acv": 0.0, "deals": []}
            raw_deals = slip.get("deals", [])
            # Map deal fields consistently
            records = []
            for d in raw_deals:
                records.append({
                    "id": str(d.get("opportunity_id_18", "")),
                    "opportunity_id_18": str(d.get("opportunity_id_18", "")),
                    "opportunity_name": str(d.get("opportunity_name", "")),
                    "account_name": str(d.get("account_name", "")),
                    "forecast_category": str(d.get("forecast_category", "")),
                    "forecast_acv_amount": float(d.get("forecast_acv_amount") or d.get("acv") or 0),
                    "approval_status": str(d.get("approval_status", "")),
                    "sub_region": str(d.get("canonical_region") or d.get("region") or ""),
                    "business_unit_primary": str(d.get("business_unit_primary", "")),
                    "close_date": d.get("close_date"),
                })
            return {
                "count": slip.get("count", len(records)),
                "acv": round(float(slip.get("acv", sum(r["forecast_acv_amount"] for r in records))), 2),
                "filters_applied": filters_applied,
                "deals": records,
            }

        opps, res = self._scoped_opps(snap, filter_spec=fs)
        df = _opps_to_df(opps)
        if df.empty:
            return {"count": 0, "acv": 0.0, "filters_applied": res.filters_applied, "deals": []}

        if kind in ("delta_yesterday", "delta_lastweek"):
            prev_snap = self._yesterday_snap(snap) if kind == "delta_yesterday" else self._lastweek_snap(snap)
            if prev_snap:
                prev_opps, _ = self._scoped_opps(prev_snap, filter_spec=fs, exclude_deleted=exclude_deleted, target_date=snap.snapshot_date)
                prev_df = _opps_to_df(prev_opps)

                t_map = {str(r["opportunity_id_18"]): r for _, r in df.iterrows()}
                p_map = {str(r["opportunity_id_18"]): r for _, r in prev_df.iterrows()} if not prev_df.empty else {}

                added_deals = []
                for oid, tr in t_map.items():
                    if oid not in p_map:
                        deal = {
                            "id": str(tr["opportunity_id_18"]),
                            "opportunity_id_18": str(tr["opportunity_id_18"]),
                            "opportunity_name": str(tr["opportunity_name"]),
                            "account_name": str(tr["account_name"]),
                            "forecast_category": str(tr["forecast_category"]),
                            "forecast_acv_amount": float(tr["forecast_acv_amount"] or 0),
                            "approval_status": str(tr["approval_status"]),
                            "sub_region": str(tr["canonical_region"]),
                            "business_unit_primary": str(tr["business_unit_primary"]),
                            "close_date": tr["close_date"].isoformat() if hasattr(tr["close_date"], "isoformat") else str(tr["close_date"]) if tr["close_date"] else None,
                            "delta_group": f"Added to {res.data_slice}",
                            "delta_acv_change": float(tr["forecast_acv_amount"] or 0),
                        }
                        added_deals.append(deal)

                left_deals = []
                for oid, pr in p_map.items():
                    if oid not in t_map:
                        deal = {
                            "id": str(pr["opportunity_id_18"]),
                            "opportunity_id_18": str(pr["opportunity_id_18"]),
                            "opportunity_name": str(pr["opportunity_name"]),
                            "account_name": str(pr["account_name"]),
                            "forecast_category": str(pr["forecast_category"]),
                            "forecast_acv_amount": float(pr["forecast_acv_amount"] or 0),
                            "approval_status": str(pr["approval_status"]),
                            "sub_region": str(pr["canonical_region"]),
                            "business_unit_primary": str(pr["business_unit_primary"]),
                            "close_date": pr["close_date"].isoformat() if hasattr(pr["close_date"], "isoformat") else str(pr["close_date"]) if pr["close_date"] else None,
                            "delta_group": f"Left {res.data_slice} – moved or lost",
                            "delta_acv_change": -float(pr["forecast_acv_amount"] or 0),
                        }
                        left_deals.append(deal)

                changed_deals = []
                for oid in t_map:
                    if oid in p_map:
                        tr = t_map[oid]
                        pr = p_map[oid]
                        diff = round(float(tr["forecast_acv_amount"] or 0) - float(pr["forecast_acv_amount"] or 0), 2)
                        if abs(diff) > 0.001:
                            deal = {
                                "id": str(tr["opportunity_id_18"]),
                                "opportunity_id_18": str(tr["opportunity_id_18"]),
                                "opportunity_name": str(tr["opportunity_name"]),
                                "account_name": str(tr["account_name"]),
                                "forecast_category": str(tr["forecast_category"]),
                                "forecast_acv_amount": float(tr["forecast_acv_amount"] or 0),
                                "approval_status": str(tr["approval_status"]),
                                "sub_region": str(tr["canonical_region"]),
                                "business_unit_primary": str(tr["business_unit_primary"]),
                                "close_date": tr["close_date"].isoformat() if hasattr(tr["close_date"], "isoformat") else str(tr["close_date"]) if tr["close_date"] else None,
                                "delta_group": "Amount changed",
                                "delta_acv_change": diff,
                            }
                            changed_deals.append(deal)

                added_acv = round(sum(d["forecast_acv_amount"] for d in added_deals), 2)
                left_acv = round(sum(d["forecast_acv_amount"] for d in left_deals), 2)
                changed_diff = round(sum(d["delta_acv_change"] for d in changed_deals), 2)

                # Net calculations
                net_count = len(df) - len(prev_df)
                net_acv = round(float(_sum(df, "forecast_acv_amount") - _sum(prev_df, "forecast_acv_amount")), 2)

                all_delta_deals = added_deals + left_deals + changed_deals

                delta_groups = {
                    "added": {
                        "name": f"Added to {res.data_slice} ({len(added_deals)})",
                        "count": len(added_deals),
                        "acv": added_acv,
                        "deals": added_deals,
                    },
                    "left": {
                        "name": f"Left {res.data_slice} – moved or lost ({len(left_deals)})",
                        "count": len(left_deals),
                        "acv": left_acv,
                        "deals": left_deals,
                    },
                    "amount_changed": {
                        "name": f"Amount changed ({len(changed_deals)})",
                        "count": len(changed_deals),
                        "acv": changed_diff,
                        "deals": changed_deals,
                    },
                    "net": {
                        "count": net_count,
                        "acv": net_acv,
                    }
                }

                return {
                    "count": net_count,
                    "acv": net_acv,
                    "filters_applied": filters_applied,
                    "delta_groups": delta_groups,
                    "deals": all_delta_deals,
                }


        # ── Kind-based filters for Overview ──────────────────────────────────
        if kind == "other_types":
            base_opps = self.db.query(Opportunity).filter(
                Opportunity.snapshot_id == snap.id,
                *res.base_conditions
            ).all()
            excluded_opps = [
                o for o in base_opps
                if ScopeService.extract_type_code(
                    (o.extra_attributes or {}).get("Type") or (o.extra_attributes or {}).get("type")
                ) not in (res.effective_types or [])
            ]
            deals = [self._opp_to_deal_dict(o) for o in excluded_opps]
            return {
                "count": len(deals),
                "acv": round(sum(d["forecast_acv_amount"] for d in deals), 2),
                "filters_applied": filters_applied,
                "deals": deals,
            }
        elif kind == "coverage":
            df = df[df["forecast_category"].isin(["Commit", "Best Case"])]
        elif kind == "commit_not_approved":
            df = df[(df["forecast_category"] == "Commit") & (df["approval_status"] != "Approved")]
        elif kind == "overdue":
            all_opps_q = self.db.query(Opportunity).filter(
                Opportunity.snapshot_id == snap.id,
                Opportunity.sales_type == "Renewals",
            ).all()
            df_all_ren = _opps_to_df(all_opps_q)
            cd = pd.to_datetime(df_all_ren["close_date"], errors="coerce")
            snap_ts = pd.Timestamp(snap.snapshot_date)
            df = df_all_ren[(cd < snap_ts) & (df_all_ren["forecast_category"] != "Closed") & (~df_all_ren["is_deleted_or_lost"])]
            df = df.drop_duplicates(subset=["opportunity_id_18"], keep="last")
        elif kind == "closing_14d_unapproved":
            from backend.config import settings
            window_days = getattr(settings, "NEEDS_ATTENTION_WINDOW_DAYS", 14)
            cd = pd.to_datetime(df["close_date"], errors="coerce")
            snap_ts = pd.Timestamp(snap.snapshot_date)
            df = df[
                (cd >= snap_ts) &
                (cd <= snap_ts + pd.Timedelta(days=window_days)) &
                (df["approval_status"] != "Approved") &
                (df["forecast_category"] != "Closed") &
                (~df["is_deleted_or_lost"])
            ]
        elif kind == "biggest_drop":
            prev_snap = self._yesterday_snap(snap)
            if prev_snap:
                y_opps, _ = self._scoped_opps(prev_snap, filter_spec=fs)
                y_df = _opps_to_df(y_opps)
                t_map = {str(r["opportunity_id_18"]): r for _, r in df.iterrows()}
                p_map = {str(r["opportunity_id_18"]): r for _, r in y_df.iterrows()} if not y_df.empty else {}
                drop_records = []
                for oid, pr in p_map.items():
                    prev_acv = float(pr["forecast_acv_amount"] or 0)
                    if oid not in t_map:
                        drop_records.append({
                            "id": str(oid),
                            "opportunity_id_18": str(oid),
                            "opportunity_name": str(pr["opportunity_name"]),
                            "account_name": str(pr["account_name"]),
                            "forecast_category": str(pr["forecast_category"]),
                            "forecast_acv_amount": float(prev_acv),
                            "approval_status": str(pr["approval_status"]),
                            "sub_region": str(pr.get("canonical_region", "")),
                            "business_unit_primary": str(pr.get("business_unit_primary", "")),
                            "close_date": pr["close_date"].isoformat() if hasattr(pr["close_date"], "isoformat") else str(pr["close_date"]) if pr["close_date"] else None,
                            "delta_acv_change": -float(prev_acv),
                        })
                    else:
                        curr_acv = float(t_map[oid]["forecast_acv_amount"] or 0)
                        if prev_acv - curr_acv > 0.01:
                            drop_records.append({
                                "id": str(oid),
                                "opportunity_id_18": str(oid),
                                "opportunity_name": str(pr["opportunity_name"]),
                                "account_name": str(pr["account_name"]),
                                "forecast_category": str(t_map[oid]["forecast_category"]),
                                "forecast_acv_amount": float(curr_acv),
                                "approval_status": str(t_map[oid]["approval_status"]),
                                "sub_region": str(t_map[oid].get("canonical_region", "")),
                                "business_unit_primary": str(t_map[oid].get("business_unit_primary", "")),
                                "close_date": t_map[oid]["close_date"].isoformat() if hasattr(t_map[oid]["close_date"], "isoformat") else str(t_map[oid]["close_date"]) if t_map[oid]["close_date"] else None,
                                "delta_acv_change": round(curr_acv - prev_acv, 2),
                            })
                drop_records.sort(key=lambda x: abs(x.get("delta_acv_change", 0)), reverse=True)
                if deal_ids:
                    drop_records = [d for d in drop_records if d["opportunity_id_18"] in deal_ids]
                return {
                    "count": len(drop_records),
                    "acv": round(sum(r["forecast_acv_amount"] for r in drop_records), 2),
                    "filters_applied": res.filters_applied,
                    "deals": drop_records,
                }

        if deal_ids:
            df = df[df["opportunity_id_18"].isin(deal_ids)]

        if category:
            df = df[df["forecast_category"] == category]

        if region and region != "Total":
            df = df[df["canonical_region"] == region]

        if approval_status and approval_status != "Total":
            if approval_status in ("not_approved", "unapproved", "Not Approved"):
                df = df[df["approval_status"] != "Approved"]
            else:
                df = df[df["approval_status"] == approval_status]

        if not df.empty:
            df = df.sort_values(by=["forecast_acv_amount", "opportunity_id_18"], ascending=[False, True])

        records = []
        for _, r in df.iterrows():
            records.append({
                "id": str(r["opportunity_id_18"]),
                "opportunity_id_18": str(r["opportunity_id_18"]),
                "opportunity_name": str(r["opportunity_name"]),
                "account_name": str(r["account_name"]),
                "forecast_category": str(r["forecast_category"]),
                "forecast_acv_amount": float(r["forecast_acv_amount"] or 0),
                "approval_status": str(r["approval_status"]),
                "sub_region": str(r["canonical_region"]),
                "business_unit_primary": str(r["business_unit_primary"]),
                "close_date": r["close_date"].isoformat() if hasattr(r["close_date"], "isoformat") else str(r["close_date"]) if r["close_date"] else None,
            })
        return {
            "count": len(records),
            "acv": round(sum(r["forecast_acv_amount"] for r in records), 2),
            "filters_applied": res.filters_applied,
            "deals": records,
        }

