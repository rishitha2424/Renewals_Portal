"""
Messaging Router (Round 18).
Management / Admin <-> KAM threaded conversations linked to specific deals.
Handles message posting, replies, read receipts, and thread resolution.
"""
from __future__ import annotations

import logging
import json
import uuid
from typing import Optional, List
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func, or_

from backend.database import get_db
from backend.models.user import User, DealMessage, EmailOutbox
from backend.models.opportunity import Opportunity
from backend.services.context import (
    UserContext,
    require_authenticated,
    require_management_or_admin,
)
from backend.services.audit_service import log_audit_event
from backend.services.mail_service import MailService
from backend.services.notification_service import NotificationService

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


@router.get("/recipients")
def get_message_recipients(
    deal_id: Optional[str] = None,
    ctx: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db),
):
    """
    Candidate recipients for Compose, Reply, and Comments.
    STRICT PRIVACY: Returns names, roles and IDs only; NEVER returns email addresses.
    """
    deal_owner = None
    if deal_id:
        opp = db.query(Opportunity).filter(Opportunity.opportunity_id_18 == deal_id).first()
        if opp and opp.opportunity_owner:
            owner_clean = opp.opportunity_owner.strip()
            u = db.query(User).filter(func.lower(User.owner_name) == owner_clean.lower(), User.status != "disabled").first()
            if not u:
                from backend.models.user import UserAlias
                alias = db.query(UserAlias).filter(func.lower(UserAlias.alias_name) == owner_clean.lower()).first()
                if alias and alias.user.status != "disabled":
                    u = alias.user
            if u:
                deal_owner = {"id": u.id, "name": u.name, "role": u.role, "is_owner": True}

    mgmt_users = db.query(User).filter(User.role == "management", User.status != "disabled").order_by(User.name.asc()).all()
    admin_users = db.query(User).filter(User.role == "admin", User.status != "disabled").order_by(User.name.asc()).all()

    mgmt_list = [{"id": u.id, "name": u.name, "role": u.role} for u in mgmt_users]
    admin_list = [{"id": u.id, "name": u.name, "role": u.role} for u in admin_users]

    defaults = []
    if ctx.is_kam:
        defaults = [u["id"] for u in mgmt_list] + [u["id"] for u in admin_list]
    else:
        if deal_owner:
            defaults.append(deal_owner["id"])
        defaults += [u["id"] for u in admin_list]

    return {
        "deal_owner": deal_owner,
        "management": mgmt_list,
        "admins": admin_list,
        "defaults": list(dict.fromkeys(defaults)),
    }


@router.get("/email-log")
def get_email_log(
    ctx: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db),
    limit: int = 100,
):
    """
    Email delivery event log.
    - Admin: all message/comment email events.
    - Management & KAM: only their own items ("My email log").
    - PRIVACY ENFORCEMENT: Never includes recipient_email or sender_email!
    """
    q = db.query(EmailOutbox).filter(
        EmailOutbox.template_type.in_(["new_message", "reply_message", "comment", "deal_comment"])
    )
    if not ctx.is_admin:
        allowed_names = set()
        if ctx.display_name:
            allowed_names.add(ctx.display_name)
        if ctx.name:
            allowed_names.add(ctx.name)
        if ctx.all_owner_names:
            allowed_names.update(ctx.all_owner_names)
        
        # Also include user database record's name
        u_rec = db.query(User).filter(User.id == ctx.user_id).first()
        if u_rec and u_rec.name:
            allowed_names.add(u_rec.name)

        if allowed_names:
            name_list = list(allowed_names)
            q = q.filter(
                or_(
                    EmailOutbox.recipient_name.in_(name_list),
                    EmailOutbox.sender_name.in_(name_list),
                )
            )
    items = q.order_by(EmailOutbox.created_at.desc()).limit(limit).all()
    results = []
    for item in items:
        results.append({
            "id": item.id,
            "created_at": item.created_at.isoformat() if item.created_at else None,
            "sent_at": item.sent_at.isoformat() if item.sent_at else None,
            "template_type": item.template_type,
            "deal_id": item.deal_id,
            "deal_name": item.deal_name,
            "sender_name": item.sender_name or "System",
            "sender_role": item.sender_role or "system",
            "recipient_name": item.recipient_name or "User",
            "recipient_role": item.recipient_role or "user",
            "status": item.status,
            "attempts": item.retry_count or 1,
            "error_message": item.error_message,
        })
    return {"log": results}


@router.post("")
def send_deal_message(
    req: SendDealMessageRequest,
    ctx: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db),
):
    """
    Send a message about a specific deal.
    - Admin & Management can message on any deal.
    - KAMs can message on their own deals.
    - Supports explicit recipient_ids or sensible defaults.
    """
    # 1. Resolve Opportunity
    opp = db.query(Opportunity).filter(Opportunity.opportunity_id_18 == req.deal_id).first()
    if not opp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Opportunity not found.")

    if ctx.is_kam:
        if (opp.opportunity_owner or "").strip() not in ctx.all_owner_names:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access forbidden: You do not own this deal.")

    owner_name = (opp.opportunity_owner or "").strip()

    # 2. Resolve Recipients
    caller_uid = ctx.user_id if ctx.user_id != "admin" else db.query(User.id).filter(User.role == "admin").first()[0]
    sender_user = db.query(User).filter(User.id == caller_uid).first()
    sender_name = sender_user.name if sender_user else ctx.display_name
    sender_role = sender_user.role if sender_user else ctx.role

    recipients: list[User] = []
    if req.recipient_ids:
        recipients = db.query(User).filter(User.id.in_(req.recipient_ids), User.status != "disabled").all()
    else:
        # Default recipients
        if ctx.is_kam:
            recipients = db.query(User).filter(User.role.in_(["management", "admin"]), User.status != "disabled").all()
        else:
            admin_users = db.query(User).filter(User.role == "admin", User.status != "disabled").all()
            kam_user = None
            if owner_name:
                kam_user = db.query(User).filter(func.lower(User.owner_name) == owner_name.lower(), User.status != "disabled").first()
                if not kam_user:
                    from backend.models.user import UserAlias
                    alias = db.query(UserAlias).filter(func.lower(UserAlias.alias_name) == owner_name.lower()).first()
                    if alias and alias.user.status != "disabled":
                        kam_user = alias.user
            recipients = list(admin_users)
            if kam_user and kam_user.id not in [u.id for u in recipients]:
                recipients.append(kam_user)

    # Filter out caller
    recipients = [u for u in recipients if str(u.id) != str(caller_uid)]

    first_recipient_id = recipients[0].id if recipients else None
    first_recipient_name = recipients[0].name if recipients else None

    msg_id = str(uuid.uuid4())
    msg = DealMessage(
        id=msg_id,
        deal_id=req.deal_id,
        thread_id=msg_id,
        sender_id=caller_uid,
        sender_name=sender_name,
        sender_role=sender_role,
        recipient_id=first_recipient_id,
        recipient_name=first_recipient_name,
        recipient_ids=json.dumps([u.id for u in recipients]),
        subject=req.subject.strip(),
        body=req.body.strip(),
        priority=req.priority or "normal",
        is_read=False,
        thread_status="open",
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)

    # 4. In-App Notifications & Emails for each recipient
    deal_title = opp.opportunity_name or opp.opportunity_id_18
    for r in recipients:
        NotificationService.create_notification(
            db=db,
            user_id=r.id,
            category="message",
            title=f"New message from {sender_name}",
            message=req.body.strip(),
            deal_id=req.deal_id,
            deal_name=deal_title,
            target_type="deal_message",
            target_id=msg_id,
            send_email=True,
            email_sender_name=sender_name,
            email_sender_role=sender_role,
            account_name=opp.account_name,
            acv_amount=float(opp.forecast_acv_amount or 0.0),
        )

    log_audit_event(
        db,
        "message_sent",
        user_id=ctx.user_id,
        user_email=ctx.email,
        details={"deal_id": req.deal_id, "recipients": [u.name for u in recipients], "subject": req.subject},
    )

    return {"status": "sent", "message_id": msg.id}


@router.post("/{message_id}/reply")
def reply_to_message(
    message_id: str,
    req: ReplyMessageRequest,
    ctx: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db),
):
    """
    Reply to a deal message thread.
    Notifies chosen recipients or thread participants.
    """
    parent = db.query(DealMessage).filter(DealMessage.id == message_id).first()
    if not parent:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parent message not found.")

    root_id = parent.thread_id or parent.id
    root_msg = db.query(DealMessage).filter(DealMessage.id == root_id).first()

    caller_uid = ctx.user_id if ctx.user_id != "admin" else db.query(User.id).filter(User.role == "admin").first()[0]
    caller_user = db.query(User).filter(User.id == caller_uid).first()
    sender_name = caller_user.name if caller_user else ctx.display_name
    sender_role = caller_user.role if caller_user else ctx.role

    # Check access for KAM
    if ctx.is_kam:
        opp = db.query(Opportunity).filter(Opportunity.opportunity_id_18 == parent.deal_id).first()
        if opp and (opp.opportunity_owner or "").strip() not in ctx.all_owner_names:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")

    # Determine recipients
    recipients: list[User] = []
    if req.recipient_ids:
        recipients = db.query(User).filter(User.id.in_(req.recipient_ids), User.status != "disabled").all()
    else:
        # Default: thread participants
        thread_msgs = db.query(DealMessage).filter(DealMessage.thread_id == root_id).all()
        uids = set()
        for tm in thread_msgs:
            if tm.sender_id: uids.add(tm.sender_id)
            if tm.recipient_id: uids.add(tm.recipient_id)
            if tm.recipient_ids:
                try:
                    for uid in json.loads(tm.recipient_ids):
                        uids.add(uid)
                except Exception:
                    pass
        recipients = db.query(User).filter(User.id.in_(list(uids)), User.status != "disabled").all()

    # Filter out caller
    recipients = [u for u in recipients if str(u.id) != str(caller_uid)]

    first_recipient_id = recipients[0].id if recipients else (parent.sender_id if str(parent.sender_id) != str(caller_uid) else parent.recipient_id)
    first_recipient_user = db.query(User).filter(User.id == first_recipient_id).first() if first_recipient_id else None
    first_recipient_name = first_recipient_user.name if first_recipient_user else None

    reply_id = str(uuid.uuid4())
    reply = DealMessage(
        id=reply_id,
        deal_id=parent.deal_id,
        thread_id=root_id,
        sender_id=caller_uid,
        sender_name=sender_name,
        sender_role=sender_role,
        recipient_id=first_recipient_id,
        recipient_name=first_recipient_name,
        recipient_ids=json.dumps([u.id for u in recipients]),
        subject=f"Re: {root_msg.subject if root_msg and root_msg.subject else parent.subject or ''}",
        body=req.body.strip(),
        priority=parent.priority,
        is_read=False,
        thread_status="open",
    )
    db.add(reply)
    if root_msg:
        root_msg.thread_status = "open"
    db.commit()
    db.refresh(reply)

    # In-app notifications & emails
    opp = db.query(Opportunity).filter(Opportunity.opportunity_id_18 == parent.deal_id).first()
    deal_title = opp.opportunity_name if opp else parent.deal_id
    for r in recipients:
        NotificationService.create_notification(
            db=db,
            user_id=r.id,
            category="reply",
            title=f"New reply from {sender_name}",
            message=req.body.strip(),
            deal_id=parent.deal_id,
            deal_name=deal_title,
            target_type="deal_message",
            target_id=root_id,
            send_email=True,
            email_sender_name=sender_name,
            email_sender_role=sender_role,
            account_name=opp.account_name if opp else None,
            acv_amount=float(opp.forecast_acv_amount or 0.0) if opp else None,
        )

    log_audit_event(
        db,
        "message_reply_sent",
        user_id=ctx.user_id,
        user_email=ctx.email,
        details={"deal_id": parent.deal_id, "reply_to": message_id, "recipients": [u.name for u in recipients]},
    )

    return {"status": "reply_sent", "message_id": reply.id}


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
    List message threads.
    - KAM: only their own threads.
    - Management: threads they started or sent to them.
    - Admin: all threads.
    Supports filtering by deal_id, thread_status, q (search text), owner, and sender.
    """
    query = db.query(DealMessage).filter(DealMessage.thread_id == DealMessage.id)

    if deal_id:
        query = query.filter(DealMessage.deal_id == deal_id)
    if thread_status:
        query = query.filter(DealMessage.thread_status == thread_status)

    owned_deal_ids = []
    if ctx.is_kam:
        owned_deal_ids = [
            r[0] for r in db.query(Opportunity.opportunity_id_18)
            .filter(Opportunity.opportunity_owner.in_(ctx.all_owner_names))
            .distinct()
            .all()
        ]
        kam_conds = [
            DealMessage.recipient_id == ctx.user_id,
            DealMessage.sender_id == ctx.user_id,
        ]
        if owned_deal_ids:
            kam_conds.append(DealMessage.deal_id.in_(owned_deal_ids))
        query = query.filter(or_(*kam_conds))
    elif ctx.is_management:
        # Management sees threads they started or where they are recipient
        query = query.filter(or_(DealMessage.sender_id == ctx.user_id, DealMessage.recipient_id == ctx.user_id))

    root_messages = query.order_by(DealMessage.created_at.desc()).all()

    threads = []
    clean_q = q.strip().lower() if q else None

    for rm in root_messages:
        # Count replies and unread
        replies = (
            db.query(DealMessage)
            .filter(DealMessage.thread_id == rm.id, DealMessage.id != rm.id)
            .order_by(DealMessage.created_at.asc())
            .all()
        )
        all_msgs = [rm] + replies
        if ctx.is_kam:
            unread_count = sum(
                1 for m in all_msgs
                if not m.is_read and (str(m.recipient_id) == ctx.user_id or (m.deal_id in owned_deal_ids and m.sender_role != "kam"))
            )
        else:
            unread_count = sum(1 for m in all_msgs if not m.is_read and str(m.recipient_id) == ctx.user_id)

        # Resolve opp title and owner
        opp = db.query(Opportunity).filter(Opportunity.opportunity_id_18 == rm.deal_id).first()

        sender_user = db.query(User).filter(User.id == rm.sender_id).first()
        recipient_user = db.query(User).filter(User.id == rm.recipient_id).first()

        opp_owner = opp.opportunity_owner if opp else (recipient_user.owner_name if recipient_user else "")
        sender_name = sender_user.name if sender_user else "Unknown"
        recipient_name = recipient_user.name if recipient_user else "Unknown"
        deal_name = opp.opportunity_name if opp else rm.deal_id
        account_name = opp.account_name if opp else ""
        latest_body = all_msgs[-1].body if all_msgs else rm.body
        last_dt = all_msgs[-1].created_at if all_msgs else rm.created_at

        # Apply filters
        if owner and opp_owner and owner.strip().lower() not in opp_owner.lower():
            continue
        if sender and sender.strip().lower() not in sender_name.lower():
            continue
        if clean_q:
            text_pool = f"{deal_name} {account_name} {rm.deal_id} {opp_owner} {rm.subject} {latest_body}".lower()
            if clean_q not in text_pool:
                continue

        threads.append({
            "thread_id": rm.id,
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
            "message_count": len(all_msgs),
            "unread_count": unread_count,
            "latest_message": latest_body,
            "latest_message_at": last_dt.isoformat() if last_dt else None,
            "last_activity": last_dt.isoformat() if last_dt else None,
            "created_at": rm.created_at.isoformat() if rm.created_at else None,
        })

    return {"threads": threads}


@router.get("/deal/{deal_id}")
def get_deal_thread(
    deal_id: str,
    ctx: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db),
):
    """Fetch complete message history for a specific deal."""
    opp = db.query(Opportunity).filter(Opportunity.opportunity_id_18 == deal_id).first()
    if ctx.is_kam:
        if opp and (opp.opportunity_owner or "").strip() not in ctx.all_owner_names:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access forbidden: You do not have access to this opportunity.",
            )

    msgs = (
        db.query(DealMessage)
        .filter(DealMessage.deal_id == deal_id)
        .order_by(DealMessage.created_at.asc())
        .all()
    )

    results = []
    for m in msgs:
        sender = db.query(User).filter(User.id == m.sender_id).first()
        recipient = db.query(User).filter(User.id == m.recipient_id).first()

        rec_ids = []
        if m.recipient_ids:
            try:
                rec_ids = json.loads(m.recipient_ids)
            except Exception:
                rec_ids = []
        if not rec_ids and m.recipient_id:
            rec_ids = [m.recipient_id]

        rec_users = db.query(User).filter(User.id.in_(rec_ids)).all() if rec_ids else []
        rec_names = [u.name for u in rec_users] if rec_users else ([recipient.name] if recipient else [])
        rec_str = ", ".join(rec_names) if rec_names else (m.recipient_name or "Recipient")

        time_str = m.created_at.strftime("%H:%M") if m.created_at else ""
        delivery_chip = f"Emailed to {rec_str} – sent {time_str}" if rec_str else f"Sent {time_str}"

        results.append({
            "id": m.id,
            "thread_id": m.thread_id,
            "parent_id": m.thread_id,
            "deal_id": m.deal_id,
            "subject": m.subject,
            "body": m.body,
            "priority": m.priority,
            "is_read": bool(m.is_read),
            "thread_status": m.thread_status,
            "sender_id": str(m.sender_id),
            "sender_name": sender.name if sender else "Unknown",
            "sender_role": sender.role if sender else "unknown",
            "recipient_id": str(m.recipient_id),
            "recipient_name": rec_str,
            "recipient_ids": rec_ids,
            "recipients": rec_names,
            "delivery_status": delivery_chip,
            "created_at": m.created_at.isoformat() if m.created_at else None,
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
    """Mark a message or entire thread as read."""
    msg = db.query(DealMessage).filter(DealMessage.id == message_id).first()
    if not msg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found.")

    msg.is_read = True

    # Also mark all messages in thread addressed to current user as read
    root_id = msg.thread_id or msg.id
    db.query(DealMessage).filter(
        DealMessage.thread_id == root_id,
        DealMessage.recipient_id == ctx.user_id,
    ).update({"is_read": True})

    db.commit()
    return {"status": "marked_read"}


@router.post("/{thread_id}/resolve")
def resolve_thread(
    thread_id: str,
    ctx: UserContext = Depends(require_management_or_admin),
    db: Session = Depends(get_db),
):
    """Toggle thread status between open and resolved."""
    root = db.query(DealMessage).filter(DealMessage.id == thread_id).first()
    if not root:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found.")

    new_status = "resolved" if root.thread_status == "open" else "open"
    root.thread_status = new_status

    # Update all child messages
    db.query(DealMessage).filter(DealMessage.thread_id == root.id).update({"thread_status": new_status})
    db.commit()

    log_audit_event(db, "thread_status_toggle", user_id=ctx.user_id, details={"thread_id": thread_id, "new_status": new_status})
    return {"status": "success", "thread_status": new_status}

