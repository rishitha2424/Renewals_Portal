"""
Admin Authentication Router (Addendum D).
- POST /api/admin/login
- POST /api/admin/logout
- GET /api/admin/status
"""
from __future__ import annotations

import hmac
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel

from backend.config import settings
from backend.services.context import (
    UserContext,
    check_rate_limit,
    record_login_failure,
    reset_login_failures,
    sign_admin_token,
    require_admin_context,
    get_user_context,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


class LoginRequest(BaseModel):
    password: str
    name: Optional[str] = "Admin"


class LoginResponse(BaseModel):
    status: str
    token: str
    user_name: str
    expires_in_hours: int


@router.post("/login", response_model=LoginResponse)
def admin_login(body: LoginRequest, request: Request, response: Response):
    """
    Authenticate admin with ADMIN_PASSWORD and person's name.
    Uses constant-time comparison, rate-limiting, and sets HttpOnly cookie.
    Password is never logged or returned.
    """
    client_ip = request.client.host if request.client else "127.0.0.1"

    if not settings.is_admin_configured:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access is disabled: Admin authentication is not configured (ADMIN_PASSWORD or ADMIN_SECRET_KEY missing/unset).",
        )

    # Validate name (2-60 characters)
    admin_name = str(body.name or "Admin").strip()
    if len(admin_name) < 2 or len(admin_name) > 60:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Admin name must be between 2 and 60 characters.",
        )

    # 1. Rate-limit check
    check_rate_limit(client_ip)

    # 2. Constant-time comparison
    is_valid = hmac.compare_digest(body.password.strip(), settings.ADMIN_PASSWORD.strip())

    if not is_valid:
        record_login_failure(client_ip)
        log.warning("Failed admin login attempt from IP %s", client_ip)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials.",
        )

    # Reset failure tracking on success
    reset_login_failures(client_ip)

    # Issue signed token carrying person's name
    token = sign_admin_token(user_name=admin_name)

    # Set secure HttpOnly cookie (SameSite Lax, secure in prod)
    response.set_cookie(
        key="admin_token",
        value=token,
        max_age=settings.ADMIN_TOKEN_EXPIRE_HOURS * 3600,
        httponly=True,
        samesite="lax",
        secure=settings.is_cookie_secure,
    )

    log.info("Admin successfully signed in as '%s' from IP %s", admin_name, client_ip)
    return LoginResponse(
        status="ok",
        token=token,
        user_name=admin_name,
        expires_in_hours=settings.ADMIN_TOKEN_EXPIRE_HOURS,
    )


@router.post("/logout")
def admin_logout(response: Response):
    """Clear admin cookie. Works without a valid token, clearing cookie and returning 200."""
    response.delete_cookie("admin_token")
    return {"status": "logged_out"}


def get_security_warnings() -> list[str]:
    """Inspect environment configuration and return security warnings if defaults or insecure settings are used."""
    warnings = []
    if not settings.ADMIN_PASSWORD or not settings.ADMIN_PASSWORD.strip():
        warnings.append("ADMIN_PASSWORD is empty or unset.")
    elif settings.ADMIN_PASSWORD.strip() in ("admin", "password", "admin123"):
        warnings.append("ADMIN_PASSWORD is using an insecure default value.")

    disallowed_keys = {
        "",
        "supersecret_renewals_admin_signing_key_change_in_prod",
        "change_this_to_a_long_random_secret_in_production",
    }
    if not settings.ADMIN_SECRET_KEY or settings.ADMIN_SECRET_KEY.strip() in disallowed_keys:
        warnings.append("ADMIN_SECRET_KEY is unset or using a default insecure key.")

    if settings.ENVIRONMENT.lower() == "production" and not settings.is_cookie_secure:
        log.warning("Cookies are not secure in production (COOKIE_SECURE=false).")

    return warnings


def get_security_checks() -> list[dict]:
    """Inspect environment configuration and return structured security checks."""
    checks = []

    # 1. ADMIN_PASSWORD not default
    pwd = (settings.ADMIN_PASSWORD or "").strip()
    is_default_pwd = pwd in ("admin", "password", "admin123")
    is_empty_pwd = not pwd
    if is_empty_pwd:
        checks.append({
            "id": "admin_password",
            "name": "Admin Password",
            "status": "warning",
            "message": "ADMIN_PASSWORD is empty or unset.",
            "fix": "Set a strong, non-default ADMIN_PASSWORD environment variable.",
        })
    elif is_default_pwd:
        checks.append({
            "id": "admin_password",
            "name": "Admin Password",
            "status": "warning",
            "message": "ADMIN_PASSWORD is using an insecure default value.",
            "fix": "Set a strong, non-default ADMIN_PASSWORD environment variable.",
        })
    else:
        checks.append({
            "id": "admin_password",
            "name": "Admin Password",
            "status": "ok",
            "message": "Strong non-default ADMIN_PASSWORD configured.",
            "fix": "No action needed.",
        })

    # 2. ADMIN_SECRET_KEY set
    sec_key = (settings.ADMIN_SECRET_KEY or "").strip()
    disallowed_keys = {
        "",
        "supersecret_renewals_admin_signing_key_change_in_prod",
        "change_this_to_a_long_random_secret_in_production",
    }
    if not sec_key or sec_key in disallowed_keys:
        checks.append({
            "id": "admin_secret_key",
            "name": "Admin Secret Key",
            "status": "warning",
            "message": "ADMIN_SECRET_KEY is unset or using a default insecure key.",
            "fix": "Generate a 32+ character random secret and set ADMIN_SECRET_KEY.",
        })
    else:
        checks.append({
            "id": "admin_secret_key",
            "name": "Admin Secret Key",
            "status": "ok",
            "message": "Custom ADMIN_SECRET_KEY is configured.",
            "fix": "No action needed.",
        })

    # 3. Cookie Secure flag vs HTTPS
    is_prod = settings.ENVIRONMENT.lower() == "production"
    is_cookie_secure = getattr(settings, "is_cookie_secure", False)
    if is_prod and not is_cookie_secure:
        checks.append({
            "id": "cookie_secure",
            "name": "Cookie Secure Flag vs HTTPS",
            "status": "warning",
            "message": "Cookies are not marked Secure while ENVIRONMENT is production.",
            "fix": "Set COOKIE_SECURE=true when serving over HTTPS in production.",
        })
    else:
        checks.append({
            "id": "cookie_secure",
            "name": "Cookie Secure Flag vs HTTPS",
            "status": "ok",
            "message": "Cookie security flag aligns with current environment.",
            "fix": "Ensure COOKIE_SECURE=true when deploying over HTTPS.",
        })

    # 4. CORS Origins
    cors = getattr(settings, "CORS_ORIGINS", []) or []
    if is_prod and ("*" in cors):
        checks.append({
            "id": "cors_origins",
            "name": "CORS Origins",
            "status": "warning",
            "message": "Wildcard '*' CORS origin is active in production.",
            "fix": "Set CORS_ORIGINS to specific allowed domain URLs in production.",
        })
    else:
        checks.append({
            "id": "cors_origins",
            "name": "CORS Origins",
            "status": "ok",
            "message": f"Allowed CORS origins configured ({len(cors)} allowed).",
            "fix": "No action needed.",
        })

    return checks


@router.get("/status")
def admin_status(ctx: UserContext = Depends(get_user_context)):
    """Check current admin session state without credentials."""
    is_admin = ctx.is_admin
    configured = bool(settings.is_admin_configured)
    return {
        "is_admin": is_admin,
        "user_name": ctx.user_id if is_admin else None,
        "is_configured": configured,
        "security_warnings": get_security_warnings() if is_admin else [],
        "security_checks": get_security_checks() if is_admin else [],
    }


@router.get("/security-checks")
def admin_security_checks(ctx: UserContext = Depends(get_user_context)):
    """Admin-only security posture checks."""
    return {"checks": get_security_checks()}
