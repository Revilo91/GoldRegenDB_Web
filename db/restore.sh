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
# WICHTIG: Vorher den app-Container stoppen (`docker compose stop app`).
#          Sonst reisst pg_terminate_backend unten die Verbindung des Backends
#          ab; es startet per `restart: always` neu und legt seine ensureX-
#          Tabellen PARALLEL zum laufenden Restore an. Die CREATE TABLE aus dem
#          Dump treffen dann auf bereits existierende Tabellen, ON_ERROR_STOP=1
#          bricht ab, und das Ergebnis ist eine teilweise wiederhergestellte
#          Datenbank (Befund E3).
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

# --yes an beliebiger Stelle ueberspringt die Rueckfrage (fuer Skripte).
BACKUP_FILE=""
OHNE_RUECKFRAGE=0
for arg in "$@"; do
    case "${arg}" in
        --yes|-y) OHNE_RUECKFRAGE=1 ;;
        *) [ -z "${BACKUP_FILE}" ] && BACKUP_FILE="${arg}" ;;
    esac
done

if [ -z "${BACKUP_FILE}" ]; then
    echo "Usage: $0 <backup-file.sql.gz> [--yes]"
    exit 1
fi

if [ ! -f "${BACKUP_FILE}" ]; then
    echo "ERROR: Backup file not found: ${BACKUP_FILE}"
    exit 1
fi

# ── Archiv PRUEFEN, bevor irgendetwas geloescht wird (Befund E3) ────────────
# Vorher wurde nur geprueft, ob die Datei EXISTIERT. Bei einem korrupten Backup
# war die Datenbank danach weg und der Restore scheiterte -- Ergebnis: eine
# leere Datenbank. Genau solche Archive konnte das alte backup.sh erzeugen.
echo "[$(date)] Checking archive: ${BACKUP_FILE}"
if ! gunzip -t "${BACKUP_FILE}" 2>/dev/null; then
    echo "ERROR: ${BACKUP_FILE} ist kein lesbares gzip-Archiv." >&2
    echo "       Die Datenbank wurde NICHT angetastet." >&2
    exit 1
fi
# grep -c statt grep -q: -q beendet sich beim ersten Treffer, schickt damit
# SIGPIPE an gunzip, und `set -o pipefail` (oben) macht aus dem Signal einen
# Pipeline-Fehler -- der Treffer wuerde zum Fehlschlag. Dieselbe Falle wie in
# Befund A7 (load_seed.sh) und in pruefe_dump() in backup.sh. -c liest die
# Eingabe komplett, `|| true` faengt Exit 1 bei null Treffern ab.
TABELLEN_IM_DUMP=$(gunzip -c "${BACKUP_FILE}" | grep -cF 'CREATE TABLE' || true)
if [ "${TABELLEN_IM_DUMP}" -eq 0 ]; then
    echo "ERROR: ${BACKUP_FILE} enthaelt kein CREATE TABLE – das ist kein" >&2
    echo "       vollstaendiger pg_dump. Die Datenbank wurde NICHT angetastet." >&2
    exit 1
fi
echo "[$(date)] Archive contains ${TABELLEN_IM_DUMP} CREATE TABLE statements."
echo "[$(date)] Archive looks valid."

echo "[$(date)] Restoring database '${POSTGRES_DB}' from: ${BACKUP_FILE}"
echo "[$(date)] WARNING: All current data in '${POSTGRES_DB}' will be replaced."

# ── Rueckfrage ──────────────────────────────────────────────────────────────
# Das Skript loescht die Produktionsdatenbank. Ein Tippfehler im Dateinamen war
# bisher nicht von einer Absicht zu unterscheiden.
if [ "${OHNE_RUECKFRAGE}" -ne 1 ]; then
    if [ -t 0 ]; then
        printf "Datenbank '%s' wirklich ersetzen? [j/N] " "${POSTGRES_DB}"
        read -r antwort
        case "${antwort}" in
            j|J|ja|Ja|y|Y|yes) ;;
            *) echo "Abgebrochen. Die Datenbank wurde NICHT angetastet."; exit 1 ;;
        esac
    else
        echo "ERROR: keine interaktive Eingabe moeglich." >&2
        echo "       Fuer Skripte: $0 ${BACKUP_FILE} --yes" >&2
        exit 1
    fi
fi

# ── Sicherheits-Dump des aktuellen Stands ───────────────────────────────────
# Falls das eingespielte Backup sich als falsch erweist, ist der bisherige
# Stand nicht verloren.
SICHERUNG_DIR="${SICHERUNG_DIR:-/backups/vor-restore}"
if mkdir -p "${SICHERUNG_DIR}" 2>/dev/null; then
    SICHERUNG="${SICHERUNG_DIR}/vor_restore_$(date +%Y%m%d_%H%M%S).sql.gz"
    echo "[$(date)] Safety dump of the current state: ${SICHERUNG}"
    if pg_dump -U "${POSTGRES_USER}" "${POSTGRES_DB}" | gzip > "${SICHERUNG}.tmp" \
       && gunzip -t "${SICHERUNG}.tmp" 2>/dev/null; then
        mv "${SICHERUNG}.tmp" "${SICHERUNG}"
        echo "[$(date)] Safety dump written."
    else
        rm -f "${SICHERUNG}.tmp"
        echo "[$(date)] WARNUNG: Sicherheits-Dump nicht moeglich (leere oder" >&2
        echo "           unerreichbare Datenbank?) – Restore laeuft weiter." >&2
    fi
else
    echo "[$(date)] WARNUNG: ${SICHERUNG_DIR} nicht beschreibbar, kein Sicherheits-Dump." >&2
fi

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
