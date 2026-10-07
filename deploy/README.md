# GoldRegenDB – Synology-Deployment

Quellen der Release-Assets: `docker-compose.yml`, `.env.example`, `install.sh` (hier) sowie
`init.sql`, `backup.sh`, `restore.sh` (aus `db/`). Jedes GitHub-Release hängt sie flach an.

## Voraussetzungen

- Synology NAS mit Container Manager (DSM 7+), SSH-Zugang, root (`sudo`)

## Installation und Update

```bash
curl -fsSL https://github.com/Revilo91/GoldRegenDB_Web/releases/latest/download/install.sh | sudo bash
```

Weitere Aufrufe (als Datei, `install.sh` aus dem Release herunterladen):

```bash
sudo bash install.sh v1.2.3         # bestimmte Version
sudo bash install.sh --rollback     # zurück auf die Version vor dem letzten Update
sudo INSTALL_DIR=/volume1/docker/x bash install.sh
```

Ablauf: Release laden und Image ziehen (noch nichts verändert), dann
1. Datenbank sichern nach `backups/pre-update_*.sql.gz` (letzte 10 bleiben),
2. Ordner anlegen, 3. Stack stoppen, `:previous` merken, alte Images löschen,
4. Release-Dateien einspielen, `.env` anlegen bzw. um neue Variablen ergänzen
(`DB_PASSWORD`, `JWT_SECRET`, `BESTELLUNG_ENCRYPTION_KEY` erzeugt das Skript selbst),
5. starten, Health-Check, bei Fehler automatischer Rollback.

Bestehende `.env`-Werte werden nie überschrieben. Aufrufen: `http://<synology-ip>:3000`,
erster Login `admin` / `admin` (Passwort danach ändern).

## Ordner (relativ zu `/volume1/docker/goldregendb`)

| Pfad | Inhalt |
|------|--------|
| `data/postgres` | Datenbank |
| `backups` | tägliche/wöchentliche Backups, `pre-update_*.sql.gz`, `migrations/` |
| `db` | `init.sql`, `backup.sh`, `restore.sh` |

Fotos liegen in der Datenbank. Für den Bestandsimport (`scripts/import-fotos.js`) wird ein
beliebiger Ordner beim Aufruf eingebunden, siehe README.md im Repository.

## Update von älteren Installationen

Lag die Datenbank bisher direkt in `data/` (alter PGDATA-Pfad), übernimmt `install.sh` sie per
Dump nach `data/postgres`; das alte Verzeichnis bleibt unverändert liegen. Die Variablen
`IMAGE_TAG` heißt jetzt `APP_VERSION` (setzt das Skript), `APP_HOST_PORT` heißt `APP_PORT` (Wert wird übernommen).
Ein `DATA_DIR` in der `.env`, das nicht dem Installationsordner entspricht, bricht das Skript ab.

## Backup

`install.sh` sichert nur vor einem Update (`backups/pre-update_*.sql.gz`, die letzten 10).
Den laufenden Plan übernimmt `db/backup.sh`: täglich (7 Tage) und wöchentlich (4 Wochen),
mit geprüftem Dump. Ablage unter `backups/daily/` und `backups/weekly/` im Installationsordner.
Es läuft nichts von allein, der Aufruf kommt vom DSM-Aufgabenplaner:

1. DSM: Systemsteuerung → Aufgabenplaner → Erstellen → Geplante Aufgabe → Benutzerdefiniertes Skript.
2. Benutzer `root`, Zeitplan täglich 02:00 Uhr.
3. Befehl (Pfad = `INSTALL_DIR`):
   ```bash
   cd /volume1/docker/goldregendb && docker compose exec -T db /backup.sh >> backups/backup.log 2>&1
   ```

Einmal manuell: `docker compose exec db /backup.sh`.

Wiederherstellen (ersetzt die komplette Datenbank, vorher die App stoppen):

```bash
cd /volume1/docker/goldregendb
docker compose stop app
docker compose exec db /restore.sh /backups/daily/goldregendb_<zeitstempel>.sql.gz
docker compose start app
```

## Hinweise

- Backup und Wiederherstellen: siehe Abschnitt „Backup“.
- Ohne vorgeschalteten Reverse Proxy läuft alles über unverschlüsseltes HTTP.
  HTTPS-Einrichtung: README.md im Repository, Abschnitt „HTTPS auf Synology“.
