'use strict';

/**
 * Tests für POST /api/sumup/import.
 *
 * Befund C4: Auswahl der Stücke und Anlegen des Messe-Kunden liefen vor dem
 * BEGIN. Der Kunde blieb bei einem Rollback bestehen, und zwei parallele
 * Importe konnten dieselben verfügbaren Stücke auf zwei Rechnungen schreiben.
 */

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

const db = require('../src/config/db');
const { requireBearbeiter } = require('../src/middleware/auth');
const sumupRoutes = require('../src/routes/sumup');
const { createTxClientMock, sqlVerlauf } = require('./helpers/txClientMock');

function buildApp(role = 'bearbeiter') {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 1, username: 'testuser', role };
    next();
  });
  app.use('/api/sumup', requireBearbeiter, sumupRoutes);
  return app;
}

const CSV = 'Beschreibung,Betrag\nMHO001 Ring,20.00\n';

beforeEach(() => jest.clearAllMocks());

describe('POST /api/sumup/import', () => {
  it('legt Lieferschein und Rechnung an und committet', async () => {
    const client = createTxClientMock({
      ergebnisse: {
        'FOR UPDATE': { rows: [{ Artikelnummer: 'MHO001', Verkaufspreis: '20.00' }] },
        'FROM "Kunde"': { rows: [{ ID: 7, Name: 'Messe' }] },
        'AS max_num': { rows: [{ max_num: '0' }] },
        'INSERT INTO "Lieferschein"': { rows: [{ ID: 11, Nummer: '2026-001' }] },
        'INSERT INTO "Rechnung"': { rows: [{ ID: 21, Nummer: '2026-001' }] },
      },
    });
    db.connect.mockResolvedValueOnce(client);

    const res = await request(buildApp()).post('/api/sumup/import').send({ csvData: CSV });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.lieferschein.ID).toBe(11);
    expect(sqlVerlauf(client)).toContain('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  // Der Kern von C4: BEGIN muss vor der Auswahl und vor dem Kunden-INSERT
  // liegen, und die Auswahl muss die Stücke sperren.
  it('beginnt die Transaktion vor Auswahl und Kunden-Anlage', async () => {
    const client = createTxClientMock({
      ergebnisse: {
        'FOR UPDATE': { rows: [{ Artikelnummer: 'MHO001', Verkaufspreis: '20.00' }] },
        'FROM "Kunde"': { rows: [] },
        'INSERT INTO "Kunde"': { rows: [{ ID: 9, Name: 'Messe' }] },
        'AS max_num': { rows: [{ max_num: '0' }] },
        'INSERT INTO "Lieferschein"': { rows: [{ ID: 11, Nummer: '2026-001' }] },
        'INSERT INTO "Rechnung"': { rows: [{ ID: 21, Nummer: '2026-001' }] },
      },
    });
    db.connect.mockResolvedValueOnce(client);

    const res = await request(buildApp()).post('/api/sumup/import').send({ csvData: CSV });

    expect(res.statusCode).toBe(200);
    const verlauf = sqlVerlauf(client);
    const begin = verlauf.indexOf('BEGIN');
    const auswahl = verlauf.findIndex((sql) => sql.includes('FOR UPDATE'));
    const kundeAnlegen = verlauf.findIndex((sql) => sql.includes('INSERT INTO "Kunde"'));

    expect(begin).toBe(0);
    expect(auswahl).toBeGreaterThan(begin);
    expect(kundeAnlegen).toBeGreaterThan(begin);
    // Die Auswahl der verfügbaren Stücke ist gegen parallele Importe gesperrt
    expect(verlauf[auswahl]).toContain('FOR UPDATE');
    // Nummernvergabe per MAX+1 braucht dieselbe Sperre wie die POST-Routen
    expect(verlauf.some((sql) => sql.includes('LOCK TABLE "Lieferschein"'))).toBe(true);
    expect(verlauf.some((sql) => sql.includes('LOCK TABLE "Rechnung"'))).toBe(true);
  });

  it('rollt den neu angelegten Messe-Kunden zurück, wenn die Rechnung scheitert', async () => {
    const client = createTxClientMock({
      ergebnisse: {
        'FOR UPDATE': { rows: [{ Artikelnummer: 'MHO001', Verkaufspreis: '20.00' }] },
        'FROM "Kunde"': { rows: [] },
        'INSERT INTO "Kunde"': { rows: [{ ID: 9, Name: 'Messe' }] },
        'AS max_num': { rows: [{ max_num: '0' }] },
        'INSERT INTO "Lieferschein"': { rows: [{ ID: 11, Nummer: '2026-001' }] },
      },
      fehlerBei: 'INSERT INTO "Rechnung"',
    });
    db.connect.mockResolvedValueOnce(client);

    const res = await request(buildApp()).post('/api/sumup/import').send({ csvData: CSV });

    expect(res.statusCode).toBe(500);
    const verlauf = sqlVerlauf(client);
    expect(verlauf.some((sql) => sql.includes('INSERT INTO "Kunde"'))).toBe(true);
    expect(verlauf).toContain('ROLLBACK');
    expect(verlauf).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  it('rollt zurück, wenn keine der Artikelnummern gefunden wird (400)', async () => {
    const client = createTxClientMock({
      ergebnisse: { 'FOR UPDATE': { rows: [] } },
    });
    db.connect.mockResolvedValueOnce(client);

    const res = await request(buildApp()).post('/api/sumup/import').send({ csvData: CSV });

    expect(res.statusCode).toBe(400);
    expect(sqlVerlauf(client)).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  it('öffnet ohne gültige Artikelnummer gar keine Transaktion (400)', async () => {
    const res = await request(buildApp())
      .post('/api/sumup/import')
      .send({ csvData: 'Beschreibung,Betrag\nKaffee,2.50\n' });

    expect(res.statusCode).toBe(400);
    expect(db.connect).not.toHaveBeenCalled();
  });

  it('lehnt den Zugriff mit Rolle user ab (403)', async () => {
    const res = await request(buildApp('user')).post('/api/sumup/import').send({ csvData: CSV });

    expect(res.statusCode).toBe(403);
    expect(db.connect).not.toHaveBeenCalled();
  });
});
