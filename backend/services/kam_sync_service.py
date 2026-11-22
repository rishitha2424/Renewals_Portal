"""
KAM List Upload and Opportunity Owner Synchronization Service (Round 18).
- Flexible column matching for Excel (.xlsx, .xls) and CSV.
- Unicode diacritic & whitespace normalization.
- Near-match suggestions using token similarity.
- Unmapped owner detection -> status pending_email + alert admin.
- Missing owner detection -> alert admin without deleting accounts.
- Duplicate email / duplicate name conflict detection.
"""
from __future__ import annotations

import csv
import io
import logging
import re
import unicodedata
from difflib import SequenceMatcher
from datetime import datetime, timezone
from typing import Optional, Any

import pandas as pd
from sqlalchemy.orm import Session
from sqlalchemy import func

from backend.config import settings
from backend.models.opportunity import Opportunity
from backend.models.snapshot import UploadSnapshot
from backend.models.user import User, UserAlias, OwnerSyncAlert, UserToken
from backend.services.auth_service import create_user_token
from backend.services.audit_service import log_audit_event
from backend.services.mail_service import MailService

log = logging.getLogger(__name__)


def normalize_name(name: Any) -> str:
    """Normalize string: remove diacritics, lowercase, collapse whitespace."""
    if not name or pd.isna(name):
        return ""
    s = str(name).strip()
    # Normalize unicode (decompose accents, e.g. é -> e)
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    # Replace punctuation and collapse spaces
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip().lower()
    return s


def calculate_name_similarity(name1: str, name2: str) -> float:
    """Calculate token-sorted sequence similarity between two names."""
    n1 = normalize_name(name1)
    n2 = normalize_name(name2)
    if not n1 or not n2:
        return 0.0
    if n1 == n2:
        return 1.0

    # Token sort comparison (handles "Smith John" vs "John Smith")
    tokens1 = " ".join(sorted(n1.split()))
    tokens2 = " ".join(sorted(n2.split()))
    if tokens1 == tokens2:
        return 0.95

    return SequenceMatcher(None, tokens1, tokens2).ratio()


def parse_kam_file(content: bytes, filename: str) -> list[dict[str, str]]:
    """Parse CSV or Excel file and extract owner name, email, and optional mobileum_id."""
    df: pd.DataFrame
    fn = filename.lower()
    if fn.endswith(".csv"):
        try:
            df = pd.read_csv(io.BytesIO(content), dtype=str)
        except Exception:
            df = pd.read_csv(io.BytesIO(content), encoding="latin-1", dtype=str)
    elif fn.endswith(".xlsx") or fn.endswith(".xls"):
        df = pd.read_excel(io.BytesIO(content), dtype=str)
    else:
        raise ValueError("Unsupported file format. Please upload an Excel (.xlsx, .xls) or CSV file.")

    # Match column headers flexibly
    col_map = {}
    for col in df.columns:
        norm_col = normalize_name(col)
        if any(k in norm_col for k in ["owner", "kam", "rep", "sales rep", "account manager"]):
            if "email" not in norm_col and "id" not in norm_col:
                col_map["owner_name"] = col
        if any(k in norm_col for k in ["email", "e mail", "mail address", "login"]):
            col_map["email"] = col
        if any(k in norm_col for k in ["mobileum id", "emp id", "employee id", "kam id", "user id"]):
            col_map["mobileum_id"] = col

    if "owner_name" not in col_map or "email" not in col_map:
        raise ValueError(
            f"Required columns not detected. Found columns: {list(df.columns)}. "
            "Please ensure headers include an Owner Name and Email column."
        )

    records = []
    for _, row in df.iterrows():
        raw_name = str(row[col_map["owner_name"]]).strip() if pd.notna(row[col_map["owner_name"]]) else ""
        raw_email = str(row[col_map["email"]]).strip() if pd.notna(row[col_map["email"]]) else ""
        raw_mid = str(row[col_map["mobileum_id"]]).strip() if "mobileum_id" in col_map and pd.notna(row[col_map["mobileum_id"]]) else None

        if raw_name and raw_email and raw_email.lower() != "nan":
            records.append({
                "owner_name": raw_name,
                "email": raw_email.lower(),
                "mobileum_id": raw_mid if raw_mid and raw_mid.lower() != "nan" else None,
            })

    return records


class KamSyncService:
    def __init__(self, db: Session):
        self.db = db

    def sync_uploaded_kam_list(self, kam_records: list[dict[str, str]], actor_email: str = "admin") -> dict[str, Any]:
        """Process an uploaded KAM list and synchronize with existing users."""
        created_count = 0
        updated_count = 0
        conflicts = []

        # Check for duplicates inside the uploaded file
        email_to_names: dict[str, list[str]] = {}
        name_to_emails: dict[str, list[str]] = {}
        for r in kam_records:
            em = r["email"].lower()
            nm = r["owner_name"]
            email_to_names.setdefault(em, []).append(nm)
            name_to_emails.setdefault(nm.lower(), []).append(em)

        for em, names in email_to_names.items():
            if len(set(names)) > 1:
                alert = OwnerSyncAlert(
                    alert_type="duplicate_email",
                    owner_name=", ".join(set(names)),
                    details={"email": em, "names": names},
                    message=f"Duplicate email '{em}' used for multiple owners: {', '.join(set(names))}.",
                )
                self.db.add(alert)
                conflicts.append(alert.message)

        for nm_lower, emails in name_to_emails.items():
            if len(set(emails)) > 1:
                alert = OwnerSyncAlert(
                    alert_type="duplicate_name",
                    owner_name=nm_lower,
                    details={"name": nm_lower, "emails": emails},
                    message=f"Same owner name associated with multiple emails: {', '.join(set(emails))}.",
                )
                self.db.add(alert)
                conflicts.append(alert.message)

        for item in kam_records:
            owner_name = item["owner_name"]
            email = item["email"].lower()
            mobileum_id = item.get("mobileum_id")

            # Check if user exists by email
            user = self.db.query(User).filter(func.lower(User.email) == email).first()
            if not user:
                # Check if an account already exists with this exact owner_name
                user = self.db.query(User).filter(func.lower(User.owner_name) == owner_name.lower()).first()

            if user:
                # Update user details if needed
                changed = False
                if not user.owner_name:
                    user.owner_name = owner_name
                    changed = True
                if email and user.email.lower() != email:
                    user.email = email
                    changed = True
                if mobileum_id and not user.mobileum_id:
                    user.mobileum_id = mobileum_id
                    changed = True
                if user.status == "pending_email":
                    user.status = "invited"
                    changed = True
                if changed:
                    updated_count += 1
            else:
                # Create new KAM account
                user = User(
                    name=owner_name,
                    email=email,
                    role="kam",
                    status="invited",
                    owner_name=owner_name,
                    mobileum_id=mobileum_id,
                    must_change_password=True,
                )
                self.db.add(user)
                self.db.flush()
                # Generate invite token
                raw_token, _ = create_user_token(self.db, user, token_type="invite")
                # Send or queue invite email
                MailService.template_invite(self.db, user, raw_token)
                created_count += 1

        self.db.commit()

        # Run reconciliation against active snapshot
        sync_results = self.run_owner_sync()

        log_audit_event(
            self.db,
            event_type="kam_list_upload",
            user_email=actor_email,
            details={
                "uploaded_records": len(kam_records),
                "created_users": created_count,
                "updated_users": updated_count,
                "conflicts": conflicts,
            },
        )

        return {
            "uploaded": len(kam_records),
            "created": created_count,
            "updated": updated_count,
            "conflicts": conflicts,
            "sync_results": sync_results,
        }

    def run_owner_sync(self, snapshot_id: Optional[str] = None) -> dict[str, Any]:
        """
        Compare unique Opportunity Owner names in the workbook against KAM accounts.
        Automatically run after daily workbook upload or KAM list upload.
        """
        if snapshot_id:
            snap = self.db.query(UploadSnapshot).filter(UploadSnapshot.id == snapshot_id).first()
        else:
            snap = self.db.query(UploadSnapshot).filter(UploadSnapshot.is_active_today == True).first()
            if not snap:
                snap = self.db.query(UploadSnapshot).order_by(UploadSnapshot.snapshot_date.desc()).first()

        if not snap:
            return {"status": "no_snapshot"}

        # Distinct owners from workbook with deal counts
        raw_owner_counts = (
            self.db.query(Opportunity.opportunity_owner, func.count(Opportunity.id))
            .filter(
                Opportunity.snapshot_id == snap.id,
                Opportunity.opportunity_owner != None,
                Opportunity.opportunity_owner != "",
            )
            .group_by(Opportunity.opportunity_owner)
            .all()
        )

        workbook_owners: dict[str, int] = {}
        for own, cnt in raw_owner_counts:
            cleaned = own.strip()
            if cleaned and cleaned.lower() not in ("nan", "none", "unassigned"):
                workbook_owners[cleaned] = cnt

        # Existing KAM users & aliases
        kam_users = self.db.query(User).filter(User.role == "kam").all()
        user_aliases = self.db.query(UserAlias).all()

        alias_map: dict[str, User] = {}
        for ua in user_aliases:
            alias_map[normalize_name(ua.alias_name)] = ua.user

        user_norm_map: dict[str, User] = {}
        for u in kam_users:
            if u.owner_name:
                user_norm_map[normalize_name(u.owner_name)] = u
            if u.name:
                user_norm_map[normalize_name(u.name)] = u

        new_owners_created = []
        near_matches_found = []
        missing_owners_flagged = []

        # 1. Workbook owners check
        for wb_name, deal_count in workbook_owners.items():
            norm_wb = normalize_name(wb_name)

            # Match directly or via alias
            matched_user = user_norm_map.get(norm_wb) or alias_map.get(norm_wb)

            if not matched_user:
                # Check for near-matches
                best_match = None
                best_score = 0.0
                for u in kam_users:
                    score = calculate_name_similarity(wb_name, u.owner_name or u.name or "")
                    if score > best_score and score >= 0.75:
                        best_score = score
                        best_match = u

                if best_match and best_score >= 0.75:
                    near_matches_found.append({
                        "workbook_name": wb_name,
                        "suggested_user_id": str(best_match.id),
                        "suggested_user_name": best_match.name,
                        "similarity": round(best_score, 2),
                        "deal_count": deal_count,
                    })
                    # Create suggestion alert for admin
                    existing_alert = (
                        self.db.query(OwnerSyncAlert)
                        .filter(
                            OwnerSyncAlert.alert_type == "near_match_suggestion",
                            OwnerSyncAlert.owner_name == wb_name,
                            OwnerSyncAlert.is_resolved == False,
                        )
                        .first()
                    )
                    if not existing_alert:
                        alert = OwnerSyncAlert(
                            alert_type="near_match_suggestion",
                            owner_name=wb_name,
                            suggested_user_id=best_match.id,
                            similarity_score=best_score,
                            deal_count=deal_count,
                            message=f"Opportunity owner '{wb_name}' ({deal_count} deals) is similar to existing KAM '{best_match.name}' ({round(best_score*100)}% match). Add as alias?",
                        )
                        self.db.add(alert)
                else:
                    # Unmapped owner without email -> status: pending_email
                    dummy_email = f"pending_{re.sub(r'[^a-zA-Z0-9]', '_', norm_wb)}@mobileum.local"
                    new_user = User(
                        name=wb_name,
                        email=dummy_email,
                        role="kam",
                        status="pending_email",
                        owner_name=wb_name,
                        must_change_password=True,
                    )
                    self.db.add(new_user)
                    self.db.flush()

                    alert = OwnerSyncAlert(
                        alert_type="new_owner_unmapped",
                        owner_name=wb_name,
                        deal_count=deal_count,
                        message=f"New opportunity owner found in upload: {wb_name} ({deal_count} deals). Please add an email address.",
                    )
                    self.db.add(alert)
                    # Trigger admin email alert
                    MailService.template_new_owner_alert(self.db, wb_name, deal_count)
                    new_owners_created.append(wb_name)

        # 2. Check for KAMs in list who have no open deals in current upload
        all_wb_norm = set(normalize_name(n) for n in workbook_owners.keys())
        for u in kam_users:
            u_norm = normalize_name(u.owner_name or u.name or "")
            u_aliases = [normalize_name(a.alias_name) for a in u.aliases] if hasattr(u, "aliases") else []
            has_deals = (u_norm in all_wb_norm) or any(a in all_wb_norm for a in u_aliases)

            if not has_deals and u.status in ("active", "invited"):
                existing_alert = (
                    self.db.query(OwnerSyncAlert)
                    .filter(
                        OwnerSyncAlert.alert_type == "owner_no_open_deals",
                        OwnerSyncAlert.owner_name == u.name,
                        OwnerSyncAlert.is_resolved == False,
                    )
                    .first()
                )
                if not existing_alert:
                    alert = OwnerSyncAlert(
                        alert_type="owner_no_open_deals",
                        owner_name=u.name,
                        message=f"KAM '{u.name}' has no open deals in the latest upload.",
                    )
                    self.db.add(alert)
                    missing_owners_flagged.append(u.name)

        self.db.commit()

        return {
            "snapshot_date": snap.snapshot_date.isoformat(),
            "workbook_owners_count": len(workbook_owners),
            "new_owners_created": new_owners_created,
            "near_matches": near_matches_found,
            "missing_owners": missing_owners_flagged,
        }

    def resolve_alert(self, alert_id: str, action: str, alias_user_id: Optional[str] = None) -> bool:
        """Resolve an owner sync alert (actions: 'dismiss', 'add_alias', 'link_user')."""
        alert = self.db.query(OwnerSyncAlert).filter(OwnerSyncAlert.id == alert_id).first()
        if not alert:
            return False

        if action == "add_alias":
            target_uid = alias_user_id or alert.suggested_user_id
            if target_uid and alert.owner_name:
                alias = UserAlias(user_id=target_uid, alias_name=alert.owner_name)
                self.db.add(alias)
                # If there was a pending_email user with this owner_name, remove the placeholder
                pending_u = self.db.query(User).filter(
                    User.owner_name == alert.owner_name,
                    User.status == "pending_email",
                ).first()
                if pending_u:
                    self.db.delete(pending_u)

        alert.is_resolved = True
        alert.resolved_at = datetime.now(timezone.utc)
        self.db.commit()
        return True

