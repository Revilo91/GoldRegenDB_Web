# GoldRegenDB – Synology-Deployment

## Voraussetzungen

- Synology NAS mit Container Manager (DSM 7+)
- SSH-Zugang zur Synology

## Installation

1. Paket entpacken, der Inhalt kommt nach `/volume1/docker/goldregendb/`:
   ```bash
   mkdir -p /volume1/docker/goldregendb
   unzip goldregendb-synology-*.zip -d /tmp/goldregendb_pkg
   cp -r /tmp/goldregendb_pkg/goldregendb-synology-*/. /volume1/docker/goldregendb/
   ```
2. `.env` anlegen und alle Platzhalter ersetzen:
   ```bash
   cd /volume1/docker/goldregendb
   cp .env.example .env
   nano .env
   ```
   `DB_PASSWORD`, `JWT_SECRET` und `BESTELLUNG_ENCRYPTION_KEY` erzeugen, z. B. mit
   `openssl rand -hex 32`. Solange ein Platzhalter drinsteht, startet das Backend nicht.
   Sollen Daten, Backups und Fotos woanders liegen, `DATA_DIR` anpassen.
3. Starten:
   ```bash
   docker compose up -d
   ```
4. Aufrufen: `http://<synology-ip>:3000`. Erster Login `admin` / `admin`, das
   Passwort muss danach geändert werden.

## Aktualisieren

`docker-compose.yml`, `synology-update.sh` und `db/` aus dem neuen Paket über die
alten Dateien kopieren, die `.env` behalten und das Update mit der neuen Version starten:

```bash
./synology-update.sh 0.3.0
```

Das Skript setzt `IMAGE_TAG` in der `.env`, zieht das Image und startet die Container
neu. `IMAGE_TAG` ist Pflicht – ohne startet Compose nicht.

## Hinweise

- Datenbank, Backups und Fotos liegen unter `DATA_DIR` (`data/`, `backups/`, `uploads/`).
- Backup: `docker compose exec db /backup.sh`, Wiederherstellen siehe `db/restore.sh`.
- Ohne vorgeschalteten Reverse Proxy läuft alles über unverschlüsseltes HTTP.
  HTTPS-Einrichtung: README.md im Repository, Abschnitt „HTTPS auf Synology“.
