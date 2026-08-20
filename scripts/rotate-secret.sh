#!/bin/bash
# ============================================================
# GoldRegenDB – Secret-Rotation
# Erzeugt ein neues zufälliges Secret und legt es unter ./secrets/ ab
# (für die datei-basierte Docker-Secrets-Variante, siehe docker-compose.yml).
# Wer stattdessen die .env-Datei pflegt, kopiert den ausgegebenen Wert einfach
# von Hand in die passende Variable.
#
# Verwendung:
#   ./scripts/rotate-secret.sh jwt_secret
#   ./scripts/rotate-secret.sh db_password
#   ./scripts/rotate-secret.sh bestellung_encryption_key
#
# Vollständiger Ablauf je Secret: siehe README.md, Abschnitt "Secrets rotieren".
# ============================================================
set -euo pipefail

NAME="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SECRETS_DIR="$SCRIPT_DIR/../secrets"

if [ -z "$NAME" ]; then
  echo "Verwendung: $0 <jwt_secret|db_password|bestellung_encryption_key>"
  exit 1
fi

case "$NAME" in
  jwt_secret)
    VALUE="$(openssl rand -hex 32)"
    ;;
  db_password)
    VALUE="$(openssl rand -base64 24 | tr -d '=+/')"
    ;;
  bestellung_encryption_key)
    VALUE="$(openssl rand -hex 32)"
    echo "⚠️  BESTELLUNG_ENCRYPTION_KEY rotieren erfordert eine Re-Verschlüsselung"
    echo "    aller bestehenden Kundendaten in bestellung_kunde – dieses Skript"
    echo "    erzeugt nur den neuen Schlüssel, migriert aber KEINE Daten."
    echo "    Siehe README.md 'Secrets rotieren' für die dokumentierte Grenze."
    echo ""
    ;;
  *)
    echo "Unbekanntes Secret: $NAME"
    echo "Erlaubt: jwt_secret, db_password, bestellung_encryption_key"
    exit 1
    ;;
esac

mkdir -p "$SECRETS_DIR"
OUT_FILE="$SECRETS_DIR/${NAME}.txt"

if [ -f "$OUT_FILE" ]; then
  BACKUP_FILE="$SECRETS_DIR/${NAME}.previous.txt"
  cp "$OUT_FILE" "$BACKUP_FILE"
  chmod 600 "$BACKUP_FILE"
  echo "Bisheriger Wert gesichert unter: $BACKUP_FILE"
  if [ "$NAME" = "jwt_secret" ]; then
    echo "→ Für den Graceful Rollover diesen Wert als JWT_SECRET_OLD setzen (.env oder"
    echo "  JWT_SECRET_OLD_FILE=$BACKUP_FILE), bis alle Alt-Tokens abgelaufen sind (8h)."
  fi
fi

printf '%s' "$VALUE" > "$OUT_FILE"
chmod 600 "$OUT_FILE"

echo "✓ Neues Secret erzeugt und gespeichert unter: $OUT_FILE"
echo "  (Datei-basiert: ${NAME^^}_FILE=$OUT_FILE in der .env eintragen"
echo "   – oder den Wert direkt in ${NAME^^} kopieren.)"
echo ""
echo "Wert: $VALUE"
echo ""
echo "Nächste Schritte: siehe README.md, Abschnitt 'Secrets rotieren'."
