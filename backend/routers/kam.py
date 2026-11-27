"""
KAM Portal Router (Round 18 & Round 22).
Endpoints for My Overview, My Deals, My Reports (PPTX / PDF), and My Account.
Strictly isolated to the authenticated KAM's own opportunities (via owner_name and aliases).
Admin and Management can optionally supply `owner_override` to view or export a specific KAM's data.
"""
from __future__ import annotations

import logging
from typing import Optional, List, Dict, Any
from datetime import date, datetime, timezone, timedelta
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, or_

from backend.database import get_db
from backend.models.opportunity import Opportunity
from backend.models.snapshot import UploadSnapshot
from backend.models.user import User, DealMessage
from backend.models.custom_column import DealComment
from backend.services.context import UserContext, require_authenticated
from backend.services.scopes import FilterSpec, ScopeService
from backend.services.deal_serializer import (
    serialize_opportunity,
    is_deal_missing_service_dates,
    is_deal_open,
    is_deal_closed,
    is_deal_overdue,
    get_deal_needs_review_reasons,
)
from backend.services.v2_delayed_service import V2DelayedService
from backend.services.kam_report_service import KamReportService
from backend.services.settings_service import SettingsService
from backend.constants import get_approval_group, is_approved_2nd, normalize_approval_status
from backend.utils.excel_parser import parse_excel_date

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/kam", tags=["kam-portal"])


def _require_kam_or_management(ctx: UserContext = Depends(require_authenticated)) -> UserContext:
    if not (ctx.is_kam or ctx.is_management or ctx.is_admin):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access forbidden: KAM portal is restricted to Opportunity Owners, Management, and Admins.",
        )
    return ctx


def _resolve_snapshot(db: Session, as_of: Optional[str] = None) -> UploadSnapshot | None:
    snap = db.query(UploadSnapshot).filter(UploadSnapshot.is_active_today == True).first()
    if as_of:
        s_target = db.query(UploadSnapshot).filter(UploadSnapshot.id == as_of).first()
        if not s_target:
            try:
                target_d = date.fromisoformat(as_of)
                s_target = db.query(UploadSnapshot).filter(UploadSnapshot.snapshot_date == target_d).first()
            except ValueError:
                pass
        if s_target:
            snap = s_target

    if not snap:
        snap = db.query(UploadSnapshot).order_by(UploadSnapshot.snapshot_date.desc()).first()
    return snap


@router.get("/overview")
def get_kam_overview(
    as_of: Optional[str] = Query(None),
    period: Optional[str] = Query(None),
    compare: Optional[str] = Query(None),
    types: Optional[str] = Query(None),
    owner_override: Optional[str] = Query(None),
    ctx: UserContext = Depends(_require_kam_or_management),
    db: Session = Depends(get_db),
):
    """
    Returns KAM's personal portfolio metrics:
    - Period totals: deals count, total ACV
    - KPI tiles: Portfolio, Commit coverage, Approvals, Delayed, Slippage, Needs Review, Unread messages
    - Movements vs compare-to snapshot, yesterday and last week
    - Region line: single region sentence or multi-region chips + country breakdown
    - What changed between active snapshot and compare-to snapshot
    - Charts: Forecast category, Approval status, Stage funnel, BU split, Region split, Timelines, Top accounts, Deal sizes
    - Action lists: Immediate attention, Delayed deals, Slippage, Missing dates, Unapproved Commit
    - Plain-language insight cards
    """
    allowed_owners = ctx.all_owner_names
    effective_owner_name = ctx.owner_name or (allowed_owners[0] if allowed_owners else ctx.display_name)
    if (ctx.is_admin or ctx.is_management) and owner_override:
        allowed_owners = [owner_override.strip()]
        effective_owner_name = owner_override.strip()

    if not allowed_owners:
        empty_kpis = {
            "total_count": 0, "total_acv": 0.0,
            "commit_coverage_count": 0, "commit_coverage_acv": 0.0,
            "commit_count": 0, "commit_acv": 0.0,
            "closed_count": 0, "closed_acv": 0.0,
            "best_case_count": 0, "best_case_acv": 0.0,
            "pipeline_count": 0, "pipeline_acv": 0.0,
            "approved_count": 0, "approved_acv": 0.0,
            "approved_2nd_count": 0, "approved_2nd_acv": 0.0,
            "approved_2nd_breakdown": None,
            "pending_approval_count": 0, "pending_approval_acv": 0.0,
            "not_submitted_count": 0, "not_submitted_acv": 0.0,
            "delayed_count": 0, "delayed_acv": 0.0,
            "slippage_count": 0, "slippage_acv": 0.0,
            "needs_review_count": 0, "needs_review_acv": 0.0,
            "unread_messages": 0,
        }
        return {
            "period": period or "All periods",
            "owner_name": effective_owner_name,
            "kpis": empty_kpis,
            "total": {"count": 0, "acv": 0.0},
            "forecast_categories": {},
            "approval_statuses": {},
            "charts": {},
            "action_lists": {},
            "insight_cards": ["No opportunities found for current owner."],
            "region_line": {"single_region": False, "summary_sentence": "", "regions": []},
            "what_changed": {"has_changes": False, "total_changes": 0, "compare_date": None, "new_deals": [], "acv_changes": [], "stage_changes": [], "category_changes": [], "approval_changes": [], "closed_won": [], "removed_deals": []},
            "movements": {"delta_yesterday": {"count": 0, "acv": 0.0, "available": False}},
        }

    snap = _resolve_snapshot(db, as_of)
    if not snap:
        return {"error": "no_snapshot"}

    # Sanitize Query defaults if called programmatically
    kam_default = SettingsService.get_kam_default_period(db)
    if not isinstance(period, str) or not period:
        period = getattr(period, "default", kam_default) or kam_default
    if not isinstance(compare, str):
        compare = getattr(compare, "default", "yesterday") or "yesterday"
    if not isinstance(as_of, str):
        as_of = getattr(as_of, "default", None)
    if not isinstance(types, str):
        types = getattr(types, "default", None)

    fs = FilterSpec.from_params(
        as_of=as_of,
        period=period,
        types=types,
        compare=compare or "yesterday",
        allowed_owners=allowed_owners,
        user_context=ctx,
    )
    res = ScopeService.resolve(fs, snapshot=snap, as_of_date=snap.snapshot_date, db=db)

    from backend.services.cache_service import analytics_cache
    opps = analytics_cache.query_scoped_lite(db, snap.id, res.conditions)

    deals = [serialize_opportunity(o) for o in opps]
    total_count = len(deals)
    total_acv = round(sum(float(d.get("forecast_acv_amount") or 0.0) for d in deals), 2)

    # 1. Forecast split (5 canonical categories)
    fc_map: dict[str, dict[str, Any]] = {
        "Closed": {"count": 0, "acv": 0.0, "deals": []},
        "Commit": {"count": 0, "acv": 0.0, "deals": []},
        "Best Case": {"count": 0, "acv": 0.0, "deals": []},
        "Pipeline": {"count": 0, "acv": 0.0, "deals": []},
        "Not yet proposed": {"count": 0, "acv": 0.0, "deals": []},
    }
    for d in deals:
        fc = (d.get("forecast_category") or "Not yet proposed").strip()
        norm_fc = "Not yet proposed" if fc in ("Blank", "Not yet proposed", "") else fc
        if norm_fc not in fc_map:
            norm_fc = "Not yet proposed"
        fc_map[norm_fc]["count"] += 1
        fc_map[norm_fc]["acv"] = round(fc_map[norm_fc]["acv"] + float(d.get("forecast_acv_amount") or 0.0), 2)
        fc_map[norm_fc]["deals"].append(d)

    # Commit Coverage = Commit + Closed
    commit_cov_count = fc_map["Commit"]["count"] + fc_map["Closed"]["count"]
    commit_cov_acv = round(fc_map["Commit"]["acv"] + fc_map["Closed"]["acv"], 2)
    commit_cov_deals = fc_map["Commit"]["deals"] + fc_map["Closed"]["deals"]

    # 2. Approval split
    st_map: dict[str, dict[str, Any]] = {
        "Approved": {"count": 0, "acv": 0.0, "deals": [], "approved_2nd_count": 0, "approved_2nd_acv": 0.0},
        "Pending Approval": {"count": 0, "acv": 0.0, "deals": []},
        "Not submitted": {"count": 0, "acv": 0.0, "deals": []},
    }
    for d in deals:
        raw_st = d.get("approval_status") or d.get("raw_approval_status")
        norm_st = get_approval_group(raw_st)
        if norm_st not in st_map:
            norm_st = "Not submitted"
        st_map[norm_st]["count"] += 1
        st_map[norm_st]["acv"] = round(st_map[norm_st]["acv"] + float(d.get("forecast_acv_amount") or 0.0), 2)
        st_map[norm_st]["deals"].append(d)
        if norm_st == "Approved" and is_approved_2nd(raw_st):
            st_map["Approved"]["approved_2nd_count"] += 1
            st_map["Approved"]["approved_2nd_acv"] = round(st_map["Approved"]["approved_2nd_acv"] + float(d.get("forecast_acv_amount") or 0.0), 2)

    # 3. Delayed & Slippage for this KAM
    delayed_svc = V2DelayedService(db)
    delayed_buckets = delayed_svc._compute_snapshot_buckets(snap, res.resolved_quarter, filter_spec=fs)
    del_df = delayed_buckets.get("delayed_total", pd.DataFrame())
    slip_df = delayed_buckets.get("slippage_total", pd.DataFrame())

    if not del_df.empty:
        del_df = del_df[del_df["opportunity_owner"].isin(allowed_owners)]
    if not slip_df.empty:
        slip_df = slip_df[slip_df["opportunity_owner"].isin(allowed_owners)]

    delayed_deals = del_df.to_dict("records") if not del_df.empty else []
    for d in delayed_deals:
        d["id"] = d.get("opportunity_id_18")
    delayed_count = len(delayed_deals)
    delayed_acv = round(float(del_df["forecast_acv_amount"].sum()) if not del_df.empty else 0.0, 2)

    slippage_deals = slip_df.to_dict("records") if not slip_df.empty else []
    for d in slippage_deals:
        d["id"] = d.get("opportunity_id_18")
    slippage_count = len(slippage_deals)
    slippage_acv = round(float(slip_df["forecast_acv_amount"].sum()) if not slip_df.empty else 0.0, 2)

    # 4. Needs Review (Alignd with admin V2DelayedService: missing dates, negative ACV, far ahead close date)
    needs_review_deals = []
    missing_dates_deals = []
    for d in deals:
        reasons = get_deal_needs_review_reasons(d, as_of=snap.snapshot_date)
        if reasons:
            d["review_reasons"] = reasons
            d["review_reason"] = reasons[0]
            needs_review_deals.append(d)
        if is_deal_missing_service_dates(d):
            missing_dates_deals.append(d)

    needs_review_count = len(needs_review_deals)
    needs_review_acv = round(sum(float(d.get("forecast_acv_amount") or 0.0) for d in needs_review_deals), 2)

    # 5. Unread Messages for this KAM (per-user read receipt aware, excluding deleted)
    from backend.models.user import MessageReadReceipt
    from backend.services.delivery_service import resolve_caller_uid
    caller_uid = resolve_caller_uid(db, ctx)
    owned_ids = [d["opportunity_id_18"] for d in deals if d.get("opportunity_id_18")]
    msg_q = db.query(DealMessage).filter(DealMessage.is_deleted == False)
    if owned_ids:
        msg_q = msg_q.filter(
            or_(
                DealMessage.recipient_id == caller_uid,
                (DealMessage.deal_id.in_(owned_ids) & (DealMessage.sender_role != "kam")),
            )
        )
    else:
        msg_q = msg_q.filter(DealMessage.recipient_id == caller_uid)
    candidate_msgs = msg_q.all()
    if candidate_msgs:
        cand_ids = [m.id for m in candidate_msgs]
        read_ids = {
            r[0]
            for r in db.query(MessageReadReceipt.message_id)
            .filter(MessageReadReceipt.user_id == caller_uid, MessageReadReceipt.message_id.in_(cand_ids))
            .all()
        }
        unread_msg_count = sum(1 for m in candidate_msgs if m.id not in read_ids and str(m.sender_id) != str(caller_uid))
    else:
        unread_msg_count = 0

    # 6. Movements vs Compare-To, Yesterday & Last Week
    y_snap = delayed_svc.get_yesterday_baseline(snap)
    w_snap = delayed_svc.get_lastweek_baseline(snap)

    compare_snap: UploadSnapshot | None = None
    if compare and compare not in ("yesterday", "lastweek", "last_week"):
        compare_snap = _resolve_snapshot(db, compare)
    if not compare_snap or compare_snap.id == snap.id:
        compare_snap = y_snap
    if not compare_snap or compare_snap.id == snap.id:
        compare_snap = (
            db.query(UploadSnapshot)
            .filter(UploadSnapshot.snapshot_date < snap.snapshot_date)
            .order_by(UploadSnapshot.snapshot_date.desc())
            .first()
        )

    def _compute_delta(base_snap: UploadSnapshot | None) -> dict[str, Any]:
        if not base_snap:
            return {"count": None, "acv": None, "available": False, "label": "n/a", "date": None}
        b_opps = analytics_cache.query_scoped_lite(db, base_snap.id, res.conditions)
        b_cnt = len(b_opps)
        b_acv = round(sum(float(o.forecast_acv_amount or 0.0) for o in b_opps), 2)
        diff_cnt = total_count - b_cnt
        diff_acv = round(total_acv - b_acv, 2)
        cnt_prefix = "+" if diff_cnt > 0 else ""
        deal_noun = "deal" if abs(diff_cnt) == 1 else "deals"
        if diff_acv < 0:
            acv_label = f"-${abs(diff_acv):,.2f}"
        elif diff_acv > 0:
            acv_label = f"+${diff_acv:,.2f}"
        else:
            acv_label = "$0.00"
        return {
            "count": diff_cnt,
            "acv": diff_acv,
            "available": True,
            "date": base_snap.snapshot_date.isoformat(),
            "date_formatted": base_snap.snapshot_date.strftime("%b %d, %Y"),
            "label": f"{cnt_prefix}{diff_cnt} {deal_noun} ({acv_label})",
        }

    delta_compare = _compute_delta(compare_snap)
    delta_yesterday = _compute_delta(y_snap)
    delta_lastweek = _compute_delta(w_snap)

    # 7. What Changed Between Active and Compare-to Snapshot
    what_changed: dict[str, Any] = {
        "has_changes": False,
        "compare_date": compare_snap.snapshot_date.isoformat() if compare_snap else None,
        "compare_date_formatted": compare_snap.snapshot_date.strftime("%b %d, %Y") if compare_snap else "baseline",
        "total_changes": 0,
        "new_deals": [],
        "acv_changes": [],
        "stage_changes": [],
        "category_changes": [],
        "approval_changes": [],
        "closed_won": [],
        "removed_deals": [],
    }

    if compare_snap and compare_snap.id != snap.id:
        prior_opps = analytics_cache.query_scoped_lite(db, compare_snap.id, res.conditions)
        prior_deals = [serialize_opportunity(o) for o in prior_opps]
        prior_by_id = {str(d.get("opportunity_id_18") or d.get("id")): d for d in prior_deals if (d.get("opportunity_id_18") or d.get("id"))}
        cur_by_id = {str(d.get("opportunity_id_18") or d.get("id")): d for d in deals if (d.get("opportunity_id_18") or d.get("id"))}

        # New deals
        for d_id, cur_d in cur_by_id.items():
            if d_id not in prior_by_id:
                what_changed["new_deals"].append({
                    "id": d_id,
                    "opportunity_name": cur_d.get("opportunity_name") or d_id,
                    "account_name": cur_d.get("account_name") or "Unknown",
                    "acv": float(cur_d.get("forecast_acv_amount") or 0.0),
                    "stage": cur_d.get("stage_number") or cur_d.get("stage") or "Unassigned",
                    "forecast_category": cur_d.get("forecast_category") or "Unassigned",
                    "deal": cur_d,
                })

        # Changes in existing deals
        for d_id, cur_d in cur_by_id.items():
            if d_id in prior_by_id:
                pr_d = prior_by_id[d_id]
                c_acv = float(cur_d.get("forecast_acv_amount") or 0.0)
                p_acv = float(pr_d.get("forecast_acv_amount") or 0.0)
                if abs(c_acv - p_acv) > 0.01:
                    diff_acv = round(c_acv - p_acv, 2)
                    what_changed["acv_changes"].append({
                        "id": d_id,
                        "opportunity_name": cur_d.get("opportunity_name") or d_id,
                        "account_name": cur_d.get("account_name") or "Unknown",
                        "old_acv": p_acv,
                        "new_acv": c_acv,
                        "diff_acv": diff_acv,
                        "deal": cur_d,
                    })

                c_stage = (cur_d.get("stage_number") or cur_d.get("stage") or "").strip()
                p_stage = (pr_d.get("stage_number") or pr_d.get("stage") or "").strip()
                if c_stage and p_stage and c_stage != p_stage:
                    what_changed["stage_changes"].append({
                        "id": d_id,
                        "opportunity_name": cur_d.get("opportunity_name") or d_id,
                        "account_name": cur_d.get("account_name") or "Unknown",
                        "old_stage": p_stage,
                        "new_stage": c_stage,
                        "deal": cur_d,
                    })

                c_cat = (cur_d.get("forecast_category") or "").strip()
                p_cat = (pr_d.get("forecast_category") or "").strip()
                if c_cat and p_cat and c_cat != p_cat:
                    what_changed["category_changes"].append({
                        "id": d_id,
                        "opportunity_name": cur_d.get("opportunity_name") or d_id,
                        "account_name": cur_d.get("account_name") or "Unknown",
                        "old_category": p_cat,
                        "new_category": c_cat,
                        "deal": cur_d,
                    })

                c_appr = (cur_d.get("approval_status") or "").strip()
                p_appr = (pr_d.get("approval_status") or "").strip()
                if c_appr and p_appr and c_appr != p_appr:
                    what_changed["approval_changes"].append({
                        "id": d_id,
                        "opportunity_name": cur_d.get("opportunity_name") or d_id,
                        "account_name": cur_d.get("account_name") or "Unknown",
                        "old_status": p_appr,
                        "new_status": c_appr,
                        "deal": cur_d,
                    })

                # Closed Won
                if ("Closed Won" in c_stage or c_cat == "Closed") and not ("Closed Won" in p_stage or p_cat == "Closed"):
                    what_changed["closed_won"].append({
                        "id": d_id,
                        "opportunity_name": cur_d.get("opportunity_name") or d_id,
                        "account_name": cur_d.get("account_name") or "Unknown",
                        "acv": c_acv,
                        "deal": cur_d,
                    })

        # Removed / Lost deals
        for d_id, pr_d in prior_by_id.items():
            if d_id not in cur_by_id:
                p_acv = float(pr_d.get("forecast_acv_amount") or 0.0)
                what_changed["removed_deals"].append({
                    "id": d_id,
                    "opportunity_name": pr_d.get("opportunity_name") or d_id,
                    "account_name": pr_d.get("account_name") or "Unknown",
                    "acv": p_acv,
                    "reason": "Removed from portfolio or period scope",
                    "deal": pr_d,
                })

        total_changes = (
            len(what_changed["new_deals"])
            + len(what_changed["acv_changes"])
            + len(what_changed["stage_changes"])
            + len(what_changed["category_changes"])
            + len(what_changed["approval_changes"])
            + len(what_changed["closed_won"])
            + len(what_changed["removed_deals"])
        )
        what_changed["total_changes"] = total_changes
        what_changed["has_changes"] = total_changes > 0

    # 8. Region Line (Single region sentence or Multi-region chips with country counts)
    REGION_DISPLAY = {
        "MENA": "MEA",
        "Middle East and North Africa": "MEA",
        "MEA": "MEA",
        "Middle East": "MEA",
        "NAMR": "North America",
        "NAMR GUAVUS": "North America",
        "North America": "North America",
        "South America": "LATAM",
        "LATAM": "LATAM",
        "AFRICA": "Africa",
        "Africa": "Africa",
        "Europe": "Europe",
        "West Europe": "Europe",
        "East Europe": "Europe",
        "APAC": "APAC",
        "SEAO": "APAC",
    }

    region_dict: dict[str, dict[str, Any]] = {}
    for d in deals:
        raw_sub = (d.get("revised_sub_region") or d.get("sub_region") or "").strip()
        r_name = REGION_DISPLAY.get(raw_sub, raw_sub or "Unassigned")
        c_name = (d.get("country_territory") or d.get("country") or "").strip() or "Unknown"
        d_acv = float(d.get("forecast_acv_amount") or 0.0)

        if r_name not in region_dict:
            region_dict[r_name] = {
                "region": r_name,
                "count": 0,
                "acv": 0.0,
                "countries": {},
                "deals": [],
            }
        region_dict[r_name]["count"] += 1
        region_dict[r_name]["acv"] = round(region_dict[r_name]["acv"] + d_acv, 2)
        region_dict[r_name]["countries"][c_name] = region_dict[r_name]["countries"].get(c_name, 0) + 1
        region_dict[r_name]["deals"].append(d)

    region_items = []
    for r_name, r_info in sorted(region_dict.items(), key=lambda x: x[1]["acv"], reverse=True):
        cnt = r_info["count"]
        acv = r_info["acv"]
        share_pct = round((acv / total_acv) * 100) if total_acv > 0 else 0
        acv_str = f"${acv / 1_000_000:.2f}M" if acv >= 1_000_000 else f"${acv / 1_000:.1f}K"
        chip_label = f"{r_name} · {cnt} deal{'s' if cnt > 1 else ''} · {acv_str} · {share_pct}%"
        sorted_countries = [
            {"country": c, "count": n}
            for c, n in sorted(r_info["countries"].items(), key=lambda x: (-x[1], x[0]))
        ]
        region_items.append({
            "region": r_name,
            "count": cnt,
            "acv": acv,
            "share_pct": share_pct,
            "label": chip_label,
            "countries": sorted_countries,
            "deals": r_info["deals"],
        })

    if len(region_items) == 1:
        single_region = True
        r0 = region_items[0]
        countries_summary = ", ".join([f"{c['country']} {c['count']}" for c in r0["countries"] if c["country"] != "Unknown"])
        if not countries_summary:
            countries_summary = ", ".join([f"{c['country']} {c['count']}" for c in r0["countries"]])
        deal_phrase = "1 deal is" if total_count == 1 else f"All {total_count} deals are"
        summary_sentence = f"{deal_phrase} in {r0['region']}: {countries_summary}." if countries_summary else f"{deal_phrase} in {r0['region']}."
    else:
        single_region = False
        summary_sentence = ""

    region_line = {
        "single_region": single_region,
        "summary_sentence": summary_sentence,
        "regions": region_items,
    }

    # 9. Chart Data Structures
    fc_chart = [
        {
            "name": cat,
            "category": cat,
            "count": fc_map[cat]["count"],
            "acv": fc_map[cat]["acv"],
            "deals": fc_map[cat]["deals"],
        }
        for cat in ["Closed", "Commit", "Best Case", "Pipeline", "Not yet proposed"]
    ]

    st_chart = [
        {
            "name": st,
            "status": st,
            "count": st_map[st]["count"],
            "acv": st_map[st]["acv"],
            "deals": st_map[st]["deals"],
            "approved_2nd_count": st_map[st].get("approved_2nd_count", 0),
            "approved_2nd_acv": st_map[st].get("approved_2nd_acv", 0.0),
        }
        for st in ["Approved", "Pending Approval", "Not submitted"]
    ]

    # Stage Funnel
    stage_agg: dict[str, dict[str, Any]] = {}
    for d in deals:
        st_label = str(d.get("stage_number") or d.get("stage") or "Unassigned").strip() or "Unassigned"
        if st_label not in stage_agg:
            stage_agg[st_label] = {"stage": st_label, "count": 0, "acv": 0.0, "deals": []}
        stage_agg[st_label]["count"] += 1
        stage_agg[st_label]["acv"] = round(stage_agg[st_label]["acv"] + float(d.get("forecast_acv_amount") or 0.0), 2)
        stage_agg[st_label]["deals"].append(d)
    stage_funnel = sorted(stage_agg.values(), key=lambda x: x["stage"])

    # Business Units
    bu_agg: dict[str, dict[str, Any]] = {}
    for d in deals:
        bu = str(d.get("business_unit_primary") or d.get("business_unit") or "Unassigned").strip() or "Unassigned"
        if bu not in bu_agg:
            bu_agg[bu] = {"bu": bu, "business_unit": bu, "count": 0, "acv": 0.0, "deals": []}
        bu_agg[bu]["count"] += 1
        bu_agg[bu]["acv"] = round(bu_agg[bu]["acv"] + float(d.get("forecast_acv_amount") or 0.0), 2)
        bu_agg[bu]["deals"].append(d)
    bu_chart = sorted(bu_agg.values(), key=lambda x: x["acv"], reverse=True)

    # Region / Country
    reg_agg: dict[str, dict[str, Any]] = {}
    for d in deals:
        reg = str(d.get("revised_sub_region") or d.get("sub_region") or d.get("region") or "Unassigned").strip() or "Unassigned"
        reg_display = REGION_DISPLAY.get(reg, reg)
        if reg_display not in reg_agg:
            reg_agg[reg_display] = {"region": reg_display, "count": 0, "acv": 0.0, "deals": []}
        reg_agg[reg_display]["count"] += 1
        reg_agg[reg_display]["acv"] = round(reg_agg[reg_display]["acv"] + float(d.get("forecast_acv_amount") or 0.0), 2)
        reg_agg[reg_display]["deals"].append(d)
    region_chart = sorted(reg_agg.values(), key=lambda x: x["acv"], reverse=True)

    # Monthly Close Timeline
    month_close_agg: dict[str, dict[str, Any]] = {}
    for d in deals:
        cd = d.get("close_date")
        m_str = cd[:7] if cd and len(cd) >= 7 else "No Date"
        if m_str not in month_close_agg:
            month_close_agg[m_str] = {"month": m_str, "count": 0, "acv": 0.0}
        month_close_agg[m_str]["count"] += 1
        month_close_agg[m_str]["acv"] = round(month_close_agg[m_str]["acv"] + float(d.get("forecast_acv_amount") or 0.0), 2)
    monthly_close_timeline = sorted(month_close_agg.values(), key=lambda x: x["month"])

    # Top Accounts
    acc_agg: dict[str, dict[str, Any]] = {}
    for d in deals:
        acc = str(d.get("account_name") or "Unknown").strip()
        if acc not in acc_agg:
            acc_agg[acc] = {"account_name": acc, "count": 0, "acv": 0.0, "deals": []}
        acc_agg[acc]["count"] += 1
        acc_agg[acc]["acv"] = round(acc_agg[acc]["acv"] + float(d.get("forecast_acv_amount") or 0.0), 2)
        acc_agg[acc]["deals"].append(d)
    top_accounts = sorted(acc_agg.values(), key=lambda x: x["acv"], reverse=True)[:10]

    # Deal Size Bands
    size_bands = [
        {"band": "< $50k", "min": 0, "max": 50000, "count": 0, "acv": 0.0},
        {"band": "$50k - $100k", "min": 50000, "max": 100000, "count": 0, "acv": 0.0},
        {"band": "$100k - $250k", "min": 100000, "max": 250000, "count": 0, "acv": 0.0},
        {"band": "$250k - $500k", "min": 250000, "max": 500000, "count": 0, "acv": 0.0},
        {"band": "$500k+", "min": 500000, "max": 1000000000.0, "count": 0, "acv": 0.0},
    ]
    for d in deals:
        amt = float(d.get("forecast_acv_amount") or 0.0)
        for b in size_bands:
            if b["min"] <= amt < b["max"]:
                b["count"] += 1
                b["acv"] = round(b["acv"] + amt, 2)
                break

    # 10. Action Lists (Excluding Closed Deals from Immediate Attention)
    immediate_attention = [
        d for d in deals
        if is_deal_open(d) and (
            (d.get("forecast_category") == "Commit" and d.get("approval_status") not in ("Approved", "Approved - 2nd"))
            or is_deal_overdue(d, snap.snapshot_date)
        )
    ]
    not_submitted_deals = [d for d in deals if is_deal_open(d) and d.get("approval_status") in ("Not submitted", "Blank", "", None)]

    # 11. Plain Language Insight Statements (3 concise sentences + Concentration)
    insights = []
    unapproved_commit = [d for d in deals if is_deal_open(d) and d.get("forecast_category") == "Commit" and d.get("approval_status") not in ("Approved", "Approved - 2nd")]
    if unapproved_commit:
        u_acv = sum(float(d.get("forecast_acv_amount") or 0.0) for d in unapproved_commit)
        insights.append(f"{len(unapproved_commit)} Commit deal{'s' if len(unapproved_commit) > 1 else ''} worth ${u_acv:,.2f} {'are' if len(unapproved_commit) > 1 else 'is'} awaiting management approval.")
    else:
        insights.append("All Commit category deals are approved.")

    if deals:
        largest = max(deals, key=lambda x: float(x.get("forecast_acv_amount") or 0.0))
        insights.append(f"Largest deal: {largest.get('opportunity_name') or largest.get('id')} ({largest.get('account_name')}) at ${float(largest.get('forecast_acv_amount') or 0):,.2f}.")
    else:
        insights.append("No active deals in the selected period.")

    if delayed_count > 0:
        insights.append(f"Delayed renewals: {delayed_count} deal{'s' if delayed_count > 1 else ''} totaling ${delayed_acv:,.2f}.")
    elif slippage_count > 0:
        insights.append(f"Slippage risk: {slippage_count} deal{'s' if slippage_count > 1 else ''} totaling ${slippage_acv:,.2f} moved into next year.")
    elif needs_review_count > 0:
        insights.append(f"Needs review: {needs_review_count} deal{'s' if needs_review_count > 1 else ''} require review (missing service dates or negative ACV).")
    else:
        insights.append("No delayed renewals in your portfolio.")

    # 12. Renewal Progress (Closed vs Open)
    closed_deals = [d for d in deals if not is_deal_open(d)]
    open_deals = [d for d in deals if is_deal_open(d)]
    closed_cnt = len(closed_deals)
    closed_val = round(sum(float(d.get("forecast_acv_amount") or 0.0) for d in closed_deals), 2)
    open_cnt = len(open_deals)
    open_val = round(sum(float(d.get("forecast_acv_amount") or 0.0) for d in open_deals), 2)
    closed_pct = round((closed_val / total_acv) * 100) if total_acv > 0 else 0

    def _fmt_strip_cur(val: float) -> str:
        sign = "-" if val < 0 else ""
        a = abs(val)
        if a >= 1_000_000:
            return f"{sign}${a / 1_000_000:.2f}M"
        elif a >= 1_000:
            return f"{sign}${a / 1_000:.0f}K"
        return f"{sign}${a:,.2f}"

    total_deal_word = "deal" if total_count == 1 else "deals"
    open_deal_word = "deal" if open_cnt == 1 else "deals"
    renewal_progress = {
        "closed_count": closed_cnt,
        "closed_acv": closed_val,
        "closed_pct": closed_pct,
        "open_count": open_cnt,
        "open_acv": open_val,
        "summary_sentence": f"{closed_cnt} of {total_count} {total_deal_word} closed: {_fmt_strip_cur(closed_val)} of {_fmt_strip_cur(total_acv)} ({closed_pct}%). Open: {open_cnt} {open_deal_word}, {_fmt_strip_cur(open_val)}",
    }

    # 13. Account Concentration
    if top_accounts and total_acv > 0:
        top_acc = top_accounts[0]
        top_acc_name = top_acc["account_name"]
        top_acc_pct = round((top_acc["acv"] / total_acv) * 100)
        account_concentration = {
            "account_name": top_acc_name,
            "acv": top_acc["acv"],
            "pct": top_acc_pct,
            "sentence": f"{top_acc_name} is {top_acc_pct}% of your ACV.",
        }
    else:
        account_concentration = {
            "account_name": None,
            "acv": 0.0,
            "pct": 0,
            "sentence": "",
        }

    # 14. Closing Soon & Overdue (Open deals only)
    closing_soon_days = int(SettingsService.get_setting(db, "closing_soon_days", "30") or 30)
    expiry_window_days = int(SettingsService.get_setting(db, "expiry_window_days", "60") or 60)

    closing_soon_and_overdue = []
    for d in deals:
        if not is_deal_open(d):
            continue
        cd_str = d.get("close_date")
        if not cd_str:
            continue
        cd = parse_excel_date(cd_str)
        if not cd:
            continue
        if cd < snap.snapshot_date:
            days_diff = (snap.snapshot_date - cd).days
            reason = "Past close date"
            if d.get("forecast_category") == "Commit" and d.get("approval_status") not in ("Approved", "Approved - 2nd"):
                reason = f"Commit, {d.get('approval_status') or 'not submitted'}"
            closing_soon_and_overdue.append({
                "deal": d,
                "opportunity_name": d.get("opportunity_name") or d.get("id"),
                "account_name": d.get("account_name"),
                "forecast_category": d.get("forecast_category"),
                "approval_status": d.get("approval_status"),
                "acv": float(d.get("forecast_acv_amount") or 0.0),
                "status": "overdue",
                "days_label": f"{days_diff}d overdue",
                "days_diff": -days_diff,
                "close_date": cd.isoformat(),
                "reason": reason,
            })
        elif snap.snapshot_date <= cd <= snap.snapshot_date + timedelta(days=closing_soon_days):
            days_diff = (cd - snap.snapshot_date).days
            reason = f"Closing in {days_diff}d"
            if d.get("forecast_category") == "Commit" and d.get("approval_status") not in ("Approved", "Approved - 2nd"):
                reason = f"Commit, {d.get('approval_status') or 'not submitted'}"
            closing_soon_and_overdue.append({
                "deal": d,
                "opportunity_name": d.get("opportunity_name") or d.get("id"),
                "account_name": d.get("account_name"),
                "forecast_category": d.get("forecast_category"),
                "approval_status": d.get("approval_status"),
                "acv": float(d.get("forecast_acv_amount") or 0.0),
                "status": "closing_soon",
                "days_label": f"{days_diff}d left" if days_diff > 0 else "Closes today",
                "days_diff": days_diff,
                "close_date": cd.isoformat(),
                "reason": reason,
            })
    closing_soon_and_overdue.sort(key=lambda x: x["days_diff"])

    # 15. Upcoming Service Expiry
    upcoming_service_expiry = []
    for d in deals:
        s_exp_str = d.get("service_expiry_date") or d.get("service_end_date")
        if not s_exp_str:
            continue
        s_exp = parse_excel_date(s_exp_str)
        if not s_exp:
            continue
        if snap.snapshot_date <= s_exp <= snap.snapshot_date + timedelta(days=expiry_window_days):
            days_left = (s_exp - snap.snapshot_date).days
            upcoming_service_expiry.append({
                "deal": d,
                "opportunity_name": d.get("opportunity_name") or d.get("id"),
                "account_name": d.get("account_name"),
                "acv": float(d.get("forecast_acv_amount") or 0.0),
                "service_expiry_date": s_exp.isoformat(),
                "days_left": days_left,
                "days_label": f"{days_left}d left" if days_left > 0 else "Expires today",
            })
    upcoming_service_expiry.sort(key=lambda x: x["days_left"])

    # 16. Messages & Comments Summary
    open_threads_cnt = (
        db.query(func.count(func.distinct(DealMessage.deal_id)))
        .filter(DealMessage.deal_id.in_(owned_ids))
        .scalar()
    ) if owned_ids else 0

    shared_comments = []
    if owned_ids:
        from backend.utils.time_utils import to_utc_iso
        comments_q = (
            db.query(DealComment)
            .filter(
                DealComment.opportunity_id_18.in_(owned_ids),
                DealComment.is_deleted == False,
                DealComment.visibility.in_(["shared", "shared_with_owner", "all", "public"]),
            )
            .order_by(DealComment.created_at.desc())
            .limit(5)
            .all()
        )
        deal_name_map = {d["opportunity_id_18"]: d.get("opportunity_name") or d.get("account_name") for d in deals}
        for sc in comments_q:
            author_disp = "Admin" if (not ctx.is_admin and sc.author_role == "admin") else sc.author
            shared_comments.append({
                "id": sc.id,
                "deal_id": sc.opportunity_id_18,
                "deal_name": deal_name_map.get(sc.opportunity_id_18, sc.opportunity_id_18),
                "author": author_disp,
                "author_role": sc.author_role,
                "text": sc.text,
                "created_at": to_utc_iso(sc.created_at),
                "created_at_formatted": sc.created_at.strftime("%b %d, %Y") if sc.created_at else "",
            })

    messages_and_comments_summary = {
        "open_threads": open_threads_cnt or 0,
        "unread_count": unread_msg_count,
        "latest_shared_comments": shared_comments,
    }

    # 17. Data Notes (Reconciliation excluded + Missing service dates)
    all_snap_rows, _ = analytics_cache.get_snapshot_lite_data(db, snap.id)
    allowed_set = set(allowed_owners)
    recon_opps = [
        o for o in all_snap_rows
        if o.opportunity_owner in allowed_set and bool(o.is_reconciliation_entry)
    ]
    recon_cnt = len(recon_opps)
    recon_acv = round(sum(float(o.forecast_acv_amount or 0.0) for o in recon_opps), 2)
    recon_acv_str = f"-${abs(recon_acv):,.2f}" if recon_acv < 0 else f"${recon_acv:,.2f}"
    notes_parts = []
    if recon_cnt > 0:
        notes_parts.append(f"{recon_cnt} reconciliation {'entry' if recon_cnt == 1 else 'entries'} ({recon_acv_str}) {'is' if recon_cnt == 1 else 'are'} excluded from these totals.")
    if len(missing_dates_deals) > 0:
        notes_parts.append(f"{len(missing_dates_deals)} deal{'s' if len(missing_dates_deals) != 1 else ''} have no service dates.")

    data_notes = {
        "reconciliation_excluded_count": recon_cnt,
        "reconciliation_excluded_acv": recon_acv,
        "missing_service_dates_count": len(missing_dates_deals),
        "note_text": " · ".join(notes_parts) if notes_parts else "",
    }

    kpis_dict = {
        "total_count": total_count,
        "total_acv": total_acv,
        "commit_coverage_count": commit_cov_count,
        "commit_coverage_acv": commit_cov_acv,
        "commit_count": fc_map["Commit"]["count"],
        "commit_acv": fc_map["Commit"]["acv"],
        "closed_count": fc_map["Closed"]["count"],
        "closed_acv": fc_map["Closed"]["acv"],
        "best_case_count": fc_map["Best Case"]["count"],
        "best_case_acv": fc_map["Best Case"]["acv"],
        "pipeline_count": fc_map["Pipeline"]["count"],
        "pipeline_acv": fc_map["Pipeline"]["acv"],
        "approved_count": st_map["Approved"]["count"],
        "approved_acv": st_map["Approved"]["acv"],
        "approved_2nd_count": st_map["Approved"]["approved_2nd_count"],
        "approved_2nd_acv": st_map["Approved"]["approved_2nd_acv"],
        "approved_2nd_breakdown": (
            f"incl. {st_map['Approved']['approved_2nd_count']} Approved 2nd (${st_map['Approved']['approved_2nd_acv']:,.2f})"
            if st_map['Approved']['approved_2nd_count'] > 0 else None
        ),
        "pending_approval_count": st_map["Pending Approval"]["count"],
        "pending_approval_acv": st_map["Pending Approval"]["acv"],
        "not_submitted_count": st_map["Not submitted"]["count"],
        "not_submitted_acv": st_map["Not submitted"]["acv"],
        "delayed_count": delayed_count,
        "delayed_acv": delayed_acv,
        "slippage_count": slippage_count,
        "slippage_acv": slippage_acv,
        "needs_review_count": needs_review_count,
        "needs_review_acv": needs_review_acv,
        "unread_messages": unread_msg_count,
    }

    # All open deals totals across all periods for this KAM
    all_fs = FilterSpec.from_params(
        as_of=as_of,
        period="all_open",
        types=types,
        allowed_owners=allowed_owners,
        user_context=ctx,
    )
    all_res = ScopeService.resolve(all_fs, snapshot=snap, as_of_date=snap.snapshot_date, db=db)
    all_opps = (
        db.query(Opportunity)
        .filter(Opportunity.snapshot_id == snap.id, *all_res.conditions)
        .all()
    )
    total_all_count = len(all_opps)
    total_all_acv = round(sum(float(o.forecast_acv_amount or 0.0) for o in all_opps), 2)
    other_periods_count = max(0, total_all_count - total_count)
    other_periods_acv = round(max(0.0, total_all_acv - total_acv), 2)

    if period in ("all_open", "all_open_deals", "all_periods", "all", "All open deals", "All periods") or res.data_slice == "all_open":
        eff_period_label = "All periods"
    elif period in ("current_quarter", None, ""):
        eff_period_label = f"Current quarter ({res.data_slice})"
    elif period == "next_quarter":
        eff_period_label = f"Next quarter ({res.data_slice})"
    else:
        eff_period_label = res.data_slice

    return {
        "period": eff_period_label,
        "resolved_quarter": res.resolved_quarter,
        "period_info": {
            "selected_period": period,
            "period_label": eff_period_label,
            "showing_count": total_count,
            "showing_acv": round(total_acv, 2),
            "total_all_count": total_all_count,
            "total_all_acv": total_all_acv,
            "other_periods_count": other_periods_count,
            "other_periods_acv": other_periods_acv,
        },
        "as_of": snap.snapshot_date.isoformat(),
        "as_of_date_formatted": snap.snapshot_date.strftime("%b %d, %Y"),
        "compare_as_of": compare_snap.snapshot_date.isoformat() if compare_snap else None,
        "compare_as_of_formatted": compare_snap.snapshot_date.strftime("%b %d, %Y") if compare_snap else None,
        "owner_name": effective_owner_name,
        "kpis": kpis_dict,
        "total": {"count": total_count, "acv": total_acv},
        "forecast_categories": fc_map,
        "approval_statuses": st_map,
        "delayed": {"count": delayed_count, "acv": delayed_acv, "deals": delayed_deals},
        "slippage": {"count": slippage_count, "acv": slippage_acv, "deals": slippage_deals},
        "movements": {
            "delta_compare": delta_compare,
            "delta_yesterday": delta_yesterday,
            "delta_lastweek": delta_lastweek,
            "compare_date_formatted": compare_snap.snapshot_date.strftime("%b %d, %Y") if compare_snap else None,
        },
        "region_line": region_line,
        "what_changed": what_changed,
        "charts": {
            "forecast_category": fc_chart,
            "approval_status": st_chart,
            "stage_funnel": stage_funnel,
            "business_units": bu_chart,
            "regions": region_chart,
            "monthly_close_timeline": monthly_close_timeline,
            "top_accounts": top_accounts,
            "deal_size_bands": size_bands,
        },
        "action_lists": {
            "immediate_attention": immediate_attention,
            "delayed_deals": delayed_deals,
            "slippage_deals": slippage_deals,
            "not_submitted_deals": not_submitted_deals,
            "missing_service_dates": missing_dates_deals,
            "needs_review_deals": needs_review_deals,
        },
        "renewal_progress": renewal_progress,
        "account_concentration": account_concentration,
        "closing_soon_and_overdue": closing_soon_and_overdue,
        "upcoming_service_expiry": upcoming_service_expiry,
        "messages_and_comments_summary": messages_and_comments_summary,
        "data_notes": data_notes,
        "insight_cards": insights[:3],
        "deals": deals,
    }


@router.get("/deals")
def get_kam_deals(
    as_of: Optional[str] = Query(None),
    period: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None),
    bu: Optional[str] = Query(None),
    types: Optional[str] = Query(None),
    owner_override: Optional[str] = Query(None),
    ctx: UserContext = Depends(_require_kam_or_management),
    db: Session = Depends(get_db),
):
    """
    Returns full list of opportunities for this KAM with all metadata,
    search, and filters.
    """
    allowed_owners = ctx.all_owner_names
    if (ctx.is_admin or ctx.is_management) and owner_override:
        allowed_owners = [owner_override.strip()]

    if not allowed_owners:
        return {"count": 0, "acv": 0.0, "deals": [], "period_info": {}}

    snap = _resolve_snapshot(db, as_of)
    if not snap:
        return {"count": 0, "acv": 0.0, "deals": [], "period_info": {}}

    kam_default = SettingsService.get_kam_default_period(db)
    if not isinstance(period, str) or not period:
        period = getattr(period, "default", kam_default) or kam_default

    fs = FilterSpec.from_params(
        as_of=as_of,
        period=period,
        types=types,
        allowed_owners=allowed_owners,
        user_context=ctx,
    )
    res = ScopeService.resolve(fs, snapshot=snap, as_of_date=snap.snapshot_date, db=db)

    from backend.services.cache_service import analytics_cache
    opps = analytics_cache.query_scoped_lite(db, snap.id, res.conditions)

    deals = [serialize_opportunity(o) for o in opps]

    if category and category != "All":
        deals = [d for d in deals if d.get("forecast_category") == category]
    if status_filter and status_filter != "All":
        deals = [d for d in deals if d.get("approval_status") == status_filter]
    if bu and bu != "All":
        deals = [d for d in deals if d.get("business_unit") == bu or d.get("business_unit_primary") == bu]
    if search:
        s_lower = search.strip().lower()
        deals = [
            d for d in deals
            if s_lower in (d.get("opportunity_name") or "").lower()
            or s_lower in (d.get("account_name") or "").lower()
            or s_lower in (d.get("id") or "").lower()
        ]

    deals.sort(key=lambda d: float(d.get("forecast_acv_amount") or 0.0), reverse=True)

    cur_count = len(deals)
    cur_acv = round(sum(float(d.get("forecast_acv_amount") or 0.0) for d in deals), 2)

    # Calculate all-periods totals for "M more deals in other periods" banner
    all_fs = FilterSpec.from_params(
        as_of=as_of,
        period="all_open",
        types=types,
        allowed_owners=allowed_owners,
        user_context=ctx,
    )
    all_res = ScopeService.resolve(all_fs, snapshot=snap, as_of_date=snap.snapshot_date, db=db)
    all_opps = (
        db.query(Opportunity)
        .filter(Opportunity.snapshot_id == snap.id, *all_res.conditions)
        .all()
    )
    total_all_count = len(all_opps)
    total_all_acv = round(float(sum(o.forecast_acv_amount or 0.0 for o in all_opps)), 2)
    other_periods_count = max(0, total_all_count - cur_count)
    other_periods_acv = round(max(0.0, total_all_acv - cur_acv), 2)

    if period in ("all_open", "all_open_deals", "all_periods", "all", "All open deals", "All periods") or res.data_slice == "all_open":
        eff_period_label = "All periods"
    elif period in ("current_quarter", None, ""):
        eff_period_label = f"Current quarter ({res.data_slice})"
    elif period == "next_quarter":
        eff_period_label = f"Next quarter ({res.data_slice})"
    else:
        eff_period_label = res.data_slice

    return {
        "count": cur_count,
        "acv": cur_acv,
        "period": eff_period_label,
        "period_info": {
            "selected_period": period,
            "period_label": eff_period_label,
            "showing_count": cur_count,
            "showing_acv": cur_acv,
            "total_all_count": total_all_count,
            "total_all_acv": total_all_acv,
            "other_periods_count": other_periods_count,
            "other_periods_acv": other_periods_acv,
        },
        "deals": deals,
    }


@router.get("/report/pptx")
def get_kam_report_pptx(
    as_of: Optional[str] = Query(None),
    period: Optional[str] = Query(None),
    compare: Optional[str] = Query(None),
    types: Optional[str] = Query(None),
    owner_override: Optional[str] = Query(None),
    ctx: UserContext = Depends(_require_kam_or_management),
    db: Session = Depends(get_db),
):
    """
    Download a branded PowerPoint report scoped strictly to the KAM's deals.
    Matches the KAM Overview: tiles, insights, region line, forecast/approval, BU, top accounts, action items, what changed.
    """
    kam_default = SettingsService.get_kam_default_period(db)
    if not isinstance(period, str) or not period:
        period = getattr(period, "default", kam_default) or kam_default

    overview_data = get_kam_overview(
        as_of=as_of,
        period=period,
        compare=compare,
        types=types,
        owner_override=owner_override,
        ctx=ctx,
        db=db,
    )
    if "error" in overview_data:
        raise HTTPException(status_code=404, detail="No snapshot available for report generation.")

    owner_name = overview_data.get("owner_name") or ctx.owner_name or ctx.display_name
    kam_name = ctx.display_name or ctx.email or "KAM"
    deals = overview_data.get("deals") or []

    buf = KamReportService.generate_pptx_report(
        kam_name=kam_name,
        owner_name=owner_name,
        period=overview_data.get("period") or period or "All periods",
        as_of_date=overview_data.get("as_of") or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        overview_data=overview_data,
        deals=deals,
        compare_as_of_date=overview_data.get("compare_as_of"),
    )

    clean_owner = owner_name.replace(" ", "_").replace("/", "_")
    period_tag = "all_periods" if (overview_data.get('period') in ('All periods', 'all_open')) else (overview_data.get('period') or 'all_periods')
    filename = f"KAM_Report_{clean_owner}_{period_tag}.pptx"

    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )


@router.get("/report/pdf")
def get_kam_report_pdf(
    as_of: Optional[str] = Query(None),
    period: Optional[str] = Query(None),
    compare: Optional[str] = Query(None),
    types: Optional[str] = Query(None),
    owner_override: Optional[str] = Query(None),
    ctx: UserContext = Depends(_require_kam_or_management),
    db: Session = Depends(get_db),
):
    """
    Download a branded multi-page PDF report scoped strictly to the KAM's deals.
    Matches the KAM Overview: tiles, insights, region line, forecast/approval, BU, top accounts, action items, what changed.
    """
    kam_default = SettingsService.get_kam_default_period(db)
    if not isinstance(period, str) or not period:
        period = getattr(period, "default", kam_default) or kam_default
    overview_data = get_kam_overview(
        as_of=as_of,
        period=period,
        compare=compare,
        types=types,
        owner_override=owner_override,
        ctx=ctx,
        db=db,
    )
    if "error" in overview_data:
        raise HTTPException(status_code=404, detail="No snapshot available for report generation.")

    owner_name = overview_data.get("owner_name") or ctx.owner_name or ctx.display_name
    kam_name = ctx.display_name or ctx.email or "KAM"
    deals = overview_data.get("deals") or []

    buf = KamReportService.generate_pdf_report(
        kam_name=kam_name,
        owner_name=owner_name,
        period=overview_data.get("period") or period or "All periods",
        as_of_date=overview_data.get("as_of") or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        overview_data=overview_data,
        deals=deals,
        compare_as_of_date=overview_data.get("compare_as_of"),
    )

    clean_owner = owner_name.replace(" ", "_").replace("/", "_")
    period_tag = "all_periods" if (overview_data.get('period') in ('All periods', 'all_open')) else (overview_data.get('period') or 'all_periods')
    filename = f"KAM_Report_{clean_owner}_{period_tag}.pdf"

    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )
