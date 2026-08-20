#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# restore.sh – PostgreSQL restore script for GoldRegenDB
#
# Usage (from host):
#   ./db/restore.sh <backup-file.sql.gz>
#
# Or via Docker Compose (recommended):
#   docker compose exec db /restore.sh /backups/daily/goldregendb_<timestamp>.sql.gz
#
# WARNING: This will DROP and recreate the database. All current data will
#          be lost. Make sure you have a recent backup before running this.
#
# Environment variables (all optional – fall back to defaults that match
# the values in .env.example):
#   POSTGRES_DB       Database name   (default: goldregendb)
#   POSTGRES_USER     DB user         (default: goldregen)
#
# Hinweis zum audit_log Tamper-Schutz (Issue #139): audit_log blockiert
# UPDATE/DELETE per Trigger. Das kollidiert NICHT mit diesem Skript, weil
# pg_dump-Dumps Daten (COPY) im "pre-data"/"data"-Teil laden und Trigger erst
# danach im "post-data"-Teil neu anlegen – die Zeilen sind also längst
# eingefügt (nur INSERT, nie UPDATE/DELETE), bevor der Trigger überhaupt
# existiert. Das DROP/CREATE DATABASE davor räumt zusätzlich jeden Alt-Trigger
# weg. Verifiziert gegen einen echten PostgreSQL-16-Dump/Restore-Zyklus.
# ---------------------------------------------------------------------------
set -euo pipefail

POSTGRES_DB="${POSTGRES_DB:-goldregendb}"
POSTGRES_USER="${POSTGRES_USER:-goldregen}"

if [ $# -lt 1 ]; then
    echo "Usage: $0 <backup-file.sql.gz>"
    echo ""
    echo "Available backups:"
    ls -lht /backups/daily/*.sql.gz /backups/weekly/*.sql.gz 2>/dev/null || echo "  (none found)"
    exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "${BACKUP_FILE}" ]; then
    echo "ERROR: Backup file not found: ${BACKUP_FILE}"
    exit 1
fi

echo "[$(date)] Restoring database '${POSTGRES_DB}' from: ${BACKUP_FILE}"
echo "[$(date)] WARNING: All current data in '${POSTGRES_DB}' will be replaced."

# Terminate all existing connections to the database
psql -U "${POSTGRES_USER}" -d postgres \
    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${POSTGRES_DB}' AND pid <> pg_backend_pid();" \
    > /dev/null

# Drop and recreate the database
psql -U "${POSTGRES_USER}" -d postgres -c "DROP DATABASE IF EXISTS \"${POSTGRES_DB}\";"
psql -U "${POSTGRES_USER}" -d postgres -c "CREATE DATABASE \"${POSTGRES_DB}\" OWNER \"${POSTGRES_USER}\";"

# Restore
gunzip -c "${BACKUP_FILE}" | psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -v ON_ERROR_STOP=1

echo "[$(date)] Restore completed successfully."
