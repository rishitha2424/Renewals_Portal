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

from pydantic import BaseModel, Field
import uuid

from backend.database import get_db
from backend.models.opportunity import Opportunity
from backend.models.custom_column import DealComment, AnnotationAudit
from backend.models.user import User, EmailOutbox, UserAlias
from backend.models.snapshot import UploadSnapshot
from backend.services.context import UserContext, require_authenticated
from backend.services.scopes import ScopeService, FilterSpec
from backend.services.settings_service import SettingsService
from backend.services.notification_service import NotificationService

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


class BatchCommentRequest(BaseModel):
    deal_ids: list[str]
    text: str
    visibility: Optional[str] = "internal"
    recipient_ids: Optional[list[str]] = None


@router.post("/batch", dependencies=[Depends(require_authenticated)])
def create_batch_comment(
    body: BatchCommentRequest,
    ctx: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db),
):
    """
    Create a comment across multiple deals (or a single deal).
    - Limit number of deals per batch via Settings (default 50).
    - Permissions server-enforced:
      - Admin and management can comment on any deal.
      - KAM can only comment on their own deals (403 if any deal is not theirs).
      - KAM comments are always shared_with_owner.
      - Author field is strictly server-enforced (logged-in user's name).
    - Creates one DealComment record per deal, all linked by batch_id.
    - Creates one AnnotationAudit entry per deal.
    - Grouped notifications & emails:
      - Each recipient gets 1 notification & 1 email per batch listing the deals.
      - For shared_with_owner, each owner gets 1 email listing only their own deals.
    """
    cleaned_ids = list(dict.fromkeys(d.strip() for d in (body.deal_ids or []) if d and d.strip()))
    if not cleaned_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one opportunity ID must be specified.",
        )

    max_batch = SettingsService.get_max_comment_batch_size(db)
    if len(cleaned_ids) > max_batch:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Batch size exceeds maximum limit of {max_batch} deals.",
        )

    cleaned_text = (body.text or "").strip()
    if not cleaned_text:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Comment text cannot be empty.",
        )

    # 1. Fetch opportunities for all requested deal_ids
    opps = db.query(Opportunity).filter(Opportunity.opportunity_id_18.in_(cleaned_ids)).all()
    opp_map: dict[str, Opportunity] = {o.opportunity_id_18: o for o in opps if o.opportunity_id_18}

    # 2. Server-side identity & role validation
    author_name = ctx.display_name or (
        "Admin" if ctx.is_admin else ("Management" if ctx.is_management else "Opportunity Owner")
    )
    author_role = ctx.role or "viewer"
    user_id = str(ctx.user_id) if ctx.user_id else "Viewer"
    user_disp = ctx.display_name or ctx.email or author_name

    if ctx.is_kam:
        # KAM can only comment on their own deals
        for d_id in cleaned_ids:
            opp = opp_map.get(d_id)
            if not opp or opp.opportunity_owner not in ctx.all_owner_names:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Access forbidden: KAMs can only comment on their own opportunities (deal {d_id}).",
                )
        vis = "shared_with_owner"
    else:
        vis_raw = str(body.visibility or "internal").strip().lower()
        if vis_raw in ("shared", "shared_with_owner", "shared with owner", "visible to owner", "visible_to_owner"):
            vis = "shared_with_owner"
        else:
            vis = "internal"

    # 3. Create DealComment and AnnotationAudit per deal
    batch_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    recipient_ids_json = json.dumps(body.recipient_ids) if body.recipient_ids else None

    comments_created = []
    for d_id in cleaned_ids:
        c_id = str(uuid.uuid4())
        comment = DealComment(
            id=c_id,
            opportunity_id_18=d_id,
            author=author_name,
            text=cleaned_text,
            is_deleted=False,
            created_at=now,
            updated_at=now,
            visibility=vis,
            author_id=user_id,
            author_role=author_role,
            recipient_ids=recipient_ids_json,
            batch_id=batch_id,
        )
        db.add(comment)
        comments_created.append(comment)

        # Audit entry per deal
        audit = AnnotationAudit(
            id=str(uuid.uuid4()),
            entity_type="deal_comment",
            entity_id=c_id,
            column_key="comment",
            opportunity_id_18=d_id,
            action="create",
            old_value=None,
            new_value=cleaned_text,
            user_id=user_disp,
            timestamp=now,
            extra_info={
                "author": author_name,
                "role": author_role,
                "visibility": vis,
                "batch_id": batch_id,
            },
        )
        db.add(audit)

    db.flush()

    # 4. Grouped Notifications and Emails
    # Resolve explicit recipients from recipient_ids
    notified_user_ids = set()
    total_notifications_sent = 0

    # Build deal list lines
    def format_deal_line(d_id: str) -> str:
        o = opp_map.get(d_id)
        if o:
            acv_str = f" – ${float(o.forecast_acv_amount):,.2f}" if o.forecast_acv_amount is not None else ""
            acct_str = f" ({o.account_name})" if o.account_name else ""
            return f"• {o.opportunity_name or d_id}{acct_str}{acv_str}"
        return f"• {d_id}"

    # A) For "Shared with owner": each owner gets 1 notification and 1 email listing ONLY their own deals
    if vis == "shared_with_owner":
        owner_to_deal_ids: dict[str, list[str]] = {}
        for d_id in cleaned_ids:
            o = opp_map.get(d_id)
            if o and o.opportunity_owner:
                owner_clean = o.opportunity_owner.strip()
                owner_to_deal_ids.setdefault(owner_clean, []).append(d_id)

        for owner_clean, owner_deal_ids in owner_to_deal_ids.items():
            kam_u = db.query(User).filter(
                func.lower(User.owner_name) == owner_clean.lower(),
                User.status != "disabled",
            ).first()
            if not kam_u:
                alias = db.query(UserAlias).filter(
                    func.lower(UserAlias.alias_name) == owner_clean.lower()
                ).first()
                if alias and alias.user.status != "disabled":
                    kam_u = alias.user

            if kam_u and str(kam_u.id) != str(user_id):
                owner_lines = [format_deal_line(d_id) for d_id in owner_deal_ids]
                n_deals = len(owner_deal_ids)
                deal_title = f"{n_deals} deal{'s' if n_deals > 1 else ''}"
                first_opp = opp_map.get(owner_deal_ids[0])

                msg_text = f"{cleaned_text}\n\nDeals ({n_deals}):\n" + "\n".join(owner_lines[:15])
                if len(owner_lines) > 15:
                    msg_text += f"\n... and {len(owner_lines) - 15} more"

                try:
                    NotificationService.create_notification(
                        db=db,
                        user_id=kam_u.id,
                        category="comment",
                        title=f"New comment from {author_name} on {deal_title}",
                        message=msg_text,
                        deal_id=owner_deal_ids[0] if n_deals == 1 else None,
                        deal_name=first_opp.opportunity_name if (first_opp and n_deals == 1) else f"Batch: {n_deals} deals",
                        target_type="deal_comment",
                        target_id=comments_created[0].id if n_deals == 1 else batch_id,
                        send_email=True,
                        email_sender_name=author_name,
                        email_sender_role=author_role,
                        account_name=first_opp.account_name if (first_opp and n_deals == 1) else None,
                        acv_amount=float(first_opp.forecast_acv_amount) if (first_opp and n_deals == 1 and first_opp.forecast_acv_amount) else None,
                    )
                    notified_user_ids.add(kam_u.id)
                    total_notifications_sent += 1
                except Exception as e:
                    log.warning("Failed to queue grouped notification to owner %s: %s", owner_clean, e)

    # B) For explicitly chosen recipients (or defaults for internal):
    target_users: list[User] = []
    if body.recipient_ids:
        raw_ids = list(body.recipient_ids)
        if "admin" in raw_ids:
            raw_ids.remove("admin")
            admin_ids = [u.id for u in db.query(User).filter(User.role == "admin", User.status != "disabled").all()]
            raw_ids.extend(admin_ids)
        target_users = db.query(User).filter(User.id.in_(raw_ids), User.status != "disabled").all()
    else:
        # Default internal recipients: management & admin
        if vis == "internal":
            target_users = db.query(User).filter(User.role.in_(["management", "admin"]), User.status != "disabled").all()

    # Filter out author and users already notified
    filtered_recipients = [u for u in target_users if str(u.id) != str(user_id) and u.id not in notified_user_ids]

    if filtered_recipients:
        all_lines = [format_deal_line(d_id) for d_id in cleaned_ids]
        n_all = len(cleaned_ids)
        first_opp = opp_map.get(cleaned_ids[0])
        batch_summary_title = f"{n_all} deal{'s' if n_all > 1 else ''}"

        full_msg = f"{cleaned_text}\n\nDeals ({n_all}):\n" + "\n".join(all_lines[:20])
        if len(all_lines) > 20:
            full_msg += f"\n... and {len(all_lines) - 20} more"

        for r_user in filtered_recipients:
            try:
                NotificationService.create_notification(
                    db=db,
                    user_id=r_user.id,
                    category="comment",
                    title=f"New comment from {author_name} on {batch_summary_title}",
                    message=full_msg,
                    deal_id=cleaned_ids[0] if n_all == 1 else None,
                    deal_name=first_opp.opportunity_name if (first_opp and n_all == 1) else f"Batch: {n_all} deals",
                    target_type="deal_comment",
                    target_id=comments_created[0].id if n_all == 1 else batch_id,
                    send_email=True,
                    email_sender_name=author_name,
                    email_sender_role=author_role,
                    account_name=first_opp.account_name if (first_opp and n_all == 1) else None,
                    acv_amount=float(first_opp.forecast_acv_amount) if (first_opp and n_all == 1 and first_opp.forecast_acv_amount) else None,
                )
                total_notifications_sent += 1
            except Exception as e:
                log.warning("Failed to queue grouped notification to recipient %s: %s", r_user.name, e)

    db.commit()

    return {
        "success": True,
        "batch_id": batch_id,
        "comments_created": len(comments_created),
        "total_recipients": total_notifications_sent,
    }

