---
paths:
  - "backend/**"
  - "frontend/**"
  - "e2e/**"
  - "scripts/**"
  - "mcp-server/**"
---

# Code-Stil

Der allgemeine Teil gilt in allen Projekten. Bei Widerspruch gilt der Abschnitt zu diesem Projekt.

## Code-Qualität

- Klar vor clever. Kleine Funktionen, eine Aufgabe pro Funktion, sprechende Namen.
- Keine Magic Numbers, Konstanten benennen.
- Fehler behandeln, nie still schlucken. Fehlermeldungen mit Ursache + Kontext.
- Kommentare erklären das *Warum*, nicht das *Was*.
- Eingaben von außen immer validieren.
- Kein toter Code, keine auskommentierten Blöcke.

## JavaScript (React/Vite, Node.js/Express)

- `const`/`let`, nie `var`. Strikte Vergleiche (`===`). `async/await` statt Callback-Ketten.
- Lint/Format: ESLint + Prettier. Abhängigkeiten über `package.json` + Lockfile, Node-Version festlegen (`.nvmrc`).
- Tests: Playwright für E2E, Vitest für Unit-Tests (Vite-Projekte).
- React: kleine Komponenten, Hooks-Regeln beachten, Zustand nicht doppelt halten.
- Auth/Routing: Race Conditions beim Laden beachten (Auth-Guard erst nach geladenem Zustand entscheiden).
- Backend: Eingaben validieren, Fehler zentral in Middleware behandeln, nie Roh-Fehler an den Client geben.

## Projektkonventionen

- **Keine Funktions-Wrapper:** `hersteller_Marina()` → direkt `hersteller("M")` verwenden
- **Keine ausführlichen Docstrings:** Methodennamen sind selbsterklärend; ein einzeiliger Kommentar nur, wenn das WARUM nicht offensichtlich ist. Ausnahme: Typ-Annotationen in `@ts-check`-Dateien (siehe „Typisierung“)
- **Duplikate zusammenführen:** Wenn Konstanten/Logik in 2+ Dateien existieren, in `utils/` auslagern
- **Kein Debug-Logging:** `console.log/error` nur für echte Fehler; Debug-Traces nach Gebrauch löschen
- **Kein `alert()`:** Fehler- und Erfolgsmeldungen laufen über `useToast()` aus `frontend/src/components/Toast.jsx`. ESLint erzwingt das per `no-restricted-globals` — `confirm()` bleibt für Löschabfragen erlaubt
- **Kein JSDoc-Boilerplate:** Props per Inline-Kommentar beschreiben, kein Header-Block. Erlaubt und erwünscht sind nur Typ-Tags (`@param {Typ}`, `@returns`, `@typedef`) in `@ts-check`-Dateien, ohne Beschreibungsprosa

## Typisierung

- Backend bleibt JavaScript, kein TypeScript-Build. Typen kommen per JSDoc (`@param`, `@returns`, `@typedef`, `import('../types/…')`); Typdefinitionen (DB-Zeilen, geteilte Rückgabeformen) liegen in `backend/src/types/*.d.ts`
- Opt-in pro Datei: `// @ts-check` als erste Zeile (`checkJs` bleibt `false`). `cd backend && npm run typecheck` (in CI) prüft genau diese Dateien
- Neue Utils/Middleware mit `@ts-check` anlegen und in `backend/__tests__/tsCheckOptIn.test.js` eintragen; Typfehler nur per Annotation/Cast beheben, nie durch Logikänderung. Details: `backend/TYPESCRIPT.md`
