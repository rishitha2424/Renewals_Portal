"""
FastAPI router for Custom Columns, Deal Annotations, and Audit history.
All mutating routes require admin context.
"""
from __future__ import annotations

import logging
from typing import Any, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.services.context import UserContext, get_user_context, require_admin_context
from backend.services.annotation_service import (
    AnnotationService,
    ValidationError,
    ConcurrencyError,
)
from backend.services.annotation_backup_service import AnnotationBackupService

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/custom-columns", tags=["custom-columns"])


# Pydantic Schemas
class CreateColumnRequest(BaseModel):
    label: str = Field(..., description="Display label for column")
    type: str = Field(..., description="Column type")
    dropdown_options: Optional[list[str]] = Field(None, description="Options for dropdown type")
    sort_order: Optional[int] = Field(None, description="Display sort order")


class BulkCreateColumnItem(BaseModel):
    label: str = Field(..., description="Display label for column")
    type: str = Field("text", description="Column type")
    dropdown_options: Optional[list[str]] = Field(None, description="Options for dropdown type")


class BulkCreateColumnRequest(BaseModel):
    columns: list[BulkCreateColumnItem] = Field(..., description="List of columns to create")


class UpdateColumnRequest(BaseModel):
    label: Optional[str] = None
    type: Optional[str] = None
    dropdown_options: Optional[list[str]] = None
    sort_order: Optional[int] = None


class RenameColumnRequest(BaseModel):
    label: str = Field(..., description="New display label for column")


class MoveColumnRequest(BaseModel):
    direction: str = Field(..., description="Move direction: 'left' or 'right'")


class SetDealAnnotationRequest(BaseModel):
    value: Any = Field(None, description="Cell value")
    expected_version: Optional[int] = Field(None, description="Version for optimistic concurrency")


def _svc(db: Session = Depends(get_db)) -> AnnotationService:
    return AnnotationService(db)


def _backup_svc(db: Session = Depends(get_db)) -> AnnotationBackupService:
    return AnnotationBackupService(db)


# -----------------------------------------------------------------
# Custom Columns Endpoints (Added Columns Only)
# -----------------------------------------------------------------
@router.get("")
def list_custom_columns(
    include_deleted: bool = Query(False),
    svc: AnnotationService = Depends(_svc),
    ctx: UserContext = Depends(get_user_context),
):
    """List custom columns in sort order."""
    cols = svc.list_columns(include_deleted=include_deleted)
    result = []
    for c in cols:
        d = c.to_dict()
        d["values_count"] = svc.count_column_values(c.key)
        result.append(d)
    return {"columns": result}


@router.post("", dependencies=[Depends(require_admin_context)])
def create_custom_column(
    body: CreateColumnRequest,
    svc: AnnotationService = Depends(_svc),
    ctx: UserContext = Depends(require_admin_context),
):
    """Create a new custom column (Admin only)."""
    try:
        user_id = getattr(ctx, "user_id", "admin") or "admin"
        col = svc.create_column(
            label=body.label,
            col_type=body.type,
            dropdown_options=body.dropdown_options,
            sort_order=body.sort_order,
            user_id=user_id,
        )
        return {"column": col.to_dict()}
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/bulk", dependencies=[Depends(require_admin_context)])
def bulk_create_custom_columns(
    body: BulkCreateColumnRequest,
    svc: AnnotationService = Depends(_svc),
    ctx: UserContext = Depends(require_admin_context),
):
    """Bulk create multiple custom columns at once (Admin only)."""
    try:
        user_id = getattr(ctx, "user_id", "admin") or "admin"
        created = []
        for item in body.columns:
            if not item.label or not item.label.strip():
                continue
            col = svc.create_column(
                label=item.label,
                col_type=item.type,
                dropdown_options=item.dropdown_options,
                user_id=user_id,
            )
            created.append(col.to_dict())
        return {"columns": created}
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.patch("/{column_id}", dependencies=[Depends(require_admin_context)])
def update_custom_column(
    column_id: str,
    body: UpdateColumnRequest,
    svc: AnnotationService = Depends(_svc),
    ctx: UserContext = Depends(require_admin_context),
):
    """Update custom column definition (Admin only)."""
    try:
        user_id = getattr(ctx, "user_id", "admin") or "admin"
        col = svc.update_column(
            col_id_or_key=column_id,
            label=body.label,
            col_type=body.type,
            dropdown_options=body.dropdown_options,
            sort_order=body.sort_order,
            user_id=user_id,
        )
        return {"column": col.to_dict()}
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/{column_id}/rename", dependencies=[Depends(require_admin_context)])
def rename_custom_column(
    column_id: str,
    body: RenameColumnRequest,
    svc: AnnotationService = Depends(_svc),
    ctx: UserContext = Depends(require_admin_context),
):
    """Rename custom column (Admin only)."""
    try:
        user_id = getattr(ctx, "user_id", "admin") or "admin"
        col = svc.rename_column(col_id_or_key=column_id, new_label=body.label, user_id=user_id)
        return {"column": col.to_dict()}
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/{column_id}/move", dependencies=[Depends(require_admin_context)])
def move_custom_column(
    column_id: str,
    body: MoveColumnRequest,
    svc: AnnotationService = Depends(_svc),
    ctx: UserContext = Depends(require_admin_context),
):
    """Move custom column left or right (Admin only)."""
    try:
        user_id = getattr(ctx, "user_id", "admin") or "admin"
        cols = svc.move_column(col_id_or_key=column_id, direction=body.direction, user_id=user_id)
        return {"columns": [c.to_dict() for c in cols]}
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/{column_id}/restore", dependencies=[Depends(require_admin_context)])
def restore_custom_column(
    column_id: str,
    svc: AnnotationService = Depends(_svc),
    ctx: UserContext = Depends(require_admin_context),
):
    """Restore a soft-deleted custom column and its stored values (Admin only)."""
    try:
        user_id = getattr(ctx, "user_id", "admin") or "admin"
        col = svc.restore_column(column_id, user_id=user_id)
        return {"restored": True, "column": col.to_dict()}
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.delete("/{column_id}", dependencies=[Depends(require_admin_context)])
def delete_custom_column(
    column_id: str,
    svc: AnnotationService = Depends(_svc),
    ctx: UserContext = Depends(require_admin_context),
):
    """Soft delete custom column (Admin only)."""
    try:
        user_id = getattr(ctx, "user_id", "admin") or "admin"
        col, n_values = svc.delete_column(column_id, user_id=user_id)
        return {"deleted": True, "column": col.to_dict(), "values_count": n_values}
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get("/audit", dependencies=[Depends(require_admin_context)])
def get_global_audit_log(
    user: Optional[str] = Query(None),
    column: Optional[str] = Query(None),
    deal: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    limit: int = Query(500),
    svc: AnnotationService = Depends(_svc),
    ctx: UserContext = Depends(require_admin_context),
):
    """Global change log table with filters for user, column, deal, date range (Admin only)."""
    entries = svc.get_audit_log(
        user=user,
        column=column,
        deal=deal,
        date_from=date_from,
        date_to=date_to,
        limit=limit,
    )
    return {"audit": entries, "count": len(entries)}


@router.get("/audit/export", dependencies=[Depends(require_admin_context)])
def export_global_audit_log(
    user: Optional[str] = Query(None),
    column: Optional[str] = Query(None),
    deal: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    svc: AnnotationService = Depends(_svc),
    ctx: UserContext = Depends(require_admin_context),
):
    """Download the change log as CSV (Admin only)."""
    import csv
    import io
    entries = svc.get_audit_log(
        user=user,
        column=column,
        deal=deal,
        date_from=date_from,
        date_to=date_to,
        limit=10000,
    )
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "Timestamp (UTC)",
        "User",
        "Deal Account",
        "Deal Name",
        "Opportunity ID",
        "Column",
        "Action",
        "Old Value",
        "New Value",
    ])
    for e in entries:
        writer.writerow([
            e.get("timestamp", ""),
            e.get("user_id", ""),
            e.get("account_name", ""),
            e.get("opportunity_name", ""),
            e.get("opportunity_id_18", ""),
            e.get("column_label", e.get("column_key", "")),
            e.get("action", ""),
            e.get("old_value", ""),
            e.get("new_value", ""),
        ])
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="change_log.csv"'},
    )


# -----------------------------------------------------------------
# Deal Annotations Endpoints
# -----------------------------------------------------------------
@router.get("/deals/{opportunity_id}/annotations")
def get_deal_annotations(
    opportunity_id: str,
    svc: AnnotationService = Depends(_svc),
    ctx: UserContext = Depends(get_user_context),
):
    """Get all annotations for a single deal."""
    annots = svc.get_deal_annotations(opportunity_id)
    return {"opportunity_id_18": opportunity_id, "annotations": annots}


@router.put("/deals/{opportunity_id}/annotations/{column_key}", dependencies=[Depends(require_admin_context)])
def set_deal_annotation(
    opportunity_id: str,
    column_key: str,
    body: SetDealAnnotationRequest,
    svc: AnnotationService = Depends(_svc),
    ctx: UserContext = Depends(require_admin_context),
):
    """Set or update a deal annotation (Admin only)."""
    try:
        user_id = getattr(ctx, "user_id", "admin") or "admin"
        res = svc.set_deal_value(
            opportunity_id_18=opportunity_id,
            column_key=column_key,
            value=body.value,
            user_id=user_id,
            source="app",
            expected_version=body.expected_version,
        )
        return res
    except ConcurrencyError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.delete("/deals/{opportunity_id}/annotations/{column_key}", dependencies=[Depends(require_admin_context)])
def delete_deal_annotation(
    opportunity_id: str,
    column_key: str,
    svc: AnnotationService = Depends(_svc),
    ctx: UserContext = Depends(require_admin_context),
):
    """Clear a deal annotation (Admin only)."""
    try:
        user_id = getattr(ctx, "user_id", "admin") or "admin"
        cleared = svc.delete_deal_value(opportunity_id, column_key, user_id=user_id)
        return {"cleared": cleared, "opportunity_id_18": opportunity_id, "column_key": column_key}
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get("/deals/{opportunity_id}/audit")
def get_deal_audit(
    opportunity_id: str,
    svc: AnnotationService = Depends(_svc),
    ctx: UserContext = Depends(get_user_context),
):
    """Get change audit entries for a deal."""
    entries = svc.get_deal_audit(opportunity_id)
    return {"opportunity_id_18": opportunity_id, "audit": entries}


# -----------------------------------------------------------------
# Safety & Backup Endpoints
# -----------------------------------------------------------------
@router.get("/backup/export", dependencies=[Depends(require_admin_context)])
def export_annotations_backup(
    backup_svc: AnnotationBackupService = Depends(_backup_svc),
    ctx: UserContext = Depends(require_admin_context),
):
    """Admin-only manual export of all annotations data as JSON."""
    payload = backup_svc.dump_annotations_payload()
    return payload


@router.post("/backup/run", dependencies=[Depends(require_admin_context)])
def run_daily_backup(
    backup_svc: AnnotationBackupService = Depends(_backup_svc),
    ctx: UserContext = Depends(require_admin_context),
):
    """Admin-only trigger to run daily backup and prune old backups."""
    filepath = backup_svc.run_daily_backup()
    return {"status": "success", "file": filepath}


@router.get("/export-full-excel")
def export_full_excel(
    snapshot_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    ctx: UserContext = Depends(get_user_context),
):
    """Download full Excel with original columns and custom columns for a snapshot."""
    from backend.services.full_excel_export_service import FullExcelExportService
    svc = FullExcelExportService(db)
    buf, filename = svc.generate_full_excel(snapshot_id=snapshot_id)
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=\"{filename}\""},
    )

