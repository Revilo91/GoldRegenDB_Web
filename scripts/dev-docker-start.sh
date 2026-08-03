#!/bin/sh
set -eu

HASH_FILE="/app/node_modules/.deps.sha256"
CURRENT_HASH="$(cat /app/package.json /app/backend/package.json /app/frontend/package.json | sha256sum | awk '{print $1}')"

if [ ! -d /app/node_modules ] || [ ! -f "$HASH_FILE" ] || [ "$(cat "$HASH_FILE")" != "$CURRENT_HASH" ]; then
  echo "[dev-docker] Abhängigkeiten geändert – installiere neu..."
  npm install
  mkdir -p /app/node_modules
  printf "%s" "$CURRENT_HASH" > "$HASH_FILE"
else
  echo "[dev-docker] Abhängigkeiten aktuell."
fi

exec npx concurrently -n "backend,frontend" -c "green,magenta" \
  "npm run dev -w backend" \
  "npm run dev -w frontend -- --host 0.0.0.0 --port 5173"
