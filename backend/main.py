"""
FastAPI application entrypoint.
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.config import settings
from backend.routers import snapshots, analytics, opportunities, ai, export, insights, health
from backend.routers import v2_overview, v2_expiry, v2_approvals, v2_business_units, v2_regions, v2_delayed

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Starting up...")
    try:
        from alembic.config import Config
        from alembic import command
        from pathlib import Path
        alembic_cfg = Config(str(Path(__file__).resolve().parent.parent / "alembic.ini"))
        log.info("Applying database migrations (alembic upgrade head)...")
        command.upgrade(alembic_cfg, "head")
        log.info("Database migrations applied successfully.")
    except Exception as e:
        log.warning("Alembic upgrade on startup skipped or failed (%s). Falling back if needed.", e)
    yield
    log.info("Shutting down.")


app = FastAPI(
    title=settings.APP_TITLE,
    version=settings.APP_VERSION,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routes
app.include_router(snapshots.router, prefix="/api")
app.include_router(analytics.router, prefix="/api")
app.include_router(opportunities.router, prefix="/api")
app.include_router(ai.router, prefix="/api")
app.include_router(export.router, prefix="/api")
app.include_router(insights.router, prefix="/api")
app.include_router(health.router)
app.include_router(v2_overview.router)
app.include_router(v2_expiry.router)
app.include_router(v2_approvals.router)
app.include_router(v2_business_units.router)  # has its own /api/v2/overview prefix
app.include_router(v2_regions.router)
app.include_router(v2_delayed.router)

# Direct routes without /api prefix
app.include_router(snapshots.router)
app.include_router(analytics.router)
app.include_router(opportunities.router)
app.include_router(ai.router)
app.include_router(export.router)
app.include_router(insights.router)


# Top-level direct routes matching specification
from fastapi import Query, Form, File, UploadFile, Depends, Request
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.services.context import UserContext, get_user_context

@app.get("/compare", tags=["analytics"])
@app.get("/api/compare", tags=["analytics"])
def compare_direct(
    from_date: str = Query(..., alias="from"),
    to_date: str = Query(..., alias="to"),
    scope: str = Query("renewals"),
    include_deleted_lost: bool = Query(False),
    db: Session = Depends(get_db),
    ctx: UserContext = Depends(get_user_context),
):
    from backend.routers.analytics import compare_dates
    from backend.services.analytics_service import AnalyticsService
    return compare_dates(from_date=from_date, to_date=to_date, scope=scope, include_deleted_lost=include_deleted_lost, svc=AnalyticsService(db), ctx=ctx)

@app.get("/snapshots", tags=["snapshots"])
def snapshots_direct(db: Session = Depends(get_db), ctx: UserContext = Depends(get_user_context)):
    from backend.routers.snapshots import list_snapshots
    return list_snapshots(db=db, ctx=ctx)

@app.post("/upload", tags=["snapshots"])
async def upload_direct(
    snapshot_date: str = Form(...),
    label: str = Form("Today"),
    renewals_summary: UploadFile | None = File(None),
    comparison_tool: UploadFile | None = File(None),
    db: Session = Depends(get_db),
    ctx: UserContext = Depends(get_user_context),
):
    from backend.routers.snapshots import upload_files
    return await upload_files(
        snapshot_date=snapshot_date,
        label=label,
        renewals_summary=renewals_summary,
        comparison_tool=comparison_tool,
        db=db,
        ctx=ctx,
    )


@app.get("/api/health")
def health():
    return {"status": "ok", "version": settings.APP_VERSION}


# Serve frontend static files in production (when dist/ exists)
import os
dist_path = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.isdir(dist_path):
    app.mount("/", StaticFiles(directory=dist_path, html=True), name="frontend")
