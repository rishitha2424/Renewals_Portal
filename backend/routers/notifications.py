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

    from backend.models.user import User
    admin_users = db.query(User).filter(User.role == "admin").all() if not ctx.is_admin else []
    admin_names = [u.name for u in admin_users if u.name]
    admin_emails = [u.email for u in admin_users if u.email]

    out_items = []
    for n in items:
        d = n.to_dict()
        if not ctx.is_admin:
            for name in admin_names:
                if name and name in d.get("title", ""):
                    d["title"] = d["title"].replace(name, "Admin")
                if name and name in d.get("message", ""):
                    d["message"] = d["message"].replace(name, "Admin")
            for email in admin_emails:
                if email and email in d.get("title", ""):
                    d["title"] = d["title"].replace(email, "Admin")
                if email and email in d.get("message", ""):
                    d["message"] = d["message"].replace(email, "Admin")
        out_items.append(d)

    return {
        "notifications": out_items,
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

