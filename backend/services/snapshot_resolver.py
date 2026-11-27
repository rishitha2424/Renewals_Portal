"""
Canonical snapshot resolution helper for `as_of` parameters across routers and services.
Always decides first whether `as_of` is an ISO date (YYYY-MM-DD -> parsed `date` object)
or a snapshot ID/UUID, so PostgreSQL never receives a `VARCHAR` vs `DATE` comparison.
"""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Optional

from sqlalchemy.orm import Session

from backend.models.snapshot import UploadSnapshot

_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def parse_as_of_date(as_of: str | date | datetime | None) -> Optional[date]:
    """Parse an ISO YYYY-MM-DD date (or date/datetime instance) safely; returns None for IDs/UUIDs."""
    if as_of is None:
        return None
    if isinstance(as_of, datetime):
        return as_of.date()
    if isinstance(as_of, date):
        return as_of
    raw = str(as_of).strip()
    if not raw or not _ISO_DATE_RE.match(raw):
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return None


def resolve_snapshot(
    db: Session,
    as_of: str | date | datetime | None = None,
    *,
    lte_on_date: bool = True,
    fallback_to_active: bool = True,
    fallback_to_latest: bool = True,
) -> Optional[UploadSnapshot]:
    """
    Resolve an UploadSnapshot safely for both SQLite and PostgreSQL:
    1. If `as_of` is a `date` or ISO `YYYY-MM-DD` string: parse to `datetime.date` and compare
       against `UploadSnapshot.snapshot_date` using a real `date` object (exact match first,
       then `<= parsed_date` if `lte_on_date=True`).
    2. Otherwise if `as_of` is non-empty (snapshot UUID / ID): query ONLY `UploadSnapshot.id == raw`.
    3. When `as_of` is empty/None: return active-today snapshot (if `fallback_to_active=True`),
       falling back to latest by `snapshot_date` (if `fallback_to_latest=True`).
    """
    q = db.query(UploadSnapshot)

    if as_of is not None and (isinstance(as_of, date) or str(as_of).strip() != ""):
        parsed_d = parse_as_of_date(as_of)
        if parsed_d is not None:
            exact = q.filter(UploadSnapshot.snapshot_date == parsed_d).first()
            if exact:
                return exact
            if lte_on_date:
                return (
                    q.filter(UploadSnapshot.snapshot_date <= parsed_d)
                    .order_by(UploadSnapshot.snapshot_date.desc())
                    .first()
                )
            return None

        raw_id = str(as_of).strip()
        by_id = q.filter(UploadSnapshot.id == raw_id).first()
        if by_id:
            return by_id
        return None

    snap = None
    if fallback_to_active:
        snap = (
            q.filter(UploadSnapshot.is_active_today.is_(True))
            .order_by(UploadSnapshot.snapshot_date.desc())
            .first()
        )
    if not snap and fallback_to_latest:
        snap = q.order_by(UploadSnapshot.snapshot_date.desc()).first()
    return snap

