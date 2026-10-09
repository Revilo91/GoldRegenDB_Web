# Deploy-Konfiguration: goldregendb

Quelle der Werte: Konfigurationskopf von `deploy/install.sh`. Bei Abweichung gilt das Skript.

| Wert | Inhalt |
|---|---|
| Repository | `Revilo91/GoldRegenDB_Web` |
| Image | `ghcr.io/revilo91/goldregendb:<version>` (Tag ohne führendes `v`) |
| Installationsordner | `/volume1/docker/goldregendb` (änderbar mit `INSTALL_DIR`) |
| Host-Port | `3000` (`.env`-Variable `APP_PORT`) |
| Datenordner | `data/postgres`, `backups`, `db` |
| Vom Installer erzeugte Secrets | `DB_PASSWORD`, `JWT_SECRET`, `BESTELLUNG_ENCRYPTION_KEY` |
| Umbenannte `.env`-Variablen (alt:neu) | `APP_HOST_PORT:APP_PORT` |
| Release-Dateien | `docker-compose.yml`, `.env.example`, `install.sh`, `init.sql`, `backup.sh`, `restore.sh` |
| Release-Auslöser | Tag `vX.Y.Z` → `.github/workflows/release.yml` |
| Doku | `deploy/README.md` |

## Prüfbefehle vor dem Release

1. `cd backend && npm test && npm run lint && npm run typecheck`
2. `cd frontend && npm test && npm run lint && npm run build`

## Installation und Update (per SSH auf der NAS)

```bash
curl -fsSL https://github.com/Revilo91/GoldRegenDB_Web/releases/latest/download/install.sh | sudo bash
```

## Neue Produktions-Variablen

Neue Variablen in `.env.example` und `deploy/.env.example` eintragen und in `docker-compose.yml` sowie `deploy/docker-compose.yml` unter `environment:` an den Container durchreichen. Soll der Installer ein Secret erzeugen, zusätzlich in `SECRET_KEYS` von `deploy/install.sh` aufnehmen.

## Hinweise

- Der Release-Workflow startet die Release-Dateien mit dem frischen Image (Smoke-Test), bevor er das Image nach GHCR pusht. Lokal nachstellen: README.md, Abschnitt „Release bauen“.
- Backups nach dem Update übernimmt `db/backup.sh` über den DSM-Aufgabenplaner, nicht der Installer.
- Details und Sonderfälle: `deploy/README.md`.
