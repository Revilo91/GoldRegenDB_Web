#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# backup.sh – PostgreSQL backup script for GoldRegenDB
#
# Usage (from host):
#   ./db/backup.sh
#
# Or via Docker Compose (recommended):
#   docker compose exec db /backup.sh
#
# Environment variables (all optional – fall back to defaults that match
# the values in .env.example):
#   POSTGRES_DB       Database name   (default: goldregendb)
#   POSTGRES_USER     DB user         (default: goldregen)
#   BACKUP_DIR        Backup dir      (default: /backups)
#   KEEP_DAILY        Daily backups to keep   (default: 7)
#   KEEP_WEEKLY       Weekly backups to keep  (default: 4)
# ---------------------------------------------------------------------------
set -euo pipefail

POSTGRES_DB="${POSTGRES_DB:-goldregendb}"
POSTGRES_USER="${POSTGRES_USER:-goldregen}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
KEEP_DAILY="${KEEP_DAILY:-7}"
KEEP_WEEKLY="${KEEP_WEEKLY:-4}"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DOW=$(date +"%u")   # 1=Monday … 7=Sunday

mkdir -p "${BACKUP_DIR}/daily" "${BACKUP_DIR}/weekly"

# ── Daily backup ─────────────────────────────────────────────────────────────
DAILY_FILE="${BACKUP_DIR}/daily/goldregendb_${TIMESTAMP}.sql.gz"
echo "[$(date)] Creating daily backup: ${DAILY_FILE}"
pg_dump -U "${POSTGRES_USER}" "${POSTGRES_DB}" | gzip > "${DAILY_FILE}"
echo "[$(date)] Daily backup completed ($(du -sh "${DAILY_FILE}" | cut -f1))"

# ── Weekly backup (every Sunday = day 7) ─────────────────────────────────────
if [ "${DOW}" -eq 7 ]; then
    WEEKLY_FILE="${BACKUP_DIR}/weekly/goldregendb_weekly_${TIMESTAMP}.sql.gz"
    cp "${DAILY_FILE}" "${WEEKLY_FILE}"
    echo "[$(date)] Weekly backup saved: ${WEEKLY_FILE}"
fi

# ── Rotate old backups ────────────────────────────────────────────────────────
echo "[$(date)] Rotating old daily backups (keeping ${KEEP_DAILY})..."
ls -1t "${BACKUP_DIR}/daily/"*.sql.gz 2>/dev/null \
    | tail -n "+$((KEEP_DAILY + 1))" \
    | xargs -r rm -v

echo "[$(date)] Rotating old weekly backups (keeping ${KEEP_WEEKLY})..."
ls -1t "${BACKUP_DIR}/weekly/"*.sql.gz 2>/dev/null \
    | tail -n "+$((KEEP_WEEKLY + 1))" \
    | xargs -r rm -v

echo "[$(date)] Backup finished."
