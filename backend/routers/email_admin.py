"""
Admin Email Configuration, Diagnostics, and Outbox Router.
Endpoints to view email outbox, diagnostics, send test emails, retry pending deliveries, and manage items.
Protected by require_admin_context.
"""
from __future__ import annotations

import logging
from typing import Optional, List, Dict, Any
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from backend.config import settings
from backend.database import get_db
from backend.models.user import EmailOutbox
from backend.services.context import UserContext, require_admin_context
from backend.services.mail_service import MailService
from backend.services.audit_service import log_audit_event
from backend.services.schema_check import EMAIL_LOG_REQUIRED_TABLES, check_schema_health, raise_db_endpoint_error
from backend.utils.time_utils import to_utc_iso

log = logging.getLogger(__name__)

router = APIRouter(tags=["admin-email"])


class TestEmailRequest(BaseModel):
    recipient_email: Optional[str] = None
    to_email: Optional[str] = None


@router.get("/diagnostics")
def get_email_diagnostics(
    ctx: UserContext = Depends(require_admin_context),
    db: Session = Depends(get_db),
):
    """Safe email transport and schema diagnostics (admin only). Secrets are never returned."""
    diag = MailService.get_diagnostics()
    schema_info = check_schema_health(db.get_bind(), check_alembic=True)
    diag["schema_status"] = schema_info
    diag["needs_migration"] = schema_info.get("needs_migration", False)
    diag["migration_message"] = schema_info.get("message", "ok")
    return diag


@router.get("/outbox")
def list_email_outbox(
    status_filter: Optional[str] = None,
    limit: int = 50,
    ctx: UserContext = Depends(require_admin_context),
    db: Session = Depends(get_db),
):
    """List recent outbox emails with delivery status, timestamp, and transport diagnostics."""
    try:
        q = db.query(EmailOutbox)
        if status_filter:
            q = q.filter(EmailOutbox.status == status_filter)
        emails = q.order_by(EmailOutbox.created_at.desc()).limit(limit).all()
    except SQLAlchemyError as db_exc:
        raise_db_endpoint_error(
            db,
            db_exc,
            endpoint="GET /api/admin/email/outbox",
            params={"status_filter": status_filter, "limit": limit},
            required_tables=EMAIL_LOG_REQUIRED_TABLES,
            generic_detail="Could not load email outbox due to a database error. Please try again.",
        )

    diag = MailService.get_diagnostics()

    outbox_items = [
        {
            "id": m.id,
            "recipient_name": m.recipient_name or "User",
            "recipient_role": m.recipient_role or "user",
            "sender_name": m.sender_name or "System",
            "sender_role": m.sender_role or "system",
            "deal_id": m.deal_id,
            "deal_name": m.deal_name,
            "subject": m.subject,
            "template": m.template_type,
            "template_type": m.template_type,
            "status": m.status,
            "attempts": m.retry_count,
            "retry_count": m.retry_count,
            "error_message": m.error_message,
            "created_at": to_utc_iso(m.created_at),
            "sent_at": to_utc_iso(m.sent_at),
        }
        for m in emails
    ]

    return {
        "config": diag,
        "diagnostics": diag,
        "smtp_configured": diag["is_configured"],
        "inactive_reason": diag["inactive_reason"],
        "total_count": len(outbox_items),
        "outbox": outbox_items,
        "emails": outbox_items,
    }


@router.post("/test")
def send_test_email(
    req: TestEmailRequest,
    ctx: UserContext = Depends(require_admin_context),
    db: Session = Depends(get_db),
):
    """Send a test email to verify SMTP configuration and report real errors safely."""
    target_email = (req.recipient_email or req.to_email or "").strip()
    if not target_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Recipient email address is required.",
        )

    success, msg = MailService.send_test_email(target_email)
    log_audit_event(
        db,
        "test_email_sent",
        user_id=ctx.user_id,
        user_email=ctx.email,
        details={"recipient": target_email, "success": success, "result": msg},
    )
    return {
        "status": "success" if success else "failed",
        "delivered": success,
        "detail": msg,
    }


@router.post("/resend-pending")
def resend_pending_emails(
    ctx: UserContext = Depends(require_admin_context),
    db: Session = Depends(get_db),
):
    """Retry sending all pending outbox items."""
    res = MailService.resend_pending_emails(db)
    log_audit_event(db, "resend_pending_emails", user_id=ctx.user_id, details=res)
    return {
        "status": "success",
        "dispatched": res.get("dispatched", 0),
        "sent_count": res.get("sent_count", 0),
        "retried_count": res.get("retried_count", 0),
        "failed_count": res.get("failed_count", 0),
    }


@router.post("/outbox/{item_id}/cancel")
def cancel_outbox_email(
    item_id: str,
    ctx: UserContext = Depends(require_admin_context),
    db: Session = Depends(get_db),
):
    """Cancel a pending outbox item so it won't be sent."""
    item = db.query(EmailOutbox).filter(EmailOutbox.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Outbox item not found")
    item.status = "cancelled"
    db.commit()
    log_audit_event(
        db,
        "outbox_email_cancelled",
        user_id=ctx.user_id,
        user_email=ctx.email,
        details={"item_id": item_id, "recipient": item.recipient_email},
    )
    return {"status": "success", "id": item_id, "item_status": "cancelled"}


@router.delete("/outbox/{item_id}")
def delete_outbox_email(
    item_id: str,
    ctx: UserContext = Depends(require_admin_context),
    db: Session = Depends(get_db),
):
    """Delete an outbox item."""
    item = db.query(EmailOutbox).filter(EmailOutbox.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Outbox item not found")
    recipient = item.recipient_email
    db.delete(item)
    db.commit()
    log_audit_event(
        db,
        "outbox_email_deleted",
        user_id=ctx.user_id,
        user_email=ctx.email,
        details={"item_id": item_id, "recipient": recipient},
    )
    return {"status": "success", "deleted_id": item_id}


@router.post("/outbox/{item_id}/send-now")
def send_outbox_email_now(
    item_id: str,
    ctx: UserContext = Depends(require_admin_context),
    db: Session = Depends(get_db),
):
    """Attempt immediate delivery of a single outbox item."""
    item = db.query(EmailOutbox).filter(EmailOutbox.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Outbox item not found")
    success = MailService.dispatch_outbox_item(db, item_id)
    db.refresh(item)
    log_audit_event(
        db,
        "outbox_email_send_now",
        user_id=ctx.user_id,
        user_email=ctx.email,
        details={"item_id": item_id, "recipient": item.recipient_email, "success": success},
    )
    return {
        "status": "success" if success else "failed",
        "delivered": success,
        "detail": "Email delivered" if success else (item.error_message or "Delivery failed"),
        "item_status": item.status,
    }


@router.post("/outbox/{item_id}/retry")
def retry_outbox_email(
    item_id: str,
    ctx: UserContext = Depends(require_admin_context),
    db: Session = Depends(get_db),
):
    """
    Retry sending a single failed outbox item after admin confirmation.
    Returns delivery status and recipient information.
    """
    item = db.query(EmailOutbox).filter(EmailOutbox.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Outbox item not found")

    recipient_info = {
        "id": item.id,
        "recipient_email": item.recipient_email,
        "recipient_name": item.recipient_name,
        "subject": item.subject,
    }

    success, err, updated_item = MailService.retry_outbox_item(db, item_id)
    log_audit_event(
        db,
        "outbox_email_retried",
        user_id=ctx.user_id,
        user_email=ctx.email,
        details={"item_id": item_id, "recipient": item.recipient_email, "success": success},
    )
    return {
        "status": "success" if success else "failed",
        "delivered": success,
        "recipient": recipient_info,
        "detail": "Email retried and delivered successfully" if success else (err or "Retry delivery failed"),
        "item_status": updated_item.status if updated_item else "failed",
    }


@router.post("/retry-failed")
@router.post("/outbox/retry-failed")
def retry_failed_outbox_emails(
    ctx: UserContext = Depends(require_admin_context),
    db: Session = Depends(get_db),
):
    """
    Bulk retry sending all failed outbox items after admin confirmation.
    Returns list of recipients retried along with counts.
    """
    res = MailService.retry_failed_emails(db)
    log_audit_event(
        db,
        "outbox_emails_bulk_retried",
        user_id=ctx.user_id,
        user_email=ctx.email,
        details={
            "retried_count": res.get("retried_count", 0),
            "sent_count": res.get("sent_count", 0),
            "failed_count": res.get("failed_count", 0),
        },
    )
    return res



