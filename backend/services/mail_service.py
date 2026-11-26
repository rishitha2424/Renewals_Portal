"""
Email Service (Round 18 + Batch Reuse Optimization).
Handles email outbox persistence, templates, delivery event aggregation, and asynchronous SMTP delivery.
Supports Office365, Gmail, and standard SMTP (STARTTLS / SSL).
When MAIL_ENABLED is false or SMTP is unset, queues items to email_outbox with status 'pending – email not configured'.
Never logs passwords, invite tokens, or raw credentials.
"""
from __future__ import annotations

import concurrent.futures
import html as html_lib
import logging
import smtplib
import socket
import ssl
import threading
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional, List, Dict, Any, Tuple
from sqlalchemy.orm import Session, sessionmaker

from backend.config import settings, get_env_file_path
from backend.models.user import EmailOutbox, EmailDeliveryEvent

log = logging.getLogger(__name__)

_email_executor = concurrent.futures.ThreadPoolExecutor(max_workers=2, thread_name_prefix="mail-worker")
_pending_futures_lock = threading.Lock()
_pending_futures: list[concurrent.futures.Future] = []
_sqlite_mem_lock = threading.Lock()


def _track_future(fut: concurrent.futures.Future) -> concurrent.futures.Future:
    with _pending_futures_lock:
        _pending_futures.append(fut)

    def _cleanup(_f: concurrent.futures.Future) -> None:
        with _pending_futures_lock:
            try:
                _pending_futures.remove(_f)
            except ValueError:
                pass

    fut.add_done_callback(_cleanup)
    return fut


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


def _format_smtp_exception(exc: Exception) -> str:
    timeout = getattr(settings, "SMTP_TIMEOUT", getattr(settings, "SMTP_TIMEOUT_SECONDS", 60))
    if isinstance(exc, smtplib.SMTPAuthenticationError):
        code = getattr(exc, "smtp_code", 535)
        return f"SMTP authentication failed ({code}): Invalid credentials or app password required."
    if isinstance(exc, (smtplib.SMTPConnectError, ConnectionRefusedError)):
        return f"Connection refused connecting to SMTP host {settings.SMTP_HOST}:{settings.SMTP_PORT}"
    if isinstance(exc, (socket.timeout, TimeoutError)):
        return f"Connection timed out connecting to SMTP host {settings.SMTP_HOST}:{settings.SMTP_PORT} (timeout={timeout}s)"
    if isinstance(exc, ssl.SSLError):
        reason = exc.reason if hasattr(exc, "reason") else str(exc)
        return _sanitize_error(f"TLS/SSL error communicating with {settings.SMTP_HOST}: {reason}")
    if isinstance(exc, socket.gaierror):
        return f"DNS lookup failed for SMTP host: {settings.SMTP_HOST}"
    if isinstance(exc, OSError):
        err_code = getattr(exc, "errno", None) or getattr(exc, "winerror", None)
        if err_code in (10060, 110) or "timed out" in str(exc).lower():
            return f"Connection timed out connecting to SMTP host {settings.SMTP_HOST}:{settings.SMTP_PORT} (timeout={timeout}s)"
        if err_code in (10061, 111):
            return f"Connection refused connecting to SMTP host {settings.SMTP_HOST}:{settings.SMTP_PORT}"
        if err_code == 10013 or "forbidden by its access permissions" in str(exc).lower():
            return f"Network access denied connecting to SMTP host {settings.SMTP_HOST}:{settings.SMTP_PORT}"
    return _sanitize_error(str(exc)) or "Delivery failed"


class MailService:
    @classmethod
    def wait_for_idle(cls, timeout: float = 10.0) -> None:
        """Wait for all pending background mail futures (primarily for tests)."""
        with _pending_futures_lock:
            futs = list(_pending_futures)
        if futs:
            concurrent.futures.wait(futs, timeout=timeout)

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
        diag["mail_active"] = cls.is_configured() and bool(settings.MAIL_ENABLED)
        timeout_val = getattr(settings, "SMTP_TIMEOUT", getattr(settings, "SMTP_TIMEOUT_SECONDS", 60))
        diag["timeout"] = timeout_val
        diag["timeout_seconds"] = timeout_val
        try:
            from backend.database import SessionLocal
            db = SessionLocal()
            try:
                last_failed = db.query(EmailOutbox).filter(EmailOutbox.status == "failed").order_by(EmailOutbox.created_at.desc()).first()
                diag["last_delivery_error"] = last_failed.error_message if last_failed else None
            finally:
                db.close()
        except Exception:
            diag["last_delivery_error"] = None
        return diag

    @classmethod
    def _async_dispatch(cls, outbox_id: str, bind_engine: Any = None) -> None:
        """Run single dispatch in background worker with its own DB session."""
        try:
            if bind_engine is not None:
                SessionFactory = sessionmaker(autocommit=False, autoflush=False, bind=bind_engine)
                db = SessionFactory()
            else:
                from backend.database import SessionLocal
                db = SessionLocal()
            try:
                cls.dispatch_outbox_item(db, outbox_id)
            finally:
                db.close()
        except Exception as e:
            log.warning("Background email dispatch exception for %s: %s", outbox_id, _sanitize_error(str(e)))

    @classmethod
    def _async_dispatch_batch(
        cls,
        outbox_ids: List[str],
        event_id: Optional[str] = None,
        bind_engine: Any = None,
    ) -> None:
        """Run batch dispatch in background worker using a single reused SMTP connection."""
        try:
            if bind_engine is not None:
                SessionFactory = sessionmaker(autocommit=False, autoflush=False, bind=bind_engine)
                db = SessionFactory()
            else:
                from backend.database import SessionLocal
                db = SessionLocal()
            try:
                cls.dispatch_batch(db, outbox_ids, event_id=event_id)
            finally:
                db.close()
        except Exception as e:
            log.warning("Background batch email dispatch exception: %s", _sanitize_error(str(e)))

    @classmethod
    def submit_batch_async(
        cls,
        outbox_ids: List[str],
        event_id: Optional[str] = None,
        bind_engine: Any = None,
    ) -> Optional[concurrent.futures.Future]:
        if not outbox_ids:
            return None
        fut = _email_executor.submit(cls._async_dispatch_batch, list(outbox_ids), event_id, bind_engine)
        return _track_future(fut)

    @classmethod
    def sync_event_counts(cls, db: Session, event_id: Optional[str]) -> None:
        if not event_id:
            return
        event = db.query(EmailDeliveryEvent).filter(EmailDeliveryEvent.id == event_id).first()
        if not event:
            return
        rows = db.query(EmailOutbox).filter(EmailOutbox.event_id == event_id).all()
        sent = sum(1 for r in rows if r.status == "sent")
        failed = sum(1 for r in rows if r.status == "failed")
        skipped = sum(1 for r in rows if r.status == "skipped")
        event.sent_count = sent
        event.failed_count = failed
        event.skipped_count = skipped
        event.total_count = len(rows)

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
        event_id: Optional[str] = None,
        recipient_user_id: Optional[str] = None,
        sender_id: Optional[str] = None,
        auto_dispatch: bool = True,
        auto_commit: bool = True,
    ) -> EmailOutbox:
        """
        Record email into the email_outbox table.
        If auto_dispatch is True and mail delivery is configured, submits async dispatch.
        """
        if not body_text:
            import re
            body_text = re.sub(r"<[^>]+>", "", body_html).strip()

        clean_email = (recipient_email or "").strip()
        if not clean_email:
            init_status = "skipped"
            err_msg = "no email on file"
        elif cls.is_configured():
            init_status = "pending"
            err_msg = None
        else:
            init_status = "pending – email not configured"
            err_msg = None

        outbox_entry = EmailOutbox(
            event_id=event_id,
            recipient_user_id=recipient_user_id,
            sender_id=sender_id,
            recipient_email=clean_email,
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
            error_message=err_msg,
            created_at=datetime.now(timezone.utc),
        )
        db.add(outbox_entry)
        if auto_commit:
            db.commit()
            db.refresh(outbox_entry)

        if auto_dispatch and init_status == "pending" and cls.is_configured():
            bind_engine = db.get_bind()
            _track_future(_email_executor.submit(cls._async_dispatch, outbox_entry.id, bind_engine))

        return outbox_entry

    @classmethod
    def _build_mime(cls, item: EmailOutbox) -> MIMEMultipart:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = item.subject
        msg["From"] = f"Mobileum Horizon <{settings.MAIL_FROM}>"
        msg["To"] = f"{item.recipient_name} <{item.recipient_email}>" if item.recipient_name else item.recipient_email
        msg.attach(MIMEText(item.body_text or "", "plain", "utf-8"))
        msg.attach(MIMEText(item.body_html or "", "html", "utf-8"))
        return msg

    @classmethod
    def _open_smtp_connection(cls):
        host = settings.SMTP_HOST
        port = settings.SMTP_PORT
        timeout = getattr(settings, "SMTP_TIMEOUT", getattr(settings, "SMTP_TIMEOUT_SECONDS", 60))
        if settings.SMTP_SSL:
            server = smtplib.SMTP_SSL(host, port, timeout=timeout)
        else:
            server = smtplib.SMTP(host, port, timeout=timeout)
        if not settings.SMTP_SSL and settings.SMTP_STARTTLS:
            server.starttls()
        if settings.SMTP_USER and settings.SMTP_PASSWORD:
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        return server

    @classmethod
    def dispatch_batch(
        cls,
        db: Session,
        outbox_ids: List[str],
        event_id: Optional[str] = None,
    ) -> dict[str, int]:
        """
        Send a batch of outbox items through ONE reused SMTP connection.
        Per-recipient failures do not stop the remaining items.
        """
        if not outbox_ids:
            return {"sent": 0, "failed": 0, "skipped": 0}

        is_sqlite_mem = False
        try:
            bind = db.get_bind()
            is_sqlite_mem = bind is not None and str(getattr(bind, "url", "")).endswith(":memory:")
        except Exception:
            pass

        def _commit_safe():
            if is_sqlite_mem:
                with _sqlite_mem_lock:
                    db.commit()
            else:
                db.commit()

        if is_sqlite_mem:
            with _sqlite_mem_lock:
                items = (
                    db.query(EmailOutbox)
                    .filter(EmailOutbox.id.in_(outbox_ids))
                    .order_by(EmailOutbox.created_at.asc())
                    .all()
                )
        else:
            items = (
                db.query(EmailOutbox)
                .filter(EmailOutbox.id.in_(outbox_ids))
                .order_by(EmailOutbox.created_at.asc())
                .all()
            )

        sendable: list[EmailOutbox] = []
        skipped_cnt = 0
        for item in items:
            if item.status in ("cancelled", "skipped"):
                if item.status == "skipped":
                    skipped_cnt += 1
                continue
            if not (item.recipient_email and item.recipient_email.strip()):
                item.status = "skipped"
                item.error_message = item.error_message or "no email on file"
                skipped_cnt += 1
                continue
            sendable.append(item)

        if not sendable:
            if event_id:
                cls.sync_event_counts(db, event_id)
            _commit_safe()
            return {"sent": 0, "failed": 0, "skipped": skipped_cnt}

        if not cls.is_configured():
            reason = cls.get_inactive_reason()
            for item in sendable:
                item.status = "pending – email not configured"
                item.error_message = reason
            if event_id:
                cls.sync_event_counts(db, event_id)
            _commit_safe()
            return {"sent": 0, "failed": 0, "skipped": skipped_cnt}

        sent_cnt = 0
        failed_cnt = 0

        if getattr(settings, "TESTING", False):
            now = datetime.now(timezone.utc)
            for item in sendable:
                item.status = "sent"
                item.error_message = None
                item.sent_at = now
                sent_cnt += 1
            if event_id:
                cls.sync_event_counts(db, event_id)
            _commit_safe()
            return {"sent": sent_cnt, "failed": failed_cnt, "skipped": skipped_cnt}

        server = None
        try:
            server = cls._open_smtp_connection()
        except Exception as exc:
            err_msg = _format_smtp_exception(exc)
            log.warning("SMTP batch connection failed: %s", err_msg)
            for item in sendable:
                item.status = "failed"
                item.error_message = err_msg
                item.retry_count = (item.retry_count or 0) + 1
                failed_cnt += 1
            if event_id:
                cls.sync_event_counts(db, event_id)
            _commit_safe()
            return {"sent": 0, "failed": failed_cnt, "skipped": skipped_cnt}

        try:
            for item in sendable:
                try:
                    msg = cls._build_mime(item)
                    server.sendmail(settings.MAIL_FROM, [item.recipient_email], msg.as_string())
                    item.status = "sent"
                    item.error_message = None
                    item.sent_at = datetime.now(timezone.utc)
                    sent_cnt += 1
                except smtplib.SMTPServerDisconnected as exc:
                    # Attempt a single reconnect if server closed the connection mid-batch
                    try:
                        try:
                            server.quit()
                        except Exception:
                            pass
                        server = cls._open_smtp_connection()
                        msg = cls._build_mime(item)
                        server.sendmail(settings.MAIL_FROM, [item.recipient_email], msg.as_string())
                        item.status = "sent"
                        item.error_message = None
                        item.sent_at = datetime.now(timezone.utc)
                        sent_cnt += 1
                    except Exception as retry_exc:
                        item.status = "failed"
                        item.error_message = _format_smtp_exception(retry_exc)
                        item.retry_count = (item.retry_count or 0) + 1
                        failed_cnt += 1
                except Exception as exc:
                    item.status = "failed"
                    item.error_message = _format_smtp_exception(exc)
                    item.retry_count = (item.retry_count or 0) + 1
                    failed_cnt += 1
        finally:
            try:
                if server is not None:
                    server.quit()
            except Exception:
                pass

        if event_id:
            cls.sync_event_counts(db, event_id)
        _commit_safe()
        return {"sent": sent_cnt, "failed": failed_cnt, "skipped": skipped_cnt}

    @classmethod
    def dispatch_outbox_item(cls, db: Session, outbox_id: str) -> bool:
        """Synchronously deliver a single queued email from outbox by ID with error tracking."""
        item = db.query(EmailOutbox).filter(EmailOutbox.id == outbox_id).first()
        if not item or item.status in ("cancelled", "skipped"):
            return False

        if not (item.recipient_email and item.recipient_email.strip()):
            item.status = "skipped"
            item.error_message = "no email on file"
            if item.event_id:
                cls.sync_event_counts(db, item.event_id)
            db.commit()
            return False

        if not cls.is_configured():
            item.status = "pending – email not configured"
            item.error_message = cls.get_inactive_reason()
            if item.event_id:
                cls.sync_event_counts(db, item.event_id)
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

        if item.event_id:
            cls.sync_event_counts(db, item.event_id)
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
    def resend_pending_emails(cls, db: Session, limit: int = 100) -> dict:
        """Attempt sending items in pending or failed status once SMTP is configured, reusing one connection."""
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
                EmailOutbox.status != "skipped",
            )
            .order_by(EmailOutbox.created_at.asc())
            .limit(limit)
            .all()
        )

        if not pending_items:
            return {"dispatched": 0, "sent_count": 0, "retried_count": 0, "failed_count": 0}

        ids = [item.id for item in pending_items]
        if len(ids) == 1:
            ok = cls.dispatch_outbox_item(db, ids[0])
            sent_count = 1 if ok else 0
            failed_count = 0 if ok else 1
        else:
            res = cls.dispatch_batch(db, ids)
            sent_count = res["sent"]
            failed_count = res["failed"]
            for eid in {it.event_id for it in pending_items if it.event_id}:
                cls.sync_event_counts(db, eid)
            db.commit()

        return {
            "dispatched": sent_count,
            "sent_count": sent_count,
            "retried_count": len(pending_items),
            "failed_count": failed_count,
        }

    @classmethod
    def retry_failed_emails(cls, db: Session, limit: int = 100) -> dict:
        """Retry sending failed outbox items, returning recipient details and delivery counts."""
        settings.reload_from_env()
        failed_items = (
            db.query(EmailOutbox)
            .filter(EmailOutbox.status == "failed")
            .order_by(EmailOutbox.created_at.asc())
            .limit(limit)
            .all()
        )
        recipients = [
            {
                "id": item.id,
                "recipient_email": item.recipient_email,
                "recipient_name": item.recipient_name,
                "subject": item.subject,
            }
            for item in failed_items
        ]
        if not failed_items:
            return {
                "status": "success",
                "retried_count": 0,
                "sent_count": 0,
                "failed_count": 0,
                "recipients": [],
            }

        for item in failed_items:
            item.status = "pending"
            item.error_message = None
        db.commit()

        ids = [item.id for item in failed_items]
        if len(ids) == 1:
            ok = cls.dispatch_outbox_item(db, ids[0])
            sent_count = 1 if ok else 0
            failed_count = 0 if ok else 1
        else:
            res = cls.dispatch_batch(db, ids)
            sent_count = res["sent"]
            failed_count = res["failed"]
            for eid in {it.event_id for it in failed_items if it.event_id}:
                cls.sync_event_counts(db, eid)
            db.commit()

        return {
            "status": "success",
            "retried_count": len(failed_items),
            "sent_count": sent_count,
            "failed_count": failed_count,
            "recipients": recipients,
        }

    @classmethod
    def retry_outbox_item(cls, db: Session, item_id: str) -> tuple[bool, Optional[str], Optional[EmailOutbox]]:
        """Retry sending a single outbox item."""
        settings.reload_from_env()
        item = db.query(EmailOutbox).filter(EmailOutbox.id == item_id).first()
        if not item:
            return False, "Outbox item not found", None
        item.status = "pending"
        item.error_message = None
        db.commit()
        success = cls.dispatch_outbox_item(db, item.id)
        db.refresh(item)
        return success, item.error_message, item

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
            log.info("TESTING mode: simulated successful SMTP delivery to recipient")
            return True, None

        try:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = f"Mobileum Horizon <{settings.MAIL_FROM}>"
            msg["To"] = f"{recipient_name} <{to_addr}>" if recipient_name else to_addr

            msg.attach(MIMEText(body_text, "plain", "utf-8"))
            msg.attach(MIMEText(body_html, "html", "utf-8"))

            with cls._open_smtp_connection() as server:
                server.sendmail(settings.MAIL_FROM, [to_addr], msg.as_string())

            log.info("Email delivered successfully via SMTP")
            return True, None
        except Exception as exc:
            err = _format_smtp_exception(exc)
            log.warning("SMTP delivery error: %s", err)
            return False, err

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
            recipient_user_id=str(getattr(user, "id", "") or "") or None,
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
            recipient_user_id=str(getattr(user, "id", "") or "") or None,
        )

    @classmethod
    def build_notification_email(
        cls,
        to_name: str,
        template_type: str,
        context: dict[str, Any],
    ) -> tuple[str, str, str]:
        """Build (subject, body_html, body_text) with a personalised greeting."""
        subject = context.get("subject", "Horizon Notification")
        sender_name = context.get("sender_name", "System")
        sender_role = context.get("sender_role", "system")
        deal_id = context.get("deal_id")
        deal_name = context.get("deal_name")
        deal_summary = context.get("deal_summary") or deal_name or deal_id or "Renewal Deal"
        body_text = context.get("body_text", "")
        target_type = context.get("target_type", "deal_message")
        app_base = getattr(settings, "APP_BASE_URL", "http://localhost:5173").rstrip("/")

        greeting_name = to_name or "there"
        esc_subject = html_lib.escape(str(subject))
        esc_greeting = html_lib.escape(str(greeting_name))
        esc_sender = html_lib.escape(str(sender_name))
        esc_role = html_lib.escape(str(sender_role))
        esc_summary = html_lib.escape(str(deal_summary))
        esc_body = html_lib.escape(str(body_text))

        if "message" in target_type:
            link = f"{app_base}/messages?deal_id={deal_id}" if deal_id else f"{app_base}/messages"
        else:
            link = f"{app_base}/opportunities?deal_id={deal_id}" if deal_id else f"{app_base}/comments-log"

        body_html = f"""
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1E293B; line-height: 1.6;">
          <h3 style="color: #12284C; margin: 0 0 10px 0;">{esc_subject}</h3>
          <p style="margin: 0 0 12px 0; font-size: 14px;">Hello {esc_greeting},</p>
          <p style="font-size: 13px; color: #64748B; margin: 0 0 16px 0;">
            From <strong>{esc_sender}</strong> ({esc_role}) · Deal: <strong>{esc_summary}</strong>
          </p>
          <div style="background-color: #F8FAFC; border-left: 4px solid #00A3AD; padding: 16px; margin: 16px 0; border-radius: 4px;">
            <p style="margin: 0; font-size: 14px; color: #0F172A; white-space: pre-wrap;">{esc_body}</p>
          </div>
          <div style="margin: 24px 0;">
            <a href="{link}" style="background-color: #00A3AD; color: #FFFFFF; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block;">Open in Portal</a>
          </div>
        </div>
        """
        plain_text = (
            f"Hello {greeting_name},\n\n"
            f"{subject}\nFrom: {sender_name} ({sender_role})\nDeal: {deal_summary}\n\n"
            f"{body_text}\n\nOpen in portal: {link}"
        )
        return subject, body_html, plain_text

    @classmethod
    def send_template(
        cls,
        db: Session,
        to_email: str,
        to_name: str,
        template_type: str,
        context: dict[str, Any],
        auto_dispatch: bool = True,
        auto_commit: bool = True,
    ) -> Optional[EmailOutbox]:
        """Send a templated notification email with personalised greeting."""
        subject, body_html, plain_text = cls.build_notification_email(to_name, template_type, context)
        return cls.queue_email(
            db=db,
            recipient_email=to_email,
            recipient_name=to_name,
            subject=subject,
            body_html=body_html,
            body_text=plain_text,
            template_type=template_type,
            deal_id=context.get("deal_id"),
            deal_name=context.get("deal_name"),
            sender_name=context.get("sender_name"),
            sender_role=context.get("sender_role"),
            recipient_role=context.get("recipient_role"),
            event_id=context.get("event_id"),
            recipient_user_id=context.get("recipient_user_id"),
            sender_id=context.get("sender_id"),
            auto_dispatch=auto_dispatch,
            auto_commit=auto_commit,
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
            deal_id=deal_id,
            deal_name=deal_title,
            sender_name=sender_name,
            recipient_user_id=str(getattr(recipient_user, "id", "") or "") or None,
            recipient_role=getattr(recipient_user, "role", None),
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
            deal_id=deal_id,
            deal_name=deal_title,
            sender_name=sender_name,
            recipient_user_id=str(getattr(recipient_user, "id", "") or "") or None,
            recipient_role=getattr(recipient_user, "role", None),
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
      <p>Hello {recipient_name},</p>
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
    body_text = f"Hello {recipient_name},\n\nNew message from {sender_name} regarding {deal_name}:\n\n{body}\n\nView and reply in portal: {thread_link}"
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
      <p>Hello {recipient_name},</p>
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
    body_text = f"Hello {recipient_name},\n\nNew reply from {sender_name} regarding {deal_name}:\n\n{body}\n\nOpen thread: {thread_link}"
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
