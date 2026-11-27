"""
SQLAlchemy engine + session factory (synchronous).
Import `get_db` in routers for dependency injection.
"""
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, DeclarativeBase

from backend.config import settings

db_url = settings.sqlalchemy_database_url
is_sqlite = db_url.startswith("sqlite")

engine_kwargs = {
    "echo": False,
    "pool_pre_ping": True,
}
if is_sqlite:
    engine_kwargs["connect_args"] = {
        "check_same_thread": False,
        "timeout": max(1.0, settings.SQLITE_BUSY_TIMEOUT_MS / 1000.0),
    }
else:
    engine_kwargs["pool_size"] = settings.DB_POOL_SIZE
    engine_kwargs["max_overflow"] = settings.DB_MAX_OVERFLOW
    engine_kwargs["pool_timeout"] = settings.DB_POOL_TIMEOUT
    engine_kwargs["pool_recycle"] = settings.DB_POOL_RECYCLE

engine = create_engine(db_url, **engine_kwargs)

if is_sqlite and not db_url.endswith(":memory:"):
    @event.listens_for(engine, "connect")
    def _set_sqlite_pragmas(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute(f"PRAGMA busy_timeout = {int(settings.SQLITE_BUSY_TIMEOUT_MS)}")
            req_mode = (settings.SQLITE_JOURNAL_MODE or "").strip().upper()
            if req_mode in ("DELETE", "TRUNCATE", "PERSIST", "MEMORY", "WAL", "OFF"):
                cursor.execute(f"PRAGMA journal_mode = {req_mode}")
                if req_mode == "WAL":
                    cursor.execute("PRAGMA synchronous = NORMAL")
        except Exception:
            pass
        finally:
            cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    """FastAPI dependency — yields a DB session and closes it when done."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Create all tables (called at startup) and ensure model columns exist."""
    from backend.models import opportunity, snapshot, change_log, daily_summary, setting, custom_column, user  # noqa: F401
    Base.metadata.create_all(bind=engine)
    try:
        from sqlalchemy import inspect, text
        inspector = inspect(engine)
        for table_name, table in Base.metadata.tables.items():
            if inspector.has_table(table_name):
                existing_cols = {c["name"] for c in inspector.get_columns(table_name)}
                for col in table.columns:
                    if col.name not in existing_cols:
                        col_type = col.type.compile(engine.dialect)
                        default_clause = ""
                        if not col.nullable and "BOOL" in col_type.upper():
                            default_clause = " DEFAULT false" if not is_sqlite else " DEFAULT 0"
                        with engine.begin() as conn:
                            conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {col.name} {col_type}{default_clause}"))
    except Exception:
        pass
