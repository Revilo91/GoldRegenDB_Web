# GoldRegenDB_Web – Technologie-Übersicht

## Gesamtarchitektur

**Containerisierte 3-Tier-Webanwendung** (Warenwirtschaft für handgefertigten Schmuck)

```
Browser → React-Frontend (Nginx) → Express-Backend (Node.js) → PostgreSQL 16
```

---

## Infrastruktur & Deployment

| Schicht | Technologie |
|---|---|
| Containerisierung | Docker + Docker Compose (3 Profile: `dev`, `prod`, `synology`) |
| Webserver (Prod) | **Nginx** – serviert den statischen React-Build, Proxy für API |
| Datenbankserver | **PostgreSQL 16 Alpine** (Docker Volume für Persistenz) |
| Hot-Reload (Dev) | `node --watch` (Backend) + Vite Dev Server (Frontend) |

---

## Backend – Node.js / Express.js

| Bereich | Bibliothek / Technik |
|---|---|
| HTTP-Framework | **Express.js ^4.22** |
| Datenbankzugriff | **`pg` (node-postgres) ^8.19** – kein ORM, rohes SQL |
| Authentifizierung | **JWT** (`jsonwebtoken ^9.0`) + **bcryptjs ^3.0** (Passwort-Hashing, 10 Rounds) |
| Passwort-Hashing Frontend→Backend | SHA-256 via Web Crypto API (Client-seitig), dann bcrypt (Server-seitig) |
| Rate Limiting | **`express-rate-limit ^8.2`** (Login: 20/15 min, API: 300/min) |
| Datei-Upload | **`multer ^2.1`** (Multipart, max. 5 MB, jpg/png/gif) |
| Bildvalidierung | **`image-size ^1.2`** |
| Excel-Export | **`exceljs ^4.4`** (Lieferscheine, Rechnungen, Inventur mit Logo) |
| QR-Codes | **`qrcode ^1.5`** (Etiketten-Druck) |
| Umgebungsvariablen | **`dotenv ^16`** |
| CORS | **`cors ^2.8`** |
| Logging | Eigenes strukturiertes Logger-Modul (`utils/logger.js`) |

### Datenbankkonzepte

- PostgreSQL-**Trigger** für automatisches `Letzte_Änderung`-Update und **Audit-Log**
- Request-scoped DB-Client (Session-User für Audit-Trigger)
- Startup-Migrationen beim Backend-Start
- Batched Inserts (100 Zeilen/Batch) beim Backup-Import gegen PG-Parameterlimit
- Zentraler **WHERE-Clause-Builder** (`utils/whereClauseBuilder.js`) für konsistente Filterlogik

---

## Frontend – React 19 / Vite

| Bereich | Bibliothek / Technik |
|---|---|
| UI-Framework | **React 19** (Funktionskomponenten + Hooks) |
| Build-Tool | **Vite ^7.3** (`@vitejs/plugin-react`) |
| Routing | **React Router v7** |
| Icons | **Font Awesome 7** (Solid + Regular SVG Icons) |
| Charts | **Recharts ^3.8** (Dashboard-Statistiken) |
| Linting | **ESLint 9** (Flat Config, `eslint-plugin-react-hooks`, `react-refresh`) |

### Architekturkonzepte

- **Context API** (`AuthContext.jsx`) für globalen Auth-State
- **Shared Component Pattern**: `DocumentManager.jsx` als parametrisierte Basiskomponente für Lieferscheine & Rechnungen
- `ProtectedRoute.jsx` für rollenbasiertes Routing (`adminOnly`, `bearbeiterOnly`)
- `DataTable.jsx` + `TableToolbar.jsx` als wiederverwendbare Tabellenkomponenten
- Drag & Drop Foto-Upload mit `PhotoUpload.jsx`
- API-Client-Modul (`api.js`) als zentraler Layer für alle Backend-Aufrufe

---

## Sicherheit

- **JWT-Authentifizierung** mit 3 Rollen: `user`, `bearbeiter`, `admin`
- Passwörter werden **clientseitig gehasht** (SHA-256) vor der Übertragung, serverseitig mit **bcrypt** gespeichert
- `must_change_password`-Flag für initialen Admin-Login
- Rate Limiting gegen Brute-Force
- Input-Validierung an System-Grenzen (Datei-Typ, -Größe, Spalten-Whitelist beim Import via `information_schema`)
- `JWT_SECRET` als Pflicht-Umgebungsvariable (Startup-Check)

---

## Testing

| Bereich | Framework |
|---|---|
| Backend | **Jest ^30** + **Supertest ^7** |
| Frontend | **Vitest ^4** + **jsdom ^28** |

- Backend-Tests mocken `config/db` und `utils/logger`, um echte DB-Verbindungen zu vermeiden
- Frontend-Tests in `frontend/src/__tests__/`, Backend-Tests in `backend/__tests__/`
- CI via `.github/workflows/tests.yml`

---

## Datenmigration & Integration

- Python-Skripte (`convert_mysql_to_pg.py`, `json_to_sql.py`) für die Migration von MySQL/MariaDB → PostgreSQL
- Backup/Restore als JSON (transaktional, Schema-kompatibel via `information_schema`)
- SumUp CSV-Import/-Export für POS-Integration
