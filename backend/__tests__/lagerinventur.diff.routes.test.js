'use strict';

process.env.JWT_SECRET = 'test-secret-do-not-use-in-prod';

const request = require('supertest');

jest.mock('../src/config/db', () => ({ query: jest.fn() }));
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const db = require('../src/config/db');
const { buildTestApp } = require('./helpers/buildTestApp');
const lagerinventurRoutes = require('../src/routes/lagerinventur');

const app = buildTestApp({
  router: lagerinventurRoutes,
  mountPath: '/api/lagerinventur',
  user: { id: 7, username: 'testuser', role: 'bearbeiter' },
});

const lager = (nummern) => nummern.map((Artikelnummer) => ({
  Artikelnummer, Name: `Name ${Artikelnummer}`, Verkaufspreis: '10.00', Art: 'Ohrring', Material: 'Harz',
}));

const mockDiff = (scanned, lagerRows) => {
  db.query
    .mockResolvedValueOnce({ rows: [{ id: 1, user_id: 7, data: scanned }] })
    .mockResolvedValueOnce({ rows: lagerRows });
};

beforeEach(() => jest.clearAllMocks());

describe('GET /drafts/:id/diff (Soll/Ist je Basis-Artikelnummer)', () => {
  it('meldet ein vollständig erfasstes Stück als gefunden', async () => {
    mockDiff({ MHO001_1: 1, MHO001_2: 1 }, lager(['MHO001_1', 'MHO001_2']));

    const res = await request(app).get('/api/lagerinventur/drafts/1/diff');

    expect(res.status).toBe(200);
    expect(res.body.fehlend).toEqual([]);
    expect(res.body.unbekannt).toEqual([]);
    expect(res.body.gefunden).toEqual([
      expect.objectContaining({ Artikelnummer: 'MHO001', Soll: 2, Ist: 2, Gefunden: 2 }),
    ]);
    expect(res.body.stats).toEqual({ soll: 2, gescannt: 2, fehlend: 0, gefunden: 2, unbekannt: 0 });
  });

  it('meldet nicht gescannte Stücke als komplett fehlend', async () => {
    mockDiff({}, lager(['MHO001_1', 'MHO001_2', 'MHO002_1']));

    const res = await request(app).get('/api/lagerinventur/drafts/1/diff');

    expect(res.body.fehlend).toHaveLength(2);
    expect(res.body.fehlend.find((f) => f.Artikelnummer === 'MHO001')).toMatchObject({ Soll: 2, Ist: 0, Fehlt: 2 });
    expect(res.body.gefunden).toEqual([]);
    expect(res.body.stats).toMatchObject({ soll: 3, gescannt: 0, fehlend: 3, gefunden: 0 });
  });

  it('teilt bei Unterzahl in Gefunden und Fehlend', async () => {
    mockDiff({ MHO001_1: 1 }, lager(['MHO001_1', 'MHO001_2', 'MHO001_3']));

    const res = await request(app).get('/api/lagerinventur/drafts/1/diff');

    expect(res.body.fehlend[0]).toMatchObject({ Artikelnummer: 'MHO001', Soll: 3, Ist: 1, Fehlt: 2 });
    expect(res.body.gefunden[0]).toMatchObject({ Gefunden: 1 });
    expect(res.body.stats).toMatchObject({ fehlend: 2, gefunden: 1, unbekannt: 0 });
  });

  it('teilt bei Überzahl in Gefunden (= Soll) und Unbekannt (Überschuss)', async () => {
    mockDiff({ MHO001_1: 3 }, lager(['MHO001_1']));

    const res = await request(app).get('/api/lagerinventur/drafts/1/diff');

    expect(res.body.unbekannt[0]).toMatchObject({ Artikelnummer: 'MHO001', Soll: 1, Ist: 3, Zuviel: 2 });
    expect(res.body.gefunden[0]).toMatchObject({ Gefunden: 1 });
    expect(res.body.stats).toMatchObject({ gescannt: 3, fehlend: 0, gefunden: 1, unbekannt: 2 });
  });

  it('meldet Artikel ohne Lagerbestand als unbekannt mit Platzhaltern', async () => {
    mockDiff({ ZZZ999_1: 2 }, []);

    const res = await request(app).get('/api/lagerinventur/drafts/1/diff');

    expect(res.body.unbekannt).toEqual([
      { Artikelnummer: 'ZZZ999', Name: '–', Art: '–', Verkaufspreis: 0, Soll: 0, Ist: 2, Zuviel: 2 },
    ]);
    expect(res.body.stats).toMatchObject({ soll: 0, unbekannt: 2 });
  });

  it('kommt mit leerem Entwurf (data null) und leerem Lager zurecht', async () => {
    mockDiff(null, []);

    const res = await request(app).get('/api/lagerinventur/drafts/1/diff');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      fehlend: [], gefunden: [], unbekannt: [],
      stats: { soll: 0, gescannt: 0, fehlend: 0, gefunden: 0, unbekannt: 0 },
    });
  });

  it('nutzt für den Soll-Bestand den Verfügbar-Filter des whereClauseBuilder', async () => {
    mockDiff({}, []);

    await request(app).get('/api/lagerinventur/drafts/1/diff');

    const sql = db.query.mock.calls[1][0];
    expect(sql).toMatch(/"Verkauft"/);
    expect(sql).toMatch(/"Ausschuss"/);
    expect(sql).toMatch(/"Ausgelagert"/);
  });

  it('liefert 404 für fremde oder fehlende Entwürfe und filtert nach Benutzer', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/lagerinventur/drafts/99/diff');

    expect(res.status).toBe(404);
    expect(db.query.mock.calls[0][1]).toEqual(['99', 7]);
  });

  it('liefert 500 bei Datenbankfehler', async () => {
    db.query.mockRejectedValueOnce(new Error('db down'));

    const res = await request(app).get('/api/lagerinventur/drafts/1/diff');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Fehler beim Vergleichen' });
  });
});

describe('GET /drafts/:id', () => {
  it('liefert den eigenen Entwurf', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 3, user_id: 7, data: {} }] });

    const res = await request(app).get('/api/lagerinventur/drafts/3');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(3);
  });

  it('liefert 404, wenn der Entwurf nicht existiert', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/lagerinventur/drafts/3');

    expect(res.status).toBe(404);
  });

  it('liefert 500 bei Datenbankfehler', async () => {
    db.query.mockRejectedValueOnce(new Error('db down'));

    expect((await request(app).get('/api/lagerinventur/drafts/3')).status).toBe(500);
  });
});

describe('Fehlerfälle der übrigen Entwurfs-Routen', () => {
  it('GET /drafts: 500 bei Datenbankfehler', async () => {
    db.query.mockRejectedValueOnce(new Error('db down'));

    expect((await request(app).get('/api/lagerinventur/drafts')).status).toBe(500);
  });

  it('POST /drafts: 500 bei Datenbankfehler', async () => {
    db.query.mockRejectedValueOnce(new Error('db down'));

    const res = await request(app).post('/api/lagerinventur/drafts').send({ data: { MHO001_1: 1 } });

    expect(res.status).toBe(500);
  });

  it('POST /drafts: lehnt ungültige Mengen ab, ohne die DB zu berühren', async () => {
    const res = await request(app).post('/api/lagerinventur/drafts').send({ data: { MHO001_1: 0 } });

    expect(res.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('PUT /drafts/:id: 404, wenn der Entwurf abgeschlossen ist', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).put('/api/lagerinventur/drafts/1').send({ data: { MHO001_1: 1 } });

    expect(res.status).toBe(404);
    expect(db.query.mock.calls[0][1]).toEqual([{ MHO001_1: 1 }, null, '1', 7, 'entwurf']);
  });

  it('PUT /drafts/:id: 500 bei Datenbankfehler', async () => {
    db.query.mockRejectedValueOnce(new Error('db down'));

    const res = await request(app).put('/api/lagerinventur/drafts/1').send({ data: {} });

    expect(res.status).toBe(500);
  });

  it('POST /drafts/:id/complete: 404, wenn der Entwurf schon abgeschlossen ist', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).post('/api/lagerinventur/drafts/1/complete');

    expect(res.status).toBe(404);
  });

  it('POST /drafts/:id/complete: 500 bei Datenbankfehler', async () => {
    db.query.mockRejectedValueOnce(new Error('db down'));

    expect((await request(app).post('/api/lagerinventur/drafts/1/complete')).status).toBe(500);
  });
});
