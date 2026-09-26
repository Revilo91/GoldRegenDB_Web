# GoldRegenDB – Schmuckverwaltung

[![Release für Synology](https://github.com/Revilo91/GoldRegenDB_Web/actions/workflows/release.yml/badge.svg)](https://github.com/Revilo91/GoldRegenDB_Web/actions/workflows/release.yml)

Webbasiertes Warenwirtschaftssystem für handgefertigten Schmuck (Beton, Perlen, Holz u. a.).  
Verwaltet Schmuckstücke, Kunden, Lieferscheine, Rechnungen und Inventuren – vollständig containerisiert mit Docker.

---

## Inhaltsverzeichnis

- [Features](#features)
- [Tech-Stack](#tech-stack)
- [Voraussetzungen](#voraussetzungen)
- [Schnellstart](#schnellstart)
  - [Entwicklung (Hot-Reload)](#entwicklung-hot-reload)
  - [Produktion (lokal)](#produktion-lokal)
  - [Synology NAS](#synology-nas)
    - [HTTPS auf Synology](#https-auf-synology-issue-138)
- [Umgebungsvariablen](#umgebungsvariablen)
- [Secrets rotieren](#secrets-rotieren)
- [Benutzerrollen](#benutzerrollen)
- [Projektstruktur](#projektstruktur)
- [Backup & Wiederherstellung](#backup--wiederherstellung)
- [Tests](#tests)
- [Troubleshooting](#troubleshooting)

---

## Features

- **Schmuckstückverwaltung** – Erstellen, Bearbeiten, Filtern und Suchen mit 34 Attributen (Art, Material, Farbe, Maße, Foto, Preise …)
- **Foto-Upload** – Drag & Drop mit Vorschau; gespeichert in `backend/src/assets/uploads/`
- **Kundenverwaltung** – Einzelhandelspartner mit Provision und Auslagerungsstatus
- **Lieferscheine & Rechnungen** – Erstellen und Verknüpfen mit Schmuckstücken
- **Inventurübersicht** – ausgelagerte Stücke pro Kunde mit Excel-Export
- **SumUp-Integration** – CSV-Export verfügbarer Stücke; CSV-Import mit automatischer Lieferschein-/Rechnungserstellung
- **Dashboard** – Statistiken zu Gesamtbestand, Auslagerungen, Verkäufen und Umsatz
- **Audit-Log** – automatisches Änderungsprotokoll über DB-Trigger
- **Datensicherung** – JSON-Export und -Import aller Tabellen (Admin)
- **Benutzerverwaltung** – JWT-Authentifizierung mit drei Rollen (Admin)
- **API-Dokumentation** – Swagger-UI unter `/api-docs` (nur Admin; standardmäßig außerhalb Produktion aktiv, siehe `ENABLE_API_DOCS`)

---

## Tech-Stack

| Schicht       | Technologie                                          |
|---------------|------------------------------------------------------|
| Datenbank     | PostgreSQL 16                                        |
| Backend       | Node.js · Express.js · `pg` (kein ORM)               |
| Auth          | JWT (`jsonwebtoken`) · `bcryptjs`                    |
| Datei-Upload  | `multer` (max. 5 MB, jpg/png/gif)                    |
| Excel-Export  | `exceljs`                                            |
| Rate Limiting | `express-rate-limit`                                 |
| Frontend      | React 19 · Vite · React Router v7 · Font Awesome     |
| Container     | Docker · Docker Compose (Single-Image, kein Nginx)   |

---

## Voraussetzungen

- [Docker](https://docs.docker.com/get-docker/) ≥ 24 und Docker Compose ≥ 2
- Git (für den Entwicklungsmodus)
- Für den nativen Entwicklungsmodus (`npm run dev` ohne Docker für Backend/Frontend):
  Node.js **22.x (aktuelle LTS-Linie)** und npm ≥ 10 — die exakte Version steht in
  [`.nvmrc`](.nvmrc); mit [nvm](https://github.com/nvm-sh/nvm) genügt `nvm use`.
  Docker-Images und CI sind auf dieselbe Node-Version gepinnt.

---

## Schnellstart

### Entwicklung (Hot-Reload)

**Nativ (empfohlen)** — nur die Datenbank läuft in Docker, Backend/Frontend laufen direkt auf dem Host:

```bash
git clone https://github.com/Revilo91/GoldRegenDB_Web.git
cd GoldRegenDB_Web

cp .env.example .env          # Passwörter/Secrets anpassen!
npm install                   # installiert Root- + Backend- + Frontend-Workspaces
npm run dev                   # startet DB (Docker), Backend (node --watch) und Frontend (vite) parallel
```

| Dienst    | URL                       |
|-----------|---------------------------|
| Frontend  | http://localhost:5173      |
| Backend   | http://localhost:3001      |
| Datenbank | localhost:5432             |

> Backend und Frontend starten mit Hot-Reload. Änderungen an Quell­dateien werden sofort übernommen.

**Alternative: voll containerisiert** (2 Container: db + app mit Hot-Reload)

```bash
docker compose -f docker-compose.dev.yml up --build
```

| Dienst    | URL                       |
|-----------|---------------------------|
| Frontend  | http://localhost:3000 (→ Vite :5173) |
| Backend   | http://localhost:3001      |
| Datenbank | localhost:5432             |

> Backend und Frontend laufen in einem gemeinsamen App-Container (`app`) und werden von `concurrently` parallel mit Hot-Reload gestartet. Die Datenbank läuft in einem separaten `db`-Container.

### Produktion (lokal)

Frontend und Backend laufen als **ein** Image/Container (Express liefert die gebaute React-App und die API same-origin aus, kein Nginx):

```bash
cp .env.example .env          # Passwörter/Secrets anpassen!
docker compose up --build -d
```

| Dienst          | URL                  |
|-----------------|----------------------|
| Frontend + API  | http://localhost:3000 |

### Synology NAS

Das einfachste Deployment nutzt das fertige Release-Paket. Es enthält `docker-compose.yml`
(= `docker-compose.synology.yml`), eine `.env.example` mit der passenden `IMAGE_TAG`-Version,
`synology-update.sh` sowie `db/init.sql`, `db/backup.sh` und `db/restore.sh`, die die Compose-Datei relativ zu sich
selbst einbindet. Weitere Dateien müssen nicht an feste Pfade kopiert werden.

1. Neueste Version von der [Releases-Seite](https://github.com/Revilo91/GoldRegenDB_Web/releases) herunterladen: `goldregendb-synology-*.zip`

2. Paket auf die Synology kopieren und entpacken:
   ```bash
   scp goldregendb-synology-*.zip admin@<synology-ip>:/tmp/
   ssh admin@<synology-ip>
   mkdir -p /volume1/docker/goldregendb
   unzip /tmp/goldregendb-synology-*.zip -d /tmp/goldregendb_pkg
   cp -r /tmp/goldregendb_pkg/goldregendb-synology-*/. /volume1/docker/goldregendb/
   ```

3. `.env`-Datei anlegen und Passwörter/Secrets setzen:
   ```bash
   cd /volume1/docker/goldregendb
   cp .env.example .env
   nano .env
   ```
   | Variable | Bedeutung | Standard |
   |----------|-----------|----------|
   | `DATA_DIR` | Wurzel für `data/` (Datenbank), `backups/` und `uploads/` (Fotos); fehlende Ordner legt Docker an | `/volume1/docker/goldregendb` |
   | `IMAGE_TAG` | Version von `ghcr.io/revilo91/goldregendb` (ohne führendes `v`), Pflicht | Version des Pakets |
   | `APP_HOST_PORT` / `DB_HOST_PORT` | Ports auf der Synology | `3000` / `15432` |

4. Container starten:
   ```bash
   docker compose up -d
   ```

5. Frontend aufrufen: `http://<synology-ip>:3000`, erster Login `admin` / `admin`
   (das Passwort muss danach geändert werden).

**Aktualisieren:** `docker-compose.yml`, `synology-update.sh` und `db/` aus dem neuen
Paket übernehmen, die `.env` behalten und `./synology-update.sh <version>` ausführen
(z. B. `./synology-update.sh 0.3.0`). Das Skript trägt die Version als `IMAGE_TAG` in die
`.env` ein, zieht das Image und startet die Container neu.

**Migration bestehender Installationen** (Pakete bis v0.2.0 mit fest verdrahteten
`/volume1/docker/goldregendb/...`-Pfaden): Neue `docker-compose.yml` und `db/` über die alten
Dateien kopieren, die `.env` bleibt, und `./synology-update.sh <version>` ausführen – ohne
`IMAGE_TAG` in der `.env` startet Compose nicht mehr, einen Rückfall auf `latest` gibt es
nicht. Ohne `DATA_DIR` gilt `/volume1/docker/goldregendb`, Datenbank, Backups und Fotos
werden also am bisherigen Ort weiterverwendet. Liegt die Compose-Datei nicht in
`/volume1/docker/goldregendb`, `DATA_DIR` auf den bisherigen Ordner setzen und `db/`
neben die Compose-Datei legen. Alte Pakete verwiesen außerdem auf einen Image-Tag mit
führendem `v` (`:v0.2.0`), der Release-Workflow pusht die Tags aber ohne `v` (`0.2.0`) –
auch das ist mit `IMAGE_TAG` behoben.

> **Hinweis:** `VITE_API_URL` muss nicht gesetzt werden – die API-URL ist bereits ins Image eingebettet. Ein einzelnes Image liefert Frontend und API same-origin aus (kein Nginx nötig).

> ⚠️ **Ohne die folgenden Schritte läuft dieses Deployment nur über HTTP** – Login,
> JWT-Cookie und alle Daten gehen unverschlüsselt über das Netz. Für den produktiven
> Betrieb unbedingt HTTPS einrichten (siehe unten).

#### HTTPS auf Synology (Issue #138)

Express terminiert selbst kein TLS – ein vorgeschalteter Reverse Proxy übernimmt das.
Zwei Wege stehen zur Wahl:

**Option A – Synology Reverse Proxy + Certificate Manager (empfohlen für DSM):**

1. **Systemsteuerung → Sicherheit → Zertifikat** ein Let's-Encrypt-Zertifikat für
   die Domain anlegen (DSM verlängert es automatisch).
2. **Systemsteuerung → Anmeldeportal → Erweitert → Reverse Proxy** einen Eintrag
   anlegen: Quelle `https://<domain>:443` → Ziel `http://localhost:3000`.
   Unter "Benutzerdefinierter Header" `X-Forwarded-Proto` auf `https` setzen
   (DSM setzt `X-Forwarded-For`/`-Host` bereits automatisch).
3. In der `.env` setzen und Container neu starten:
   ```bash
   FORCE_HTTPS=true
   COOKIE_SECURE=true
   TRUST_PROXY=1
   ```
   ```bash
   docker compose up -d
   ```
4. Aufrufen über `https://<domain>` (Port 3000 bleibt intern, nicht mehr direkt
   nötig – in der Firewall der Synology kann er für externen Zugriff gesperrt werden).

**Option B – Caddy-Container mit automatischem Let's Encrypt (ohne DSM-Reverse-Proxy):**

Ein fertiges Overlay bringt einen Caddy-Container mit, der Port 80/443 belegt,
automatisch ein Zertifikat holt/erneuert und HSTS, HTTP→HTTPS-Redirect sowie
HTTP/2 ohne weitere Konfiguration mitbringt (siehe `proxy/Caddyfile`):

```bash
# DOMAIN muss per DNS auf die Synology zeigen; Port 80+443 müssen frei sein
# (ggf. den DSM-eigenen Reverse Proxy für diese Ports deaktivieren).
DOMAIN=schmuck.example.com docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d
```

Das Overlay setzt `FORCE_HTTPS`, `COOKIE_SECURE` und `TRUST_PROXY` bereits automatisch
und macht den `app`-Container nur noch über den Proxy erreichbar. Eigene Zertifikate
statt automatischem Let's Encrypt: siehe Kommentare in `proxy/Caddyfile`.

---

## Umgebungsvariablen

Alle Variablen werden in der `.env`-Datei im Projekt­wurzel­verzeichnis gesetzt (Vorlage: `.env.example`).

| Variable        | Beschreibung                                       | Beispielwert                                           |
|-----------------|----------------------------------------------------|--------------------------------------------------------|
| `POSTGRES_DB`   | Datenbankname                                      | `goldregendb`                                          |
| `POSTGRES_USER` | PostgreSQL-Superuser                               | `goldregen`                                            |
| `DB_PASSWORD`   | Passwort des PostgreSQL-Superusers                 | `changeme`                                             |
| `DATABASE_URL`  | Verbindungs-URL für den nativen Backend-Prozess (`npm run dev`); Docker-Compose überschreibt dies selbst mit dem Netzwerknamen `db` | `postgresql://goldregen:changeme@localhost:5432/goldregendb` |
| `PORT`          | Backend-Port                                       | `3001`                                                 |
| `JWT_SECRET`    | Geheimer Schlüssel für JWT-Tokens (lang & zufällig)| `change-this-to-a-long-random-secret`                  |
| `JWT_SECRET_OLD`| Optional: vorheriges `JWT_SECRET` während einer Rotation (Graceful Rollover) | – |
| `BESTELLUNG_ENCRYPTION_KEY` | AES-256-GCM-Schlüssel für DSGVO-Kundendaten (`openssl rand -hex 32`) | `change-this-to-a-64-char-hex-key` |
| `NODE_ENV`      | Laufzeit-Umgebung                                  | `production` / `development`                           |
| `VITE_API_URL`  | API-URL für das Frontend bei nativer Entwicklung   | `http://localhost:3001/api`                            |
| `FORCE_HTTPS`   | HTTP→HTTPS-Redirect + HSTS aktivieren (nur mit TLS-terminierendem Reverse Proxy davor, siehe [HTTPS auf Synology](#https-auf-synology-issue-138)) | `true` / `false` |
| `HSTS_MAX_AGE`  | Gültigkeitsdauer des HSTS-Headers in Sekunden (nur mit `FORCE_HTTPS=true`) | `15552000` (180 Tage) |
| `COOKIE_SECURE` | Secure-Flag auf dem JWT-Cookie (nur mit `FORCE_HTTPS`) | `true` / `false`                                    |
| `TRUST_PROXY`   | Anzahl vertrauenswürdiger Proxy-Hops vor der App   | `1`                                                     |
| `ALLOWED_ORIGINS` | Kommaseparierte CORS-Origins, die auf die API zugreifen dürfen (nur relevant, wenn Frontend/Backend nicht same-origin laufen) | `http://localhost:5173,http://localhost:3000` |
| `DB_POOL_MAX`   | Maximale Anzahl paralleler PostgreSQL-Verbindungen | `25`                                                    |
| `LOG_FORMAT`    | Logger-Ausgabeformat (`utils/logger.js`): `json` (maschinenlesbar) oder `pretty` (lesbar); Standard: `json` in Produktion, sonst `pretty` | `pretty` |
| `ENABLE_API_DOCS` | Swagger-UI unter `/api-docs` erzwingen/deaktivieren (Standard: nur außerhalb `NODE_ENV=production` aktiv; immer zusätzlich hinter `authenticate` + `requireAdmin`) | `true` / `false` |
| `PRIVACY_POLICY_VERSION` | Version der Datenschutzerklärung, die beim Consent protokolliert wird | `2026-01-v1` |
| `BESTELLUNG_RETENTION_TAGE_OHNE_RECHNUNG` | Aufbewahrungsfrist (Tage) für die DSGVO-Anonymisierung ohne Rechnung (`backend/scripts/dsgvo-retention.js`) | `90` |
| `BESTELLUNG_RETENTION_JAHRE_MIT_RECHNUNG` | Aufbewahrungsfrist (Jahre) für die DSGVO-Anonymisierung mit Rechnung | `10` |

> ⚠️ **`JWT_SECRET`**, **`DB_PASSWORD`** und **`BESTELLUNG_ENCRYPTION_KEY`** müssen vor dem ersten Start auf sichere, zufällige Werte gesetzt werden. Mit `NODE_ENV=production` verweigert das Backend den Start, solange noch ein Platzhalterwert aus `.env.example` oder ein zu kurzes Secret gesetzt ist (`backend/src/config/secrets.js`).

**Secrets aus Dateien statt Klartext-Env-Vars** (Docker Secrets/NAS-Deployments): Für jede der obigen Variablen kann zusätzlich `<NAME>_FILE` gesetzt werden, z. B. `JWT_SECRET_FILE=/run/secrets/jwt_secret` – der Dateiinhalt hat dann Vorrang vor `JWT_SECRET`. Unterstützt für `JWT_SECRET`, `JWT_SECRET_OLD`, `DB_PASSWORD`, `DATABASE_URL` und `BESTELLUNG_ENCRYPTION_KEY`. Details und ein Beispiel für `docker-compose.yml` siehe [Secrets rotieren](#secrets-rotieren).

---

## Secrets rotieren

Ein geleaktes Secret (z. B. durch ein versehentliches Commit oder einen kompromittierten NAS-Zugang) blieb bisher für immer gültig – es gab keine Rotation. Dieser Abschnitt beschreibt den unterstützten Ablauf.

### Secrets aus Dateien statt `.env` laden

Standardmäßig liegen Secrets als Klartext in der `.env`-Datei. Für ein produktives Deployment empfiehlt sich stattdessen die datei-basierte Variante:

1. Werte erzeugen und unter `./secrets/` ablegen (Verzeichnis ist in `.gitignore`, wird **nie** committet):
   ```bash
   ./scripts/rotate-secret.sh jwt_secret
   ./scripts/rotate-secret.sh db_password
   ./scripts/rotate-secret.sh bestellung_encryption_key
   ```
2. In `docker-compose.yml` (bzw. `docker-compose.synology.yml`) den einkommentierten `secrets:`-Block aktivieren und `DATABASE_URL`/`JWT_SECRET`/`BESTELLUNG_ENCRYPTION_KEY` in der `app`-Umgebung durch die `*_FILE`-Variante ersetzen (siehe Kommentare in der jeweiligen Datei).
3. `docker compose up -d` – das Backend liest die Werte dann über `getSecret()` (`backend/src/config/secrets.js`) aus den gemounteten Dateien.

> Warum dateibasiert und nicht `external: true`-Docker-Secrets? Letztere funktionieren nur im Swarm-Modus. Auf einer Synology bzw. mit einfachem `docker compose up` sind file-basierte Secrets (`file: ./secrets/...`) der realistische Weg – Compose mountet sie auch ohne Swarm nach `/run/secrets/`.

### `JWT_SECRET` rotieren (Graceful Rollover)

Ein hartes Rotieren würde alle angemeldeten Nutzer sofort ausloggen (bestehende Tokens werden mit dem alten Secret signiert und wären ungültig). Stattdessen:

1. Neues Secret erzeugen: `./scripts/rotate-secret.sh jwt_secret` (oder `openssl rand -hex 32`).
2. Das **bisherige** `JWT_SECRET` als `JWT_SECRET_OLD` setzen, das **neue** als `JWT_SECRET`.
3. Backend neu starten. Ab jetzt werden neue Tokens mit dem neuen Secret signiert; bereits ausgestellte Tokens werden weiterhin akzeptiert, weil `authenticate()` beim Verifizieren zusätzlich `JWT_SECRET_OLD` prüft (`backend/src/middleware/auth.js`).
4. Nach Ablauf der maximalen Token-Lebensdauer (8 Stunden, siehe `AUTH_COOKIE_MAX_AGE_MS`) sind alle Alt-Tokens ohnehin abgelaufen – `JWT_SECRET_OLD` wieder entfernen und erneut neu starten.

**Auswirkung für angemeldete Nutzer:** keine – niemand wird während der Rotation ausgeloggt, solange Schritt 4 erst nach Ablauf der Alt-Tokens erfolgt.

### `DB_PASSWORD` rotieren

1. Neues Passwort erzeugen: `./scripts/rotate-secret.sh db_password`.
2. Passwort in PostgreSQL selbst ändern (Downtime-frei möglich):
   ```bash
   docker compose exec db psql -U "$POSTGRES_USER" -c "ALTER USER \"$POSTGRES_USER\" WITH PASSWORD 'NEUES_PASSWORT';"
   ```
3. `DB_PASSWORD` (bzw. `DB_PASSWORD_FILE`) in der `.env`/den Secrets aktualisieren.
4. Backend-Container neu starten, damit der Connection-Pool die neue `DATABASE_URL` verwendet: `docker compose restart app`.

Es gibt hier keinen Graceful Rollover – der Connection-Pool baut bei jedem Neustart eine neue Verbindung auf, ein kurzer Verbindungsabbruch während des Neustarts ist normal.

### `BESTELLUNG_ENCRYPTION_KEY` rotieren – **dokumentierte Grenze**

`BESTELLUNG_ENCRYPTION_KEY` verschlüsselt die DSGVO-Kundendaten in `bestellung_kunde` (AES-256-GCM, siehe `backend/src/utils/encryptionService.js`). Ein Rotieren dieses Schlüssels erfordert, dass **alle** bestehenden verschlüsselten Datensätze mit dem alten Schlüssel entschlüsselt und mit dem neuen wieder verschlüsselt werden (Re-Encryption) – anders als bei `JWT_SECRET` gibt es keinen Graceful-Rollover-Mechanismus, da die Daten dauerhaft gespeichert sind (nicht wie Tokens nach Stunden ablaufen).

`./scripts/rotate-secret.sh bestellung_encryption_key` erzeugt bewusst **nur** den neuen Schlüssel und warnt davor, ihn ohne Re-Encryption scharf zu schalten – ein automatisiertes Daten-Migrationsskript ist **nicht** Teil dieser Umsetzung (Scope von Issue #140: OS-Env/Docker-Secrets + JWT-Rollover). Wer diesen Schlüssel rotieren muss:

1. Alten Schlüssel sicher aufbewahren (ohne ihn sind bestehende Daten unwiederbringlich verloren).
2. Alle Zeilen aus `bestellung_kunde` mit `decryptField()` (altem Schlüssel) lesen, mit `encryptField()` (neuem Schlüssel) neu schreiben – am besten als einmaliges, transaktional abgesichertes Migrationsskript nach dem Muster von `backend/scripts/dsgvo-retention.js`.
3. Erst danach `BESTELLUNG_ENCRYPTION_KEY` produktiv umstellen.

---

## Benutzerrollen

Standard-Login nach dem ersten Start: **admin** / **admin** (bitte sofort ändern!)

| Rolle        | Berechtigungen                                                                                  |
|--------------|-------------------------------------------------------------------------------------------------|
| `admin`      | Vollzugriff: alle Seiten + Audit-Log, Debug, Benutzerverwaltung, Datensicherung                 |
| `bearbeiter` | Alle Seiten außer Admin-Bereich (Dashboard, Kunden, Schmuckstücke, Lieferscheine, Rechnungen, SumUp, Inventur) |
| `user`       | Nur Schmuckstücke anlegen                                                                       |

---

## Projektstruktur

```
GoldRegenDB_Web/
├── Dockerfile                       # Produktions-Build (Frontend gebaut + Backend)
├── Dockerfile.dev                   # Entwicklungs-Build (Frontend + Backend mit Hot-Reload)
├── docker-compose.yml               # Produktions-Stack (db + app)
├── docker-compose.dev.yml           # Entwicklungs-Stack mit Hot-Reload (db + app)
├── docker-compose.synology.yml      # Synology-NAS-spezifisch
├── docker-compose.proxy.yml         # Optionales Overlay: Caddy-Reverse-Proxy mit TLS (Issue #138)
├── proxy/Caddyfile                  # Caddy-Konfiguration für docker-compose.proxy.yml
├── package.json                     # npm-Workspace-Root (`npm run dev` startet alles)
├── .env.example                     # Vorlage für Umgebungsvariablen
│
├── db/
│   ├── init.sql                    # PostgreSQL-Schema (Tabellen + Trigger)
│   ├── seed.sql                    # Initiale Daten
│   ├── backup.sh                   # Backup-Skript (täglich/wöchentlich)
│   ├── restore.sh                  # Wiederherstellungs-Skript
│   └── README.md                   # Detaillierte Backup/Restore-Doku
│
├── backend/
│   ├── src/
│   │   ├── index.js                # Express-Einstiegspunkt
│   │   ├── config/db.js            # PostgreSQL-Verbindung (pg Pool)
│   │   ├── middleware/auth.js      # JWT-Middleware (authenticate, requireAdmin)
│   │   ├── routes/                 # REST-API-Routen
│   │   │   ├── auth.js             # Login, /me
│   │   │   ├── users.js            # Benutzerverwaltung (Admin)
│   │   │   ├── dashboard.js        # Statistiken
│   │   │   ├── kunden.js           # Kunden CRUD
│   │   │   ├── schmuckstuecke.js   # Schmuckstücke CRUD + Foto-Upload
│   │   │   ├── lieferscheine.js    # Lieferscheine CRUD
│   │   │   ├── rechnungen.js       # Rechnungen CRUD
│   │   │   ├── sumup.js            # SumUp CSV Import/Export
│   │   │   ├── inventur.js         # Inventurübersicht + Excel-Export
│   │   │   ├── backup.js           # Datensicherung (Admin)
│   │   │   └── auditLog.js         # Audit-Log (Admin)
│   │   └── utils/excelService.js   # Excel-Generierung
│   └── package.json
│
└── frontend/
    ├── src/
    │   ├── App.jsx                 # Root-Komponente (Router, Layout, Nav)
    │   ├── api.js                  # API-Client (alle Backend-Aufrufe)
    │   ├── context/AuthContext.jsx # Authentifizierungs-Kontext
    │   ├── components/
    │   │   ├── PhotoUpload.jsx     # Foto-Upload (Drag & Drop + Vorschau)
    │   │   └── ProtectedRoute.jsx  # Routen-Schutz
    │   └── pages/                  # Seiten-Komponenten
    │       ├── Login.jsx
    │       ├── Dashboard.jsx
    │       ├── Schmuckstuecke.jsx
    │       ├── Kunden.jsx
    │       ├── Lieferscheine.jsx
    │       ├── Rechnungen.jsx
    │       ├── Sumup.jsx
    │       ├── Inventur.jsx
    │       ├── AuditLog.jsx        # Admin
    │       ├── Benutzerverwaltung.jsx  # Admin
    │       └── Datensicherung.jsx  # Admin
    └── package.json
```

---

## Backup & Wiederherstellung

Detaillierte Dokumentation: [`db/README.md`](db/README.md)

### Manuelles Backup (SQL-Dump via pg_dump)

```bash
# Produktion
docker compose exec db /backup.sh

# Entwicklung
docker compose -f docker-compose.dev.yml exec db /backup.sh
```

Backups werden im Docker-Volume `pgbackups` unter `/backups/daily/` und `/backups/weekly/` gespeichert (7 tägliche + 4 wöchentliche Dumps).

### JSON-Backup über die Web-Oberfläche (Admin)

Unter **Einstellungen → Datensicherung** können alle Tabellen als JSON exportiert und wieder importiert werden.

---

## Tests

```bash
# Backend (Jest)
cd backend && npm test

# Frontend (Vitest)
cd frontend && npm test

# End-to-End (Playwright, gegen eine laufende docker-compose.dev.yml-Instanz)
npm run test:e2e
```

E2E-Tests liegen in `e2e/` und nutzen die `.env`-Variablen `BASE_URL`, `API_URL`, `TEST_USERNAME`, `TEST_PASSWORD`.

---

## Troubleshooting

**`KeyError: 'ContainerConfig'`** (Docker Compose v1)

```bash
docker-compose -f docker-compose.dev.yml down
docker builder prune -f
docker-compose -f docker-compose.dev.yml up --build -d
```

**Backend-Abhängigkeiten veraltet nach `package.json`-Änderung**

Das Skript `backend/scripts/dev-start.sh` erkennt Änderungen an `package.json` automatisch und führt `npm install` neu aus.
