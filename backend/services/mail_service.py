"""
Email Service (Round 18).
Handles email outbox persistence, templates, and asynchronous SMTP delivery.
Supports Office365, Gmail, and standard SMTP (STARTTLS / SSL).
When MAIL_ENABLED is false or SMTP is unset, queues items to email_outbox with status 'pending – email not configured'.
Never logs passwords or invite tokens.
"""
from __future__ import annotations

import concurrent.futures
import logging
import smtplib
import socket
import ssl
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional, List, Dict, Any, Tuple
from sqlalchemy.orm import Session

from backend.config import settings, get_env_file_path
from backend.models.user import EmailOutbox

log = logging.getLogger(__name__)

_email_executor = concurrent.futures.ThreadPoolExecutor(max_workers=2, thread_name_prefix="mail-worker")


def _sanitize_error(err_str: str) -> str:
    """Mask any passwords, auth tokens, or sensitive credentials in error strings."""
    if not err_str:
        return ""
    res = str(err_str)
    if settings.SMTP_PASSWORD and settings.SMTP_PASSWORD in res:
        res = res.replace(settings.SMTP_PASSWORD, "***")
    if settings.ADMIN_PASSWORD and settings.ADMIN_PASSWORD in res:
        res = res.replace(settings.ADMIN_PASSWORD, "***")
    if settings.ADMIN_SECRET_KEY and settings.ADMIN_SECRET_KEY in res:
        res = res.replace(settings.ADMIN_SECRET_KEY, "***")
    return res


class MailService:
    @classmethod
    def is_configured(cls) -> bool:
        """Returns True if MAIL_ENABLED is True and all required SMTP fields are populated."""
        if not bool(settings.MAIL_ENABLED):
            return False
        if not (settings.SMTP_HOST and str(settings.SMTP_HOST).strip()):
            return False
        if not settings.SMTP_PORT:
            return False
        if not (settings.MAIL_FROM and str(settings.MAIL_FROM).strip()):
            return False
        if settings.SMTP_USER and not (settings.SMTP_PASSWORD and str(settings.SMTP_PASSWORD).strip()):
            return False
        return True

    @classmethod
    def get_inactive_reason(cls) -> str:
        """Returns the specific human-readable reason why mail is inactive or active."""
        env_path = get_env_file_path()
        if not env_path.exists():
            return f".env file not found at {env_path}"
        if not bool(settings.MAIL_ENABLED):
            return "MAIL_ENABLED is false"
        if not (settings.SMTP_HOST and str(settings.SMTP_HOST).strip()):
            return "SMTP_HOST missing"
        if not settings.SMTP_PORT:
            return "SMTP_PORT missing or invalid"
        if not (settings.MAIL_FROM and str(settings.MAIL_FROM).strip()):
            return "MAIL_FROM missing"
        if settings.SMTP_USER and not (settings.SMTP_PASSWORD and str(settings.SMTP_PASSWORD).strip()):
            return "SMTP_PASSWORD missing"
        return "Mail is active and configured"

    @classmethod
    def get_diagnostics(cls) -> dict:
        """Return safe mail diagnostics with secrets masked."""
        settings.reload_from_env()
        diag = settings.get_mail_diagnostics()
        diag["is_configured"] = cls.is_configured()
        diag["inactive_reason"] = cls.get_inactive_reason()
        diag["timeout_seconds"] = getattr(settings, "SMTP_TIMEOUT_SECONDS", 5)
        try:
            from backend.database import SessionLocal
            db = SessionLocal()
            try:
                last_failed = db.query(EmailOutbox).filter(EmailOutbox.status == "failed").order_by(EmailOutbox.id.desc()).first()
                diag["last_delivery_error"] = last_failed.error_message if last_failed else None
            finally:
                db.close()
        except Exception:
            diag["last_delivery_error"] = None
        return diag

    @classmethod
    def _async_dispatch(cls, outbox_id: str) -> None:
        """Run dispatch in background worker with its own DB session so HTTP requests return instantly."""
        try:
            from backend.database import SessionLocal
            db = SessionLocal()
            try:
                cls.dispatch_outbox_item(db, outbox_id)
            finally:
                db.close()
        except Exception as e:
            log.warning("Background email dispatch exception for %s: %s", outbox_id, e)

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
        deal_id: Optional[str] = None,
        deal_name: Optional[str] = None,
        sender_name: Optional[str] = None,
        sender_role: Optional[str] = None,
        recipient_role: Optional[str] = None,
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
            deal_id=deal_id,
            deal_name=deal_name,
            sender_name=sender_name,
            sender_role=sender_role,
            recipient_role=recipient_role,
            status=init_status,
            created_at=datetime.now(timezone.utc),
        )
        db.add(outbox_entry)
        db.commit()
        db.refresh(outbox_entry)

        if cls.is_configured():
            _email_executor.submit(cls._async_dispatch, outbox_entry.id)

        return outbox_entry

    @classmethod
    def dispatch_outbox_item(cls, db: Session, outbox_id: str) -> bool:
        """Synchronously deliver a single queued email from outbox by ID with error tracking."""
        item = db.query(EmailOutbox).filter(EmailOutbox.id == outbox_id).first()
        if not item or item.status == "cancelled":
            return False

        if not cls.is_configured():
            item.status = "pending – email not configured"
            item.error_message = cls.get_inactive_reason()
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
            item.error_message = _sanitize_error(err_msg or "Delivery failed")
            item.retry_count = (item.retry_count or 0) + 1

        db.commit()
        return success

    @classmethod
    def send_test_email(cls, to_email: str) -> tuple[bool, str]:
        """Send a test email to verify SMTP configuration with clear, sanitized error reporting."""
        settings.reload_from_env()
        if not cls.is_configured():
            reason = cls.get_inactive_reason()
            return False, f"SMTP transport is not active ({reason})."

        subject = "Mobileum Horizon — SMTP Test Email"
        body_html = f"""
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #12284C;">SMTP Configuration Verified</h2>
          <p>This is a test notification confirming that the outgoing SMTP mail delivery service for Mobileum Horizon is operational.</p>
          <p style="color: #64748B; font-size: 13px;">Timestamp: {datetime.now(timezone.utc).isoformat()}</p>
        </div>
        """
        body_text = f"Mobileum Horizon SMTP Test Email. Verification successful at {datetime.now(timezone.utc).isoformat()}."

        success, err_msg = cls._send_smtp(
            to_addr=to_email,
            subject=subject,
            body_html=body_html,
            body_text=body_text,
        )
        if success:
            return True, f"Test email delivered successfully to {to_email} via SMTP."
        return False, _sanitize_error(err_msg or "SMTP delivery failed.")

    @classmethod
    def resend_pending_emails(cls, db: Session, limit: int = 50) -> dict:
        """Attempt sending items in pending or failed status once SMTP is configured."""
        settings.reload_from_env()
        if not cls.is_configured():
            return {
                "dispatched": 0,
                "sent_count": 0,
                "retried_count": 0,
                "failed_count": 0,
                "reason": cls.get_inactive_reason(),
            }

        pending_items = (
            db.query(EmailOutbox)
            .filter(
                EmailOutbox.status.in_(["pending", "pending – email not configured", "failed"]),
                EmailOutbox.status != "cancelled",
            )
            .order_by(EmailOutbox.created_at.asc())
            .limit(limit)
            .all()
        )

        sent_count = 0
        failed_count = 0
        for item in pending_items:
            success = cls.dispatch_outbox_item(db, item.id)
            if success:
                sent_count += 1
            else:
                failed_count += 1

        return {
            "dispatched": sent_count,
            "sent_count": sent_count,
            "retried_count": len(pending_items),
            "failed_count": failed_count,
        }

    @classmethod
    def _send_smtp(
        cls,
        to_addr: str,
        subject: str,
        body_html: str,
        body_text: str,
        recipient_name: Optional[str] = None,
    ) -> tuple[bool, Optional[str]]:
        """Low-level SMTP connection and delivery with STARTTLS or SSL, without leaking secrets."""
        if getattr(settings, "TESTING", False):
            log.info("TESTING mode: simulated successful SMTP delivery to %s", to_addr)
            return True, None

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
            timeout = getattr(settings, "SMTP_TIMEOUT_SECONDS", 5)

            if settings.SMTP_SSL:
                server = smtplib.SMTP_SSL(host, port, timeout=timeout)
            else:
                server = smtplib.SMTP(host, port, timeout=timeout)

            with server:
                if not settings.SMTP_SSL and settings.SMTP_STARTTLS:
                    server.starttls()

                if settings.SMTP_USER and settings.SMTP_PASSWORD:
                    server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)

                server.sendmail(settings.MAIL_FROM, [to_addr], msg.as_string())

            log.info("Email delivered successfully to %s", to_addr)
            return True, None
        except smtplib.SMTPAuthenticationError as exc:
            code = getattr(exc, "smtp_code", 535)
            detail = getattr(exc, "smtp_error", b"")
            if isinstance(detail, bytes):
                detail = detail.decode("utf-8", errors="ignore")
            err = f"SMTP authentication failed ({code}): Invalid credentials or app password required."
            log.warning("SMTP auth failed for %s: %s", to_addr, err)
            return False, err
        except (smtplib.SMTPConnectError, ConnectionRefusedError) as exc:
            err = f"Connection refused connecting to SMTP host {settings.SMTP_HOST}:{settings.SMTP_PORT}"
            log.warning("SMTP connect failed for %s: %s", to_addr, err)
            return False, err
        except (socket.timeout, TimeoutError):
            timeout = getattr(settings, "SMTP_TIMEOUT_SECONDS", 5)
            err = f"Connection timed out connecting to SMTP host {settings.SMTP_HOST}:{settings.SMTP_PORT} (timeout={timeout}s)"
            log.warning("SMTP timeout for %s: %s", to_addr, err)
            return False, err
        except ssl.SSLError as exc:
            err = f"TLS/SSL error communicating with {settings.SMTP_HOST}: {exc.reason if hasattr(exc, 'reason') else str(exc)}"
            log.warning("SMTP SSL error for %s: %s", to_addr, err)
            return False, _sanitize_error(err)
        except socket.gaierror:
            err = f"DNS lookup failed for SMTP host: {settings.SMTP_HOST}"
            log.warning("SMTP DNS lookup failed: %s", err)
            return False, err
        except OSError as exc:
            err_code = getattr(exc, "errno", None) or getattr(exc, "winerror", None)
            if err_code in (10060, 110) or "timed out" in str(exc).lower():
                timeout = getattr(settings, "SMTP_TIMEOUT_SECONDS", 5)
                err = f"Connection timed out connecting to SMTP host {settings.SMTP_HOST}:{settings.SMTP_PORT} (timeout={timeout}s)"
            elif err_code in (10061, 111):
                err = f"Connection refused connecting to SMTP host {settings.SMTP_HOST}:{settings.SMTP_PORT}"
            elif err_code == 10013 or "forbidden by its access permissions" in str(exc).lower():
                err = f"Network access denied connecting to SMTP host {settings.SMTP_HOST}:{settings.SMTP_PORT}"
            else:
                err = _sanitize_error(str(exc))
            log.warning("SMTP network error for %s: %s", to_addr, err)
            return False, err
        except Exception as exc:
            err_msg = _sanitize_error(str(exc))
            log.warning("Failed to send email to %s: %s", to_addr, err_msg)
            return False, err_msg

    # =====================================================================
    # Email Template Methods on MailService
    # =====================================================================

    @classmethod
    def template_invite(cls, db: Session, user: Any, raw_token: str) -> Optional[EmailOutbox]:
        """Queue invitation email for a user."""
        email = getattr(user, "email", None)
        if not email:
            return None
        name = getattr(user, "name", email)
        app_base = getattr(settings, "APP_BASE_URL", "http://localhost:5173").rstrip("/")
        invite_link = f"{app_base}/set-password/{raw_token}"
        subj, html, text = template_invite(name, invite_link)
        return cls.queue_email(
            db,
            recipient_email=email,
            recipient_name=name,
            subject=subj,
            body_html=html,
            body_text=text,
            template_type="invite",
        )

    @classmethod
    def template_password_reset(cls, db: Session, user: Any, raw_token: str) -> Optional[EmailOutbox]:
        """Queue password reset email for a user."""
        email = getattr(user, "email", None)
        if not email:
            return None
        name = getattr(user, "name", email)
        app_base = getattr(settings, "APP_BASE_URL", "http://localhost:5173").rstrip("/")
        reset_link = f"{app_base}/reset-password/{raw_token}"
        subj, html, text = template_password_reset(name, reset_link)
        return cls.queue_email(
            db,
            recipient_email=email,
            recipient_name=name,
            subject=subj,
            body_html=html,
            body_text=text,
            template_type="reset",
        )

    @classmethod
    def send_template(
        cls,
        db: Session,
        to_email: str,
        to_name: str,
        template_type: str,
        context: dict[str, Any],
    ) -> Optional[EmailOutbox]:
        """Send a templated notification email with short subject and clean body."""
        subject = context.get("subject", "Horizon Notification")
        sender_name = context.get("sender_name", "System")
        sender_role = context.get("sender_role", "system")
        deal_id = context.get("deal_id")
        deal_name = context.get("deal_name")
        deal_summary = context.get("deal_summary") or deal_name or deal_id or "Renewal Deal"
        body_text = context.get("body_text", "")
        target_type = context.get("target_type", "deal_message")
        target_id = context.get("target_id", "")
        app_base = getattr(settings, "APP_BASE_URL", "http://localhost:5173").rstrip("/")

        link = f"{app_base}/messages?deal_id={deal_id}" if "message" in target_type else f"{app_base}/opportunities?deal_id={deal_id}"

        body_html = f"""
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1E293B; line-height: 1.6;">
          <h3 style="color: #12284C; margin: 0 0 8px 0;">{subject}</h3>
          <p style="font-size: 13px; color: #64748B; margin: 0 0 16px 0;">
            From <strong>{sender_name}</strong> ({sender_role}) · Deal: <strong>{deal_summary}</strong>
          </p>
          <div style="background-color: #F8FAFC; border-left: 4px solid #00A3AD; padding: 16px; margin: 16px 0; border-radius: 4px;">
            <p style="margin: 0; font-size: 14px; color: #0F172A; white-space: pre-wrap;">{body_text}</p>
          </div>
          <div style="margin: 24px 0;">
            <a href="{link}" style="background-color: #00A3AD; color: #FFFFFF; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block;">Open in Portal</a>
          </div>
        </div>
        """
        plain_text = f"{subject}\nFrom: {sender_name} ({sender_role})\nDeal: {deal_summary}\n\n{body_text}\n\nOpen in portal: {link}"

        return cls.queue_email(
            db=db,
            recipient_email=to_email,
            recipient_name=to_name,
            subject=subject,
            body_html=body_html,
            body_text=plain_text,
            template_type=template_type,
            deal_id=deal_id,
            deal_name=deal_name,
            sender_name=sender_name,
            sender_role=sender_role,
            recipient_role=context.get("recipient_role"),
        )

    @classmethod
    def template_new_message(
        cls,
        db: Session,
        recipient_user: Any,
        sender_name: str,
        deal_title: str,
        deal_id: str,
        body: str,
        subject: Optional[str] = None,
    ) -> Optional[EmailOutbox]:
        """Queue notification email for a new deal message."""
        email = getattr(recipient_user, "email", None)
        if not email or not getattr(recipient_user, "email_notifications", True):
            return None
        name = getattr(recipient_user, "name", email)
        app_base = getattr(settings, "APP_BASE_URL", "http://localhost:5173").rstrip("/")
        thread_link = f"{app_base}/messages?deal_id={deal_id}"
        subj, html, text = template_new_message(
            recipient_name=name,
            sender_name=sender_name,
            deal_name=deal_title,
            deal_id=deal_id,
            subject_text=subject or (body[:50] if body else "New Message"),
            body=body,
            thread_link=thread_link,
        )
        return cls.queue_email(
            db,
            recipient_email=email,
            recipient_name=name,
            subject=subj,
            body_html=html,
            body_text=text,
            template_type="new_message",
        )

    @classmethod
    def template_reply_message(
        cls,
        db: Session,
        recipient_user: Any,
        sender_name: str,
        deal_title: str,
        deal_id: str,
        body: str,
    ) -> Optional[EmailOutbox]:
        """Queue notification email for a message thread reply."""
        email = getattr(recipient_user, "email", None)
        if not email or not getattr(recipient_user, "email_notifications", True):
            return None
        name = getattr(recipient_user, "name", email)
        app_base = getattr(settings, "APP_BASE_URL", "http://localhost:5173").rstrip("/")
        thread_link = f"{app_base}/messages?deal_id={deal_id}"
        subj, html, text = template_reply_message(
            recipient_name=name,
            sender_name=sender_name,
            deal_name=deal_title,
            deal_id=deal_id,
            body=body,
            thread_link=thread_link,
        )
        return cls.queue_email(
            db,
            recipient_email=email,
            recipient_name=name,
            subject=subj,
            body_html=html,
            body_text=text,
            template_type="reply_message",
        )

    @classmethod
    def template_new_owner_alert(cls, db: Session, owner_name: str, deal_count: int) -> Optional[EmailOutbox]:
        """Queue alert to admin when an unmatched owner is found in an upload."""
        admin_email = settings.ADMIN_ALERT_EMAIL or settings.MAIL_FROM
        app_base = getattr(settings, "APP_BASE_URL", "http://localhost:5173").rstrip("/")
        admin_link = f"{app_base}/admin/users"
        subj, html, text = template_new_owner_alert(owner_name, deal_count, admin_link)
        return cls.queue_email(
            db,
            recipient_email=admin_email,
            subject=subj,
            body_html=html,
            body_text=text,
            template_type="new_owner_alert",
        )

    @classmethod
    def template_owner_missing_alert(cls, db: Session, owner_name: str) -> Optional[EmailOutbox]:
        """Queue alert to admin when a known owner is missing from an upload."""
        admin_email = settings.ADMIN_ALERT_EMAIL or settings.MAIL_FROM
        app_base = getattr(settings, "APP_BASE_URL", "http://localhost:5173").rstrip("/")
        admin_link = f"{app_base}/admin/users"
        subj, html, text = template_owner_missing_alert(owner_name, admin_link)
        return cls.queue_email(
            db,
            recipient_email=admin_email,
            subject=subj,
            body_html=html,
            body_text=text,
            template_type="owner_missing_alert",
        )


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
    short_deal = (deal_name or deal_id or "Deal")[:40]
    subject = f"New message: {short_deal}"
    body_html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1E293B; line-height: 1.6;">
      <h3 style="color: #12284C; margin: 0 0 12px 0;">New Message regarding {deal_name}</h3>
      <div style="background-color: #F8FAFC; border-left: 4px solid #00A3AD; padding: 16px; margin: 16px 0; border-radius: 4px;">
        <p style="margin: 0 0 8px 0; font-size: 13px; color: #64748B;"><strong>From:</strong> {sender_name}</p>
        <p style="margin: 0; font-size: 15px; color: #0F172A; white-space: pre-wrap;">{body}</p>
      </div>
      <div style="margin: 24px 0;">
        <a href="{thread_link}" style="background-color: #00A3AD; color: #FFFFFF; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block;">View and Reply in Portal</a>
      </div>
      <p style="font-size: 12px; color: #94A3B8;">Direct link: {thread_link}</p>
    </div>
    """
    body_text = f"New message from {sender_name} regarding {deal_name}:\n\n{body}\n\nView and reply in portal: {thread_link}"
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
    short_deal = (deal_name or deal_id or "Deal")[:40]
    subject = f"Re: {short_deal}"
    body_html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1E293B; line-height: 1.6;">
      <h3 style="color: #12284C; margin: 0 0 12px 0;">New Reply on {deal_name}</h3>
      <div style="background-color: #F8FAFC; border-left: 4px solid #3B82F6; padding: 16px; margin: 16px 0; border-radius: 4px;">
        <p style="margin: 0 0 8px 0; font-size: 13px; color: #64748B;"><strong>From:</strong> {sender_name}</p>
        <p style="margin: 0; font-size: 15px; color: #0F172A; white-space: pre-wrap;">{body}</p>
      </div>
      <div style="margin: 24px 0;">
        <a href="{thread_link}" style="background-color: #12284C; color: #FFFFFF; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block;">Open Thread</a>
      </div>
      <p style="font-size: 12px; color: #94A3B8;">Direct link: {thread_link}</p>
    </div>
    """
    body_text = f"New reply from {sender_name} regarding {deal_name}:\n\n{body}\n\nOpen thread: {thread_link}"
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

