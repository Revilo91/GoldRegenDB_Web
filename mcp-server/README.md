# GoldRegenDB MCP Server (read-only)

MCP-Server, der lesenden Zugriff auf die GoldRegenDB-PostgreSQL-Datenbank gibt.
Schreiben/Löschen ist doppelt abgesichert:

1. **Statement-Whitelist** in `src/index.js` – nur `SELECT`/`WITH`/`EXPLAIN`/`SHOW` werden angenommen.
2. **`BEGIN TRANSACTION READ ONLY`** in `src/db.js` – Postgres selbst lehnt jede Schreiboperation ab, falls die Whitelist mal umgangen wird.

Für maximale Sicherheit empfiehlt sich zusätzlich ein eigener Postgres-Rollen-User mit nur `SELECT`-Rechten (`GRANT SELECT ON ALL TABLES IN SCHEMA public TO mcp_readonly;`), den man über `DATABASE_URL` einträgt.

## Tools

- `list_tables` – listet alle Tabellen im `public`-Schema
- `describe_table` – Spalten/Typen einer Tabelle
- `query` – freie SELECT-Abfrage (Parameter `sql`, optional `params`, `limit` max. 1000 Zeilen)

## Setup

```bash
cd mcp-server
npm install
```

`.env` bzw. Umgebungsvariablen (wie im Hauptprojekt):

```
DATABASE_URL=postgresql://goldregen:changeme@localhost:5432/goldregendb
```

## Als MCP-Server registrieren (z.B. Claude Desktop / Claude Code)

```json
{
  "mcpServers": {
    "goldregendb": {
      "command": "node",
      "args": ["/absoluter/pfad/zu/GoldRegenDB_Web/mcp-server/src/index.js"],
      "env": {
        "DATABASE_URL": "postgresql://goldregen:changeme@localhost:5432/goldregendb"
      }
    }
  }
}
```
