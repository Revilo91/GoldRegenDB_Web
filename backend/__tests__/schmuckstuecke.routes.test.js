'use strict';

// Deckt die auf Geschwindigkeit umgebauten Endpunkte ab: die Listenabfrage
// ermittelt die Gesamtzahl jetzt per Fensterfunktion statt separatem COUNT,
// filter-options aggregiert alle Spalten in einer einzigen Abfrage.

process.env.JWT_SECRET = 'test-secret-do-not-use-in-prod';

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
const schmuckstueckeRoutes = require('../src/routes/schmuckstuecke');

const app = buildTestApp({
  router: schmuckstueckeRoutes,
  mountPath: '/api/schmuckstuecke',
  user: { id: 1, username: 'testuser', role: 'bearbeiter' },
});

beforeEach(() => jest.clearAllMocks());

describe('GET /api/schmuckstuecke', () => {
  it('liest die Gesamtzahl aus der Fensterfunktion und braucht nur eine Abfrage', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        { Artikelnummer: 'MPO001', Foto: 'MPO001.jpg', __total: '42' },
        { Artikelnummer: 'MPO002', Foto: 'MPO002.jpg', __total: '42' },
      ],
    });

    const res = await request(app).get('/api/schmuckstuecke?page=1&limit=50');

    expect(res.statusCode).toBe(200);
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 50, total: 42, totalPages: 1 });
    expect(res.body.data).toHaveLength(2);
    // Interne Hilfsspalte darf nicht nach außen gelangen
    expect(res.body.data[0]).not.toHaveProperty('__total');
    expect(res.body.data[0].Grundmaterial).toBe('Perle');
  });

  it('meldet total 0, wenn keine Treffer auf der ersten Seite liegen', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/schmuckstuecke?page=1&limit=50');

    expect(res.statusCode).toBe(200);
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(res.body.pagination.total).toBe(0);
  });

  it('zählt separat nach, wenn eine Seite hinter dem Ende angefragt wird', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '42' }] });

    const res = await request(app).get('/api/schmuckstuecke?page=5&limit=50');

    expect(res.statusCode).toBe(200);
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.query.mock.calls[1][0]).toContain('COUNT(*)');
    expect(res.body.pagination.total).toBe(42);
  });

  it('lädt bei limit=-1 ohne LIMIT/OFFSET', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ Artikelnummer: 'MPO001', Foto: 'x.jpg', __total: '1' }] });

    const res = await request(app).get('/api/schmuckstuecke?limit=-1');

    expect(res.statusCode).toBe(200);
    expect(db.query.mock.calls[0][0]).not.toContain('LIMIT');
    expect(res.body.pagination.total).toBe(1);
  });
});

describe('GET /api/schmuckstuecke/filter-options', () => {
  it('holt alle Filterwerte mit einer einzigen Abfrage und sortiert sie', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        arten: ['Ohrring', 'Armband', 'Kette'],
        laengen: [42, 18, 60],
        farben: null,
      }],
    });

    const res = await request(app).get('/api/schmuckstuecke/filter-options');

    expect(res.statusCode).toBe(200);
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(res.body.arten).toEqual(['Armband', 'Kette', 'Ohrring']);
    expect(res.body.laengen).toEqual([18, 42, 60]);
    // array_agg liefert NULL statt eines leeren Arrays
    expect(res.body.farben).toEqual([]);
    expect(res.body.ausschussgruende).toEqual([]);
  });

  it('liefert bei leerer Tabelle für jedes Feld ein leeres Array', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/schmuckstuecke/filter-options');

    expect(res.statusCode).toBe(200);
    expect(Object.values(res.body).every((wert) => Array.isArray(wert) && wert.length === 0)).toBe(true);
  });
});
