#!/usr/bin/env bash
# Startet ein Release-ZIP so, wie es auf der Synology läuft, und prüft die App.
# Verwendung: scripts/release-smoke-test.sh <goldregendb-synology-*.zip>
#
# Das App-Image (IMAGE_TAG aus der .env.example des Pakets) muss lokal vorliegen
# (docker load / docker build) – es wird nie aus der Registry gezogen.
# Optional: SMOKE_PROJECT (Compose-Projektname), SMOKE_APP_PORT, SMOKE_DB_PORT,
# SMOKE_TIMEOUT (Sekunden, bis /api/health 200 liefern muss).
set -euo pipefail

ZIP="$(realpath "${1:?Verwendung: $0 <goldregendb-synology-*.zip>}")"
PROJEKT="${SMOKE_PROJECT:-goldregendb-smoke}"
APP_PORT="${SMOKE_APP_PORT:-3000}"
DB_PORT="${SMOKE_DB_PORT:-15432}"
TIMEOUT="${SMOKE_TIMEOUT:-180}"
BASE="http://127.0.0.1:${APP_PORT}"

ARBEIT="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/goldregendb-smoke.XXXXXX")"
DATA_DIR="$ARBEIT/daten"
PAKET=""
ERFOLG=0

compose() { docker compose -f "$PAKET/docker-compose.yml" -p "$PROJEKT" "$@"; }

aufraeumen() {
  if [ -n "$PAKET" ]; then
    if [ "$ERFOLG" -ne 1 ]; then
      echo "──── docker compose logs ────"
      compose logs --no-color || true
    fi
    compose down -v --remove-orphans || true
    # data/ gehört dem postgres-Benutzer, das Import-Log root – daher im Container löschen.
    docker run --rm -v "$ARBEIT:/arbeit" postgres:16-alpine rm -rf /arbeit/daten /arbeit/import || true
  fi
  rm -rf "$ARBEIT"
}
trap aufraeumen EXIT

fehler() { echo "FEHLER: $*" >&2; exit 1; }

setze() {
  sed -i "s|^$1=.*|$1=$2|" "$PAKET/.env"
  grep -qxF "$1=$2" "$PAKET/.env" || fehler "$1 fehlt in der .env.example des Pakets"
}

unzip -q "$ZIP" -d "$ARBEIT"
PAKET="$(find "$ARBEIT" -mindepth 1 -maxdepth 1 -type d -name 'goldregendb-synology-*')"
[ -f "$PAKET/docker-compose.yml" ] || fehler "kein goldregendb-synology-*/docker-compose.yml in $ZIP"

# Einmal-Secrets wie bei einer echten Installation. Hex, weil Compose das
# Passwort unkodiert in DATABASE_URL einsetzt.
cp "$PAKET/.env.example" "$PAKET/.env"
setze DATA_DIR "$DATA_DIR"
setze APP_HOST_PORT "$APP_PORT"
setze DB_HOST_PORT "$DB_PORT"
setze DB_PASSWORD "$(openssl rand -hex 16)"
setze JWT_SECRET "$(openssl rand -hex 32)"
setze BESTELLUNG_ENCRYPTION_KEY "$(openssl rand -hex 32)"
if grep -nE '^[^#]*(change-this|changeme)' "$PAKET/.env"; then
  fehler "Platzhalter in der .env.example, die dieser Test nicht ersetzt"
fi

APP_IMAGE="$(compose config --images | grep '/goldregendb:')"
docker image inspect "$APP_IMAGE" >/dev/null 2>&1 \
  || fehler "$APP_IMAGE liegt lokal nicht vor (docker load oder docker build)"
echo "Teste $APP_IMAGE mit $(basename "$ZIP")"

compose pull --quiet db
compose up -d --pull never

echo "Warte auf $BASE/api/health (max. ${TIMEOUT}s) ..."
ende=$((SECONDS + TIMEOUT))
until [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/health" || true)" = 200 ]; do
  [ "$SECONDS" -lt "$ende" ] || fehler "/api/health liefert nach ${TIMEOUT}s kein 200"
  sleep 3
done
echo "ok   /api/health"

curl -fsS "$BASE/" | grep -qi '<!doctype html' || fehler "GET / liefert kein HTML"
echo "ok   GET / liefert HTML"

# Admin aus init.sql (admin/admin, must_change_password). Wäre seed.sql
# eingespielt worden, stimmten Passwort und Flag nicht.
login="$(curl -fsS -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin"}' "$BASE/api/auth/login")" \
  || fehler "Login admin/admin fehlgeschlagen"
TOKEN="$(jq -er .token <<<"$login")" || fehler "Login-Antwort ohne Token"
[ "$(jq -r .mustChangePassword <<<"$login")" = true ] \
  || fehler "Admin aus init.sql sollte mustChangePassword=true haben"
echo "ok   Login admin (mustChangePassword=true)"

api() { curl -fsS -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' "$@"; }

if [ "$(api "$BASE/api/schmuckstuecke?limit=1" | jq -r .pagination.total)" = 0 ]; then
  api -d '{"Artikelnummer":"MHO","Name":"Smoke-Test","Verkaufspreis":1}' \
    "$BASE/api/schmuckstuecke" >/dev/null || fehler "Schmuckstück anlegen fehlgeschlagen"
fi
anzahl="$(api "$BASE/api/schmuckstuecke" | jq -r '.data | length')"
[ "$anzahl" -ge 1 ] || fehler "GET /api/schmuckstuecke liefert keine Daten"
echo "ok   GET /api/schmuckstuecke ($anzahl Einträge)"

# Bestandsimport (#209) wie in der README: Skript liegt im Image, liest einen
# eingebundenen Ordner und schreibt das Foto in die Datenbank.
nummer="$(api "$BASE/api/schmuckstuecke?limit=1" | jq -er '.data[0].Artikelnummer')"
mkdir -p "$ARBEIT/import"
printf '\xff\xd8\xff\xe0\x00\x10JFIF\x00' > "$ARBEIT/import/${nummer%%_*}.jpg"
compose run --rm -T -v "$ARBEIT/import:/import" app \
  node scripts/import-fotos.js --dir /import --log /import/import-fotos.log \
  || fehler "import-fotos.js im Image fehlgeschlagen"
api "$BASE/api/schmuckstuecke/foto/$nummer" -o /dev/null \
  || fehler "Foto für $nummer nach dem Import nicht abrufbar"
echo "ok   import-fotos.js importiert Foto für $nummer"

compose exec -T db /backup.sh || fehler "backup.sh fehlgeschlagen"
ls "$DATA_DIR"/backups/daily/*.sql.gz >/dev/null 2>&1 \
  || fehler "backup.sh hat keine Datei unter DATA_DIR/backups/daily erzeugt"
echo "ok   backup.sh schreibt nach DATA_DIR/backups"

ERFOLG=1
echo "Smoke-Test bestanden."
