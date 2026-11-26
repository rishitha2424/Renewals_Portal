"""
Unified Recipient Resolution, Opportunity Lookup, and Background Notification/Email Fan-Out.

Enforces:
- Group expansion ("admin", "management", "owner") at send time.
- Skips author, disabled/invited/pending users, and deduplicates across groups.
- Comments: Admin included by default; Management selected locks Admin on; Owner included when shared_with_owner.
- Messages: Owner always included when admin/mgmt writes; unselected admins/mgmt cannot read, are not notified, get no email.
- Save-first architecture: DB commit returns 2xx immediately; notification fan-out, outbox rows, EmailDeliveryEvent,
  and single-connection SMTP batch dispatch run in background tasks and never fail the request.
"""
from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional, List

from sqlalchemy import func
from sqlalchemy.orm import Session, sessionmaker

from backend.models.opportunity import Opportunity
from backend.models.snapshot import UploadSnapshot
from backend.models.user import (
    User,
    UserAlias,
    Notification,
    EmailOutbox,
    EmailDeliveryEvent,
)
from backend.services.audit_service import log_audit_event
from backend.services.mail_service import MailService, _sanitize_error

log = logging.getLogger(__name__)


@dataclass
class ResolvedRecipients:
    recipients: List[User] = field(default_factory=list)
    recipient_ids: List[str] = field(default_factory=list)
    summary_admin: str = ""
    summary_public: str = ""
    has_admin_group: bool = False
    has_mgmt_group: bool = False


def resolve_caller_uid(db: Session, ctx: Any) -> str:
    """Resolve the database User.id for the caller (handles legacy 'admin' token safely)."""
    uid = str(getattr(ctx, "user_id", "") or "").strip()
    if uid and uid not in ("admin", "guest", "Viewer"):
        return uid
    if getattr(ctx, "is_admin", False):
        owner = db.query(User).filter(User.is_owner == True).first()
        if owner:
            return str(owner.id)
        first_admin = db.query(User).filter(User.role == "admin", User.status == "active").first()
        if first_admin:
            return str(first_admin.id)
    return uid or "Viewer"


def get_latest_opportunities_map(db: Session, deal_ids: List[str]) -> dict[str, Opportunity]:
    """
    Resolve Opportunity metadata for deal_ids, preferring the active snapshot
    and falling back to the most recent snapshot containing each deal (handles deals missing from next snapshot).
    """
    clean_ids = [d.strip() for d in deal_ids if d and d.strip()]
    if not clean_ids:
        return {}

    rows = (
        db.query(Opportunity, UploadSnapshot)
        .join(UploadSnapshot, Opportunity.snapshot_id == UploadSnapshot.id)
        .filter(Opportunity.opportunity_id_18.in_(clean_ids))
        .order_by(
            UploadSnapshot.is_active_today.desc(),
            UploadSnapshot.snapshot_date.desc(),
            Opportunity.id.desc(),
        )
        .all()
    )
    opp_map: dict[str, Opportunity] = {}
    for opp, _snap in rows:
        if opp.opportunity_id_18 and opp.opportunity_id_18 not in opp_map:
            opp_map[opp.opportunity_id_18] = opp

    # Fallback if an Opportunity row exists without a joined UploadSnapshot (e.g. unit test fixtures)
    missing = [d for d in clean_ids if d not in opp_map]
    if missing:
        for opp in db.query(Opportunity).filter(Opportunity.opportunity_id_18.in_(missing)).order_by(Opportunity.id.desc()).all():
            if opp.opportunity_id_18 and opp.opportunity_id_18 not in opp_map:
                opp_map[opp.opportunity_id_18] = opp

    return opp_map


def get_kam_owned_deal_ids(db: Session, owner_names: List[str]) -> set[str]:
    """Return all distinct opportunity_id_18 values owned by any of the given owner names/aliases across snapshots."""
    clean_names = {n.strip().lower() for n in owner_names if n and n.strip()}
    if not clean_names:
        return set()
    rows = (
        db.query(Opportunity.opportunity_id_18, Opportunity.opportunity_owner)
        .filter(Opportunity.opportunity_owner != None)
        .distinct()
        .all()
    )
    return {
        oid
        for oid, own in rows
        if oid and own and own.strip().lower() in clean_names
    }


def is_deal_owned_by_kam(db: Session, deal_id: str, owner_names: List[str]) -> bool:
    """Check if the deal's latest snapshot owner matches the KAM's owner_names/aliases."""
    clean_names = {n.strip().lower() for n in owner_names if n and n.strip()}
    if not clean_names or not deal_id:
        return False
    opp_map = get_latest_opportunities_map(db, [deal_id])
    opp = opp_map.get(deal_id)
    if opp and opp.opportunity_owner and opp.opportunity_owner.strip().lower() in clean_names:
        return True
    # Also check across all snapshots in case deal changed or exists in historical snapshot
    rows = (
        db.query(Opportunity.opportunity_owner)
        .filter(Opportunity.opportunity_id_18 == deal_id, Opportunity.opportunity_owner != None)
        .all()
    )
    return any(r[0].strip().lower() in clean_names for r in rows if r[0])


def resolve_owner_user(db: Session, owner_name: Optional[str]) -> Optional[User]:
    """Find active KAM user for an opportunity_owner string (matching owner_name or UserAlias)."""
    if not owner_name or not owner_name.strip():
        return None
    owner_clean = owner_name.strip().lower()
    user = (
        db.query(User)
        .filter(func.lower(User.owner_name) == owner_clean, User.status == "active")
        .first()
    )
    if user:
        return user
    alias = db.query(UserAlias).filter(func.lower(UserAlias.alias) == owner_clean).first()
    if alias and alias.user and alias.user.status == "active":
        return alias.user
    return None


def resolve_recipients(
    db: Session,
    caller_uid: str,
    caller_role: str,
    raw_recipient_ids: Optional[List[str]],
    deal_ids: List[str],
    kind: str,  # "comment" | "batch_comment" | "message" | "reply"
    visibility: str = "internal",
    thread_participant_ids: Optional[List[str]] = None,
) -> ResolvedRecipients:
    """
    Expand groups ("admin", "management", "owner") and individual IDs to active users,
    enforce role/visibility rules, skip author & inactive users, and deduplicate.
    """
    active_admins = (
        db.query(User)
        .filter(User.role == "admin", User.status == "active")
        .order_by(User.name.asc())
        .all()
    )
    active_mgmt = (
        db.query(User)
        .filter(User.role == "management", User.status == "active")
        .order_by(User.name.asc())
        .all()
    )

    opp_map = get_latest_opportunities_map(db, deal_ids)
    deal_owners: list[User] = []
    seen_owner_ids: set[str] = set()
    for d_id in deal_ids:
        opp = opp_map.get(d_id)
        if opp and opp.opportunity_owner:
            owner_u = resolve_owner_user(db, opp.opportunity_owner)
            if owner_u and str(owner_u.id) not in seen_owner_ids:
                seen_owner_ids.add(str(owner_u.id))
                deal_owners.append(owner_u)

    is_comment = kind in ("comment", "batch_comment")
    is_shared_comment = visibility in ("shared", "shared_with_owner", "public", "all")

    selected_users: list[User] = []
    seen_ids: set[str] = set()

    def _add_user(u: Optional[User]) -> None:
        if not u or u.status != "active":
            return
        uid = str(u.id)
        if uid not in seen_ids:
            seen_ids.add(uid)
            selected_users.append(u)

    if raw_recipient_ids is not None and len(raw_recipient_ids) > 0:
        tokens = [str(x).strip() for x in raw_recipient_ids if x and str(x).strip()]
        has_admin_token = any(t.lower() in ("admin", "group:admin") for t in tokens)
        has_mgmt_token = any(t.lower() in ("management", "group:management") for t in tokens)
        has_owner_token = any(t.lower() in ("owner", "group:owner") for t in tokens)

        specific_ids = [
            t for t in tokens
            if t.lower() not in ("admin", "group:admin", "management", "group:management", "owner", "group:owner")
        ]
        specific_users = (
            db.query(User)
            .filter(User.id.in_(specific_ids), User.status == "active")
            .all()
            if specific_ids
            else []
        )

        if has_admin_token:
            for a in active_admins:
                _add_user(a)
        if has_mgmt_token:
            for m in active_mgmt:
                _add_user(m)
        if has_owner_token:
            for o in deal_owners:
                _add_user(o)
        for u in specific_users:
            _add_user(u)

        # Comment rule: whenever Management is selected, Admin is automatically ticked and locked
        if is_comment:
            any_mgmt_selected = any(u.role == "management" for u in selected_users)
            if any_mgmt_selected:
                for a in active_admins:
                    _add_user(a)
            # If caller is KAM and no admin/mgmt selected, ensure Admin is included by default
            if caller_role == "kam" and not any(u.role == "admin" for u in selected_users):
                for a in active_admins:
                    _add_user(a)
            # If admin/mgmt writes shared_with_owner, Owner is always included
            if caller_role != "kam" and is_shared_comment:
                for o in deal_owners:
                    _add_user(o)
            # If internal comment, never include KAM owner
            if not is_shared_comment:
                selected_users = [u for u in selected_users if u.role != "kam"]
                seen_ids = {str(u.id) for u in selected_users}
        else:
            # Messages: Owner always included when admin/management writes
            if caller_role != "kam":
                for o in deal_owners:
                    _add_user(o)
    else:
        # Defaults when recipient_ids not explicitly provided
        if is_comment:
            # Admin included by default on every comment
            for a in active_admins:
                _add_user(a)
            if caller_role == "kam":
                # KAM default recipients are Admin and Management
                for m in active_mgmt:
                    _add_user(m)
            elif is_shared_comment:
                for o in deal_owners:
                    _add_user(o)
        elif kind == "reply":
            if thread_participant_ids:
                p_users = (
                    db.query(User)
                    .filter(User.id.in_(thread_participant_ids), User.status == "active")
                    .all()
                )
                for u in p_users:
                    _add_user(u)
            if caller_role != "kam":
                for o in deal_owners:
                    _add_user(o)
            elif not selected_users:
                for a in active_admins:
                    _add_user(a)
                for m in active_mgmt:
                    _add_user(m)
        else:
            # New message default
            if caller_role == "kam":
                for a in active_admins:
                    _add_user(a)
                for m in active_mgmt:
                    _add_user(m)
            else:
                for a in active_admins:
                    _add_user(a)
                for o in deal_owners:
                    _add_user(o)

    # Filter out the author
    final_recipients = [u for u in selected_users if str(u.id) != str(caller_uid)]

    # Build human-readable summaries (never leak email addresses; mask admin names for non-admins)
    sel_admins = [u for u in final_recipients if u.role == "admin"]
    sel_mgmt = [u for u in final_recipients if u.role == "management"]
    sel_other = [u for u in final_recipients if u.role not in ("admin", "management")]

    non_author_admins = [u for u in active_admins if str(u.id) != str(caller_uid)]
    non_author_mgmt = [u for u in active_mgmt if str(u.id) != str(caller_uid)]

    parts_admin: list[str] = []
    parts_public: list[str] = []

    if sel_admins:
        if len(sel_admins) == len(non_author_admins) and len(sel_admins) > 1:
            parts_admin.append(f"Admin ({len(sel_admins)})")
        elif len(sel_admins) == 1 and len(non_author_admins) == 1:
            parts_admin.append(sel_admins[0].name or "Admin")
        else:
            parts_admin.append(f"Admin ({len(sel_admins)})")
        parts_public.append("Admin" if len(sel_admins) == 1 else f"Admin ({len(sel_admins)})")

    if sel_mgmt:
        if len(sel_mgmt) == len(non_author_mgmt) and len(sel_mgmt) > 1:
            label = f"Management ({len(sel_mgmt)})"
            parts_admin.append(label)
            parts_public.append(label)
        else:
            for m in sel_mgmt:
                m_name = m.name or "Management"
                parts_admin.append(m_name)
                parts_public.append(m_name)

    for o in sel_other:
        o_name = o.name or o.owner_name or "Owner"
        parts_admin.append(o_name)
        parts_public.append(o_name)

    return ResolvedRecipients(
        recipients=final_recipients,
        recipient_ids=[str(u.id) for u in final_recipients],
        summary_admin=", ".join(parts_admin) if parts_admin else "None",
        summary_public=", ".join(parts_public) if parts_public else "None",
        has_admin_group=bool(sel_admins and len(sel_admins) == len(non_author_admins)),
        has_mgmt_group=bool(sel_mgmt and len(sel_mgmt) == len(non_author_mgmt)),
    )


def format_recipient_summary_for_caller(
    recipients: List[User],
    is_caller_admin: bool,
    total_active_admins: Optional[int] = None,
    total_active_mgmt: Optional[int] = None,
) -> str:
    """Format recipient list summary respecting admin-masking for non-admins."""
    sel_admins = [u for u in recipients if u.role == "admin"]
    sel_mgmt = [u for u in recipients if u.role == "management"]
    sel_other = [u for u in recipients if u.role not in ("admin", "management")]

    parts: list[str] = []
    if sel_admins:
        if not is_caller_admin:
            parts.append("Admin" if len(sel_admins) == 1 else f"Admin ({len(sel_admins)})")
        elif total_active_admins and len(sel_admins) >= total_active_admins and len(sel_admins) > 1:
            parts.append(f"Admin ({len(sel_admins)})")
        elif len(sel_admins) > 2:
            parts.append(f"Admin ({len(sel_admins)})")
        else:
            parts.extend([(u.name or "Admin") for u in sel_admins])

    if sel_mgmt:
        if total_active_mgmt and len(sel_mgmt) >= total_active_mgmt and len(sel_mgmt) > 1:
            parts.append(f"Management ({len(sel_mgmt)})")
        elif len(sel_mgmt) > 3:
            parts.append(f"Management ({len(sel_mgmt)})")
        else:
            parts.extend([(u.name or "Management") for u in sel_mgmt])

    for u in sel_other:
        parts.append(u.name or u.owner_name or "Owner")

    return ", ".join(parts)


def run_post_commit_delivery(
    bind_engine: Any,
    event_type: str,  # "comment" | "batch_comment" | "new_message" | "reply_message"
    entity_type: str,  # "deal_comment" | "deal_message"
    entity_id: str,
    author_id: str,
    author_name: str,
    author_role: str,
    author_email: str,
    subject: str,
    body_text: str,
    deal_id: Optional[str],
    deal_name: Optional[str],
    account_name: Optional[str],
    acv_amount: Optional[float],
    recipient_user_ids: List[str],
    recipient_summary: str,
    audit_event_type: str,
    audit_details: dict[str, Any],
    per_recipient_messages: Optional[dict[str, dict[str, Any]]] = None,
) -> None:
    """
    Executed AFTER the comment/message HTTP response is committed.
    Runs in BackgroundTasks. Never raises back to the caller.
    Creates:
      - AuditLog entry
      - One EmailDeliveryEvent row
      - Individual Notification rows
      - Individual EmailOutbox rows (recording 'no email on file' if missing email)
      - Submits single-connection batch SMTP dispatch to background thread executor
    """
    SessionFactory = sessionmaker(autocommit=False, autoflush=False, bind=bind_engine)
    db = SessionFactory()
    try:
        # 1. Audit log
        try:
            log_audit_event(
                db,
                audit_event_type,
                user_id=author_id,
                user_email=author_email,
                details=audit_details,
            )
        except Exception as audit_exc:
            log.warning("Post-commit audit log warning (%s): %s", audit_event_type, _sanitize_error(str(audit_exc)))

        if not recipient_user_ids and not per_recipient_messages:
            return

        target_ids = list(per_recipient_messages.keys()) if per_recipient_messages else list(recipient_user_ids)
        users = (
            db.query(User)
            .filter(User.id.in_(target_ids), User.status == "active")
            .all()
            if target_ids
            else []
        )
        user_by_id = {str(u.id): u for u in users}

        ordered_users = [user_by_id[uid] for uid in target_ids if uid in user_by_id and str(uid) != str(author_id)]
        if not ordered_users:
            return

        # 2. Create EmailDeliveryEvent (one row per event)
        now = datetime.now(timezone.utc)
        preview = (body_text or "").strip()
        if len(preview) > 240:
            preview = preview[:237] + "..."

        event_id = str(uuid.uuid4())
        event = EmailDeliveryEvent(
            id=event_id,
            event_type=event_type,
            entity_type=entity_type,
            entity_id=entity_id,
            deal_id=deal_id,
            deal_name=deal_name,
            author_id=str(author_id),
            author_name=author_name,
            author_role=author_role,
            subject=subject[:255],
            body_preview=preview,
            recipient_summary=(recipient_summary or "")[:512],
            selected_recipient_ids=json.dumps([str(u.id) for u in ordered_users]),
            total_count=len(ordered_users),
            sent_count=0,
            failed_count=0,
            skipped_count=0,
            created_at=now,
        )
        db.add(event)
        db.flush()

        # 3. Create Notifications & EmailOutbox rows
        pending_outbox: list[EmailOutbox] = []
        skipped_count = 0

        notif_category = (
            "comment"
            if event_type in ("comment", "batch_comment")
            else ("reply" if event_type == "reply_message" else "message")
        )
        template_type = (
            "comment"
            if event_type in ("comment", "batch_comment")
            else ("reply_message" if event_type == "reply_message" else "new_message")
        )

        for u in ordered_users:
            uid = str(u.id)
            override = (per_recipient_messages or {}).get(uid, {})
            u_title = override.get("title") or (
                f"New comment from {author_name}"
                if notif_category == "comment"
                else (f"New reply from {author_name}" if notif_category == "reply" else f"New message from {author_name}")
            )
            u_body = override.get("message") or body_text
            u_deal_id = override.get("deal_id", deal_id)
            u_deal_name = override.get("deal_name", deal_name)
            u_account_name = override.get("account_name", account_name)
            u_acv = override.get("acv_amount", acv_amount)
            u_target_id = override.get("target_id", entity_id)

            notif = Notification(
                user_id=u.id,
                category=notif_category,
                title=u_title[:255],
                message=u_body,
                deal_id=u_deal_id,
                deal_name=u_deal_name,
                target_type=entity_type,
                target_id=u_target_id,
                is_read=False,
                created_at=now,
            )
            db.add(notif)

            clean_email = (u.email or "").strip()
            short_deal = (u_deal_name or u_deal_id or "Renewal Deal")[:40]
            if not subject or subject == "Horizon Notification":
                subj_prefix = "New comment" if notif_category == "comment" else ("Re" if notif_category == "reply" else "New message")
                u_subject = f"{subj_prefix}: {short_deal}"
            else:
                u_subject = subject

            deal_summary = f"{u_deal_name or u_deal_id or 'Renewal Deal'}"
            if u_account_name:
                deal_summary += f" ({u_account_name})"
            if u_acv is not None:
                deal_summary += f" – ${float(u_acv):,.2f}"

            if not clean_email:
                ob = MailService.queue_email(
                    db=db,
                    recipient_email="",
                    recipient_name=u.name or "User",
                    subject=u_subject,
                    body_html="<p>No email on file</p>",
                    body_text="No email on file",
                    template_type=template_type,
                    deal_id=u_deal_id,
                    deal_name=u_deal_name,
                    sender_name=author_name,
                    sender_role=author_role,
                    recipient_role=u.role,
                    event_id=event_id,
                    recipient_user_id=uid,
                    sender_id=str(author_id),
                    auto_dispatch=False,
                    auto_commit=False,
                )
                ob.status = "skipped"
                ob.error_message = "no email on file"
                skipped_count += 1
            elif not u.email_notifications:
                ob = MailService.queue_email(
                    db=db,
                    recipient_email=clean_email,
                    recipient_name=u.name or "User",
                    subject=u_subject,
                    body_html="<p>Email notifications disabled by user</p>",
                    body_text="Email notifications disabled by user",
                    template_type=template_type,
                    deal_id=u_deal_id,
                    deal_name=u_deal_name,
                    sender_name=author_name,
                    sender_role=author_role,
                    recipient_role=u.role,
                    event_id=event_id,
                    recipient_user_id=uid,
                    sender_id=str(author_id),
                    auto_dispatch=False,
                    auto_commit=False,
                )
                ob.status = "skipped"
                ob.error_message = "email notifications disabled"
                skipped_count += 1
            else:
                ob = MailService.send_template(
                    db=db,
                    to_email=clean_email,
                    to_name=u.name or "User",
                    template_type=template_type,
                    context={
                        "subject": u_subject,
                        "recipient_name": u.name or "User",
                        "recipient_role": u.role,
                        "sender_name": author_name,
                        "sender_role": author_role,
                        "deal_id": u_deal_id or "",
                        "deal_name": u_deal_name or "",
                        "deal_summary": deal_summary,
                        "body_text": u_body,
                        "target_type": entity_type,
                        "target_id": u_target_id or "",
                        "event_id": event_id,
                        "recipient_user_id": uid,
                        "sender_id": str(author_id),
                    },
                    auto_dispatch=False,
                    auto_commit=False,
                )
                if ob and ob.status == "pending":
                    pending_outbox.append(ob)

        event.skipped_count = skipped_count
        db.commit()

        # 4. Async batch SMTP dispatch (single reused SMTP connection)
        outbox_ids_to_send = [ob.id for ob in pending_outbox if ob.id]
        if outbox_ids_to_send and MailService.is_configured():
            MailService.submit_batch_async(outbox_ids_to_send, event_id=event_id, bind_engine=bind_engine)
    except Exception as exc:
        log.warning("Post-commit delivery failed safely (comment/message preserved): %s", _sanitize_error(str(exc)))
        try:
            db.rollback()
        except Exception:
            pass
    finally:
        db.close()

