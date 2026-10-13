"""
Explorer Router — /v2/explorer/... and /api/v2/explorer/...
Endpoints:
- GET /v2/explorer/columns?as_of=
- POST /v2/explorer/rows
- POST /v2/explorer/export
- GET /v2/explorer/reconcile?as_of=
- GET /v2/explorer/quick-filters?as_of=
"""
from typing import Optional, Any, Dict, List
from fastapi import APIRouter, Depends, Query, HTTPException, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.services.explorer_service import (
    ExplorerService,
    ExplorerRowsRequest,
    ExplorerExportRequest,
)

router = APIRouter(prefix="/v2/explorer", tags=["v2-explorer"])


@router.get("/columns")
def get_explorer_columns(
    as_of: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    svc = ExplorerService(db)
    snap = svc.resolve_snapshot(as_of)
    if not snap:
        raise HTTPException(status_code=404, detail="No snapshot found for requested as_of date.")
    columns = svc.get_columns_meta(snap)
    return {
        "snapshot_id": snap.id,
        "snapshot_date": snap.snapshot_date.isoformat(),
        "total_columns": len(columns),
        "columns": columns,
    }


@router.post("/rows")
def get_explorer_rows(
    payload: ExplorerRowsRequest,
    as_of: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    svc = ExplorerService(db)
    resolved_as_of = as_of or (payload.filter_spec.as_of if payload.filter_spec else None)
    snap = svc.resolve_snapshot(resolved_as_of)
    if not snap:
        raise HTTPException(status_code=404, detail="No snapshot found.")

    rows, total_count, total_acv = svc.query_rows(
        snap=snap,
        filter_spec=payload.filter_spec,
        filters=payload.filters,
        or_filters=payload.or_filters,
        sort=payload.sort,
        sort_dir=payload.sort_dir,
        page=payload.page,
        page_size=payload.page_size,
    )

    return {
        "snapshot_id": snap.id,
        "snapshot_date": snap.snapshot_date.isoformat(),
        "page": payload.page,
        "page_size": payload.page_size,
        "total_count": total_count,
        "total_acv": total_acv,
        "rows": rows,
    }


@router.post("/export")
def export_explorer_data(
    payload: ExplorerExportRequest,
    as_of: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    svc = ExplorerService(db)
    resolved_as_of = as_of or (payload.filter_spec.as_of if payload.filter_spec else None)
    snap = svc.resolve_snapshot(resolved_as_of)
    if not snap:
        raise HTTPException(status_code=404, detail="No snapshot found.")

    try:
        buf, filename, media_type = svc.export_data(
            snap=snap,
            filter_spec=payload.filter_spec,
            filters=payload.filters,
            or_filters=payload.or_filters,
            sort=payload.sort,
            sort_dir=payload.sort_dir,
            export_format=payload.format,
            row_cap=10000,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return StreamingResponse(
        buf,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )


@router.get("/reconcile")
def reconcile_explorer(
    as_of: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    svc = ExplorerService(db)
    snap = svc.resolve_snapshot(as_of)
    if not snap:
        raise HTTPException(status_code=404, detail="No snapshot found.")
    return svc.reconcile_renewals(snap)


@router.get("/quick-filters")
def get_quick_filters(
    as_of: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    svc = ExplorerService(db)
    snap = svc.resolve_snapshot(as_of)
    if not snap:
        raise HTTPException(status_code=404, detail="No snapshot found.")
    return svc.get_quick_filter_options(snap)
