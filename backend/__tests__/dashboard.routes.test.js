'use strict';

process.env.JWT_SECRET = 'test-secret-do-not-use-in-prod';

const request = require('supertest');

jest.mock('../src/config/db', () => ({ query: jest.fn() }));
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const db = require('../src/config/db');
const logger = require('../src/utils/logger');
const { buildTestApp } = require('./helpers/buildTestApp');
const { pruefeKlammern } = require('./helpers/dbMock');
const dashboardRoutes = require('../src/routes/dashboard');

const app = buildTestApp({
  router: dashboardRoutes,
  mountPath: '/api/dashboard',
  user: { id: 1, username: 'testuser', role: 'bearbeiter' },
});

const statistik = (abweichung = {}) => ({
  totalPieces: 10,
  soldPieces: 2,
  outsourcedPieces: 3,
  rejectPieces: 1,
  inStockPieces: 4,
  totalRevenue: '99.50',
  totalCost: '20.00',
  totalCustomers: 5,
  activeCustomers: 4,
  ...abweichung,
});

// Die sieben Abfragen laufen per Promise.all in fester Reihenfolge.
function mockAbfragen({ stat = statistik(), herstellerRows = [], kundeRows = [] } = {}) {
  db.query
    .mockResolvedValueOnce({ rows: [stat] })
    .mockResolvedValueOnce({ rows: [{ id: 1 }] })
    .mockResolvedValueOnce({ rows: [{ Art: 'Ohrring', count: 3 }] })
    .mockResolvedValueOnce({ rows: [{ Name: 'Laden A', count: 3 }] })
    .mockResolvedValueOnce({ rows: [{ monat: '2026-01', marinaUmsatz: '10.00', saskiaUmsatz: '5.00' }] })
    .mockResolvedValueOnce({ rows: herstellerRows })
    .mockResolvedValueOnce({ rows: kundeRows });
}

beforeEach(() => jest.clearAllMocks());

describe('GET /api/dashboard', () => {
  it('liefert Kennzahlen und reicht alle Abfrageergebnisse durch', async () => {
    mockAbfragen({
      herstellerRows: [
        { hersteller: 'M', total: 6, verkauft: 1, ausgelagert: 2, verfuegbar: 2, ausschuss: 1, umsatz: '60.00' },
        { hersteller: 'S', total: 4, verkauft: 1, ausgelagert: 1, verfuegbar: 2, ausschuss: 0, umsatz: '39.50' },
      ],
      kundeRows: [{ hersteller: 'M', kunde: 'Laden A', anzahl: 2 }],
    });

    const res = await request(app).get('/api/dashboard');

    expect(res.status).toBe(200);
    expect(res.body.statistics).toMatchObject({ totalPieces: 10, totalRevenue: '99.50', activeCustomers: 4 });
    expect(res.body.recentChanges).toEqual([{ id: 1 }]);
    expect(res.body.piecesByArt).toEqual([{ Art: 'Ohrring', count: 3 }]);
    expect(res.body.piecesByKunde).toEqual([{ Name: 'Laden A', count: 3 }]);
    expect(res.body.monthlyRevenueTrend).toEqual([{ monat: '2026-01', marinaUmsatz: '10.00', saskiaUmsatz: '5.00' }]);
    expect(res.body.manufacturerByKunde).toEqual([{ hersteller: 'M', kunde: 'Laden A', anzahl: 2 }]);
    expect(res.body.manufacturerStats).toEqual({
      M: { total: 6, verkauft: 1, ausgelagert: 2, verfuegbar: 2, ausschuss: 1, umsatz: '60.00' },
      S: { total: 4, verkauft: 1, ausgelagert: 1, verfuegbar: 2, ausschuss: 0, umsatz: '39.50' },
    });
    expect(db.query).toHaveBeenCalledTimes(7);
  });

  it('berechnet die Statusverteilung in Prozent aus den vier Zuständen', async () => {
    mockAbfragen();

    const res = await request(app).get('/api/dashboard');

    expect(res.body.statusDistribution).toEqual([
      { name: 'Im Lager', value: 4, percentage: 40 },
      { name: 'Ausgelagert', value: 3, percentage: 30 },
      { name: 'Verkauft', value: 2, percentage: 20 },
      { name: 'Ausschuss', value: 1, percentage: 10 },
    ]);
  });

  it('rundet Prozentwerte auf eine Nachkommastelle', async () => {
    mockAbfragen({
      stat: statistik({ inStockPieces: 1, outsourcedPieces: 1, soldPieces: 1, rejectPieces: 0 }),
    });

    const res = await request(app).get('/api/dashboard');

    expect(res.body.statusDistribution.map((s) => s.percentage)).toEqual([33.3, 33.3, 33.3, 0]);
  });

  it('gibt 0 Prozent zurück, wenn es keine Stücke gibt (keine Division durch 0)', async () => {
    mockAbfragen({
      stat: statistik({ totalPieces: 0, inStockPieces: 0, outsourcedPieces: 0, soldPieces: 0, rejectPieces: 0, totalRevenue: '0.00' }),
    });

    const res = await request(app).get('/api/dashboard');

    expect(res.status).toBe(200);
    expect(res.body.statusDistribution.every((s) => s.value === 0 && s.percentage === 0)).toBe(true);
    expect(res.body.manufacturerStats).toEqual({});
  });

  it('erzeugt syntaktisch ausgewogenes SQL und nutzt den Statusfilter des whereClauseBuilder', async () => {
    mockAbfragen();

    await request(app).get('/api/dashboard');

    for (const [sql] of db.query.mock.calls) pruefeKlammern(sql);
    const umsatzSql = db.query.mock.calls[0][0];
    expect(umsatzSql).toContain('LEFT JOIN "Rechnung" r ON r."ID" = s."Rechnung_ID"');
    expect(umsatzSql).toMatch(/s\."Verkauft"/);
    // Umsatz kommt aus derselben Rabattformel wie der Beleg (rabatt_gesamt / rabatt_positionen)
    expect(umsatzSql).toMatch(/rabatt_gesamt/);
    expect(umsatzSql).toMatch(/rabatt_positionen/);
  });

  it('antwortet mit 500 und loggt, wenn eine Abfrage fehlschlägt', async () => {
    db.query.mockRejectedValue(new Error('connection refused'));

    const res = await request(app).get('/api/dashboard');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Fehler beim Laden des Dashboards' });
    expect(logger.error).toHaveBeenCalledWith('DASHBOARD', expect.any(String), { message: 'connection refused' });
  });
});
