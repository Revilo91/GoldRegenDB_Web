#!/usr/bin/env bash
# Baut das Synology-Release-ZIP ausschließlich aus Dateien im Repository.
# Verwendung: scripts/build-release-package.sh <version> [ausgabeverzeichnis]
#   <version>  Git-Tag, z. B. v1.2.3. IMAGE_TAG wird ohne führendes "v"
#              eingetragen, denn so taggt docker/metadata-action
#              (type=semver,pattern={{version}}) das Image in GHCR.
set -euo pipefail

VERSION="${1:?Verwendung: $0 <version> [ausgabeverzeichnis]}"
AUSGABE="${2:-dist}"
IMAGE_TAG="${VERSION#v}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE="$REPO/docker-compose.synology.yml"
VORLAGE="$REPO/deploy/synology"

# Jede ${VAR} ohne Default (auch ${VAR:?...}) muss die .env-Vorlage setzen,
# sonst startet das Paket mit leeren Werten.
fehlend=""
for var in $(grep -v '^[[:space:]]*#' "$COMPOSE" \
    | grep -oE '\$\{[A-Za-z_][A-Za-z0-9_]*(:?\?[^}]*)?\}' \
    | sed -E 's/^\$\{([A-Za-z0-9_]+).*/\1/' | sort -u); do
  grep -qE "^${var}=" "$VORLAGE/.env.example" || fehlend="$fehlend $var"
done
grep -qE '^IMAGE_TAG=' "$VORLAGE/.env.example" || fehlend="$fehlend IMAGE_TAG"
if [ -n "$fehlend" ]; then
  echo "FEHLER: $VORLAGE/.env.example setzt nicht:$fehlend" >&2
  exit 1
fi

NAME="goldregendb-synology-${VERSION}"
mkdir -p "$AUSGABE"
rm -rf "${AUSGABE:?}/$NAME" "$AUSGABE/$NAME.zip"
mkdir -p "$AUSGABE/$NAME/db"

cp "$COMPOSE" "$AUSGABE/$NAME/docker-compose.yml"
sed "s/^IMAGE_TAG=.*/IMAGE_TAG=${IMAGE_TAG}/" "$VORLAGE/.env.example" > "$AUSGABE/$NAME/.env.example"
cp "$VORLAGE/README.md" "$AUSGABE/$NAME/README.md"
cp "$REPO/db/init.sql" "$REPO/db/backup.sh" "$REPO/db/restore.sh" "$AUSGABE/$NAME/db/"

(cd "$AUSGABE" && zip -qr "$NAME.zip" "$NAME")
echo "$AUSGABE/$NAME.zip"
