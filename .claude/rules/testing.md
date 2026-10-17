---
paths:
  - "backend/**"
  - "frontend/**"
  - "e2e/**"
  - "playwright.config.ts"
---

# Tests

Der allgemeine Teil gilt in allen Projekten. Bei Widerspruch gilt der Abschnitt zu diesem Projekt.

## Grundregeln

- Neue Funktion oder Bugfix = mindestens ein Test.
- Bugfix: erst Test, der den Fehler reproduziert, dann Fix.
- Abdecken: Normalfall, Grenzwerte, Fehlerfall, leere/ungültige Eingabe.
- Tests unabhängig voneinander, keine Reihenfolge-Abhängigkeit, keine echten externen Dienste (mocken).

## In diesem Projekt

**Backend** (Jest):
```bash
cd backend && npm test
# Tests in: __tests__/**/*.test.js
# Mocks: db.js, logger.js via jest.mock()
```

Für Backup/Restore gibt es eine Integrationssuite gegen echtes Postgres (`__tests__/backup.integration.test.js`), die nur mit `TEST_DATABASE_URL` läuft und Datenbanken ohne „test" im Namen ablehnt. Ebenso `__tests__/migrations.integration.test.js` (Rolle braucht `CREATEDB`): vergleicht Neuinstallation, init.sql + Migrationen und Bestandsdatenbank auf identisches Schema.

**Frontend** (Vitest):
```bash
cd frontend && npm test
# Tests in: src/__tests__/**/*.test.js
```

Tests laufen automatisch bei jedem PR über GitHub Actions (`.github/workflows/tests.yml`).
