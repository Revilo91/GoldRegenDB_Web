#!/usr/bin/env bash
# =============================================================================
# install.sh – Installation/Update goldregendb auf der Synology (Container Manager)
#
# Standard-Installer aller Projekte (identischer Ablauf, nur der Kopf unterscheidet sich).
# Per SSH auf der NAS ausführen:
#   curl -fsSL https://github.com/Revilo91/GoldRegenDB_Web/releases/latest/download/install.sh | sudo bash
#   sudo bash install.sh                 # neuestes Release
#   sudo bash install.sh v1.2.3          # bestimmtes Release
#   sudo bash install.sh --rollback      # zurück auf die Version vor dem letzten Update
#   sudo INSTALL_DIR=/volume1/docker/x bash install.sh
#
# Ablauf: Release ermitteln, laden, Image ziehen (noch nichts verändert) ->
#   1. DB sichern  2. Ordner anlegen  3. Stack stoppen, alte Images löschen ->
#   4. Release-Dateien einspielen  5. Starten + Health-Check (bei Fehler: Rollback).
# Volumes und bestehende .env-Werte werden nie gelöscht oder überschrieben.
# =============================================================================

# Braucht bash im Normalmodus; sonst neu starten (Zeilen POSIX-kompatibel halten).
case ":${SHELLOPTS:-}:" in *posix*) POSIX_MODE=1 ;; *) POSIX_MODE= ;; esac
if [ -z "${BASH_VERSION:-}" ] || [ -n "$POSIX_MODE" ]; then
  if [ -f "$0" ]; then exec env -u SHELLOPTS bash "$0" "$@"; fi
  exec env -u SHELLOPTS bash -s -- "$@"
fi

set -euo pipefail

# --- Projekt-Konfiguration (einziger Teil, der je Projekt abweicht) ----------
PROJEKT="goldregendb"
REPO="Revilo91/GoldRegenDB_Web"                              # GitHub owner/name
IMAGE_REPO="ghcr.io/revilo91/goldregendb"                  # ghcr.io/…, ohne Tag
APP_SERVICE="app"
DB_SERVICE="db"
DEFAULT_PORT=3000                  # Host-Port, .env-Variable APP_PORT
DATA_SUBDIRS=(data/postgres backups db)              # relativ zu INSTALL_DIR, z. B. data/postgres backups
SECRET_KEYS=(DB_PASSWORD JWT_SECRET BESTELLUNG_ENCRYPTION_KEY)                # werden bei Erstinstallation erzeugt
SHOW_KEYS=()                    # werden am Ende der Erstinstallation angezeigt
EXTRA_ASSETS=(init.sql:db/init.sql backup.sh:db/backup.sh restore.sh:db/restore.sh)              # "Release-Datei:Ziel relativ zu INSTALL_DIR"
ENV_RENAMES=(APP_HOST_PORT:APP_PORT)                # "ALT:NEU" – Wert wird in der .env übernommen, falls NEU fehlt

# --- Standard (für alle Projekte gleich) -------------------------------------
INSTALL_DIR="${INSTALL_DIR:-/volume1/docker/$PROJEKT}"
GITHUB_API="${GITHUB_API:-https://api.github.com}"
GITHUB_DL="${GITHUB_DL:-https://github.com}"
ASSETS=(docker-compose.yml .env.example)     # install.sh selbst wird nicht ersetzt
PREVIOUS_TAG="previous"
BACKUP_KEEP=10
SECRET_BYTES=32
PLACEHOLDER_RE='change|replace|xxx|^<'
HEALTH_TIMEOUT_S="${HEALTH_TIMEOUT_S:-120}"
HEALTH_POLL_S="${HEALTH_POLL_S:-5}"
APP_CONTAINER="$PROJEKT-app"

log()  { printf '\n==> %s\n' "$*"; }
fail() { printf '\nFEHLER: %s\n' "$*" >&2; exit 1; }

usage() { sed -n '3,11p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//'; }

random_secret() { openssl rand -hex "$SECRET_BYTES"; }

env_value() { # env_value KEY -> Wert aus .env (ohne Anführungszeichen)
  { grep -E "^$1=" .env || true; } | tail -n1 | cut -d= -f2- | tr -d "\"'"
}

set_env_value() { # set_env_value KEY VALUE (ersetzt oder hängt an)
  if grep -qE "^$1=" .env; then
    sed -i "s|^$1=.*|$1=$2|" .env
  else
    printf '%s=%s\n' "$1" "$2" >> .env
  fi
}

is_secret_key() {
  local key
  for key in "${SECRET_KEYS[@]}"; do [[ "$1" == "$key" ]] && return 0; done
  return 1
}

# Leer = fehlt; Platzhalter (CHANGE/REPLACE/…) zählen nur bei der Erstinstallation.
needs_secret() {
  local value
  value="$(env_value "$1" | tr '[:upper:]' '[:lower:]')"
  [[ -z "$value" ]] && return 0
  [[ "$FIRST_INSTALL" == true ]] && [[ "$value" =~ $PLACEHOLDER_RE ]] && return 0
  return 1
}

# Ergänzt Variablen aus .env.example, die in .env fehlen; Secrets werden erzeugt.
merge_env_defaults() {
  local line key added=0 active_re='^([A-Z][A-Z0-9_]*)='
  while IFS= read -r line; do
    [[ "$line" =~ $active_re ]] || continue
    key="${BASH_REMATCH[1]}"
    grep -qE "^#?[[:space:]]*$key=" .env && continue
    if is_secret_key "$key"; then continue; fi
    printf '%s\n' "$line" >> .env
    added=$((added + 1))
  done < .env.example
  (( added == 0 )) || echo "$added neue Variable(n) in .env ergänzt (bei Bedarf anpassen)."
  for key in "${SECRET_KEYS[@]}"; do
    if needs_secret "$key"; then set_env_value "$key" "$(random_secret)"; GENERATED+=("$key"); fi
  done
}

wait_for_health() { # wait_for_health SERVICE -> 0 = gesund (ohne Healthcheck: läuft)
  local id state="" elapsed=0
  id="$("${DC[@]}" ps -q "$1")"
  [[ -n "$id" ]] || return 1
  while (( elapsed < HEALTH_TIMEOUT_S )); do
    state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id")"
    [[ "$state" == "healthy" || "$state" == "running" ]] && return 0
    sleep "$HEALTH_POLL_S"
    elapsed=$((elapsed + HEALTH_POLL_S))
  done
  echo "Letzter Status ($1): ${state:-unbekannt}"
  return 1
}

dump_db() { # dump_db DATEI
  # </dev/null: bei `curl | bash` ist stdin das Skript selbst, exec -T würde es sonst verschlucken.
  "${DC[@]}" exec -T "$DB_SERVICE" sh -c 'pg_dump --no-owner --no-privileges -U "$POSTGRES_USER" "$POSTGRES_DB"' </dev/null | gzip > "$1" \
    && [[ -s "$1" ]]
}

restore_dump() { # restore_dump DATEI -> legt die DB neu an und spielt den Dump ein
  "${DC[@]}" exec -T "$DB_SERVICE" sh -c \
    'psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS \"$POSTGRES_DB\" WITH (FORCE)" -c "CREATE DATABASE \"$POSTGRES_DB\""' </dev/null
  gzip -dc "$1" | "${DC[@]}" exec -T "$DB_SERVICE" sh -c 'psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
}

previous_image_exists() { docker image inspect "$IMAGE_REPO:$PREVIOUS_TAG" >/dev/null 2>&1; }

start_with_tag() { # start_with_tag TAG -> setzt APP_VERSION, startet, wartet auf Health
  set_env_value APP_VERSION "$1"
  "${DC[@]}" up -d --remove-orphans
  wait_for_health "$APP_SERVICE"
}

report_success() {
  local port
  port="$(env_value APP_PORT || true)"
  log "Fertig: $PROJEKT läuft auf Port ${port:-$DEFAULT_PORT} (Version: $(env_value APP_VERSION))"
}

# --- Argumente und Voraussetzungen -------------------------------------------
MODE="update"
TAG=""
case "${1:-}" in
  -h|--help) usage; exit 0 ;;
  --rollback) MODE="rollback" ;;
  ""|latest) ;;
  *) TAG="${1}" ;;
esac
if [[ -n "$TAG" ]]; then
  [[ "$TAG" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$ ]] || fail "'$TAG' ist keine Versionsnummer (erwartet z. B. v1.2.3)."
fi

[[ "$(id -u)" -eq 0 ]] || fail "Bitte mit root ausführen: sudo bash install.sh"
command -v curl >/dev/null 2>&1 || fail "curl nicht gefunden."
command -v openssl >/dev/null 2>&1 || fail "openssl nicht gefunden."
if docker compose version >/dev/null 2>&1; then
  DC=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  DC=(docker-compose)
else
  fail "Weder 'docker compose' noch 'docker-compose' gefunden. Container Manager installieren."
fi

GENERATED=()
FIRST_INSTALL=false

# --- Rollback-Modus ----------------------------------------------------------
if [[ "$MODE" == "rollback" ]]; then
  [[ -f "$INSTALL_DIR/.env" ]] || fail "Keine .env in $INSTALL_DIR - nichts zum Zurückrollen."
  previous_image_exists || fail "Kein Image $IMAGE_REPO:$PREVIOUS_TAG vorhanden (noch kein Update gelaufen?)."
  cd "$INSTALL_DIR"
  log "Rollback auf $IMAGE_REPO:$PREVIOUS_TAG"
  start_with_tag "$PREVIOUS_TAG" || fail "Nach dem Rollback nicht gesund. Logs: cd $INSTALL_DIR && ${DC[*]} logs $APP_SERVICE"
  report_success
  echo "Die Datenbank wurde nicht verändert. Sicherungen: $INSTALL_DIR/backups/"
  exit 0
fi

# --- 0. Release ermitteln, laden, Image ziehen (noch nichts verändert) -------
if [[ -z "$TAG" ]]; then
  log "Ermittle neuestes Release von $REPO"
  RELEASE_JSON="$(curl -fsSL "$GITHUB_API/repos/$REPO/releases/latest")" \
    || fail "GitHub-API nicht erreichbar oder kein Release vorhanden. Version angeben: sudo bash install.sh v1.2.3"
  TAG="$(sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' <<< "$RELEASE_JSON" | head -n1)"
  [[ -n "$TAG" ]] || fail "Release-Tag konnte nicht gelesen werden."
fi
RELEASE_TAG="$TAG"
VERSION="${TAG#v}"
log "Release: $RELEASE_TAG (Image-Tag: $VERSION)"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
download_asset() { # download_asset DATEI
  curl -fsSL "$GITHUB_DL/$REPO/releases/download/$RELEASE_TAG/$1" -o "$STAGE/$1" \
    || fail "Release-Datei '$1' nicht ladbar ($RELEASE_TAG). Nichts wurde verändert."
}
for asset in "${ASSETS[@]}"; do download_asset "$asset"; done
for entry in ${EXTRA_ASSETS[@]+"${EXTRA_ASSETS[@]}"}; do download_asset "${entry%%:*}"; done

log "Ziehe Image $IMAGE_REPO:$VERSION"
docker pull "$IMAGE_REPO:$VERSION" || fail "Image-Download fehlgeschlagen - die laufende Version wurde nicht angefasst."

mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"
[[ -f .env ]] || FIRST_INSTALL=true

# DATA_DIR aus älteren Installationen darf nicht woanders hinzeigen, sonst startet eine leere DB.
if [[ "$FIRST_INSTALL" == false ]]; then
  OLD_DATA_DIR="$(env_value DATA_DIR || true)"
  if [[ -n "$OLD_DATA_DIR" && "${OLD_DATA_DIR%/}" != "${INSTALL_DIR%/}" ]]; then
    fail "DATA_DIR=$OLD_DATA_DIR in .env weicht von $INSTALL_DIR ab. Daten dorthin verschieben oder mit INSTALL_DIR=$OLD_DATA_DIR starten."
  fi
fi

# --- 1. Datenbank sichern ----------------------------------------------------
mkdir -p backups
DB_WAS_RUNNING=false
BACKUP_FILE=""
if [[ "$FIRST_INSTALL" == false && -f docker-compose.yml ]]; then
  RUNNING_SERVICES="$("${DC[@]}" ps --status running --services 2>/dev/null || true)"
  if grep -qx "$DB_SERVICE" <<< "$RUNNING_SERVICES"; then
    DB_WAS_RUNNING=true
    BACKUP_FILE="backups/pre-update_$(date +%Y%m%d_%H%M%S).sql.gz"
    log "1/5 Sichere Datenbank nach $INSTALL_DIR/$BACKUP_FILE"
    if dump_db "$BACKUP_FILE"; then
      chmod 600 "$BACKUP_FILE"
      ls -1t backups/pre-update_*.sql.gz 2>/dev/null | tail -n +"$((BACKUP_KEEP + 1))" | xargs -r rm -f --
    else
      rm -f "$BACKUP_FILE"
      fail "DB-Sicherung fehlgeschlagen - Update abgebrochen, nichts wurde verändert."
    fi
  fi
fi
[[ -n "$BACKUP_FILE" ]] || log "1/5 Keine laufende Datenbank - Sicherung übersprungen."

# --- 2. Fehlende Ordner anlegen ----------------------------------------------
log "2/5 Lege fehlende Ordner an"
DB_DIR_EMPTY=false
for dir in "${DATA_SUBDIRS[@]}"; do mkdir -p "$dir"; done
[[ -z "$(ls -A data/postgres 2>/dev/null || true)" ]] && DB_DIR_EMPTY=true
# Alte DB lag woanders (z. B. Docker-Volume): nach dem Start per Dump übernehmen.
MIGRATE_FROM_DUMP=false
[[ "$DB_WAS_RUNNING" == true && "$DB_DIR_EMPTY" == true ]] && MIGRATE_FROM_DUMP=true

# --- 3. Stack stoppen, alte Images löschen -----------------------------------
log "3/5 Stoppe Stack und entferne alte Images"
HAVE_ROLLBACK=false
if [[ -f docker-compose.yml ]]; then
  RUNNING_APP_ID="$("${DC[@]}" ps -q "$APP_SERVICE" 2>/dev/null || true)"
  if [[ -n "$RUNNING_APP_ID" ]]; then
    docker tag "$(docker inspect -f '{{.Image}}' "$RUNNING_APP_ID")" "$IMAGE_REPO:$PREVIOUS_TAG"
    HAVE_ROLLBACK=true
  fi
  "${DC[@]}" down
fi
# Alle Tags des Images außer neuer Version und :previous entfernen (Volumes bleiben).
while IFS= read -r ref; do
  [[ -z "$ref" || "$ref" == "$IMAGE_REPO:$VERSION" || "$ref" == "$IMAGE_REPO:$PREVIOUS_TAG" ]] && continue
  docker rmi "$ref" >/dev/null 2>&1 || echo "Hinweis: $ref konnte nicht entfernt werden."
done < <(docker images --format '{{.Repository}}:{{.Tag}}' "$IMAGE_REPO")

# --- 4. Release-Dateien einspielen -------------------------------------------
log "4/5 Spiele Release $RELEASE_TAG ein"
if [[ -f docker-compose.yml ]] && ! cmp -s docker-compose.yml "$STAGE/docker-compose.yml"; then
  cp docker-compose.yml docker-compose.yml.bak
  echo "docker-compose.yml hat sich geändert (Alt-Stand: docker-compose.yml.bak)"
fi
cp "$STAGE/docker-compose.yml" docker-compose.yml
cp "$STAGE/.env.example" .env.example
for entry in ${EXTRA_ASSETS[@]+"${EXTRA_ASSETS[@]}"}; do
  mkdir -p "$(dirname "${entry#*:}")"
  cp "$STAGE/${entry%%:*}" "${entry#*:}"
  # Downloads sind nicht ausführbar; Skripte laufen z. B. im DB-Container direkt.
  if [[ "${entry#*:}" == *.sh ]]; then chmod +x "${entry#*:}"; fi
done

umask 077
if [[ "$FIRST_INSTALL" == true ]]; then
  cp .env.example .env
else
  cp .env .env.bak
fi
for entry in ${ENV_RENAMES[@]+"${ENV_RENAMES[@]}"}; do
  old_key="${entry%%:*}"; new_key="${entry#*:}"
  if grep -qE "^$old_key=" .env && ! grep -qE "^$new_key=" .env; then set_env_value "$new_key" "$(env_value "$old_key")"; fi
done
merge_env_defaults
(( ${#GENERATED[@]} == 0 )) || echo "Neue Secrets erzeugt: ${GENERATED[*]}"
set_env_value APP_VERSION "$VERSION"
chmod 600 .env .env.bak 2>/dev/null || true

# --- 5. Starten und prüfen ---------------------------------------------------
log "5/5 Starte $PROJEKT"
if [[ "$MIGRATE_FROM_DUMP" == true ]]; then
  echo "Alte Datenbank lag nicht in ./data/postgres - übernehme Sicherung $BACKUP_FILE"
  "${DC[@]}" up -d "$DB_SERVICE"
  wait_for_health "$DB_SERVICE" || fail "DB wurde nicht gesund. Sicherung: $INSTALL_DIR/$BACKUP_FILE"
  restore_dump "$BACKUP_FILE" || fail "Einspielen der Sicherung fehlgeschlagen. Sicherung: $INSTALL_DIR/$BACKUP_FILE; altes Volume ist unverändert."
fi
if ! start_with_tag "$VERSION"; then
  "${DC[@]}" logs --tail 30 "$APP_SERVICE" || true
  if [[ "$HAVE_ROLLBACK" == true ]] && previous_image_exists; then
    log "Neue Version nicht gesund - Rollback auf $IMAGE_REPO:$PREVIOUS_TAG"
    start_with_tag "$PREVIOUS_TAG" && fail "Version $VERSION wurde nicht gesund; die alte Version läuft wieder. Sicherung: ${BACKUP_FILE:-keine}"
    fail "Auch der Rollback wurde nicht gesund. Logs: cd $INSTALL_DIR && ${DC[*]} logs $APP_SERVICE. Sicherung: ${BACKUP_FILE:-keine}"
  fi
  fail "App wurde nicht gesund, kein Vorgänger-Image vorhanden. Logs: cd $INSTALL_DIR && ${DC[*]} logs $APP_SERVICE"
fi
docker image prune -f >/dev/null

report_success
if [[ "$FIRST_INSTALL" == true ]]; then
  echo "Secrets liegen in $INSTALL_DIR/.env - sichern, nicht weitergeben."
  for key in ${SHOW_KEYS[@]+"${SHOW_KEYS[@]}"}; do echo "  $key=$(env_value "$key")"; done
fi
