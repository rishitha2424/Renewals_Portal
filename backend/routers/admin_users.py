"""
Admin User Management & KAM List Upload Router (Round 18).
Endpoints for CRUD users, invite/reset links, KAM file upload, and sync alerts.
Protected by require_admin_context.
"""
from __future__ import annotations

import logging
import re
from typing import Optional, List
from pydantic import BaseModel, EmailStr
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from sqlalchemy.orm import Session
from sqlalchemy import func

from backend.config import settings
from backend.database import get_db
from backend.models.user import User, UserAlias, OwnerSyncAlert
from backend.models.opportunity import Opportunity
from backend.models.snapshot import UploadSnapshot
from backend.services.context import UserContext, require_admin_context
from backend.services.auth_service import create_user_token
from backend.services.audit_service import log_audit_event
from backend.services.kam_sync_service import KamSyncService, parse_kam_file
from backend.services.mail_service import MailService, template_invite, template_password_reset

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin-users"])


class CreateUserRequest(BaseModel):
    name: str
    email: str
    role: str  # "admin" | "management" | "kam"
    owner_name: Optional[str] = None
    mobileum_id: Optional[str] = None


class UpdateUserRequest(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    status: Optional[str] = None  # "active" | "disabled" | "invited"
    owner_name: Optional[str] = None
    mobileum_id: Optional[str] = None
    aliases: Optional[List[str]] = None


class ToggleStatusRequest(BaseModel):
    status: str  # "active" | "disabled"


class AddAliasRequest(BaseModel):
    alias_name: str


class ResolveAlertRequest(BaseModel):
    action: str  # "dismiss" | "add_alias"
    alias_user_id: Optional[str] = None


def check_last_admin_or_owner_protection(db: Session, target_user: User, action_description: str) -> None:
    """Ensure Rishitha (is_owner=True) or the last active admin cannot be removed/disabled/demoted."""
    if target_user.is_owner:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Cannot {action_description} the system owner (Rishitha).",
        )

    if target_user.role == "admin":
        active_admins = db.query(User).filter(User.role == "admin", User.status == "active").count()
        if active_admins <= 1:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Cannot {action_description} the last remaining administrator.",
            )


@router.get("/users")
def list_users(
    role: Optional[str] = None,
    ctx: UserContext = Depends(require_admin_context),
    db: Session = Depends(get_db),
):
    """List all user accounts with deal counts, aliases, and status."""
    q = db.query(User)
    if role:
        q = q.filter(User.role == role)
    users = q.order_by(User.created_at.desc()).all()

    # Pre-fetch deal counts per owner from active snapshot
    snap = db.query(UploadSnapshot).filter(UploadSnapshot.is_active_today == True).first()
    owner_deal_counts: dict[str, int] = {}
    if snap:
        counts = (
            db.query(Opportunity.opportunity_owner, func.count(Opportunity.id))
            .filter(Opportunity.snapshot_id == snap.id, Opportunity.opportunity_owner != None)
            .group_by(Opportunity.opportunity_owner)
            .all()
        )
        for own, c in counts:
            if own:
                owner_deal_counts[own.strip().lower()] = c

    app_base_url = getattr(settings, "APP_BASE_URL", "http://localhost:5173").rstrip("/")

    results = []
    for u in users:
        aliases = [a.alias_name for a in u.aliases] if hasattr(u, "aliases") else []
        # Calculate deals
        deal_count = 0
        if u.owner_name:
            deal_count += owner_deal_counts.get(u.owner_name.strip().lower(), 0)
        for al in aliases:
            deal_count += owner_deal_counts.get(al.strip().lower(), 0)

        results.append({
            "id": u.id,
            "name": u.name or u.email,
            "email": u.email,
            "role": u.role,
            "status": u.status,
            "is_owner": bool(u.is_owner),
            "owner_name": u.owner_name,
            "mobileum_id": u.mobileum_id,
            "aliases": aliases,
            "deal_count": deal_count,
            "last_login": u.last_login.isoformat() if u.last_login else None,
            "created_at": u.created_at.isoformat() if u.created_at else None,
        })

    return {"users": results}


@router.post("/users")
def create_user(
    req: CreateUserRequest,
    ctx: UserContext = Depends(require_admin_context),
    db: Session = Depends(get_db),
):
    """Create a new user account and generate an invite link."""
    clean_email = req.email.strip().lower()
    existing = db.query(User).filter(func.lower(User.email) == clean_email).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A user with this email already exists.")

    user = User(
        name=req.name.strip(),
        email=clean_email,
        role=req.role.strip().lower(),
        status="invited",
        owner_name=req.owner_name.strip() if req.owner_name else None,
        mobileum_id=req.mobileum_id.strip() if req.mobileum_id else None,
        must_change_password=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # Generate one-time invite token
    raw_token, token_rec = create_user_token(db, user, token_type="invite")
    app_base_url = getattr(settings, "APP_BASE_URL", "http://localhost:5173").rstrip("/")
    invite_url = f"{app_base_url}/invite/{raw_token}"
    try:
        subj, html, text = template_invite(user.name or user.email, invite_url)
        MailService.queue_email(
            db=db,
            recipient_email=user.email,
            subject=subj,
            body_html=html,
            body_text=text,
            recipient_name=user.name,
            template_type="invite",
        )
    except Exception as exc:
        log.warning(f"Could not queue invite email: {exc}")

    log_audit_event(db, "user_created", user_id=user.id, user_email=user.email, details={"created_by": ctx.email, "role": user.role})

    return {
        "status": "created",
        "user_id": user.id,
        "email": user.email,
        "invite_url": invite_url,
    }


@router.put("/users/{user_id}")
def update_user(
    user_id: str,
    req: UpdateUserRequest,
    ctx: UserContext = Depends(require_admin_context),
    db: Session = Depends(get_db),
):
    """Update user attributes (name, email, role, status, owner_name, aliases)."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    changes: dict[str, dict[str, Any]] = {}

    if req.name is not None and req.name.strip() and req.name.strip() != user.name:
        changes["name"] = {"old": user.name, "new": req.name.strip()}
        user.name = req.name.strip()

    if req.email is not None and req.email.strip().lower() != user.email.lower():
        clean_email = req.email.strip().lower()
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", clean_email):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid email format.")
        existing = db.query(User).filter(func.lower(User.email) == clean_email, User.id != user_id).first()
        if existing:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email is already in use by another user.")
        changes["email"] = {"old": user.email, "new": clean_email}
        user.email = clean_email
        if user.status == "pending_email":
            user.status = "invited"

    if req.role is not None and req.role.strip().lower() != user.role:
        new_role = req.role.strip().lower()
        if (user.role == "admin" or new_role == "admin") and not ctx.is_owner:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the system owner (Rishitha) can change administrator roles.")
        check_last_admin_or_owner_protection(db, user, "change the role of")
        changes["role"] = {"old": user.role, "new": new_role}
        user.role = new_role

    if req.status is not None and req.status != user.status:
        if req.status == "disabled":
            check_last_admin_or_owner_protection(db, user, "disable")
        changes["status"] = {"old": user.status, "new": req.status}
        user.status = req.status

    if req.owner_name is not None:
        clean_owner = req.owner_name.strip() if req.owner_name else None
        if clean_owner != user.owner_name:
            changes["owner_name"] = {"old": user.owner_name, "new": clean_owner}
            user.owner_name = clean_owner

    if req.mobileum_id is not None:
        clean_id = req.mobileum_id.strip() if req.mobileum_id else None
        if clean_id != user.mobileum_id:
            changes["mobileum_id"] = {"old": user.mobileum_id, "new": clean_id}
            user.mobileum_id = clean_id

    if req.aliases is not None and user.role == "kam":
        current_aliases = [a.alias_name for a in user.aliases] if hasattr(user, "aliases") else []
        new_aliases = [a.strip() for a in req.aliases if a.strip()]
        if set(current_aliases) != set(new_aliases):
            changes["aliases"] = {"old": current_aliases, "new": new_aliases}
            db.query(UserAlias).filter(UserAlias.user_id == user.id).delete()
            for al in new_aliases:
                db.add(UserAlias(user_id=user.id, alias_name=al))

    db.commit()
    db.refresh(user)

    log_audit_event(db, "user_updated", user_id=user.id, user_email=user.email, details={"updated_by": ctx.email, "changes": changes})
    aliases = [a.alias for a in user.aliases] if hasattr(user, "aliases") else []
    return {
        "status": "updated",
        "user_id": user.id,
        "name": user.name,
        "email": user.email,
        "role": user.role,
        "status": user.status,
        "owner_name": user.owner_name,
        "aliases": aliases,
        "changes": changes,
    }


@router.post("/users/{user_id}/status")
def toggle_user_status(
    user_id: str,
    req: ToggleStatusRequest,
    ctx: UserContext = Depends(require_admin_context),
    db: Session = Depends(get_db),
):
    """Enable or disable a user account."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    if req.status == "disabled":
        check_last_admin_or_owner_protection(db, user, "disable")

    user.status = req.status
    db.commit()
    log_audit_event(db, "user_status_changed", user_id=user.id, user_email=user.email, details={"new_status": req.status, "changed_by": ctx.email})
    return {"status": "success", "new_status": req.status}


@router.delete("/users/{user_id}")
def delete_user(
    user_id: str,
    ctx: UserContext = Depends(require_admin_context),
    db: Session = Depends(get_db),
):
    """Delete a user account (protected for owner and last admin)."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    check_last_admin_or_owner_protection(db, user, "delete")

    db.delete(user)
    db.commit()
    log_audit_event(db, "user_deleted", user_id=user_id, user_email=user.email, details={"deleted_by": ctx.email})
    return {"status": "deleted"}


@router.post("/users/{user_id}/invite-link")
def generate_invite_link(
    user_id: str,
    ctx: UserContext = Depends(require_admin_context),
    db: Session = Depends(get_db),
):
    """Generate fresh one-time invite link for manual copying."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    raw_token, token_rec = create_user_token(db, user, token_type="invite")
    app_base_url = getattr(settings, "APP_BASE_URL", "http://localhost:5173").rstrip("/")
    invite_url = f"{app_base_url}/invite/{raw_token}"
    try:
        subj, html, text = template_invite(user.name or user.email, invite_url)
        MailService.queue_email(
            db=db,
            recipient_email=user.email,
            subject=subj,
            body_html=html,
            body_text=text,
            recipient_name=user.name,
            template_type="invite",
        )
    except Exception as exc:
        log.warning(f"Could not queue invite email: {exc}")

    log_audit_event(db, "invite_link_generated", user_id=user.id, user_email=user.email, details={"generated_by": ctx.email})
    return {
        "status": "success",
        "invite_url": invite_url,
        "token": raw_token,
        "expires_in_hours": getattr(settings, "INVITE_TOKEN_EXPIRE_HOURS", 72),
        "expires_at": token_rec.expires_at.isoformat() if token_rec.expires_at else None,
    }


@router.post("/users/{user_id}/reset-link")
def generate_reset_link(
    user_id: str,
    ctx: UserContext = Depends(require_admin_context),
    db: Session = Depends(get_db),
):
    """Generate fresh password reset link for manual copying."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    raw_token, token_rec = create_user_token(db, user, token_type="reset")
    app_base_url = getattr(settings, "APP_BASE_URL", "http://localhost:5173").rstrip("/")
    reset_url = f"{app_base_url}/reset-password/{raw_token}"
    try:
        subj, html, text = template_password_reset(user.name or user.email, reset_url)
        MailService.queue_email(
            db=db,
            recipient_email=user.email,
            subject=subj,
            body_html=html,
            body_text=text,
            recipient_name=user.name,
            template_type="reset",
        )
    except Exception as exc:
        log.warning(f"Could not queue password reset email: {exc}")

    log_audit_event(db, "reset_link_generated", user_id=user.id, user_email=user.email, details={"generated_by": ctx.email})
    return {
        "status": "success",
        "reset_url": reset_url,
        "token": raw_token,
        "expires_in_hours": getattr(settings, "RESET_TOKEN_EXPIRE_HOURS", 24),
        "expires_at": token_rec.expires_at.isoformat() if token_rec.expires_at else None,
    }


@router.post("/users/{user_id}/aliases")
def add_user_alias(
    user_id: str,
    req: AddAliasRequest,
    ctx: UserContext = Depends(require_admin_context),
    db: Session = Depends(get_db),
):
    """Add an owner name alias for a user."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    clean_alias = req.alias_name.strip()
    if not clean_alias:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Alias name cannot be empty.")

    alias = UserAlias(user_id=user.id, alias_name=clean_alias)
    db.add(alias)
    db.commit()
    return {"status": "alias_added", "alias": clean_alias}


@router.delete("/users/{user_id}/aliases/{alias_name}")
def delete_user_alias(
    user_id: str,
    alias_name: str,
    ctx: UserContext = Depends(require_admin_context),
    db: Session = Depends(get_db),
):
    """Remove an owner name alias."""
    alias = db.query(UserAlias).filter(UserAlias.user_id == user_id, UserAlias.alias_name == alias_name).first()
    if alias:
        db.delete(alias)
        db.commit()
    return {"status": "alias_deleted"}


@router.post("/kam-list/upload")
async def upload_kam_list(
    file: UploadFile = File(...),
    ctx: UserContext = Depends(require_admin_context),
    db: Session = Depends(get_db),
):
    """Upload KAM Excel/CSV roster and run owner sync."""
    content = await file.read()
    try:
        records = parse_kam_file(content, file.filename)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    sync_svc = KamSyncService(db)
    result = sync_svc.sync_uploaded_kam_list(records, actor_email=ctx.email)
    return result


@router.get("/kam-sync/alerts")
def get_sync_alerts(
    ctx: UserContext = Depends(require_admin_context),
    db: Session = Depends(get_db),
):
    """List unresolved KAM owner sync alerts."""
    alerts = (
        db.query(OwnerSyncAlert)
        .filter(OwnerSyncAlert.is_resolved == False)
        .order_by(OwnerSyncAlert.created_at.desc())
        .all()
    )
    return {
        "alerts": [
            {
                "id": a.id,
                "alert_type": a.alert_type,
                "owner_name": a.owner_name,
                "deal_count": a.deal_count,
                "similarity_score": a.similarity_score,
                "suggested_user_id": a.suggested_user_id,
                "message": a.message,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            }
            for a in alerts
        ]
    }


@router.post("/kam-sync/alerts/{alert_id}/resolve")
def resolve_sync_alert(
    alert_id: str,
    req: ResolveAlertRequest,
    ctx: UserContext = Depends(require_admin_context),
    db: Session = Depends(get_db),
):
    """Resolve/dismiss an owner sync alert or link as alias."""
    sync_svc = KamSyncService(db)
    success = sync_svc.resolve_alert(alert_id, req.action, req.alias_user_id)
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found.")
    return {"status": "resolved"}

