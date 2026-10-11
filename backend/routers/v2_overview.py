"""
V2 Overview router — /api/v2/overview/...
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.services.context import UserContext, get_user_context
from backend.services.v2_overview_service import V2OverviewService

router = APIRouter(prefix="/api/v2/overview", tags=["v2-overview"])


def _svc(db: Session = Depends(get_db)) -> V2OverviewService:
    return V2OverviewService(db)


@router.get("/summary")
def overview_summary(
    as_of: str = Query(None),
    exclude_deleted: bool = Query(False),
    svc: V2OverviewService = Depends(_svc),
    ctx: UserContext = Depends(get_user_context),
):
    return svc.get_summary(ctx, exclude_deleted=exclude_deleted, as_of=as_of)


@router.get("/movements")
def overview_movements(
    compare: str = Query("yesterday", pattern="^(yesterday|last_week)$"),
    exclude_deleted: bool = Query(False),
    svc: V2OverviewService = Depends(_svc),
    ctx: UserContext = Depends(get_user_context),
):
    return svc.get_movements(ctx, compare=compare, exclude_deleted=exclude_deleted)


@router.get("/regional-breakdown")
def overview_regional_breakdown(
    exclude_deleted: bool = Query(False),
    svc: V2OverviewService = Depends(_svc),
    ctx: UserContext = Depends(get_user_context),
):
    return svc.get_regional_breakdown(ctx, exclude_deleted=exclude_deleted)

@router.get("/deals")
def overview_deals(
    category: str = Query(None),
    region: str = Query(None),
    approval_status: str = Query(None),
    kind: str = Query(None),
    compare: str = Query(None),
    as_of: str = Query(None),
    exclude_deleted: bool = Query(False),
    svc: V2OverviewService = Depends(_svc),
    ctx: UserContext = Depends(get_user_context),
):
    return svc.get_deals(
        ctx,
        category=category,
        region=region,
        approval_status=approval_status,
        kind=kind,
        compare=compare,
        exclude_deleted=exclude_deleted,
        as_of=as_of,
    )

