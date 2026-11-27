"""
Messaging Router (Round 18 + Strict Participant Visibility, Edit/Unsend, Per-User Read State, Event Email Log).
Management / Admin <-> KAM threaded conversations linked to specific deals.
- Admin/Management can read a message ONLY if sender or selected recipient.
- KAM sees messages on their own deals.
- Save-first + background notifications/emails; never leaks email addresses.
"""
from __future__ import annotations

import logging
import json
import uuid
from collections import Counter
from datetime import datetime, timezone
from typing import Optional, List, Any
from pydantic import BaseModel
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from sqlalchemy import func, or_

from backend.database import get_db
from backend.models.user import (
    User,
    DealMessage,
    EmailOutbox,
    EmailDeliveryEvent,
    CommentMessageHistory,
    MessageReadReceipt,
    Notification,
)
from backend.models.opportunity import Opportunity
from backend.services.context import (
    UserContext,
    require_authenticated,
    require_management_or_admin,
)
from backend.services.audit_service import log_audit_event
from backend.services.notification_service import NotificationService
from backend.services.schema_check import raise_db_endpoint_error
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

router = APIRouter(prefix="/api/messages", tags=["messages"])


class SendDealMessageRequest(BaseModel):
    deal_id: str
    subject: str
    body: str
    priority: Optional[str] = "normal"  # "low" | "normal" | "high" | "urgent"
    recipient_ids: Optional[List[str]] = None


class ReplyMessageRequest(BaseModel):
    body: str
    recipient_ids: Optional[List[str]] = None


class UpdateMessageRequest(BaseModel):
    body: str


def _parse_rec_ids(msg: DealMessage) -> list[str]:
    ids: list[str] = []
    if msg.recipient_ids:
        try:
            parsed = json.loads(msg.recipient_ids)
            if isinstance(parsed, list):
                ids = [str(x) for x in parsed if x]
        except Exception:
            ids = []
    if not ids and msg.recipient_id:
        ids = [str(msg.recipient_id)]
    return ids


def _can_user_read_message(
    msg: DealMessage,
    caller_uid: str,
    ctx: UserContext,
    owned_deal_ids: Optional[set[str]] = None,
) -> bool:
    """
    Visibility matrix for Deal Communications Hub:
    - KAM: owns the deal, or is sender/selected recipient.
    - Admin & Management: ONLY if sender or one of the selected recipients.
    """
    rec_ids = _parse_rec_ids(msg)
    is_participant = (
        str(msg.sender_id) == str(caller_uid)
        or (ctx.user_id and str(msg.sender_id) == str(ctx.user_id))
        or str(caller_uid) in rec_ids
        or (ctx.user_id and str(ctx.user_id) in rec_ids)
        or (msg.recipient_id and str(msg.recipient_id) == str(caller_uid))
    )
    if ctx.is_kam:
        if owned_deal_ids is not None and msg.deal_id in owned_deal_ids:
            return True
        return is_participant
    return is_participant


@router.get("/recipients")
def get_message_recipients(
    deal_id: Optional[str] = None,
    ctx: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db),
):
    """
    Candidate recipients for Compose, Reply, and Comments.
    STRICT PRIVACY: Returns names, roles, counts, and IDs only; NEVER returns email addresses.
    """
    if ctx.is_kam and deal_id:
        if not is_deal_owned_by_kam(db, deal_id, ctx.all_owner_names):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access forbidden: You do not own this deal.",
            )

    deal_owner = None
    if deal_id:
        opp_map = get_latest_opportunities_map(db, [deal_id])
        opp = opp_map.get(deal_id)
        if opp and opp.opportunity_owner:
            owner_u = resolve_owner_user(db, opp.opportunity_owner)
            if owner_u:
                deal_owner = {"id": owner_u.id, "name": owner_u.name, "role": owner_u.role, "is_owner": True}

    mgmt_users = (
        db.query(User)
        .filter(User.role == "management", User.status == "active")
        .order_by(User.name.asc())
        .all()
    )
    admin_users = (
        db.query(User)
        .filter(User.role == "admin", User.status == "active")
        .order_by(User.name.asc())
        .all()
    )

    mgmt_counts = Counter(u.name for u in mgmt_users if u.name)
    seen_mgmt: dict[str, int] = {}
    mgmt_list = []
    for u in mgmt_users:
        base_name = u.name or "Management"
        if mgmt_counts[base_name] > 1:
            idx = seen_mgmt.get(base_name, 0) + 1
            seen_mgmt[base_name] = idx
            display_name = f"{base_name} ({idx})"
        else:
            display_name = base_name
        mgmt_list.append({"id": u.id, "name": display_name, "role": u.role})

    if ctx.is_admin:
        admin_list = [{"id": u.id, "name": u.name, "role": u.role} for u in admin_users]
        default_admin_ids = [u["id"] for u in admin_list]
    else:
        admin_list = [{"id": "admin", "name": "Admin", "role": "admin", "count": len(admin_users)}]
        default_admin_ids = ["admin"]

    defaults = []
    if ctx.is_kam:
        defaults = [u["id"] for u in mgmt_list] + default_admin_ids
    else:
        if deal_owner:
            defaults.append(deal_owner["id"])
        defaults += default_admin_ids

    return {
        "deal_owner": deal_owner,
        "management": mgmt_list,
        "admins": admin_list,
        "admin_count": len(admin_users),
        "management_count": len(mgmt_users),
        "defaults": list(dict.fromkeys(defaults)),
    }


@router.get("/email-log")
def get_email_log(
    ctx: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db),
    limit: int = Query(100, ge=1, le=500),
):
    """
    Email delivery event log (ONE row per comment/message event).
    - Admin: all events; body_preview and per-recipient details visible ONLY if sender or selected recipient.
    - Management & KAM ("My email log"): only events they sent or received.
    - PRIVACY ENFORCEMENT: Never includes email addresses anywhere in response!
    """
    try:
        return _execute_email_log_query(ctx=ctx, db=db, limit=limit)
    except HTTPException:
        raise
    except SQLAlchemyError as db_exc:
        raise_db_endpoint_error(
            db,
            db_exc,
            endpoint="GET /api/messages/email-log",
            params={"limit": limit, "role": getattr(ctx, "role", None)},
            generic_detail="Could not load email log due to a database error. Please try again.",
        )


def _execute_email_log_query(
    *,
    ctx: UserContext,
    db: Session,
    limit: int,
) -> dict[str, Any]:
    caller_uid = resolve_caller_uid(db, ctx)

    events_q = db.query(EmailDeliveryEvent).order_by(EmailDeliveryEvent.created_at.desc())
    all_events = events_q.limit(limit * 3 if not ctx.is_admin else limit).all()

    # Batch-load child EmailOutbox items for these events
    event_ids = [ev.id for ev in all_events]
    outbox_by_event: dict[str, list[EmailOutbox]] = {}
    if event_ids:
        ob_rows = (
            db.query(EmailOutbox)
            .filter(EmailOutbox.event_id.in_(event_ids))
            .order_by(EmailOutbox.created_at.asc())
            .all()
        )
        for ob in ob_rows:
            if ob.event_id:
                outbox_by_event.setdefault(ob.event_id, []).append(ob)

    # Also build allowed names for legacy EmailOutbox rows without event_id
    allowed_names = set()
    if not ctx.is_admin:
        for nm in (ctx.display_name, *(ctx.all_owner_names or [])):
            if nm:
                allowed_names.add(nm.strip().lower())
        u_rec = db.query(User).filter(User.id == caller_uid).first()
        if u_rec and u_rec.name:
            allowed_names.add(u_rec.name.strip().lower())

    results: list[dict[str, Any]] = []
    for ev in all_events:
        sel_ids: list[str] = []
        if ev.selected_recipient_ids:
            try:
                parsed = json.loads(ev.selected_recipient_ids)
                if isinstance(parsed, list):
                    sel_ids = [str(x) for x in parsed if x]
            except Exception:
                sel_ids = []

        is_sender = str(ev.author_id) == str(caller_uid) or (ctx.user_id and str(ev.author_id) == str(ctx.user_id))
        is_recipient = str(caller_uid) in sel_ids or (ctx.user_id and str(ctx.user_id) in sel_ids)
        can_see_detail = is_sender or is_recipient

        if not ctx.is_admin and not can_see_detail:
            continue

        a_name = ev.author_name or "System"
        if not ctx.is_admin and ev.author_role == "admin":
            a_name = "Admin"

        recip_summary = ev.recipient_summary or ""
        if not ctx.is_admin and ev.recipient_summary:
            # Mask individual admin names if any slipped in
            recip_summary = ev.recipient_summary

        ob_list = outbox_by_event.get(ev.id, [])
        # Recompute counts live from outbox children if present
        if ob_list:
            sent_cnt = sum(1 for o in ob_list if o.status == "sent")
            failed_cnt = sum(1 for o in ob_list if o.status == "failed")
            skipped_cnt = sum(1 for o in ob_list if o.status == "skipped")
            pending_cnt = sum(1 for o in ob_list if o.status in ("pending", "pending – email not configured"))
        else:
            sent_cnt = ev.sent_count
            failed_cnt = ev.failed_count
            skipped_cnt = ev.skipped_count
            pending_cnt = max(0, (ev.total_count or 0) - sent_cnt - failed_cnt - skipped_cnt)

        per_recipient_detail = []
        if can_see_detail:
            for o in ob_list:
                r_name = o.recipient_name or "User"
                if not ctx.is_admin and o.recipient_role == "admin":
                    r_name = "Admin"
                per_recipient_detail.append({
                    "id": o.id,
                    "name": r_name,
                    "role": o.recipient_role or "user",
                    "status": o.status,
                    "reason": o.error_message if o.status in ("failed", "skipped") else None,
                    "attempts": o.retry_count or 0,
                    "sent_at": to_utc_iso(o.sent_at),
                })

        overall_status = (
            "sent" if (sent_cnt > 0 and failed_cnt == 0 and pending_cnt == 0)
            else ("failed" if (failed_cnt > 0 and sent_cnt == 0)
            else ("partial" if (sent_cnt > 0 and failed_cnt > 0)
            else ("skipped" if (skipped_cnt > 0 and sent_cnt == 0 and failed_cnt == 0 and pending_cnt == 0)
            else "pending")))
        )

        results.append({
            "id": ev.id,
            "created_at": to_utc_iso(ev.created_at),
            "event_type": ev.event_type,
            "template_type": ev.event_type,
            "deal_id": ev.deal_id,
            "deal_name": ev.deal_name,
            "author_name": a_name,
            "sender_name": a_name,
            "author_role": ev.author_role or "system",
            "sender_role": ev.author_role or "system",
            "subject": ev.subject,
            "recipient_summary": recip_summary,
            "recipient_name": recip_summary,
            "recipient_role": "group",
            "sent_count": sent_cnt,
            "failed_count": failed_cnt,
            "skipped_count": skipped_cnt,
            "pending_count": pending_cnt,
            "total_count": len(ob_list) if ob_list else ev.total_count,
            "status": overall_status,
            "body_preview": ev.body_preview if can_see_detail else None,
            "recipients": per_recipient_detail,
            "details_redacted": not can_see_detail,
        })
        if len(results) >= limit:
            break

    # Include legacy EmailOutbox rows without event_id (including template_type 'message' and 'reply')
    if len(results) < limit:
        legacy_q = db.query(EmailOutbox).filter(
            EmailOutbox.event_id.is_(None),
            EmailOutbox.template_type.in_(["message", "reply", "new_message", "reply_message", "comment", "deal_comment"]),
        )
        if not ctx.is_admin:
            legacy_conds = [
                EmailOutbox.recipient_user_id == caller_uid,
                EmailOutbox.sender_id == caller_uid,
            ]
            if allowed_names:
                legacy_conds.append(func.lower(EmailOutbox.recipient_name).in_(list(allowed_names)))
                legacy_conds.append(func.lower(EmailOutbox.sender_name).in_(list(allowed_names)))
            legacy_q = legacy_q.filter(or_(*legacy_conds))

        legacy_items = legacy_q.order_by(EmailOutbox.created_at.desc()).limit(limit - len(results)).all()
        for item in legacy_items:
            s_name = item.sender_name or "System"
            r_name = item.recipient_name or "User"
            if not ctx.is_admin:
                if item.sender_role == "admin":
                    s_name = "Admin"
                if item.recipient_role == "admin":
                    r_name = "Admin"

            is_sender_or_rec = (
                ctx.is_admin
                and (
                    str(item.sender_id) == str(caller_uid)
                    or str(item.recipient_user_id) == str(caller_uid)
                    or (item.recipient_name and ctx.display_name and item.recipient_name.lower() == ctx.display_name.lower())
                    or (item.sender_name and ctx.display_name and item.sender_name.lower() == ctx.display_name.lower())
                )
            ) or not ctx.is_admin

            results.append({
                "id": item.id,
                "created_at": to_utc_iso(item.created_at),
                "sent_at": to_utc_iso(item.sent_at),
                "event_type": item.template_type,
                "template_type": item.template_type,
                "deal_id": item.deal_id,
                "deal_name": item.deal_name,
                "author_name": s_name,
                "sender_name": s_name,
                "author_role": item.sender_role or "system",
                "sender_role": item.sender_role or "system",
                "subject": item.subject,
                "recipient_summary": r_name,
                "recipient_name": r_name,
                "recipient_role": item.recipient_role or "user",
                "sent_count": 1 if item.status == "sent" else 0,
                "failed_count": 1 if item.status == "failed" else 0,
                "skipped_count": 1 if item.status == "skipped" else 0,
                "pending_count": 1 if item.status in ("pending", "pending – email not configured") else 0,
                "total_count": 1,
                "status": item.status,
                "attempts": item.retry_count or 1,
                "error_message": item.error_message if is_sender_or_rec else None,
                "body_preview": (item.body_text[:200] if (item.body_text and is_sender_or_rec) else None),
                "recipients": [
                    {
                        "id": item.id,
                        "name": r_name,
                        "role": item.recipient_role or "user",
                        "status": item.status,
                        "reason": item.error_message,
                        "attempts": item.retry_count or 0,
                        "sent_at": to_utc_iso(item.sent_at),
                    }
                ] if is_sender_or_rec else [],
                "details_redacted": not is_sender_or_rec,
            })

    return {"log": results, "events": results}


@router.post("")
def send_deal_message(
    req: SendDealMessageRequest,
    background_tasks: BackgroundTasks,
    ctx: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db),
):
    """
    Send a message about a specific deal.
    Save-first: persists DealMessage, commits, returns 2xx immediately.
    Notifications, EmailDeliveryEvent, EmailOutbox, AuditLog, and batch SMTP run in background.
    """
    opp_map = get_latest_opportunities_map(db, [req.deal_id])
    opp = opp_map.get(req.deal_id)
    if not opp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Opportunity not found.")

    if ctx.is_kam:
        if not is_deal_owned_by_kam(db, req.deal_id, ctx.all_owner_names):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access forbidden: You do not own this deal.")

    caller_uid = resolve_caller_uid(db, ctx)
    sender_user = db.query(User).filter(User.id == caller_uid).first()
    sender_name = sender_user.name if sender_user else ctx.display_name
    sender_role = sender_user.role if sender_user else ctx.role

    resolved = resolve_recipients(
        db=db,
        caller_uid=caller_uid,
        caller_role=sender_role,
        raw_recipient_ids=req.recipient_ids,
        deal_ids=[req.deal_id],
        kind="message",
    )

    first_recipient_id = resolved.recipients[0].id if resolved.recipients else None
    first_recipient_name = resolved.recipients[0].name if resolved.recipients else None

    msg_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    msg = DealMessage(
        id=msg_id,
        deal_id=req.deal_id,
        thread_id=msg_id,
        sender_id=caller_uid,
        sender_name=sender_name,
        sender_role=sender_role,
        recipient_id=first_recipient_id,
        recipient_name=first_recipient_name,
        recipient_ids=json.dumps(resolved.recipient_ids),
        subject=req.subject.strip(),
        body=req.body.strip(),
        priority=req.priority or "normal",
        is_read=False,
        thread_status="open",
        created_at=now,
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)

    deal_title = opp.opportunity_name or opp.opportunity_id_18
    short_deal = (deal_title or req.deal_id)[:40]
    background_tasks.add_task(
        run_post_commit_delivery,
        bind_engine=db.get_bind(),
        event_type="new_message",
        entity_type="deal_message",
        entity_id=msg_id,
        author_id=caller_uid,
        author_name=sender_name,
        author_role=sender_role,
        author_email=ctx.email or "",
        subject=req.subject.strip() or f"New message: {short_deal}",
        body_text=req.body.strip(),
        deal_id=req.deal_id,
        deal_name=deal_title,
        account_name=opp.account_name,
        acv_amount=float(opp.forecast_acv_amount or 0.0) if opp.forecast_acv_amount is not None else None,
        recipient_user_ids=resolved.recipient_ids,
        recipient_summary=resolved.summary_admin,
        audit_event_type="message_sent",
        audit_details={
            "message_id": msg_id,
            "deal_id": req.deal_id,
            "recipient_count": len(resolved.recipient_ids),
            "subject": req.subject.strip(),
        },
    )

    return {"status": "sent", "message_id": msg.id}


@router.post("/{message_id}/reply")
def reply_to_message(
    message_id: str,
    req: ReplyMessageRequest,
    background_tasks: BackgroundTasks,
    ctx: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db),
):
    """
    Reply to a deal message thread.
    Enforces caller access to the parent message. Save-first + background delivery.
    """
    parent = db.query(DealMessage).filter(DealMessage.id == message_id).first()
    if not parent:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parent message not found.")

    caller_uid = resolve_caller_uid(db, ctx)
    owned_deal_ids = get_kam_owned_deal_ids(db, ctx.all_owner_names) if ctx.is_kam else None
    if not _can_user_read_message(parent, caller_uid, ctx, owned_deal_ids):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")

    root_id = parent.thread_id or parent.id
    root_msg = db.query(DealMessage).filter(DealMessage.id == root_id).first()

    caller_user = db.query(User).filter(User.id == caller_uid).first()
    sender_name = caller_user.name if caller_user else ctx.display_name
    sender_role = caller_user.role if caller_user else ctx.role

    # Collect existing thread participants (from visible thread messages)
    thread_msgs = db.query(DealMessage).filter(DealMessage.thread_id == root_id).all()
    participant_uids: list[str] = []
    for tm in thread_msgs:
        if tm.sender_id:
            participant_uids.append(str(tm.sender_id))
        if tm.recipient_id:
            participant_uids.append(str(tm.recipient_id))
        participant_uids.extend(_parse_rec_ids(tm))

    resolved = resolve_recipients(
        db=db,
        caller_uid=caller_uid,
        caller_role=sender_role,
        raw_recipient_ids=req.recipient_ids,
        deal_ids=[parent.deal_id],
        kind="reply",
        thread_participant_ids=list(dict.fromkeys(participant_uids)),
    )

    first_recipient_id = resolved.recipients[0].id if resolved.recipients else (parent.sender_id if str(parent.sender_id) != str(caller_uid) else parent.recipient_id)
    first_recipient_user = db.query(User).filter(User.id == first_recipient_id).first() if first_recipient_id else None
    first_recipient_name = first_recipient_user.name if first_recipient_user else None

    reply_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    reply_subject = f"Re: {root_msg.subject if root_msg and root_msg.subject else parent.subject or ''}".strip()
    reply = DealMessage(
        id=reply_id,
        deal_id=parent.deal_id,
        thread_id=root_id,
        sender_id=caller_uid,
        sender_name=sender_name,
        sender_role=sender_role,
        recipient_id=first_recipient_id,
        recipient_name=first_recipient_name,
        recipient_ids=json.dumps(resolved.recipient_ids),
        subject=reply_subject,
        body=req.body.strip(),
        priority=parent.priority,
        is_read=False,
        thread_status="open",
        created_at=now,
    )
    db.add(reply)
    if root_msg:
        root_msg.thread_status = "open"
    db.commit()
    db.refresh(reply)

    opp_map = get_latest_opportunities_map(db, [parent.deal_id])
    opp = opp_map.get(parent.deal_id)
    deal_title = opp.opportunity_name if opp else parent.deal_id
    background_tasks.add_task(
        run_post_commit_delivery,
        bind_engine=db.get_bind(),
        event_type="reply_message",
        entity_type="deal_message",
        entity_id=reply_id,
        author_id=caller_uid,
        author_name=sender_name,
        author_role=sender_role,
        author_email=ctx.email or "",
        subject=reply_subject or f"Re: {(deal_title or '')[:40]}",
        body_text=req.body.strip(),
        deal_id=parent.deal_id,
        deal_name=deal_title,
        account_name=opp.account_name if opp else None,
        acv_amount=float(opp.forecast_acv_amount or 0.0) if (opp and opp.forecast_acv_amount is not None) else None,
        recipient_user_ids=resolved.recipient_ids,
        recipient_summary=resolved.summary_admin,
        audit_event_type="message_reply_sent",
        audit_details={
            "message_id": reply_id,
            "deal_id": parent.deal_id,
            "reply_to": message_id,
            "recipient_count": len(resolved.recipient_ids),
        },
    )

    return {"status": "reply_sent", "message_id": reply.id}


@router.put("/{message_id}")
def update_message(
    message_id: str,
    req: UpdateMessageRequest,
    ctx: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db),
):
    """Edit own message (Author only; editing does not send new emails)."""
    msg = db.query(DealMessage).filter(DealMessage.id == message_id).first()
    if not msg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found.")
    if msg.is_deleted:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot edit a removed message.")

    caller_uid = resolve_caller_uid(db, ctx)
    if str(msg.sender_id) != str(caller_uid) and str(msg.sender_id) != str(ctx.user_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the author can edit this message.")

    cleaned_body = (req.body or "").strip()
    if not cleaned_body:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Message body cannot be empty.")

    now = datetime.now(timezone.utc)
    old_body = msg.body
    msg.body = cleaned_body
    msg.edited_at = now

    hist = CommentMessageHistory(
        id=str(uuid.uuid4()),
        entity_type="deal_message",
        entity_id=msg.id,
        deal_id=msg.deal_id,
        action="edit",
        previous_text=old_body,
        new_text=cleaned_body,
        actor_id=caller_uid,
        actor_name=ctx.display_name or msg.sender_name,
        actor_role=ctx.role,
        created_at=now,
    )
    db.add(hist)
    db.commit()
    db.refresh(msg)

    log_audit_event(
        db,
        "message_edited",
        user_id=caller_uid,
        user_email=ctx.email,
        details={"message_id": msg.id, "deal_id": msg.deal_id},
    )

    return {
        "status": "updated",
        "message": {
            "id": msg.id,
            "body": msg.body,
            "edited_at": to_utc_iso(msg.edited_at),
            "is_deleted": False,
        },
    }


@router.delete("/{message_id}")
def unsend_message(
    message_id: str,
    ctx: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db),
):
    """Unsend (remove) own message (Author only). Shows tombstone and clears unread notifications."""
    msg = db.query(DealMessage).filter(DealMessage.id == message_id).first()
    if not msg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found.")
    if msg.is_deleted:
        return {"status": "deleted", "message_id": msg.id}

    caller_uid = resolve_caller_uid(db, ctx)
    if str(msg.sender_id) != str(caller_uid) and str(msg.sender_id) != str(ctx.user_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the author can unsend this message.")

    now = datetime.now(timezone.utc)
    old_body = msg.body
    msg.is_deleted = True
    msg.deleted_at = now
    msg.deleted_by = caller_uid
    msg.deleted_by_name = ctx.display_name or msg.sender_name

    hist = CommentMessageHistory(
        id=str(uuid.uuid4()),
        entity_type="deal_message",
        entity_id=msg.id,
        deal_id=msg.deal_id,
        action="unsend",
        previous_text=old_body,
        new_text=None,
        actor_id=caller_uid,
        actor_name=ctx.display_name or msg.sender_name,
        actor_role=ctx.role,
        created_at=now,
    )
    db.add(hist)

    # Clear unread notifications for this message
    NotificationService.clear_notifications_for_target(db, "deal_message", [msg.id])
    db.commit()

    log_audit_event(
        db,
        "message_unsent",
        user_id=caller_uid,
        user_email=ctx.email,
        details={"message_id": msg.id, "deal_id": msg.deal_id},
    )

    return {
        "status": "deleted",
        "message_id": msg.id,
        "body": "This message was removed",
        "is_deleted": True,
        "deleted_at": to_utc_iso(msg.deleted_at),
    }


@router.get("/{message_id}/history")
def get_message_history(
    message_id: str,
    ctx: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db),
):
    """
    Edit/unsend history for a message.
    Admin ONLY, and ONLY admins who were sender or selected recipients of the message.
    """
    if not ctx.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access forbidden: Admin permissions required.",
        )

    msg = db.query(DealMessage).filter(DealMessage.id == message_id).first()
    if not msg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found.")

    caller_uid = resolve_caller_uid(db, ctx)
    if not _can_user_read_message(msg, caller_uid, ctx):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access forbidden: Only participating admins can view this message's history.",
        )

    rows = (
        db.query(CommentMessageHistory)
        .filter(
            CommentMessageHistory.entity_type == "deal_message",
            CommentMessageHistory.entity_id == message_id,
        )
        .order_by(CommentMessageHistory.created_at.desc())
        .all()
    )
    return {
        "message_id": message_id,
        "history": [
            {
                "id": r.id,
                "action": r.action,
                "previous_text": r.previous_text,
                "new_text": r.new_text,
                "actor_name": r.actor_name or "Admin",
                "actor_role": r.actor_role or "admin",
                "created_at": to_utc_iso(r.created_at),
            }
            for r in rows
        ],
    }


@router.get("/threads")
def list_message_threads(
    deal_id: Optional[str] = None,
    thread_status: Optional[str] = None,  # "open" | "resolved"
    q: Optional[str] = None,
    owner: Optional[str] = None,
    sender: Optional[str] = None,
    ctx: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db),
):
    """
    List message threads with strict participant isolation, per-user unread counts, and zero N+1 queries.
    - KAM: only their own deals' threads.
    - Management & Admin: ONLY threads containing messages where they are sender or selected recipient.
    """
    try:
        return _execute_list_message_threads(
            deal_id=deal_id,
            thread_status=thread_status,
            q=q,
            owner=owner,
            sender=sender,
            ctx=ctx,
            db=db,
        )
    except HTTPException:
        raise
    except SQLAlchemyError as db_exc:
        raise_db_endpoint_error(
            db,
            db_exc,
            endpoint="GET /api/messages/threads",
            params={"deal_id": deal_id, "thread_status": thread_status, "has_q": bool(q), "role": getattr(ctx, "role", None)},
            generic_detail="Could not load message threads due to a database error. Please try again.",
        )


def _execute_list_message_threads(
    *,
    deal_id: Optional[str],
    thread_status: Optional[str],
    q: Optional[str],
    owner: Optional[str],
    sender: Optional[str],
    ctx: UserContext,
    db: Session,
) -> dict[str, Any]:
    caller_uid = resolve_caller_uid(db, ctx)
    owned_deal_ids = get_kam_owned_deal_ids(db, ctx.all_owner_names) if ctx.is_kam else set()

    msg_q = db.query(DealMessage)
    if deal_id:
        msg_q = msg_q.filter(DealMessage.deal_id == deal_id)
    if thread_status:
        msg_q = msg_q.filter(DealMessage.thread_status == thread_status)

    all_candidate_msgs = msg_q.order_by(DealMessage.created_at.asc()).all()

    # Filter messages strictly by visibility
    visible_msgs = [
        m for m in all_candidate_msgs
        if _can_user_read_message(m, caller_uid, ctx, owned_deal_ids)
    ]
    if not visible_msgs:
        return {"threads": []}

    # Group visible messages by thread_id (or root id)
    msgs_by_thread: dict[str, list[DealMessage]] = {}
    for m in visible_msgs:
        tid = m.thread_id or m.id
        msgs_by_thread.setdefault(tid, []).append(m)

    # Batch-load read receipts for caller
    visible_msg_ids = [m.id for m in visible_msgs]
    read_msg_ids = {
        r[0]
        for r in db.query(MessageReadReceipt.message_id)
        .filter(
            MessageReadReceipt.user_id == caller_uid,
            MessageReadReceipt.message_id.in_(visible_msg_ids),
        )
        .all()
    }

    # Batch-load opportunities and users
    deal_ids = list({m.deal_id for m in visible_msgs if m.deal_id})
    opp_map = get_latest_opportunities_map(db, deal_ids)

    user_ids_needed: set[str] = set()
    for m in visible_msgs:
        if m.sender_id:
            user_ids_needed.add(str(m.sender_id))
        if m.recipient_id:
            user_ids_needed.add(str(m.recipient_id))
    user_map: dict[str, User] = {}
    if user_ids_needed:
        for u in db.query(User).filter(User.id.in_(list(user_ids_needed))).all():
            user_map[str(u.id)] = u

    clean_q = q.strip().lower() if q else None
    threads = []

    for tid, t_msgs in msgs_by_thread.items():
        rm = next((m for m in t_msgs if m.id == tid), t_msgs[0])
        unread_count = 0
        for m in t_msgs:
            if m.is_deleted:
                continue
            if str(m.sender_id) == str(caller_uid) or (ctx.user_id and str(m.sender_id) == str(ctx.user_id)):
                continue
            if m.id not in read_msg_ids:
                unread_count += 1

        opp = opp_map.get(rm.deal_id)
        sender_user = user_map.get(str(rm.sender_id)) if rm.sender_id else None
        recipient_user = user_map.get(str(rm.recipient_id)) if rm.recipient_id else None

        opp_owner = opp.opportunity_owner if opp else (recipient_user.owner_name if recipient_user else "")
        sender_name = sender_user.name if sender_user else (rm.sender_name or "Unknown")
        recipient_name = recipient_user.name if recipient_user else (rm.recipient_name or "Unknown")
        if not ctx.is_admin:
            if (sender_user and sender_user.role == "admin") or rm.sender_role == "admin":
                sender_name = "Admin"
            if recipient_user and recipient_user.role == "admin":
                recipient_name = "Admin"

        deal_name = opp.opportunity_name if opp else rm.deal_id
        account_name = opp.account_name if opp else ""
        last_msg = t_msgs[-1]
        latest_body = "This message was removed" if last_msg.is_deleted else last_msg.body
        last_dt = last_msg.created_at or rm.created_at

        if owner and opp_owner and owner.strip().lower() not in opp_owner.lower():
            continue
        if sender and sender.strip().lower() not in sender_name.lower():
            continue
        if clean_q:
            text_pool = f"{deal_name} {account_name} {rm.deal_id} {opp_owner} {rm.subject} {latest_body}".lower()
            if clean_q not in text_pool:
                continue

        threads.append({
            "thread_id": rm.thread_id or rm.id,
            "deal_id": rm.deal_id,
            "opportunity_id_18": rm.deal_id,
            "deal_name": deal_name,
            "opportunity_name": deal_name,
            "account_name": account_name,
            "opportunity_owner": opp_owner,
            "forecast_acv_amount": float(opp.forecast_acv_amount or 0.0) if opp else 0.0,
            "subject": rm.subject,
            "priority": rm.priority,
            "thread_status": rm.thread_status,
            "sender_name": sender_name,
            "recipient_name": recipient_name,
            "message_count": len(t_msgs),
            "unread_count": unread_count,
            "latest_message": latest_body,
            "latest_message_at": to_utc_iso(last_dt),
            "last_activity": to_utc_iso(last_dt),
            "created_at": to_utc_iso(rm.created_at),
        })

    threads.sort(key=lambda t: t.get("latest_message_at") or "", reverse=True)
    return {"threads": threads}


@router.get("/deal/{deal_id}")
def get_deal_thread(
    deal_id: str,
    ctx: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db),
):
    """Fetch visible message history for a specific deal (enforces strict participant rules, zero N+1)."""
    try:
        return _execute_get_deal_thread(deal_id=deal_id, ctx=ctx, db=db)
    except HTTPException:
        raise
    except SQLAlchemyError as db_exc:
        raise_db_endpoint_error(
            db,
            db_exc,
            endpoint="GET /api/messages/deal/{deal_id}",
            params={"deal_id": deal_id, "role": getattr(ctx, "role", None)},
            generic_detail="Could not load deal messages due to a database error. Please try again.",
        )


def _execute_get_deal_thread(
    *,
    deal_id: str,
    ctx: UserContext,
    db: Session,
) -> dict[str, Any]:
    opp_map = get_latest_opportunities_map(db, [deal_id])
    opp = opp_map.get(deal_id)

    if ctx.is_kam:
        if not is_deal_owned_by_kam(db, deal_id, ctx.all_owner_names):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access forbidden: You do not have access to this opportunity.",
            )

    caller_uid = resolve_caller_uid(db, ctx)
    owned_deal_ids = {deal_id} if ctx.is_kam else None

    all_msgs = (
        db.query(DealMessage)
        .filter(DealMessage.deal_id == deal_id)
        .order_by(DealMessage.created_at.asc())
        .all()
    )
    msgs = [m for m in all_msgs if _can_user_read_message(m, caller_uid, ctx, owned_deal_ids)]

    # Batch-load read receipts for caller
    msg_ids = [m.id for m in msgs]
    read_msg_ids = (
        {
            r[0]
            for r in db.query(MessageReadReceipt.message_id)
            .filter(
                MessageReadReceipt.user_id == caller_uid,
                MessageReadReceipt.message_id.in_(msg_ids),
            )
            .all()
        }
        if msg_ids
        else set()
    )

    # Batch-load all users referenced in messages
    all_uids: set[str] = set()
    parsed_recs: dict[str, list[str]] = {}
    for m in msgs:
        if m.sender_id:
            all_uids.add(str(m.sender_id))
        if m.recipient_id:
            all_uids.add(str(m.recipient_id))
        r_ids = _parse_rec_ids(m)
        parsed_recs[m.id] = r_ids
        all_uids.update(r_ids)

    user_map: dict[str, User] = {}
    if all_uids:
        for u in db.query(User).filter(User.id.in_(list(all_uids))).all():
            user_map[str(u.id)] = u

    results = []
    for m in msgs:
        sender = user_map.get(str(m.sender_id)) if m.sender_id else None
        recipient = user_map.get(str(m.recipient_id)) if m.recipient_id else None
        rec_ids = parsed_recs.get(m.id, [])

        rec_names: list[str] = []
        has_admin_rec = False
        for rid in rec_ids:
            u = user_map.get(rid)
            if not u:
                continue
            if u.role == "admin":
                if ctx.is_admin:
                    if u.name and u.name not in rec_names:
                        rec_names.append(u.name)
                else:
                    has_admin_rec = True
            else:
                if u.name and u.name not in rec_names:
                    rec_names.append(u.name)
        if has_admin_rec and "Admin" not in rec_names:
            rec_names.insert(0, "Admin")
        if not rec_names and recipient:
            rec_names = ["Admin" if recipient.role == "admin" and not ctx.is_admin else (recipient.name or "Recipient")]

        rec_str = ", ".join(rec_names) if rec_names else (m.recipient_name or "Recipient")
        delivery_chip = f"Recipients: {rec_str}" if rec_str else ""

        s_name = sender.name if sender else (m.sender_name or "Unknown")
        s_id = str(m.sender_id)
        if not ctx.is_admin and ((sender and sender.role == "admin") or m.sender_role == "admin"):
            s_name = "Admin"
            s_id = "admin"

        is_sender = str(m.sender_id) == str(caller_uid) or (ctx.user_id and str(m.sender_id) == str(ctx.user_id))
        user_is_read = True if (is_sender or m.is_deleted or m.id in read_msg_ids) else False

        results.append({
            "id": m.id,
            "thread_id": m.thread_id,
            "parent_id": m.thread_id,
            "deal_id": m.deal_id,
            "subject": m.subject,
            "body": "This message was removed" if m.is_deleted else m.body,
            "is_deleted": bool(m.is_deleted),
            "priority": m.priority,
            "is_read": user_is_read,
            "is_me": is_sender,
            "thread_status": m.thread_status,
            "sender_id": s_id,
            "sender_name": s_name,
            "sender_role": sender.role if sender else (m.sender_role or "unknown"),
            "recipient_id": str(m.recipient_id) if m.recipient_id else None,
            "recipient_name": rec_str,
            "recipient_ids": rec_ids if ctx.is_admin else [("admin" if (user_map.get(r) and user_map[r].role == "admin") else r) for r in rec_ids],
            "recipients": rec_names,
            "delivery_status": delivery_chip,
            "created_at": to_utc_iso(m.created_at),
            "edited_at": to_utc_iso(m.edited_at),
            "deleted_at": to_utc_iso(m.deleted_at),
        })

    opp_info = {
        "opportunity_id_18": opp.opportunity_id_18 if opp else deal_id,
        "opportunity_name": opp.opportunity_name if opp else deal_id,
        "account_name": opp.account_name if opp else "",
        "forecast_acv_amount": float(opp.forecast_acv_amount or 0.0) if opp else 0.0,
        "opportunity_owner": opp.opportunity_owner if opp else "",
        "owner": opp.opportunity_owner if opp else "",
    } if opp else None

    return {"deal_id": deal_id, "messages": results, "opportunity": opp_info}


@router.post("/{message_id}/read")
def mark_message_read(
    message_id: str,
    ctx: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db),
):
    """Mark a message and visible thread messages as read ONLY for the current user."""
    msg = db.query(DealMessage).filter(DealMessage.id == message_id).first()
    if not msg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found.")

    caller_uid = resolve_caller_uid(db, ctx)
    owned_deal_ids = get_kam_owned_deal_ids(db, ctx.all_owner_names) if ctx.is_kam else None
    if not _can_user_read_message(msg, caller_uid, ctx, owned_deal_ids):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")

    root_id = msg.thread_id or msg.id
    thread_msgs = db.query(DealMessage).filter(DealMessage.thread_id == root_id).all()
    visible_thread_msgs = [m for m in thread_msgs if _can_user_read_message(m, caller_uid, ctx, owned_deal_ids)]
    target_msg_ids = [m.id for m in visible_thread_msgs]

    existing = {
        r[0]
        for r in db.query(MessageReadReceipt.message_id)
        .filter(
            MessageReadReceipt.user_id == caller_uid,
            MessageReadReceipt.message_id.in_(target_msg_ids),
        )
        .all()
    } if target_msg_ids else set()

    now = datetime.now(timezone.utc)
    for m in visible_thread_msgs:
        if m.id not in existing:
            db.add(
                MessageReadReceipt(
                    id=str(uuid.uuid4()),
                    message_id=m.id,
                    thread_id=root_id,
                    user_id=caller_uid,
                    read_at=now,
                )
            )

    # Also mark matching message/reply notifications read for THIS user only
    if target_msg_ids:
        db.query(Notification).filter(
            Notification.user_id == caller_uid,
            Notification.target_type == "deal_message",
            Notification.target_id.in_(target_msg_ids + [root_id]),
            Notification.is_read == False,
        ).update({"is_read": True, "read_at": now}, synchronize_session="fetch")

    db.commit()
    return {"status": "marked_read"}


@router.post("/{thread_id}/resolve")
def resolve_thread(
    thread_id: str,
    ctx: UserContext = Depends(require_management_or_admin),
    db: Session = Depends(get_db),
):
    """Toggle thread status between open and resolved (participating management/admin only)."""
    root = db.query(DealMessage).filter(DealMessage.id == thread_id).first()
    if not root:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found.")

    caller_uid = resolve_caller_uid(db, ctx)
    if not _can_user_read_message(root, caller_uid, ctx):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")

    new_status = "resolved" if root.thread_status == "open" else "open"
    root.thread_status = new_status
    db.query(DealMessage).filter(DealMessage.thread_id == root.id).update({"thread_status": new_status})
    db.commit()

    log_audit_event(db, "thread_status_toggle", user_id=caller_uid, details={"thread_id": thread_id, "new_status": new_status})
    return {"status": "success", "thread_status": new_status}
