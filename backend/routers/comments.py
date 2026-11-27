"""
FastAPI router for Comments Log & Batch Comments.
Enforces strict role permissions:
- KAM: sees only comments on their own deals, never internal comments, admins shown as 'Admin'.
- Management: sees own comments under 'my' tab, can read all deals' comments under 'all' tab.
- Admin: sees own comments under 'my' tab, all comments under 'all' tab.
- Never exposes email addresses.
- Save-first + async background notification/email fan-out.
"""
from __future__ import annotations

import json
import math
import logging
import uuid
from datetime import date, datetime, timezone
from typing import Optional, Any

from fastapi import APIRouter, BackgroundTasks, Depends, Query, HTTPException, status
from sqlalchemy import false, func, or_
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from pydantic import BaseModel

from backend.database import get_db
from backend.models.opportunity import Opportunity
from backend.models.custom_column import DealComment, AnnotationAudit
from backend.models.user import User, EmailOutbox, EmailDeliveryEvent, CommentMessageHistory
from backend.models.snapshot import UploadSnapshot
from backend.services.context import UserContext, require_authenticated, require_admin_context
from backend.services.scopes import ScopeService, FilterSpec
from backend.services.settings_service import SettingsService
from backend.services.schema_check import (
    COMMENTS_REQUIRED_TABLES,
    check_schema_health,
    format_missing_schema_message,
    raise_db_endpoint_error,
)
from backend.services.delivery_service import (
    resolve_caller_uid,
    resolve_recipients,
    resolve_owner_user,
    get_latest_opportunities_map,
    get_kam_owned_deal_ids,
    is_deal_owned_by_kam,
    run_post_commit_delivery,
)
from backend.utils.time_utils import to_utc_iso

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
    - Non-admins see admin authors/recipients only as 'Admin'.
    - KAMs never see internal comments and never see other KAMs' deals.
    - Management can read comments on any deal under 'all' tab, or own under 'my' tab.
    - Includes unsent tombstones ("This message was removed") and edit indicators.
    - Zero N+1 queries.
    """
    schema_info = check_schema_health(
        db.get_bind(),
        check_alembic=False,
        target_tables=COMMENTS_REQUIRED_TABLES,
    )
    missing_t = schema_info.get("missing_tables") or []
    missing_c = schema_info.get("missing_columns") or []
    if (missing_t or missing_c) and not schema_info.get("inspection_failed"):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=format_missing_schema_message(missing_t, missing_c),
        )

    req_params = {
        "page": page,
        "page_size": page_size,
        "tab": tab,
        "visibility": visibility,
        "author_role": author_role,
        "limit_to_period": limit_to_period,
        "period": period,
        "as_of": as_of,
        "has_search": bool(search and search.strip()),
        "has_author": bool(author and author.strip()),
        "has_deal": bool(deal and deal.strip()),
        "has_account": bool(account and account.strip()),
        "start_date": start_date,
        "end_date": end_date,
        "role": getattr(ctx, "role", None),
    }

    try:
        return _execute_comments_log_query(
            page=page,
            page_size=page_size,
            tab=tab,
            search=search,
            visibility=visibility,
            author=author,
            author_role=author_role,
            deal=deal,
            account=account,
            start_date=start_date,
            end_date=end_date,
            limit_to_period=limit_to_period,
            period=period,
            as_of=as_of,
            ctx=ctx,
            db=db,
        )
    except HTTPException:
        raise
    except SQLAlchemyError as db_exc:
        raise_db_endpoint_error(
            db,
            db_exc,
            endpoint="GET /api/comments/log",
            params=req_params,
            required_tables=COMMENTS_REQUIRED_TABLES,
            generic_detail="Could not load comments log due to a database error. Please try again.",
        )


def _execute_comments_log_query(
    *,
    page: int,
    page_size: int,
    tab: str,
    search: Optional[str],
    visibility: Optional[str],
    author: Optional[str],
    author_role: Optional[str],
    deal: Optional[str],
    account: Optional[str],
    start_date: Optional[str],
    end_date: Optional[str],
    limit_to_period: bool,
    period: Optional[str],
    as_of: Optional[str],
    ctx: UserContext,
    db: Session,
) -> dict[str, Any]:
    q = db.query(DealComment)

    effective_tab = "all" if tab == "all" else "my"
    caller_uid = resolve_caller_uid(db, ctx)

    if ctx.is_kam:
        owned_deal_ids = list(get_kam_owned_deal_ids(db, ctx.all_owner_names))
        if owned_deal_ids:
            q = q.filter(DealComment.opportunity_id_18.in_(owned_deal_ids))
        else:
            q = q.filter(false())

        # KAM NEVER sees internal comments
        q = q.filter(DealComment.visibility.in_(["shared", "shared_with_owner", "public", "all"]))

        if effective_tab == "my":
            author_filters = [DealComment.author_id == caller_uid]
            if ctx.user_id:
                author_filters.append(DealComment.author_id == str(ctx.user_id))
            if ctx.display_name:
                author_filters.append(func.lower(DealComment.author) == func.lower(ctx.display_name))
            if ctx.all_owner_names:
                author_filters.extend([func.lower(DealComment.author) == func.lower(o) for o in ctx.all_owner_names])
            q = q.filter(or_(*author_filters))

    elif ctx.is_management:
        if effective_tab == "my":
            author_filters = [DealComment.author_id == caller_uid]
            if ctx.user_id:
                author_filters.append(DealComment.author_id == str(ctx.user_id))
            if ctx.display_name:
                author_filters.append(func.lower(DealComment.author) == func.lower(ctx.display_name))
            q = q.filter(or_(*author_filters))
        else:
            if author and author.strip():
                q = q.filter(func.lower(DealComment.author).contains(author.strip().lower()))
            if author_role and author_role.strip() and author_role != "all":
                q = q.filter(DealComment.author_role == author_role.strip())

    elif ctx.is_admin:
        if effective_tab == "my":
            author_filters = [DealComment.author_id == caller_uid]
            if ctx.user_id:
                author_filters.append(DealComment.author_id == str(ctx.user_id))
            if ctx.display_name:
                author_filters.append(func.lower(DealComment.author) == func.lower(ctx.display_name))
            q = q.filter(or_(*author_filters))
        else:
            if author and author.strip():
                q = q.filter(func.lower(DealComment.author).contains(author.strip().lower()))
            if author_role and author_role.strip() and author_role != "all":
                q = q.filter(DealComment.author_role == author_role.strip())

    # Visibility filter
    if visibility and visibility.strip() and visibility != "all":
        v_clean = visibility.strip().lower()
        if v_clean in ("shared", "shared_with_owner"):
            q = q.filter(DealComment.visibility.in_(["shared", "shared_with_owner"]))
        elif v_clean == "internal":
            if ctx.is_kam:
                q = q.filter(false())
            else:
                q = q.filter(DealComment.visibility == "internal")

    # Date range filters (normalize aware ISO timestamps to naive UTC cleanly for SQLite & PostgreSQL)
    def _parse_filter_dt(raw: str, end_of_day: bool = False) -> Optional[datetime]:
        s = raw.strip()
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        if end_of_day and len(raw.strip()) <= 10:
            dt = dt.replace(hour=23, minute=59, second=59, microsecond=999999)
        return dt

    if start_date and start_date.strip():
        try:
            s_d = _parse_filter_dt(start_date, end_of_day=False)
            if s_d is not None:
                q = q.filter(DealComment.created_at >= s_d)
        except Exception:
            pass

    if end_date and end_date.strip():
        try:
            e_d = _parse_filter_dt(end_date, end_of_day=True)
            if e_d is not None:
                q = q.filter(DealComment.created_at <= e_d)
        except Exception:
            pass

    if limit_to_period:
        snap = None
        if as_of and as_of.strip():
            as_of_clean = as_of.strip()
            snap = db.query(UploadSnapshot).filter(UploadSnapshot.id == as_of_clean).first()
            if not snap:
                try:
                    parsed_d = date.fromisoformat(as_of_clean)
                    snap = db.query(UploadSnapshot).filter(UploadSnapshot.snapshot_date == parsed_d).first()
                except ValueError:
                    snap = None
        if not snap:
            snap = db.query(UploadSnapshot).filter(UploadSnapshot.is_active_today == True).first()  # noqa: E712
        if not snap:
            snap = db.query(UploadSnapshot).order_by(UploadSnapshot.snapshot_date.desc()).first()

        if snap:
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
            period_opp_ids = [r[0] for r in period_opp_query.all() if r[0]]
            if period_opp_ids:
                q = q.filter(DealComment.opportunity_id_18.in_(period_opp_ids))
            else:
                q = q.filter(false())

    if deal and deal.strip():
        d_term = f"%{deal.strip().lower()}%"
        matching_opp_ids = [
            r[0] for r in db.query(Opportunity.opportunity_id_18).filter(
                or_(
                    func.lower(Opportunity.opportunity_name).like(d_term),
                    func.lower(Opportunity.opportunity_id_18).like(d_term),
                )
            ).distinct().all()
            if r[0]
        ]
        if matching_opp_ids:
            q = q.filter(DealComment.opportunity_id_18.in_(matching_opp_ids))
        else:
            q = q.filter(false())

    if account and account.strip():
        a_term = f"%{account.strip().lower()}%"
        matching_opp_ids = [
            r[0] for r in db.query(Opportunity.opportunity_id_18).filter(
                func.lower(Opportunity.account_name).like(a_term)
            ).distinct().all()
            if r[0]
        ]
        if matching_opp_ids:
            q = q.filter(DealComment.opportunity_id_18.in_(matching_opp_ids))
        else:
            q = q.filter(false())

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
            if r[0]
        ]
        search_conds = [
            (or_(DealComment.is_deleted.is_(False), DealComment.is_deleted.is_(None))) & func.lower(DealComment.text).like(s_term),
            func.lower(DealComment.author).like(s_term),
        ]
        if matching_opp_ids:
            search_conds.append(DealComment.opportunity_id_18.in_(matching_opp_ids))
        q = q.filter(or_(*search_conds))

    total = q.count()
    total_pages = max(1, math.ceil(total / page_size))
    comments = q.order_by(DealComment.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()

    # Batch-load opportunities (prefers active snapshot, falls back to most recent snapshot with that deal)
    opp_ids = list({c.opportunity_id_18 for c in comments if c.opportunity_id_18})
    opp_objects = get_latest_opportunities_map(db, opp_ids)
    opp_map: dict[str, Any] = {
        oid: {
            "opportunity_name": opp.opportunity_name,
            "account_name": opp.account_name,
            "acv": float(opp.forecast_acv_amount or 0.0),
            "fiscal_period": opp.fiscal_period,
            "close_date": opp.close_date.isoformat() if opp.close_date else None,
        }
        for oid, opp in opp_objects.items()
    }

    # Batch-load all recipient users in 1 query
    all_recip_ids: set[str] = set()
    parsed_rec_map: dict[str, list[str]] = {}
    for c in comments:
        r_list: list[str] = []
        if c.recipient_ids:
            try:
                parsed = json.loads(c.recipient_ids)
                if isinstance(parsed, list):
                    r_list = [str(x) for x in parsed if x]
            except Exception:
                r_list = []
        parsed_rec_map[c.id] = r_list
        for x in r_list:
            if x.lower() not in ("admin", "management", "owner"):
                all_recip_ids.add(x)

    user_map: dict[str, User] = {}
    if all_recip_ids:
        for u in db.query(User).filter(User.id.in_(list(all_recip_ids))).all():
            user_map[str(u.id)] = u

    # Batch-load email status from EmailDeliveryEvent (by comment.id or batch_id) + fallback EmailOutbox
    entity_keys = list({c.id for c in comments} | {c.batch_id for c in comments if c.batch_id})
    event_status_map: dict[str, str] = {}
    if entity_keys:
        events = (
            db.query(EmailDeliveryEvent)
            .filter(EmailDeliveryEvent.entity_id.in_(entity_keys))
            .order_by(EmailDeliveryEvent.created_at.desc())
            .all()
        )
        for ev in events:
            if ev.entity_id and ev.entity_id not in event_status_map:
                sent_c = ev.sent_count or 0
                fail_c = ev.failed_count or 0
                if sent_c > 0 and fail_c == 0:
                    event_status_map[ev.entity_id] = "emailed"
                elif fail_c > 0 and sent_c == 0:
                    event_status_map[ev.entity_id] = "failed"
                elif fail_c > 0:
                    event_status_map[ev.entity_id] = "partial"
                else:
                    event_status_map[ev.entity_id] = "queued"

    outbox_deal_map: dict[str, str] = {}
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
            if ob.deal_id and ob.deal_id not in outbox_deal_map:
                s_raw = (ob.status or "").lower()
                if "sent" in s_raw or "success" in s_raw:
                    outbox_deal_map[ob.deal_id] = "emailed"
                elif "fail" in s_raw or "error" in s_raw:
                    outbox_deal_map[ob.deal_id] = "failed"
                else:
                    outbox_deal_map[ob.deal_id] = "queued"

    items = []
    for c in comments:
        opp_info = opp_map.get(c.opportunity_id_18, {})
        deal_name = opp_info.get("opportunity_name") or c.opportunity_id_18
        account_name = opp_info.get("account_name") or "—"

        recip_names: list[str] = []
        has_admin_recip = False
        for s_rid in parsed_rec_map.get(c.id, []):
            if s_rid.lower() == "admin":
                has_admin_recip = True
                continue
            u = user_map.get(s_rid)
            if u:
                if u.role == "admin":
                    if ctx.is_admin:
                        if u.name and u.name not in recip_names:
                            recip_names.append(u.name)
                    else:
                        has_admin_recip = True
                else:
                    if u.name and u.name not in recip_names:
                        recip_names.append(u.name)
            elif "admin" in s_rid.lower():
                has_admin_recip = True

        if has_admin_recip and "Admin" not in recip_names:
            recip_names.insert(0, "Admin")

        if not recip_names:
            if c.visibility == "internal":
                recip_names = ["Admin"]
            else:
                recip_names = ["Owner", "Admin"]

        email_status = (
            event_status_map.get(c.id)
            or (event_status_map.get(c.batch_id) if c.batch_id else None)
            or outbox_deal_map.get(c.opportunity_id_18)
            or "emailed"
        )

        display_author = c.author
        if not ctx.is_admin and c.author_role == "admin":
            display_author = "Admin"

        items.append({
            "id": c.id,
            "deal_id": c.opportunity_id_18,
            "deal_name": deal_name,
            "account_name": account_name,
            "text": "This message was removed" if c.is_deleted else c.text,
            "is_deleted": bool(c.is_deleted),
            "visibility": "shared" if c.visibility in ("shared", "shared_with_owner", "public") else "internal",
            "author": display_author,
            "author_id": c.author_id,
            "author_role": c.author_role,
            "batch_id": c.batch_id,
            "created_at": to_utc_iso(c.created_at),
            "edited_at": to_utc_iso(c.edited_at),
            "deleted_at": to_utc_iso(c.deleted_at),
            "created_at_formatted": c.created_at.strftime("%b %d, %Y, %I:%M %p UTC") if c.created_at else "",
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


@router.get("/{comment_id}/history", dependencies=[Depends(require_admin_context)])
def get_comment_history_by_id(
    comment_id: str,
    db: Session = Depends(get_db),
    ctx: UserContext = Depends(require_admin_context),
):
    """Admin-only edit/unsend version history for a comment."""
    comment = db.query(DealComment).filter(DealComment.id == comment_id).first()
    if not comment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found.")
    rows = (
        db.query(CommentMessageHistory)
        .filter(
            CommentMessageHistory.entity_type == "deal_comment",
            CommentMessageHistory.entity_id == comment_id,
        )
        .order_by(CommentMessageHistory.created_at.desc())
        .all()
    )
    return {
        "comment_id": comment_id,
        "history": [
            {
                "id": r.id,
                "action": r.action,
                "previous_text": r.previous_text,
                "new_text": r.new_text,
                "previous_visibility": r.previous_visibility,
                "new_visibility": r.new_visibility,
                "actor_name": r.actor_name or "Admin",
                "actor_role": r.actor_role or "admin",
                "created_at": to_utc_iso(r.created_at),
            }
            for r in rows
        ],
    }


class BatchCommentRequest(BaseModel):
    deal_ids: list[str]
    text: str
    visibility: Optional[str] = "internal"
    recipient_ids: Optional[list[str]] = None


@router.post("/batch", dependencies=[Depends(require_authenticated)])
def create_batch_comment(
    body: BatchCommentRequest,
    background_tasks: BackgroundTasks,
    ctx: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db),
):
    """
    Create a comment across multiple deals (or a single deal).
    Save-first: persists DealComment + AnnotationAudit, commits, returns 2xx immediately.
    Notifications, EmailDeliveryEvent, EmailOutbox, and batch SMTP run in the background.
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

    opp_map = get_latest_opportunities_map(db, cleaned_ids)

    author_name = ctx.display_name or (
        "Admin" if ctx.is_admin else ("Management" if ctx.is_management else "Opportunity Owner")
    )
    author_role = ctx.role or "viewer"
    caller_uid = resolve_caller_uid(db, ctx)
    user_disp = ctx.display_name or ctx.email or author_name

    if ctx.is_kam:
        for d_id in cleaned_ids:
            if not is_deal_owned_by_kam(db, d_id, ctx.all_owner_names):
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

    # Resolve recipients cleanly (groups expanded, Management locks Admin on, author skipped, deduplicated)
    resolved = resolve_recipients(
        db=db,
        caller_uid=caller_uid,
        caller_role=author_role,
        raw_recipient_ids=body.recipient_ids,
        deal_ids=cleaned_ids,
        kind="batch_comment",
        visibility=vis,
    )

    batch_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    recipient_ids_json = json.dumps(resolved.recipient_ids) if resolved.recipient_ids else None

    comments_created: list[DealComment] = []
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
            author_id=caller_uid,
            author_role=author_role,
            recipient_ids=recipient_ids_json,
            batch_id=batch_id,
        )
        db.add(comment)
        comments_created.append(comment)

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

    db.commit()

    # Build per-recipient messages (owners get ONLY their own deals; others get all deals)
    def format_deal_line(d_id: str) -> str:
        o = opp_map.get(d_id)
        if o:
            acv_str = f" – ${float(o.forecast_acv_amount):,.2f}" if o.forecast_acv_amount is not None else ""
            acct_str = f" ({o.account_name})" if o.account_name else ""
            return f"• {o.opportunity_name or d_id}{acct_str}{acv_str}"
        return f"• {d_id}"

    owner_to_deal_ids: dict[str, list[str]] = {}
    if vis == "shared_with_owner":
        for d_id in cleaned_ids:
            o = opp_map.get(d_id)
            if o and o.opportunity_owner:
                owner_u = resolve_owner_user(db, o.opportunity_owner)
                if owner_u and str(owner_u.id) != str(caller_uid):
                    owner_to_deal_ids.setdefault(str(owner_u.id), []).append(d_id)

    n_all = len(cleaned_ids)
    first_opp = opp_map.get(cleaned_ids[0])
    all_lines = [format_deal_line(d_id) for d_id in cleaned_ids]
    full_msg = (
        cleaned_text
        if n_all == 1
        else (
            f"{cleaned_text}\n\nDeals ({n_all}):\n"
            + "\n".join(all_lines[:20])
            + (f"\n... and {len(all_lines) - 20} more" if len(all_lines) > 20 else "")
        )
    )
    batch_summary_title = f"{n_all} deal{'s' if n_all > 1 else ''}"
    entity_target_id = comments_created[0].id if n_all == 1 else batch_id

    per_recipient_messages: dict[str, dict[str, Any]] = {}
    for r_user in resolved.recipients:
        uid = str(r_user.id)
        if uid in owner_to_deal_ids and r_user.role == "kam":
            o_deals = owner_to_deal_ids[uid]
            n_deals = len(o_deals)
            o_first = opp_map.get(o_deals[0])
            o_lines = [format_deal_line(d_id) for d_id in o_deals]
            msg_text = (
                cleaned_text
                if n_deals == 1 and n_all == 1
                else (
                    f"{cleaned_text}\n\nDeals ({n_deals}):\n"
                    + "\n".join(o_lines[:15])
                    + (f"\n... and {len(o_lines) - 15} more" if len(o_lines) > 15 else "")
                )
            )
            per_recipient_messages[uid] = {
                "title": f"New comment from {author_name} on {n_deals} deal{'s' if n_deals > 1 else ''}",
                "message": msg_text,
                "deal_id": o_deals[0] if n_deals == 1 else None,
                "deal_name": o_first.opportunity_name if (o_first and n_deals == 1) else f"Batch: {n_deals} deals",
                "account_name": o_first.account_name if (o_first and n_deals == 1) else None,
                "acv_amount": float(o_first.forecast_acv_amount) if (o_first and n_deals == 1 and o_first.forecast_acv_amount is not None) else None,
                "target_id": entity_target_id,
            }
        else:
            per_recipient_messages[uid] = {
                "title": f"New comment from {author_name} on {batch_summary_title}",
                "message": full_msg,
                "deal_id": cleaned_ids[0] if n_all == 1 else None,
                "deal_name": first_opp.opportunity_name if (first_opp and n_all == 1) else f"Batch: {n_all} deals",
                "account_name": first_opp.account_name if (first_opp and n_all == 1) else None,
                "acv_amount": float(first_opp.forecast_acv_amount) if (first_opp and n_all == 1 and first_opp.forecast_acv_amount is not None) else None,
                "target_id": entity_target_id,
            }

    subject_label = (
        f"New comment: {(first_opp.opportunity_name if first_opp else cleaned_ids[0])[:40]}"
        if n_all == 1
        else f"New comment on {batch_summary_title}"
    )

    background_tasks.add_task(
        run_post_commit_delivery,
        bind_engine=db.get_bind(),
        event_type="comment" if n_all == 1 else "batch_comment",
        entity_type="deal_comment",
        entity_id=entity_target_id,
        author_id=caller_uid,
        author_name=author_name,
        author_role=author_role,
        author_email=ctx.email or "",
        subject=subject_label,
        body_text=cleaned_text,
        deal_id=cleaned_ids[0] if n_all == 1 else None,
        deal_name=first_opp.opportunity_name if (first_opp and n_all == 1) else f"Batch: {n_all} deals",
        account_name=first_opp.account_name if (first_opp and n_all == 1) else None,
        acv_amount=float(first_opp.forecast_acv_amount) if (first_opp and n_all == 1 and first_opp.forecast_acv_amount is not None) else None,
        recipient_user_ids=resolved.recipient_ids,
        recipient_summary=resolved.summary_admin,
        audit_event_type="batch_comment_created" if n_all > 1 else "comment_created",
        audit_details={
            "batch_id": batch_id,
            "deal_count": n_all,
            "visibility": vis,
            "recipient_count": len(resolved.recipient_ids),
        },
        per_recipient_messages=per_recipient_messages,
    )

    return {
        "success": True,
        "batch_id": batch_id,
        "comments_created": len(comments_created),
        "total_recipients": len(resolved.recipient_ids),
    }
