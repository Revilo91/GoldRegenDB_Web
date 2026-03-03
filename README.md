[![Release für Synology](https://github.com/Revilo91/GoldRegenDB_Web_new/actions/workflows/release.yml/badge.svg)](https://github.com/Revilo91/GoldRegenDB_Web_new/actions/workflows/release.yml)

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
