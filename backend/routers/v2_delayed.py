from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional

from backend.database import get_db
from backend.services.context import UserContext, get_user_context
from backend.services.v2_delayed_service import V2DelayedService
from backend.services.scopes import FilterSpec
from backend.routers.deps import get_filter_spec

router = APIRouter(prefix="/api/v2/delayed", tags=["Delayed"])

def _svc(db: Session = Depends(get_db)):
    return V2DelayedService(db)

@router.get("/summary")
def get_delayed_summary(
    as_of: Optional[str] = Query(None),
    compare: str = Query("yesterday", pattern="^(yesterday|last_week|period_start)$"),
    filter_spec: FilterSpec = Depends(get_filter_spec),
    svc: V2DelayedService = Depends(_svc),
    ctx: UserContext = Depends(get_user_context)
):
    return svc.get_summary(as_of=as_of, compare=compare, filter_spec=filter_spec)

@router.get("/deals")
def get_delayed_deals(
    kind: str = Query("all"),
    region: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    bu: Optional[str] = Query(None),
    ageing: Optional[str] = Query(None),
    expiry_year: Optional[int] = Query(None),
    start_year: Optional[int] = Query(None),
    close_year: Optional[int] = Query(None),
    split_key: Optional[str] = Query(None),
    review_type: Optional[str] = Query(None),
    as_of: Optional[str] = Query(None),
    compare: Optional[str] = Query(None, pattern="^(yesterday|last_week|period_start)$"),
    filter_spec: FilterSpec = Depends(get_filter_spec),
    svc: V2DelayedService = Depends(_svc),
    ctx: UserContext = Depends(get_user_context)
):
    return svc.get_deals(
        as_of=as_of,
        compare=compare,
        kind=kind,
        region=region,
        category=category,
        status=status,
        bu=bu,
        ageing=ageing,
        expiry_year=expiry_year,
        start_year=start_year,
        close_year=close_year,
        split_key=split_key,
        review_type=review_type,
        filter_spec=filter_spec,
    )

@router.get("/reconciliation")
def get_delayed_reconciliation(
    as_of: Optional[str] = Query(None),
    svc: V2DelayedService = Depends(_svc),
    ctx: UserContext = Depends(get_user_context)
):
    return svc.get_reconciliation_vs_manual(snapshot_id=as_of)
