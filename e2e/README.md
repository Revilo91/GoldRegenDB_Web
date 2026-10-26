# E2E-Tests (Playwright)

## Setup
```bash
cp .env.example .env   # BASE_URL=http://localhost:3000
npm install
npm run db:up           # Docker-DB starten
npm run dev              # Backend + Frontend (oder: docker compose -f docker-compose.dev.yml up)
```

## Ausführen
```bash
npm run test:e2e                        # alle Tests headless
npx playwright test e2e/smoke.spec.ts   # nur den Smoke-Test
npx playwright test --ui                # interaktiv
```

`TEST_USERNAME`/`TEST_PASSWORD` (Default: `admin`/`admin`, siehe `db/seed.sql`) steuern die
Zugangsdaten für `auth.setup.ts` und `smoke.spec.ts`.

## Tests
- `auth.setup.ts` – holt per API ein Admin-JWT-Cookie und speichert es als `storageState`
  für die `chromium`-Projekt-Tests (spart wiederholten UI-Login).
- `smoke.spec.ts` – Kernworkflow-Smoke-Test: Login über das UI-Formular → neues
  Schmuckstück anlegen → Lieferschein dafür erzeugen → Erfolg über die jeweilige Listenansicht
  verifizieren. Läuft bewusst mit leerem `storageState`, um den Login selbst zu testen.
- `bestelluebersicht.spec.ts` – Formularlogik der öffentlichen Bestellübersicht.

- `mobil.spec.ts` – Handy-Viewport 390 px (Issue #291, Stufe 1), nur im Projekt `mobile`
  (`npx playwright test --project=mobile`): Login, Stück suchen, Stück mit Foto anlegen
  (`setInputFiles`), Bestellübersicht anlegen sowie je Seite ein eigener Test „scrollt nicht
  seitlich“. Die Prüfungen für die Schmuckstück-Seite laufen erst mit
  `MOBIL_SCROLL_SCHMUCKSTUECK=1`, weil sie bis zur Kompakt-Liste (#317) rot sind (620 px breit).
  Bis dahin klicken die Ablauf-Tests Buttons per `dispatchEvent`, weil sie außerhalb des
  Fensters liegen bzw. überdeckt sind. Der Test „Bestellübersicht scrollt nicht seitlich“ ist
  bei vorhandenen Bestellungen rot (453 px) und zeigt einen echten Befund, kein Testfehler.

Chromium liegt vorinstalliert unter `/opt/pw-browsers`
(`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`) – kein `playwright install` nötig.
