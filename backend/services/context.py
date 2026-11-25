"""
UserContext and Authentication Dependencies (Round 18).
- Role-based authorization: admin, management, kam, viewer.
- Server-side KAM owner & alias resolution.
- Legacy admin token backwards compatibility.
- Cookies: auth_token, admin_token.
- Bearer token header support.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from backend.config import settings
from backend.database import get_db

log = logging.getLogger(__name__)

security_bearer = HTTPBearer(auto_error=False)

# Backward-compatibility rate-limiting helpers for admin_auth.py
_LOGIN_FAILURES: dict[str, list[float]] = {}
MAX_FAILED_ATTEMPTS = 5
LOCKOUT_DURATION_SEC = 60.0

def check_rate_limit(ip: str) -> None:
    now = time.time()
    attempts = _LOGIN_FAILURES.get(ip, [])
    recent = [t for t in attempts if now - t < LOCKOUT_DURATION_SEC]
    _LOGIN_FAILURES[ip] = recent
    if len(recent) >= MAX_FAILED_ATTEMPTS:
        retry_after = int(LOCKOUT_DURATION_SEC - (now - recent[0]))
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many failed login attempts. Please wait {max(1, retry_after)} seconds.",
        )

def record_login_failure(ip: str) -> None:
    now = time.time()
    attempts = _LOGIN_FAILURES.setdefault(ip, [])
    attempts.append(now)

def reset_login_failures(ip: str) -> None:
    _LOGIN_FAILURES.pop(ip, None)


@dataclass
class UserContext:
    user_id: str = "guest"
    email: str = ""
    display_name: str = "Viewer"
    role: str = "viewer"  # "admin" | "management" | "kam" | "viewer"
    roles: list[str] = field(default_factory=lambda: ["viewer"])
    is_owner: bool = False
    owner_name: Optional[str] = None
    owner_aliases: list[str] = field(default_factory=list)

    @property
    def is_admin(self) -> bool:
        return self.role == "admin" or "admin" in self.roles

    @property
    def is_management(self) -> bool:
        return self.role == "management" or "management" in self.roles

    @property
    def is_kam(self) -> bool:
        return self.role == "kam" or "kam" in self.roles

    @property
    def all_owner_names(self) -> list[str]:
        names = []
        if self.owner_name:
            names.append(self.owner_name.strip())
        for a in self.owner_aliases:
            if a and a.strip() and a.strip() not in names:
                names.append(a.strip())
        return names

    def has_role(self, required_role: str) -> bool:
        if self.is_admin:
            return True
        return self.role == required_role or required_role in self.roles


# Legacy admin token helpers for backward compatibility
def sign_admin_token(user_name: str = "Admin") -> str:
    """Create a signed, expiring admin token."""
    from backend.services.auth_service import sign_session_token
    payload = {
        "sub": "admin",
        "name": user_name.strip() if user_name else "Admin",
        "role": "admin",
        "exp": int(time.time()) + (settings.ADMIN_TOKEN_EXPIRE_HOURS * 3600),
        "iat": int(time.time()),
    }
    payload_b64 = base64.urlsafe_b64encode(json.dumps(payload).encode("utf-8")).decode("utf-8").rstrip("=")
    key = settings.ADMIN_SECRET_KEY.encode("utf-8")
    sig = hmac.new(key, payload_b64.encode("utf-8"), hashlib.sha256).digest()
    sig_b64 = base64.urlsafe_b64encode(sig).decode("utf-8").rstrip("=")
    return f"{payload_b64}.{sig_b64}"


def decode_admin_token(token: str) -> dict | None:
    """Validate legacy admin token signature and expiration."""
    if not token or "." not in token:
        return None
    parts = token.split(".")
    if len(parts) != 2:
        return None
    payload_b64, sig_b64 = parts
    try:
        key = settings.ADMIN_SECRET_KEY.encode("utf-8")
        expected_sig = hmac.new(key, payload_b64.encode("utf-8"), hashlib.sha256).digest()
        expected_sig_b64 = base64.urlsafe_b64encode(expected_sig).decode("utf-8").rstrip("=")
        if not hmac.compare_digest(sig_b64, expected_sig_b64):
            return None

        padded = payload_b64 + "=" * (-len(payload_b64) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded.encode("utf-8")).decode("utf-8"))
        if payload.get("sub") != "admin":
            return None
        if payload.get("exp", 0) < time.time():
            return None
        return payload
    except Exception:
        return None


def verify_admin_token(token: str) -> bool:
    return decode_admin_token(token) is not None


def get_token_from_request(request: Request) -> Optional[str]:
    # 1. Bearer Header
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        return auth_header[7:].strip()
    # 2. auth_token Cookie
    cookie_token = request.cookies.get("auth_token")
    if cookie_token:
        return cookie_token.strip()
    # 3. Legacy admin_token Cookie
    admin_cookie = request.cookies.get("admin_token")
    if admin_cookie:
        return admin_cookie.strip()
    return None


def get_user_context(request: Request, db: Session = Depends(get_db)) -> UserContext:
    """
    Public context resolver.
    Extracts session or admin token. If valid, returns authenticated UserContext.
    If no valid token is present, returns anonymous guest UserContext (role="viewer").
    """
    token = get_token_from_request(request)
    if not token:
        return UserContext(user_id="guest", email="", display_name="Viewer", role="viewer", roles=["viewer"])

    # 1. Try decoding as Round 18 session token
    from backend.services.auth_service import decode_session_token
    session_data = decode_session_token(token)
    if session_data:
        from backend.models.user import User, UserAlias
        user_id = session_data.get("uid")
        user = db.query(User).filter(User.id == user_id).first() if user_id else None
        if user and user.status == "active":
            aliases = [a.alias_name for a in user.aliases] if hasattr(user, "aliases") else []
            return UserContext(
                user_id=str(user.id),
                email=user.email,
                display_name=user.name or user.email,
                role=user.role,
                roles=[user.role, "viewer"],
                is_owner=bool(user.is_owner),
                owner_name=user.owner_name,
                owner_aliases=aliases,
            )

    # 2. Try legacy admin token
    legacy_payload = decode_admin_token(token)
    if legacy_payload:
        user_name = legacy_payload.get("name") or "admin"
        return UserContext(
            user_id="admin",
            email="rishithathoka@gmail.com",
            display_name=user_name,
            role="admin",
            roles=["admin", "management", "viewer"],
            is_owner=True,
        )

    return UserContext(user_id="guest", email="", display_name="Viewer", role="viewer", roles=["viewer"])


def require_authenticated(ctx: UserContext = Depends(get_user_context)) -> UserContext:
    """Enforce that the caller is logged in (not guest)."""
    if ctx.role == "viewer" and ctx.user_id == "guest":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please log in.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return ctx


def require_admin_context(ctx: UserContext = Depends(get_user_context)) -> UserContext:
    """Enforce admin authorization."""
    if ctx.role == "viewer" and ctx.user_id == "guest":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required: Admin token missing.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not ctx.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access forbidden: Admin permissions required.",
        )
    return ctx


def require_management_or_admin(ctx: UserContext = Depends(get_user_context)) -> UserContext:
    """Enforce management or admin role."""
    if ctx.role == "viewer" and ctx.user_id == "guest":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please log in.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not (ctx.is_admin or ctx.is_management):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access forbidden: Management or Admin role required.",
        )
    return ctx


# Default admin context for CLI scripts or tests
ADMIN_CONTEXT = UserContext(
    user_id="admin",
    email="rishitha@mobileum.com",
    display_name="Rishitha (Admin)",
    role="admin",
    roles=["admin", "management", "viewer"],
    is_owner=True,
)
