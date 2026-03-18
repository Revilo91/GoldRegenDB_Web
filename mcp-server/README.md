# GoldRegenDB MCP Server

Dieser Ordner enthält einen minimalen MCP-Server (Model Context Protocol / KI-Proxy) für das Projekt GoldRegenDB.

Zweck:
- Lokales Ziel, über das Tools/KI-Agenten Requests an Modelle leiten können.
- Weiterleitung an mehrere Provider (OpenAI, Hugging Face, Ollama) je nach Konfiguration.

Schnellstart:

1. Installieren

```bash
cd mcp-server
npm install
```

2. Starten

Mit OpenAI-Key (Beispiel):

```bash
export OPENAI_API_KEY="sk-..."
npm start
```

Mit Hugging Face (Beispiel):

```bash
export HUGGINGFACE_API_KEY="hf_..."
npm start
```

Mit Ollama (lokal):

```bash
export OLLAMA_URL="http://localhost:11434"
npm start
```

3. Ohne Key startet der Server und liefert Mock-/Echo-Antworten (nützlich für Tests).

Endpoints:
- `GET /health` — Health-Check (zeigt verfügbare Provider an)
- `POST /mcp/query` — Body JSON: `{ provider?, model?, messages?, prompt? }`
  - `provider` optional: `openai`, `huggingface`, `ollama`. Wird er weggelassen, wird die Reihenfolge aus `PROVIDER_PRIORITY` verwendet.
  - Beispiel Body (chat messages):

```json
{
  "model": "gpt-4o-mini",
  "messages": [{ "role": "user", "content": "Gib mir eine kurze Beschreibung von MBH001" }]
}
```

  - Beispiel Body (simple prompt):

```json
{ "prompt": "Beschreibe MBH001 in einem Satz." }
```

  - Rückgabe: `{ ok:true, provider: 'openai'|'huggingface'|'ollama', text: '...', raw: {...} }`

Docker:

```bash
docker build -t goldregendb-mcp-server:latest .
docker run -p 5100:5100 --env-file .env.example goldregendb-mcp-server:latest

Hinweis: Setze die relevanten Provider-Keys in der `.env` (nicht in der Repo-Datei!).
```

Sicherheit:
- Lege keinen API-Key im Repo ab. Nutze `.env` oder Secret-Management im Deployment.

Weiteres:
- Das ist ein einfacher, erweiterbarer Startpunkt — erweitere Endpoints/Authentifizierung nach Bedarf.
