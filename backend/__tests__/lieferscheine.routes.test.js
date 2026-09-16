'use strict';

process.env.JWT_SECRET = 'test-secret-do-not-use-in-prod';

const request = require('supertest');
const express = require('express');

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

jest.mock('../src/utils/excelService', () => ({
  generateExcel: jest.fn().mockResolvedValue(Buffer.from('xlsx')),
}));

const db = require('../src/config/db');
const { requireBearbeiter } = require('../src/middleware/auth');
const lieferscheineRoutes = require('../src/routes/lieferscheine');

function buildApp(role = 'bearbeiter') {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 1, username: 'testuser', role };
    next();
  });
  app.use('/api/lieferscheine', requireBearbeiter, lieferscheineRoutes);
  return app;
}

beforeEach(() => jest.clearAllMocks());

describe('GET /api/lieferscheine', () => {
  it('liefert alle Lieferscheine mit Kundennamen', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ ID: 1, Nummer: '2026-001', KundenName: 'Anna' }] });

    const res = await request(buildApp()).get('/api/lieferscheine');

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('filtert nach status, wenn angegeben', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get('/api/lieferscheine?status=final');

    expect(res.statusCode).toBe(200);
    expect(db.query.mock.calls[0][0]).toContain('WHERE l.status = $1');
    expect(db.query.mock.calls[0][1]).toEqual(['final']);
  });

  it('lehnt den Zugriff mit Rolle user ab (403)', async () => {
    const res = await request(buildApp('user')).get('/api/lieferscheine');

    expect(res.statusCode).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('GET /api/lieferscheine/next-number', () => {
  it('ermittelt die nächste Nummer im Format JJJJ-NNN', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ max_num: '3' }] });

    const res = await request(buildApp()).get('/api/lieferscheine/next-number');

    expect(res.statusCode).toBe(200);
    expect(res.body.Nummer).toMatch(/^\d{4}-004$/);
  });
});

describe('GET /api/lieferscheine/:id', () => {
  it('liefert Lieferschein inkl. zugeordneter Schmuckstücke', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ ID: 1, Nummer: '2026-001' }] })
      .mockResolvedValueOnce({ rows: [{ Artikelnummer: 'MHO001' }] });

    const res = await request(buildApp()).get('/api/lieferscheine/1');

    expect(res.statusCode).toBe(200);
    expect(res.body.schmuckstuecke).toHaveLength(1);
  });

  it('meldet 404 bei unbekannter ID', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get('/api/lieferscheine/999');

    expect(res.statusCode).toBe(404);
  });
});

describe('GET /api/lieferscheine/:id/excel', () => {
  it('liefert eine XLSX-Datei', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ ID: 1, Nummer: '2026-001' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get('/api/lieferscheine/1/excel');

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
  });

  it('meldet 404 bei unbekannter ID', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get('/api/lieferscheine/999/excel');

    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/lieferscheine', () => {
  it('legt einen Lieferschein mit gültigen Daten an', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({}) // LOCK
        .mockResolvedValueOnce({ rows: [{ max_num: '0' }] }) // next-number
        .mockResolvedValueOnce({ rows: [{ ID: 1, Nummer: '2026-001' }] }) // INSERT
        .mockResolvedValueOnce({}), // COMMIT
      release: jest.fn(),
    };
    db.connect.mockResolvedValueOnce(client);

    const res = await request(buildApp())
      .post('/api/lieferscheine')
      .send({ Kundennummer: 1 });

    expect(res.statusCode).toBe(201);
    expect(res.body.ID).toBe(1);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  it('lehnt eine zu lange Lieferscheinnummer ab (400)', async () => {
    const res = await request(buildApp())
      .post('/api/lieferscheine')
      .send({ Kundennummer: 1, Nummer: 'x'.repeat(21) });

    expect(res.statusCode).toBe(400);
    expect(db.connect).not.toHaveBeenCalled();
  });

  it('meldet 409 bei doppelter Lieferscheinnummer', async () => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({}) // LOCK
        .mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: '23505' }))
        .mockResolvedValueOnce({}), // ROLLBACK
      release: jest.fn(),
    };
    db.connect.mockResolvedValueOnce(client);

    const res = await request(buildApp())
      .post('/api/lieferscheine')
      .send({ Nummer: '2026-001', Kundennummer: 1 });

    expect(res.statusCode).toBe(409);
  });

  it('lehnt den Zugriff mit Rolle user ab (403)', async () => {
    const res = await request(buildApp('user')).post('/api/lieferscheine').send({ Kundennummer: 1 });

    expect(res.statusCode).toBe(403);
    expect(db.connect).not.toHaveBeenCalled();
  });
});

describe('PUT /api/lieferscheine/:id', () => {
  it('aktualisiert einen bestehenden Lieferschein', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ ID: 1, Nummer: '2026-001', status: 'entwurf' }] })
      .mockResolvedValueOnce({ rowCount: 0 });

    const res = await request(buildApp())
      .put('/api/lieferscheine/1')
      .send({ Nummer: '2026-001', Kundennummer: 1 });

    expect(res.statusCode).toBe(200);
  });

  it('meldet 404 bei unbekannter ID', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .put('/api/lieferscheine/999')
      .send({ Nummer: '2026-001', Kundennummer: 1 });

    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /api/lieferscheine/:id', () => {
  it('löscht einen bestehenden Lieferschein', async () => {
    db.query
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValueOnce({ rowCount: 1 });

    const res = await request(buildApp()).delete('/api/lieferscheine/1');

    expect(res.statusCode).toBe(200);
  });

  it('meldet 404 bei unbekannter ID', async () => {
    db.query
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValueOnce({ rowCount: 0 });

    const res = await request(buildApp()).delete('/api/lieferscheine/999');

    expect(res.statusCode).toBe(404);
  });

  it('lehnt den Zugriff mit Rolle user ab (403)', async () => {
    const res = await request(buildApp('user')).delete('/api/lieferscheine/1');

    expect(res.statusCode).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });
});
