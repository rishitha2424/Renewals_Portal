from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.services.context import UserContext
from backend.services.v2_expiry_service import V2ExpiryService

router = APIRouter(prefix="/api/v2/expiry", tags=["v2_expiry"])

@router.get("/summary")
def get_summary(
    as_of: str = Query(None),
    compare: str = Query("yesterday"),
    exclude_deleted_lost: bool = Query(False),
    db: Session = Depends(get_db)
):
    ctx = UserContext()
    svc = V2ExpiryService(db)
    return svc.get_summary(ctx, as_of, compare, exclude_deleted_lost)

@router.get("/deals")
def get_deals(
    quarter: str = Query(None),
    category: str = Query(None),
    as_of: str = Query(None),
    exclude_deleted_lost: bool = Query(False),
    slippage: bool = Query(False),
    db: Session = Depends(get_db)
):
    ctx = UserContext()
    svc = V2ExpiryService(db)
    return svc.get_deals(ctx, quarter, category, as_of, exclude_deleted_lost, slippage)