"""
Admin Email Configuration and Outbox Router (Round 18).
Endpoints to view email outbox, send test emails, and retry pending deliveries.
Protected by require_admin_context.
"""
from __future__ import annotations

import logging
from typing import Optional
from pydantic import BaseModel, EmailStr
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.config import settings
from backend.database import get_db
from backend.models.user import EmailOutbox
from backend.services.context import UserContext, require_admin_context
from backend.services.mail_service import MailService
from backend.services.audit_service import log_audit_event

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/email", tags=["admin-email"])


class TestEmailRequest(BaseModel):
    recipient_email: str


@router.get("/outbox")
def list_email_outbox(
    status_filter: Optional[str] = None,
    limit: int = 50,
    ctx: UserContext = Depends(require_admin_context),
    db: Session = Depends(get_db),
):
    """List recent outbox emails with delivery status and timestamp."""
    q = db.query(EmailOutbox)
    if status_filter:
        q = q.filter(EmailOutbox.status == status_filter)
    emails = q.order_by(EmailOutbox.created_at.desc()).limit(limit).all()

    mail_status = {
        "mail_enabled": bool(settings.MAIL_ENABLED),
        "smtp_host": settings.SMTP_HOST or "(not set)",
        "smtp_port": settings.SMTP_PORT,
        "mail_from": settings.MAIL_FROM,
        "is_configured": bool(settings.MAIL_ENABLED and settings.SMTP_HOST),
    }

    return {
        "config": mail_status,
        "outbox": [
            {
                "id": m.id,
                "recipient_email": m.recipient_email,
                "subject": m.subject,
                "status": m.status,
                "attempts": m.attempts,
                "error_message": m.error_message,
                "created_at": m.created_at.isoformat() if m.created_at else None,
                "sent_at": m.sent_at.isoformat() if m.sent_at else None,
            }
            for m in emails
        ],
    }


@router.post("/test")
def send_test_email(
    req: TestEmailRequest,
    ctx: UserContext = Depends(require_admin_context),
    db: Session = Depends(get_db),
):
    """Send a test email to verify SMTP configuration."""
    success, msg = MailService.send_test_email(req.recipient_email.strip())
    log_audit_event(
        db,
        "test_email_sent",
        user_id=ctx.user_id,
        user_email=ctx.email,
        details={"recipient": req.recipient_email, "success": success, "result": msg},
    )
    if not success:
        return {"status": "failed", "detail": msg}
    return {"status": "success", "detail": msg}


@router.post("/resend-pending")
def resend_pending_emails(
    ctx: UserContext = Depends(require_admin_context),
    db: Session = Depends(get_db),
):
    """Retry sending all pending outbox items."""
    dispatched = MailService.resend_pending_emails(db)
    log_audit_event(db, "resend_pending_emails", user_id=ctx.user_id, details={"dispatched": dispatched})
    return {"status": "success", "dispatched": dispatched}

