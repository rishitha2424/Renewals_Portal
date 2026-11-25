"""
FastAPI router for Comments Log.
Enforces strict role permissions:
- KAM: sees only their own written comments, never internal comments, admins shown as 'Admin'.
- Management: sees only their own written comments, admins shown as 'Admin'.
- Admin: sees own comments under 'my' tab, all comments under 'all' tab.
- Never exposes email addresses.
"""
from __future__ import annotations

import json
import math
import logging
from datetime import datetime, date, timezone
from typing import Optional, Any
from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy import func, or_, and_
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models.opportunity import Opportunity
from backend.models.custom_column import DealComment
from backend.models.user import User, EmailOutbox
from backend.models.snapshot import UploadSnapshot
from backend.services.context import UserContext, require_authenticated
from backend.services.scopes import ScopeService, FilterSpec

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/comments", tags=["comments"])


@router.get("/log")
def get_comments_log(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    tab: str = Query("my"),
    search: Optional[str] = Query(None),
    visibility: Optional[str] = Query(None),
    author: Optional[str] = Query(None),
    author_role: Optional[str] = Query(None),
    deal: Optional[str] = Query(None),
    account: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    limit_to_period: bool = Query(False),
    period: Optional[str] = Query(None),
    as_of: Optional[str] = Query(None),
    ctx: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db),
):
    """
    Fetch comments log with server-side filtering and pagination.
    - Non-admins are forced to 'my' tab.
    - Non-admins see admin recipients only as 'Admin'.
    - KAMs never see internal comments.
    """
    # 1. Base query
    q = db.query(DealComment).filter(DealComment.is_deleted == False)

    # 2. Role-based enforcement
    effective_tab = "all" if (ctx.is_admin and tab == "all") else "my"

    if ctx.is_kam:
        # KAM only sees their own comments
        author_filters = []
        if ctx.user_id:
            author_filters.append(DealComment.author_id == str(ctx.user_id))
        if ctx.display_name:
            author_filters.append(func.lower(DealComment.author) == func.lower(ctx.display_name))
        if ctx.all_owner_names:
            author_filters.extend([func.lower(DealComment.author) == func.lower(o) for o in ctx.all_owner_names])

        if author_filters:
            q = q.filter(or_(*author_filters))
        else:
            q = q.filter(DealComment.author_id == "impossible_non_existent_id")

        # KAM NEVER sees internal comments
        q = q.filter(DealComment.visibility.in_(["shared", "shared_with_owner", "public", "all"]))

    elif ctx.is_management:
        # Management only sees their own written comments
        author_filters = []
        if ctx.user_id:
            author_filters.append(DealComment.author_id == str(ctx.user_id))
        if ctx.display_name:
            author_filters.append(func.lower(DealComment.author) == func.lower(ctx.display_name))

        if author_filters:
            q = q.filter(or_(*author_filters))
        else:
            q = q.filter(DealComment.author_id == "impossible_non_existent_id")

    elif ctx.is_admin:
        if effective_tab == "my":
            author_filters = []
            if ctx.user_id:
                author_filters.append(DealComment.author_id == str(ctx.user_id))
            if ctx.display_name:
                author_filters.append(func.lower(DealComment.author) == func.lower(ctx.display_name))
            if author_filters:
                q = q.filter(or_(*author_filters))
        else:
            # All comments tab: can filter by author / author_role
            if author and author.strip():
                q = q.filter(func.lower(DealComment.author).contains(author.strip().lower()))
            if author_role and author_role.strip() and author_role != "all":
                q = q.filter(DealComment.author_role == author_role.strip())

    # 3. Visibility filter
    if visibility and visibility.strip() and visibility != "all":
        v_clean = visibility.strip().lower()
        if v_clean in ("shared", "shared_with_owner"):
            q = q.filter(DealComment.visibility.in_(["shared", "shared_with_owner"]))
        elif v_clean == "internal":
            if ctx.is_kam:
                q = q.filter(DealComment.id == "disallowed_for_kam")
            else:
                q = q.filter(DealComment.visibility == "internal")

    # 4. Date range filters
    if start_date and start_date.strip():
        try:
            s_d = datetime.fromisoformat(start_date.strip())
            q = q.filter(DealComment.created_at >= s_d)
        except Exception:
            pass

    if end_date and end_date.strip():
        try:
            e_d = datetime.fromisoformat(end_date.strip()).replace(hour=23, minute=59, second=59)
            q = q.filter(DealComment.created_at <= e_d)
        except Exception:
            pass

    # 5. Deal metadata lookup & period restriction
    # Fetch active snapshot for deal details
    snap = None
    if as_of:
        snap = db.query(UploadSnapshot).filter(
            or_(UploadSnapshot.id == as_of, UploadSnapshot.snapshot_date == as_of)
        ).first()
    if not snap:
        snap = db.query(UploadSnapshot).order_by(UploadSnapshot.snapshot_date.desc()).first()

    if limit_to_period and snap:
        fs = FilterSpec.from_params(
            as_of=snap.snapshot_date.isoformat(),
            period=period or "current_quarter",
            user_context=ctx,
        )
        res = ScopeService.resolve(fs, snapshot=snap, as_of_date=snap.snapshot_date, db=db)
        period_opp_query = db.query(Opportunity.opportunity_id_18).filter(
            Opportunity.snapshot_id == snap.id,
            *res.conditions
        )
        period_opp_ids = [r[0] for r in period_opp_query.all()]
        q = q.filter(DealComment.opportunity_id_18.in_(period_opp_ids))

    # 6. Deal / Account name filter or free search
    if deal and deal.strip():
        d_term = f"%{deal.strip().lower()}%"
        matching_opp_ids = [
            r[0] for r in db.query(Opportunity.opportunity_id_18).filter(
                or_(
                    func.lower(Opportunity.opportunity_name).like(d_term),
                    func.lower(Opportunity.opportunity_id_18).like(d_term),
                )
            ).distinct().all()
        ]
        q = q.filter(DealComment.opportunity_id_18.in_(matching_opp_ids))

    if account and account.strip():
        a_term = f"%{account.strip().lower()}%"
        matching_opp_ids = [
            r[0] for r in db.query(Opportunity.opportunity_id_18).filter(
                func.lower(Opportunity.account_name).like(a_term)
            ).distinct().all()
        ]
        q = q.filter(DealComment.opportunity_id_18.in_(matching_opp_ids))

    if search and search.strip():
        s_term = f"%{search.strip().lower()}%"
        matching_opp_ids = [
            r[0] for r in db.query(Opportunity.opportunity_id_18).filter(
                or_(
                    func.lower(Opportunity.opportunity_name).like(s_term),
                    func.lower(Opportunity.account_name).like(s_term),
                    func.lower(Opportunity.opportunity_id_18).like(s_term),
                )
            ).distinct().all()
        ]
        q = q.filter(
            or_(
                func.lower(DealComment.text).like(s_term),
                func.lower(DealComment.author).like(s_term),
                DealComment.opportunity_id_18.in_(matching_opp_ids),
            )
        )

    # 7. Total count & Pagination
    total = q.count()
    total_pages = max(1, math.ceil(total / page_size))
    comments = q.order_by(DealComment.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()

    # 8. Enrich results with deal info, recipient names, email status
    opp_ids = list({c.opportunity_id_18 for c in comments})
    opp_map: dict[str, Any] = {}
    if opp_ids:
        # Prefer active snapshot opportunities, fallback to any snapshot
        opp_query = db.query(Opportunity).filter(Opportunity.opportunity_id_18.in_(opp_ids))
        if snap:
            opp_query = opp_query.filter(Opportunity.snapshot_id == snap.id)
        for opp in opp_query.all():
            opp_map[opp.opportunity_id_18] = {
                "opportunity_name": opp.opportunity_name,
                "account_name": opp.account_name,
                "acv": float(opp.forecast_acv_amount or 0.0),
                "fiscal_period": opp.fiscal_period,
                "close_date": opp.close_date.isoformat() if opp.close_date else None,
            }
        # Fallback for any missing from active snapshot
        missing_ids = [oid for oid in opp_ids if oid not in opp_map]
        if missing_ids:
            for opp in db.query(Opportunity).filter(Opportunity.opportunity_id_18.in_(missing_ids)).all():
                if opp.opportunity_id_18 not in opp_map:
                    opp_map[opp.opportunity_id_18] = {
                        "opportunity_name": opp.opportunity_name,
                        "account_name": opp.account_name,
                        "acv": float(opp.forecast_acv_amount or 0.0),
                        "fiscal_period": opp.fiscal_period,
                        "close_date": opp.close_date.isoformat() if opp.close_date else None,
                    }

    # Fetch all user IDs needed for recipient resolution
    all_recip_ids: set[str] = set()
    for c in comments:
        if c.recipient_ids:
            try:
                parsed = json.loads(c.recipient_ids)
                if isinstance(parsed, list):
                    all_recip_ids.update(str(x) for x in parsed)
            except Exception:
                pass

    user_map: dict[str, User] = {}
    if all_recip_ids:
        for u in db.query(User).filter(User.id.in_(list(all_recip_ids))).all():
            user_map[str(u.id)] = u

    # Look up email outbox status for these deals
    email_outbox_map: dict[str, str] = {}
    if opp_ids:
        outbox_rows = (
            db.query(EmailOutbox)
            .filter(
                EmailOutbox.deal_id.in_(opp_ids),
                EmailOutbox.template_type.in_(["comment", "deal_comment"]),
            )
            .order_by(EmailOutbox.created_at.desc())
            .all()
        )
        for ob in outbox_rows:
            if ob.deal_id and ob.deal_id not in email_outbox_map:
                # Map raw status to user-friendly chip: emailed / queued / failed
                s_raw = (ob.status or "").lower()
                if "sent" in s_raw or "success" in s_raw:
                    email_outbox_map[ob.deal_id] = "emailed"
                elif "fail" in s_raw or "error" in s_raw:
                    email_outbox_map[ob.deal_id] = "failed"
                else:
                    email_outbox_map[ob.deal_id] = "queued"

    items = []
    for c in comments:
        opp_info = opp_map.get(c.opportunity_id_18, {})
        deal_name = opp_info.get("opportunity_name") or c.opportunity_id_18
        account_name = opp_info.get("account_name") or "—"

        # Resolve sent to names (admins masked to 'Admin' for non-admins)
        recip_names: list[str] = []
        has_admin_recip = False
        if c.recipient_ids:
            try:
                r_ids = json.loads(c.recipient_ids)
                if isinstance(r_ids, list):
                    for rid in r_ids:
                        s_rid = str(rid)
                        if s_rid == "admin":
                            has_admin_recip = True
                            continue
                        u = user_map.get(s_rid)
                        if u:
                            if u.role == "admin":
                                has_admin_recip = True
                            else:
                                if u.name and u.name not in recip_names:
                                    recip_names.append(u.name)
                        else:
                            # If no user record found but id matches 'admin'
                            if "admin" in s_rid.lower():
                                has_admin_recip = True
            except Exception:
                pass

        if has_admin_recip:
            if ctx.is_admin:
                # Admin can see admin names
                admin_names = [u.name for u in user_map.values() if u.role == "admin"]
                if admin_names:
                    for an in admin_names:
                        if an and an not in recip_names:
                            recip_names.append(an)
                else:
                    if "Admin" not in recip_names:
                        recip_names.append("Admin")
            else:
                # Non-admins see strictly 'Admin'
                if "Admin" not in recip_names:
                    recip_names.append("Admin")

        # Fallback if no specific recipients saved: default recipients
        if not recip_names:
            if c.visibility == "internal":
                recip_names = ["Management", "Admin"] if ctx.is_admin else ["Management", "Admin"]
            else:
                recip_names = ["Owner", "Management", "Admin"] if ctx.is_admin else ["Owner", "Management", "Admin"]

        email_status = email_outbox_map.get(c.opportunity_id_18, "emailed")

        # Mask author name for non-admins if author was admin
        display_author = c.author
        if not ctx.is_admin and c.author_role == "admin":
            display_author = "Admin"

        items.append({
            "id": c.id,
            "deal_id": c.opportunity_id_18,
            "deal_name": deal_name,
            "account_name": account_name,
            "text": c.text,
            "visibility": "shared" if c.visibility in ("shared", "shared_with_owner", "public") else "internal",
            "author": display_author,
            "author_role": c.author_role,
            "created_at": c.created_at.isoformat() if c.created_at else None,
            "created_at_formatted": c.created_at.strftime("%b %d, %Y, %I:%M %p") if c.created_at else "",
            "recipients": recip_names,
            "email_status": email_status,
        })

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
        "tab": effective_tab,
    }

