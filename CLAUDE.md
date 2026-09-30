# CLAUDE.md

Dieses Dokument gibt Claude Code Kontext und Regeln für die Arbeit in diesem Repository.

---

## Regeln für Claude

1. Umfangreiche oder parallele Arbeit geht an Subagenten; Rückfragen, Pläne, Einzeiler und Commits macht die Haupt-KI selbst (Details: Abschnitt „Delegation & Modellwahl“ unten).
2. Die Haupt-KI hat immer das letzte Wort: Subagenten committen nie, den Commit macht die Haupt-KI nach Diff-Prüfung und Tests.
3. Mehr Details: Abschnitt „Delegation & Modellwahl“ unten



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

## Code-Konventionen

- **Keine Funktions-Wrapper:** `hersteller_Marina()` → direkt `hersteller("M")` verwenden
- **Keine ausführlichen Docstrings:** Methodennamen sind selbsterklärend; ein einzeiliger Kommentar nur, wenn das WARUM nicht offensichtlich ist. Ausnahme: Typ-Annotationen in `@ts-check`-Dateien (siehe „Typisierung“)
- **Duplikate zusammenführen:** Wenn Konstanten/Logik in 2+ Dateien existieren, in `utils/` auslagern
- **Kein Debug-Logging:** `console.log/error` nur für echte Fehler; Debug-Traces nach Gebrauch löschen
- **Rate-Limiter nur für unauthentifizierte Endpunkte** (Login, Passwort-Reset, öffentliches Bestellformular) mit echten Limits. Die angemeldete Anwendung bleibt bewusst ungedrosselt: die Tabellenansicht lädt jedes Foto einzeln, jedes Limit trifft dort den Normalbetrieb
- **Kein `alert()`:** Fehler- und Erfolgsmeldungen laufen über `useToast()` aus `frontend/src/components/Toast.jsx`. ESLint erzwingt das per `no-restricted-globals` — `confirm()` bleibt für Löschabfragen erlaubt
- **Kein JSDoc-Boilerplate:** Props per Inline-Kommentar beschreiben, kein Header-Block. Erlaubt und erwünscht sind nur Typ-Tags (`@param {Typ}`, `@returns`, `@typedef`) in `@ts-check`-Dateien, ohne Beschreibungsprosa

**Commit-Stil (bisect-freundlich):**
- Kleine, atomare Commits: eine logische Änderung pro Commit
- Jeder Commit ist für sich lauffähig (Tests grün, App startet), damit `git bisect` eindeutig gut/schlecht liefert
- Code, zugehörige Tests und Doku einer Änderung gehören in denselben Commit; unabhängige Änderungen in eigene Commits
- Regeländerungen (CLAUDE.md) vorab und getrennt von der Code-Änderung committen

**Branches:**
- Nach GitHub wird **nur über eigene Branches** gepusht (`feat/…`, `fix/…`, `docs/…`), nie direkt auf `main`
- `main` ändert sich ausschließlich über Pull Requests; lokale Commits auf `main` vor dem Push auf einen Branch verschieben

---

## Typisierung

- Backend bleibt JavaScript, kein TypeScript-Build. Typen kommen per JSDoc (`@param`, `@returns`, `@typedef`, `import('../types/…')`); Typdefinitionen (DB-Zeilen, geteilte Rückgabeformen) liegen in `backend/src/types/*.d.ts`
- Opt-in pro Datei: `// @ts-check` als erste Zeile (`checkJs` bleibt `false`). `cd backend && npm run typecheck` (in CI) prüft genau diese Dateien
- Neue Utils/Middleware mit `@ts-check` anlegen und in `backend/__tests__/tsCheckOptIn.test.js` eintragen; Typfehler nur per Annotation/Cast beheben, nie durch Logikänderung. Details: `backend/TYPESCRIPT.md`

---

## Kritische Projektregeln

### 1. WHERE-Clause-Builder (Backend)
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

### 2. Frontend-Styling (React)
**Strikte Regel: Keine Inline-Styles**
```jsx
// ❌ VERBOTEN
<div style={{ marginTop: 24, display: "flex" }}>

// ✅ ERFORDERLICH
<div className="my-container">
```

Alle Styles gehören als Klassendefinitionen in die passende Datei unter `frontend/src/styles/` (`<seite>.css`, Basis: `variables.css`, `layout.css`, `buttons.css`, `forms.css`, `modal.css` …). `frontend/src/index.css` ist nur die Import-Liste; die Reihenfolge der `@import`s bildet die Kaskade ab und darf nicht verändert werden. Neue Dateien am Ende einhängen, keine Datei über ca. 400 Zeilen.

**Ausnahme:** Dynamische Werte (aus Daten/State berechnet) nur als CSS-Variable: `style={{ "--balken-breite": `${x}%` }}` mit `width: var(--balken-breite)` in der Klasse. Bedingte Styles zwischen festen Werten sind bedingte Klassennamen, keine Variablen. ESLint (`no-restricted-syntax`) erzwingt das.
**Klassennamen** je Seite/Komponente einheitlich präfixiert (`inventur-…`, `dashboard-…`, `docmgr-…`) und in der jeweiligen `styles/<seite>.css` in einem eigenen kommentierten Block gruppiert; vorhandene Klassen (z. B. `cursor-pointer`, `mr-8`) wiederverwenden. Ein doppelter Klassenname im Selektor (`.a.a`) hebt die Spezifität, wo eine bestehende Regel sonst gewinnt.

**Ausnahme:** Dynamische Werte (aus Daten/State berechnet) nur als CSS-Variable: `style={{ "--balken-breite": `${x}%` }}` mit `width: var(--balken-breite)` in der Klasse. Bedingte Styles zwischen festen Werten sind bedingte Klassennamen, keine Variablen. ESLint (`no-restricted-syntax`) erzwingt das.
**Klassennamen** je Seite/Komponente einheitlich präfixiert (`inventur-…`, `dashboard-…`, `docmgr-…`) und in `index.css` in einem eigenen kommentierten Block je Datei gruppiert; vorhandene Klassen (z. B. `cursor-pointer`, `mr-8`) wiederverwenden. Ein doppelter Klassenname im Selektor (`.a.a`) hebt die Spezifität, wo eine bestehende Regel sonst gewinnt.

### 3. Fotos
- Fotos liegen **in PostgreSQL**: Tabelle `"Foto"` (Schmuckstücke, Schlüssel = Basis-Artikelnummer, `MHO123` gilt für `MHO123_1`, `MHO123_2`) und `bestellung_foto` (Bestellformular)
- Lesen/Schreiben nur über `backend/src/utils/fotoService.js`; Listen prüfen per `EXISTS`, damit keine BYTEA-Daten geladen werden
- Liste, Detail und Inventur liefern je Stück `hatFoto` (boolean via `hatFotoSql()`); das Frontend lädt das Bild über die Artikelnummer
- Max. 5 MB (jpg/png/gif), Typ per Magic Bytes geprüft, nicht per Dateiendung
- Upload: `multer.memoryStorage()` in `schmuckstuecke.js`; Auslieferung mit ETag aus `Geaendert` und `Cache-Control: private, max-age=60`
- Fotos werden per **eigenem Foto-ZIP** gesichert (`utils/fotoZip.js`), nicht über den JSON-Export: `GET /api/backup/export-fotos` (REPEATABLE-READ-Snapshot), `POST /api/backup/import-fotos-zip` (Hintergrund-Job, Fortschritt: `GET /api/backup/import-fotos-jobs/:id`)
- **SQL-Dump:** `GET /api/backup/export-sql` exportiert als COPY-Blöcke. `frontend/src/utils/sqlDump.js` liest beim Import nur COPY-Blöcke und schickt sie an `POST /api/backup/import` — SQL wird nie direkt ausgeführt
- **Kein Datei-Fallback:** Fotos kommen nur aus der Datenbank; ohne Eintrag antwortet `GET /foto/:name` mit 404

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
├── config/db.js           # PostgreSQL-Pool + request-scoped Client + Startup-Migrationen
└── utils/                 # whereClauseBuilder, excelService, logger, passwordService

db/
├── init.sql               # Schema: 7 Tabellen + Audit-Trigger
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
- Kein ORM: Abfragen direkt mit `pg` (node-postgres)
- Alle Einfüge-/Update-Operationen verwenden Prepared Statements gegen SQL-Injection
- Session-Benutzer wird per `SET app.current_user = 'username'` im `authenticate`-Middleware gesetzt (fließt in Audit-Trigger)
- Startup-Migrationen in `db.js` stellen Schema-Konsistenz sicher

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
| **Datenbankschema** | `db/init.sql` (7 Tabellen, Audit-Trigger) |
| **Umgebungsvariablen** | `.env.example` (nach `.env` kopieren, JWT_SECRET & DB_PASSWORD setzen) |
| **WHERE-Builder-Doku** | `backend/src/utils/WHERE_BUILDER.md` |
| **Excel-Export** | `backend/src/utils/excelService.js` |
| **Logging** | `backend/src/utils/logger.js` |
| **Passwort-Hashing** | `backend/src/utils/passwordService.js` |
| **Fotos** | `backend/src/utils/fotoService.js` |
| **Ausführliche Doku** | `docs/ARCHITEKTUR.md` |

---

## Tests

**Backend** (Jest):
```bash
cd backend && npm test
# Tests in: __tests__/**/*.test.js
# Mocks: db.js, logger.js via jest.mock()
```

Für Backup/Restore gibt es eine Integrationssuite gegen echtes Postgres (`__tests__/backup.integration.test.js`), die nur mit `TEST_DATABASE_URL` läuft und Datenbanken ohne „test" im Namen ablehnt.

**Frontend** (Vitest):
```bash
cd frontend && npm test
# Tests in: src/__tests__/**/*.test.js
```

Tests laufen automatisch bei jedem PR über GitHub Actions (`.github/workflows/tests.yml`).

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
Siehe `README.md`, Abschnitt „Synology NAS".

---

## Debugging

- **Backend-Logs**: `docker compose -f docker-compose.dev.yml logs backend`
- **Frontend-Logs**: Browser-DevTools-Konsole
- **DB-Logs**: `docker compose -f docker-compose.dev.yml logs db`
- **Health-Check**: `GET /api/health`
- **JWT-Probleme**: Middleware loggt den Ablehnungsgrund; httpOnly-Cookie `jwt` im Browser prüfen (DevTools → Application → Cookies)
- **Foto-Upload schlägt fehl**: 400 kommt aus der Magic-Byte-/Größenprüfung in `utils/fotoService.js`


---

## CLAUDE.md – Globale Arbeitsregeln

### 1. Arbeitsablauf (immer in dieser Reihenfolge)

1. **Verstehen**: Bei unklarer Anforderung genau EINE Rückfrage stellen.
2. **Planen**: Bei mehr als 2 Dateien oder neuer Architektur zuerst einen kurzen Plan zeigen und auf OK warten.
3. **Test zuerst**: Erst fehlschlagenden Test schreiben, dann Implementierung (TDD), wo sinnvoll.
4. **Klein umsetzen**: Ein Schritt = ein Commit. Keine Sammel-Änderungen.
5. **Prüfen**: Tests/Linter/Build wirklich ausführen, bevor "fertig" gesagt wird. Ausgabe zeigen.
6. **Zusammenfassen**: 2–3 Zeilen: was geht jetzt, wie ausprobieren, was ist offen.

### 2. Grenzen (nicht ohne Rückfrage)

- Keine Änderungen außerhalb des besprochenen Umfangs (kein "nebenbei" Refactoring).
- Keine neuen Abhängigkeiten ohne Begründung (Standardbibliothek zuerst).
- Keine destruktiven Aktionen: `rm -rf`, `git push --force`, `git reset --hard`, DB-Migrationen, Löschen von Dateien.
- Keine Secrets, Passwörter, Tokens im Code oder in Commits. Immer `.env` / Secret-Store, `.env` in `.gitignore`.
- Keine Netzwerk-/Systemänderungen an Proxmox, Home Assistant oder NAS ohne ausdrückliches OK.

### 3. Code-Qualität

- Klar vor clever. Kleine Funktionen, eine Aufgabe pro Funktion, sprechende Namen.
- Keine Magic Numbers, Konstanten benennen.
- Fehler behandeln, nie still schlucken. Fehlermeldungen mit Ursache + Kontext.
- Kommentare erklären das *Warum*, nicht das *Was*.
- Eingaben von außen immer validieren.
- Kein toter Code, keine auskommentierten Blöcke.

#### JavaScript (React/Vite, Node.js/Express)
- `const`/`let`, nie `var`. Strikte Vergleiche (`===`). `async/await` statt Callback-Ketten.
- Lint/Format: ESLint + Prettier. Abhängigkeiten über `package.json` + Lockfile, Node-Version festlegen (`.nvmrc`).
- Tests: Playwright für E2E, Vitest für Unit-Tests (Vite-Projekte).
- React: kleine Komponenten, Hooks-Regeln beachten, Zustand nicht doppelt halten.
- Auth/Routing: Race Conditions beim Laden beachten (Auth-Guard erst nach geladenem Zustand entscheiden).
- Backend: Eingaben validieren, Fehler zentral in Middleware behandeln, nie Roh-Fehler an den Client geben.

#### SQL / Datenbank
- Nur parametrisierte Queries. Schema-Änderungen ausschließlich per Migration, nie direkt live.
- Vor Migrationen Backup. Indizes für Fremdschlüssel und häufige Filter.
- Datensätze einmal laden und im Speicher halten, nicht bei jedem Aufruf neu abfragen (sofern Konsistenz nicht leidet).

#### Docker / Compose
- Feste Image-Tags statt `latest`. Secrets über `.env`/Secrets, nicht ins Image.
- Volumes für Daten, Healthchecks für Dienste. Änderungen an Produktiv-Containern (Synology) erst nach OK.

### 4. Tests

- Neue Funktion oder Bugfix = mindestens ein Test.
- Bugfix: erst Test, der den Fehler reproduziert, dann Fix.
- Abdecken: Normalfall, Grenzwerte, Fehlerfall, leere/ungültige Eingabe.
- Tests unabhängig voneinander, keine Reihenfolge-Abhängigkeit, keine echten externen Dienste (mocken).

### 5. Git

- Commits nach Conventional Commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`.
- Eine logische Änderung pro Commit, Betreff maximal 72 Zeichen, Imperativ.
- Feature-Arbeit auf eigenem Branch, nie direkt auf `main`.
- Vor Commit: `git diff` prüfen, keine Debug-Reste, keine Secrets.

### 6. Debugging

- Erst reproduzieren, dann Ursache finden, dann fixen. Kein Raten und Herumprobieren.
- Nach 3 erfolglosen Versuchen: stoppen, Annahme benennen, die vermutlich falsch ist, EINE Diagnosefrage stellen.
- Root Cause beheben, nicht das Symptom.

### 7. Sicherheit

- Kein `eval`/`exec` auf externen Eingaben, keine SQL-String-Konkatenation (parametrisierte Queries).
- Abhängigkeiten aktuell halten, bekannte Schwachstellen prüfen.
- Logs ohne Passwörter/Tokens/personenbezogene Daten.

### 8. Arbeiten mit KI (Vibe-Coding-Regeln für mich)

- Ich bleibe verantwortlich: jeden KI-Diff lesen, bevor er committet wird.
- Kleine, klar beschriebene Aufgaben statt "bau mir alles".
- Kontext geben: Ziel, Randbedingungen, Beispiel für erwartetes Verhalten.
- Bei langem Chat mit Drift: neue Session starten, Stand in 5 Zeilen zusammenfassen.
- Wiederkehrende Fehler der KI hier in die Datei eintragen (Abschnitt 9).
- Sessionende: Wurde ich korrigiert oder ist derselbe Fehler zweimal passiert, schlage genau EINE Zeile für Abschnitt 9 vor (Datum, Fehler → Regel). Nur nach meinem OK eintragen, als eigener Commit `docs:`.

### 9. Gelernte Korrekturen (laufend ergänzen)

- _(noch leer)_

### 10. Delegation & Modellwahl (nur Claude Code)

- Hauptagent: plant, delegiert, prüft, spricht mit mir. Umfangreiche oder parallele Arbeit macht ein Subagent.
- Selbst erledigen (kein Subagent): Rückfragen an mich, Pläne, Einzeiler, eine einzelne Datei lesen, Commit, Endkontrolle.
- Parallel nur bei unabhängigen Aufgaben (keine gemeinsamen Dateien).
- Auftrag an Subagenten immer vollständig: Ziel, betroffene Dateien, erwartetes Ergebnisformat, Grenzen aus Abschnitt 2.
- Ergebnis nie ungeprüft übernehmen: Diff lesen, Tests selbst ausführen (Abschnitt 1, Schritt 5).
- Haupt-KI hat immer das letzte Wort: Subagenten ändern nur Dateien und committen nie; den Commit für ihre Änderungen macht die Haupt-KI nach Diff-Prüfung und Tests.

Modellwahl (Aliase `haiku`, `sonnet`, `opus` nutzen, keine Versionsnummern):
- **haiku**: Dateien suchen/lesen, Logs zusammenfassen, Formatierung, Doku-Kleinkram.
- **sonnet** (Standard): Implementieren, Tests schreiben, Refactoring, Code-Review.
- **opus**: Architektur, schwieriges Debugging, Security-Review, oder wenn sonnet nach 3 Versuchen scheitert (Abschnitt 6).
- Im Zweifel eine Stufe niedriger starten, bei Misserfolg hochstufen.
