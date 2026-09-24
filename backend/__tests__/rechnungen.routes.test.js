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
const rechnungenRoutes = require('../src/routes/rechnungen');

function buildApp(role = 'bearbeiter') {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 1, username: 'testuser', role };
    next();
  });
  app.use('/api/rechnungen', requireBearbeiter, rechnungenRoutes);
  return app;
}

beforeEach(() => jest.clearAllMocks());

describe('GET /api/rechnungen', () => {
  it('liefert alle Rechnungen mit Kundennamen', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ ID: 1, Nummer: '2026-001', KundenName: 'Anna' }] });

    const res = await request(buildApp()).get('/api/rechnungen');

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('filtert nach status, wenn angegeben', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get('/api/rechnungen?status=entwurf');

    expect(res.statusCode).toBe(200);
    expect(db.query.mock.calls[0][0]).toContain('WHERE r.status = $1');
    expect(db.query.mock.calls[0][1]).toEqual(['entwurf']);
  });

  it('lehnt den Zugriff mit Rolle user ab (403)', async () => {
    const res = await request(buildApp('user')).get('/api/rechnungen');

    expect(res.statusCode).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('GET /api/rechnungen/next-number', () => {
  it('ermittelt die nächste Nummer im Format JJJJ-NNN', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ max_num: '7' }] });

    const res = await request(buildApp()).get('/api/rechnungen/next-number');

    expect(res.statusCode).toBe(200);
    expect(res.body.Nummer).toMatch(/^\d{4}-008$/);
  });
});

describe('GET /api/rechnungen/:id', () => {
  it('liefert Rechnung inkl. zugeordneter Schmuckstücke', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ ID: 1, Nummer: '2026-001' }] })
      .mockResolvedValueOnce({ rows: [{ Artikelnummer: 'MHO001' }] });

    const res = await request(buildApp()).get('/api/rechnungen/1');

    expect(res.statusCode).toBe(200);
    expect(res.body.schmuckstuecke).toHaveLength(1);
  });

  it('meldet 404 bei unbekannter ID', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get('/api/rechnungen/999');

    expect(res.statusCode).toBe(404);
  });
});

describe('GET /api/rechnungen/:id/excel', () => {
  it('liefert eine XLSX-Datei', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ ID: 1, Nummer: '2026-001' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get('/api/rechnungen/1/excel');

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
  });

  it('meldet 404 bei unbekannter ID', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get('/api/rechnungen/999/excel');

    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/rechnungen', () => {
  it('legt eine Rechnung mit gültigen Daten an', async () => {
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
      .post('/api/rechnungen')
      .send({ Kundennummer: 1 });

    expect(res.statusCode).toBe(201);
    expect(res.body.ID).toBe(1);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  it('lehnt einen ungültigen rabatt_gesamt ab (400)', async () => {
    const res = await request(buildApp())
      .post('/api/rechnungen')
      .send({ Kundennummer: 1, rabatt_gesamt: 150 });

    expect(res.statusCode).toBe(400);
    expect(db.connect).not.toHaveBeenCalled();
  });

  it('meldet 409 bei doppelter Rechnungsnummer', async () => {
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
      .post('/api/rechnungen')
      .send({ Nummer: '2026-001', Kundennummer: 1 });

    expect(res.statusCode).toBe(409);
  });

  it('lehnt den Zugriff mit Rolle user ab (403)', async () => {
    const res = await request(buildApp('user')).post('/api/rechnungen').send({ Kundennummer: 1 });

    expect(res.statusCode).toBe(403);
    expect(db.connect).not.toHaveBeenCalled();
  });
});

describe('PUT /api/rechnungen/:id', () => {
  it('aktualisiert eine bestehende Rechnung', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ ID: 1, Nummer: '2026-001', status: 'entwurf' }] })
      .mockResolvedValueOnce({ rowCount: 0 });

    const res = await request(buildApp())
      .put('/api/rechnungen/1')
      .send({ Nummer: '2026-001', Kundennummer: 1 });

    expect(res.statusCode).toBe(200);
  });

  it('meldet 404 bei unbekannter ID', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .put('/api/rechnungen/999')
      .send({ Nummer: '2026-001', Kundennummer: 1 });

    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /api/rechnungen/:id', () => {
  it('löscht eine bestehende Rechnung', async () => {
    db.query
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValueOnce({ rowCount: 1 });

    const res = await request(buildApp()).delete('/api/rechnungen/1');

    expect(res.statusCode).toBe(200);
  });

  it('meldet 404 bei unbekannter ID', async () => {
    db.query
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValueOnce({ rowCount: 0 });

    const res = await request(buildApp()).delete('/api/rechnungen/999');

    expect(res.statusCode).toBe(404);
  });

  it('lehnt den Zugriff mit Rolle user ab (403)', async () => {
    const res = await request(buildApp('user')).delete('/api/rechnungen/1');

    expect(res.statusCode).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('GET /api/rechnungen/:id/erechnung', () => {
  const rechnung = {
    ID: 3, Nummer: '2026-003', Kundennummer: 4, Datum: '2026-09-20T10:00:00Z', status: 'final',
    rabatt_gesamt: '0.00', rabatt_positionen: {},
  };
  const kunde = {
    ID: 4, Name: 'Laden', Strasse: 'Weg', Hausnummer: 1, PLZ: 84085, Ort: 'Langquaid',
    Email: 'laden@example.org', Provision: 25, Land: 'DE',
  };
  const stueck = { Artikelnummer: 'MHO123_1', Verkaufspreis: 40, Lieferschein_ID: 9 };

  // Reihenfolge der Abfragen: Rechnung, Kunde, Schmuckstücke, Lieferschein-Zeitraum
  const mockRechnung = (r = rechnung, k = kunde) =>
    db.query
      .mockResolvedValueOnce({ rows: [r] })
      .mockResolvedValueOnce({ rows: [k] })
      .mockResolvedValueOnce({ rows: [stueck] })
      .mockResolvedValueOnce({ rows: [{ min_datum: '2026-08-01', max_datum: '2026-08-15' }] });

  const ENV_BACKUP = { ...process.env };
  beforeEach(() => {
    process.env.VERKAEUFER_STEUERNUMMER = '201/123/45678';
  });
  afterAll(() => {
    process.env = ENV_BACKUP;
  });

  it('liefert eine geprüfte XRechnung als XML-Download', async () => {
    mockRechnung();

    const res = await request(buildApp()).get('/api/rechnungen/3/erechnung?format=xrechnung');

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/xml');
    expect(res.headers['content-disposition']).toBe('attachment; filename="Rechnung_2026-003_XRechnung.xml"');
    expect(res.text).toContain('<ram:DuePayableAmount>30.00</ram:DuePayableAmount>');
    expect(res.text).toContain('<udt:DateTimeString format="102">20260801</udt:DateTimeString>');
  }, 30000);

  it('liefert ein ZUGFeRD-PDF', async () => {
    mockRechnung();

    const res = await request(buildApp()).get('/api/rechnungen/3/erechnung?format=zugferd').buffer(true);

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
  }, 30000);

  it('meldet fehlende Pflichtangaben mit 422 und Feldliste', async () => {
    mockRechnung(rechnung, { ...kunde, Email: null, PLZ: 0 });

    const res = await request(buildApp()).get('/api/rechnungen/3/erechnung');

    expect(res.statusCode).toBe(422);
    expect(res.body.error).toBe('E-Rechnung kann nicht erstellt werden: Pflichtangaben fehlen.');
    expect(res.body.fehler.map((f) => f.bt)).toEqual(['BT-53', 'BT-49']);
  });

  it('lehnt Entwürfe ab', async () => {
    mockRechnung({ ...rechnung, status: 'entwurf' });

    const res = await request(buildApp()).get('/api/rechnungen/3/erechnung');

    expect(res.statusCode).toBe(422);
    expect(res.body.fehler[0].meldung).toContain('Nur abgeschlossene Rechnungen');
  });

  it('meldet 400 bei unbekanntem Format', async () => {
    const res = await request(buildApp()).get('/api/rechnungen/3/erechnung?format=pdf');

    expect(res.statusCode).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('meldet 404 bei unbekannter Rechnung', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get('/api/rechnungen/999/erechnung');

    expect(res.statusCode).toBe(404);
  });
});
