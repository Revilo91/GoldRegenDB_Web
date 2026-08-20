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
- [Benutzerrollen](#benutzerrollen)
- [Projektstruktur](#projektstruktur)
- [Backup & Wiederherstellung](#backup--wiederherstellung)
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

Das einfachste Deployment nutzt das fertige Release-Paket.

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
   cp /volume1/docker/goldregendb/.env.example /volume1/docker/goldregendb/.env
   nano /volume1/docker/goldregendb/.env
   ```

4. Uploads-Ordner erstellen (für Fotos):
   ```bash
   mkdir -p /volume1/docker/goldregendb/uploads
   ```

5. Container starten:
   ```bash
   cd /volume1/docker/goldregendb
   docker compose up -d
   ```

6. Frontend aufrufen: `http://<synology-ip>:3000`

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
| `NODE_ENV`      | Laufzeit-Umgebung                                  | `production` / `development`                           |
| `VITE_API_URL`  | API-URL für das Frontend bei nativer Entwicklung   | `http://localhost:3001/api`                            |
| `FORCE_HTTPS`   | HTTP→HTTPS-Redirect + HSTS aktivieren (nur mit TLS-terminierendem Reverse Proxy davor, siehe [HTTPS auf Synology](#https-auf-synology-issue-138)) | `true` / `false` |
| `COOKIE_SECURE` | Secure-Flag auf dem JWT-Cookie (nur mit `FORCE_HTTPS`) | `true` / `false`                                    |
| `TRUST_PROXY`   | Anzahl vertrauenswürdiger Proxy-Hops vor der App   | `1`                                                     |

> ⚠️ **`JWT_SECRET`** und **`DB_PASSWORD`** müssen vor dem ersten Start auf sichere, zufällige Werte gesetzt werden.

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

## Troubleshooting

**`KeyError: 'ContainerConfig'`** (Docker Compose v1)

```bash
docker-compose -f docker-compose.dev.yml down
docker builder prune -f
docker-compose -f docker-compose.dev.yml up --build -d
```

**Backend-Abhängigkeiten veraltet nach `package.json`-Änderung**

Das Skript `backend/scripts/dev-start.sh` erkennt Änderungen an `package.json` automatisch und führt `npm install` neu aus.
