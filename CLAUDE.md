# CLAUDE.md

Dieses Dokument gibt Claude Code Kontext und Regeln für die Arbeit in diesem Repository.

---

## Regeln für Claude

Die Regeln liegen modular in `.claude/rules/`. Claude Code lädt sie automatisch: Dateien ohne `paths` immer, die anderen beim Lesen oder Bearbeiten passender Dateien.

| Datei | Inhalt | Geladen |
|---|---|---|
| `arbeitsweise.md` | Arbeitsablauf, Grenzen, Git, Commit-Stil, Debugging, Delegation & Modellwahl | immer |
| `code-style.md` | Code-Qualität, JavaScript, Projektkonventionen, Typisierung | Code in `backend/`, `frontend/`, `e2e/`, `scripts/`, `mcp-server/` |
| `testing.md` | Testregeln, Jest/Vitest, Integrationssuiten | `backend/`, `frontend/`, `e2e/` |
| `api-conventions.md` | SQL, Sicherheit, WHERE-Clause-Builder, Migrationen, Rate-Limiter | `backend/`, `db/`, `frontend/src/api.js` |
| `frontend-styling.md` | Keine Inline-Styles, CSS-Dateien, Klassennamen | `frontend/src/` |
| `fotos.md` | Foto-Speicherung, Upload, Foto-ZIP, SQL-Dump | Foto- und Backup-Dateien |
| `docker.md` | Docker/Compose, Verweis auf den Deploy-Skill | Dockerfiles, Compose, `deploy/` |

Weitere Bausteine unter `.claude/`:

- `commands/`: `/review-branch` (Branch gegen `main` prüfen), `/fix-issue <nummer>` (GitHub-Issue beheben)
- `agents/`: `code-reviewer` (sonnet), `security-auditor` (opus)
- `skills/`: `deploy` (Release und Synology), `expert-software-engineer`, `istqb-qa-architect-de`
- `hooks/validate-bash.sh`: prüft jeden Bash-Befehl, eingetragen in `settings.json`
- `settings.json`: Berechtigungen und Hooks für alle; persönliche Abweichungen in `settings.local.json` und `CLAUDE.local.md` (beide nicht versioniert)

## Graphify Knowledge Graph

**Die Graphify-Daten liegen im Projekt** (Verzeichnis `graphify-out/`). Bei **jeder** Frage zu diesem Projekt — Codebase, Architektur, Dateien, Abhängigkeiten, Features, Geschäftslogik — **sofort `/graphify` aufrufen, bevor geantwortet wird**, auch wenn die Antwort vermeintlich bekannt ist. Das stellt sicher:

- Vollständiger, aktueller Kontext aus dem Knowledge Graph
- Korrekte Dateireferenzen und Abhängigkeiten
- Konsistente Antworten über Sessions hinweg

**Auslösebedingungen für automatische Graphify-Nutzung:**
- „Wo ist..." / „Was macht..." / „Wie funktioniert..." (Code-/Architektur-Fragen)
- Feature-Anfragen oder Änderungen (erst Abhängigkeiten verstehen)
- Bug-Untersuchungen
- API-/Schema-Fragen
- Jede datei- oder dateiübergreifende Logikfrage

---

## Projektübersicht

**GoldRegenDB** ist ein webbasiertes Warenwirtschaftssystem für zwei Schmuckhandwerkerinnen (Marina `M` und Saskia `S`). Stack: PostgreSQL, Node.js/Express (Backend), React 19 (Frontend), alles containerisiert mit Docker.

**Vollständige Architekturdokumentation** (Schema, alle Routes, Sicherheit, Docker, Projektstruktur): Siehe `docs/ARCHITEKTUR.md`.

---

## Geschäftslogik

### Kernprozess

Die Handwerkerinnen fertigen Schmuck, lagern ihn bei Einzelhandelspartnern (Läden, Messen, Online) aus und rechnen verkaufte Stücke per Rechnung ab:

```
Stück anlegen → Lieferschein (an Händler übergeben) → Inventur → Rechnung (Abrechnung) → Stück als verkauft markiert
                                                                                         ↗
                                                        oder: Stück zurücklagern (restock) → wieder verfügbar
```

### Artikelnummern-Format

```
[Hersteller][Grundmaterial][Produktart][Laufnummer][_Suffix]

Hersteller:    M = Marina,  S = Saskia
Grundmaterial: A=Alkoholtinte  B=Beton  C=Cucio  E=Edelstahl  F=Fimo  H=Harz
               I=Phiole  J=Papier  K=Kordel  L=Leder  M=Makramee  N=Naturstein
               P=Perle  S=Schrumpffolie  W=Holz  X=3D-Druck  Y=Cabochon
Produktart:    A=Armband  H=Halskette  O=Ohrring  S=Schlüsselanhänger

MHO123_1  →  Marina, Harz, Ohrring, Nr. 123, Exemplar 1
MBA234_2  →  Marina, Beton, Armband, Nr. 234, Exemplar 2
```

Fotos werden unter der **Basis-Artikelnummer** gespeichert (`MHO123` gilt für `MHO123_1`, `MHO123_2`, …).

### Status-System (kritische Geschäftslogik)

Jedes Stück hat genau einen von vier Zuständen, aus drei DB-Spalten zusammengesetzt:

| Status | Bedingung | Bedeutung |
|--------|-----------|-----------|
| **Im Lager** | `Ausgelagert = 0, Verkauft = FALSE, Ausschuss = FALSE` | Bereit zum Auslagern/Verkauf |
| **Aktiv ausgelagert** | `Ausgelagert > 0, Verkauft = FALSE, Ausschuss = FALSE` | Physisch bei Kunde X |
| **Verkauft** | `Verkauft = TRUE, Ausschuss = FALSE` | Verkauft, Rechnung zugeordnet |
| **Ausschuss** | `Ausschuss = TRUE` | Aussortiert (Grund in `Ausschuss_Grund`) |

`Ausgelagert` ist keine Boolean, sondern die **Kunden-ID** (`0` = Lager, `>0` = bei diesem Kunden).

**Pflicht (drei Fälle):**
- **WHERE-Filter auf Status** (`Verkauft`, `Ausschuss`, `Ausgelagert`) laufen immer über `whereClauseBuilder` — niemals manuell schreiben.
- **Statusübergänge** (UPDATE, z. B. verkauft markieren, auslagern, zurücklagern) laufen über die Helper in `backend/src/utils/statusUebergaenge.js` — keine eigenen `SET "Verkauft" = …`/`SET "Ausgelagert" = …` in Routen.
- **Beziehungs-JOINs** wie `s."Ausgelagert" = k."ID"` sind erlaubt; sie filtern keinen Status.

### Rabatt-Formel (zentral in `utils/rabatt.js`)

```
Gesamtwert       = Σ( Einzelpreis × (1 − Positionsrabatt%) )
− Gesamtrabatt   = Gesamtwert × Gesamtrabatt%
− Provision      = (Gesamtwert − Gesamtrabatt) × Provision%
+ Versandkosten = fester Betrag, optional (nur Rechnung, gehört keiner Herstellerin)
= Überweisung
```

Positionsrabatt (`rabatt_positionen` JSONB) gilt je **Basis-Artikelnummer**; Gesamtrabatt (`rabatt_gesamt` NUMERIC) gilt für den ganzen Beleg. Provision ist eine Eigenschaft des Kunden.

**Immer `preisNachAllenRabattenSql()` / `belegSummen()` aus `rabatt.js` nutzen** — nie eigene Berechnungen schreiben. Dashboard, Inventur und DocumentManager verwenden dieselbe Formel.

### Besondere Features

- **E-Rechnung** (XRechnung 3.0 / ZUGFeRD 2.0): EU-konforme Rechnungen, Offline-Validierung, Kleinunternehmer §19 UStG (0 % MwSt.)
- **Audit-Log mit Hash-Kette**: Jede Statusänderung wird per SHA-256 unveränderbar verkettet (Trigger blockiert DELETE/UPDATE auf `audit_log`)
- **DSGVO-Bestellformular**: Öffentliches Formular, Kundendaten AES-256-GCM verschlüsselt, Anonymisierung auf Anfrage
- **SumUp-Import**: CSV aus SumUp-Kartenlesegerät kann als Lieferschein/Rechnung importiert werden
- **Foto-Backup als ZIP**: Fotos (~1,6 GB) laufen über eigene Route (`/api/backup/export-fotos`), nicht den JSON-Export

---

## Quick Start

```bash
# Entwicklung (nativ, Hot Reload) — empfohlen
cp .env.example .env
npm install                # installiert root + backend + frontend workspaces
npm run dev                # startet db (Docker) + backend (node --watch) + frontend (vite) parallel

# Dienste:
# Frontend:    http://localhost:5173
# Backend API: http://localhost:3001/api
# Datenbank:   localhost:5432

# Entwicklung (vollständig containerisiert — 2 Container: db + app)
docker compose -f docker-compose.dev.yml up --build
# Frontend: http://localhost:3000 / Backend: http://localhost:3001

# Produktion — ein Image, Express liefert API + Frontend auf einem Port
docker compose up --build -d
# Frontend + API: http://localhost:3000
```

---

## Befehle

### Backend (Node.js + Express)
```bash
cd backend

npm run dev        # Mit Hot Reload starten (node --watch)
npm start          # Produktion
npm test           # Jest-Tests in __tests__/**/*.test.js
npm run import:fotos -- --dir <pfad> [--dry-run] [--overwrite] [--log <datei>]
                   # Einmaliger Bestandsimport von Bildern in "Foto" (#209)
npm run sammle:fotos -- --quelle <pfad|smb://…> --ziel <pfad> [--dry-run]
                   # Sammelt Bilder mit Artikelnummer (Wurzel + _-Ordner) für den Import
```

### Frontend (React + Vite)
```bash
cd frontend

npm run dev        # Vite Dev-Server (Port 5173)
npm run build      # Optimierten Bundle bauen
npm run lint       # ESLint-Prüfung
npm test           # Vitest (in __tests__/)
```

### Datenbank (Docker)
```bash
# Backup (tägliche/wöchentliche Volumes in pgbackups_dev)
docker compose -f docker-compose.dev.yml exec db /backup.sh

# Backup wiederherstellen
docker compose -f docker-compose.dev.yml exec db /restore.sh
```

---

## Kritische Projektregeln

Kurzfassung. Die vollständigen Regeln mit Beispielen lädt Claude Code aus `.claude/rules/`, sobald passende Dateien gelesen oder bearbeitet werden.

1. **WHERE-Clause-Builder (Backend):** Status-Filter auf Schmuckstücke nur über `whereClauseBuilder`, Statusübergänge nur über `backend/src/utils/statusUebergaenge.js`. Details: `.claude/rules/api-conventions.md`
2. **Frontend-Styling (React):** Keine Inline-Styles. Klassen in `frontend/src/styles/<seite>.css`, dynamische Werte nur als CSS-Variable. Details: `.claude/rules/frontend-styling.md`
3. **Fotos:** liegen in PostgreSQL, Zugriff nur über `backend/src/utils/fotoService.js`; max. 5 MB (jpg/png/gif), Typ per Magic Bytes geprüft. Details: `.claude/rules/fotos.md`
4. **Schema-Migrationen:** Neue Schemaänderung = neue Datei mit der nächsten Nummer in `backend/src/config/migrations/`. Veröffentlichte Migrationen nie ändern. Details: `.claude/rules/api-conventions.md`

---

## Architektur

```
frontend/src/
├── pages/                 # Seitenkomponenten (rollenbasierter Routenschutz)
├── components/            # Geteilt: DataTable, TableToolbar, PhotoUpload, ProtectedRoute
├── context/AuthContext    # JWT-Auth-Zustand + Benutzerrollen
└── api.js                 # Zentraler API-Client (alle Backend-Aufrufe)

backend/src/
├── routes/                # 10+ REST-Endpunkte (auth, kunden, schmuckstuecke usw.)
├── middleware/auth.js     # JWT-Validierung, Rollenprüfung (authenticate, requireAdmin)
├── config/db.js           # PostgreSQL-Pool + request-scoped Client
├── config/migrate.js      # Migrations-Runner (Advisory-Lock, Backup-Gate per pg_dump)
├── config/migrations/     # Nummerierte SQL-Migrationen 0001_baseline.sql, …
└── utils/                 # whereClauseBuilder, excelService, logger, passwordService

db/
├── init.sql               # Eingefrorenes Start-Schema für Docker-Entrypoint + seed.sql
├── seed.sql               # Demo-Daten
├── backup.sh / restore.sh # Automatische Backups (täglich/wöchentlich)
└── README.md              # Backup/Restore-Dokumentation
```

---

## Zentrale Muster & Architekturentscheidungen

### DocumentManager-Muster
**Lieferscheine und Rechnungen** teilen sich 95 % der UI/Logik. Beide nutzen die parametrisierte Komponente **DocumentManager.jsx**; `Lieferscheine.jsx` und `Rechnungen.jsx` sind dünne Wrapper.

→ Änderungen an Listen-Logik (Filterung, Gruppierung, Modals) immer in `DocumentManager.jsx` durchführen.

**Änderungen immer an beiden Belegen prüfen.** Geteilte Stellen:
- Frontend: `DocumentManager.jsx` (Unterschiede nur über `type === "rechnung"` / `"lieferschein"`)
- Backend: `routes/rechnungen.js` ↔ `routes/lieferscheine.js` (gleiche Endpunkte, gleiche Antwortstruktur), Summen über `belegSummen()` in `utils/rabatt.js`, Excel über `utils/excelService.js`
- Fachlicher Unterschied: Der Lieferschein zeigt, was **an den Kunden gesendet** wurde (brutto/netto nach Provision, kein Rabatt); abgerechnet wird erst per Rechnung

### Datenbankabfragen

Kein ORM, Abfragen direkt mit `pg` (node-postgres). Regeln zu Prepared Statements, Audit-Benutzer und Schema-Migrationen: `.claude/rules/api-conventions.md`.

### Authentifizierung
1. Frontend sendet Passwort im Klartext über TLS — kein clientseitiges Hashing
2. Backend hasht/prüft mit `bcryptjs` (10 Runden) via `utils/passwordService.js`; Legacy-Hashes (`bcrypt(sha256(pw))`) werden beim Login einmalig akzeptiert und transparent migriert
3. JWT wird als **httpOnly-Cookie** (`jwt`) gesetzt; `api.js` sendet es automatisch via `credentials: 'include'`. Kein Token in localStorage. `Authorization: Bearer <token>` funktioniert als Fallback für Skripte und E2E-Tests
4. Middleware validiert JWT, setzt `req.user = { username, role, ... }`
5. Routen prüfen Rollen: `requireAdmin`, `requireBearbeiter`

**CSRF** (`backend/src/middleware/csrf.js`): Double-Submit-Cookie-Muster. `GET /api/csrf-token` setzt ein lesbares `csrfToken`-Cookie; `api.js` spiegelt es als `X-CSRF-Token`-Header bei POST/PUT/PATCH/DELETE. Nur für cookie-authentifizierte Anfragen erzwungen.

**Kontosperrung & Passwort-Reset** (`backend/src/utils/accountSecurity.js`): 5 aufeinanderfolgende fehlgeschlagene Logins sperren das Konto für 30 Minuten. Reset via `POST /api/auth/forgot-password` → `POST /api/auth/reset-password`; nur der SHA-256-Hash des Tokens wird gespeichert. Kein SMTP konfiguriert — ein Admin erzeugt den Reset-Link über `POST /api/auth/admin/generate-reset-link` (Token erscheint nicht im Log).

### Rollen & Berechtigungen
| Rolle | Zugriff |
|-------|---------|
| `user` | Nur Schmuckstücke anlegen |
| `bearbeiter` | Alle Seiten außer Admin-Bereich |
| `admin` | Vollzugriff + Audit-Log, Benutzer, Backup, Debug |

---

## Wichtige Dateien

| Zweck | Pfad |
|-------|------|
| **Datenbankschema** | `backend/src/config/migrations/` (maßgeblich), `db/init.sql` (eingefrorener Start-Stand) |
| **Umgebungsvariablen** | `.env.example` (nach `.env` kopieren, JWT_SECRET & DB_PASSWORD setzen) |
| **WHERE-Builder-Doku** | `backend/src/utils/WHERE_BUILDER.md` |
| **Excel-Export** | `backend/src/utils/excelService.js` |
| **Logging** | `backend/src/utils/logger.js` |
| **Passwort-Hashing** | `backend/src/utils/passwordService.js` |
| **Fotos** | `backend/src/utils/fotoService.js` |
| **Ausführliche Doku** | `docs/ARCHITEKTUR.md` |
| **Regeln für Claude** | `.claude/rules/` |

---

## Tests

Befehle stehen im Abschnitt „Befehle“, Regeln und Integrationssuiten in `.claude/rules/testing.md`. Tests laufen bei jedem PR über GitHub Actions (`.github/workflows/tests.yml`).

---

## Häufige Aufgaben

### Neuen API-Endpunkt hinzufügen
1. Route in `backend/src/routes/[feature].js` anlegen
2. `whereClauseBuilder` verwenden, wenn Schmuckstücke gefiltert werden
3. Middleware einbinden: `authenticate`, `requireAdmin` usw.
4. Test in `backend/__tests__/` ergänzen
5. In `backend/src/index.js` mit `app.use('/api/[feature]', require(...))` registrieren
6. Vom Frontend über `api.js` aufrufen

### Neue Seite hinzufügen
1. Komponente in `frontend/src/pages/[Feature].jsx` anlegen
2. Route in `App.jsx` mit `<ProtectedRoute>` registrieren, falls rollengeschützt
3. API-Aufrufe in `frontend/src/api.js` ergänzen
4. Vorhandene `DataTable`/`TableToolbar`-Komponenten für Listen verwenden

### Filter oder Listen-Logik ändern
1. Für Schmuckstücke: `whereClauseBuilder` in `backend/src/utils/whereClauseBuilder.js` erweitern
2. Für Dokumentenlisten (Lieferscheine/Rechnungen): `DocumentManager.jsx` bearbeiten
3. Filter-Options-Endpunkt aktualisieren, wenn neue Filter-Dimensionen hinzukommen

### Auf Synology NAS deployen
Siehe `README.md`, Abschnitt „Synology NAS" und `deploy/README.md`. Installer: `deploy/install.sh` (Release-Asset, Standard für alle Projekte); Release-Dateien: `deploy/docker-compose.yml`, `deploy/.env.example`, `db/`.

---

## Debugging

- **Backend-Logs**: `docker compose -f docker-compose.dev.yml logs backend`
- **Frontend-Logs**: Browser-DevTools-Konsole
- **DB-Logs**: `docker compose -f docker-compose.dev.yml logs db`
- **Health-Check**: `GET /api/health`
- **JWT-Probleme**: Middleware loggt den Ablehnungsgrund; httpOnly-Cookie `jwt` im Browser prüfen (DevTools → Application → Cookies)
- **Foto-Upload schlägt fehl**: 400 kommt aus der Magic-Byte-/Größenprüfung in `utils/fotoService.js`
