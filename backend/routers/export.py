"""
Export router — provides PowerPoint (.pptx) and Excel (.xlsx) report downloads.
"""
from typing import Optional, List
from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.services.context import UserContext, get_user_context
from backend.services.pptx_export_service import PptxExportService
from backend.services.excel_export_service import ExcelExportService

router = APIRouter(prefix="/export", tags=["export"])


def _parse_types_param(types: Optional[List[str]], types_bracket: Optional[List[str]]) -> Optional[List[str]]:
    raw = types if types is not None else types_bracket
    if raw is None:
        return None
    res = []
    for item in raw:
        for part in str(item).split(","):
            p = part.strip()
            if p:
                res.append(p)
    return res if res else None


@router.get("/pptx")
def export_pptx(
    snapshot_id: str | None = Query(None, description="Snapshot ID or ISO date to export"),
    compare_to: str | None = Query(None, description="Comparison snapshot ID or ISO date"),
    scope: str = Query("renewals", description="Scope filter: renewals (default) | full"),
    include_deleted_lost: bool = Query(False, description="Include Deleted and Lost"),
    types: Optional[List[str]] = Query(None),
    types_bracket: Optional[List[str]] = Query(None, alias="types[]"),
    db: Session = Depends(get_db),
    ctx: UserContext = Depends(get_user_context),
):
    """
    Generate and stream PowerPoint presentation (.pptx) populated with renewals data.
    """
    try:
        eff_types = _parse_types_param(types, types_bracket)
        svc = PptxExportService(db)
        buf, filename = svc.generate_pptx(
            snapshot_id=snapshot_id,
            compare_to=compare_to,
            scope=scope,
            include_deleted_lost=include_deleted_lost,
            types=eff_types,
        )
        return StreamingResponse(
            buf,
            media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Access-Control-Expose-Headers": "Content-Disposition",
            },
        )
    except Exception as exc:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to generate PowerPoint export: {str(exc)}")


@router.get("/excel")
def export_excel(
    snapshot_id: str | None = Query(None, description="Snapshot ID or ISO date to export"),
    compare_to: str | None = Query(None, description="Comparison snapshot ID or ISO date"),
    scope: str = Query("renewals", description="Scope filter: renewals (default) | full"),
    include_deleted_lost: bool = Query(False, description="Include Deleted and Lost"),
    types: Optional[List[str]] = Query(None),
    types_bracket: Optional[List[str]] = Query(None, alias="types[]"),
    db: Session = Depends(get_db),
    ctx: UserContext = Depends(get_user_context),
):
    """
    Generate and stream multi-sheet formatted Excel workbook (.xlsx).
    """
    try:
        eff_types = _parse_types_param(types, types_bracket)
        svc = ExcelExportService(db)
        buf, filename = svc.generate_excel(
            snapshot_id=snapshot_id,
            compare_to=compare_to,
            scope=scope,
            include_deleted_lost=include_deleted_lost,
            types=eff_types,
        )
        return StreamingResponse(
            buf,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Access-Control-Expose-Headers": "Content-Disposition",
            },
        )
    except Exception as exc:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to generate Excel export: {str(exc)}")
