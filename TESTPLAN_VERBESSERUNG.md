# Fahrplan: Verbesserung der Teststrategie GoldRegenDB

**Stand:** 2026-09-16 · **Basis:** ISTQB CTFL v4.0 / CTAL-TAE v2.0 · Analyse von 27 Backend- und 2 Frontend-Testdateien

## 1. Ist-Stand (Befund)

**Stärken der vorhandenen Tests** (v.a. `auth.routes.test.js`, `accountSecurity.test.js`, `whereClauseBuilder.test.js`, `authApi.test.js`):
- Klare Testnamen mit fachlichem Bezug, kein Doppel von Tabelle/Gherkin
- Negative Partitionen (fehlende Felder, falsches Passwort, gesperrtes Konto, abgelaufenes Token) sind eigene Testfälle – gute Fehlerisolation
- Sicherheitsrelevante Regressionen sind explizit verankert (Klartext-Passwort, CSRF-Header, httpOnly-Cookie, Benutzernamen-Orakel)
- Zeitgrenzen werden mit festem `JETZT`-Datum statt `Date.now()` getestet → deterministisch, keine Flakiness

**Lücken:**

| # | Befund | Risiko |
|---|---|---|
| 1 | **Backend-Routen ohne Tests:** `dashboard.js`, `debug.js`, `inventur.js`, `kunden.js`, `lieferscheine.js`, `rechnungen.js`, `sumup.js` (nur `sumup.utils` getestet, nicht die Route) | Hoch – Kunden/Lieferscheine/Rechnungen sind Kerngeschäftslogik (DocumentManager-Pattern), ungetestet |
| 2 | **Frontend: nur 2 von ~17 Seiten + 5 Komponenten getestet** (`EtikettPhomemo`, `authApi`). `DataTable`, `DocumentManager`, `SchmuckstueckModal`, `Schmuckstuecke.jsx`, `Kunden.jsx` ohne Tests | Hoch – zentrale, wiederverwendete Komponenten ohne Abnahmetest |
| 3 | **Keine Coverage-Threshold** in `backend/package.json` (`jest`-Block) oder Frontend-Vitest-Config | Mittel – Rückgang der Testabdeckung fällt nicht automatisiert auf |
| 4 | **`whereClauseBuilder.test.js`:** rein beispielbasiert (intuitive Testfallermittlung), keine erkennbare Äquivalenzklassenbildung für Parameter-Typen (z. B. `null`/`undefined`/leerer String bei `equals()`, `like()`, `artikelnummerIn([])`) | Mittel – Randfälle der zentralen Query-Utility nicht nachweisbar abgedeckt |
| 5 | **`schmuckstuecke.routes.test.js`:** keine Tests für Rollenprüfung (`requireAdmin`/`requireBearbeiter`) auf dieser Route, obwohl `auth.middleware.test.js` die Middleware isoliert testet – keine Integrationsabsicherung, dass die Route sie tatsächlich einbindet | Mittel – Middleware kann in der Route vergessen werden, ohne dass ein Test bricht |
| 6 | **Keine Tests für Fotobezug/Upload-Pfad** (`resolvePhotoFile`, Multer-Konfiguration, 5-MB-Limit, erlaubte MIME-Typen laut CLAUDE.md) | Mittel – dokumentierte Regel ohne Testnachweis |
| 7 | **Keine dokumentierte Testautomatisierungsarchitektur** (TAF-Schichten): Testskripte, Fixtures/Mock-Aufbau (`jest.mock('../src/config/db')`) und Hilfsfunktionen (`buildApp()`, `authHeader()`) sind pro Datei dupliziert statt in einer Geschäftslogik-/Kernbibliotheksschicht gebündelt | Niedrig/Mittel – Wartungsaufwand steigt mit jeder neuen Routen-Testdatei |
| 8 | **Keine E2E-/Systemtests** (z. B. Playwright) für kritische Workflows (Login → Schmuckstück anlegen → Lieferschein/Rechnung erzeugen) | Mittel – Integrationslücken zwischen Frontend/Backend nur durch manuelle Tests abgedeckt |

## 2. Fahrplan (priorisiert)

### Phase 1 – Kritische Lücken schließen (Sprint 1–2)
1. **Routentests für Kernentitäten ergänzen:** `kunden.routes.test.js`, `lieferscheine.routes.test.js`, `rechnungen.routes.test.js` nach dem Muster von `schmuckstuecke.routes.test.js` (DB-Mock, Rollen-Middleware, Erfolg + Negativfälle je Endpunkt).
2. **Rollenprüfung in Routentests ergänzen:** je Route mind. 1 Testfall "403 bei fehlender Rolle" – Test-User in `app.use()` variabel machen statt hart auf `role: 'bearbeiter'` zu setzen.
3. **Frontend: `DataTable`, `DocumentManager`, `SchmuckstueckModal`** mit React Testing Library abdecken (Rendering, Sortierung/Filterung, Formularvalidierung).

### Phase 2 – Technikabdeckung systematisieren (Sprint 3)
4. **`whereClauseBuilder`:** Äquivalenzklassen für generische Methoden (`equals`, `like`, `artikelnummerIn`) explizit ergänzen: gültige Werte, `null`/`undefined`, leeres Array/leerer String, Sonderzeichen in `LIKE`-Mustern (`%`, `_`).
5. **Foto-Upload:** Testfälle für Grenzwertanalyse der 5-MB-Grenze (4,9 MB / 5 MB / 5,1 MB) und Entscheidungstabelle für erlaubte/verweigerte MIME-Typen (jpg/png/gif vs. z. B. pdf, svg).

### Phase 3 – Testautomatisierungsarchitektur (Sprint 4)
6. **Gemeinsame Testinfrastruktur extrahieren** (Geschäftslogik-/Kernbibliotheksschicht i. S. CTAL-TAE): `backend/__tests__/helpers/buildApp.js` (App-Factory mit injizierbarem `req.user`), `backend/__tests__/helpers/dbMock.js` (Standard-Mock für `config/db`). Reduziert Duplikate wie `buildApp()` in `auth.routes.test.js`.
7. **Coverage-Schwellen aktivieren:** `coverageThreshold` im Jest-Block (`backend/package.json`) und äquivalent in der Vitest-Config des Frontends setzen (Startwert z. B. 70 %, danach schrittweise erhöhen), damit Regressionen bei der Testabdeckung in der CI (`.github/workflows/tests.yml`) auffallen.

### Phase 4 – Systemebene (Sprint 5, optional)
8. **Ein schlanker E2E-Smoke-Test** (Playwright) für den Kernworkflow Login → Schmuckstück anlegen → Lieferschein/Rechnung erzeugen, um Integrationslücken zwischen den gut getesteten Backend-Routen und dem kaum getesteten Frontend abzudecken.

## 3. Offene Punkte
- **[offen]** Ziel-Coverage-Prozentsatz nicht vorgegeben – Vorschlag 70 % als Einstieg, mit dem Team abzustimmen.
- **[offen]** Kein Hinweis auf vorhandene CI-Laufzeitbudgets – Phase 4 (E2E) ggf. gegen CI-Dauer abwägen.
