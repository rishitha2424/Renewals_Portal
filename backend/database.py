"""
SQLAlchemy engine + session factory (synchronous).
Import `get_db` in routers for dependency injection.
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

from backend.config import settings

db_url = settings.sqlalchemy_database_url
is_sqlite = db_url.startswith("sqlite")

engine_kwargs = {
    "echo": False,
    "pool_pre_ping": True,
}
if is_sqlite:
    engine_kwargs["connect_args"] = {"check_same_thread": False}
else:
    engine_kwargs["pool_size"] = 10
    engine_kwargs["max_overflow"] = 20

engine = create_engine(db_url, **engine_kwargs)

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
    from backend.models import opportunity, snapshot, change_log, daily_summary, setting, custom_column  # noqa: F401
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
                        with engine.begin() as conn:
                            conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {col.name} {col_type}"))
    except Exception:
        pass
