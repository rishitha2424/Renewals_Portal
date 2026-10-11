# Database Migrations with Alembic

This repository uses Alembic for database schema management and migrations across SQLite (local development) and PostgreSQL (production).

## Current Schema Version
- **Initial Schema**: `0001_initial_schema` (`2ce891c9fa53`)
  - Includes `upload_snapshots`, `uploaded_files`, `opportunities`, `change_logs`, `forecast_movement_log`, and `daily_summary`.
  - Configured with composite indexes on `opportunities` and a unique constraint on `(snapshot_id, opportunity_id_18)`.
  - Compatible with SQLite and PostgreSQL (using JSONB on PostgreSQL for `extra_attributes`).

---

## How to Apply Migrations

To apply all pending migrations up to the latest version:

```bash
alembic upgrade head
```

In Docker containers, migrations run automatically on startup during container initialization.

---

## How to Create a New Migration

1. Make your model adjustments in `backend/models/*.py`.
2. Generate a new autodetected migration revision:

```bash
alembic revision --autogenerate -m "describe_your_changes"
```

3. Inspect the generated migration file in `alembic/versions/<revision_id>_<name>.py`.
4. Verify both `upgrade()` and `downgrade()` methods.
5. Apply the migration locally:

```bash
alembic upgrade head
```

---

## How to Roll Back a Migration

To roll back the most recently applied migration:

```bash
alembic downgrade -1
```

To roll back to a specific revision ID:

```bash
alembic downgrade <revision_id>
```

To completely reset the database to base state:

```bash
alembic downgrade base
```
