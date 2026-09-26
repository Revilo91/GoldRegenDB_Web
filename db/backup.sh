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
#   KEEP_DAILY        Days to keep daily backups   (default: 7)
#   KEEP_WEEKLY       Weeks to keep weekly backups (default: 4)
#   MIN_BACKUP_BYTES  Plausibility floor           (default: 1024)
# ---------------------------------------------------------------------------
# Befund E2 – vier Logikfehler, die hier behoben sind:
#
# 1. `pg_dump | gzip > ZIEL` erzeugte die Zieldatei, BEVOR pg_dump startete.
#    Schlug der Dump fehl, beendete pipefail das Skript und die abgebrochene,
#    unbrauchbare .sql.gz blieb liegen. Beim nächsten Lauf zählte `ls -1t` sie
#    als gültiges Backup und verdrängte ein funktionierendes. Nach KEEP_DAILY
#    Tagen stillen Scheiterns waren alle sieben guten Backups durch sieben
#    kaputte ersetzt. Jetzt: Dump in eine temporäre Datei, prüfen, dann atomar
#    an den Zielnamen verschieben. Ein trap räumt die Temporärdatei auf.
#
# 2. Die Rotation behielt über `ls -1t | tail` die N NEUESTEN DATEIEN, nicht N
#    Tage. Sieben manuelle Läufe an einem Vormittag reduzierten das
#    Aufbewahrungsfenster von einer Woche auf zwei Stunden – im Widerspruch zu
#    db/README.md ("Maximaler Datenverlust: 1 Tag"). Jetzt: find -mtime.
#
# 3. Es wurde NIE geprüft, ob der Dump lesbar ist. Ein 200-Byte-Dump rotierte
#    die guten Backups genauso weg wie ein vollständiger. Jetzt: `gzip -t`,
#    eine Mindestgröße und die Prüfung, dass die Haupttabellen im Dump stehen.
#
# 4. Das Weekly war ein `cp` des Daily – ein korruptes Daily wurde zum
#    korrupten Weekly. Jetzt ein eigener pg_dump mit eigener Prüfung.
# ---------------------------------------------------------------------------
set -euo pipefail

POSTGRES_DB="${POSTGRES_DB:-goldregendb}"
POSTGRES_USER="${POSTGRES_USER:-goldregen}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
KEEP_DAILY="${KEEP_DAILY:-7}"
KEEP_WEEKLY="${KEEP_WEEKLY:-4}"
MIN_BACKUP_BYTES="${MIN_BACKUP_BYTES:-1024}"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DOW=$(date +"%u")   # 1=Monday … 7=Sunday

mkdir -p "${BACKUP_DIR}/daily" "${BACKUP_DIR}/weekly"

TMP_FILE=""
# shellcheck disable=SC2317  # trap-Handler, wird vom Signal aufgerufen
aufraeumen() {
    if [ -n "${TMP_FILE}" ] && [ -f "${TMP_FILE}" ]; then
        echo "[$(date)] Removing incomplete dump: ${TMP_FILE}" >&2
        rm -f "${TMP_FILE}"
    fi
}
trap aufraeumen EXIT

# Prüft einen fertigen Dump, bevor er ein gültiges Backup werden darf.
pruefe_dump() {
    local datei="$1"

    if ! gzip -t "${datei}" 2>/dev/null; then
        echo "[$(date)] FEHLER: ${datei} ist kein lesbares gzip-Archiv." >&2
        return 1
    fi

    local groesse
    groesse=$(wc -c < "${datei}")
    if [ "${groesse}" -lt "${MIN_BACKUP_BYTES}" ]; then
        echo "[$(date)] FEHLER: ${datei} ist nur ${groesse} Bytes gross" \
             "(Minimum ${MIN_BACKUP_BYTES}). Das ist kein vollstaendiger Dump." >&2
        return 1
    fi

    # Ein Dump ohne die Haupttabellen ist unbrauchbar, auch wenn gzip ihn liest.
    #
    # Einmal dekomprimieren, alle Tabellennamen in einem Durchgang einsammeln.
    # Die naheliegende Schleife mit `gunzip -c "$datei" | grep -qF ...` ist unter
    # `set -o pipefail` FALSCH: grep -q beendet sich beim ersten Treffer, schickt
    # damit SIGPIPE an gunzip, und pipefail macht aus dem Signal einen
    # Pipeline-Fehler -- der Treffer wird zum Fehlschlag. Genau die Falle, die
    # Befund A7 in load_seed.sh beschreibt. `|| true` faengt grep's Exit 1 bei
    # null Treffern ab; die echten Fehlerfaelle decken `gzip -t` und die
    # Groessenpruefung oben ab.
    local gefunden
    gefunden=$(gunzip -c "${datei}" | grep -oE 'CREATE TABLE (public\.)?"?[A-Za-zÄÖÜäöüß_]+"?' || true)

    local fehlend=""
    for tabelle in Schmuckstück Kunde Rechnung Lieferschein audit_log app_users; do
        case "${gefunden}" in
            *"\"${tabelle}\""*|*" ${tabelle}"*|*".${tabelle}"*) ;;
            *) fehlend="${fehlend} ${tabelle}" ;;
        esac
    done
    if [ -n "${fehlend}" ]; then
        echo "[$(date)] FEHLER: im Dump fehlen Tabellen:${fehlend}" >&2
        return 1
    fi

    return 0
}

# Erzeugt einen geprüften Dump und verschiebt ihn atomar an den Zielnamen.
erstelle_backup() {
    local ziel="$1"
    local beschriftung="$2"

    TMP_FILE="${ziel}.tmp.$$"
    echo "[$(date)] Creating ${beschriftung}: ${ziel}"
    pg_dump -U "${POSTGRES_USER}" "${POSTGRES_DB}" | gzip > "${TMP_FILE}"

    if ! pruefe_dump "${TMP_FILE}"; then
        echo "[$(date)] ${beschriftung} VERWORFEN – bestehende Backups bleiben unangetastet." >&2
        return 1
    fi

    # Erst jetzt wird die Datei ein gültiges Backup; mv innerhalb desselben
    # Verzeichnisses ist atomar.
    mv "${TMP_FILE}" "${ziel}"
    TMP_FILE=""
    echo "[$(date)] ${beschriftung} completed ($(du -sh "${ziel}" | cut -f1))"
}

# ── Daily backup ─────────────────────────────────────────────────────────────
DAILY_FILE="${BACKUP_DIR}/daily/goldregendb_${TIMESTAMP}.sql.gz"
erstelle_backup "${DAILY_FILE}" "daily backup"

# ── Weekly backup (every Sunday = day 7) ─────────────────────────────────────
# Eigener Dump, kein cp des Daily: sonst wurde ein korruptes Daily zum
# korrupten Weekly.
if [ "${DOW}" -eq 7 ]; then
    WEEKLY_FILE="${BACKUP_DIR}/weekly/goldregendb_weekly_${TIMESTAMP}.sql.gz"
    erstelle_backup "${WEEKLY_FILE}" "weekly backup"
fi

# ── Rotate old backups ────────────────────────────────────────────────────────
# find -mtime statt `ls -1t | tail`: gelöscht wird nach ALTER, nicht nach Anzahl.
echo "[$(date)] Rotating daily backups older than ${KEEP_DAILY} days..."
find "${BACKUP_DIR}/daily" -maxdepth 1 -name '*.sql.gz' -type f \
     -mtime "+${KEEP_DAILY}" -print -delete

echo "[$(date)] Rotating weekly backups older than $((KEEP_WEEKLY * 7)) days..."
find "${BACKUP_DIR}/weekly" -maxdepth 1 -name '*.sql.gz' -type f \
     -mtime "+$((KEEP_WEEKLY * 7))" -print -delete

# Verwaiste Temporärdateien abgebrochener Läufe (älter als ein Tag) mitnehmen.
find "${BACKUP_DIR}" -maxdepth 2 -name '*.sql.gz.tmp.*' -type f -mtime +1 -print -delete

echo "[$(date)] Backup finished."
