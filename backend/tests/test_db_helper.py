import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from backend.database import Base

def get_test_engine_and_session(test_name: str, tmp_path_factory=None):
    """
    Returns (engine, Session) for running tests.
    If TEST_DATABASE_URL is set (e.g. postgresql://postgres@localhost:54329/test_db),
    creates a clean schema in PostgreSQL. Otherwise falls back to SQLite.
    """
    test_db_url = os.environ.get("TEST_DATABASE_URL")
    if test_db_url:
        if test_db_url.startswith("postgres://"):
            test_db_url = test_db_url.replace("postgres://", "postgresql+psycopg://", 1)
        elif test_db_url.startswith("postgresql://") and not test_db_url.startswith("postgresql+"):
            test_db_url = test_db_url.replace("postgresql://", "postgresql+psycopg://", 1)
        engine = create_engine(test_db_url, pool_pre_ping=True)
    else:
        if tmp_path_factory:
            db_path = tmp_path_factory.mktemp("db") / f"{test_name}.db"
            db_url = f"sqlite:///{db_path}"
        else:
            db_url = f"sqlite:///./{test_name}.db"
        engine = create_engine(db_url, connect_args={"check_same_thread": False})
    
    # Drop and re-create schema for clean test isolation
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    return engine, Session
