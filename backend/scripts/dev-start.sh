#!/bin/sh
set -eu

HASH_FILE="/app/node_modules/.package-json.sha256"
CURRENT_HASH="$(sha256sum /app/package.json | awk '{print $1}')"

if [ ! -d /app/node_modules ] || [ ! -f "$HASH_FILE" ] || [ "$(cat "$HASH_FILE")" != "$CURRENT_HASH" ]; then
  echo "[backend-fix] package.json geändert oder node_modules fehlt – installiere Abhängigkeiten..."
  npm install
  mkdir -p /app/node_modules
  printf "%s" "$CURRENT_HASH" > "$HASH_FILE"
else
  echo "[backend-fix] Abhängigkeiten aktuell."
fi

exec npm run dev