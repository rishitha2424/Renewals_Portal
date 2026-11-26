"""
Notification Service (Round 25 + Per-Category Counts & Cleanup).
Handles in-app notification creation, per-user unread counting, and cleanup on unsend/role-change.
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
        auto_commit: bool = True,
        event_id: Optional[str] = None,
        sender_id: Optional[str] = None,
    ) -> Optional[Notification]:
        """Create an in-app notification and optionally queue an email notification."""
        user = db.query(User).filter(User.id == user_id).first()
        if not user or user.status != "active":
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
        if send_email and user.email_notifications:
            try:
                short_deal = (deal_name or deal_id or "Renewal Deal")[:40]
                subject_prefix = "New message" if "message" in category or category == "reply" else ("New comment" if "comment" in category else "Alert")
                subject = f"{subject_prefix}: {short_deal}"

                deal_summary = f"{deal_name or deal_id}"
                if account_name:
                    deal_summary += f" ({account_name})"
                if acv_amount is not None:
                    deal_summary += f" – ${acv_amount:,.2f}"

                MailService.send_template(
                    db=db,
                    to_email=user.email or "",
                    to_name=user.name or "User",
                    template_type=category,
                    context={
                        "subject": subject,
                        "recipient_name": user.name or "User",
                        "recipient_role": user.role,
                        "sender_name": email_sender_name or "System",
                        "sender_role": email_sender_role or "System",
                        "deal_id": deal_id or "",
                        "deal_name": deal_name or "",
                        "deal_summary": deal_summary,
                        "body_text": message,
                        "target_type": target_type,
                        "target_id": target_id or "",
                        "event_id": event_id,
                        "recipient_user_id": str(user.id),
                        "sender_id": sender_id,
                    },
                    auto_commit=auto_commit,
                )
            except Exception as e:
                log.warning("Could not dispatch email notification for user %s: %s", user.id, e)

        return notif

    @staticmethod
    def get_user_notifications(
        db: Session,
        user_id: str,
        category: Optional[str] = None,
        limit: int = 50,
    ) -> tuple[List[Notification], int, dict[str, int]]:
        """Fetch notifications, total unread count, and unread counts by category strictly for the given user."""
        base_q = db.query(Notification).filter(Notification.user_id == user_id)
        unread_rows = (
            db.query(Notification.category, func.count(Notification.id))
            .filter(Notification.user_id == user_id, Notification.is_read == False)
            .group_by(Notification.category)
            .all()
        )
        cat_counts: dict[str, int] = {cat: cnt for cat, cnt in unread_rows}
        unread_messages = cat_counts.get("message", 0) + cat_counts.get("reply", 0)
        unread_comments = cat_counts.get("comment", 0)
        unread_alerts = cat_counts.get("alert", 0) + cat_counts.get("email_failure", 0)
        unread_count = sum(cat_counts.values())

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
        by_category = {
            "messages": unread_messages,
            "comments": unread_comments,
            "alerts": unread_alerts,
            "total": unread_count,
        }
        return items, unread_count, by_category

    @staticmethod
    def mark_as_read(db: Session, user_id: str, notification_id: str) -> bool:
        """Mark a single notification read for this user only."""
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
        """Mark all unread notifications read for this user only."""
        now = datetime.now(timezone.utc)
        count = (
            db.query(Notification)
            .filter(Notification.user_id == user_id, Notification.is_read == False)
            .update({"is_read": True, "read_at": now}, synchronize_session="fetch")
        )
        db.commit()
        return count

    @staticmethod
    def clear_notifications_for_target(
        db: Session,
        target_type: str,
        target_ids: List[str],
    ) -> int:
        """Remove unread notifications when a comment or message is unsent/deleted."""
        clean_ids = [str(tid) for tid in target_ids if tid]
        if not clean_ids:
            return 0
        deleted = (
            db.query(Notification)
            .filter(
                Notification.target_type == target_type,
                Notification.target_id.in_(clean_ids),
                Notification.is_read == False,
            )
            .delete(synchronize_session="fetch")
        )
        return deleted

    @staticmethod
    def prune_inaccessible_notifications_for_user(db: Session, user: User) -> int:
        """
        Clean up notifications that a user should no longer see after a role change,
        owner_name change, or deactivation.
        """
        if user.status != "active":
            return (
                db.query(Notification)
                .filter(Notification.user_id == user.id)
                .delete(synchronize_session="fetch")
            )

        if user.role == "kam":
            from backend.models.opportunity import Opportunity
            from backend.models.custom_column import DealComment

            allowed_owners = []
            if user.owner_name:
                allowed_owners.append(user.owner_name.strip().lower())
            for al in (user.aliases or []):
                if al.alias_name and al.alias_name.strip():
                    allowed_owners.append(al.alias_name.strip().lower())

            owned_deal_ids: set[str] = set()
            if allowed_owners:
                opps = (
                    db.query(Opportunity.opportunity_id_18, Opportunity.opportunity_owner)
                    .filter(Opportunity.opportunity_owner != None)
                    .all()
                )
                for oid, own in opps:
                    if oid and own and own.strip().lower() in allowed_owners:
                        owned_deal_ids.add(oid)

            user_notifs = db.query(Notification).filter(Notification.user_id == user.id).all()
            removed = 0
            comment_ids = [n.target_id for n in user_notifs if n.target_type == "deal_comment" and n.target_id]
            comment_vis_map: dict[str, str] = {}
            if comment_ids:
                for c in db.query(DealComment).filter(DealComment.id.in_(comment_ids)).all():
                    comment_vis_map[c.id] = c.visibility

            for n in user_notifs:
                if n.deal_id and n.deal_id not in owned_deal_ids:
                    db.delete(n)
                    removed += 1
                elif n.target_type == "deal_comment" and n.target_id in comment_vis_map:
                    if comment_vis_map[n.target_id] == "internal":
                        db.delete(n)
                        removed += 1
            return removed

        return 0
