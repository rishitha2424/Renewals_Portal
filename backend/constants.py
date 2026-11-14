"""Shared system constants and normalizers for Horizon Renewals Intelligence."""
from __future__ import annotations
import re

MISSING_FORECAST_CATEGORY = "Not yet proposed"
MISSING_APPROVAL_STATUS = "Not submitted"

def normalize_forecast_category(val: str | None) -> str:
    """Normalize forecast category string:
    - trim, case-insensitively collapses whitespace, underscores, hyphens
    - blanks/none/unassigned -> 'Not yet proposed'
    """
    if val is None:
        return MISSING_FORECAST_CATEGORY
    s = str(val).strip()
    if not s:
        return MISSING_FORECAST_CATEGORY
    cleaned = re.sub(r"[\s\-_]+", " ", s)
    cleaned_lower = cleaned.lower()
    if cleaned_lower in ("blank", "(blank)", "none", "unassigned", "null", "nan"):
        return MISSING_FORECAST_CATEGORY
    if cleaned_lower in ("not yet proposed", "not-yet-proposed", "notyetproposed"):
        return MISSING_FORECAST_CATEGORY
    if cleaned_lower == "closed":
        return "Closed"
    if cleaned_lower in ("commit", "committed"):
        return "Commit"
    if cleaned_lower in ("best case", "bestcase"):
        return "Best Case"
    if cleaned_lower == "pipeline":
        return "Pipeline"
    return cleaned.title()

def normalize_approval_status(val: str | None) -> str:
    """Normalize opportunity approval status string:
    - trim, case-insensitively collapses whitespace, underscores, hyphens
    - blanks/none/unassigned -> 'Not submitted'
    """
    if val is None:
        return MISSING_APPROVAL_STATUS
    s = str(val).strip()
    if not s:
        return MISSING_APPROVAL_STATUS
    cleaned = re.sub(r"[\s\-_]+", " ", s)
    cleaned_lower = cleaned.lower()
    if cleaned_lower in ("blank", "(blank)", "none", "unassigned", "null", "nan"):
        return MISSING_APPROVAL_STATUS
    if cleaned_lower in ("not submitted", "not-submitted", "notsubmitted"):
        return MISSING_APPROVAL_STATUS
    if cleaned_lower in ("approved", "approve"):
        return "Approved"
    if cleaned_lower in ("pending approval", "pending", "pending_approval", "pending-approval"):
        return "Pending Approval"
    if cleaned_lower in ("rejected", "reject"):
        return "Rejected"
    return cleaned.title()

