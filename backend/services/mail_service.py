"""
Email Service (Round 18).
Handles email outbox persistence, templates, and asynchronous SMTP delivery.
Supports Office365, Gmail, and standard SMTP (STARTTLS / SSL).
When MAIL_ENABLED is false or SMTP is unset, queues items to email_outbox with status 'pending – email not configured'.
Never logs passwords or invite tokens.
"""
from __future__ import annotations

import logging
import smtplib
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional, List, Dict, Any
from sqlalchemy.orm import Session

from backend.config import settings
from backend.models.user import EmailOutbox

log = logging.getLogger(__name__)


class MailService:
    @staticmethod
    def is_configured() -> bool:
        """Returns True if MAIL_ENABLED is True and required SMTP fields are populated."""
        return bool(
            settings.MAIL_ENABLED
            and settings.SMTP_HOST
            and settings.SMTP_PORT
            and settings.MAIL_FROM
        )

    @classmethod
    def queue_email(
        cls,
        db: Session,
        recipient_email: str,
        subject: str,
        body_html: str,
        body_text: Optional[str] = None,
        recipient_name: Optional[str] = None,
        template_type: str = "general",
    ) -> EmailOutbox:
        """
        Record email into the email_outbox table.
        If mail delivery is configured and enabled, attempts immediate/async delivery.
        Otherwise sets status to 'pending – email not configured'.
        """
        if not body_text:
            # Simple text fallback from HTML
            import re
            body_text = re.sub(r"<[^>]+>", "", body_html).strip()

        init_status = "pending" if cls.is_configured() else "pending – email not configured"

        outbox_entry = EmailOutbox(
            recipient_email=recipient_email.strip(),
            recipient_name=recipient_name.strip() if recipient_name else None,
            subject=subject.strip(),
            body_html=body_html.strip(),
            body_text=body_text.strip(),
            template_type=template_type,
            status=init_status,
            created_at=datetime.now(timezone.utc),
        )
        db.add(outbox_entry)
        db.commit()
        db.refresh(outbox_entry)

        if cls.is_configured():
            cls.dispatch_outbox_item(db, outbox_entry.id)

        return outbox_entry

    @classmethod
    def dispatch_outbox_item(cls, db: Session, outbox_id: str) -> bool:
        """Synchronously deliver a single queued email from outbox by ID with error tracking."""
        item = db.query(EmailOutbox).filter(EmailOutbox.id == outbox_id).first()
        if not item:
            return False

        if not cls.is_configured():
            item.status = "pending – email not configured"
            db.commit()
            return False

        success, err_msg = cls._send_smtp(
            to_addr=item.recipient_email,
            subject=item.subject,
            body_html=item.body_html,
            body_text=item.body_text or "",
            recipient_name=item.recipient_name,
        )

        if success:
            item.status = "sent"
            item.error_message = None
            item.sent_at = datetime.now(timezone.utc)
        else:
            item.status = "failed"
            item.error_message = err_msg
            item.retry_count = (item.retry_count or 0) + 1

        db.commit()
        return success

    @classmethod
    def send_test_email(cls, to_email: str) -> tuple[bool, str]:
        """Send a test email to verify SMTP configuration."""
        if not cls.is_configured():
            return False, "SMTP is not configured or MAIL_ENABLED is false in settings."

        subject = "Mobileum Horizon — SMTP Test Email"
        body_html = f"""
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #12284C;">SMTP Configuration Verified</h2>
          <p>This is a test notification confirming that the outgoing SMTP mail delivery service for Mobileum Horizon is operational.</p>
          <p style="color: #64748B; font-size: 13px;">Timestamp: {datetime.now(timezone.utc).isoformat()}</p>
        </div>
        """
        body_text = f"Mobileum Horizon SMTP Test Email. Verification successful at {datetime.now(timezone.utc).isoformat()}."

        return cls._send_smtp(
            to_addr=to_email,
            subject=subject,
            body_html=body_html,
            body_text=body_text,
        )

    @classmethod
    def resend_pending_emails(cls, db: Session, limit: int = 50) -> int:
        """Attempt sending items in pending or failed status once SMTP is configured."""
        if not cls.is_configured():
            return 0

        pending_items = (
            db.query(EmailOutbox)
            .filter(EmailOutbox.status.in_(["pending", "pending – email not configured", "failed"]))
            .order_by(EmailOutbox.created_at.asc())
            .limit(limit)
            .all()
        )

        sent_count = 0
        for item in pending_items:
            success = cls.dispatch_outbox_item(db, item.id)
            if success:
                sent_count += 1
        return sent_count

    @classmethod
    def _send_smtp(
        cls,
        to_addr: str,
        subject: str,
        body_html: str,
        body_text: str,
        recipient_name: Optional[str] = None,
    ) -> tuple[bool, Optional[str]]:
        """Low-level SMTP connection and delivery with STARTTLS or SSL."""
        try:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            from_name = "Mobileum Horizon"
            msg["From"] = f"{from_name} <{settings.MAIL_FROM}>"
            msg["To"] = f"{recipient_name} <{to_addr}>" if recipient_name else to_addr

            msg.attach(MIMEText(body_text, "plain", "utf-8"))
            msg.attach(MIMEText(body_html, "html", "utf-8"))

            host = settings.SMTP_HOST
            port = settings.SMTP_PORT

            if settings.SMTP_SSL:
                server = smtplib.SMTP_SSL(host, port, timeout=15)
            else:
                server = smtplib.SMTP(host, port, timeout=15)

            with server:
                if not settings.SMTP_SSL and settings.SMTP_STARTTLS:
                    server.starttls()

                if settings.SMTP_USER and settings.SMTP_PASSWORD:
                    server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)

                server.sendmail(settings.MAIL_FROM, [to_addr], msg.as_string())

            log.info("Email delivered successfully to %s", to_addr)
            return True, None
        except Exception as exc:
            err_msg = str(exc)
            log.warning("Failed to send email to %s: %s", to_addr, err_msg)
            return False, err_msg


# =====================================================================
# Professional Email Templates
# =====================================================================

def template_invite(user_name: str, invite_link: str) -> tuple[str, str, str]:
    """Returns (subject, body_html, body_text) for KAM / Management invitation."""
    subject = "Welcome to Mobileum Horizon — Set Your Password"
    body_html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1E293B; line-height: 1.6;">
      <div style="margin-bottom: 24px;">
        <h2 style="color: #12284C; margin: 0 0 8px 0; font-size: 22px;">Welcome to Mobileum Horizon</h2>
        <p style="color: #64748B; margin: 0; font-size: 14px;">Renewals Intelligence Portal</p>
      </div>
      <p>Hello {user_name},</p>
      <p>An account has been created for you on the Mobileum Horizon Renewals portal. To activate your account and view your opportunities, please click the button below to set your password:</p>
      <div style="margin: 28px 0;">
        <a href="{invite_link}" style="background-color: #00A3AD; color: #FFFFFF; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">Set Your Password</a>
      </div>
      <p style="font-size: 13px; color: #64748B;">This link is single-use and will expire in {settings.INVITE_TOKEN_EXPIRE_HOURS} hours. If you cannot click the button, copy and paste this link into your browser:</p>
      <p style="font-size: 12px; color: #00A3AD; word-break: break-all;">{invite_link}</p>
      <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 32px 0 16px 0;" />
      <p style="font-size: 12px; color: #94A3B8;">Mobileum Renewals Intelligence · Confidential &amp; Proprietary</p>
    </div>
    """
    body_text = f"Hello {user_name},\n\nPlease set your password for Mobileum Horizon by visiting:\n{invite_link}\n\nThis link will expire in {settings.INVITE_TOKEN_EXPIRE_HOURS} hours."
    return subject, body_html, body_text


def template_password_reset(user_name: str, reset_link: str) -> tuple[str, str, str]:
    """Returns (subject, body_html, body_text) for password reset."""
    subject = "Mobileum Horizon — Password Reset Request"
    body_html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1E293B; line-height: 1.6;">
      <div style="margin-bottom: 24px;">
        <h2 style="color: #12284C; margin: 0 0 8px 0; font-size: 22px;">Password Reset Request</h2>
        <p style="color: #64748B; margin: 0; font-size: 14px;">Mobileum Horizon Renewals</p>
      </div>
      <p>Hello {user_name},</p>
      <p>We received a request to reset your password. Click the button below to choose a new password:</p>
      <div style="margin: 28px 0;">
        <a href="{reset_link}" style="background-color: #12284C; color: #FFFFFF; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">Reset Password</a>
      </div>
      <p style="font-size: 13px; color: #64748B;">This link is single-use and will expire in {settings.RESET_TOKEN_EXPIRE_HOURS} hours. If you did not request this reset, you can safely ignore this email.</p>
      <p style="font-size: 12px; color: #00A3AD; word-break: break-all;">{reset_link}</p>
      <hr style="border: none; border-top: 1px solid #E2E8F0; margin: 32px 0 16px 0;" />
      <p style="font-size: 12px; color: #94A3B8;">Mobileum Renewals Intelligence</p>
    </div>
    """
    body_text = f"Hello {user_name},\n\nTo reset your Mobileum Horizon password, visit:\n{reset_link}\n\nThis link expires in {settings.RESET_TOKEN_EXPIRE_HOURS} hours."
    return subject, body_html, body_text


def template_new_message(
    recipient_name: str,
    sender_name: str,
    deal_name: str,
    deal_id: str,
    subject_text: str,
    body: str,
    thread_link: str,
) -> tuple[str, str, str]:
    """Returns (subject, body_html, body_text) for a new deal message."""
    subject = f"[{deal_name}] New Message from {sender_name}: {subject_text}"
    body_html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1E293B; line-height: 1.6;">
      <h3 style="color: #12284C; margin: 0 0 12px 0;">New Message regarding {deal_name}</h3>
      <div style="background-color: #F8FAFC; border-left: 4px solid #00A3AD; padding: 16px; margin: 16px 0; border-radius: 4px;">
        <p style="margin: 0 0 8px 0; font-size: 13px; color: #64748B;"><strong>From:</strong> {sender_name} | <strong>Deal ID:</strong> {deal_id}</p>
        <p style="margin: 0; font-size: 15px; color: #0F172A; white-space: pre-wrap;">{body}</p>
      </div>
      <div style="margin: 24px 0;">
        <a href="{thread_link}" style="background-color: #00A3AD; color: #FFFFFF; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block;">View and Reply in Portal</a>
      </div>
      <p style="font-size: 12px; color: #94A3B8;">Direct link: {thread_link}</p>
    </div>
    """
    body_text = f"New message from {sender_name} regarding {deal_name} (ID: {deal_id}):\n\n{body}\n\nView and reply in portal: {thread_link}"
    return subject, body_html, body_text


def template_reply_message(
    recipient_name: str,
    sender_name: str,
    deal_name: str,
    deal_id: str,
    body: str,
    thread_link: str,
) -> tuple[str, str, str]:
    """Returns (subject, body_html, body_text) for a reply in a deal message thread."""
    subject = f"Re: [{deal_name}] Update from {sender_name}"
    body_html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1E293B; line-height: 1.6;">
      <h3 style="color: #12284C; margin: 0 0 12px 0;">New Reply on {deal_name}</h3>
      <div style="background-color: #F8FAFC; border-left: 4px solid #3B82F6; padding: 16px; margin: 16px 0; border-radius: 4px;">
        <p style="margin: 0 0 8px 0; font-size: 13px; color: #64748B;"><strong>From:</strong> {sender_name} | <strong>Deal ID:</strong> {deal_id}</p>
        <p style="margin: 0; font-size: 15px; color: #0F172A; white-space: pre-wrap;">{body}</p>
      </div>
      <div style="margin: 24px 0;">
        <a href="{thread_link}" style="background-color: #12284C; color: #FFFFFF; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block;">Open Thread</a>
      </div>
      <p style="font-size: 12px; color: #94A3B8;">Direct link: {thread_link}</p>
    </div>
    """
    body_text = f"New reply from {sender_name} regarding {deal_name} (ID: {deal_id}):\n\n{body}\n\nOpen thread: {thread_link}"
    return subject, body_html, body_text


def template_new_owner_alert(owner_name: str, deal_count: int, admin_link: str) -> tuple[str, str, str]:
    """Returns (subject, body_html, body_text) when a workbook upload finds an opportunity owner without an email."""
    subject = f"Action Required: New Opportunity Owner Found ({owner_name})"
    body_html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1E293B; line-height: 1.6;">
      <h3 style="color: #B45309; margin: 0 0 12px 0;">New Opportunity Owner Detected</h3>
      <p>A recent workbook upload contains renewals for an opportunity owner not currently matched in the KAM directory:</p>
      <div style="background-color: #FEF3C7; border: 1px solid #FCD34D; padding: 16px; border-radius: 6px; margin: 16px 0;">
        <p style="margin: 0; font-weight: bold; color: #92400E;">Owner Name: {owner_name}</p>
        <p style="margin: 4px 0 0 0; color: #78350F;">Associated Deals: {deal_count}</p>
      </div>
      <p>This owner's deals will remain visible only to administrators until an email address is added to activate their KAM account or linked as an alias.</p>
      <div style="margin: 24px 0;">
        <a href="{admin_link}" style="background-color: #B45309; color: #FFFFFF; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block;">Manage Users in Admin Portal</a>
      </div>
    </div>
    """
    body_text = f"Action Required: New Opportunity Owner Found: {owner_name} with {deal_count} deals. Please add an email in the admin portal: {admin_link}"
    return subject, body_html, body_text


def template_owner_missing_alert(owner_name: str, admin_link: str) -> tuple[str, str, str]:
    """Returns (subject, body_html, body_text) when a known KAM has no deals in latest upload."""
    subject = f"Notice: Opportunity Owner Has No Open Deals ({owner_name})"
    body_html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1E293B; line-height: 1.6;">
      <h3 style="color: #475569; margin: 0 0 12px 0;">Opportunity Owner Update</h3>
      <p>Owner <strong>{owner_name}</strong> was not found with open renewals in the latest daily upload.</p>
      <p style="color: #64748B;">Their KAM portal account remains active and will not be deleted automatically.</p>
      <div style="margin: 20px 0;">
        <a href="{admin_link}" style="color: #00A3AD; text-decoration: underline;">Review KAM list in Admin Portal</a>
      </div>
    </div>
    """
    body_text = f"Notice: Owner {owner_name} has no open deals in the latest upload. Account is retained. Review: {admin_link}"
    return subject, body_html, body_text

