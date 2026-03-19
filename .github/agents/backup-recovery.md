# Backup & Recovery Skill

## Overview

This skill covers database backup and recovery operations including JSON exports, multi-format imports, schema-aware data restoration, and automated PostgreSQL dumps for disaster recovery.

## Backup Strategies

### JSON-Based Backups (Application Level)

**Advantages:**
- Schema-agnostic format
- Easy to inspect and edit
- Portable across systems
- Supports partial imports

**File Location:** `/backend/src/routes/backup.js`

### PostgreSQL Dumps (Database Level)

**Advantages:**
- Complete database state
- Trigger and function definitions preserved
- Faster restore for large datasets
- Binary-safe for all data types

**Files:**
- `/db/backup.sh` - Backup script
- `/db/restore.sh` - Restore script

## JSON Export/Import

### Export Endpoint

**Endpoint:** `GET /api/backup/export`

**Query Parameters:**
- `tables` (STRING) - Comma-separated table names to export (optional, exports all if not provided)

**Response Format:**

```json
{
  "version": "1.0",
  "timestamp": "2024-01-15T14:30:00.000Z",
  "tables": {
    "app_users": [
      {
        "id": 1,
        "username": "admin",
        "email": "admin@example.com",
        "role": "admin",
        "active": true
      }
    ],
    "Kunde": [
      {
        "ID": 1,
        "Name": "Schmuckgalerie Dresden",
        "Provision": 30,
        "Aktiv": true
      }
    ],
    "Schmuckstück": [
      {
        "Artikelnummer": "MBH001",
        "Name": "Blue Concrete Necklace",
        "Verkaufspreis": 35.00,
        "Verkauft": 0
      }
    ]
  }
}
```

**Implementation (`/backend/src/routes/backup.js`):**

```javascript
const EXPORT_TABLES = ['app_users', 'audit_log', 'Kunde', 'Lieferschein', 'Rechnung', 'Schmuckstück'];

router.get('/export', async (req, res) => {
  try {
    // Determine tables to export
    let tablesToExport = EXPORT_TABLES;

    if (req.query.tables) {
      const requested = req.query.tables
        .split(',')
        .map(t => t.trim())
        .filter(Boolean);

      // Only allow tables in EXPORT_TABLES list (security)
      tablesToExport = EXPORT_TABLES.filter(t => requested.includes(t));
    }

    const exportData = {
      version: '1.0',
      timestamp: new Date().toISOString(),
      tables: {}
    };

    // Export each table
    for (const table of tablesToExport) {
      const result = await db.query(`SELECT * FROM "${table}"`);
      exportData.tables[table] = result.rows;
    }

    // Send as file download
    const formattedTimestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, 19);
    const filename = `goldregendb_backup_${formattedTimestamp}.json`;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(exportData);

  } catch (err) {
    logger.error('BACKUP', 'Export failed', { message: err.message });
    res.status(500).json({ error: 'Export failed' });
  }
});
```

### Import Endpoint

**Endpoint:** `POST /api/backup/import`

**Request Format:**

```json
{
  "backupData": {
    "version": "1.0",
    "timestamp": "2024-01-15T14:30:00.000Z",
    "tables": { ... }
  },
  "selectedTables": ["Kunde", "Schmuckstück"]
}
```

**Implementation:**

```javascript
router.post('/import', async (req, res) => {
  let rawData;
  let selectedTables;

  const body = req.body;

  // Support both wrapper and legacy formats
  if (body && typeof body === 'object' && !Array.isArray(body) && 'backupData' in body) {
    rawData = body.backupData;
    selectedTables = Array.isArray(body.selectedTables) ? body.selectedTables : null;
  } else {
    rawData = body;
    selectedTables = null;
  }

  // Normalize different backup formats
  const normalized = normalizeBackupData(rawData);

  if (!normalized || !normalized.tables || !normalized.version) {
    return res.status(400).json({
      error: 'Invalid backup format. Supported formats: Standard backup or SQL export array.'
    });
  }

  const { tables, version } = normalized;

  // Foreign key safe truncation order (children before parents)
  const FK_SAFE_ORDER = ['Schmuckstück', 'Rechnung', 'Lieferschein', 'Kunde', 'audit_log', 'app_users'];

  // Determine which tables to import
  let tablesToImport;
  if (Array.isArray(selectedTables) && selectedTables.length > 0) {
    const selectedSet = new Set(selectedTables);
    tablesToImport = FK_SAFE_ORDER.filter(
      t => selectedSet.has(t) && Object.prototype.hasOwnProperty.call(tables, t)
    );
  } else {
    tablesToImport = FK_SAFE_ORDER.filter(
      t => Object.prototype.hasOwnProperty.call(tables, t)
    );
  }

  try {
    for (const table of tablesToImport) {
      const tableData = tables[table];

      if (!Array.isArray(tableData) || tableData.length === 0) {
        logger.info('BACKUP', `Skipping empty table: ${table}`);
        continue;
      }

      // Truncate existing data
      await db.query(`TRUNCATE TABLE "${table}" CASCADE`);

      // Insert data with schema-aware handling
      await importTableData(db, table, tableData);

      logger.info('BACKUP', `Imported table: ${table}`, { rows: tableData.length });
    }

    res.json({
      success: true,
      message: 'Import completed successfully',
      tablesImported: tablesToImport.length
    });

  } catch (error) {
    logger.error('BACKUP', 'Import failed', { message: error.message });
    res.status(500).json({ error: 'Import failed: ' + error.message });
  }
});
```

### Schema-Aware Import

```javascript
async function importTableData(db, tableName, rows) {
  if (rows.length === 0) return;

  // Get actual column names from database
  const { rows: columns } = await db.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = $1
    ORDER BY ordinal_position
  `, [tableName]);

  const columnNames = columns.map(c => c.column_name);
  const columnSet = new Set(columnNames);

  // Filter row data to only include existing columns
  const filteredRows = rows.map(row => {
    const filteredRow = {};
    Object.keys(row).forEach(key => {
      if (columnSet.has(key)) {
        filteredRow[key] = row[key];
      }
    });
    return filteredRow;
  });

  // Build parameterized INSERT
  const firstRow = filteredRows[0];
  const importColumns = Object.keys(firstRow);
  const placeholders = importColumns.map((_, i) => `$${i + 1}`).join(',');
  const columnList = importColumns.map(c => `"${c}"`).join(',');

  const query = `
    INSERT INTO "${tableName}" (${columnList})
    VALUES (${placeholders})
  `;

  // Batch insert
  for (const row of filteredRows) {
    const values = importColumns.map(col => row[col]);
    await db.query(query, values);
  }
}
```

## PostgreSQL Dumps

### Backup Script

**File:** `/db/backup.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

POSTGRES_DB="${POSTGRES_DB:-goldregendb}"
POSTGRES_USER="${POSTGRES_USER:-goldregen}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
KEEP_DAILY="${KEEP_DAILY:-7}"
KEEP_WEEKLY="${KEEP_WEEKLY:-4}"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DOW=$(date +"%u")   # 1=Monday, 7=Sunday

mkdir -p "${BACKUP_DIR}/daily" "${BACKUP_DIR}/weekly"

# ── Daily backup ────────────────────────────────────────
DAILY_FILE="${BACKUP_DIR}/daily/goldregendb_${TIMESTAMP}.sql.gz"
echo "[$(date)] Creating daily backup: ${DAILY_FILE}"
pg_dump -U "${POSTGRES_USER}" "${POSTGRES_DB}" | gzip > "${DAILY_FILE}"
echo "[$(date)] Daily backup completed ($(du -sh "${DAILY_FILE}" | cut -f1))"

# ── Weekly backup (every Sunday = day 7) ────────────────
if [ "${DOW}" -eq 7 ]; then
    WEEKLY_FILE="${BACKUP_DIR}/weekly/goldregendb_weekly_${TIMESTAMP}.sql.gz"
    cp "${DAILY_FILE}" "${WEEKLY_FILE}"
    echo "[$(date)] Weekly backup saved: ${WEEKLY_FILE}"
fi

# ── Rotate old backups ──────────────────────────────────
echo "[$(date)] Rotating old daily backups (keeping ${KEEP_DAILY})..."
ls -1t "${BACKUP_DIR}/daily/"*.sql.gz 2>/dev/null \
    | tail -n "+$((KEEP_DAILY + 1))" \
    | xargs -r rm -v

echo "[$(date)] Rotating old weekly backups (keeping ${KEEP_WEEKLY})..."
ls -1t "${BACKUP_DIR}/weekly/"*.sql.gz 2>/dev/null \
    | tail -n "+$((KEEP_WEEKLY + 1))" \
    | xargs -r rm -v

echo "[$(date)] Backup finished."
```

### Usage

**From Host:**
```bash
./db/backup.sh
```

**Via Docker:**
```bash
docker compose exec db /backup.sh
```

**With Custom Settings:**
```bash
KEEP_DAILY=14 KEEP_WEEKLY=8 ./db/backup.sh
```

### Restore Script

**File:** `/db/restore.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: $0 <backup_file.sql.gz>"
  echo "Example: $0 /backups/daily/goldregendb_20240115_143000.sql.gz"
  exit 1
fi

BACKUP_FILE="$1"
POSTGRES_DB="${POSTGRES_DB:-goldregendb}"
POSTGRES_USER="${POSTGRES_USER:-goldregen}"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Error: Backup file not found: $BACKUP_FILE"
  exit 1
fi

echo "[$(date)] Starting restore from: $BACKUP_FILE"

# Decompress and restore
gunzip -c "$BACKUP_FILE" | psql -U "${POSTGRES_USER}" "${POSTGRES_DB}"

echo "[$(date)] Restore completed."
```

### Usage

```bash
# Restore from backup
./db/restore.sh /backups/daily/goldregendb_20240115_143000.sql.gz

# Via Docker
docker compose exec -T db /restore.sh /backups/daily/goldregendb_20240115_143000.sql.gz
```

## Backup Scheduling

### Docker Compose Configuration

**In `docker-compose.yml`:**

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_DB: goldregendb
      POSTGRES_USER: goldregen
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - ./db/backup.sh:/backup.sh:ro
      - ./db/restore.sh:/restore.sh:ro
      - postgres_data:/var/lib/postgresql/data
      - ./backups:/backups

  backup:
    image: mcr.microsoft.com/cron
    volumes:
      - ./db/backup.sh:/backup.sh:ro
      - ./backups:/backups
    environment:
      POSTGRES_DB: goldregendb
      POSTGRES_USER: goldregen
      BACKUP_DIR: /backups
    command: |
      /bin/sh -c "
        echo '0 2 * * * /backup.sh' | crontab - &&
        crond -f
      "
    depends_on:
      - db
```

### Cron-Based Scheduling (Host)

```bash
# Edit crontab
crontab -e

# Add entry for daily 2 AM backup
0 2 * * * cd /path/to/GoldRegenDB_Web && docker compose exec -T db /backup.sh
```

## Disaster Recovery Plan

### Step 1: Assess Damage

```bash
# Check database connectivity
docker compose exec db psql -U goldregen -d goldregendb -c "SELECT COUNT(*) FROM \"Schmuckstück\";"

# Check backup files
ls -lh /backups/daily/
ls -lh /backups/weekly/
```

### Step 2: Determine Recovery Point

```bash
# List available backups
ls -lt /backups/daily/*.sql.gz | head -5

# Show dates
file /backups/daily/goldregendb_20240115_*.sql.gz
```

### Step 3: Restore from Backup

```bash
# Stop application
docker compose down

# Restore database
./db/restore.sh /backups/daily/goldregendb_20240115_143000.sql.gz

# Start application
docker compose up -d

# Verify data integrity
docker compose exec db psql -U goldregen -d goldregendb -c "SELECT COUNT(*) FROM audit_log;"
```

## Data Verification

### Integrity Checks

```sql
-- Check for orphaned references
SELECT COUNT(*) FROM "Schmuckstück"
WHERE "Rechnung_ID" > 0
AND NOT EXISTS (SELECT 1 FROM "Rechnung" WHERE "ID" = "Schmuckstück"."Rechnung_ID");

-- Check for invalid status combinations
SELECT COUNT(*) FROM "Schmuckstück"
WHERE "Verkauft" = 1 AND "Ausschuss" = 1;

-- Check for missing Ausschuss_Grund
SELECT COUNT(*) FROM "Schmuckstück"
WHERE "Ausschuss" = 1 AND ("Ausschuss_Grund" IS NULL OR "Ausschuss_Grund" = '');
```

### Recovery Validation Script

```bash
#!/bin/bash
echo "Validating backup recovery..."

DB_USER="goldregen"
DB_NAME="goldregendb"

# Check table counts
echo "Table counts:"
psql -U "$DB_USER" -d "$DB_NAME" -c "
  SELECT 'Schmuckstück' as table, COUNT(*) as count FROM \"Schmuckstück\"
  UNION ALL
  SELECT 'Kunde', COUNT(*) FROM \"Kunde\"
  UNION ALL
  SELECT 'Rechnung', COUNT(*) FROM \"Rechnung\"
  UNION ALL
  SELECT 'Lieferschein', COUNT(*) FROM \"Lieferschein\"
  UNION ALL
  SELECT 'audit_log', COUNT(*) FROM audit_log;
"

# Check integrity
echo "Integrity checks:"
psql -U "$DB_USER" -d "$DB_NAME" -c "
  SELECT 'orphaned_rechnungen' as check_name,
         COUNT(*) as issue_count
  FROM \"Schmuckstück\"
  WHERE \"Rechnung_ID\" > 0
  AND NOT EXISTS (
    SELECT 1 FROM \"Rechnung\"
    WHERE \"ID\" = \"Schmuckstück\".\"Rechnung_ID\"
  );
"
```

## Related Skills

- [Database Operations](./database-operations.md) - Connection and transaction patterns
- [Audit & Compliance](./audit-compliance.md) - Audit log preservation
- [Testing & Quality](./testing.md) - Testing backup/restore workflows

## Troubleshooting

### Backup File Not Created

**Cause:** Permission issues or disk full
**Solution:**
1. Check backup directory permissions: `ls -ld /backups/`
2. Verify disk space: `df -h /backups/`
3. Check PostgreSQL user permissions: `psql -U goldregen -l`
4. Review script logs: `tail -f /var/log/backup.log`

### Restore Fails with FK Constraint Errors

**Cause:** Tables imported in wrong order
**Solution:**
1. Use FK_SAFE_ORDER: Schmuckstück, Rechnung, Lieferschein, Kunde, audit_log, app_users
2. Disable FK temporarily: `SET CONSTRAINTS ALL DEFERRED;`
3. Use schema-aware import to skip missing columns

### Backup/Restore Very Slow

**Cause:** Large dataset or slow I/O
**Solution:**
1. Use compression: `pg_dump | gzip`
2. Implement parallel restore: `pg_restore -j 4`
3. Increase buffer: `maintenance_work_mem = 256MB`
4. Check disk I/O: `iostat -x 1`

### Data Corruption After Restore

**Cause:** Incomplete restore or corrupted backup
**Solution:**
1. Run integrity checks above
2. Restore from previous backup
3. Compare backup timestamps
4. Check PostgreSQL error logs

### Backup Size Growing Too Large

**Cause:** Audit log accumulation
**Solution:**
1. Implement archive strategy: archive old audit logs annually
2. Compress older backups: `find /backups -mtime +90 -exec gzip {} \;`
3. Implement incremental backups for PostgreSQL
4. Use WAL archiving for point-in-time recovery
