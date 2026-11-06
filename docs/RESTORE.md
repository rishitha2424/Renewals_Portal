# Restoring Custom Column Annotations from Backup

This document describes how to restore custom column definitions, deal annotation values, and audit history from the daily rolling JSON backups created by Mobileum Horizon.

---

## 1. Backup Architecture & Locations

### Daily Rolling Backup Job
The application registers a scheduled backup worker on startup that runs every 24 hours. Backups are stored as serialized JSON files in:
- **SQLite (Default / Local)**: `<db-directory>/backups/annotations/annotations_backup_YYYY-MM-DD.json` (e.g., `data/backups/annotations/`).
- **PostgreSQL / Production**: Configurable via `ANNOTATION_BACKUP_PATH` environment variable (defaults to `data/backups/annotations/`).
- **Manual Export**: An admin can also download the full annotations payload on demand via:
  - `GET /api/custom-columns/backup/export` (Admin Bearer Token / Cookie required).

### Retention Policy
The number of backup files retained is managed by the system setting `annotation_backup_retention_days` (default: **14 days**). Every daily backup run automatically purges files older than the retention window.

### Deployment Environment Notes (Railway)
- **SQLite on Railway**: Railway containers have ephemeral filesystems by default. Any SQLite database and local backup files will be lost on container redeploy unless a Railway **Persistent Volume** is mounted at `/app/data` (or the directory containing the SQLite file).
- **PostgreSQL on Railway**: Managed PostgreSQL database services persist across container restarts. The annotations database records survive deployments automatically. To preserve backup JSON files off-container, set `ANNOTATION_BACKUP_PATH` to a mounted volume or regularly export via `/api/custom-columns/backup/export`.

---

## 2. Backup File Format

Each backup file contains a JSON structure:

```json
{
  "version": "1.0",
  "exported_at": "2026-10-28T04:00:00.000000+00:00",
  "counts": {
    "custom_columns": 5,
    "deal_annotations": 420,
    "annotation_audit": 512
  },
  "custom_columns": [
    {
      "id": "uuid-...",
      "key": "renewal_strategy",
      "label": "Renewal Strategy",
      "type": "text",
      "dropdown_options": null,
      "sort_order": 0,
      "is_deleted": false,
      "created_by": "Rishitha",
      "created_at": "2026-10-25T12:00:00Z"
    }
  ],
  "deal_annotations": [
    {
      "id": "uuid-...",
      "opportunity_id_18": "006Qp0000012345AAA",
      "column_key": "renewal_strategy",
      "value": "Upsell opportunity in Q4",
      "source": "app",
      "updated_by": "Rishitha",
      "updated_at": "2026-10-26T14:30:00Z",
      "version": 1
    }
  ],
  "annotation_audit": [...]
}
```

---

## 3. Step-by-Step Restoration Procedure

To restore annotations into the database (SQLite or PostgreSQL):

### Step 1: Place the Backup File
Ensure the target backup JSON file (e.g., `annotations_backup_2026-10-26.json`) is accessible on the server or workstation.

### Step 2: Run the Restore Script
Run the following Python restore script in the app root:

```bash
python -c "
import json, sys
from pathlib import Path
from backend.database import SessionLocal
from backend.models.custom_column import CustomColumn, DealAnnotation, AnnotationAudit

backup_path = Path('data/backups/annotations/annotations_backup_2026-10-26.json')
if not backup_path.exists():
    print(f'Error: Backup file not found at {backup_path}')
    sys.exit(1)

with open(backup_path, 'r', encoding='utf-8') as f:
    data = json.load(f)

db = SessionLocal()
try:
    print(f'Restoring from {backup_path.name} (version {data.get(\"version\")})...')

    # 1. Restore Custom Columns
    for c in data.get('custom_columns', []):
        existing = db.query(CustomColumn).filter(CustomColumn.id == c['id']).first()
        if not existing:
            col = CustomColumn(
                id=c['id'],
                key=c['key'],
                label=c['label'],
                type=c['type'],
                dropdown_options=c.get('dropdown_options'),
                sort_order=c.get('sort_order', 0),
                source_header=None,
                is_deleted=c.get('is_deleted', False),
                created_by=c.get('created_by', 'system'),
            )
            db.add(col)
        else:
            existing.label = c['label']
            existing.type = c['type']
            existing.is_deleted = c.get('is_deleted', False)
            existing.dropdown_options = c.get('dropdown_options')

    db.flush()

    # 2. Restore Deal Annotations
    for a in data.get('deal_annotations', []):
        existing = db.query(DealAnnotation).filter(
            DealAnnotation.opportunity_id_18 == a['opportunity_id_18'],
            DealAnnotation.column_key == a['column_key'],
        ).first()
        if not existing:
            annot = DealAnnotation(
                id=a['id'],
                opportunity_id_18=a['opportunity_id_18'],
                column_key=a['column_key'],
                value=a['value'],
                source=a.get('source', 'app'),
                updated_by=a.get('updated_by', 'system'),
                version=a.get('version', 1),
            )
            db.add(annot)
        else:
            existing.value = a['value']
            existing.updated_by = a.get('updated_by', 'system')
            existing.version = max(existing.version, a.get('version', 1))

    db.commit()
    print('Restoration completed successfully.')
finally:
    db.close()
"
```

### Step 3: Verify the Restoration
1. Inspect columns via API:
   ```bash
   curl -s http://localhost:8000/api/custom-columns
   ```
2. Inspect deals in Data Explorer:
   Navigate to the Data Explorer in the UI. All restored custom columns will appear as added columns with their persisted values.
3. Check the audit history:
   Click the **Change log** button in Data Explorer to verify audit entries.
