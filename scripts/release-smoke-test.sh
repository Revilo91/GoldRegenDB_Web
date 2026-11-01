#!/usr/bin/env bash
# Startet die Release-Assets so, wie install.sh sie auf der Synology anlegt, und prüft die App.
# Verwendung: scripts/release-smoke-test.sh <asset-ordner> <version>
#   <asset-ordner>  Ausgabe von scripts/build-release-package.sh
#   <version>       Image-Tag ohne "v" (APP_VERSION), z. B. 1.2.3
#
# Das App-Image muss lokal vorliegen (docker load / docker build) – es wird nie
# aus der Registry gezogen.
# Optional: SMOKE_PROJECT (Compose-Projektname), SMOKE_APP_PORT, SMOKE_DB_PORT,
# SMOKE_TIMEOUT (Sekunden, bis /api/health 200 liefern muss).
set -euo pipefail

ASSETS="$(realpath "${1:?Verwendung: $0 <asset-ordner> <version>}")"
VERSION="${2:?Verwendung: $0 <asset-ordner> <version>}"
PROJEKT="${SMOKE_PROJECT:-goldregendb-smoke}"
APP_PORT="${SMOKE_APP_PORT:-3000}"
DB_PORT="${SMOKE_DB_PORT:-15432}"
TIMEOUT="${SMOKE_TIMEOUT:-180}"
BASE="http://127.0.0.1:${APP_PORT}"

ARBEIT="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/goldregendb-smoke.XXXXXX")"
PAKET="$ARBEIT/install"
ERFOLG=0

compose() { docker compose -f "$PAKET/docker-compose.yml" -p "$PROJEKT" "$@"; }

aufraeumen() {
  if [ -f "$PAKET/docker-compose.yml" ]; then
    if [ "$ERFOLG" -ne 1 ]; then
      echo "──── docker compose logs ────"
      compose logs --no-color || true
    fi
    compose down -v --remove-orphans || true
    # data/ gehört dem postgres-Benutzer, das Import-Log root – daher im Container löschen.
    docker run --rm -v "$ARBEIT:/arbeit" postgres:16-alpine rm -rf /arbeit/install /arbeit/import || true
  fi
  rm -rf "$ARBEIT"
}
trap aufraeumen EXIT

fehler() { echo "FEHLER: $*" >&2; exit 1; }

setze() {
  sed -i "s|^$1=.*|$1=$2|" "$PAKET/.env"
  grep -qxF "$1=$2" "$PAKET/.env" || fehler "$1 fehlt in der .env.example des Pakets"
}

# Layout wie install.sh: Assets flach laden, db-Dateien nach db/, Daten relativ zum Ordner.
for datei in docker-compose.yml .env.example install.sh init.sql backup.sh restore.sh; do
  [ -f "$ASSETS/$datei" ] || fehler "Release-Asset $datei fehlt in $ASSETS"
done
mkdir -p "$PAKET/db" "$PAKET/data/postgres" "$PAKET/backups"
cp "$ASSETS/docker-compose.yml" "$ASSETS/.env.example" "$PAKET/"
cp "$ASSETS/init.sql" "$ASSETS/backup.sh" "$ASSETS/restore.sh" "$PAKET/db/"
chmod +x "$PAKET/db/backup.sh" "$PAKET/db/restore.sh"

# Einmal-Secrets wie bei einer echten Installation (install.sh: openssl rand -hex 32).
cp "$PAKET/.env.example" "$PAKET/.env"
setze APP_VERSION "$VERSION"
setze APP_PORT "$APP_PORT"
setze DB_HOST_PORT "$DB_PORT"
setze POSTGRES_PASSWORD "$(openssl rand -hex 32)"
setze JWT_SECRET "$(openssl rand -hex 32)"
setze BESTELLUNG_ENCRYPTION_KEY "$(openssl rand -hex 32)"
if grep -nE '^[^#]*(change-this|changeme)' "$PAKET/.env"; then
  fehler "Platzhalter in der .env.example, die dieser Test nicht ersetzt"
fi

APP_IMAGE="$(compose config --images | grep '/goldregendb:')"
docker image inspect "$APP_IMAGE" >/dev/null 2>&1 \
  || fehler "$APP_IMAGE liegt lokal nicht vor (docker load oder docker build)"
echo "Teste $APP_IMAGE mit den Release-Assets aus $ASSETS"

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

# App anhalten: Backup und Zeilenvergleich unten sehen so denselben Stand
# (kein Hintergrundschreiben) und restore.sh trifft keine laufende Verbindung der App.
compose stop app || fehler "App-Container ließ sich nicht anhalten"

compose exec -T db /backup.sh || fehler "backup.sh fehlgeschlagen"
ls "$PAKET"/backups/daily/*.sql.gz >/dev/null 2>&1 \
  || fehler "backup.sh hat keine Datei unter ./backups/daily erzeugt"
echo "ok   backup.sh schreibt nach ./backups"

# Restore-Test (#289): das frische Backup mit dem echten restore.sh in eine
# Wegwerf-Datenbank einspielen und die Zeilenzahlen aller Tabellen mit der Quelle
# vergleichen. restore.sh liest den Zielnamen aus POSTGRES_DB, daher genügt es, ihn
# nur für diesen Aufruf zu überschreiben. Der pg_dump-Dump darf weder CREATE/DROP
# DATABASE noch \connect enthalten (wird unten geprüft), sonst würde er die
# Zieldatenbank umgehen. Die Quelldatenbank bleibt unberührt.
QUELL_DB="$(compose exec -T db printenv POSTGRES_DB | tr -d '\r')"
DB_BENUTZER="$(compose exec -T db printenv POSTGRES_USER | tr -d '\r')"
[ -n "$QUELL_DB" ] && [ -n "$DB_BENUTZER" ] || fehler "POSTGRES_DB/POSTGRES_USER im db-Container nicht lesbar"
TEST_DB="${QUELL_DB}_restore_test"
# Harter Namensschutz: restore.sh macht DROP DATABASE auf dem Ziel.
case "$TEST_DB" in
  *_restore_test) ;;
  *) fehler "Restore-Ziel '$TEST_DB' endet nicht auf _restore_test – Abbruch" ;;
esac
[ "$TEST_DB" != "$QUELL_DB" ] || fehler "Restore-Ziel '$TEST_DB' ist die Quelldatenbank – Abbruch"

backup_datei="$(basename "$(ls -t "$PAKET"/backups/daily/*.sql.gz | head -n 1)")"
dump_zeilen="$(compose exec -T db sh -c \
  "gunzip -c '/backups/daily/$backup_datei' | grep -cE '^(.connect|CREATE DATABASE|DROP DATABASE)' || true" | tr -d '\r')"
[ "$dump_zeilen" = 0 ] \
  || fehler "Dump enthält CREATE/DROP DATABASE oder \\connect ($dump_zeilen Zeilen) – würde die Zieldatenbank umgehen"

# Zeilenzahl je Tabelle im Schema public ("tabelle anzahl", sortiert).
zeilenzahlen() {
  compose exec -T db psql -U "$DB_BENUTZER" -d "$1" -v ON_ERROR_STOP=1 -At -F ' ' -c \
    "SELECT table_name, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text
       FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name COLLATE \"C\"" | tr -d '\r'
}

quelle_zahlen="$(zeilenzahlen "$QUELL_DB")" || fehler "Zeilenzahlen der Quelldatenbank nicht lesbar"
tabellen="$(wc -l <<<"$quelle_zahlen")"
[ "$tabellen" -ge 1 ] || fehler "Quelldatenbank liefert keine Tabellen im Schema public"

restore_start=$(date +%s%N)
compose exec -T -e POSTGRES_DB="$TEST_DB" -e SICHERUNG_DIR=/tmp/vor-restore-test db \
  /restore.sh "/backups/daily/$backup_datei" --yes \
  || fehler "restore.sh in $TEST_DB fehlgeschlagen"
restore_ms=$((($(date +%s%N) - restore_start) / 1000000))

test_zahlen="$(zeilenzahlen "$TEST_DB")" || fehler "Zeilenzahlen von $TEST_DB nicht lesbar"
if [ "$test_zahlen" != "$quelle_zahlen" ]; then
  echo "Zeilenzahlen weichen ab (< Quelle, > Restore):" >&2
  diff <(echo "$quelle_zahlen") <(echo "$test_zahlen") >&2 || true
  fehler "Restore-Test: Zeilenzahlen von $TEST_DB weichen von $QUELL_DB ab"
fi
# Die Quelle muss nach dem Restore unverändert sein.
[ "$(zeilenzahlen "$QUELL_DB")" = "$quelle_zahlen" ] \
  || fehler "Quelldatenbank $QUELL_DB hat sich während des Restore-Tests verändert"

compose exec -T db psql -U "$DB_BENUTZER" -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE \"$TEST_DB\"" >/dev/null \
  || fehler "Wegwerf-Datenbank $TEST_DB ließ sich nicht entfernen"
echo "ok   Restore-Test: $backup_datei -> $TEST_DB, $tabellen Tabellen mit gleicher Zeilenzahl, Restore-Dauer $((restore_ms / 1000)),$(printf %03d $((restore_ms % 1000)))s (Testdaten, nicht Produktiv)"

ERFOLG=1
echo "Smoke-Test bestanden."
