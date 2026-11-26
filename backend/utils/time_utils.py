"""Shared UTC timestamp formatting helpers."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional


def to_utc_iso(dt: Optional[datetime]) -> Optional[str]:
    """Serialize any naive (assumed UTC) or aware datetime to UTC ISO-8601 with trailing 'Z'."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        aware = dt.replace(tzinfo=timezone.utc)
    else:
        aware = dt.astimezone(timezone.utc)
    return aware.strftime("%Y-%m-%dT%H:%M:%SZ")

