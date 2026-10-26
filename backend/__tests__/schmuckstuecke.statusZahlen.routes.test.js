'use strict';

// GET /api/schmuckstuecke/status-zahlen: eine COUNT(*) FILTER-Abfrage statt
// fünf Einzelabfragen. Die Zustände müssen disjunkt sein (Summe = alle), die
// Status-Filter verkauft/ausschuss der Liste werden ignoriert.

process.env.JWT_SECRET = 'test-secret-do-not-use-in-prod';

const express = require('express');
const request = require('supertest');

const { buildTestApp } = require('./helpers/buildTestApp');

jest.mock('../src/config/db', () => require('./helpers/dbMock').createDbMock());

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const db = require('../src/config/db');
const { where } = require('../src/utils/whereClauseBuilder');
const { authenticate } = require('../src/middleware/auth');
const schmuckstueckeRoutes = require('../src/routes/schmuckstuecke');

const app = buildTestApp({
  router: schmuckstueckeRoutes,
  mountPath: '/api/schmuckstuecke',
  user: { id: 1, username: 'testuser', role: 'bearbeiter' },
});

const URL = '/api/schmuckstuecke/status-zahlen';

// Testdaten: 10 Stücke, je 4 / 3 / 2 / 1 pro Zustand (pg liefert COUNT als String)
const ZEILE = { alle: '10', lager: '4', ausgelagert: '3', verkauft: '2', ausschuss: '1' };

const letzterAufruf = () => {
  const [sql, params] = db.query.mock.calls[0];
  return { sql, params };
};

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockResolvedValue({ rows: [ZEILE] });
});

describe('GET /api/schmuckstuecke/status-zahlen', () => {
  it('liefert die fünf Zahlen als Zahlen, die vier Zustände ergeben zusammen alle', async () => {
    const res = await request(app).get(URL);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ alle: 10, lager: 4, ausgelagert: 3, verkauft: 2, ausschuss: 1 });
    const { alle, lager, ausgelagert, verkauft, ausschuss } = res.body;
    expect(lager + ausgelagert + verkauft + ausschuss).toBe(alle);
  });

  it('braucht genau eine Abfrage und nutzt die disjunkten Builder-Bedingungen', async () => {
    await request(app).get(URL);

    expect(db.query).toHaveBeenCalledTimes(1);
    const { sql } = letzterAufruf();
    expect(sql.match(/COUNT\(\*\) FILTER/g)).toHaveLength(4);
    // verfuegbar()/aktivAusgelagert() prüfen Verkauft/Ausschuss mit, imLager()/ausgelagert() nicht
    expect(sql).toContain(`FILTER (WHERE ${where().verfuegbar().buildConditions()})`);
    expect(sql).toContain(`FILTER (WHERE ${where().aktivAusgelagert().buildConditions()})`);
    expect(sql).toContain(`FILTER (WHERE ${where().verkauft().buildConditions()})`);
    expect(sql).toContain(`FILTER (WHERE ${where().ausschuss().buildConditions()})`);
    expect(sql).toContain('COUNT(*) AS "alle"');
    expect(db.pruefeKlammern).toBeDefined();
    db.pruefeKlammern(sql);
  });

  it('ohne Filter gibt es keine WHERE-Klausel auf der Tabelle und keine Parameter', async () => {
    await request(app).get(URL);

    const { sql, params } = letzterAufruf();
    expect(sql).toMatch(/FROM "Schmuckstück"\s*$/);
    expect(params).toEqual([]);
  });

  it('gibt 0 statt NaN zurück, wenn die Tabelle leer ist', async () => {
    db.query.mockResolvedValue({ rows: [{ alle: '0', lager: '0', ausgelagert: '0', verkauft: '0', ausschuss: '0' }] });

    const res = await request(app).get(URL);

    expect(res.body).toEqual({ alle: 0, lager: 0, ausgelagert: 0, verkauft: 0, ausschuss: 0 });
  });

  describe('Filter', () => {
    it('search löst einen Grundmaterial-Namen auf (Perle -> P)', async () => {
      await request(app).get(`${URL}?search=Perle`);

      const { sql, params } = letzterAufruf();
      expect(sql).toContain('SUBSTRING("Artikelnummer", 2, 1) = $1');
      expect(params).toEqual(['P']);
    });

    it('search als Freitext wirkt über ILIKE auf die Suchfelder', async () => {
      await request(app).get(`${URL}?search=Rosa`);

      const { sql, params } = letzterAufruf();
      expect(sql).toContain('ILIKE $1');
      expect(params).toEqual(['%Rosa%']);
    });

    it('artikelnummer_art und grundmaterial verändern die Abfrage', async () => {
      await request(app).get(`${URL}?artikelnummer_art=a&grundmaterial=p`);

      const { sql, params } = letzterAufruf();
      expect(sql).toContain('SUBSTRING("Artikelnummer", 2, 1) = $1');
      expect(sql).toContain('SUBSTRING("Artikelnummer", 3, 1) = $2');
      expect(params).toEqual(['P', 'A']);
    });

    it('ignoriert die Status-Filter verkauft und ausschuss', async () => {
      await request(app).get(`${URL}?search=Rosa`);
      const ohne = letzterAufruf();
      db.query.mockClear();

      const res = await request(app).get(`${URL}?search=Rosa&verkauft=1&ausschuss=1`);
      const mit = letzterAufruf();

      expect(res.statusCode).toBe(200);
      expect(mit.sql).toBe(ohne.sql);
      expect(mit.params).toEqual(ohne.params);
    });

    it('ignoriert auch ungültige verkauft/ausschuss-Werte (kein 400)', async () => {
      const res = await request(app).get(`${URL}?verkauft=abc&ausschuss=xyz`);

      expect(res.statusCode).toBe(200);
      expect(letzterAufruf().params).toEqual([]);
    });
  });

  describe('Parameter-Reihenfolge mit Kundenfilter', () => {
    it('hängt den Kunden hinter Suche und Produktart an ($1, $2, $3)', async () => {
      await request(app).get(`${URL}?search=Rosa&artikelnummer_art=A&ausgelagert=15`);

      const { sql, params } = letzterAufruf();
      expect(params).toEqual(['%Rosa%', 'A', 15]);
      expect(sql).toContain('ILIKE $1');
      expect(sql).toContain('SUBSTRING("Artikelnummer", 3, 1) = $2');
      expect(sql).toContain('"Ausgelagert" = $3');
      expect(sql).not.toContain('$4');
    });

    it('ausgelagert=0,15 wird als ein Array-Parameter übergeben', async () => {
      await request(app).get(`${URL}?grundmaterial=P&ausgelagert=0,15`);

      const { sql, params } = letzterAufruf();
      expect(params).toEqual(['P', [0, 15]]);
      expect(sql).toContain('"Ausgelagert" = ANY($2::int[])');
    });

    it('ausgelagert=0 filtert auf das Lager ohne Parameter', async () => {
      await request(app).get(`${URL}?ausgelagert=0`);

      const { sql, params } = letzterAufruf();
      expect(params).toEqual([]);
      expect(sql).toMatch(/FROM "Schmuckstück"\s+WHERE "Ausgelagert" = 0\s*$/);
    });
  });

  describe('ausgelagert=kunden (bei irgendeinem Kunden)', () => {
    it('filtert auf Ausgelagert > 0 ohne Parameter', async () => {
      await request(app).get(`${URL}?ausgelagert=kunden`);

      const { sql, params } = letzterAufruf();
      expect(params).toEqual([]);
      expect(sql).toMatch(/FROM "Schmuckstück"\s+WHERE "Ausgelagert" > 0\s*$/);
    });

    it('verschiebt die Parameter-Indizes der Suche nicht', async () => {
      await request(app).get(`${URL}?search=Rosa&artikelnummer_art=A&ausgelagert=kunden`);

      const { sql, params } = letzterAufruf();
      expect(params).toEqual(['%Rosa%', 'A']);
      expect(sql).toContain('ILIKE $1');
      expect(sql).toContain('SUBSTRING("Artikelnummer", 3, 1) = $2');
      expect(sql).toContain('"Ausgelagert" > 0');
      expect(sql).not.toContain('$3');
    });

    it.each(['kunden,5', 'Kunden', '5,kunden'])('lehnt ausgelagert=%s ab (400)', async (wert) => {
      const res = await request(app).get(`${URL}?ausgelagert=${wert}`);

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/kunden/);
      expect(db.query).not.toHaveBeenCalled();
    });
  });

  describe('Fehlerfälle', () => {
    it.each(['abc', '0,', 'a,15', '0,-1', '-3'])('lehnt ausgelagert=%s ab (400)', async (wert) => {
      const res = await request(app).get(`${URL}?ausgelagert=${wert}`);

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/ausgelagert/);
      expect(db.query).not.toHaveBeenCalled();
    });

    it('antwortet mit 500, wenn die Abfrage fehlschlägt', async () => {
      db.query.mockRejectedValue(new Error('boom'));

      const res = await request(app).get(URL);

      expect(res.statusCode).toBe(500);
      expect(res.body.error).toBeDefined();
      expect(JSON.stringify(res.body)).not.toContain('boom');
    });

    it('wird nicht als Artikelnummer aufgelöst (Route vor /:artikelnummer)', async () => {
      const res = await request(app).get(URL);

      expect(res.body).toHaveProperty('alle');
      expect(res.body).not.toHaveProperty('Artikelnummer');
    });
  });

  describe('Authentifizierung', () => {
    it('antwortet ohne Anmeldung mit 401 und fragt die Datenbank nicht ab', async () => {
      const ohneLogin = express();
      ohneLogin.use('/api/schmuckstuecke', authenticate, schmuckstueckeRoutes);

      const res = await request(ohneLogin).get(URL);

      expect(res.statusCode).toBe(401);
      expect(db.query).not.toHaveBeenCalled();
    });
  });
});
