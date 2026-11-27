"""
Notifications Router (Round 25 + Per-Category Unread Badges & Role-Safe Filtering).
API endpoints for Notification Centre: topbar unread badge, sidebar badges, dropdown list, mark read, mark all read.
Strictly isolated to the authenticated user.
"""
from __future__ import annotations
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models.user import User
from backend.models.opportunity import Opportunity
from backend.models.custom_column import DealComment
from backend.services.context import UserContext, require_authenticated
from backend.services.notification_service import NotificationService
from backend.services.delivery_service import resolve_caller_uid, get_kam_owned_deal_ids
from backend.services.schema_check import raise_db_endpoint_error

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("")
def list_notifications(
    category: Optional[str] = Query(None, description="all | unread | message | comment | alert"),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    ctx: UserContext = Depends(require_authenticated),
):
    if not ctx.user_id:
        return {
            "notifications": [],
            "unread_count": 0,
            "unread_by_category": {"messages": 0, "comments": 0, "alerts": 0, "total": 0},
        }

    try:
        uid = resolve_caller_uid(db, ctx)
        items, unread_count, by_category = NotificationService.get_user_notifications(
            db=db,
            user_id=uid,
            category=category,
            limit=limit,
        )

        admin_users = db.query(User).filter(User.role == "admin").all() if not ctx.is_admin else []
        admin_names = [u.name for u in admin_users if u.name]
        admin_emails = [u.email for u in admin_users if u.email]

        # Defense-in-depth for role/owner changes: never show KAMs internal comment or unowned real-deal notifications
        owned_deal_ids = get_kam_owned_deal_ids(db, ctx.all_owner_names) if ctx.is_kam else None
        existing_opp_deal_ids: set[str] = set()
        comment_vis_map: dict[str, str] = {}
        if ctx.is_kam:
            notif_deal_ids = list({n.deal_id for n in items if n.deal_id})
            if notif_deal_ids:
                for r in db.query(Opportunity.opportunity_id_18).filter(Opportunity.opportunity_id_18.in_(notif_deal_ids)).distinct().all():
                    if r[0]:
                        existing_opp_deal_ids.add(r[0])
            c_ids = [n.target_id for n in items if n.target_type == "deal_comment" and n.target_id]
            if c_ids:
                for c in db.query(DealComment.id, DealComment.visibility).filter(DealComment.id.in_(c_ids)).all():
                    comment_vis_map[c[0]] = c[1]
    except HTTPException:
        raise
    except SQLAlchemyError as db_exc:
        raise_db_endpoint_error(
            db,
            db_exc,
            endpoint="GET /api/notifications",
            params={"category": category, "limit": limit, "role": getattr(ctx, "role", None)},
            generic_detail="Could not load notifications due to a database error. Please try again.",
        )

    out_items = []
    for n in items:
        if ctx.is_kam:
            if (
                n.deal_id
                and n.deal_id in existing_opp_deal_ids
                and owned_deal_ids is not None
                and n.deal_id not in owned_deal_ids
            ):
                continue
            if n.target_type == "deal_comment" and n.target_id in comment_vis_map:
                if comment_vis_map[n.target_id] == "internal":
                    continue

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
        "unread_by_category": by_category,
    }


@router.post("/{notification_id}/read")
def mark_notification_read(
    notification_id: str,
    db: Session = Depends(get_db),
    ctx: UserContext = Depends(require_authenticated),
):
    if not ctx.user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    uid = resolve_caller_uid(db, ctx)
    ok = NotificationService.mark_as_read(db, uid, notification_id)
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

    uid = resolve_caller_uid(db, ctx)
    marked = NotificationService.mark_all_as_read(db, uid)
    return {"success": True, "marked_count": marked}
