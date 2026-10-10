'use strict';

process.env.JWT_SECRET = 'test-secret-do-not-use-in-prod';

const request = require('supertest');

jest.mock('../src/config/db', () => ({
  query: jest.fn(),
  connect: jest.fn(),
  setCurrentDbUsername: jest.fn(),
  requestContextMiddleware: (req, res, next) => next(),
}));
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const db = require('../src/config/db');
const logger = require('../src/utils/logger');
const { buildTestApp } = require('./helpers/buildTestApp');
const { createTxClientMock, sqlVerlauf } = require('./helpers/txClientMock');
const sumupRoutes = require('../src/routes/sumup');
const { parseCSVLines } = sumupRoutes;

const app = buildTestApp({
  router: sumupRoutes,
  mountPath: '/api/sumup',
  user: { id: 1, username: 'testuser', role: 'bearbeiter' },
});

const zeilen = (res) => res.text.replace(/^\uFEFF/, '').split('\n');

beforeEach(() => jest.clearAllMocks());

describe('GET /api/sumup/export', () => {
  it('liefert eine CSV mit BOM, Kopfzeile mit 36 Spalten und Download-Header', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/sumup/export');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename=Sumup_Export_\d{4}-\d{2}-\d{2}\.csv/);
    expect(res.text.startsWith('\uFEFF')).toBe(true);
    expect(zeilen(res)).toHaveLength(1);
    expect(zeilen(res)[0].split(',')).toHaveLength(36);
  });

  it('fragt nur verfügbare Stücke über den whereClauseBuilder ab', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    await request(app).get('/api/sumup/export');

    const sql = db.query.mock.calls[0][0];
    expect(sql).toMatch(/"Verkauft"/);
    expect(sql).toMatch(/"Ausschuss"/);
    expect(sql).toMatch(/"Ausgelagert"/);
  });

  it('gibt Einzelstücke als eine Zeile mit Preis, SKU und Beschreibung aus', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ Artikelnummer: 'MHO001_1', Verkaufspreis: '12.5', Art: 'Stecker', Form: 'rund', Fassung: 'Silber', Farbe: 'rot', Inhalt_Zusatzmaterial: '0' }],
    });

    const res = await request(app).get('/api/sumup/export');

    const [, zeile] = zeilen(res);
    const spalten = zeile.split(',');
    expect(zeilen(res)).toHaveLength(2);
    expect(spalten[0]).toBe('MHO001');
    expect(spalten[11]).toBe('12.50');
    expect(spalten[18]).toBe('MHO001_1');
    expect(zeile).toContain('"Stecker rund Silber rot, -"');
    expect(zeile).toContain('Ohrring');
  });

  it('gibt mehrere Varianten unter gleichem Item name mit Variations aus, ohne Gruppenzeile', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        { Artikelnummer: 'MBH028_1', Verkaufspreis: '20' },
        { Artikelnummer: 'MBH028_2', Verkaufspreis: '20' },
        { Artikelnummer: 'MBH028_3', Verkaufspreis: '20' },
      ],
    });

    const res = await request(app).get('/api/sumup/export');

    const [, ...varianten] = zeilen(res);
    const spalten = varianten.map((v) => v.split(','));
    expect(varianten).toHaveLength(3);
    expect(spalten.map((c) => c[0])).toEqual(['MBH028', 'MBH028', 'MBH028']);
    expect(spalten.map((c) => c[1])).toEqual(['MBH028_1', 'MBH028_2', 'MBH028_3']);
    expect(spalten.map((c) => c[11])).toEqual(['20.00', '20.00', '20.00']);
    expect(spalten.map((c) => c[18])).toEqual(['MBH028_1', 'MBH028_2', 'MBH028_3']);
    expect(spalten.every((c) => c[10] === '')).toBe(true);
  });

  it('lässt Variations bei Einzelstücken leer', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ Artikelnummer: 'MHO001_1', Verkaufspreis: '5' }] });

    const res = await request(app).get('/api/sumup/export');

    const spalten = zeilen(res)[1].split(',');
    expect(spalten[0]).toBe('MHO001');
    expect(spalten[1]).toBe('');
  });

  it('hat in jeder Zeile genau 36 Spalten', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        { Artikelnummer: 'MBH028_1', Verkaufspreis: '20' },
        { Artikelnummer: 'MBH028_2', Verkaufspreis: '20' },
        { Artikelnummer: 'MHO001_1', Verkaufspreis: '5' },
      ],
    });

    const res = await request(app).get('/api/sumup/export');

    // Beschreibungen enthalten Kommas in Anführungszeichen, daher echter CSV-Parser
    parseCSVLines(res.text.replace(/^\uFEFF/, '')).forEach((z) => expect(z).toHaveLength(36));
  });

  it('maskiert Kommas und Anführungszeichen in Feldern', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ Artikelnummer: 'MBA001_1', Verkaufspreis: '5', Art: 'Band "extra"', Farbe: 'rot, blau', Anhänger: 'Stern', Zwischenstück: 'Perle' }],
    });

    const res = await request(app).get('/api/sumup/export');

    expect(res.text).toContain('"Band ""extra"" rot, blau, Stern, Perle"');
  });

  it('nutzt Beschreibungsformate für Halskette, Schlüsselanhänger und unbekannte Produktarten', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        { Artikelnummer: 'MBH001_1', Verkaufspreis: '1', Anhänger_Fassung: 'Silber', Anhänger_Form: 'Tropfen', Anhänger_Inhalt_Farbe: 'blau', Anhänger_Inhalt_Zusatzmaterial: null },
        { Artikelnummer: 'MBS001_1', Verkaufspreis: '1', Art: 'Beton', Form: 'Herz' },
        { Artikelnummer: 'MBX001_1', Verkaufspreis: null, Art: 'Deko', Material: 'Holz', Farbe: 'braun' },
      ],
    });

    const res = await request(app).get('/api/sumup/export');

    expect(res.text).toContain('Fassung Silber Tropfen');
    expect(res.text).toContain('Beton Herz');
    expect(res.text).toContain('Deko Holz braun');
    // fehlender Preis wird als 0.00 ausgegeben, nicht als NaN
    expect(res.text).not.toContain('NaN');
    expect(res.text).toContain('0.00');
  });

  it('antwortet bei Datenbankfehler mit 500', async () => {
    db.query.mockRejectedValueOnce(new Error('db down'));

    const res = await request(app).get('/api/sumup/export');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Fehler beim Erstellen des Sumup-Exports' });
  });
});

describe('POST /api/sumup/import (weitere Fälle)', () => {
  const client = (extra = {}) => createTxClientMock({
    ergebnisse: {
      'FOR UPDATE': { rows: [
        { Artikelnummer: 'MHO001', Verkaufspreis: '20.00' },
        { Artikelnummer: 'SBA002', Verkaufspreis: '10.00' },
      ] },
      'FROM "Kunde"': { rows: [{ ID: 7, Name: 'Messe' }] },
      'AS max_num': { rows: [{ max_num: '4' }] },
      'INSERT INTO "Lieferschein"': { rows: [{ ID: 11, Nummer: '2026-005' }] },
      'INSERT INTO "Rechnung"': { rows: [{ ID: 21, Nummer: '2026-006' }] },
      ...extra,
    },
  });

  it('erstellt getrennte Rechnungen für Marina und Saskia mit fortlaufenden Nummern', async () => {
    const c = client();
    let nr = 5;
    const orig = c.query.getMockImplementation();
    c.query.mockImplementation(async (sql, params) => {
      if (String(sql).includes('INSERT INTO "Rechnung"')) {
        return { rows: [{ ID: 20 + nr, Nummer: params[0] }] };
      }
      nr += 1;
      return orig(sql, params);
    });
    db.connect.mockResolvedValueOnce(c);

    const res = await request(app)
      .post('/api/sumup/import')
      .send({ csvData: 'Beschreibung\nMHO001 Ohrring\nSBA002 Armband\n' });

    expect(res.status).toBe(200);
    expect(res.body.artikel).toEqual({ gesamt: 2, marina: 1, saskia: 1 });
    expect(res.body.rechnungen.marina.Nummer).toMatch(/^\d{4}-005$/);
    expect(res.body.rechnungen.saskia.Nummer).toMatch(/^\d{4}-006$/);
  });

  it('erstellt nur eine Rechnung, wenn nur eine Herstellerin verkauft hat', async () => {
    const c = client({ 'FOR UPDATE': { rows: [{ Artikelnummer: 'SBA002', Verkaufspreis: '10.00' }] }, 'INSERT INTO "Rechnung"': { rows: [{ ID: 21, Nummer: 'X-1' }] } });
    db.connect.mockResolvedValueOnce(c);

    const res = await request(app).post('/api/sumup/import').send({ csvData: 'Beschreibung\nSBA002\n' });

    expect(res.status).toBe(200);
    expect(res.body.rechnungen.marina).toBeNull();
    expect(res.body.rechnungen.saskia).toEqual({ ID: 21, Nummer: 'X-1' });
  });

  it('nimmt die Artikelnummer klein geschrieben und mit Suffix an (Normalisierung auf Großbuchstaben)', async () => {
    const c = client({ 'FOR UPDATE': { rows: [{ Artikelnummer: 'MHO001_2', Verkaufspreis: '20.00' }] } });
    db.connect.mockResolvedValueOnce(c);

    const res = await request(app).post('/api/sumup/import').send({ csvData: 'Beschreibung\nmho001_2 Ohrring\n' });

    expect(res.status).toBe(200);
    const selectAufruf = c.query.mock.calls.find(([sql]) => String(sql).includes('FOR UPDATE'));
    expect(selectAufruf[1]).toEqual(expect.arrayContaining([['MHO001_2%']]));
  });

  it('lehnt eine CSV mit nur einer Kopfzeile ab (400), ohne Transaktion', async () => {
    const res = await request(app).post('/api/sumup/import').send({ csvData: 'Beschreibung,Betrag' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/leer oder ungültig/);
    expect(db.connect).not.toHaveBeenCalled();
  });

  it('lehnt einen leeren String per Schema ab (400)', async () => {
    const res = await request(app).post('/api/sumup/import').send({ csvData: '' });

    expect(res.status).toBe(400);
    expect(db.connect).not.toHaveBeenCalled();
  });

  it('lehnt fehlende und falsch typisierte csvData ab (400)', async () => {
    expect((await request(app).post('/api/sumup/import').send({})).status).toBe(400);
    expect((await request(app).post('/api/sumup/import').send({ csvData: 42 })).status).toBe(400);
  });

  it('nimmt bereits geparste Zeilen als Array an', async () => {
    const c = client({ 'FOR UPDATE': { rows: [{ Artikelnummer: 'MHO001', Verkaufspreis: '20.00' }] } });
    db.connect.mockResolvedValueOnce(c);

    const res = await request(app).post('/api/sumup/import').send({ csvData: [{ Beschreibung: 'MHO001 Ohrring' }] });

    expect(res.status).toBe(200);
    expect(res.body.artikel.gesamt).toBe(1);
  });

  it('nennt bei fehlenden Artikelnummern die verfügbaren Spalten und Beispieldaten', async () => {
    const res = await request(app).post('/api/sumup/import').send({ csvData: 'Beschreibung,Betrag\nKaffee,2.50\n' });

    expect(res.status).toBe(400);
    expect(res.body.verfuegbareSpalten).toEqual(['Beschreibung', 'Betrag']);
    expect(res.body.beispieldaten).toEqual({ Beschreibung: 'Kaffee', Betrag: '2.50' });
  });

  it('verarbeitet CSV mit Anführungszeichen und Kommas in Feldern', async () => {
    const c = client({ 'FOR UPDATE': { rows: [{ Artikelnummer: 'MHO001', Verkaufspreis: '20.00' }] } });
    db.connect.mockResolvedValueOnce(c);

    const res = await request(app)
      .post('/api/sumup/import')
      .send({ csvData: 'Beschreibung,Betrag\n"MHO001 Ohrring, rot",20.00\n' });

    expect(res.status).toBe(200);
  });

  it('rollt bei Datenbankfehler zurück, gibt den Client frei und verrät keine Details', async () => {
    const c = client();
    c.query.mockImplementation(async (sql) => {
      if (String(sql).includes('INSERT INTO "Lieferschein"')) throw new Error('secret db detail');
      return { rows: [{ ID: 7, Name: 'Messe', Artikelnummer: 'MHO001', Verkaufspreis: '1', max_num: '0' }] };
    });
    db.connect.mockResolvedValueOnce(c);

    const res = await request(app).post('/api/sumup/import').send({ csvData: 'Beschreibung\nMHO001\n' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Fehler beim Importieren der SumUp-Daten');
    expect(JSON.stringify(res.body)).not.toContain('secret');
    expect(sqlVerlauf(c)).toContain('ROLLBACK');
    expect(c.release).toHaveBeenCalled();
  });

  it('meldet den ursprünglichen Fehler, auch wenn der Rollback scheitert', async () => {
    const c = createTxClientMock();
    c.query.mockImplementation(async (sql) => {
      if (String(sql) === 'ROLLBACK') throw new Error('rollback kaputt');
      if (String(sql).includes('FOR UPDATE')) throw new Error('lock timeout');
      return { rows: [] };
    });
    db.connect.mockResolvedValueOnce(c);

    const res = await request(app).post('/api/sumup/import').send({ csvData: 'Beschreibung\nMHO001\n' });

    expect(res.status).toBe(500);
    expect(logger.error).toHaveBeenCalledWith('SUMUP', expect.stringContaining('Rollback'), { message: 'rollback kaputt' });
    expect(c.release).toHaveBeenCalled();
  });
});
