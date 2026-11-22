"""
Authentication API Router (Round 18).
Endpoints for login, logout, current user session, invite password setup,
forgot password, and self-service password changes.
"""
from __future__ import annotations

import logging
from typing import Optional
from pydantic import BaseModel, EmailStr
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session
from sqlalchemy import func

from backend.config import settings
from backend.database import get_db
from backend.models.user import User
from backend.services.auth_service import (
    hash_password,
    verify_password,
    validate_password_strength,
    sign_session_token,
    check_auth_rate_limit,
    record_auth_failure,
    reset_auth_failures,
    create_user_token,
    verify_user_token,
    consume_user_token,
    ensure_default_accounts,
)
from backend.services.audit_service import log_audit_event
from backend.services.context import (
    UserContext,
    get_user_context,
    require_authenticated,
)
from backend.services.mail_service import MailService

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: str
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
    confirm_password: str


class SetPasswordRequest(BaseModel):
    token: str
    password: str
    confirm_password: str


class ForgotPasswordRequest(BaseModel):
    email: str


@router.post("/login")
def login(req: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    """Authenticate user with email and password. Supports admin Rishitha and env password."""
    ensure_default_accounts(db)

    client_ip = request.client.host if request.client else "unknown"
    clean_email = req.email.strip().lower()
    rate_key = f"{client_ip}:{clean_email}"

    check_auth_rate_limit(rate_key)

    user = db.query(User).filter(func.lower(User.email) == clean_email).first()

    # Check for legacy admin login using username 'admin' or owner email
    is_admin_password_match = False
    if settings.ADMIN_PASSWORD and req.password == settings.ADMIN_PASSWORD:
        if clean_email in ("admin", "admin@mobileum.com", "rishitha@mobileum.com") or (user and user.is_owner):
            is_admin_password_match = True

    if not user:
        if is_admin_password_match:
            # Ensure owner exists
            accs = ensure_default_accounts(db)
            user = accs.get("admin")
        else:
            record_auth_failure(rate_key)
            log_audit_event(db, "failed_login", user_email=clean_email, ip_address=client_ip, details={"reason": "user_not_found"})
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password.")

    if user.status == "disabled":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is disabled. Contact your administrator.")

    # Verify password
    authenticated = False
    if is_admin_password_match and (user.is_owner or user.role == "admin"):
        authenticated = True
    elif user.password_hash and verify_password(req.password, user.password_hash):
        authenticated = True

    if not authenticated:
        record_auth_failure(rate_key)
        log_audit_event(db, "failed_login", user_id=user.id, user_email=user.email, ip_address=client_ip, details={"reason": "invalid_password"})
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password.")

    # Successful login
    reset_auth_failures(rate_key)
    user.last_login = func.now()
    if user.status == "invited":
        user.status = "active"
    db.commit()
    db.refresh(user)

    session_token = sign_session_token(user)

    # Set secure HttpOnly cookie
    is_secure = getattr(settings, "COOKIE_SECURE", False)
    response.set_cookie(
        key="auth_token",
        value=session_token,
        httponly=True,
        secure=is_secure,
        samesite="lax",
        max_age=getattr(settings, "AUTH_SESSION_EXPIRE_HOURS", 24) * 3600,
        path="/",
    )
    # Also set admin_token if admin for backwards compatibility
    if user.role == "admin":
        response.set_cookie(
            key="admin_token",
            value=session_token,
            httponly=True,
            secure=is_secure,
            samesite="lax",
            max_age=getattr(settings, "AUTH_SESSION_EXPIRE_HOURS", 24) * 3600,
            path="/",
        )

    log_audit_event(db, "login", user_id=user.id, user_email=user.email, ip_address=client_ip)

    redirect_url = "/kam/overview" if user.role == "kam" else "/"

    return {
        "status": "success",
        "token": session_token,
        "redirect_url": redirect_url,
        "user": {
            "id": user.id,
            "email": user.email,
            "name": user.name or user.email,
            "role": user.role,
            "is_owner": bool(user.is_owner),
            "owner_name": user.owner_name,
            "must_change_password": bool(user.must_change_password),
        },
    }


@router.post("/logout")
def logout(response: Response, ctx: UserContext = Depends(get_user_context), db: Session = Depends(get_db)):
    """Clear session cookies and record logout in audit log."""
    response.delete_cookie(key="auth_token", path="/")
    response.delete_cookie(key="admin_token", path="/")
    if ctx.user_id != "guest":
        log_audit_event(db, "logout", user_id=ctx.user_id, user_email=ctx.email)
    return {"status": "logged_out"}


@router.get("/me")
def get_current_user_profile(ctx: UserContext = Depends(require_authenticated), db: Session = Depends(get_db)):
    """Return currently authenticated user information."""
    user = db.query(User).filter(User.id == ctx.user_id).first()
    aliases = [a.alias_name for a in user.aliases] if user and hasattr(user, "aliases") else ctx.owner_aliases
    return {
        "id": ctx.user_id,
        "email": ctx.email or (user.email if user else ""),
        "name": ctx.display_name,
        "role": ctx.role,
        "is_owner": ctx.is_owner,
        "owner_name": ctx.owner_name,
        "owner_aliases": aliases,
        "must_change_password": bool(user.must_change_password if user else False),
    }


@router.post("/change-password")
def change_password(
    req: ChangePasswordRequest,
    ctx: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db),
    response: Response = None,
):
    """Change current user's password with strength check and logout elsewhere."""
    if req.new_password != req.confirm_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="New passwords do not match.")

    valid, err_msg = validate_password_strength(req.new_password)
    if not valid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=err_msg)

    user = db.query(User).filter(User.id == ctx.user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    # Verify current password
    is_valid_current = False
    if user.password_hash and verify_password(req.current_password, user.password_hash):
        is_valid_current = True
    elif (user.is_owner or user.role == "admin") and settings.ADMIN_PASSWORD and req.current_password == settings.ADMIN_PASSWORD:
        is_valid_current = True

    if not is_valid_current:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect.")

    user.password_hash = hash_password(req.new_password)
    user.must_change_password = False
    db.commit()

    log_audit_event(db, "password_change", user_id=user.id, user_email=user.email)

    # Re-issue new session token
    new_token = sign_session_token(user)
    if response:
        response.set_cookie(
            key="auth_token",
            value=new_token,
            httponly=True,
            secure=getattr(settings, "COOKIE_SECURE", False),
            samesite="lax",
            path="/",
        )

    return {"status": "password_changed", "token": new_token}


@router.post("/forgot-password")
def forgot_password(req: ForgotPasswordRequest, request: Request, db: Session = Depends(get_db)):
    """Request password reset link. Generic message to prevent user enumeration."""
    client_ip = request.client.host if request.client else "unknown"
    clean_email = req.email.strip().lower()

    user = db.query(User).filter(func.lower(User.email) == clean_email).first()
    if user and user.status != "disabled":
        raw_token, _ = create_user_token(db, user, token_type="reset")
        MailService.template_password_reset(db, user, raw_token)
        log_audit_event(db, "password_reset_requested", user_id=user.id, user_email=user.email, ip_address=client_ip)
    else:
        log_audit_event(db, "password_reset_requested_unknown", user_email=clean_email, ip_address=client_ip)

    return {
        "status": "request_received",
        "detail": "If this email address exists in our system, you will receive password reset instructions.",
    }


@router.get("/invite/verify")
def verify_invite_token(token: str, db: Session = Depends(get_db)):
    """Verify validity of an invite or reset token without consuming it."""
    user, _, error_msg = verify_user_token(db, token, token_type="invite")
    if not user:
        # Check reset type
        user, _, error_msg = verify_user_token(db, token, token_type="reset")
        if not user:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error_msg or "Invalid or expired link.")

    return {
        "valid": True,
        "email": user.email,
        "name": user.name or user.email,
        "role": user.role,
    }


@router.post("/invite/set-password")
def set_password_from_invite(req: SetPasswordRequest, response: Response, db: Session = Depends(get_db)):
    """Activate invited account by setting the initial password."""
    if req.password != req.confirm_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Passwords do not match.")

    valid, err_msg = validate_password_strength(req.password)
    if not valid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=err_msg)

    user, token_rec, error_msg = verify_user_token(db, req.token, token_type="invite")
    if not user:
        # Also allow reset tokens through this endpoint
        user, token_rec, error_msg = verify_user_token(db, req.token, token_type="reset")
        if not user:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error_msg or "Invalid or expired link.")

    user.password_hash = hash_password(req.password)
    user.status = "active"
    user.must_change_password = False
    consume_user_token(db, token_rec)
    db.commit()
    db.refresh(user)

    log_audit_event(db, "invite_accepted", user_id=user.id, user_email=user.email)

    session_token = sign_session_token(user)
    response.set_cookie(
        key="auth_token",
        value=session_token,
        httponly=True,
        secure=getattr(settings, "COOKIE_SECURE", False),
        samesite="lax",
        path="/",
    )

    redirect_url = "/kam/overview" if user.role == "kam" else "/"
    return {
        "status": "success",
        "token": session_token,
        "redirect_url": redirect_url,
        "user": {
            "id": user.id,
            "email": user.email,
            "name": user.name or user.email,
            "role": user.role,
        },
    }


@router.post("/reset-password")
def reset_password(req: SetPasswordRequest, response: Response, db: Session = Depends(get_db)):
    """Reset password using reset token."""
    return set_password_from_invite(req, response, db)

