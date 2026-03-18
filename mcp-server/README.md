# GoldRegenDB MCP Server

Dieser Ordner enthält einen minimalen MCP-Server (Model Context Protocol / KI-Proxy) für das Projekt GoldRegenDB.

Zweck:
- Lokales Ziel, über das Tools/KI-Agenten Requests an Modelle leiten können.
- Optional: Weiterleitung an OpenAI Chat-Completions wenn `OPENAI_API_KEY` gesetzt ist.

Schnellstart:

1. Installieren

```bash
cd mcp-server
npm install
```

2. Mit OpenAI-Key starten (optional)

```bash
export OPENAI_API_KEY="sk-..."
npm start
```

3. Ohne Key startet der Server und liefert Mock-/Echo-Antworten (nützlich für Tests).

Endpoints:
- `GET /health` — Health-Check
- `POST /mcp/query` — Body JSON: `{ model?, messages?, prompt? }`
  - Wenn `OPENAI_API_KEY` gesetzt ist, wird dieser Request an OpenAI weitergeleitet.
  - Sonst liefert der Server eine Mock-/Echo-Antwort.

Docker:

```bash
docker build -t goldregendb-mcp-server:latest .
docker run -p 5100:5100 --env-file .env.example goldregendb-mcp-server:latest
```

Sicherheit:
- Lege keinen API-Key im Repo ab. Nutze `.env` oder Secret-Management im Deployment.

Weiteres:
- Das ist ein einfacher, erweiterbarer Startpunkt — erweitere Endpoints/Authentifizierung nach Bedarf.
