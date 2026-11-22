"""
KAM Portal Router (Round 18).
Endpoints for My Overview, My Deals, and My Account.
Strictly isolated to the authenticated KAM's own opportunities (via owner_name and aliases).
"""
from __future__ import annotations

import logging
from typing import Optional, List
from datetime import date
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import func

from backend.database import get_db
from backend.models.opportunity import Opportunity
from backend.models.snapshot import UploadSnapshot
from backend.services.context import UserContext, require_authenticated
from backend.services.scopes import FilterSpec, ScopeService
from backend.services.deal_serializer import serialize_opportunity
from backend.services.v2_delayed_service import V2DelayedService

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/kam", tags=["kam-portal"])


def _require_kam_or_admin(ctx: UserContext = Depends(require_authenticated)) -> UserContext:
    if not (ctx.is_kam or ctx.is_admin):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access forbidden: KAM portal is restricted to Opportunity Owners.",
        )
    return ctx


@router.get("/overview")
def get_kam_overview(
    as_of: Optional[str] = Query(None),
    period: Optional[str] = Query("current_quarter"),
    compare: Optional[str] = Query("yesterday"),
    owner_override: Optional[str] = Query(None),  # Allowed only for admin to preview a KAM's view
    ctx: UserContext = Depends(_require_kam_or_admin),
    db: Session = Depends(get_db),
):
    """
    Returns KAM's personal portfolio metrics:
    - Period totals: deals count, total ACV
    - Forecast category split (Closed, Commit, Best Case, Pipeline, Not yet proposed)
    - Approval status split (Approved, Pending Approval, Not submitted)
    - Delayed and slippage counts & ACV
    - Movement since yesterday/last week
    """
    allowed_owners = ctx.all_owner_names
    if ctx.is_admin and owner_override:
        allowed_owners = [owner_override.strip()]

    if not allowed_owners:
        return {
            "period": period,
            "total": {"count": 0, "acv": 0.0},
            "forecast_categories": {},
            "approval_statuses": {},
            "delayed": {"count": 0, "acv": 0.0},
            "slippage": {"count": 0, "acv": 0.0},
            "movements": {"count": 0, "acv": 0.0},
        }

    # Resolve active snapshot
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

    if not snap:
        return {"error": "no_snapshot"}

    fs = FilterSpec.from_params(
        as_of=as_of,
        period=period,
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

    total_count = len(opps)
    total_acv = round(sum(float(o.forecast_acv_amount or 0.0) for o in opps), 2)

    # Forecast split
    fc_map: dict[str, dict[str, Any]] = {
        "Closed": {"count": 0, "acv": 0.0},
        "Commit": {"count": 0, "acv": 0.0},
        "Best Case": {"count": 0, "acv": 0.0},
        "Pipeline": {"count": 0, "acv": 0.0},
        "Not yet proposed": {"count": 0, "acv": 0.0},
    }
    for o in opps:
        fc = (o.forecast_category or "Blank").strip()
        norm_fc = "Not yet proposed" if fc in ("Blank", "Not yet proposed", "") else fc
        if norm_fc not in fc_map:
            norm_fc = "Not yet proposed"
        fc_map[norm_fc]["count"] += 1
        fc_map[norm_fc]["acv"] = round(fc_map[norm_fc]["acv"] + float(o.forecast_acv_amount or 0.0), 2)

    # Approval split
    st_map: dict[str, dict[str, Any]] = {
        "Approved": {"count": 0, "acv": 0.0},
        "Pending Approval": {"count": 0, "acv": 0.0},
        "Not submitted": {"count": 0, "acv": 0.0},
    }
    for o in opps:
        st = (o.approval_status or "Blank").strip()
        if st in ("Approved", "Approved - 2nd"):
            norm_st = "Approved"
        elif st in ("Pending Approval", "Pending-Approval"):
            norm_st = "Pending Approval"
        else:
            norm_st = "Not submitted"
        st_map[norm_st]["count"] += 1
        st_map[norm_st]["acv"] = round(st_map[norm_st]["acv"] + float(o.forecast_acv_amount or 0.0), 2)

    # Delayed & Slippage for this KAM
    delayed_svc = V2DelayedService(db)
    delayed_buckets = delayed_svc._compute_snapshot_buckets(snap, res.resolved_quarter, filter_spec=fs)
    del_df = delayed_buckets.get("delayed_total", pd.DataFrame())
    slip_df = delayed_buckets.get("slippage_total", pd.DataFrame())

    if not del_df.empty:
        del_df = del_df[del_df["opportunity_owner"].isin(allowed_owners)]
    if not slip_df.empty:
        slip_df = slip_df[slip_df["opportunity_owner"].isin(allowed_owners)]

    delayed_count = len(del_df) if not del_df.empty else 0
    delayed_acv = round(float(del_df["forecast_acv_amount"].sum()) if not del_df.empty else 0.0, 2)

    slippage_count = len(slip_df) if not slip_df.empty else 0
    slippage_acv = round(float(slip_df["forecast_acv_amount"].sum()) if not slip_df.empty else 0.0, 2)

    # Yesterday comparison for KAM deals
    y_snap = delayed_svc.get_yesterday_baseline(snap)
    y_delta = {"count": 0, "acv": 0.0}
    if y_snap:
        y_opps = (
            db.query(Opportunity)
            .filter(Opportunity.snapshot_id == y_snap.id, *res.conditions)
            .all()
        )
        y_count = len(y_opps)
        y_acv = round(sum(float(o.forecast_acv_amount or 0.0) for o in y_opps), 2)
        y_delta = {
            "count": total_count - y_count,
            "acv": round(total_acv - y_acv, 2),
        }

    return {
        "period": res.data_slice,
        "resolved_quarter": res.resolved_quarter,
        "as_of": snap.snapshot_date.isoformat(),
        "total": {"count": total_count, "acv": total_acv},
        "forecast_categories": fc_map,
        "approval_statuses": st_map,
        "delayed": {"count": delayed_count, "acv": delayed_acv},
        "slippage": {"count": slippage_count, "acv": slippage_acv},
        "delta_yesterday": y_delta,
    }


@router.get("/deals")
def get_kam_deals(
    as_of: Optional[str] = Query(None),
    period: Optional[str] = Query("current_quarter"),
    search: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None),
    bu: Optional[str] = Query(None),
    owner_override: Optional[str] = Query(None),
    ctx: UserContext = Depends(_require_kam_or_admin),
    db: Session = Depends(get_db),
):
    """
    Returns full list of opportunities for this KAM with all metadata,
    search, and filters.
    """
    allowed_owners = ctx.all_owner_names
    if ctx.is_admin and owner_override:
        allowed_owners = [owner_override.strip()]

    if not allowed_owners:
        return {"count": 0, "acv": 0.0, "deals": []}

    snap = db.query(UploadSnapshot).filter(UploadSnapshot.is_active_today == True).first()
    if as_of:
        s_target = db.query(UploadSnapshot).filter(UploadSnapshot.id == as_of).first()
        if not s_target:
            try:
                s_target = db.query(UploadSnapshot).filter(UploadSnapshot.snapshot_date == date.fromisoformat(as_of)).first()
            except ValueError:
                pass
        if s_target:
            snap = s_target

    if not snap:
        snap = db.query(UploadSnapshot).order_by(UploadSnapshot.snapshot_date.desc()).first()

    if not snap:
        return {"count": 0, "acv": 0.0, "deals": []}

    fs = FilterSpec.from_params(
        as_of=as_of,
        period=period,
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

    # Client-level query filters
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

    return {
        "count": len(deals),
        "acv": round(sum(float(d.get("forecast_acv_amount") or 0.0) for d in deals), 2),
        "deals": deals,
    }

