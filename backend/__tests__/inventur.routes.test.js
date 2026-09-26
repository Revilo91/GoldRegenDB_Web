'use strict';

/**
 * Tests für /api/inventur.
 *
 * Befund C19: `verkauft` wurde als `s."Verkauft" = 1` gezählt, ohne den
 * Ausschuss-Ausschluss aus CLAUDE.md. Ein Stück mit Verkauft=1 UND Ausschuss=1
 * zählte damit in beiden Spalten, und `gesamt` war ungleich
 * aktiv + verkauft + ausschuss. Gegen die echten Seed-Daten traf das 6 von 19
 * Kunden.
 *
 * Befund F5: die Bedingungen standen von Hand in der Query statt aus dem
 * whereClauseBuilder zu kommen.
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

jest.mock('../src/utils/excelService', () => ({
  generateInventurExcel: jest.fn().mockResolvedValue(Buffer.from('xlsx')),
}));

const db = require('../src/config/db');
const { pruefeKlammern } = require('./helpers/dbMock');
const { requireBearbeiter } = require('../src/middleware/auth');
const inventurRoutes = require('../src/routes/inventur');

function buildApp(role = 'bearbeiter') {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 1, username: 'testuser', role };
    next();
  });
  app.use('/api/inventur', requireBearbeiter, inventurRoutes);
  return app;
}

beforeEach(() => jest.clearAllMocks());

describe('GET /api/inventur', () => {
  it('liefert die Übersicht je Kunde', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ ID: 1, Name: 'Anna', gesamt: 3, aktiv: 1, verkauft: 1, ausschuss: 1 }],
    });

    const res = await request(buildApp()).get('/api/inventur');

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('zählt "verkauft" nur ohne Ausschuss (C19)', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    await request(buildApp()).get('/api/inventur');

    const sql = String(db.query.mock.calls[0][0]);
    // Die verkauft-Spalte muss den Ausschuss ausschliessen ...
    expect(sql).toContain('s."Verkauft" IS TRUE AND s."Ausschuss" IS FALSE');
    // ... und darf das nackte `s."Verkauft" IS TRUE THEN` nicht mehr enthalten.
    expect(sql).not.toMatch(/s\."Verkauft" IS TRUE\s+THEN/);
  });

  it('nutzt für alle Statusspalten Bedingungen mit Tabellenalias (F5)', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    await request(buildApp()).get('/api/inventur');

    const sql = String(db.query.mock.calls[0][0]);
    expect(sql).toContain('s."Verkauft" IS FALSE AND s."Ausschuss" IS FALSE');
    expect(sql).toContain('s."Ausschuss" IS TRUE');
  });

  it('erzeugt syntaktisch geschlossenes SQL', async () => {
    // Der Fehler, der das erzwingt: in der Uebersicht stand
    //   round(SUM(CASE WHEN ... THEN 1 ELSE 0 END)::int AS "verkauft",
    // -- ein verirrtes round( ohne zweites Argument und ohne schliessende
    // Klammer, entstanden beim Einwickeln der GELDsummen (Q4). Postgres
    // antwortete mit "syntax error at or near AS", GET /api/inventur war ein
    // 500er. Kein Test hat es gesehen, weil der db-Mock SQL nie parst.
    db.query.mockResolvedValue({ rows: [] });

    await request(buildApp()).get('/api/inventur').expect(200);

    const sqls = db.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.length).toBeGreaterThan(0);
    sqls.forEach((sql) => expect(() => pruefeKlammern(sql)).not.toThrow());
  });

  it('rundet die Zaehlspalten nicht', async () => {
    // Zaehlungen sind ::int -- round() hat darauf nichts zu suchen, und genau
    // dieses versehentliche round( war der Syntaxfehler.
    db.query.mockResolvedValue({ rows: [] });

    await request(buildApp()).get('/api/inventur').expect(200);

    const sql = String(db.query.mock.calls[0][0]);
    expect(sql).toMatch(/END\)::int AS "verkauft"/);
    expect(sql).not.toMatch(/round\(SUM\(CASE[^)]*END\)::int/);
  });

  it('lehnt den Zugriff mit Rolle user ab (403)', async () => {
    const res = await request(buildApp('user')).get('/api/inventur');

    expect(res.statusCode).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('GET /api/inventur/:kundeId', () => {
  it('bildet die Kennzahlen in SQL, nicht in JavaScript', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ ID: 4, Name: 'Bea' }] }) // Kunde
      .mockResolvedValueOnce({ rows: [{ Artikelnummer: 'MHO001', Verkauft: true, Ausschuss: true }] })
      .mockResolvedValueOnce({
        rows: [{
          gesamt: 1,
          aktiv: 0,
          ausschuss_frei_verkauft: 0,
          ausschuss: 1,
          wert_aktiv: '0.00',
          wert_verkauft: '0.00',
        }],
      });

    const res = await request(buildApp()).get('/api/inventur/4');

    expect(res.statusCode).toBe(200);
    // Das Stück hat Verkauft UND Ausschuss: vorher zählte JavaScript es als
    // verkauft UND als ausschuss. Jetzt entscheidet SQL, und zwar nur einmal.
    expect(res.body.stats).toEqual({
      gesamt: 1,
      aktiv: 0,
      verkauft: 0,
      ausschuss: 1,
      wert_aktiv: '0.00',
      wert_verkauft: '0.00',
    });
    // Drei Abfragen: Kunde, Positionen, Kennzahlen
    expect(db.query).toHaveBeenCalledTimes(3);
    expect(String(db.query.mock.calls[2][0])).toContain('s."Verkauft" IS TRUE AND s."Ausschuss" IS FALSE');
  });

  it('liefert je Position hatFoto aus der Tabelle "Foto"', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ ID: 4, Name: 'Bea' }] })
      .mockResolvedValueOnce({ rows: [{ Artikelnummer: 'MHO001_2', hatFoto: true }] })
      .mockResolvedValueOnce({ rows: [{ gesamt: 1 }] });

    const res = await request(buildApp()).get('/api/inventur/4');

    expect(res.body.items[0].hatFoto).toBe(true);
    const sql = String(db.query.mock.calls[1][0]);
    expect(sql).toContain(`split_part(s."Artikelnummer", '_', 1)`);
    expect(sql).toContain('AS "hatFoto"');
  });

  it('meldet 400 statt 500 bei nicht-numerischer Kundennummer (C25)', async () => {
    // Vorher ging der Pfadteil ungeprueft als $1 in "ID" = $1: Postgres
    // antwortete mit 22P02 ("invalid input syntax for type integer") und der
    // Aufrufer sah einen 500er fuer seinen eigenen Eingabefehler.
    const res = await request(buildApp()).get('/api/inventur/lager');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/gültige ID/);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('meldet 404 bei unbekanntem Kunden', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get('/api/inventur/999');

    expect(res.statusCode).toBe(404);
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});
