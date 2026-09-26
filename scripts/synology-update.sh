#!/bin/bash
# ============================================================
# GoldRegenDB – Synology Update Script
# Setzt IMAGE_TAG in der .env, zieht das Image und startet die Container neu.
# Verwendung: ./synology-update.sh [version]
#   version  z. B. 0.3.0 oder v0.3.0. Ohne Angabe bleibt die eingetragene
#            Version. docker-compose.yml und db/ vorher aus dem Paket der
#            neuen Version übernehmen.
# Liegt im Release-Paket neben docker-compose.yml; DEPLOY_DIR überschreibt das.
# ============================================================

set -e

DEPLOY_DIR="${DEPLOY_DIR:-$(cd "$(dirname "$0")" && pwd)}"

# Farbige Ausgabe
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

fehler() {
    echo -e "${RED}Fehler: $1${NC}" >&2
    exit 1
}

echo -e "${YELLOW}╔══════════════════════════════════════════╗${NC}"
echo -e "${YELLOW}║   GoldRegenDB – Synology Update          ║${NC}"
echo -e "${YELLOW}╚══════════════════════════════════════════╝${NC}"
echo ""

[ -d "$DEPLOY_DIR" ] || fehler "Verzeichnis $DEPLOY_DIR existiert nicht."
cd "$DEPLOY_DIR"
[ -f "docker-compose.yml" ] || fehler "docker-compose.yml nicht gefunden in $DEPLOY_DIR"
[ -f ".env" ] || fehler ".env nicht gefunden in $DEPLOY_DIR (Vorlage: .env.example)"

# 1. Version festlegen – so, wie der Release-Workflow das Image taggt: ohne "v".
if [ -n "$1" ]; then
    TAG="${1#v}"
    [[ "$TAG" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$ ]] \
        || fehler "\"$1\" ist keine Versionsnummer (erwartet z. B. 0.3.0)."
    if grep -q '^IMAGE_TAG=' .env; then
        sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=${TAG}/" .env
    else
        echo "IMAGE_TAG=${TAG}" >> .env
    fi
fi
TAG="$(sed -n 's/^IMAGE_TAG=//p' .env | tail -n 1)"
[ -n "$TAG" ] || fehler "IMAGE_TAG fehlt in der .env. Version angeben: $0 0.3.0"
echo -e "${GREEN}[1/4]${NC} Version: ${TAG}"
echo ""

# 2. Image herunterladen
echo -e "${GREEN}[2/4]${NC} Images werden heruntergeladen..."
docker compose pull
echo ""

# 3. Container stoppen und entfernen
echo -e "${GREEN}[3/4]${NC} Container werden gestoppt..."
docker compose down
echo ""

# 4. Container mit neuen Images starten
echo -e "${GREEN}[4/4]${NC} Container werden mit neuen Images gestartet..."
docker compose up -d
echo ""

# Status anzeigen
echo -e "${GREEN}✓ Update abgeschlossen!${NC}"
echo ""
echo "Container-Status:"
docker compose ps
echo ""
echo -e "${YELLOW}Tipp:${NC} Logs anzeigen mit: docker compose logs -f"
