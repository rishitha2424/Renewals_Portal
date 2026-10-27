from fastapi import APIRouter, Depends, Body
from sqlalchemy.orm import Session
from typing import Any
from pydantic import BaseModel

from backend.database import get_db
from backend.services.settings_service import SettingsService
from backend.services.context import UserContext, get_user_context
from backend.models.opportunity import Opportunity
from backend.models.snapshot import UploadSnapshot

router = APIRouter(prefix="/api/settings", tags=["Settings"])


class SettingUpdatePayload(BaseModel):
    key: str
    value: str
    description: str | None = None


@router.get("")
def get_all_settings(
    db: Session = Depends(get_db),
    ctx: UserContext = Depends(get_user_context),
):
    # Detect available groups from active snapshot's opportunities
    available_groups: list[str] = []
    active_snap = db.query(UploadSnapshot).filter(UploadSnapshot.is_active_today == True).first()
    if not active_snap:
        active_snap = db.query(UploadSnapshot).order_by(UploadSnapshot.snapshot_date.desc()).first()

    if active_snap:
        opps = db.query(Opportunity).filter(Opportunity.snapshot_id == active_snap.id).all()
        groups_set: set[str] = set()
        for o in opps:
            if o.extra_attributes and isinstance(o.extra_attributes, dict):
                g = o.extra_attributes.get("Group") or o.extra_attributes.get("group")
                if g and str(g).strip() and str(g).strip().lower() not in ("nan", "none"):
                    groups_set.add(str(g).strip())
        available_groups = sorted(list(groups_set))

    return SettingsService.get_all_settings(db, available_groups=available_groups)


@router.put("")
def update_setting(
    payload: SettingUpdatePayload = Body(...),
    db: Session = Depends(get_db),
    ctx: UserContext = Depends(get_user_context),
):
    updated = SettingsService.set_setting(
        db, key=payload.key, value=payload.value, description=payload.description
    )
    return {"key": updated.key, "value": updated.value, "updated_at": updated.updated_at.isoformat()}
