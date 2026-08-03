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
npm run sync:fotos # Sync photo column with filesystem
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
- Set real rate limits (5 login, 100 api/min) in index.js
- Deleted boilerplate JSDoc in DocumentManager.jsx

**Code Conventions (to prevent future slop):**
- **No function wrappers:** `hersteller_Marina()` → use `hersteller("M")` directly
- **No verbose docstrings:** Method names are self-documenting; one-liner comments only if WHY is non-obvious
- **Merge duplicates:** If constants/logic exists in 2+ files, move to shared utils/
- **Delete dead logging:** console.log/error only for errors; remove debug traces after use
- **Rate limiters:** Must have real limits; no "10000 = practically unlimited" boilerplate
- **No JSDoc boilerplate:** Describe props via code comments inline, not at-the-top blocks

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
- Photos stored in: `backend/src/assets/uploads/`
- Max size: 5 MB (jpg/png/gif)
- Multer configured in schmuckstuecke.js route
- Sync script: `npm run sync:fotos` (updates photo paths if files move)

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
└── utils/                 # whereClauseBuilder, excelService, logger, hashPassword

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
1. Frontend hashes password with SHA-256 (Web Crypto API + fallback JS impl)
2. Backend checks with `bcryptjs` (10 rounds)
3. JWT issued, stored in localStorage, sent as `Authorization: Bearer <token>` header
4. Middleware validates JWT, sets `req.user = { username, role, ... }`
5. Routes check roles: `requireAdmin`, `requireBearbeiter` middleware

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
| **Password hashing** | `frontend/src/utils/hashPassword.js` (SHA-256, used by all auth endpoints) |
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

**All remaining cleanup tasks have been successfully completed:**
- **Debug logging cleanup**: Removed leftover debug logs and replaced unhandled `.catch(console.error)` calls with proper, user-friendly error dialogs and alerts in `Schmuckstuecke.jsx`, `Kunden.jsx`, `DocumentManager.jsx`, `AuditLog.jsx`, `Inventur.jsx`, and `SchmuckstueckModal.jsx`.
- **Shrinking excelService.js**: Extracted formatting utility `formatCell()` and sheet-creating helper `addInventurSheet()`. Saved 80+ lines of duplicate styles.
- **Merging photo resolution logic**: Consolidated `findPhotoForArtikel()` and `resolvePhotoFile()` into a single, unified `resolvePhotoFile(identifier)` function in `schmuckstuecke.js` route, reducing duplication by 40+ lines.

---

## Debugging Tips

- **Backend logs**: Check container output (`docker compose -f docker-compose.dev.yml logs backend`)
- **Frontend logs**: Browser DevTools console
- **DB logs**: `docker compose -f docker-compose.dev.yml logs db`
- **Health checks**: Backend has `/api/health` endpoint; frontend loads once backend is healthy
- **JWT issues**: Middleware logs rejection reason; check localStorage for token in browser
- **Photo upload fails**: Check permissions on `backend/src/assets/uploads/` and `image-size` validation
