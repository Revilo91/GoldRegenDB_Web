[![Release für Synology](https://github.com/Revilo91/GoldRegenDB_Web_new/actions/workflows/release.yml/badge.svg)](https://github.com/Revilo91/GoldRegenDB_Web_new/actions/workflows/release.yml)

## Synology-Deployment (empfohlen: Release-Paket)

Das einfachste Deployment nutzt die fertigen Docker-Images aus dem Release-Paket.

### Voraussetzungen
- Synology NAS mit Docker/Container Manager (DSM 7+)
- SSH-Zugang zur Synology

### Schnellstart

1. Neueste Version von der [Releases-Seite](https://github.com/Revilo91/GoldRegenDB_Web_new/releases) herunterladen: `goldregendb-synology-*.zip`

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
   Mindestens folgende Werte anpassen (Beispiel):
   ```
   DB_PASSWORD=sicheres-passwort
   JWT_SECRET=ein-langer-zufälliger-geheimer-schluessel
   DATABASE_URL=postgresql://goldregen:sicheres-passwort@db:5432/goldregendb
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
   Standard-Login: **admin** / **admin123** (bitte sofort ändern!)

> **Hinweis:** `VITE_API_URL` muss **nicht** gesetzt werden – die API-URL ist bereits ins Image eingebettet und wird über den internen nginx-Proxy geleitet.

---

## Troubleshooting (Docker Compose v1)

Wenn beim Start/Rebuild der Fehler `KeyError: 'ContainerConfig'` auftritt (häufig bei `docker-compose` v1), hilft ein kompletter Neuaufbau des Stacks:

```bash
docker-compose -f docker-compose.dev.yml down
docker-compose -f docker-compose.dev.yml up -d
```

Optional bei hartnäckigen Fällen:

```bash
docker builder prune -f
docker-compose -f docker-compose.dev.yml up --build -d
```

Hinweis: Im Backend sorgt `backend/scripts/dev-start.sh` zusätzlich dafür, dass bei Änderungen an `backend/package.json` Abhängigkeiten automatisch neu installiert werden.
