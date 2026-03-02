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

### Stellen-Bedeutung

| Stelle | Bedeutung  | Code → Wert |
| ------ | ---------- | ----------- |
| 1      | Hersteller | `M`=Marina, `S`=Saskia |
| 3      | Produktart | `A`=Armband, `H`=Halskette, `O`=Ohrring, `S`=Schlüsselanhänger |

### Material-Codes (Stelle 2)

| Code | Material       | Code | Material        |
| ---- | -------------- | ---- | --------------- |
| `A`  | Alkoholtinte   | `M`  | Makramee        |
| `B`  | Beton          | `N`  | Naturstein      |
| `C`  | Cucio          | `P`  | Perle           |
| `E`  | Edelstahl      | `S`  | Schrumpffolie   |
| `F`  | Fimo           | `W`  | Holz            |
| `H`  | Harz           | `X`  | 3D-Druck        |
| `I`  | Phiole         | `Y`  | Cabochon        |
| `J`  | Papier         |      |                 |
| `K`  | Kordel         |      |                 |
| `L`  | Leder          |      |                 |

---

## Projektstruktur

```
GoldRegenDB_Web_new/
├── docker-compose.yml              # Produktion
├── docker-compose.dev.yml          # Entwicklung (Hot Reload)
├── docker-compose.synology.yml     # Synology-NAS-spezifisch
├── .env.example
├── agent.md                        # Vollständige Dokumentation
├── db/
│   └── init.sql                    # PostgreSQL-Schema (6 Tabellen + Trigger)
├── backend/
│   └── src/
│       ├── index.js                # Express Entry-Point
│       ├── config/db.js            # PostgreSQL-Verbindung (pg Pool)
│       ├── routes/
│       │   ├── auth.js             # Login, /me
│       │   ├── users.js            # Benutzerverwaltung (Admin)
│       │   ├── dashboard.js        # Statistiken
│       │   ├── kunden.js           # Kunden CRUD
│       │   ├── schmuckstuecke.js   # Schmuckstücke CRUD
│       │   ├── lieferscheine.js    # Lieferscheine CRUD
│       │   ├── rechnungen.js       # Rechnungen CRUD
│       │   ├── auditLog.js         # Audit-Log (Admin)
│       │   └── debug.js            # Debug-Endpunkte (Admin)
│       ├── middleware/auth.js      # JWT-Middleware
│       └── utils/excelService.js  # Excel-Export
└── frontend/
    └── src/
        ├── App.jsx                 # Router, Layout, Navigation
        ├── api.js                  # API-Client (alle Backend-Aufrufe)
        ├── context/AuthContext.jsx # Auth-State
        ├── components/
        │   └── ProtectedRoute.jsx  # Route-Schutz (adminOnly prop)
        └── pages/
            ├── Login.jsx, Dashboard.jsx, Schmuckstuecke.jsx
            ├── Kunden.jsx, Lieferscheine.jsx, Rechnungen.jsx
            ├── AuditLog.jsx (Admin), Debug.jsx (Admin)
            └── Benutzerverwaltung.jsx (Admin)
```

---

## API-Endpunkte

| Methode | Pfad | Auth | Beschreibung |
| ------- | ---- | ---- | ------------ |
| POST | `/api/auth/login` | — | Login → JWT |
| GET | `/api/auth/me` | JWT | Eigene Benutzerdaten |
| GET | `/api/health` | — | Health-Check |
| GET | `/api/dashboard` | JWT | Statistiken |
| CRUD | `/api/kunden` | JWT | Kunden |
| CRUD | `/api/schmuckstuecke` | JWT | Schmuckstücke |
| CRUD | `/api/lieferscheine` | JWT | Lieferscheine |
| CRUD | `/api/rechnungen` | JWT | Rechnungen |
| GET | `/api/audit-log` | Admin | Änderungsprotokoll |
| CRUD | `/api/users` | Admin | Benutzerverwaltung |
| GET | `/api/debug` | Admin | Debug-Infos |

---

## Docker

| Service   | Entwicklung | Produktion          |
| --------- | ----------- | ------------------- |
| Frontend  | 5173        | 3000 (→ Nginx :80)  |
| Backend   | 3001        | 3001                |
| Datenbank | 5432        | 5432                |

---

## Excel-Export

`generateExcel(type, data, logoPath?)` in `backend/src/utils/excelService.js`.
Standard-Logo: `backend/src/assets/Logo trasparent weißer Kreis.png`.
