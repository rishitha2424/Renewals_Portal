"""
FastAPI application entrypoint.
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.config import settings
from backend.routers import snapshots, analytics, opportunities, export, health, admin_auth, settings as system_settings_router, custom_columns
from backend.routers import v2_overview, v2_expiry, v2_approvals, v2_business_units, v2_regions, v2_delayed, v2_filters, v2_explorer
from backend.routers import auth, admin_users, messages, email_admin, kam, search, notifications, comments, sso_auth, admin_sso

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Starting up...")
    # Ensure required application and storage directories exist
    from pathlib import Path
    for d in [
        settings.DATA_DIR,
        settings.DATA_DIR / "backups" / "annotations",
        Path("uploads"),
        Path("scratch"),
    ]:
        try:
            d.mkdir(parents=True, exist_ok=True)
        except Exception as exc:
            log.warning("Could not create directory %s: %s", d, exc)

    from backend.database import engine
    dialect = getattr(engine.dialect, "name", "sqlite")
    is_postgres = dialect == "postgresql"
    try:
        from alembic.config import Config
        from alembic import command
        from pathlib import Path
        alembic_cfg = Config(str(Path(__file__).resolve().parent.parent / "alembic.ini"))
        log.info("Applying database migrations (alembic upgrade head)...")
        command.upgrade(alembic_cfg, "head")
        log.info("Database migrations applied successfully.")
        migrations_status = "migrations at head"
    except Exception as e:
        import traceback
        tb_str = traceback.format_exc()
        log.error("DATABASE MIGRATION ERROR ON STARTUP:\n%s", tb_str)
        if is_postgres:
            log.critical(
                "FATAL: Database migration failed on PostgreSQL: %s\n"
                "Halting startup with full traceback:\n%s",
                e, tb_str
            )
            raise RuntimeError(f"Database migration failed on PostgreSQL: {e}\n\nFull traceback:\n{tb_str}") from e
        else:
            log.warning("Falling back to Base.metadata.create_all on SQLite (%s)...", e)
            from backend.database import Base
            Base.metadata.create_all(bind=engine)
            migrations_status = "fallback to create_all"

    # Defensive self-healing schema check: ensure all model columns exist on existing tables
    try:
        from sqlalchemy import inspect, text
        from backend.database import Base
        inspector = inspect(engine)
        for table_name, table in Base.metadata.tables.items():
            if inspector.has_table(table_name):
                existing_cols = {c["name"] for c in inspector.get_columns(table_name)}
                for col in table.columns:
                    if col.name not in existing_cols:
                        col_type = col.type.compile(engine.dialect)
                        log.info("Auto-migrating missing column %s.%s (%s)", table_name, col.name, col_type)
                        with engine.begin() as conn:
                            conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {col.name} {col_type}"))
        with engine.begin() as conn:
            conn.execute(text("UPDATE opportunities SET is_reconciliation_entry = 0 WHERE is_reconciliation_entry IS NULL"))
    except Exception as exc:
        log.warning("Self-healing column migration check warning: %s", exc)

    # Startup log: on boot, log one line such as Database: postgresql @ localhost:5432/renewals (migrations at head).
    try:
        from urllib.parse import urlparse
        db_url_parsed = urlparse(settings.DATABASE_URL)
        if dialect == "sqlite":
            db_target = db_url_parsed.path or settings.DATABASE_URL.replace("sqlite:///", "")
            log.info(f"Database: sqlite @ {db_target} ({migrations_status})")
        else:
            host = db_url_parsed.hostname or "localhost"
            port = db_url_parsed.port or 5432
            dbname = db_url_parsed.path.lstrip("/")
            log.info(f"Database: {dialect} @ {host}:{port}/{dbname} ({migrations_status})")
    except Exception as log_err:
        log.info(f"Database: {dialect} ({migrations_status})")

    # Seed default user accounts (admin owner and management)
    try:
        from backend.database import SessionLocal
        from backend.services.auth_service import ensure_default_accounts
        with SessionLocal() as db_init:
            ensure_default_accounts(db_init)
    except Exception as exc:
        log.warning("Could not seed default accounts on startup: %s", exc)

    # Security check on startup
    from backend.routers.admin_auth import get_security_warnings
    sec_warnings = get_security_warnings()
    for w in sec_warnings:
        log.warning("SECURITY WARNING: %s (Set appropriate environment variables in deployment)", w)

    # Scheduled daily annotation backup worker (disabled under tests)
    import asyncio
    import os
    is_testing = (
        getattr(settings, "TESTING", False)
        or os.environ.get("TESTING", "").lower() in ("1", "true", "yes")
        or "PYTEST_CURRENT_TEST" in os.environ
    )

    backup_task = None
    if not is_testing:
        async def scheduled_annotation_backup_worker():
            while True:
                try:
                    from backend.database import SessionLocal
                    from backend.services.annotation_backup_service import AnnotationBackupService
                    db_sess = SessionLocal()
                    try:
                        b_svc = AnnotationBackupService(db_sess)
                        b_path = b_svc.run_daily_backup()
                        log.info("Daily annotation backup scheduled job completed: %s", b_path)
                    finally:
                        db_sess.close()
                except Exception as exc:
                    log.warning("Scheduled daily annotation backup error: %s", exc)
                # Sleep 24 hours
                await asyncio.sleep(86400)

        backup_task = asyncio.create_task(scheduled_annotation_backup_worker())

    yield

    if backup_task:
        backup_task.cancel()
        try:
            await backup_task
        except (asyncio.CancelledError, Exception):
            pass
    log.info("Shutting down.")


app = FastAPI(
    title=settings.APP_TITLE,
    version=settings.APP_VERSION,
    lifespan=lifespan,
)

cors_origins = settings.CORS_ORIGINS if isinstance(settings.CORS_ORIGINS, list) else ["*"]
allow_all = "*" in cors_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if allow_all else cors_origins,
    allow_origin_regex=r"^https?://.*$" if allow_all else None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

EXEMPT_API_PATHS = {
    "/api/health",
    "/api/health/db",
    "/health",
    "/api/auth/login",
    "/api/admin/login",
    "/api/auth/logout",
    "/api/admin/logout",
    "/api/admin/status",
    "/api/auth/forgot-password",
    "/api/auth/reset-password",
    "/api/auth/verify-reset-token",
    "/api/auth/verify-invite-token",
    "/api/auth/set-password",
    "/api/auth/invite/verify",
    "/api/auth/invite/set-password",
    "/api/auth/sso/config",
    "/api/auth/sso/login",
    "/api/auth/sso/callback",
    "/docs",
    "/redoc",
    "/openapi.json",
}


class AuthenticationRequiredMiddleware:
    """
    Round 19: Universal Authentication Enforcement Middleware.
    Enforces login required for all /api/* routes.
    Returns HTTP 401 Unauthorized for anonymous requests.
    Streaming and file downloads remain completely unaffected (pure ASGI passthrough).
    """
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        path: str = scope.get("path", "")
        method: str = scope.get("method", "GET")

        # Allow CORS preflight requests
        if method == "OPTIONS":
            return await self.app(scope, receive, send)

        # Allow non-API routes (static files, index.html, spa assets, /health)
        if not path.startswith("/api/"):
            return await self.app(scope, receive, send)

        clean_path = path.rstrip("/")
        if clean_path in EXEMPT_API_PATHS or path in EXEMPT_API_PATHS:
            return await self.app(scope, receive, send)

        # Extract token from headers or cookies
        token = None
        headers = dict(scope.get("headers", []))
        auth_header = headers.get(b"authorization")
        if auth_header:
            auth_val = auth_header.decode("latin1").strip()
            if auth_val.lower().startswith("bearer "):
                token = auth_val[7:].strip()

        if not token:
            cookie_header = headers.get(b"cookie")
            if cookie_header:
                cookie_str = cookie_header.decode("latin1")
                for c in cookie_str.split(";"):
                    c = c.strip()
                    if c.startswith("auth_token="):
                        token = c.split("=", 1)[1].strip()
                        break
                    elif c.startswith("admin_token="):
                        token = c.split("=", 1)[1].strip()
                        break

        # Validate token signature and expiry
        is_valid = False
        if token:
            from backend.services.auth_service import decode_session_token
            from backend.services.context import decode_admin_token
            if decode_session_token(token) or decode_admin_token(token):
                is_valid = True

        if not is_valid:
            response_body = b'{"detail": "Authentication required. Please log in."}'
            response_headers = [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(response_body)).encode("ascii")),
                (b"www-authenticate", b"Bearer"),
            ]
            await send({
                "type": "http.response.start",
                "status": 401,
                "headers": response_headers,
            })
            await send({
                "type": "http.response.body",
                "body": response_body,
                "more_body": False,
            })
            return

        return await self.app(scope, receive, send)


app.add_middleware(AuthenticationRequiredMiddleware)

# API routes (Mounted exactly once under /api)
app.include_router(snapshots.router, prefix="/api")
app.include_router(analytics.router, prefix="/api")
app.include_router(opportunities.router, prefix="/api")
app.include_router(export.router, prefix="/api")
app.include_router(admin_auth.router, prefix="/api")
app.include_router(auth.router)
app.include_router(admin_users.router)
app.include_router(messages.router)
app.include_router(notifications.router)
app.include_router(email_admin.router, prefix="/api/admin/email")
app.include_router(email_admin.router, prefix="/api/email-admin")
app.include_router(kam.router)
app.include_router(search.router)
app.include_router(health.router)
app.include_router(v2_overview.router)
app.include_router(v2_expiry.router)
app.include_router(v2_approvals.router)
app.include_router(v2_business_units.router)
app.include_router(v2_regions.router)
app.include_router(v2_delayed.router)
app.include_router(v2_filters.router)
app.include_router(v2_explorer.router)
app.include_router(system_settings_router.router)
app.include_router(custom_columns.router)
app.include_router(comments.router)
app.include_router(sso_auth.router, prefix="/api")
app.include_router(admin_sso.router, prefix="/api")

from fastapi import Query, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text
from backend.database import get_db
from backend.services.context import UserContext, get_user_context

@app.get("/api/compare", tags=["analytics"])
def compare_api(
    from_date: str = Query(..., alias="from"),
    to_date: str = Query(..., alias="to"),
    scope: str = Query("renewals"),
    include_deleted_lost: bool = Query(False),
    db: Session = Depends(get_db),
    ctx: UserContext = Depends(get_user_context),
):
    from backend.routers.analytics import compare_dates
    from backend.services.analytics_service import AnalyticsService
    return compare_dates(
        from_date=from_date,
        to_date=to_date,
        scope=scope,
        include_deleted_lost=include_deleted_lost,
        svc=AnalyticsService(db),
        ctx=ctx,
    )



@app.get("/health", tags=["health"])
@app.get("/api/health", tags=["health"])
def health(db: Session = Depends(get_db)):
    dialect = "unknown"
    db_name = "unknown"
    connected = False
    migration_head = False

    try:
        from urllib.parse import urlparse
        parsed = urlparse(settings.DATABASE_URL)
        dialect = getattr(db.bind.dialect, "name", "unknown")
        db_name = parsed.path.lstrip("/") if parsed.path else ("local" if dialect == "sqlite" else "unknown")
        
        # Test connection
        db.execute(text("SELECT 1"))
        connected = True

        # Check migration head
        from alembic.config import Config
        from alembic.script import ScriptDirectory
        from alembic.runtime.migration import MigrationContext
        from pathlib import Path

        alembic_ini_path = Path(__file__).resolve().parent.parent / "alembic.ini"
        if alembic_ini_path.exists():
            alembic_cfg = Config(str(alembic_ini_path))
            script = ScriptDirectory.from_config(alembic_cfg)
            head_rev = script.get_current_head()
            conn = db.connection()
            ctx = MigrationContext.configure(conn)
            current_rev = ctx.get_current_revision()
            migration_head = (current_rev == head_rev)
    except Exception:
        connected = False

    return {
        "status": "ok" if connected else "error",
        "version": settings.APP_VERSION,
        "database": {
            "dialect": dialect,
            "name": db_name,
            "connected": connected,
            "migration_head": migration_head,
        },
    }


# Serve frontend static files in production (when dist/ exists) with SPA fallback to index.html
import os
from fastapi.responses import FileResponse

# Check candidate locations for frontend/dist (container working directory vs relative to file)
candidate_paths = [
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")),
    os.path.abspath("/app/frontend/dist"),
    os.path.abspath("frontend/dist"),
]
dist_path = next((p for p in candidate_paths if os.path.isdir(p)), None)

if dist_path:
    log.info(f"Serving frontend SPA from: {dist_path}")
    index_file = os.path.join(dist_path, "index.html")

    # Mount static assets directory if it exists
    assets_dir = os.path.join(dist_path, "assets")
    if os.path.isdir(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="static_assets")

    @app.get("/", include_in_schema=False)
    async def serve_root():
        return FileResponse(index_file)

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        # Don't intercept API routes or openapi docs
        if full_path.startswith("api") or full_path in ("docs", "redoc", "openapi.json"):
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="Not Found")
        file_candidate = os.path.join(dist_path, full_path)
        if os.path.isfile(file_candidate):
            return FileResponse(file_candidate)
        return FileResponse(index_file)
else:
    log.warning(f"Frontend dist not found at any candidate: {candidate_paths}")


