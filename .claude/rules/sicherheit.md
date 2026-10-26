# Sicherheit: Speicher, Container, Abhängigkeiten

Gilt in allen Projekten. Kommt aus `project-base` und wird per Sync überschrieben; Änderungen nur dort.

## Speicher und DoS (Server)

- Große Request-Bodys erst nach Login- und Rechteprüfung parsen: Auth-Middleware vor `express.json({ limit })`. Große Limits nur auf den Pfaden, die sie brauchen; global klein halten (z. B. 256 kB).
- Öffentliche Endpunkte mit großen Bodys (Upload ohne Login) bekommen vor dem Parser drei Bremsen: eigenes Rate-Limit pro IP, Obergrenze gleichzeitiger Uploads (sofort 503 + `Retry-After`) und Timeout für den Empfang des Bodys (danach 408, Platz wird frei). Rate-Limits zählen nur Requests, nicht gleichzeitig offene Bodys.
- Body-Limits aus den fachlichen Grenzen ableiten statt einer Magic Number: Anzahl × Dateigröße × 4/3 bei Base64, plus kleiner Puffer. Zu klein → erlaubte Uploads bekommen 413, zu groß → unnötig viel RAM pro Request.
- Hinter einem Reverse Proxy `trust proxy` korrekt setzen, sonst teilen sich alle Clients ein Rate-Limit-Kontingent. Interne Dienste (z. B. ein MCP-Server) kommen alle von einer Container-IP.
- Große Datenmengen (Backups, Exporte) möglichst streamen statt komplett im Speicher aufzubauen.

## Container (Dockerfile, Compose)

- Nie als root: im Laufzeit-Image `USER node` bzw. einen eigenen Benutzer setzen. Nur die Schreibpfade (z. B. `/app/backups`) mit `chown` anlegen, der App-Code bleibt root-gehört. Bei Bind-Mounts vorher die Dateirechte bestehender Installationen prüfen und eine Migration einplanen.
- Jeder Dienst bekommt `mem_limit` (per Env-Variable mit Default), damit ein Ausreißer nur den Container trifft, nicht NAS oder VM. `mem_limit` statt `deploy.resources`, weil es auch im alten `docker-compose` v1 wirkt.
- Node-Dienste: `NODE_OPTIONS=--max-old-space-size=<ca. 70 % des Limits>`. Ohne nutzt Node vom Container-Limit nur einen Teil bzw. setzt den Heap bei kleinen Limits über das Limit.
- Alle Dienste: `security_opt: [no-new-privileges:true]`. App-Container ohne privilegierte Ports: `cap_drop: [ALL]`. Postgres behält die Standard-Capabilities (Entrypoint braucht `chown`/`su-exec`).
- Nach einem Absturz prüfen: `docker inspect --format '{{.State.OOMKilled}}' <container>`.

## Abhängigkeiten

- `npm audit` für jedes versionierte Lockfile, auch Dev-Abhängigkeiten. Dependabot zählt pro Lockfile: Funde eines Workspaces erscheinen im Workspace- und im Root-Lockfile doppelt.
- Unterscheiden, was ins Image oder Frontend-Bundle gelangt (dringend) und was nur Build/Dev betrifft.
- Beheben ohne `npm audit fix --force`. Major-Updates nur nach Changelog-Prüfung und Nachweis, dass die genutzte API kompatibel ist. Lockfiles nur mit npm erzeugen, nie von Hand oder per Skript zusammensetzen; danach muss `npm install --package-lock-only` sie unverändert lassen.
