"""
FastAPI router for Custom Columns, Deal Annotations, and Audit history.
All mutating routes require admin context.
"""
from __future__ import annotations

import logging
import uuid
from typing import Any, Optional, List
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models.opportunity import Opportunity
from backend.models.custom_column import DealComment
from backend.models.user import CommentMessageHistory
from backend.services.context import (
    UserContext,
    get_user_context,
    require_admin_context,
    require_management_or_admin,
    require_authenticated,
)
from backend.services.audit_service import log_audit_event
from backend.services.delivery_service import (
    resolve_caller_uid,
    resolve_recipients,
    get_latest_opportunities_map,
    is_deal_owned_by_kam,
    run_post_commit_delivery,
)
from backend.utils.time_utils import to_utc_iso
from backend.services.settings_service import SettingsService
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
    visibility: Optional[str] = Field("internal", description="Visibility flag: 'internal' or 'visible_to_owner'")


class BulkCreateColumnItem(BaseModel):
    label: str = Field(..., description="Display label for column")
    type: str = Field("text", description="Column type")
    dropdown_options: Optional[list[str]] = Field(None, description="Options for dropdown type")
    visibility: Optional[str] = Field("internal", description="Visibility flag: 'internal' or 'visible_to_owner'")


class BulkCreateColumnRequest(BaseModel):
    columns: list[BulkCreateColumnItem] = Field(..., description="List of columns to create")


class UpdateColumnRequest(BaseModel):
    label: Optional[str] = None
    type: Optional[str] = None
    dropdown_options: Optional[list[str]] = None
    sort_order: Optional[int] = None
    visibility: Optional[str] = None


class RenameColumnRequest(BaseModel):
    label: str = Field(..., description="New display label for column")


class MoveColumnRequest(BaseModel):
    direction: str = Field(..., description="Move direction: 'left' or 'right'")


class SetDealAnnotationRequest(BaseModel):
    value: Any = Field(None, description="Cell value")
    expected_version: Optional[int] = Field(None, description="Version for optimistic concurrency")


class CreateDealCommentRequest(BaseModel):
    text: str = Field(..., description="Comment text")
    author: Optional[str] = Field(None, description="Author display name")
    visibility: Optional[str] = Field("internal", description="Visibility flag: 'internal' or 'shared' / 'shared_with_owner'")
    recipient_ids: Optional[List[str]] = Field(None, description="Selected recipient user IDs")


class UpdateDealCommentRequest(BaseModel):
    text: str = Field(..., description="Comment text")
    visibility: Optional[str] = None


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
    """List custom columns in sort order (filtered for KAMs to visible_to_owner only)."""
    cols = svc.list_columns(include_deleted=include_deleted, user_context=ctx)
    result = []
    for c in cols:
        d = c.to_dict()
        d["values_count"] = svc.count_column_values(c.key)
        result.append(d)
    return {"columns": result}


@router.post("", dependencies=[Depends(require_management_or_admin)])
def create_custom_column(
    body: CreateColumnRequest,
    svc: AnnotationService = Depends(_svc),
    ctx: UserContext = Depends(require_management_or_admin),
):
    """Create a new custom column (Admin or Management)."""
    try:
        user_id = str(ctx.user_id) if ctx.user_id else "admin"
        user_disp = ctx.display_name or ctx.email or user_id
        col = svc.create_column(
            label=body.label,
            col_type=body.type,
            dropdown_options=body.dropdown_options,
            sort_order=body.sort_order,
            user_id=user_id,
            visibility=body.visibility or "internal",
            creator_role=ctx.role,
            user_display=user_disp,
        )
        return {"column": col.to_dict()}
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/bulk", dependencies=[Depends(require_management_or_admin)])
def bulk_create_custom_columns(
    body: BulkCreateColumnRequest,
    svc: AnnotationService = Depends(_svc),
    ctx: UserContext = Depends(require_management_or_admin),
):
    """Bulk create multiple custom columns at once (Admin or Management)."""
    try:
        user_id = str(ctx.user_id) if ctx.user_id else "admin"
        user_disp = ctx.display_name or ctx.email or user_id
        created = []
        for item in body.columns:
            if not item.label or not item.label.strip():
                continue
            col = svc.create_column(
                label=item.label,
                col_type=item.type,
                dropdown_options=item.dropdown_options,
                user_id=user_id,
                visibility=item.visibility or "internal",
                creator_role=ctx.role,
                user_display=user_disp,
            )
            created.append(col.to_dict())
        return {"columns": created}
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.patch("/{column_id}", dependencies=[Depends(require_management_or_admin)])
def update_custom_column(
    column_id: str,
    body: UpdateColumnRequest,
    svc: AnnotationService = Depends(_svc),
    ctx: UserContext = Depends(require_management_or_admin),
):
    """Update custom column definition (Admin, or Management for their own columns)."""
    try:
        col = svc.get_column_by_id_or_key(column_id, include_deleted=False)
        if not col:
            if svc.is_excel_column(column_id):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Excel columns are read-only and cannot be modified.")
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Column '{column_id}' not found.")

        # Management can only edit columns they created; cannot edit admin-created columns
        if ctx.is_management and not ctx.is_admin:
            if col.creator_role == "admin" or (col.created_by != str(ctx.user_id) and col.creator_role != "management"):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Management users cannot edit admin-created custom columns.",
                )

        user_id = str(ctx.user_id) if ctx.user_id else "admin"
        user_disp = ctx.display_name or ctx.email or user_id
        updated = svc.update_column(
            col_id_or_key=column_id,
            label=body.label,
            col_type=body.type,
            dropdown_options=body.dropdown_options,
            sort_order=body.sort_order,
            user_id=user_id,
            visibility=body.visibility,
            user_role=ctx.role,
            user_display=user_disp,
        )
        return {"column": updated.to_dict()}
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/{column_id}/rename", dependencies=[Depends(require_management_or_admin)])
def rename_custom_column(
    column_id: str,
    body: RenameColumnRequest,
    svc: AnnotationService = Depends(_svc),
    ctx: UserContext = Depends(require_management_or_admin),
):
    """Rename custom column (Admin, or Management for columns they created)."""
    try:
        col = svc.get_column_by_id_or_key(column_id, include_deleted=False)
        if not col:
            if svc.is_excel_column(column_id):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Excel columns are read-only and cannot be modified.")
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Column '{column_id}' not found.")

        if ctx.is_management and not ctx.is_admin:
            if col.creator_role == "admin" or (col.created_by != str(ctx.user_id) and col.creator_role != "management"):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Management users cannot rename admin-created custom columns.",
                )

        user_id = str(ctx.user_id) if ctx.user_id else "admin"
        user_disp = ctx.display_name or ctx.email or user_id
        col_res = svc.rename_column(
            col_id_or_key=column_id,
            new_label=body.label,
            user_id=user_id,
            user_role=ctx.role,
            user_display=user_disp,
        )
        return {"column": col_res.to_dict()}
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/{column_id}/move", dependencies=[Depends(require_management_or_admin)])
def move_custom_column(
    column_id: str,
    body: MoveColumnRequest,
    svc: AnnotationService = Depends(_svc),
    ctx: UserContext = Depends(require_management_or_admin),
):
    """Move custom column left or right (Admin or Management)."""
    try:
        user_id = str(ctx.user_id) if ctx.user_id else "admin"
        user_disp = ctx.display_name or ctx.email or user_id
        cols = svc.move_column(
            col_id_or_key=column_id,
            direction=body.direction,
            user_id=user_id,
            user_role=ctx.role,
            user_display=user_disp,
        )
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


@router.delete("/{column_id}", dependencies=[Depends(require_management_or_admin)])
def delete_custom_column(
    column_id: str,
    svc: AnnotationService = Depends(_svc),
    ctx: UserContext = Depends(require_management_or_admin),
):
    """Soft delete custom column (Admin, or Management for columns they created)."""
    try:
        col = svc.get_column_by_id_or_key(column_id, include_deleted=False)
        if not col:
            if svc.is_excel_column(column_id):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Excel columns are read-only and cannot be modified.")
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Column '{column_id}' not found.")

        if ctx.is_management and not ctx.is_admin:
            if col.creator_role == "admin" or (col.created_by != str(ctx.user_id) and col.creator_role != "management"):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Management users cannot delete admin-created custom columns.",
                )

        user_id = str(ctx.user_id) if ctx.user_id else "admin"
        user_disp = ctx.display_name or ctx.email or user_id
        col_res, n_values = svc.delete_column(
            column_id,
            user_id=user_id,
            user_role=ctx.role,
            user_display=user_disp,
        )
        return {"deleted": True, "column": col_res.to_dict(), "values_count": n_values}
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get("/audit")
def get_global_audit_log(
    user: Optional[str] = Query(None),
    column: Optional[str] = Query(None),
    deal: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    limit: int = Query(500),
    svc: AnnotationService = Depends(_svc),
    ctx: UserContext = Depends(get_user_context),
):
    """Global change log table with filters for user, column, deal, date range."""
    entries = svc.get_audit_log(
        user=user,
        column=column,
        deal=deal,
        date_from=date_from,
        date_to=date_to,
        limit=limit,
    )
    return {"audit": entries, "count": len(entries)}


@router.get("/audit/export", dependencies=[Depends(require_management_or_admin)])
def export_global_audit_log(
    user: Optional[str] = Query(None),
    column: Optional[str] = Query(None),
    deal: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    svc: AnnotationService = Depends(_svc),
    ctx: UserContext = Depends(require_management_or_admin),
):
    """Download the change log as CSV."""
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
    """Get all annotations for a single deal (filtered for KAMs to visible_to_owner only)."""
    if ctx.is_kam:
        opp = svc.db.query(Opportunity).filter(Opportunity.opportunity_id_18 == opportunity_id).first()
        if opp and opp.opportunity_owner not in ctx.all_owner_names:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access forbidden: This deal is not assigned to you.")
    annots = svc.get_deal_annotations(opportunity_id, user_context=ctx)
    return {"opportunity_id_18": opportunity_id, "annotations": annots}


@router.put("/deals/{opportunity_id}/annotations/{column_key}", dependencies=[Depends(require_management_or_admin)])
def set_deal_annotation(
    opportunity_id: str,
    column_key: str,
    body: SetDealAnnotationRequest,
    svc: AnnotationService = Depends(_svc),
    ctx: UserContext = Depends(require_management_or_admin),
):
    """Set or update a deal annotation (Admin or Management; Excel columns read-only)."""
    if svc.is_excel_column(column_key):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Original Excel-derived columns are read-only and cannot be edited.",
        )
    try:
        user_id = str(ctx.user_id) if ctx.user_id else "admin"
        user_disp = ctx.display_name or ctx.email or user_id
        res = svc.set_deal_value(
            opportunity_id_18=opportunity_id,
            column_key=column_key,
            value=body.value,
            user_id=user_id,
            source="app",
            expected_version=body.expected_version,
            user_role=ctx.role,
            user_display=user_disp,
        )
        return res
    except ConcurrencyError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.delete("/deals/{opportunity_id}/annotations/{column_key}", dependencies=[Depends(require_management_or_admin)])
def delete_deal_annotation(
    opportunity_id: str,
    column_key: str,
    svc: AnnotationService = Depends(_svc),
    ctx: UserContext = Depends(require_management_or_admin),
):
    """Clear a deal annotation (Admin or Management; Excel columns read-only)."""
    if svc.is_excel_column(column_key):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Original Excel-derived columns are read-only and cannot be edited.",
        )
    try:
        user_id = str(ctx.user_id) if ctx.user_id else "admin"
        user_disp = ctx.display_name or ctx.email or user_id
        cleared = svc.delete_deal_value(
            opportunity_id,
            column_key,
            user_id=user_id,
            user_role=ctx.role,
            user_display=user_disp,
        )
        return {"cleared": cleared, "opportunity_id_18": opportunity_id, "column_key": column_key}
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


# -----------------------------------------------------------------
# Deal Comments Endpoints
# -----------------------------------------------------------------
@router.get("/deals/{opportunity_id}/comments")
def list_deal_comments(
    opportunity_id: str,
    svc: AnnotationService = Depends(_svc),
    ctx: UserContext = Depends(get_user_context),
):
    """List comments for an opportunity (KAMs see shared + own comments on own deals only)."""
    if ctx.is_kam:
        if not is_deal_owned_by_kam(svc.db, opportunity_id, ctx.all_owner_names):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access forbidden: This deal is not assigned to you.")
    comments = svc.list_comments(opportunity_id, user_context=ctx)
    return {"opportunity_id_18": opportunity_id, "comments": comments}


@router.post("/deals/{opportunity_id}/comments", dependencies=[Depends(require_authenticated)])
def add_deal_comment(
    opportunity_id: str,
    body: CreateDealCommentRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    svc: AnnotationService = Depends(_svc),
    ctx: UserContext = Depends(require_authenticated),
):
    """Add a comment to an opportunity (Admin, Management, or KAM for own deals). Save-first + async delivery."""
    opp_map = get_latest_opportunities_map(db, [opportunity_id])
    opp = opp_map.get(opportunity_id)

    if ctx.is_kam:
        if not is_deal_owned_by_kam(db, opportunity_id, ctx.all_owner_names):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access forbidden: KAMs can only comment on their own opportunities.",
            )
        author_name = ctx.display_name or (opp.opportunity_owner if opp else "Owner")
        vis = "shared_with_owner"
        author_role = "kam"
    else:
        author_name = ctx.display_name or ("Admin" if ctx.is_admin else "Management")
        vis = body.visibility or "internal"
        author_role = ctx.role

    try:
        caller_uid = resolve_caller_uid(db, ctx)
        user_disp = ctx.display_name or ctx.email or author_name

        resolved = resolve_recipients(
            db=db,
            caller_uid=caller_uid,
            caller_role=author_role,
            raw_recipient_ids=body.recipient_ids,
            deal_ids=[opportunity_id],
            kind="comment",
            visibility=vis,
        )

        batch_id = str(uuid.uuid4())
        comment = svc.add_comment(
            opportunity_id_18=opportunity_id,
            text=body.text,
            author=author_name,
            user_id=caller_uid,
            visibility=vis,
            author_role=author_role,
            user_display=user_disp,
            recipient_ids=resolved.recipient_ids,
            batch_id=batch_id,
        )

        deal_title = opp.opportunity_name if opp else opportunity_id
        short_deal = (deal_title or opportunity_id)[:40]
        background_tasks.add_task(
            run_post_commit_delivery,
            bind_engine=db.get_bind(),
            event_type="comment",
            entity_type="deal_comment",
            entity_id=comment.get("id", ""),
            author_id=caller_uid,
            author_name=author_name,
            author_role=author_role,
            author_email=ctx.email or "",
            subject=f"New comment: {short_deal}",
            body_text=body.text.strip(),
            deal_id=opportunity_id,
            deal_name=deal_title,
            account_name=opp.account_name if opp else None,
            acv_amount=float(opp.forecast_acv_amount or 0.0) if (opp and opp.forecast_acv_amount is not None) else None,
            recipient_user_ids=resolved.recipient_ids,
            recipient_summary=resolved.summary_admin,
            audit_event_type="comment_created",
            audit_details={
                "comment_id": comment.get("id"),
                "deal_id": opportunity_id,
                "visibility": comment.get("visibility"),
                "recipient_count": len(resolved.recipient_ids),
            },
        )

        return {"comment": comment}
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.put("/deals/{opportunity_id}/comments/{comment_id}", dependencies=[Depends(require_authenticated)])
def update_deal_comment(
    opportunity_id: str,
    comment_id: str,
    body: UpdateDealCommentRequest,
    db: Session = Depends(get_db),
    svc: AnnotationService = Depends(_svc),
    ctx: UserContext = Depends(require_authenticated),
):
    """Edit own comment (Author only; editing does not send new emails)."""
    comment = db.query(DealComment).filter(DealComment.id == comment_id, DealComment.is_deleted == False).first()
    if not comment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found.")

    caller_uid = resolve_caller_uid(db, ctx)
    is_author = (
        str(comment.author_id) == str(caller_uid)
        or str(comment.author_id) == str(ctx.user_id)
        or (ctx.is_owner and str(comment.author_id) == "admin")
    )
    if not is_author:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the comment author can edit this comment.",
        )

    try:
        user_disp = ctx.display_name or ctx.email or caller_uid
        old_text = comment.text
        res = svc.update_comment(
            comment_id=comment_id,
            text=body.text,
            user_id=caller_uid,
            visibility=body.visibility,
            user_role=ctx.role,
            user_display=user_disp,
        )
        log_audit_event(
            db,
            "comment_edited",
            user_id=caller_uid,
            user_email=ctx.email,
            details={
                "comment_id": comment_id,
                "deal_id": opportunity_id,
                "old_length": len(old_text or ""),
                "new_length": len(body.text.strip()),
            },
        )
        return {"comment": res}
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.delete("/deals/{opportunity_id}/comments/{comment_id}", dependencies=[Depends(require_authenticated)])
def delete_deal_comment(
    opportunity_id: str,
    comment_id: str,
    db: Session = Depends(get_db),
    svc: AnnotationService = Depends(_svc),
    ctx: UserContext = Depends(require_authenticated),
):
    """Unsend / remove a comment (Author can unsend own comment; Admin can remove any comment)."""
    comment = db.query(DealComment).filter(DealComment.id == comment_id, DealComment.is_deleted == False).first()
    if not comment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found.")

    caller_uid = resolve_caller_uid(db, ctx)
    is_author = (
        str(comment.author_id) == str(caller_uid)
        or str(comment.author_id) == str(ctx.user_id)
        or (comment.author and ctx.display_name and comment.author == ctx.display_name)
    )
    if not ctx.is_admin and not is_author:
        if ctx.is_management and (comment.author_role == "admin" or not comment.author_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Management users cannot delete admin-created comments.",
            )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"{ctx.role.capitalize()} users can only delete their own comments.",
        )

    try:
        user_disp = ctx.display_name or ctx.email or caller_uid
        deleted = svc.delete_comment(
            comment_id=comment_id,
            user_id=caller_uid,
            user_role=ctx.role,
            user_display=user_disp,
        )
        log_audit_event(
            db,
            "comment_deleted",
            user_id=caller_uid,
            user_email=ctx.email,
            details={"comment_id": comment_id, "deal_id": opportunity_id, "actor_role": ctx.role},
        )
        return {"deleted": deleted, "comment_id": comment_id}
    except ValidationError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get("/deals/{opportunity_id}/comments/{comment_id}/history", dependencies=[Depends(require_admin_context)])
def get_deal_comment_history(
    opportunity_id: str,
    comment_id: str,
    db: Session = Depends(get_db),
    ctx: UserContext = Depends(require_admin_context),
):
    """Admin-only edit/unsend version history for a comment."""
    comment = db.query(DealComment).filter(
        DealComment.id == comment_id,
        DealComment.opportunity_id_18 == opportunity_id,
    ).first()
    if not comment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found.")

    rows = (
        db.query(CommentMessageHistory)
        .filter(
            CommentMessageHistory.entity_type == "deal_comment",
            CommentMessageHistory.entity_id == comment_id,
        )
        .order_by(CommentMessageHistory.created_at.desc())
        .all()
    )
    return {
        "comment_id": comment_id,
        "history": [
            {
                "id": r.id,
                "action": r.action,
                "previous_text": r.previous_text,
                "new_text": r.new_text,
                "previous_visibility": r.previous_visibility,
                "new_visibility": r.new_visibility,
                "actor_name": r.actor_name or "Admin",
                "actor_role": r.actor_role or "admin",
                "created_at": to_utc_iso(r.created_at),
            }
            for r in rows
        ],
    }


@router.get("/deals/{opportunity_id}/audit")
def get_deal_audit(
    opportunity_id: str,
    svc: AnnotationService = Depends(_svc),
    ctx: UserContext = Depends(get_user_context),
):
    """Get change audit entries for a deal (KAM restricted to own deals & non-internal entries)."""
    if ctx.is_kam:
        if not is_deal_owned_by_kam(svc.db, opportunity_id, ctx.all_owner_names):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access forbidden: This deal is not assigned to you.")
    entries = svc.get_deal_audit(opportunity_id, is_kam=ctx.is_kam)
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


@router.get("/export-full-excel", dependencies=[Depends(require_management_or_admin)])
def export_full_excel(
    snapshot_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    ctx: UserContext = Depends(require_management_or_admin),
):
    """Download full Excel with original columns and custom columns for a snapshot."""
    from backend.services.full_excel_export_service import FullExcelExportService
    svc = FullExcelExportService(db)
    buf, filename, _ = svc.generate_export(snapshot_id=snapshot_id, export_format="xlsx", user_context=ctx)
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=\"{filename}\""},
    )

