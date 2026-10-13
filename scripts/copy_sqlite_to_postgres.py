#!/usr/bin/env python3
"""
scripts/copy_sqlite_to_postgres.py

Migrates snapshots and opportunities from an existing SQLite database file
into the target PostgreSQL database (read from DATABASE_URL or settings).
Refuses to run if target has data, unless --force is given.

Usage:
    python scripts/copy_sqlite_to_postgres.py --sqlite renewals.db [--force]
"""
import os
import sys
import argparse
from pathlib import Path

# Add project root to sys.path
ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from sqlalchemy import create_engine, text, inspect
from backend.config import settings


def main():
    parser = argparse.ArgumentParser(description="Copy SQLite renewal data to PostgreSQL.")
    parser.add_argument("--sqlite", required=True, help="Path to source SQLite .db file")
    parser.add_argument("--force", action="store_true", help="Force copy even if target PostgreSQL already contains rows")
    args = parser.parse_args()

    sqlite_path = Path(args.sqlite)
    if not sqlite_path.is_absolute():
        sqlite_path = ROOT_DIR / sqlite_path

    if not sqlite_path.exists():
        print(f"Error: SQLite source file not found at {sqlite_path}", file=sys.stderr)
        return 1

    # Connect to SQLite source
    sqlite_url = f"sqlite:///{sqlite_path}"
    print(f"Reading from source SQLite: {sqlite_path}...")
    src_engine = create_engine(sqlite_url, connect_args={"check_same_thread": False})

    # Connect to PostgreSQL target
    target_url = settings.sqlalchemy_database_url
    print(f"Target database: {settings.DATABASE_URL.split('@')[-1] if '@' in settings.DATABASE_URL else settings.DATABASE_URL}")

    dst_engine = create_engine(target_url, pool_pre_ping=True)

    # Inspect target for existing data
    with dst_engine.connect() as dst_conn:
        insp = inspect(dst_engine)
        dst_tables = insp.get_table_names()

        target_has_data = False
        if "upload_snapshots" in dst_tables:
            count = dst_conn.execute(text("SELECT count(*) FROM upload_snapshots")).scalar() or 0
            if count > 0:
                target_has_data = True
        if "opportunities" in dst_tables:
            count = dst_conn.execute(text("SELECT count(*) FROM opportunities")).scalar() or 0
            if count > 0:
                target_has_data = True

        if target_has_data and not args.force:
            print(
                "Error: Target database already contains existing data in upload_snapshots / opportunities.\n"
                "Refusing to overwrite. Pass --force to override and proceed.",
                file=sys.stderr,
            )
            return 1

    # Order of tables to copy
    tables_to_copy = [
        "upload_snapshots",
        "opportunities",
        "opportunity_change_logs",
        "daily_summaries",
        "upload_checks",
    ]

    with src_engine.connect() as src_conn:
        src_insp = inspect(src_engine)
        src_tables = set(src_insp.get_table_names())

        with dst_engine.begin() as dst_conn:
            for tbl in tables_to_copy:
                if tbl not in src_tables:
                    continue

                # Fetch rows from SQLite
                rows = src_conn.execute(text(f"SELECT * FROM {tbl}")).mappings().all()
                if not rows:
                    print(f"Table '{tbl}': 0 rows in source, skipping.")
                    continue

                # If force is used and target has rows, delete target rows first
                if args.force:
                    dst_conn.execute(text(f"DELETE FROM {tbl}"))

                columns = list(rows[0].keys())
                col_names = ", ".join(columns)
                placeholders = ", ".join([f":{col}" for col in columns])
                insert_stmt = text(f"INSERT INTO {tbl} ({col_names}) VALUES ({placeholders})")

                print(f"Copying {len(rows)} rows into '{tbl}'...")
                # Chunked insert for efficiency
                chunk_size = 500
                for i in range(0, len(rows), chunk_size):
                    chunk = [dict(r) for r in rows[i : i + chunk_size]]
                    dst_conn.execute(insert_stmt, chunk)

    print("Data migration completed successfully.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
