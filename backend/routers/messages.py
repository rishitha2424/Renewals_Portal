"""
Messaging Router (Round 18).
Management / Admin <-> KAM threaded conversations linked to specific deals.
Handles message posting, replies, read receipts, and thread resolution.
"""
from __future__ import annotations

import logging
from typing import Optional, List
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func, or_

from backend.database import get_db
from backend.models.user import User, DealMessage
from backend.models.opportunity import Opportunity
from backend.services.context import (
    UserContext,
    require_authenticated,
    require_management_or_admin,
)
from backend.services.audit_service import log_audit_event
from backend.services.mail_service import MailService

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/messages", tags=["messages"])


class SendDealMessageRequest(BaseModel):
    deal_id: str
    subject: str
    body: str
    priority: Optional[str] = "normal"  # "low" | "normal" | "high" | "urgent"


class ReplyMessageRequest(BaseModel):
    body: str


@router.post("")
def send_deal_message(
    req: SendDealMessageRequest,
    ctx: UserContext = Depends(require_management_or_admin),
    db: Session = Depends(get_db),
):
    """
    Admin or Management sends a message to a deal owner about a specific deal.
    Creates root message thread and queues email notification to the KAM.
    """
    # 1. Resolve Opportunity
    opp = db.query(Opportunity).filter(Opportunity.opportunity_id_18 == req.deal_id).first()
    if not opp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Opportunity not found.")

    owner_name = (opp.opportunity_owner or "").strip()
    if not owner_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Opportunity has no owner assigned.")

    # 2. Find recipient KAM user
    kam_user = (
        db.query(User)
        .filter(func.lower(User.owner_name) == owner_name.lower())
        .first()
    )
    if not kam_user:
        # Search via aliases
        from backend.models.user import UserAlias
        alias = db.query(UserAlias).filter(func.lower(UserAlias.alias_name) == owner_name.lower()).first()
        if alias:
            kam_user = alias.user

    if not kam_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No user account linked to opportunity owner '{owner_name}'. Please add this KAM in User Management first.",
        )

    # 3. Create DealMessage
    import uuid
    caller_uid = ctx.user_id if ctx.user_id != "admin" else db.query(User.id).filter(User.role == "admin").first()[0]
    sender_user = db.query(User).filter(User.id == caller_uid).first()
    sender_name = sender_user.name if sender_user else ctx.display_name
    sender_role = sender_user.role if sender_user else ctx.role
    recipient_name = kam_user.name or kam_user.email

    msg_id = str(uuid.uuid4())
    msg = DealMessage(
        id=msg_id,
        deal_id=req.deal_id,
        thread_id=msg_id,
        sender_id=caller_uid,
        sender_name=sender_name,
        sender_role=sender_role,
        recipient_id=kam_user.id,
        recipient_name=recipient_name,
        subject=req.subject.strip(),
        body=req.body.strip(),
        priority=req.priority or "normal",
        is_read=False,
        thread_status="open",
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)

    # 4. Queue email notification
    deal_title = opp.opportunity_name or opp.opportunity_id_18
    MailService.template_new_message(db, kam_user, sender_name, deal_title, req.deal_id, req.body)

    log_audit_event(
        db,
        "message_sent",
        user_id=ctx.user_id,
        user_email=ctx.email,
        details={"deal_id": req.deal_id, "recipient_email": kam_user.email, "subject": req.subject},
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
    KAM replies back to sender (management/admin); management/admin can reply again.
    """
    parent = db.query(DealMessage).filter(DealMessage.id == message_id).first()
    if not parent:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parent message not found.")

    # Find root of thread
    root_id = parent.thread_id or parent.id
    root_msg = db.query(DealMessage).filter(DealMessage.id == root_id).first()

    # Determine recipient
    caller_uid = ctx.user_id if ctx.user_id != "admin" else db.query(User.id).filter(User.role == "admin").first()[0]
    if str(caller_uid) == str(parent.sender_id):
        recipient_id = parent.recipient_id
    else:
        recipient_id = parent.sender_id

    recipient_user = db.query(User).filter(User.id == recipient_id).first()
    if not recipient_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recipient user not found.")

    # Check access for KAM
    if ctx.is_kam:
        opp = db.query(Opportunity).filter(Opportunity.opportunity_id_18 == parent.deal_id).first()
        if opp and (opp.opportunity_owner or "").strip() not in ctx.all_owner_names:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")

    import uuid
    reply_id = str(uuid.uuid4())
    caller_user = db.query(User).filter(User.id == caller_uid).first()
    sender_name = caller_user.name if caller_user else ctx.display_name
    sender_role = caller_user.role if caller_user else ctx.role
    recipient_name = recipient_user.name if recipient_user else recipient_user.email

    reply = DealMessage(
        id=reply_id,
        deal_id=parent.deal_id,
        thread_id=root_id,
        sender_id=caller_uid,
        sender_name=sender_name,
        sender_role=sender_role,
        recipient_id=recipient_id,
        recipient_name=recipient_name,
        subject=f"Re: {root_msg.subject if root_msg and root_msg.subject else parent.subject or ''}",
        body=req.body.strip(),
        priority=parent.priority,
        is_read=False,
        thread_status="open",
    )
    db.add(reply)
    # Reopen thread if previously resolved
    if root_msg:
        root_msg.thread_status = "open"
    db.commit()
    db.refresh(reply)

    # Queue email notification
    opp = db.query(Opportunity).filter(Opportunity.opportunity_id_18 == parent.deal_id).first()
    deal_title = opp.opportunity_name if opp else parent.deal_id
    MailService.template_reply_message(db, recipient_user, sender_name, deal_title, parent.deal_id, req.body)

    log_audit_event(
        db,
        "message_reply_sent",
        user_id=ctx.user_id,
        user_email=ctx.email,
        details={"deal_id": parent.deal_id, "reply_to": message_id},
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
    query = db.query(DealMessage).filter(DealMessage.parent_id == None)

    if deal_id:
        query = query.filter(DealMessage.deal_id == deal_id)
    if thread_status:
        query = query.filter(DealMessage.thread_status == thread_status)

    if ctx.is_kam:
        # Must involve the KAM
        query = query.filter(or_(DealMessage.recipient_id == ctx.user_id, DealMessage.sender_id == ctx.user_id))
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
            .filter(DealMessage.parent_id == rm.id)
            .order_by(DealMessage.created_at.asc())
            .all()
        )
        all_msgs = [rm] + replies
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
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Opportunity not found.")

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
        results.append({
            "id": m.id,
            "parent_id": m.parent_id,
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
            "recipient_name": recipient.name if recipient else "Unknown",
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
    msg.read_at = func.now()

    # Also mark all messages in thread addressed to current user as read
    root_id = msg.parent_id or msg.id
    db.query(DealMessage).filter(
        or_(DealMessage.id == root_id, DealMessage.parent_id == root_id),
        DealMessage.recipient_id == ctx.user_id,
    ).update({"is_read": True, "read_at": func.now()})

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
    db.query(DealMessage).filter(DealMessage.parent_id == root.id).update({"thread_status": new_status})
    db.commit()

    log_audit_event(db, "thread_status_toggle", user_id=ctx.user_id, details={"thread_id": thread_id, "new_status": new_status})
    return {"status": "success", "thread_status": new_status}

