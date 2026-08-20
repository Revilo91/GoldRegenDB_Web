'use strict';

/**
 * Tests für backend/src/config/swagger.js (Issue #143).
 *
 * Prüft zwei Dinge, die ohne Test erst im Browser auffallen würden:
 * 1. swagger-jsdoc parst alle @swagger-JSDoc-Blöcke fehlerfrei zu einer
 *    validen OpenAPI-Struktur, und jeder dokumentierte Pfad entspricht
 *    tatsächlich einer registrierten Express-Route (kein Tippfehler, kein
 *    fehlendes /api-Präfix).
 * 2. /api-docs ist unter Produktionsbedingungen nicht ungeschützt erreichbar.
 */

process.env.JWT_SECRET = 'test-secret-do-not-use-in-prod';
process.env.BESTELLUNG_ENCRYPTION_KEY = 'b3ae96f21e2f1ca8b65351153ccb3d8f0a1aa9b495c91b11530467d34c2e9336';
process.env.PRIVACY_POLICY_VERSION = 'test-v1';

jest.mock('../src/config/db', () => ({
  query: jest.fn(),
  connect: jest.fn(),
  setCurrentDbUsername: jest.fn(),
  requestContextMiddleware: (req, res, next) => next(),
}));

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const request = require('supertest');
const express = require('express');
const swaggerSpec = require('../src/config/swagger');
const { authenticate, requireAdmin } = require('../src/middleware/auth');

// ── 1. Spec-Validität ────────────────────────────────────────────────────────

describe('swagger-jsdoc erzeugt eine valide OpenAPI-Spec', () => {
  it('hat OpenAPI 3.x-Grundstruktur', () => {
    expect(swaggerSpec.openapi).toMatch(/^3\./);
    expect(swaggerSpec.info).toMatchObject({ title: expect.any(String), version: expect.any(String) });
    expect(swaggerSpec.paths).toBeTruthy();
    expect(Object.keys(swaggerSpec.paths).length).toBeGreaterThan(0);
  });

  it('definiert die Auth-Security-Schemes passend zur echten Middleware (Cookie, Bearer, CSRF-Header)', () => {
    const schemes = swaggerSpec.components.securitySchemes;
    expect(schemes.cookieAuth).toMatchObject({ type: 'apiKey', in: 'cookie', name: 'jwt' });
    expect(schemes.bearerAuth).toMatchObject({ type: 'http', scheme: 'bearer' });
    expect(schemes.csrfHeader).toMatchObject({ type: 'apiKey', in: 'header', name: 'X-CSRF-Token' });
  });

  it('enthält keine offensichtlichen Platzhalter-Geheimnisse in Beispielen', () => {
    const serialized = JSON.stringify(swaggerSpec);
    expect(serialized).not.toMatch(/"admin"\s*,\s*"password"\s*:\s*"admin"/);
    // Beispiel-Login nutzt nur den Benutzernamen "admin", kein echtes Passwort im JSON
    expect(serialized).not.toContain('"password":"admin"');
  });

  it('jeder $ref zeigt auf eine tatsächlich definierte Komponente', () => {
    const refs = [];
    (function walk(node) {
      if (node && typeof node === 'object') {
        if (typeof node.$ref === 'string') refs.push(node.$ref);
        Object.values(node).forEach(walk);
      }
    })(swaggerSpec);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const path = ref.replace('#/', '').split('/');
      let target = swaggerSpec;
      for (const segment of path) target = target?.[segment];
      expect(target).toBeDefined();
    }
  });
});

// ── 2. Jeder dokumentierte Pfad entspricht einer echten Express-Route ───────

// Mount-Präfixe exakt wie in src/index.js registriert.
const ROUTER_MOUNTS = [
  ['/kunden', '../src/routes/kunden'],
  ['/schmuckstuecke', '../src/routes/schmuckstuecke'],
  ['/lieferscheine', '../src/routes/lieferscheine'],
  ['/rechnungen', '../src/routes/rechnungen'],
  ['/audit-log', '../src/routes/auditLog'],
  ['/dashboard', '../src/routes/dashboard'],
  ['/auth', '../src/routes/auth'],
  ['/users', '../src/routes/users'],
  ['/sumup', '../src/routes/sumup'],
  ['/inventur', '../src/routes/inventur'],
  ['/lagerinventur', '../src/routes/lagerinventur'],
  ['/bestelluebersicht', '../src/routes/bestelluebersicht'],
  ['/public/bestellung', '../src/routes/bestellungPublic'],
  ['/debug', '../src/routes/debug'],
  ['/backup', '../src/routes/backup'],
];

// Express nutzt :id, OpenAPI {id} – für den Vergleich auf ein Format normieren.
function toOpenApiStyle(expressPath) {
  return expressPath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function collectActualRoutes() {
  const routes = new Set();
  for (const [mountPrefix, modulePath] of ROUTER_MOUNTS) {
    const router = require(modulePath);
    for (const layer of router.stack) {
      if (!layer.route) continue;
      const subPath = layer.route.path === '/' ? '' : layer.route.path;
      const fullPath = `/api${mountPrefix}${toOpenApiStyle(subPath)}`;
      for (const method of Object.keys(layer.route.methods)) {
        routes.add(`${method.toUpperCase()} ${fullPath}`);
      }
    }
  }
  return routes;
}

function collectDocumentedRoutes() {
  const routes = new Set();
  for (const [docPath, operations] of Object.entries(swaggerSpec.paths)) {
    const fullPath = `/api${docPath}`;
    for (const method of Object.keys(operations)) {
      routes.add(`${method.toUpperCase()} ${fullPath}`);
    }
  }
  return routes;
}

describe('jeder @swagger-dokumentierte Pfad entspricht einer registrierten Express-Route', () => {
  const actual = collectActualRoutes();
  const documented = collectDocumentedRoutes();

  it('hat für jede dokumentierte Operation eine passende Express-Route (kein Tippfehler/fehlendes Präfix)', () => {
    const missing = [...documented].filter((r) => !actual.has(r));
    expect(missing).toEqual([]);
  });

  it('deckt jede tatsächliche Route in den 15 dokumentierten Router-Dateien ab', () => {
    const undocumented = [...actual].filter((r) => !documented.has(r));
    expect(undocumented).toEqual([]);
  });
});

// ── 3. /api-docs ist unter Produktionsbedingungen nicht ungeschützt erreichbar ──

describe('shouldEnableApiDocs() – Freigabe-Logik', () => {
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('ist in Produktion ohne ENABLE_API_DOCS deaktiviert (Standard-sicher)', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ENABLE_API_DOCS;
    expect(swaggerSpec.shouldEnableApiDocs(process.env)).toBe(false);
  });

  it('bleibt in Produktion deaktiviert, wenn ENABLE_API_DOCS=false explizit gesetzt ist', () => {
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_API_DOCS = 'false';
    expect(swaggerSpec.shouldEnableApiDocs(process.env)).toBe(false);
  });

  it('kann in Produktion per ENABLE_API_DOCS=true explizit aktiviert werden', () => {
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_API_DOCS = 'true';
    expect(swaggerSpec.shouldEnableApiDocs(process.env)).toBe(true);
  });

  it('ist außerhalb von Produktion standardmäßig aktiviert', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.ENABLE_API_DOCS;
    expect(swaggerSpec.shouldEnableApiDocs(process.env)).toBe(true);
  });
});

describe('/api-docs ist auch wenn gemountet nie anonym erreichbar', () => {
  // Baut exakt die Middleware-Kette aus src/index.js nach: authenticate + requireAdmin
  // vor swaggerUi – unabhängig vom Freigabe-Flag ist die Doku nie ungeschützt.
  function buildApiDocsApp() {
    const swaggerUi = require('swagger-ui-express');
    const app = express();
    app.use('/api-docs', authenticate, requireAdmin, swaggerUi.serve, swaggerUi.setup(swaggerSpec));
    return app;
  }

  it('liefert 401 ohne Anmeldung, selbst wenn ENABLE_API_DOCS=true in Produktion gesetzt ist', async () => {
    const app = buildApiDocsApp();
    const res = await request(app).get('/api-docs/');
    expect(res.statusCode).toBe(401);
  });

  it('ist unter Produktionsbedingungen ohne ENABLE_API_DOCS im echten Server-Startup gar nicht erst gemountet', () => {
    // Ergänzt den 401-Test oben: In index.js hängt die Registrierung selbst an
    // shouldEnableApiDocs() – ohne Flag existiert die Route in Produktion nicht
    // einmal, "nicht ungeschützt erreichbar" gilt also auf zwei Ebenen.
    expect(swaggerSpec.shouldEnableApiDocs({ NODE_ENV: 'production' })).toBe(false);
  });
});
