# GoldRegenDB – Frontend

React 19-Anwendung, gebaut mit [Vite](https://vitejs.dev/) und React Router v7.

## Entwicklung

Das Frontend wird normalerweise über Docker Compose gestartet (siehe Haupt-[README](../README.md)).  
Für eine direkte lokale Entwicklung außerhalb von Docker:

```bash
cd frontend
npm install
npm run dev        # Vite Dev-Server auf http://localhost:5173
```

Damit das Frontend das Backend erreicht, muss `VITE_API_URL` gesetzt sein:

```bash
VITE_API_URL=http://localhost:3001/api npm run dev
```

## Produktion (Build)

```bash
npm run build      # erzeugt dist/
npm run preview    # Vorschau des Produktions-Builds
```

Im Produktions-Docker-Image wird der Build von Nginx ausgeliefert und `/api`-Anfragen werden per Proxy an das Backend weitergeleitet.

## Lint

```bash
npm run lint
```

## Wichtige Dateien

| Datei / Verzeichnis          | Beschreibung                                  |
|------------------------------|-----------------------------------------------|
| `src/App.jsx`                | Root-Komponente mit Router und Navigation     |
| `src/api.js`                 | Alle API-Aufrufe zum Backend (mit Auth-Header)|
| `src/context/AuthContext.jsx`| Authentifizierungs-Kontext (JWT, Benutzer)    |
| `src/pages/`                 | Seiten-Komponenten                            |
| `src/components/`            | Wiederverwendbare Komponenten                 |
| `src/utils/hashPassword.js`  | SHA-256-Hashing vor dem Senden ans Backend    |
