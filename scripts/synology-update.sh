#!/bin/bash
# ============================================================
# GoldRegenDB – Synology Update Script
# Zieht die neuesten Docker-Images und startet die Container neu.
# Verwendung: ./synology-update.sh
# ============================================================

set -e

DEPLOY_DIR="/volume1/docker/goldregendb"

# Farbige Ausgabe
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}╔══════════════════════════════════════════╗${NC}"
echo -e "${YELLOW}║   GoldRegenDB – Synology Update          ║${NC}"
echo -e "${YELLOW}╚══════════════════════════════════════════╝${NC}"
echo ""

# Prüfen ob das Verzeichnis existiert
if [ ! -d "$DEPLOY_DIR" ]; then
    echo -e "${RED}Fehler: Verzeichnis $DEPLOY_DIR existiert nicht.${NC}"
    exit 1
fi

cd "$DEPLOY_DIR"

# Prüfen ob docker-compose.yml vorhanden
if [ ! -f "docker-compose.yml" ]; then
    echo -e "${RED}Fehler: docker-compose.yml nicht gefunden in $DEPLOY_DIR${NC}"
    exit 1
fi

# 1. Neueste Images herunterladen
echo -e "${GREEN}[1/3]${NC} Neueste Images werden heruntergeladen..."
docker compose pull
echo ""

# 2. Container stoppen und entfernen
echo -e "${GREEN}[2/3]${NC} Container werden gestoppt..."
docker compose down
echo ""

# 3. Container mit neuen Images starten
echo -e "${GREEN}[3/3]${NC} Container werden mit neuen Images gestartet..."
docker compose up -d
echo ""

# Status anzeigen
echo -e "${GREEN}✓ Update abgeschlossen!${NC}"
echo ""
echo "Container-Status:"
docker compose ps
echo ""
echo -e "${YELLOW}Tipp:${NC} Logs anzeigen mit: docker compose logs -f"
