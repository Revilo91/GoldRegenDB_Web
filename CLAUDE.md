# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Graphify Knowledge Graph

**Graphify data is stored in this project** (`graphify-out/` directory). When you ask ANY question about this project (codebase, architecture, files, relationships, features, business logic, or context), **immediately invoke `/graphify` before answering**, even if you think you know the answer already. This ensures:

- Complete, up-to-date context from the knowledge graph
- Accurate file references and relationships
- Comprehensive architecture understanding
- Consistent answers across sessions

**Trigger conditions for automatic graphify use:**
- "Where is..." / "What does..." / "How does..." (code/architecture questions)
- Feature requests or modifications (understand dependencies first)
- Bug reports or investigations
- API/schema questions
- Any file or cross-file logic question

---

## Project Overview

**GoldRegenDB** is a web-based inventory management system for handcrafted jewelry. It runs on PostgreSQL, Node.js/Express backend, and React 19 frontend, all containerized with Docker.

**Detailed architecture, schema, API endpoints, and styling rules**: See `.github/copilot-instructions.md` (comprehensive reference).

---

## Quick Start

```bash
# Development (native, hot reload) — recommended
cp .env.example .env
npm install                # installs root + backend + frontend workspaces
npm run dev                # starts db (Docker) + backend (node --watch) + frontend (vite) concurrently

# Services available at:
# Frontend: http://localhost:5173
# Backend API: http://localhost:3001/api
# Database: localhost:5432

# Development (fully containerized alternative — 2 containers: db + app)
docker compose -f docker-compose.dev.yml up --build
# Frontend: http://localhost:3000 (Vite :5173) / Backend: http://localhost:3001
# Backend & Frontend run together in one container with hot-reload via concurrently

# Production — single image, Express serves API + built frontend on one port
docker compose up --build -d
# Frontend + API: http://localhost:3000 (no Nginx)
```

---

## Commands

### Backend (Node.js + Express)
```bash
cd backend

npm run dev        # Start with hot reload (node --watch)
npm start          # Start production
npm test           # Jest tests in __tests__/**/*.test.js
npm run import:fotos -- --dir <pfad> [--dry-run] [--overwrite] [--log <datei>]
                   # Einmaliger Bestandsimport von Bildern in "Foto" (#209)
```

### Frontend (React + Vite)
```bash
cd frontend

npm run dev        # Vite dev server (port 5173)
npm run build      # Build optimized bundle
npm run lint       # ESLint check
npm test           # Vitest run (in __tests__/)
```

### Database (Docker)
```bash
# Backup (daily/weekly volumes in pgbackups_dev)
docker compose -f docker-compose.dev.yml exec db /backup.sh

# Restore from backup
docker compose -f docker-compose.dev.yml exec db /restore.sh
```

---

## Code Standards & Cleanup (2026-06-30)

**Recent AI-Slop Cleanup:**
- Removed 280+ lines of excessive docstrings/comments from whereClauseBuilder
- Consolidated GRUNDMATERIAL & PRODUKTART constants → `utils/constants.js`
- Merged duplicate request() + requestFormData() in api.js (90% code duplication)
- Removed inline debug logging (console.log emoji-comments in api.js)
- Set real rate limits in index.js (später auf unauthentifizierte Endpunkte beschränkt, siehe unten)
- Deleted boilerplate JSDoc in DocumentManager.jsx

**Code Conventions (to prevent future slop):**
- **No function wrappers:** `hersteller_Marina()` → use `hersteller("M")` directly
- **No verbose docstrings:** Method names are self-documenting; one-liner comments only if WHY is non-obvious
- **Merge duplicates:** If constants/logic exists in 2+ files, move to shared utils/
- **Delete dead logging:** console.log/error only for errors; remove debug traces after use
- **Rate limiters:** Nur für unauthentifizierte Endpunkte (Login, Passwort-Reset,
  öffentliches Bestellformular) – dort mit echten Limits, kein "10000 = praktisch
  unbegrenzt". Die angemeldete Anwendung bleibt bewusst ungedrosselt: die
  Tabellenansicht lädt jedes Foto einzeln, jedes Limit trifft dort den Normalbetrieb
- **Kein `alert()`:** Fehler und Erfolgsmeldungen laufen über `useToast()` aus
  `frontend/src/components/Toast.jsx`. `alert()` blockiert den Tab, und zwei
  Fehler kurz hintereinander ergaben zwei Dialoge zum Wegklicken. ESLint
  erzwingt das per `no-restricted-globals` — `confirm()` bleibt für
  Löschabfragen erlaubt
- **No JSDoc boilerplate:** Describe props via code comments inline, not at-the-top blocks

**Commit-Stil (bisect-freundlich):**
- Kleine, atomare Commits: eine logische Änderung pro Commit
- Jeder Commit ist für sich lauffähig – Tests grün, App startet –, damit `git bisect` an jedem Punkt eindeutig gut/schlecht liefert
- Code, zugehörige Tests und Doku einer Änderung gehören in denselben Commit; unabhängige Änderungen (Skripte, Doku, Refactoring) in eigene Commits
- Regeländerungen wie diese (CLAUDE.md) vorab und getrennt von der Code-Änderung committen

---

## Critical Project Rules

### 1. WHERE Clause Builder (Backend)
**All schmuckstück (jewelry) queries must use `whereClauseBuilder`** for consistent filtering logic across the app.

```javascript
const { where } = require('../utils/whereClauseBuilder');

const builder = where();
builder.verfuegbar();  // Available: not sold, not defective, not consigned
builder.aktivAusgelagert(kundeId);  // Consigned to specific customer
const { rows } = await db.query(
  `SELECT * FROM "Schmuckstück" ${builder.build()}`,
  builder.getParams()
);
```

**Status mappings** (critical business logic):
- **Verfügbar** (available): `Verkauft=0 AND Ausschuss=0 AND Ausgelagert=0`
- **Verkauft** (sold): `Verkauft=1 AND Ausschuss=0`
- **Ausschuss** (defective): `Ausschuss=1`
- **Aktiv Ausgelagert** (consigned): `Ausgelagert>0 AND Verkauft=0 AND Ausschuss=0`

See `backend/src/utils/WHERE_BUILDER.md` for full API.

### 2. Frontend Styling (React)
**STRICT RULE: No inline styles**
```jsx
// ❌ FORBIDDEN
<div style={{ marginTop: 24, display: "flex" }}>

// ✅ REQUIRED
<div className="my-container">
```

All styles go in `frontend/src/index.css` as class definitions. Avoid style props entirely.

### 3. Photo Upload & Assets
- Fotos liegen **in PostgreSQL** (Issue #208): Tabelle `"Foto"` (Schmuckstücke,
  Schlüssel = Basis-Artikelnummer, `MHO123` gilt für `MHO123_1`, `MHO123_2`) und
  `bestellung_foto` (Bestellformular, Schlüssel = `bestellung.foto_pfad`)
- Lesen/Schreiben nur über `backend/src/utils/fotoService.js`; eigene Tabellen,
  damit Listenabfragen keine BYTEA-Daten laden – Listen prüfen per `EXISTS`
- Liste, Detail und Inventur liefern je Stück `hatFoto` (boolean, aus
  `hatFotoSql()` in `fotoService.js`); das Frontend lädt das Bild dann über die
  Artikelnummer. Eine Spalte `"Schmuckstück"."Foto"` gibt es nicht mehr (#214) –
  `db.js` entfernt sie beim Start per `DROP COLUMN IF EXISTS`
- Max size: 5 MB (jpg/png/gif), Typ per Magic Bytes geprüft, nicht per Endung
- Upload: `multer.memoryStorage()` in schmuckstuecke.js; Auslieferung mit ETag
  aus `Geaendert` und `Cache-Control: private, max-age=60`
- Fotos sichert ein **eigenes Foto-ZIP** (`utils/fotoZip.js`), nicht die
  JSON-Sicherung – base64 im JSON sprengt bei ~1,6 GB jedes Body-Limit.
  `GET /api/backup/export-fotos` streamt aus einem REPEATABLE-READ-Snapshot,
  `POST /api/backup/import-fotos-zip` übernimmt per Upsert als Hintergrund-Job
  (Fortschritt: `GET /api/backup/import-fotos-jobs/:id`). Der JSON-Export
  überspringt `"Foto"`/`bestellung_foto`, der JSON-Import fasst sie nicht an
- Großer ZIP-Upload über langsame Leitung: Node bricht Requests nach
  `server.requestTimeout` (Standard 300 s) ab, ein Reverse-Proxy oft früher –
  dort ggf. Timeout und Body-Limit anheben
- **Bestandsimport** (`scripts/import-fotos.js`, #209): Dateiname = Artikelnummer,
  `_` plus Ziffern ist eine Variante (`MBH004_2.jpg` → `MBH004`). Übersprungen und
  in `import-fotos-<datum>.log` gelistet werden: mehrere Nummern im Namen, keine
  Nummer, sonstiger Rest im Namen (`MBH004-2`), mehrere Dateien je Nummer, unbekannte Nummer, vorhandenes Foto (außer
  `--overwrite`), > 5 MB, kein gültiges Bild. Unterordner werden nicht gelesen;
  ein zweiter Lauf ändert nichts. Uneindeutige Namen, mehrere Dateien je Nummer
  und Fotos über 5 MB sind im Log mit „manuell“ markiert (`grep manuell <log>`):
  von Hand prüfen bzw. verkleinern, dann erneut importieren.
  Namensauswertung: `utils/fotoDateiname.js`. In Produktion läuft das Skript
  per `docker compose run` im App-Image mit eingebundenem `uploads/`-Ordner
  (Befehl im README, Update-Hinweis); der Release-Smoke-Test prüft genau das
- **Kein Datei-Fallback** (#214): Fotos kommen nur aus der Datenbank, ohne
  Eintrag antwortet `GET /foto/:name` mit 404. Das frühere Upload-Verzeichnis
  wird nicht mehr gelesen, und die compose-Dateien binden kein Uploads-Volume
  mehr ein
- Der in #214 offene Punkt **Import-Limit** ist erledigt: Fotos laufen nicht
  durch den JSON-Import (globales Body-Limit 100 MB), sondern über das Foto-ZIP

---

## High-Level Architecture

```
frontend/src/
├── pages/                 # Page components (role-based route protection)
├── components/            # Shared: DataTable, TableToolbar, PhotoUpload, ProtectedRoute
├── context/AuthContext    # JWT auth state + user roles
└── api.js                 # Centralized API client (all backend calls)

backend/src/
├── routes/                # 10+ REST endpoints (auth, kunden, schmuckstuecke, etc.)
├── middleware/auth.js     # JWT validation, role checks (authenticate, requireAdmin)
├── config/db.js           # PostgreSQL pool + request-scoped client + startup migrations
└── utils/                 # whereClauseBuilder, excelService, logger, passwordService

db/
├── init.sql               # Schema: 7 tables + audit triggers
├── seed.sql               # Demo data
├── backup.sh / restore.sh # Automated backups (daily/weekly)
└── README.md              # Detailed backup/restore docs
```

---

## Key Patterns & Architecture Decisions

### DocumentManager Pattern
**Lieferscheine (delivery notes) and Rechnungen (invoices)** share 95% identical UI/logic. Both use a parameterized **DocumentManager.jsx** component that accepts type-specific props (labels, API endpoints, piece-selection logic). Lieferscheine.jsx and Rechnungen.jsx are thin wrappers around it.

→ If modifying document-list logic (filtering, grouping, modals), edit `DocumentManager.jsx` first.

### Database Queries
- No ORM: queries use `pg` (node-postgres) directly
- **All** row insertion/update uses prepared statements to prevent SQL injection
- Session user tracked via `SET app.current_user = 'username'` in authenticate middleware (feeds into audit triggers)
- Startup migrations in `db.js` ensure schema consistency (lagerinventur table auto-created if missing)

### Authentication Flow
1. Frontend sends the password in plaintext over TLS — no client-side hashing
2. Backend hashes/verifies with `bcryptjs` (10 rounds) via `utils/passwordService.js`;
   legacy `bcrypt(sha256(pw))` hashes are accepted once and transparently upgraded on login
3. JWT issued and set as an **httpOnly cookie** (`jwt`); the browser sends it
   automatically because `api.js` uses `credentials: 'include'`. No token is
   kept in localStorage. `Authorization: Bearer <token>` still works as a
   fallback for scripts and E2E tests
4. Middleware validates JWT, sets `req.user = { username, role, ... }`
5. Routes check roles: `requireAdmin`, `requireBearbeiter` middleware

**CSRF** (`backend/src/middleware/csrf.js`): double-submit cookie pattern (not
`csurf`, which is deprecated). `GET /api/csrf-token` issues a readable
`csrfToken` cookie; `api.js` mirrors it into the `X-CSRF-Token` header on
POST/PUT/PATCH/DELETE. Only enforced for cookie-authenticated requests —
Bearer-token clients and public endpoints are exempt.

**Account lockout & password reset** (`backend/src/utils/accountSecurity.js`):
5 consecutive failed logins lock the account for 30 minutes. Self-service reset
runs via `POST /api/auth/forgot-password` → `POST /api/auth/reset-password`;
only the token's SHA-256 hash is stored. No SMTP is configured — the reset link
is written to the backend log for an admin to hand over.

### Roles & Permissions
| Role | Access |
|------|--------|
| `user` | Create schmuckstücke only |
| `bearbeiter` | All pages except admin section |
| `admin` | Full access + audit-log, users, backup, debug |

---

## Important Files & Locations

| Purpose | Path |
|---------|------|
| **Database schema** | `db/init.sql` (7 tables, audit triggers) |
| **Environment vars** | `.env.example` (copy to `.env`, set JWT_SECRET & DB_PASSWORD) |
| **WHERE builder docs** | `backend/src/utils/WHERE_BUILDER.md` |
| **Excel export** | `backend/src/utils/excelService.js` (generateExcel, generateInventurExcel) |
| **Logging** | `backend/src/utils/logger.js` (structured logs with timestamp & component prefix) |
| **Password hashing** | `backend/src/utils/passwordService.js` (bcrypt; legacy-hash migration) |
| **Fotos** | `backend/src/utils/fotoService.js` (Tabellen `"Foto"`, `bestellung_foto`) |
| **Comprehensive docs** | `.github/copilot-instructions.md` (schema, API endpoints, docker details, migrations) |

---

## Testing

**Backend** (Jest):
```bash
cd backend && npm test
# Tests in: __tests__/**/*.test.js
# Mocks: db.js, logger.js via jest.mock()
# Config: testEnvironment=node, timeout=10s
```

Backup/Restore hat zusätzlich eine Integrationssuite gegen echtes Postgres
(`__tests__/backup.integration.test.js`). Sie läuft nur mit `TEST_DATABASE_URL`
und verweigert Datenbanken, deren Name nicht „test" enthält (der Import macht
TRUNCATE). Einrichtung steht im Kopf der Testdatei.

**Frontend** (Vitest):
```bash
cd frontend && npm test
# Tests in: src/__tests__/**/*.test.js
```

Tests run automatically on every PR via GitHub Actions (`.github/workflows/tests.yml`).

---

## Common Tasks

### Add a new API endpoint
1. Create route handler in `backend/src/routes/[feature].js`
2. Use `whereClauseBuilder` if filtering schmuckstücke
3. Add middleware checks: `authenticate`, `requireAdmin`, etc.
4. Add test in `backend/__tests__/`
5. Wire up in `backend/src/index.js` with `app.use('/api/[feature]', require(...))`
6. Call from frontend via `api.js`

### Add a new page
1. Create component in `frontend/src/pages/[Feature].jsx`
2. Add route in `App.jsx` with `<ProtectedRoute>` if role-restricted
3. Create API calls in `frontend/src/api.js`
4. Use existing `DataTable` / `TableToolbar` components for lists

### Modify filters or list logic
1. For schmuckstücke: extend `whereClauseBuilder` in `backend/src/utils/whereClauseBuilder.js`
2. For document lists (Lieferscheine/Rechnungen): edit `DocumentManager.jsx` (shared component)
3. Update filter-options endpoint if adding new filter dimensions

### Deploy to Synology NAS
See `README.md` section "Synology NAS" for full step-by-step (copy release zip, set `.env`, run `docker compose up -d`).

---

## Cleanup Tasks Status

**Fehlermeldungen im Frontend** (korrigierte Fassung): Hier stand, die
unbehandelten `.catch(console.error)` seien „durch benutzerfreundliche
Fehlerdialoge und Alerts" ersetzt. Das war **verfrüht** — zum Zeitpunkt der
Aussage lagen in `Dashboard.jsx`, `Bestelluebersicht.jsx`,
`SchmuckstueckDetail.jsx`, `Benutzerverwaltung.jsx` und `api.js` weiter
verschluckte Fehler, und 68 `alert()` verteilt über 11 Dateien. Jetzt gilt:
- Meldungen laufen über `useToast()` (`components/Toast.jsx`), nicht über
  `alert()`; gleiche Meldungen werden zusammengefasst statt gestapelt.
- Die fünf verschluckten Fehler führen ihre Meldung mit: `Dashboard.jsx` zeigt
  sie an, `Bestelluebersicht.jsx` setzt `fotoError`, `SchmuckstueckDetail.jsx`
  und `Benutzerverwaltung.jsx` melden per Toast, und `api.js` lässt einen
  fehlgeschlagenen CSRF-Token-Abruf laut scheitern statt alle folgenden
  Schreibzugriffe stumm in einen 403 laufen zu lassen.
- Die Schmuckstückliste entprellt ihre Suche (250 ms) und bricht überholte
  Requests per `AbortController` ab — vorher überschrieb eine späte Antwort
  die neueren Treffer.

**Weitere abgeschlossene Aufräumarbeiten:**
- **Shrinking excelService.js**: Extracted formatting utility `formatCell()` and sheet-creating helper `addInventurSheet()`. Saved 80+ lines of duplicate styles.

---

## Debugging Tips

- **Backend logs**: Check container output (`docker compose -f docker-compose.dev.yml logs backend`)
- **Frontend logs**: Browser DevTools console
- **DB logs**: `docker compose -f docker-compose.dev.yml logs db`
- **Health checks**: Backend has `/api/health` endpoint; frontend loads once backend is healthy
- **JWT issues**: Middleware logs rejection reason; im Browser das httpOnly-Cookie `jwt` prüfen (DevTools → Application → Cookies), nicht localStorage
- **Photo upload fails**: 400 kommt aus der Magic-Byte-/Größenprüfung in `utils/fotoService.js`; Bilddaten stehen in der Tabelle `"Foto"`
