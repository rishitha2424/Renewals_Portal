"""
Admin Microsoft SSO Management & Access Requests Router.
Endpoints for SSO diagnostics, connectivity testing, inspecting access requests,
and approving new users with one-click role assignment.
Protected by require_admin_context.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional, List
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.config import settings
from backend.database import get_db
from backend.models.user import User, SSOAccessRequest
from backend.services.context import UserContext, require_admin_context
from backend.services.audit_service import log_audit_event
from backend.services.sso_service import SSOService
from backend.services.schema_check import check_schema_health

log = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/sso", tags=["admin-sso"])


class ApproveAccessRequest(BaseModel):
    role: str = Field(default="kam", description="'admin', 'management', or 'kam'")
    owner_name: Optional[str] = Field(default=None, description="Exact Excel opportunity_owner name for KAMs")
    kam_portfolio_name: Optional[str] = Field(default=None, description="Exact Excel opportunity_owner name for KAMs")
    name: Optional[str] = Field(default=None, description="Optional custom display name")


@router.get("/diagnostics")
def get_sso_diagnostics(
    ctx: UserContext = Depends(require_admin_context),
    db: Session = Depends(get_db),
):
    """
    Return safe administrator SSO status and diagnostics with secrets masked.
    Never exposes AZURE_CLIENT_SECRET.
    """
    diag = settings.get_sso_admin_diagnostics()

    # Find last successful SSO login
    last_sso_user = (
        db.query(User)
        .filter(User.last_sso_login.isnot(None))
        .order_by(User.last_sso_login.desc())
        .first()
    )
    diag["last_sso_login"] = last_sso_user.last_sso_login.isoformat() if last_sso_user and last_sso_user.last_sso_login else None
    diag["last_sso_user_email"] = last_sso_user.email if last_sso_user else None

    # Count pending access requests
    pending_count = (
        db.query(func.count(SSOAccessRequest.id))
        .filter(SSOAccessRequest.status == "pending")
        .scalar() or 0
    )
    diag["pending_access_requests"] = pending_count
    schema_info = check_schema_health(db.get_bind(), check_alembic=True)
    diag["schema_status"] = schema_info
    diag["needs_migration"] = schema_info.get("needs_migration", False)
    diag["migration_message"] = schema_info.get("message", "ok")

    return diag


@router.post("/test-connection")
def test_sso_connection(
    ctx: UserContext = Depends(require_admin_context),
):
    """
    Test whether Microsoft Entra ID OpenID configuration and JWKS signing keys
    are reachable over HTTPS from this server. Reports latency and egress status.
    """
    return SSOService.test_connection()


@router.get("/access-requests")
def list_access_requests(
    status_filter: Optional[str] = None,
    limit: int = 50,
    ctx: UserContext = Depends(require_admin_context),
    db: Session = Depends(get_db),
):
    """
    List SSO access requests from users who attempted to log in via Microsoft SSO
    but did not have an existing account.
    """
    q = db.query(SSOAccessRequest)
    if status_filter:
        q = q.filter(SSOAccessRequest.status == status_filter)
    requests = q.order_by(SSOAccessRequest.last_attempt_at.desc()).limit(limit).all()

    return {
        "total": len(requests),
        "requests": [r.to_dict() for r in requests],
    }


@router.post("/access-requests/{req_id}/approve")
def approve_access_request(
    req_id: str,
    body: ApproveAccessRequest,
    ctx: UserContext = Depends(require_admin_context),
    db: Session = Depends(get_db),
):
    """
    Approve an SSO access request with one click:
    Creates a new active user account with the specified role without password requirement.
    """
    req_item = db.query(SSOAccessRequest).filter(SSOAccessRequest.id == req_id).first()
    if not req_item:
        raise HTTPException(status_code=404, detail="Access request not found")

    target_role = body.role.lower().strip()
    if target_role not in ("admin", "management", "kam"):
        raise HTTPException(status_code=400, detail="Invalid role. Must be 'admin', 'management', or 'kam'.")

    clean_email = req_item.email.lower().strip()
    target_owner = (body.kam_portfolio_name or body.owner_name or "").strip() or None
    existing_user = db.query(User).filter(func.lower(User.email) == clean_email).first()

    if existing_user:
        if existing_user.status == "disabled":
            existing_user.status = "active"
        existing_user.role = target_role
        if target_owner:
            existing_user.owner_name = target_owner
        user = existing_user
    else:
        user = User(
            email=clean_email,
            name=(body.name or req_item.name).strip(),
            role=target_role,
            owner_name=target_owner,
            status="active",
            sso_provider="entra_id",
            must_change_password=False,
            password_hash=None,  # SSO-only user
            created_at=datetime.now(timezone.utc),
        )
        db.add(user)

    # Delete access request upon approval per security and workflow requirements
    db.delete(req_item)
    db.commit()
    db.refresh(user)

    log_audit_event(
        db,
        "sso_access_request_approved",
        user_id=ctx.user_id,
        user_email=ctx.email,
        details={
            "request_id": req_id,
            "created_user_id": user.id,
            "created_user_email": user.email,
            "role": user.role,
        },
    )

    return {
        "status": "success",
        "message": f"Account created for {user.email} with role {user.role}.",
        "user": {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "role": user.role,
            "status": user.status,
            "owner_name": user.owner_name,
        },
    }


@router.post("/access-requests/{req_id}/dismiss")
def dismiss_access_request(
    req_id: str,
    ctx: UserContext = Depends(require_admin_context),
    db: Session = Depends(get_db),
):
    """Dismiss and delete an SSO access request."""
    req_item = db.query(SSOAccessRequest).filter(SSOAccessRequest.id == req_id).first()
    if not req_item:
        raise HTTPException(status_code=404, detail="Access request not found")

    dismissed_email = req_item.email
    db.delete(req_item)
    db.commit()

    log_audit_event(
        db,
        "sso_access_request_dismissed",
        user_id=ctx.user_id,
        user_email=ctx.email,
        details={"request_id": req_id, "email": dismissed_email},
    )

    return {"status": "success", "id": req_id, "action": "dismissed"}


@router.delete("/access-requests/{req_id}")
def delete_access_request(
    req_id: str,
    ctx: UserContext = Depends(require_admin_context),
    db: Session = Depends(get_db),
):
    """Delete an SSO access request record permanently."""
    req_item = db.query(SSOAccessRequest).filter(SSOAccessRequest.id == req_id).first()
    if not req_item:
        raise HTTPException(status_code=404, detail="Access request not found")

    db.delete(req_item)
    db.commit()

    return {"status": "success", "deleted_id": req_id}

