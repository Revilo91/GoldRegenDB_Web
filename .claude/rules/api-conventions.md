---
paths:
  - "backend/**"
  - "db/**"
  - "frontend/src/api.js"
---

# API- und Datenbank-Konventionen

Der allgemeine Teil gilt in allen Projekten. Bei Widerspruch gilt der Abschnitt zu diesem Projekt.

## SQL / Datenbank

- Nur parametrisierte Queries. Schema-Änderungen ausschließlich per Migration, nie direkt live.
- Vor Migrationen Backup. Indizes für Fremdschlüssel und häufige Filter.
- Datensätze einmal laden und im Speicher halten, nicht bei jedem Aufruf neu abfragen (sofern Konsistenz nicht leidet).

## Sicherheit

- Kein `eval`/`exec` auf externen Eingaben, keine SQL-String-Konkatenation (parametrisierte Queries).
- Abhängigkeiten aktuell halten, bekannte Schwachstellen prüfen.
- Logs ohne Passwörter/Tokens/personenbezogene Daten.

## WHERE-Clause-Builder

**Alle WHERE-Filter auf den Status von Schmuckstücken müssen `whereClauseBuilder` verwenden** für konsistente Filterlogik in der gesamten App. Statusübergänge (UPDATE) laufen über `backend/src/utils/statusUebergaenge.js`; Beziehungs-JOINs wie `s."Ausgelagert" = k."ID"` sind erlaubt.

```javascript
const { where } = require('../utils/whereClauseBuilder');

const builder = where();
builder.verfuegbar();              // Verfügbar: nicht verkauft, kein Ausschuss, nicht ausgelagert
builder.aktivAusgelagert(kundeId); // Aktiv ausgelagert an bestimmten Kunden
const { rows } = await db.query(
  `SELECT * FROM "Schmuckstück" ${builder.build()}`,
  builder.getParams()
);
```

**Status-Mappings** (kritische Geschäftslogik):
- **Verfügbar**: `Verkauft = FALSE AND Ausschuss = FALSE AND Ausgelagert = 0`
- **Verkauft**: `Verkauft = TRUE AND Ausschuss = FALSE`
- **Ausschuss**: `Ausschuss = TRUE`
- **Aktiv Ausgelagert**: `Ausgelagert > 0 AND Verkauft = FALSE AND Ausschuss = FALSE`

Vollständige API: `backend/src/utils/WHERE_BUILDER.md`

## Datenbankabfragen und Migrationen

- Kein ORM: Abfragen direkt mit `pg` (node-postgres)
- Alle Einfüge-/Update-Operationen verwenden Prepared Statements gegen SQL-Injection
- Session-Benutzer wird per `SET app.current_user = 'username'` im `authenticate`-Middleware gesetzt (fließt in Audit-Trigger)
- **Schema-Migrationen:** `backend/src/config/migrations/NNNN_name.sql`, beim Start angewandt von `config/migrate.js` (Tabelle `schema_migrations`, eine Transaktion je Migration, `pg_advisory_lock`, vorher `pg_dump`-Backup bei Bestandsdatenbanken; `MIGRATION_BACKUP_DIR`, `MIGRATION_SKIP_BACKUP`)
- **Neue Schemaänderung = neue Datei mit der nächsten Nummer.** Veröffentlichte Migrationen nie ändern, `db/init.sql` nicht erweitern, kein Schema-Code (CREATE/ALTER) in `db.js`. Datenumwandlungen als eigene, idempotente Migration

## Rate-Limiter

- **Rate-Limiter nur für unauthentifizierte Endpunkte** (Login, Passwort-Reset, öffentliches Bestellformular) mit echten Limits. Die angemeldete Anwendung bleibt bewusst ungedrosselt: die Tabellenansicht lädt jedes Foto einzeln, jedes Limit trifft dort den Normalbetrieb
