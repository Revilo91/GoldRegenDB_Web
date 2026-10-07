#!/usr/bin/env bash
# Sammelt die Release-Assets (flache Dateinamen) aus dem Repository in einem Ordner.
# Verwendung: scripts/build-release-package.sh [ausgabeverzeichnis]   (Standard: dist/release)
set -euo pipefail

AUSGABE="${1:-dist/release}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE="$REPO/deploy/docker-compose.yml"
ENV_VORLAGE="$REPO/deploy/.env.example"

# Jede ${VAR} ohne Default (auch ${VAR:?...}) muss die .env-Vorlage setzen,
# sonst startet der Stack mit leeren Werten.
fehlend=""
for var in $(grep -v '^[[:space:]]*#' "$COMPOSE" \
    | grep -oE '\$\{[A-Za-z_][A-Za-z0-9_]*(:?\?[^}]*)?\}' \
    | sed -E 's/^\$\{([A-Za-z0-9_]+).*/\1/' | sort -u); do
  grep -qE "^${var}=" "$ENV_VORLAGE" || fehlend="$fehlend $var"
done
if [ -n "$fehlend" ]; then
  echo "FEHLER: $ENV_VORLAGE setzt nicht:$fehlend" >&2
  exit 1
fi

rm -rf "${AUSGABE:?}"
mkdir -p "$AUSGABE"
cp "$COMPOSE" "$ENV_VORLAGE" "$REPO/deploy/install.sh" \
   "$REPO/db/init.sql" "$REPO/db/backup.sh" "$REPO/db/restore.sh" "$AUSGABE/"
echo "$AUSGABE"
