from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, Body
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from datetime import date
from typing import Optional, List
import shutil, tempfile
from pathlib import Path

from backend.database import get_db
from backend.services.context import UserContext, get_user_context
from backend.services.ingest_service import IngestService, compute_previous_working_day
from backend.services.analytics_service import AnalyticsService
from backend.models.snapshot import UploadSnapshot, UploadedFile

router = APIRouter(prefix="/snapshots", tags=["snapshots"])


@router.get("")
def list_snapshots(db: Session = Depends(get_db), ctx: UserContext = Depends(get_user_context)):
    snaps = db.query(UploadSnapshot).order_by(UploadSnapshot.snapshot_date.desc()).all()
    return [
        {
            "id": s.id,
            "label": s.label,
            "snapshot_date": s.snapshot_date.isoformat(),
            "yesterday_date": s.yesterday_date.isoformat() if s.yesterday_date else None,
            "row_count": s.row_count,
            "active_row_count": s.active_row_count,
            "is_active_today": s.is_active_today,
            "uploaded_at": s.uploaded_at.isoformat(),
            "source_file_summary": s.source_file_summary,
            "source_file_comparison": s.source_file_comparison,
            "last_week_source": s.last_week_source,
            "last_week_is_partial": s.last_week_is_partial,
            "files": [
                {
                    "slot": f.file_slot,
                    "filename": f.filename,
                    "size_bytes": f.file_size_bytes,
                    "sha256": f.sha256_hash,
                }
                for f in s.uploaded_files
            ],
        }
        for s in snaps
    ]


@router.get("/history")
def upload_history(db: Session = Depends(get_db), ctx: UserContext = Depends(get_user_context)):
    """Return last 10 uploads formatted for history displays."""
    snaps = (
        db.query(UploadSnapshot)
        .order_by(UploadSnapshot.snapshot_date.desc())
        .limit(10)
        .all()
    )
    return [
        {
            "id": s.id,
            "label": s.label,
            "snapshot_date": s.snapshot_date.isoformat(),
            "yesterday_date": s.yesterday_date.isoformat() if s.yesterday_date else None,
            "uploaded_at": s.uploaded_at.isoformat(),
            "row_count": s.row_count,
            "active_row_count": s.active_row_count,
            "is_active_today": s.is_active_today,
            "last_week_source": s.last_week_source or "real_snapshot",
            "last_week_is_partial": s.last_week_is_partial,
            "status": "success",
            "files": [
                {
                    "slot": f.file_slot,
                    "filename": f.filename,
                    "size_bytes": f.file_size_bytes,
                    "sha256": f.sha256_hash,
                }
                for f in s.uploaded_files
            ],
        }
        for s in snaps
    ]


@router.get("/active")
def get_active_snapshot(db: Session = Depends(get_db), ctx: UserContext = Depends(get_user_context)):
    svc = AnalyticsService(db)
    snap = svc.get_active_snapshot(ctx)
    if snap is None:
        raise HTTPException(status_code=404, detail="No active snapshot. Run the seed script first.")
    return {
        "id": snap.id,
        "label": snap.label,
        "snapshot_date": snap.snapshot_date.isoformat(),
        "yesterday_date": snap.yesterday_date.isoformat() if snap.yesterday_date else None,
        "row_count": snap.row_count,
        "active_row_count": snap.active_row_count,
    }


@router.get("/{snapshot_id}")
def get_snapshot(snapshot_id: str, db: Session = Depends(get_db), ctx: UserContext = Depends(get_user_context)):
    snap = db.query(UploadSnapshot).filter(UploadSnapshot.id == snapshot_id).first()
    if not snap:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    return {
        "id": snap.id,
        "label": snap.label,
        "snapshot_date": snap.snapshot_date.isoformat(),
        "yesterday_date": snap.yesterday_date.isoformat() if snap.yesterday_date else None,
        "row_count": snap.row_count,
        "active_row_count": snap.active_row_count,
        "is_active_today": snap.is_active_today,
        "uploaded_at": snap.uploaded_at.isoformat(),
    }


@router.post("/validate")
def validate_upload(
    data_as_of_date: str = Form(...),
    yesterday_date: Optional[str] = Form(None),
    comparison_tool: UploadFile = File(...),
    fiscal_2026: Optional[UploadFile] = File(None),
    fiscal_2027: Optional[UploadFile] = File(None),
    fiscal_q4: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    ctx: UserContext = Depends(get_user_context),
):
    """Validate uploaded files, compute preview metrics and reconciliation warnings. Does NOT save to database."""
    try:
        as_of = date.fromisoformat(data_as_of_date)
    except ValueError:
        raise HTTPException(status_code=422, detail="data_as_of_date must be YYYY-MM-DD")

    if yesterday_date:
        try:
            yest = date.fromisoformat(yesterday_date)
        except ValueError:
            raise HTTPException(status_code=422, detail="yesterday_date must be YYYY-MM-DD")
    else:
        yest = compute_previous_working_day(as_of)

    tmpdir = tempfile.mkdtemp()
    tmp = Path(tmpdir)
    files_dict: dict[str, Path] = {}

    ct_path = tmp / comparison_tool.filename
    with ct_path.open("wb") as f:
        shutil.copyfileobj(comparison_tool.file, f)
    files_dict["comparison_tool"] = ct_path

    if fiscal_2026:
        f26_path = tmp / fiscal_2026.filename
        with f26_path.open("wb") as f:
            shutil.copyfileobj(fiscal_2026.file, f)
        files_dict["fiscal_2026"] = f26_path

    if fiscal_2027:
        f27_path = tmp / fiscal_2027.filename
        with f27_path.open("wb") as f:
            shutil.copyfileobj(fiscal_2027.file, f)
        files_dict["fiscal_2027"] = f27_path

    if fiscal_q4:
        fq4_path = tmp / fiscal_q4.filename
        with fq4_path.open("wb") as f:
            shutil.copyfileobj(fiscal_q4.file, f)
        files_dict["fiscal_q4"] = fq4_path

    svc = IngestService(db)
    try:
        result = svc.validate_upload(ctx, files_dict, as_of, yest)
        return result
    finally:
        # Clean up temporary uploaded files after validate extracts dataframe payloads
        try:
            shutil.rmtree(tmpdir, ignore_errors=True)
        except Exception:
            pass


@router.post("/commit")
def commit_upload(
    session_id: str = Body(..., embed=True),
    replace: bool = Body(False, embed=True),
    make_active: Optional[bool] = Body(None, embed=True),
    db: Session = Depends(get_db),
    ctx: UserContext = Depends(get_user_context),
):
    """Atomic commit of previously validated upload session."""
    svc = IngestService(db)
    try:
        snap = svc.commit_upload(ctx, session_id, replace=replace, make_active=make_active)
        return {
            "status": "ok",
            "snapshot_id": snap.id,
            "snapshot_date": snap.snapshot_date.isoformat(),
            "row_count": snap.row_count,
            "active_row_count": snap.active_row_count,
            "is_active_today": snap.is_active_today,
        }
    except ValueError as exc:
        msg = str(exc)
        if "replace=True" in msg:
            raise HTTPException(status_code=409, detail=msg)
        raise HTTPException(status_code=400, detail=msg)


@router.post("/upload")
async def upload_files_legacy(
    snapshot_date: str = Form(...),
    label: str = Form("Today"),
    renewals_summary: UploadFile | None = File(None),
    comparison_tool: UploadFile | None = File(None),
    db: Session = Depends(get_db),
    ctx: UserContext = Depends(get_user_context),
):
    """Legacy upload endpoint preserved for backward compatibility."""
    if renewals_summary is None and comparison_tool is None:
        raise HTTPException(status_code=422, detail="At least one file is required.")

    try:
        snap_date = date.fromisoformat(snapshot_date)
    except ValueError:
        raise HTTPException(status_code=422, detail="snapshot_date must be YYYY-MM-DD")

    svc = IngestService(db)

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        snap = None
        if renewals_summary:
            rs_path = tmp / renewals_summary.filename
            with rs_path.open("wb") as f:
                shutil.copyfileobj(renewals_summary.file, f)
            snap = svc.ingest_renewals_summary(ctx, rs_path, snap_date, label)

        if comparison_tool:
            ct_path = tmp / comparison_tool.filename
            with ct_path.open("wb") as f:
                shutil.copyfileobj(comparison_tool.file, f)
            if snap is None:
                analytics = AnalyticsService(db)
                snap = analytics.get_snapshot_by_date(ctx, snap_date)
                if snap is None:
                    raise HTTPException(status_code=422, detail="Upload Renewals Summary first for this date.")
            svc.ingest_comparison_tool(ctx, ct_path, snap)

        db.commit()

    return {"status": "ok", "snapshot_id": snap.id if snap else None, "snapshot_date": snap_date.isoformat()}
