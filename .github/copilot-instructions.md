# GitHub Copilot Instructions – GoldRegenDB

Dieses Dokument beschreibt die Konventionen und wichtigsten Fakten des Projekts, damit GitHub Copilot passende Vorschläge machen kann.

## Projekt-Überblick

**GoldRegenDB** ist ein Warenwirtschaftssystem für handgefertigten Schmuck.
Stack: **PostgreSQL 16 · Node.js/Express · React 19 + Vite · Docker Compose**

Vollständige Dokumentation: [`agent.md`](../agent.md)

---

## Technologie & Abhängigkeiten

### Backend (`backend/`)
- Node.js + Express (kein ORM – direktes `pg`-Paket / SQL-Queries)
- Authentifizierung: `jsonwebtoken` + `bcryptjs`
- Rate-Limiting: `express-rate-limit`
- Excel-Export: `exceljs`
- Einstiegspunkt: `backend/src/index.js`

### Frontend (`frontend/`)
- React 19 + Vite + React Router v7
- Kein UI-Framework (reines CSS in `index.css`)
- API-Aufrufe zentral in `frontend/src/api.js`
- Auth-State über `AuthContext` (`frontend/src/context/AuthContext.jsx`)

### Datenbank
- PostgreSQL 16 (kein ORM)
- Schema: `db/init.sql`
- Tabellen: `Kunde`, `Lieferschein`, `Rechnung`, `Schmuckstück`, `audit_log`, `app_users`
- Umlaute in Tabellen- und Spaltennamen → immer in Anführungszeichen: `"Schmuckstück"`, `"Artikelnummer"`

---

## Coding-Konventionen

### Backend
- Routen-Dateien in `backend/src/routes/` – eine Datei pro Ressource
- Datenbankabfragen direkt via `pg`-Pool (kein ORM) – parametrisierte Queries (`$1`, `$2`, …) verwenden
- Middleware `authenticate` und `requireAdmin` aus `backend/src/middleware/auth.js` für Absicherung
- Fehlerbehandlung: `try/catch` mit `res.status(500).json({ error: ... })`
- Alle Routen geben JSON zurück

### Frontend
- Seiten in `frontend/src/pages/`, wiederverwendbare Komponenten in `frontend/src/components/`
- Routing und Navigation zentral in `App.jsx`
- Admin-Seiten mit `<ProtectedRoute adminOnly>` absichern
- API-Aufrufe immer über `api.js` – kein direktes `fetch` in Komponenten

### Datenbank
- Primärschlüssel der `Kunde`-Tabelle ist `"Name"` (nicht `"ID"`)
- `Schmuckstück`-Felder `Ausgelagert`, `Lieferschein_ID`, `Rechnung_ID` default `0` (nicht NULL); Wert `0` = "nicht zugeordnet"
- Felder `Online`, `Verkauft`, `Ausschuss` sind Boolean-Felder (0/1)
- DB-Trigger überwachen Änderungen an `Schmuckstück` → `audit_log`

---

## Authentifizierung & Rollen

| Rolle   | Zugriff                                                                 |
| ------- | ----------------------------------------------------------------------- |
| `user`  | Dashboard, Kunden, Schmuckstücke, Lieferscheine, Rechnungen             |
| `admin` | Alles + Audit Log, Debug, Benutzerverwaltung                            |

- JWT im `Authorization: Bearer <token>`-Header
- `JWT_SECRET` muss als Umgebungsvariable gesetzt sein
- Standard-Admin: `admin` / `admin123` (nach erstem Login ändern)

---

## Umgebungsvariablen (`.env`)

```
DB_PASSWORD=...
POSTGRES_DB=goldregendb
POSTGRES_USER=goldregen
NODE_ENV=development
PORT=3001
DATABASE_URL=postgresql://goldregen:<DB_PASSWORD>@db:5432/goldregendb
JWT_SECRET=...
VITE_API_URL=http://localhost:3001/api
```

---

## Build & Entwicklung

```bash
# Entwicklung (Hot-Reload)
docker compose -f docker-compose.dev.yml up --build

# Frontend bauen
cd frontend && npm run build

# Frontend linten
cd frontend && npm run lint

# Backend-Syntax prüfen
node --check backend/src/index.js

# Produktion
docker compose up --build -d
```

---

## Artikelnummern-Schema

`[Hersteller][Material][Produktart][Nr]_[Exemplar]` – Beispiel: `MBH001_1`

| Stelle | Bedeutung  | Beispielwerte                                  |
| ------ | ---------- | ---------------------------------------------- |
| 1      | Hersteller | `M`=Marina, `S`=Saskia                         |
| 2      | Material   | `B`=Beton, `H`=Harz, `P`=Perle, `W`=Holz, … |
| 3      | Produktart | `A`=Armband, `H`=Halskette, `O`=Ohrring, `S`=Schlüsselanhänger |
