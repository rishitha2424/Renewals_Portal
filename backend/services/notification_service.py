"""
Notification Service (Round 25).
Handles in-app notification creation, unread counting, and automated dispatch.
"""
from __future__ import annotations
import logging
from datetime import datetime, timezone
from typing import Optional, List
from sqlalchemy.orm import Session
from sqlalchemy import func

from backend.models.user import User, Notification
from backend.services.mail_service import MailService

log = logging.getLogger(__name__)


class NotificationService:
    @staticmethod
    def create_notification(
        db: Session,
        user_id: str,
        category: str,
        title: str,
        message: str,
        deal_id: Optional[str] = None,
        deal_name: Optional[str] = None,
        target_type: str = "deal_message",
        target_id: Optional[str] = None,
        send_email: bool = True,
        email_sender_name: Optional[str] = None,
        email_sender_role: Optional[str] = None,
        account_name: Optional[str] = None,
        acv_amount: Optional[float] = None,
    ) -> Optional[Notification]:
        """Create an in-app notification and optionally queue an email notification."""
        user = db.query(User).filter(User.id == user_id).first()
        if not user or user.status == "disabled":
            return None

        notif = Notification(
            user_id=user.id,
            category=category,
            title=title,
            message=message,
            deal_id=deal_id,
            deal_name=deal_name,
            target_type=target_type,
            target_id=target_id,
            is_read=False,
            created_at=datetime.now(timezone.utc),
        )
        db.add(notif)
        db.flush()

        # Send email if enabled
        if send_email and user.email_notifications and user.email:
            try:
                # Build short subject and clean body as per Round 25 specs
                short_deal = (deal_name or deal_id or "Renewal Deal")[:40]
                subject_prefix = "New message" if "message" in category else ("New comment" if "comment" in category else "Alert")
                subject = f"{subject_prefix}: {short_deal}"

                deal_summary = f"{deal_name or deal_id}"
                if account_name:
                    deal_summary += f" ({account_name})"
                if acv_amount is not None:
                    deal_summary += f" – ${acv_amount:,.2f}"

                # Plain-text & HTML body with clean sender, 1-line deal summary, text, portal link
                MailService.send_template(
                    db=db,
                    to_email=user.email,
                    to_name=user.name,
                    template_type=category,
                    context={
                        "subject": subject,
                        "recipient_name": user.name,
                        "recipient_role": user.role,
                        "sender_name": email_sender_name or "System",
                        "sender_role": email_sender_role or "System",
                        "deal_id": deal_id or "",
                        "deal_name": deal_name or "",
                        "deal_summary": deal_summary,
                        "body_text": message,
                        "target_type": target_type,
                        "target_id": target_id or "",
                    },
                )
            except Exception as e:
                log.warning("Could not dispatch email notification to %s: %s", user.email, e)

        return notif

    @staticmethod
    def get_user_notifications(
        db: Session,
        user_id: str,
        category: Optional[str] = None,
        limit: int = 50,
    ) -> tuple[List[Notification], int]:
        """Fetch notifications and unread count strictly for the given user."""
        base_q = db.query(Notification).filter(Notification.user_id == user_id)
        unread_count = base_q.filter(Notification.is_read == False).count()

        q = base_q
        if category and category != "all":
            if category == "unread":
                q = q.filter(Notification.is_read == False)
            elif category == "message":
                q = q.filter(Notification.category.in_(["message", "reply"]))
            elif category == "comment":
                q = q.filter(Notification.category == "comment")
            elif category == "alert":
                q = q.filter(Notification.category.in_(["alert", "email_failure"]))
            else:
                q = q.filter(Notification.category == category)

        items = q.order_by(Notification.created_at.desc()).limit(limit).all()
        return items, unread_count

    @staticmethod
    def mark_as_read(db: Session, user_id: str, notification_id: str) -> bool:
        """Mark a single notification read."""
        notif = db.query(Notification).filter(
            Notification.id == notification_id,
            Notification.user_id == user_id,
        ).first()
        if not notif:
            return False
        if not notif.is_read:
            notif.is_read = True
            notif.read_at = datetime.now(timezone.utc)
            db.commit()
        return True

    @staticmethod
    def mark_all_as_read(db: Session, user_id: str) -> int:
        """Mark all unread notifications read for a user."""
        now = datetime.now(timezone.utc)
        count = (
            db.query(Notification)
            .filter(Notification.user_id == user_id, Notification.is_read == False)
            .update({"is_read": True, "read_at": now}, synchronize_session="fetch")
        )
        db.commit()
        return count

