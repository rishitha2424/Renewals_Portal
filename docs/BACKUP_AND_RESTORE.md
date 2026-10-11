# Database Backup & Disaster Recovery

This document details the PostgreSQL backup and restore procedure for the Mobileum Renewals Intelligence platform.

---

## Backup Script: `scripts/backup.sh`

The backup script utilizes `pg_dump` with custom archive format (`-F c`), capturing all database objects, blobs, and schema definitions.

### Running Backups
```bash
# Run backup with default environment variables (or specify overrides)
DB_HOST=localhost DB_PORT=5432 DB_USER=renewals_user DB_NAME=renewals_prod ./scripts/backup.sh
```

### Automated Daily Cron Job
To automate daily backups at 02:00 AM on the host VM:
```cron
0 2 * * * cd /opt/renewals && ./scripts/backup.sh >> /var/log/renewals_backup.log 2>&1
```

### Retention Policy
- Backups are stored in `./backups/` named `renewals_prod_YYYYMMDD_HHMMSS.dump`.
- **Retention**: Daily backups are retained for **30 days** (`tail -n +31 | xargs rm -f`).

---

## Restore Script: `scripts/restore.sh`

To restore a database dump into a fresh or existing database:

```bash
# Restore specific backup file into target database
./scripts/restore.sh ./backups/renewals_prod_20261011_220000.dump renewals_prod
```

The restore script executes:
```bash
pg_restore -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" --clean --if-exists -v "$BACKUP_FILE"
```
