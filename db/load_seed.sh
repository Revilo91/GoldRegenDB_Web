#!/bin/bash
set -e

echo "🗑️  Leere Datenbank..."

# Alle Tabellen leeren (TRUNCATE mit CASCADE löscht auch abhängige Daten)
psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<-EOSQL
    TRUNCATE TABLE
        audit_log,
        "Kunde",
        "Lieferschein",
        "Rechnung",
        "Schmuckstück"
    RESTART IDENTITY CASCADE;
EOSQL

echo "✅ Datenbank geleert"
echo ""
echo "📥 Lade Seed-Daten..."

# Seed-Daten importieren (Pfad je nach Mount)
if [ -f /docker-entrypoint-initdb.d/02-seed.sql ]; then
    SEED_FILE=/docker-entrypoint-initdb.d/02-seed.sql
elif [ -f /db/seed.sql ]; then
    SEED_FILE=/db/seed.sql
else
    echo "❌ Fehler: seed.sql nicht gefunden!"
    exit 1
fi

# ON_ERROR_STOP=1 ist hier nicht optional: ohne das Flag beendet sich psql mit
# 0, auch wenn einzelne Statements scheitern – `set -e` greift dann nie und das
# Skript meldet Erfolg auf einer leeren Datenbank (so blieb Befund A0 lange
# unentdeckt). Kein --single-transaction: seed.sql bringt sein eigenes
# BEGIN/COMMIT mit, das Flag erzeugte nur zwei Warnungen über eine bereits
# laufende bzw. schon beendete Transaktion.
psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -f "$SEED_FILE"

echo "✅ Seed-Daten erfolgreich geladen"
echo ""
echo "📊 Statistik:"

# Zeige Anzahl der Einträge pro Tabelle
psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<-EOSQL
    SELECT 'audit_log' as Tabelle, COUNT(*) as Anzahl FROM audit_log
    UNION ALL
    SELECT 'Kunde', COUNT(*) FROM "Kunde"
    UNION ALL
    SELECT 'Lieferschein', COUNT(*) FROM "Lieferschein"
    UNION ALL
    SELECT 'Rechnung', COUNT(*) FROM "Rechnung"
    UNION ALL
    SELECT 'Schmuckstück', COUNT(*) FROM "Schmuckstück";
EOSQL

echo ""
echo "✨ Fertig!"
