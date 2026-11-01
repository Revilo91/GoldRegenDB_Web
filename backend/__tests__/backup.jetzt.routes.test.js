'use strict';

process.env.JWT_SECRET = 'test-secret-do-not-use-in-prod';

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
jest.mock('../src/services/sqlSicherung', () => {
  const dienst = { starte: jest.fn(), status: jest.fn() };
  return { sqlSicherung: () => dienst, __dienst: dienst };
});

const request = require('supertest');
const express = require('express');
const { requireAdmin } = require('../src/middleware/auth');
const { __dienst: dienst } = require('../src/services/sqlSicherung');

// Wie in index.js: requireAdmin vor dem Backup-Router.
function buildApp(rolle) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 1, username: 'u', role: rolle };
    next();
  });
  app.use('/api/backup', requireAdmin, require('../src/routes/backup'));
  return app;
}

const laeuft = {
  status: 'running', gestartetAm: '2026-11-01T10:00:00.000Z', beendetAm: null,
  datei: null, groesse: null, fehler: null,
};

beforeEach(() => {
  dienst.starte.mockReset();
  dienst.status.mockReset();
});

describe('POST /api/backup/jetzt', () => {
  it('antwortet 202 mit dem Stand, wenn die Sicherung startet', async () => {
    dienst.starte.mockReturnValue({ gestartet: true, stand: laeuft });

    const res = await request(buildApp('admin')).post('/api/backup/jetzt');

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ sicherung: laeuft });
    expect(dienst.starte).toHaveBeenCalledTimes(1);
  });

  it('antwortet 409, wenn schon eine Sicherung läuft', async () => {
    dienst.starte.mockReturnValue({ gestartet: false, stand: laeuft });

    const res = await request(buildApp('admin')).post('/api/backup/jetzt');

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/läuft bereits/);
    expect(res.body.sicherung).toEqual(laeuft);
  });

  it.each(['bearbeiter', 'user'])('antwortet 403 für Rolle %s und startet nichts', async (rolle) => {
    const res = await request(buildApp(rolle)).post('/api/backup/jetzt');

    expect(res.status).toBe(403);
    expect(dienst.starte).not.toHaveBeenCalled();
  });
});

describe('GET /api/backup/jetzt/status', () => {
  it('liefert den Stand der Sicherung', async () => {
    const fertig = {
      status: 'completed', gestartetAm: laeuft.gestartetAm, beendetAm: '2026-11-01T10:05:00.000Z',
      datei: 'goldregendb_manuell_2026-11-01T10-00-00-000Z.dump', groesse: 1234, fehler: null,
    };
    dienst.status.mockReturnValue(fertig);

    const res = await request(buildApp('admin')).get('/api/backup/jetzt/status');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sicherung: fertig });
  });

  it('antwortet 403 ohne Admin-Rolle', async () => {
    const res = await request(buildApp('bearbeiter')).get('/api/backup/jetzt/status');

    expect(res.status).toBe(403);
    expect(dienst.status).not.toHaveBeenCalled();
  });
});
