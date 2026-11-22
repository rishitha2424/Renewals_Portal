"""
Authentication & User Management Service for Round 18.
- Password hashing: argon2 -> bcrypt -> hashlib.scrypt fallback.
- Token signing & verification (HMAC-SHA256 session tokens).
- Invite tokens & Password reset tokens (one-time, expiring, SHA256 hashed in DB).
- Account lockout & rate limiting.
- Seeding default admin (Rishitha, is_owner=True) & management account.
- Last admin and owner protection.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import re
import secrets
import time
from datetime import datetime, timezone, timedelta
from typing import Optional, Tuple, Any

from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from fastapi import HTTPException, status, Request

from backend.config import settings
from backend.models.user import User, UserAlias, UserToken
from backend.services.audit_service import log_audit_event
from backend.services.mail_service import MailService

log = logging.getLogger(__name__)

# Primary & Fallback password hashing
try:
    from argon2 import PasswordHasher
    from argon2.exceptions import VerifyMismatchError
    _argon2_hasher = PasswordHasher(time_cost=2, memory_cost=65536, parallelism=1)
except ImportError:
    _argon2_hasher = None

try:
    import bcrypt
except ImportError:
    bcrypt = None


def hash_password(password: str) -> str:
    """Hash password using argon2 if available, else bcrypt, else scrypt."""
    if not password:
        raise ValueError("Password cannot be empty")

    if _argon2_hasher is not None:
        return f"argon2${_argon2_hasher.hash(password)}"

    if bcrypt is not None:
        salt = bcrypt.gensalt(rounds=12)
        hashed = bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")
        return f"bcrypt${hashed}"

    # Standard library fallback: scrypt
    salt = secrets.token_bytes(16)
    key = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1, maxmem=0, dklen=64)
    salt_b64 = base64.b64encode(salt).decode("ascii")
    key_b64 = base64.b64encode(key).decode("ascii")
    return f"scrypt${salt_b64}${key_b64}"


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify password against hashed string supporting argon2, bcrypt, or scrypt."""
    if not plain_password or not hashed_password:
        return False

    try:
        parts = hashed_password.split("$", 2)
        scheme = parts[0]

        if scheme == "argon2" and _argon2_hasher is not None:
            raw_hash = parts[1] if len(parts) == 2 else hashed_password[7:]
            try:
                return _argon2_hasher.verify(raw_hash, plain_password)
            except VerifyMismatchError:
                return False
            except Exception:
                return False

        if scheme == "bcrypt" and bcrypt is not None:
            raw_hash = parts[1] if len(parts) == 2 else hashed_password[7:]
            return bcrypt.checkpw(plain_password.encode("utf-8"), raw_hash.encode("utf-8"))

        if scheme == "scrypt":
            # format: scrypt$salt_b64$key_b64
            pieces = hashed_password.split("$")
            if len(pieces) == 3:
                salt = base64.b64decode(pieces[1])
                expected_key = base64.b64decode(pieces[2])
                test_key = hashlib.scrypt(plain_password.encode("utf-8"), salt=salt, n=16384, r=8, p=1, maxmem=0, dklen=len(expected_key))
                return hmac.compare_digest(expected_key, test_key)

        # Fallback check for plain argon2 string without scheme prefix
        if hashed_password.startswith("$argon2") and _argon2_hasher is not None:
            try:
                return _argon2_hasher.verify(hashed_password, plain_password)
            except Exception:
                return False

        # Fallback check for plain bcrypt string without scheme prefix
        if hashed_password.startswith("$2") and bcrypt is not None:
            return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))

    except Exception as e:
        log.warning(f"Password verification error: {e}")
        return False

    return False


def validate_password_strength(password: str) -> Tuple[bool, str]:
    """Check minimum strength: at least 8 chars, mixed case or number."""
    if len(password) < 8:
        return False, "Password must be at least 8 characters long."
    if not re.search(r"[A-Za-z]", password) or not re.search(r"[0-9]", password):
        return False, "Password must include both letters and numbers."
    return True, ""


# --- One-Time Invite & Reset Tokens ---

def generate_secure_token() -> str:
    """Generate a high-entropy hex token for user invites/resets."""
    return secrets.token_urlsafe(32)


def hash_token(raw_token: str) -> str:
    """Hash token for safe database storage."""
    return hashlib.sha256(raw_token.strip().encode("utf-8")).hexdigest()


def create_user_token(
    db: Session,
    user: User,
    token_type: str,  # 'invite' | 'reset'
    expire_hours: Optional[int] = None,
) -> Tuple[str, UserToken]:
    """Create and persist a hashed single-use token in the database."""
    if expire_hours is None:
        expire_hours = (
            getattr(settings, "INVITE_TOKEN_EXPIRE_HOURS", 72)
            if token_type == "invite"
            else getattr(settings, "RESET_TOKEN_EXPIRE_HOURS", 24)
        )

    # Invalidate existing unused tokens of this type for the user
    db.query(UserToken).filter(
        UserToken.user_id == user.id,
        UserToken.token_type == token_type,
        UserToken.used_at == None,
    ).update({"used_at": datetime.now(timezone.utc)})

    raw_token = generate_secure_token()
    token_hash = hash_token(raw_token)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=expire_hours)

    user_token = UserToken(
        user_id=user.id,
        token_hash=token_hash,
        token_type=token_type,
        expires_at=expires_at,
        used_at=None,
    )
    db.add(user_token)
    db.commit()
    db.refresh(user_token)

    return raw_token, user_token


def verify_user_token(
    db: Session,
    raw_token: str,
    token_type: str,
) -> Tuple[Optional[User], Optional[UserToken], str]:
    """Verify raw token: checks existence, expiration, consumption."""
    if not raw_token:
        return None, None, "Token missing."

    thash = hash_token(raw_token)
    token_record = (
        db.query(UserToken)
        .filter(
            UserToken.token_hash == thash,
            UserToken.token_type == token_type,
        )
        .first()
    )

    if not token_record:
        return None, None, "Invalid token."

    if token_record.used_at is not None:
        return None, None, "This link has already been used."

    now = datetime.now(timezone.utc)
    exp = token_record.expires_at
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)

    if exp < now:
        return None, None, "This link has expired. Please request a new one."

    user = db.query(User).filter(User.id == token_record.user_id).first()
    if not user:
        return None, None, "Associated user account not found."

    if user.status == "disabled":
        return None, None, "User account is disabled."

    return user, token_record, ""


def consume_user_token(db: Session, token_record: UserToken) -> None:
    """Mark token as consumed."""
    token_record.used_at = datetime.now(timezone.utc)
    db.commit()


# --- Session Tokens (HMAC-SHA256) ---

def sign_session_token(user: User) -> str:
    """Create a signed, expiring session token containing user_id, email, and role."""
    expire_hours = getattr(settings, "AUTH_SESSION_EXPIRE_HOURS", 24)
    now = int(time.time())
    payload = {
        "uid": str(user.id),
        "email": str(user.email).lower(),
        "name": str(user.name or ""),
        "role": str(user.role),
        "is_owner": bool(user.is_owner),
        "owner_name": str(user.owner_name or ""),
        "iat": now,
        "exp": now + (expire_hours * 3600),
    }
    payload_json = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    payload_b64 = base64.urlsafe_b64encode(payload_json).decode("ascii").rstrip("=")

    secret = (getattr(settings, "ADMIN_SECRET_KEY", "") or "default-secret-key-change-in-production").encode("utf-8")
    sig = hmac.new(secret, payload_b64.encode("ascii"), hashlib.sha256).digest()
    sig_b64 = base64.urlsafe_b64encode(sig).decode("ascii").rstrip("=")

    return f"{payload_b64}.{sig_b64}"


def decode_session_token(token: str) -> Optional[dict[str, Any]]:
    """Decode and verify session token signature and expiration."""
    if not token or "." not in token:
        return None
    parts = token.split(".")
    if len(parts) != 2:
        return None

    payload_b64, sig_b64 = parts
    secret = (getattr(settings, "ADMIN_SECRET_KEY", "") or "default-secret-key-change-in-production").encode("utf-8")
    expected_sig = hmac.new(secret, payload_b64.encode("ascii"), hashlib.sha256).digest()
    expected_sig_b64 = base64.urlsafe_b64encode(expected_sig).decode("ascii").rstrip("=")

    if not hmac.compare_digest(sig_b64, expected_sig_b64):
        return None

    try:
        padded = payload_b64 + "=" * (-len(payload_b64) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8"))
        if payload.get("exp", 0) < time.time():
            return None
        return payload
    except Exception:
        return None


# --- Rate Limiting & Lockout ---

_FAILED_ATTEMPTS: dict[str, list[float]] = {}


def check_auth_rate_limit(key: str) -> None:
    """Enforce lockout window after repeated failed login attempts."""
    max_attempts = getattr(settings, "MAX_FAILED_LOGIN_ATTEMPTS", 5)
    lockout_sec = getattr(settings, "LOCKOUT_DURATION_MINUTES", 15) * 60
    now = time.time()

    attempts = _FAILED_ATTEMPTS.get(key, [])
    recent = [t for t in attempts if now - t < lockout_sec]
    _FAILED_ATTEMPTS[key] = recent

    if len(recent) >= max_attempts:
        retry_after = int(lockout_sec - (now - recent[0]))
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Account temporarily locked due to repeated failed login attempts. Please wait {max(1, retry_after // 60)} minutes.",
        )


def record_auth_failure(key: str) -> None:
    now = time.time()
    attempts = _FAILED_ATTEMPTS.setdefault(key, [])
    attempts.append(now)


def reset_auth_failures(key: str) -> None:
    _FAILED_ATTEMPTS.pop(key, None)


# --- Default Accounts Seeding ---

def ensure_default_accounts(db: Session) -> dict[str, User]:
    """
    Ensure the admin (Rishitha, is_owner=True) and default management account exist.
    Admin can always authenticate with ADMIN_PASSWORD from env or their own DB password.
    """
    admin_email = "rishithathoka@gmail.com"
    mgmt_email = "management@mobileum.com"

    # 1. Admin Rishitha (Owner)
    admin = db.query(User).filter(func.lower(User.email) == admin_email.lower()).first()
    if not admin:
        # Check if there is an existing user with rishitha@mobileum.com or is_owner or name Rishitha
        admin = db.query(User).filter(
            or_(
                func.lower(User.email) == "rishitha@mobileum.com",
                User.is_owner == True,
                User.name.ilike("%Rishitha%"),
            )
        ).first()

    if not admin:
        admin = User(
            name="Rishitha",
            email=admin_email,
            role="admin",
            status="active",
            is_owner=True,
            must_change_password=False,
            password_hash=hash_password(settings.ADMIN_PASSWORD) if settings.ADMIN_PASSWORD else None,
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)
        log.info(f"Created default admin owner account: {admin.email}")
    else:
        # Ensure Rishitha is always owner, admin, active, and email is rishithathoka@gmail.com
        changed = False
        if admin.email.lower() != admin_email.lower():
            admin.email = admin_email
            changed = True
        if not admin.is_owner:
            admin.is_owner = True
            changed = True
        if admin.role != "admin":
            admin.role = "admin"
            changed = True
        if admin.status != "active":
            admin.status = "active"
            changed = True
        if not admin.password_hash and settings.ADMIN_PASSWORD:
            admin.password_hash = hash_password(settings.ADMIN_PASSWORD)
            changed = True
        if changed:
            db.commit()
            db.refresh(admin)

    # 2. Management account
    mgmt = db.query(User).filter(func.lower(User.email) == mgmt_email.lower()).first()
    if not mgmt:
        mgmt = User(
            name="Management",
            email=mgmt_email,
            role="management",
            status="active",
            is_owner=False,
            must_change_password=False,
            password_hash=hash_password(settings.ADMIN_PASSWORD) if settings.ADMIN_PASSWORD else None,
        )
        db.add(mgmt)
        db.commit()
        db.refresh(mgmt)
        log.info(f"Created default management account: {mgmt.email}")

    return {"admin": admin, "management": mgmt}

