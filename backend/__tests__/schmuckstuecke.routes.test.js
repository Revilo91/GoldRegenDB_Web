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

  it('liefert bei leerer Tabelle für jedes Datenfeld ein leeres Array', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/schmuckstuecke/filter-options');

    expect(res.statusCode).toBe(200);
    // grundmaterialien/produktarten sind Konstanten aus utils/constants.js und
    // hängen nicht am Datenbestand (Befund G22).
    const { grundmaterialien, produktarten, ...datenFelder } = res.body;
    expect(Object.values(datenFelder).every((wert) => Array.isArray(wert) && wert.length === 0)).toBe(true);
    expect(grundmaterialien.length).toBeGreaterThan(0);
    expect(produktarten.length).toBeGreaterThan(0);
  });

  // Befund G22: GRUNDMATERIAL und PRODUKTART lagen vierfach im Projekt. Die
  // einzige Quelle ist utils/constants.js; das Frontend holt sie über diese
  // Antwort, die es beim Mount ohnehin schon lädt.
  it('liefert GRUNDMATERIAL und PRODUKTART aus utils/constants.js mit', async () => {
    const { GRUNDMATERIAL, PRODUKTART } = require('../src/utils/constants');
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/schmuckstuecke/filter-options');

    expect(res.body.grundmaterialien).toEqual(
      Object.entries(GRUNDMATERIAL).map(([code, label]) => ({ code, label })),
    );
    expect(res.body.produktarten).toEqual(
      Object.entries(PRODUKTART).map(([code, label]) => ({ code, label })),
    );
  });
});

describe('PUT /api/schmuckstuecke/:artikelnummer', () => {
  // Befund C8: "Ausgelagert", "Verkauft", "Ausschuss", "Lieferschein_ID" und
  // "Rechnung_ID" standen ohne COALESCE im SET. Weil sie im Schema .nullish()
  // sind, schrieb ein PUT ohne diese Felder NULL -- danach passte das Stück auf
  // keine Statusbedingung mehr und fiel aus Liste, Dashboard, Inventur und
  // SumUp-Export heraus.
  it('lässt Statusfelder unangetastet, wenn der Request sie nicht schickt', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ Artikelnummer: 'MPO001' }] });

    const res = await request(app)
      .put('/api/schmuckstuecke/MPO001')
      .send({ Artikelnummer: 'MPO001', Name: 'Neuer Name' });

    expect(res.statusCode).toBe(200);
    const sql = String(db.query.mock.calls[0][0]);
    const geschuetzt = [
      'Ausgelagert', 'Verkauft', 'Ausschuss', 'Lieferschein_ID', 'Rechnung_ID',
      // Die Geldspalten sind seit Befund B1 ebenfalls NOT NULL. Ohne COALESCE
      // loeschte ein PUT ohne Preis den Preis still -- und der Audit-Trigger
      // protokolliert Preisaenderungen nicht, die Spur fehlte also auch.
      'Verkaufspreis', 'Herstellungskosten',
    ];
    for (const spalte of geschuetzt) {
      expect(sql).toMatch(new RegExp(`"${spalte}" = COALESCE\\(\\$\\d+, "${spalte}"\\)`));
    }
  });

  it('schreibt Verkauft/Ausschuss als boolean, nicht als 0/1', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ Artikelnummer: 'MPO001' }] });

    await request(app)
      .put('/api/schmuckstuecke/MPO001')
      .send({ Artikelnummer: 'MPO001', Verkauft: 1, Ausschuss: 0 });

    // bool() in schemas/common.js nimmt 0/1 entgegen und macht daraus
    // true/false -- die Spalten sind boolean (Befund B6).
    const params = db.query.mock.calls[0][1];
    expect(params[26]).toBe(true);   // $27 Verkauft
    expect(params[27]).toBe(false);  // $28 Ausschuss
  });

  it('meldet 404 bei unbekannter Artikelnummer', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .put('/api/schmuckstuecke/MPO999')
      .send({ Artikelnummer: 'MPO999', Name: 'x' });

    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/schmuckstuecke (Duplizieren)', () => {
  // Befund C11: der Kommentar sagte "Daten von Produkt holen, sobald das form
  // nicht ausgefüllt ist" -- geprüft wurde das nie. Die Bedingung war
  // `if (b.Artikelnummer)`, und Artikelnummer ist Pflichtfeld, also immer wahr.
  // Wer ein weiteres Exemplar mit korrigiertem Preis anlegte, bekam
  // stillschweigend den Preis des Vorgängers.
  function clientMitVorgaenger(vorgaenger) {
    return {
      query: jest.fn(async (sql) => {
        const text = String(sql);
        if (text.includes('MAX(CAST(SUBSTRING')) return { rows: [{ max_num: 111 }] };
        if (text.includes('max_suffix')) return { rows: [{ max_suffix: 1 }] };
        if (text.includes("|| '_' ||")) return { rows: [vorgaenger] };
        if (text.startsWith('INSERT INTO "Schmuckstück"')) {
          return { rows: [{ Artikelnummer: 'MHO123_2' }] };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: jest.fn(),
    };
  }

  const VORGAENGER = {
    Name: 'Alter Name',
    Verkaufspreis: '20.00',
    Herstellungskosten: '5.00',
    Farbe: 'gold',
    Art: 'Kette',
    Ausschuss_Grund: 'Defekt',
  };

  it('behält den eingegebenen Preis statt den des Vorgängers zu nehmen', async () => {
    const client = clientMitVorgaenger(VORGAENGER);
    db.connect.mockResolvedValueOnce(client);

    const res = await request(app)
      .post('/api/schmuckstuecke')
      .send({ Artikelnummer: 'MHO123', Verkaufspreis: 25, Name: 'Neuer Name' });

    expect(res.statusCode).toBe(201);
    const insert = client.query.mock.calls.find(
      (c) => String(c[0]).startsWith('INSERT INTO "Schmuckstück"'),
    );
    expect(insert[1]).toContain(25);          // eingegebener Preis
    expect(insert[1]).toContain('Neuer Name'); // eingegebener Name
    expect(insert[1]).not.toContain('20.00');
    expect(insert[1]).not.toContain('Alter Name');
  });

  it('übernimmt weiterhin die Felder, die der Client nicht schickt', async () => {
    const client = clientMitVorgaenger(VORGAENGER);
    db.connect.mockResolvedValueOnce(client);

    await request(app)
      .post('/api/schmuckstuecke')
      .send({ Artikelnummer: 'MHO123', Verkaufspreis: 25 });

    const insert = client.query.mock.calls.find(
      (c) => String(c[0]).startsWith('INSERT INTO "Schmuckstück"'),
    );
    expect(insert[1]).toContain('Alter Name'); // nicht geschickt -> vom Vorgänger
    expect(insert[1]).toContain('gold');
  });

  it('kopiert den Ausschussgrund nicht, weil Ausschuss auf false erzwungen wird', async () => {
    const client = clientMitVorgaenger(VORGAENGER);
    db.connect.mockResolvedValueOnce(client);

    await request(app)
      .post('/api/schmuckstuecke')
      .send({ Artikelnummer: 'MHO123' });

    const insert = client.query.mock.calls.find(
      (c) => String(c[0]).startsWith('INSERT INTO "Schmuckstück"'),
    );
    // Sonst entstanden Datensätze mit Ausschussgrund, die kein Ausschuss sind.
    expect(insert[1]).not.toContain('Defekt');
    expect(insert[1]).toContain(false); // Verkauft/Ausschuss
  });
});
