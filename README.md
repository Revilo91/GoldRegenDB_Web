[![Release für Synology](https://github.com/Revilo91/GoldRegenDB_Web_new/actions/workflows/release.yml/badge.svg)](https://github.com/Revilo91/GoldRegenDB_Web_new/actions/workflows/release.yml)

## Synology-Deployment

1. Projektdateien nach `/volume1/docker/goldregendb/` auf dem NAS kopieren (z.B. per SCP oder SSH).
2. `.env`-Datei aus `.env.example` erstellen und **`JWT_SECRET`** sowie **`DB_PASSWORD`** setzen:
   ```
   JWT_SECRET=ein-langer-zufälliger-geheimer-schlüssel
   DB_PASSWORD=sicheres-passwort
   PORT=3001
   POSTGRES_DB=goldregendb
   POSTGRES_USER=goldregen
   DATABASE_URL=postgresql://goldregen:sicheres-passwort@db:5432/goldregendb
   ```
3. Stack starten:
   ```bash
   docker compose -f /volume1/docker/goldregendb/docker-compose.synology.yml --env-file /volume1/docker/goldregendb/.env up -d --build
   ```
4. Frontend aufrufen: `http://<synology-ip>:3000`

> **Hinweis:** `VITE_API_URL` muss in der `.env`-Datei bei Synology **nicht** gesetzt werden.
> Die API-Anfragen laufen intern über den nginx-Proxy (`/api`) im Frontend-Container.

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
