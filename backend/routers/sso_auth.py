"""
Microsoft SSO (Entra ID / Azure AD OIDC) Authentication Router.
Provides public endpoints for initiating login, handling the OIDC callback,
validating identity tokens, and mapping users into active sessions.
"""
from __future__ import annotations

import logging
import urllib.parse
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.config import settings
from backend.database import get_db
from backend.models.user import User, SSOAccessRequest
from backend.services.auth_service import sign_session_token
from backend.services.audit_service import log_audit_event
from backend.services.sso_service import SSOService

log = logging.getLogger(__name__)

router = APIRouter(prefix="/auth/sso", tags=["sso-auth"])


@router.get("/config")
def get_sso_config():
    """
    Public configuration endpoint for single sign-on.
    Returns whether SSO is enabled, whether local password login is allowed,
    and allowed corporate domains. Nothing secret is ever returned.
    """
    return settings.get_sso_public_config()


@router.get("/login")
def sso_login(
    redirect_uri: Optional[str] = None,
    client_ip: Optional[str] = None,
):
    """
    Start the Microsoft Entra ID Authorization Code flow with PKCE.
    Stores state, nonce, and code_verifier in short-lived HttpOnly cookies.
    Redirects the user's browser to Microsoft login.
    """
    if not settings.SSO_ENABLED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Single sign-on is not enabled in this environment.",
        )

    if not settings.AZURE_TENANT_ID or not settings.AZURE_CLIENT_ID:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Microsoft SSO is enabled but AZURE_TENANT_ID or AZURE_CLIENT_ID is not configured.",
        )

    try:
        auth_url, state, nonce, code_verifier = SSOService.generate_auth_url(redirect_uri=redirect_uri)
    except Exception as exc:
        log.error("Failed to generate SSO auth URL: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to initiate single sign-on authentication.",
        )

    response = RedirectResponse(url=auth_url, status_code=status.HTTP_302_FOUND)

    # Store state, nonce, and PKCE verifier in secure, short-lived HttpOnly cookies
    cookie_secure = settings.is_cookie_secure
    cookie_kwargs = {
        "httponly": True,
        "secure": cookie_secure,
        "samesite": "lax",  # Must be Lax so the cookie is sent on cross-site GET redirect from Microsoft
        "max_age": 600,     # 10 minutes expiry
        "path": "/",
    }
    response.set_cookie("sso_state", state, **cookie_kwargs)
    response.set_cookie("sso_nonce", nonce, **cookie_kwargs)
    response.set_cookie("sso_verifier", code_verifier, **cookie_kwargs)

    return response


@router.get("/callback")
def sso_callback(
    request: Request,
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
    error_description: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """
    Microsoft Entra ID callback endpoint.
    Exchanges code for tokens, validates id_token signature and claims,
    matches email against existing active accounts, and issues application session cookie.
    """
    client_ip = request.client.host if request.client else "unknown"

    def make_redirect_with_cleared_sso_cookies(target_url: str) -> RedirectResponse:
        resp = RedirectResponse(url=target_url, status_code=status.HTTP_302_FOUND)
        for c_name in ("sso_state", "sso_nonce", "sso_verifier"):
            resp.delete_cookie(c_name, path="/")
        return resp

    # 1. Handle error returned by Microsoft (e.g. user cancelled login)
    if error:
        log.info("Microsoft SSO callback returned error: %s (%s)", error, error_description)
        log_audit_event(db, "sso_callback_error", ip_address=client_ip, details={"error": error, "description": error_description})
        return make_redirect_with_cleared_sso_cookies("/login?error=sso_cancelled")

    if not code or not state:
        log_audit_event(db, "sso_callback_missing_params", ip_address=client_ip)
        return make_redirect_with_cleared_sso_cookies("/login?error=sso_state_invalid")

    # 2. Validate state to prevent CSRF
    stored_state = request.cookies.get("sso_state")
    if not stored_state or stored_state != state:
        log.warning("SSO state mismatch: stored=%s received=%s", stored_state, state)
        log_audit_event(db, "sso_state_mismatch", ip_address=client_ip)
        return make_redirect_with_cleared_sso_cookies("/login?error=sso_state_invalid")

    stored_nonce = request.cookies.get("sso_nonce")
    stored_verifier = request.cookies.get("sso_verifier")
    if not stored_verifier:
        log.warning("SSO PKCE code_verifier cookie missing")
        return make_redirect_with_cleared_sso_cookies("/login?error=sso_state_invalid")

    # 3. Exchange authorization code for tokens
    try:
        token_data = SSOService.exchange_code(code=code, code_verifier=stored_verifier)
    except Exception as exc:
        log.warning("SSO token exchange failed: %s", exc)
        log_audit_event(db, "sso_exchange_failed", ip_address=client_ip, details={"error": str(exc)})
        return make_redirect_with_cleared_sso_cookies("/login?error=sso_token_invalid")

    id_token = token_data.get("id_token")
    if not id_token:
        log.warning("SSO token response did not contain id_token")
        return make_redirect_with_cleared_sso_cookies("/login?error=sso_token_invalid")

    # 4. Cryptographically validate id_token (signature, tenant, audience, nonce, expiry)
    try:
        claims = SSOService.validate_id_token(id_token=id_token, expected_nonce=stored_nonce)
    except Exception as exc:
        err_msg = str(exc)
        log.warning("SSO id_token validation failed: %s", err_msg)
        log_audit_event(db, "sso_token_invalid", ip_address=client_ip, details={"error": err_msg})
        if "Tenant ID mismatch" in err_msg or "tenant_mismatch" in err_msg.lower():
            return make_redirect_with_cleared_sso_cookies("/login?error=tenant_mismatch")
        return make_redirect_with_cleared_sso_cookies("/login?error=sso_token_invalid")

    # 5. Extract email according to configured priority (email, preferred_username, upn)
    try:
        raw_email = SSOService.extract_email(claims)
    except Exception as exc:
        log.warning("Could not extract email from verified claims: %s", exc)
        log_audit_event(db, "sso_email_missing", ip_address=client_ip)
        return make_redirect_with_cleared_sso_cookies("/login?error=missing_email_claim")

    clean_email = raw_email.strip().lower()
    user_name = SSOService.extract_name(claims, clean_email)
    tenant_id = claims.get("tid", "")

    # 6. Verify corporate email domain if SSO_ALLOWED_DOMAINS is configured
    if not SSOService.is_domain_allowed(clean_email):
        log.warning("SSO email domain rejected for %s", clean_email)
        log_audit_event(db, "sso_domain_rejected", user_email=clean_email, ip_address=client_ip, details={"domain": clean_email.split("@")[-1]})
        encoded_email = urllib.parse.quote(clean_email)
        return make_redirect_with_cleared_sso_cookies(f"/login?error=domain_not_allowed&email={encoded_email}")

    # 7. Identity Matching: Compare against existing database users
    user = db.query(User).filter(func.lower(User.email) == clean_email).first()

    # Check if this matches system owner email from .env
    owner_env_email = (getattr(settings, "OWNER_EMAIL", "") or "").strip().lower()
    if not user and owner_env_email and clean_email == owner_env_email:
        owner_user = db.query(User).filter(User.is_owner == True).first()
        if owner_user:
            # Sync owner email
            log_audit_event(
                db,
                "owner_email_synced_on_sso",
                user_id=owner_user.id,
                details={"old_email": owner_user.email, "new_email": clean_email},
            )
            owner_user.email = clean_email
            owner_user.name = getattr(settings, "OWNER_NAME", None) or owner_user.name or user_name
            db.commit()
            db.refresh(owner_user)
            user = owner_user

    # 8. User Authorization & Access Control
    # If no existing account matches: NO session created. Record Access Request for admin review.
    if not user:
        log.info("SSO sign-in attempt with no existing account: %s (%s)", clean_email, user_name)
        existing_req = (
            db.query(SSOAccessRequest)
            .filter(func.lower(SSOAccessRequest.email) == clean_email, SSOAccessRequest.status == "pending")
            .first()
        )
        if existing_req:
            existing_req.attempt_count += 1
            existing_req.last_attempt_at = func.now()
            existing_req.name = user_name
        else:
            req_item = SSOAccessRequest(
                email=clean_email,
                name=user_name,
                tenant_id=tenant_id,
                status="pending",
                attempt_count=1,
            )
            db.add(req_item)

        log_audit_event(
            db,
            "sso_access_requested",
            user_email=clean_email,
            ip_address=client_ip,
            details={"name": user_name, "tenant_id": tenant_id},
        )
        db.commit()

        encoded_email = urllib.parse.quote(clean_email)
        return make_redirect_with_cleared_sso_cookies(f"/login?error=no_access&email={encoded_email}")

    # If user exists but is disabled
    if user.status == "disabled":
        log.warning("SSO login attempted for disabled user: %s", clean_email)
        log_audit_event(db, "sso_login_disabled", user_id=user.id, user_email=clean_email, ip_address=client_ip)
        return make_redirect_with_cleared_sso_cookies("/login?error=account_disabled")

    # 9. Successful SSO Authentication: Activate user, generate session, and issue cookie
    if user.status in ("invited", "pending_email"):
        user.status = "active"

    user.last_login = func.now()
    user.last_sso_login = func.now()
    user.sso_provider = "entra_id"
    db.commit()
    db.refresh(user)

    log_audit_event(
        db,
        "sso_login",
        user_id=user.id,
        user_email=user.email,
        ip_address=client_ip,
        details={"tenant_id": tenant_id, "provider": "entra_id", "role": user.role},
    )

    session_token = sign_session_token(user)

    # Determine destination URL
    target_path = "/kam/overview" if user.role == "kam" else "/"
    response = make_redirect_with_cleared_sso_cookies(target_path)

    # Issue HttpOnly session cookie
    is_secure = settings.is_cookie_secure
    max_age_seconds = getattr(settings, "AUTH_SESSION_EXPIRE_HOURS", 24) * 3600
    response.set_cookie(
        key="auth_token",
        value=session_token,
        httponly=True,
        secure=is_secure,
        samesite="lax",
        max_age=max_age_seconds,
        path="/",
    )
    if user.role == "admin":
        response.set_cookie(
            key="admin_token",
            value=session_token,
            httponly=True,
            secure=is_secure,
            samesite="lax",
            max_age=max_age_seconds,
            path="/",
        )

    return response

