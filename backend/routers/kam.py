"""
KAM Portal Router (Round 18 & Round 22).
Endpoints for My Overview, My Deals, My Reports (PPTX / PDF), and My Account.
Strictly isolated to the authenticated KAM's own opportunities (via owner_name and aliases).
Admin and Management can optionally supply `owner_override` to view or export a specific KAM's data.
"""
from __future__ import annotations

import logging
from typing import Optional, List, Dict, Any
from datetime import date, datetime, timezone
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, or_

from backend.database import get_db
from backend.models.opportunity import Opportunity
from backend.models.snapshot import UploadSnapshot
from backend.models.user import User, DealMessage
from backend.services.context import UserContext, require_authenticated
from backend.services.scopes import FilterSpec, ScopeService
from backend.services.deal_serializer import serialize_opportunity
from backend.services.v2_delayed_service import V2DelayedService
from backend.services.kam_report_service import KamReportService
from backend.services.settings_service import SettingsService

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
    compare: Optional[str] = Query("yesterday"),
    types: Optional[str] = Query(None),
    owner_override: Optional[str] = Query(None),
    ctx: UserContext = Depends(_require_kam_or_management),
    db: Session = Depends(get_db),
):
    """
    Returns KAM's personal portfolio metrics:
    - Period totals: deals count, total ACV
    - KPI tiles: Portfolio, Commit coverage, Approvals, Delayed, Slippage, Needs Review, Unread messages
    - Movements vs yesterday and last week
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
            "pending_approval_count": 0, "pending_approval_acv": 0.0,
            "not_submitted_count": 0, "not_submitted_acv": 0.0,
            "delayed_count": 0, "delayed_acv": 0.0,
            "slippage_count": 0, "slippage_acv": 0.0,
            "needs_review_count": 0, "needs_review_acv": 0.0,
            "unread_messages": 0,
        }
        return {
            "period": period,
            "owner_name": effective_owner_name,
            "kpis": empty_kpis,
            "total": {"count": 0, "acv": 0.0},
            "forecast_categories": {},
            "approval_statuses": {},
            "charts": {},
            "action_lists": {},
            "insight_cards": ["No opportunities found for current owner."],
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

    opps = (
        db.query(Opportunity)
        .filter(Opportunity.snapshot_id == snap.id, *res.conditions)
        .all()
    )

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
        "Approved": {"count": 0, "acv": 0.0, "deals": []},
        "Pending Approval": {"count": 0, "acv": 0.0, "deals": []},
        "Not submitted": {"count": 0, "acv": 0.0, "deals": []},
    }
    for d in deals:
        st = (d.get("approval_status") or "Not submitted").strip()
        if st in ("Approved", "Approved - 2nd"):
            norm_st = "Approved"
        elif st in ("Pending Approval", "Pending-Approval"):
            norm_st = "Pending Approval"
        else:
            norm_st = "Not submitted"
        st_map[norm_st]["count"] += 1
        st_map[norm_st]["acv"] = round(st_map[norm_st]["acv"] + float(d.get("forecast_acv_amount") or 0.0), 2)
        st_map[norm_st]["deals"].append(d)

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

    # 4. Needs Review (Missing service start or expiry date)
    missing_dates_deals = [
        d for d in deals
        if not d.get("service_start_date") or not d.get("service_expiry_date")
    ]
    needs_review_count = len(missing_dates_deals)
    needs_review_acv = round(sum(float(d.get("forecast_acv_amount") or 0.0) for d in missing_dates_deals), 2)

    # 5. Unread Messages for this KAM
    owned_ids = [d["opportunity_id_18"] for d in deals if d.get("opportunity_id_18")]
    msg_q = db.query(DealMessage).filter(DealMessage.is_read == False)
    if ctx.user_id:
        msg_q = msg_q.filter(
            or_(
                DealMessage.recipient_id == ctx.user_id,
                (DealMessage.deal_id.in_(owned_ids) & (DealMessage.sender_role != "kam"))
            )
        )
    else:
        msg_q = msg_q.filter(DealMessage.deal_id.in_(owned_ids), DealMessage.sender_role != "kam")
    unread_msg_count = msg_q.count()

    # 6. Movements vs Yesterday & Last Week
    y_snap = delayed_svc.get_yesterday_baseline(snap)
    w_snap = delayed_svc.get_lastweek_baseline(snap)

    def _compute_delta(base_snap: UploadSnapshot | None) -> dict[str, Any]:
        if not base_snap:
            return {"count": None, "acv": None, "available": False, "label": "n/a"}
        b_opps = (
            db.query(Opportunity)
            .filter(Opportunity.snapshot_id == base_snap.id, *res.conditions)
            .all()
        )
        b_cnt = len(b_opps)
        b_acv = round(sum(float(o.forecast_acv_amount or 0.0) for o in b_opps), 2)
        diff_cnt = total_count - b_cnt
        diff_acv = round(total_acv - b_acv, 2)
        return {
            "count": diff_cnt,
            "acv": diff_acv,
            "available": True,
            "label": f"{'+' if diff_cnt > 0 else ''}{diff_cnt} deals / {'+' if diff_acv > 0 else ''}${diff_acv:,.2f}",
        }

    delta_yesterday = _compute_delta(y_snap)
    delta_lastweek = _compute_delta(w_snap)

    # 7. Chart Data Structures
    fc_chart = [
        {"name": cat, "category": cat, "count": fc_map[cat]["count"], "acv": fc_map[cat]["acv"]}
        for cat in ["Closed", "Commit", "Best Case", "Pipeline", "Not yet proposed"]
    ]

    st_chart = [
        {"name": st, "status": st, "count": st_map[st]["count"], "acv": st_map[st]["acv"]}
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
            bu_agg[bu] = {"bu": bu, "count": 0, "acv": 0.0, "deals": []}
        bu_agg[bu]["count"] += 1
        bu_agg[bu]["acv"] = round(bu_agg[bu]["acv"] + float(d.get("forecast_acv_amount") or 0.0), 2)
        bu_agg[bu]["deals"].append(d)
    bu_chart = sorted(bu_agg.values(), key=lambda x: x["acv"], reverse=True)

    # Region / Country
    reg_agg: dict[str, dict[str, Any]] = {}
    for d in deals:
        reg = str(d.get("sub_region") or d.get("region") or "Unmapped").strip() or "Unmapped"
        if reg not in reg_agg:
            reg_agg[reg] = {"region": reg, "count": 0, "acv": 0.0, "deals": []}
        reg_agg[reg]["count"] += 1
        reg_agg[reg]["acv"] = round(reg_agg[reg]["acv"] + float(d.get("forecast_acv_amount") or 0.0), 2)
        reg_agg[reg]["deals"].append(d)
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
            acc_agg[acc] = {"account_name": acc, "count": 0, "acv": 0.0}
        acc_agg[acc]["count"] += 1
        acc_agg[acc]["acv"] = round(acc_agg[acc]["acv"] + float(d.get("forecast_acv_amount") or 0.0), 2)
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

    # 8. Action Lists
    immediate_attention = [
        d for d in deals
        if (d.get("forecast_category") == "Commit" and d.get("approval_status") != "Approved")
        or (d.get("close_date") and d.get("close_date") < snap.snapshot_date.isoformat() and d.get("forecast_category") != "Closed")
    ]
    not_submitted_deals = [d for d in deals if d.get("approval_status") in ("Not submitted", "Blank", "", None)]

    # 9. Plain Language Insight Statements
    insights = []
    unapproved_commit = [d for d in deals if d.get("forecast_category") == "Commit" and d.get("approval_status") != "Approved"]
    if unapproved_commit:
        u_acv = sum(float(d.get("forecast_acv_amount") or 0.0) for d in unapproved_commit)
        insights.append(f"{len(unapproved_commit)} Commit deal{'s' if len(unapproved_commit) > 1 else ''} worth ${u_acv:,.2f} {'are' if len(unapproved_commit) > 1 else 'is'} awaiting management approval.")
    else:
        insights.append("All Commit category deals are approved.")

    if deals:
        largest = max(deals, key=lambda x: float(x.get("forecast_acv_amount") or 0.0))
        insights.append(f"Largest deal: {largest.get('opportunity_name') or largest.get('id')} ({largest.get('account_name')}) at ${float(largest.get('forecast_acv_amount') or 0):,.2f}.")

    if delayed_count > 0:
        insights.append(f"Delayed renewals: {delayed_count} deal{'s' if delayed_count > 1 else ''} totaling ${delayed_acv:,.2f}.")
    else:
        insights.append("No delayed renewals in your portfolio.")

    if slippage_count > 0:
        insights.append(f"Slippage risk: {slippage_count} deal{'s' if slippage_count > 1 else ''} totaling ${slippage_acv:,.2f} moved into next year.")

    if needs_review_count > 0:
        insights.append(f"Needs review: {needs_review_count} deal{'s' if needs_review_count > 1 else ''} missing service dates.")

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
    total_all_acv = round(float(sum(o.forecast_acv_amount or 0.0 for o in all_opps)), 2)
    other_periods_count = max(0, total_all_count - total_count)
    other_periods_acv = round(max(0.0, total_all_acv - total_acv), 2)

    return {
        "period": res.data_slice,
        "resolved_quarter": res.resolved_quarter,
        "period_info": {
            "selected_period": period,
            "period_label": res.data_slice,
            "showing_count": total_count,
            "showing_acv": round(total_acv, 2),
            "total_all_count": total_all_count,
            "total_all_acv": total_all_acv,
            "other_periods_count": other_periods_count,
            "other_periods_acv": other_periods_acv,
        },
        "as_of": snap.snapshot_date.isoformat(),
        "owner_name": effective_owner_name,
        "kpis": kpis_dict,
        "total": {"count": total_count, "acv": total_acv},
        "forecast_categories": fc_map,
        "approval_statuses": st_map,
        "delayed": {"count": delayed_count, "acv": delayed_acv, "deals": delayed_deals},
        "slippage": {"count": slippage_count, "acv": slippage_acv, "deals": slippage_deals},
        "movements": {
            "delta_yesterday": delta_yesterday,
            "delta_lastweek": delta_lastweek,
        },
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
        },
        "insight_cards": insights,
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

    opps = (
        db.query(Opportunity)
        .filter(Opportunity.snapshot_id == snap.id, *res.conditions)
        .all()
    )

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

    return {
        "count": cur_count,
        "acv": cur_acv,
        "period": res.data_slice,
        "period_info": {
            "selected_period": period,
            "period_label": res.data_slice,
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
    types: Optional[str] = Query(None),
    owner_override: Optional[str] = Query(None),
    ctx: UserContext = Depends(_require_kam_or_management),
    db: Session = Depends(get_db),
):
    """
    Download a branded 4-6 slide PowerPoint report scoped strictly to the KAM's deals.
    """
    kam_default = SettingsService.get_kam_default_period(db)
    if not isinstance(period, str) or not period:
        period = getattr(period, "default", kam_default) or kam_default

    overview_data = get_kam_overview(
        as_of=as_of,
        period=period,
        types=types,
        compare="yesterday",
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
        period=overview_data.get("period") or period or "All open deals",
        as_of_date=overview_data.get("as_of") or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        overview_data=overview_data,
        deals=deals,
    )

    clean_owner = owner_name.replace(" ", "_").replace("/", "_")
    filename = f"KAM_Report_{clean_owner}_{overview_data.get('period') or 'all_open'}.pptx"

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
    types: Optional[str] = Query(None),
    owner_override: Optional[str] = Query(None),
    ctx: UserContext = Depends(_require_kam_or_management),
    db: Session = Depends(get_db),
):
    """
    Download a branded multi-page PDF report scoped strictly to the KAM's deals.
    """
    kam_default = SettingsService.get_kam_default_period(db)
    if not isinstance(period, str) or not period:
        period = getattr(period, "default", kam_default) or kam_default
    overview_data = get_kam_overview(
        as_of=as_of,
        period=period,
        types=types,
        compare="yesterday",
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
        period=overview_data.get("period") or period or "Q4-2026",
        as_of_date=overview_data.get("as_of") or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        overview_data=overview_data,
        deals=deals,
    )

    clean_owner = owner_name.replace(" ", "_").replace("/", "_")
    filename = f"KAM_Report_{clean_owner}_{overview_data.get('period') or 'Q4'}.pdf"

    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )
