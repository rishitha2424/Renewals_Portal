"""
Notifications Router (Round 25).
API endpoints for Notification Centre: topbar unread badge, dropdown list, mark read, mark all read.
Strictly isolated to the authenticated user.
"""
from __future__ import annotations
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.services.context import UserContext, require_authenticated
from backend.services.notification_service import NotificationService

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("")
def list_notifications(
    category: Optional[str] = Query(None, description="all | unread | message | comment | alert"),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    ctx: UserContext = Depends(require_authenticated),
):
    if not ctx.user_id:
        return {"notifications": [], "unread_count": 0}

    items, unread_count = NotificationService.get_user_notifications(
        db=db,
        user_id=ctx.user_id,
        category=category,
        limit=limit,
    )

    return {
        "notifications": [n.to_dict() for n in items],
        "unread_count": unread_count,
    }


@router.post("/{notification_id}/read")
def mark_notification_read(
    notification_id: str,
    db: Session = Depends(get_db),
    ctx: UserContext = Depends(require_authenticated),
):
    if not ctx.user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    ok = NotificationService.mark_as_read(db, ctx.user_id, notification_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")

    return {"success": True}


@router.post("/read-all")
def mark_all_notifications_read(
    db: Session = Depends(get_db),
    ctx: UserContext = Depends(require_authenticated),
):
    if not ctx.user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    marked = NotificationService.mark_all_as_read(db, ctx.user_id)
    return {"success": True, "marked_count": marked}

