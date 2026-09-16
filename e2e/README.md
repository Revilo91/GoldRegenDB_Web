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

Chromium liegt vorinstalliert unter `/opt/pw-browsers`
(`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`) – kein `playwright install` nötig.
