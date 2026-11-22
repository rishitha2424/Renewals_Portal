"""
Search Router (Round 19).
Global Search (Ctrl+K) and deal messaging search across opportunities, accounts, and regions.
Enforces scope rules: is_reconciliation_entry == False, stage exclusion.
Enforces KAM isolation: KAMs only see opportunities and accounts belonging to their owner names.
"""
from __future__ import annotations

from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, or_

from backend.database import get_db
from backend.models.opportunity import Opportunity
from backend.models.snapshot import UploadSnapshot
from backend.services.context import UserContext, require_authenticated
from backend.config import settings

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("")
def global_search(
    q: str = Query(..., min_length=1),
    limit: int = Query(20, ge=1, le=100),
    as_of: Optional[str] = Query(None),
    include_deleted_lost: bool = Query(False),
    ctx: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """
    Search opportunities, accounts, and regions matching term `q`.
    Respects snapshot scope, excluded stages, reconciliation entry = False,
    and strict KAM ownership isolation.
    """
    clean_q = q.strip()
    pattern = f"%{clean_q}%"

    # 1. Resolve active snapshot
    snap_q = db.query(UploadSnapshot)
    if as_of:
        try:
            from datetime import date
            d = date.fromisoformat(as_of)
            snap = snap_q.filter(UploadSnapshot.snapshot_date <= d).order_by(UploadSnapshot.snapshot_date.desc()).first()
        except ValueError:
            snap = snap_q.order_by(UploadSnapshot.snapshot_date.desc()).first()
    else:
        snap = snap_q.filter(UploadSnapshot.is_active_today == True).order_by(UploadSnapshot.snapshot_date.desc()).first()
        if not snap:
            snap = snap_q.order_by(UploadSnapshot.snapshot_date.desc()).first()

    snapshot_id = snap.id if snap else None

    # Base query for opportunities on this snapshot
    opp_q = db.query(Opportunity).filter(Opportunity.is_reconciliation_entry == False)
    if snapshot_id:
        opp_q = opp_q.filter(Opportunity.snapshot_id == snapshot_id)

    # Excluded stages / deleted or lost filter
    if not include_deleted_lost:
        opp_q = opp_q.filter(Opportunity.is_deleted_or_lost == False)

    # KAM isolation
    if ctx.is_kam:
        opp_q = opp_q.filter(Opportunity.opportunity_owner.in_(ctx.all_owner_names))

    # Search Opportunities
    opp_filter = or_(
        Opportunity.opportunity_name.ilike(pattern),
        Opportunity.opportunity_id_18.ilike(pattern),
        Opportunity.account_name.ilike(pattern),
        Opportunity.opportunity_owner.ilike(pattern),
    )
    matching_opps = (
        opp_q.filter(opp_filter)
        .order_by(Opportunity.forecast_acv_amount.desc())
        .limit(limit)
        .all()
    )

    deals = [
        {
            "id": o.opportunity_id_18,
            "opportunity_id_18": o.opportunity_id_18,
            "opportunity_name": o.opportunity_name or o.opportunity_id_18,
            "title": o.opportunity_name or o.opportunity_id_18,
            "account_name": o.account_name or "",
            "opportunity_owner": o.opportunity_owner or "",
            "stage_name": o.stage_number or "",
            "stage_number": o.stage_number or "",
            "forecast_acv_amount": float(o.forecast_acv_amount or 0.0),
            "sub_region": o.sub_region or "",
            "type": "deal",
        }
        for o in matching_opps
    ]

    # Search Distinct Accounts
    acc_q = (
        db.query(Opportunity.account_name)
        .filter(Opportunity.is_reconciliation_entry == False)
        .filter(Opportunity.account_name.ilike(pattern))
    )
    if snapshot_id:
        acc_q = acc_q.filter(Opportunity.snapshot_id == snapshot_id)
    if not include_deleted_lost:
        acc_q = acc_q.filter(Opportunity.is_deleted_or_lost == False)
    if ctx.is_kam:
        acc_q = acc_q.filter(Opportunity.opportunity_owner.in_(ctx.all_owner_names))

    matching_accounts = [
        row[0] for row in acc_q.distinct().limit(limit).all() if row[0]
    ]
    accounts = [{"id": acc, "title": acc, "type": "account"} for acc in matching_accounts]

    # Search Distinct Regions
    reg_q = (
        db.query(Opportunity.sub_region)
        .filter(Opportunity.is_reconciliation_entry == False)
        .filter(Opportunity.sub_region.ilike(pattern))
    )
    if snapshot_id:
        reg_q = reg_q.filter(Opportunity.snapshot_id == snapshot_id)
    if not include_deleted_lost:
        reg_q = reg_q.filter(Opportunity.is_deleted_or_lost == False)
    if ctx.is_kam:
        reg_q = reg_q.filter(Opportunity.opportunity_owner.in_(ctx.all_owner_names))

    matching_regions = [
        row[0] for row in reg_q.distinct().limit(limit).all() if row[0]
    ]
    regions = [{"id": reg, "title": reg, "type": "region"} for reg in matching_regions]

    return {
        "query": clean_q,
        "deals": deals,
        "accounts": accounts,
        "regions": regions,
        "total_results": len(deals) + len(accounts) + len(regions),
    }
