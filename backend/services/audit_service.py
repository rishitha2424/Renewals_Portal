"""
Audit Logging Service (Round 18).
Logs login/logout/failed login/password change/reset/user creation/role change/disable/messages/email events.
Never logs passwords, tokens, or sensitive credentials.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Optional, Any
from sqlalchemy.orm import Session

from backend.models.user import AuditLog

log = logging.getLogger(__name__)


def log_audit_event(
    db: Session,
    event_type: str,
    user_id: Optional[str] = None,
    user_email: Optional[str] = None,
    ip_address: Optional[str] = None,
    details: Optional[Any] = None,
) -> AuditLog:
    """Record an audit log entry."""
    details_str = None
    if details is not None:
        if isinstance(details, (dict, list)):
            try:
                details_str = json.dumps(details)
            except Exception:
                details_str = str(details)
        else:
            details_str = str(details)

    entry = AuditLog(
        event_type=event_type,
        user_id=user_id,
        user_email=user_email,
        ip_address=ip_address,
        details=details_str,
        created_at=datetime.now(timezone.utc),
    )
    db.add(entry)
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        log.warning("Failed to record audit log (%s): %s", event_type, exc)
    return entry

