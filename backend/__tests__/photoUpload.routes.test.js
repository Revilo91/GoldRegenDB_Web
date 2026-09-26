'use strict';

// Deckt den Foto-Upload ab (siehe CLAUDE.md: max. 5 MB, nur jpg/png/gif):
// Grenzwertanalyse der Größengrenze und Entscheidungstabelle für erlaubte/
// verweigerte Typen über den echten Upload-Endpunkt. Die Bilddaten landen in
// der Tabelle "Foto".

process.env.JWT_SECRET = 'test-secret-do-not-use-in-prod';

const request = require('supertest');
const express = require('express');

jest.mock('../src/config/db', () => ({
  query: jest.fn(async () => ({ rows: [], rowCount: 1 })),
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
const schmuckstueckeRoutes = require('../src/routes/schmuckstuecke');

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.user = { id: 1, username: 'testuser', role: 'bearbeiter' };
  next();
});
app.use('/api/schmuckstuecke', schmuckstueckeRoutes);
// Unerwartete Fehler landen weiterhin hier, genau wie in src/index.js.
app.use((err, req, res, _next) => {
  res.status(500).json({ error: 'Interner Serverfehler' });
});

afterEach(() => {
  jest.clearAllMocks();
});

const ONE_MB = 1024 * 1024;

const MAGIC = {
  'image/jpeg': Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/gif': Buffer.from('GIF89a', 'latin1'),
};

function bufferMitGroesse(bytes, mimeType = 'image/jpeg') {
  const kopf = MAGIC[mimeType] || Buffer.alloc(0);
  return Buffer.concat([kopf, Buffer.alloc(bytes - kopf.length, 'a')]);
}

const fotoInserts = () => db.query.mock.calls.filter(([sql]) => /INSERT INTO "Foto"/.test(sql));

describe('POST /api/schmuckstuecke/upload – Grenzwertanalyse 5-MB-Limit', () => {
  it('akzeptiert eine Datei knapp unter dem 5-MB-Limit (5 MB - 1 Byte)', async () => {
    const res = await request(app)
      .post('/api/schmuckstuecke/upload?artikelnummer=MPO001')
      .attach('foto', bufferMitGroesse(5 * ONE_MB - 1), {
        filename: 'test.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.fileName).toBe('MPO001');
    expect(fotoInserts()).toHaveLength(1);
  });

  it('akzeptiert eine Datei exakt auf dem 5-MB-Limit', async () => {
    const res = await request(app)
      .post('/api/schmuckstuecke/upload?artikelnummer=MPO002')
      .attach('foto', bufferMitGroesse(5 * ONE_MB), {
        filename: 'test.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('lehnt eine Datei knapp über dem 5-MB-Limit mit 400 ab', async () => {
    const res = await request(app)
      .post('/api/schmuckstuecke/upload?artikelnummer=MPO003')
      .attach('foto', bufferMitGroesse(5 * ONE_MB + 1), {
        filename: 'test.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.statusCode).toBe(400);
    expect(fotoInserts()).toHaveLength(0);
  });
});

describe('POST /api/schmuckstuecke/upload – MIME-Typ-Entscheidungstabelle', () => {
  test.each([
    ['image/jpeg', 'foto.jpg', true],
    ['image/png', 'foto.png', true],
    ['image/gif', 'foto.gif', true],
    ['application/pdf', 'foto.pdf', false],
    ['image/svg+xml', 'foto.svg', false],
    ['text/plain', 'foto.txt', false],
  ])('MIME-Typ %s wird %s', async (mimeType, filename, erlaubt) => {
    const res = await request(app)
      .post('/api/schmuckstuecke/upload?artikelnummer=MPO009')
      .attach('foto', bufferMitGroesse(1024, mimeType), { filename, contentType: mimeType });

    if (erlaubt) {
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    } else {
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('Nur JPG, PNG und GIF Dateien sind erlaubt');
    }
  });

  it('lehnt eine als JPG deklarierte Nicht-Bilddatei ab (Magic Bytes)', async () => {
    const res = await request(app)
      .post('/api/schmuckstuecke/upload?artikelnummer=MPO011')
      .attach('foto', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), {
        filename: 'foto.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Nur JPG, PNG und GIF Dateien sind erlaubt');
    expect(fotoInserts()).toHaveLength(0);
  });

  it('lehnt einen Upload ohne Artikelnummer ab', async () => {
    const res = await request(app)
      .post('/api/schmuckstuecke/upload')
      .attach('foto', bufferMitGroesse(1024), { filename: 'a.jpg', contentType: 'image/jpeg' });

    expect(res.statusCode).toBe(400);
    expect(fotoInserts()).toHaveLength(0);
  });

  it('speichert unter der Basis-Artikelnummer', async () => {
    const res = await request(app)
      .post('/api/schmuckstuecke/upload?artikelnummer=MPO012_3')
      .attach('foto', bufferMitGroesse(1024, 'image/png'), { filename: 'a.png', contentType: 'image/png' });

    expect(res.body.fileName).toBe('MPO012');
    expect(fotoInserts()[0][1].slice(0, 1)).toEqual(['MPO012']);
    expect(fotoInserts()[0][1][2]).toBe('image/png');
  });

  it('lehnt einen Upload ohne Datei mit 400 ab', async () => {
    const res = await request(app).post('/api/schmuckstuecke/upload?artikelnummer=MPO010');

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Keine Datei hochgeladen');
  });
});

describe('GET /api/schmuckstuecke/foto/:fileName', () => {
  it('liefert das Foto der Basis-Artikelnummer aus der Datenbank', async () => {
    const png = bufferMitGroesse(64, 'image/png');
    db.query.mockResolvedValueOnce({ rows: [{ mimeType: 'image/png', version: '7', daten: png }] });

    const res = await request(app).get('/api/schmuckstuecke/foto/MPO001_2.jpg');

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers.etag).toBe('"7"');
    expect(Buffer.compare(res.body, png)).toBe(0);
    expect(db.query.mock.calls[0][1][0]).toBe('MPO001');
  });

  it('meldet 404 ohne Datenbank-Foto', async () => {
    const res = await request(app).get('/api/schmuckstuecke/foto/MPO003');

    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /api/schmuckstuecke/foto/:fileName', () => {
  it('löscht den Datenbank-Eintrag der Basis-Artikelnummer', async () => {
    const res = await request(app).delete('/api/schmuckstuecke/foto/MPO001_1');

    expect(res.statusCode).toBe(200);
    expect(db.query.mock.calls[0][0]).toMatch(/DELETE FROM "Foto"/);
    expect(db.query.mock.calls[0][1]).toEqual(['MPO001']);
  });

  it('meldet 404, wenn nichts zu löschen war', async () => {
    db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(app).delete('/api/schmuckstuecke/foto/MPO009');

    expect(res.statusCode).toBe(404);
  });
});
