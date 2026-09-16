'use strict';

// Deckt die Multer-Konfiguration des Foto-Uploads ab (siehe CLAUDE.md: max. 5 MB,
// nur jpg/png/gif): Grenzwertanalyse der Größengrenze und Entscheidungstabelle
// für erlaubte/verweigerte MIME-Typen über den echten Upload-Endpunkt.

process.env.JWT_SECRET = 'test-secret-do-not-use-in-prod';

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const express = require('express');

const mockUploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photoupload-test-'));

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

jest.mock('../src/utils/photoIndex', () => ({
  uploadsDir: mockUploadsDir,
  resolvePhotoFile: jest.fn(() => ({ error: 'Nicht gefunden' })),
  invalidate: jest.fn(),
}));

const schmuckstueckeRoutes = require('../src/routes/schmuckstuecke');

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.user = { id: 1, username: 'testuser', role: 'bearbeiter' };
  next();
});
app.use('/api/schmuckstuecke', schmuckstueckeRoutes);
// Multer-Fehler wie "Datei zu groß" landen ungefangen beim nächsten error-handler
// (genau wie in src/index.js), sonst gäbe es hier statt JSON eine HTML-Fehlerseite.
app.use((err, req, res, _next) => {
  res.status(500).json({ error: 'Interner Serverfehler' });
});

afterEach(() => {
  jest.clearAllMocks();
  for (const file of fs.readdirSync(mockUploadsDir)) {
    fs.rmSync(path.join(mockUploadsDir, file), { force: true });
  }
});

afterAll(() => {
  fs.rmSync(mockUploadsDir, { recursive: true, force: true });
});

const ONE_MB = 1024 * 1024;

function bufferMitGroesse(bytes) {
  return Buffer.alloc(bytes, 'a');
}

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
    expect(res.body.fileName).toBe('MPO001.jpg');
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

  it('lehnt eine Datei knapp über dem 5-MB-Limit ab (5 MB + 1 Byte)', async () => {
    const res = await request(app)
      .post('/api/schmuckstuecke/upload?artikelnummer=MPO003')
      .attach('foto', bufferMitGroesse(5 * ONE_MB + 1), {
        filename: 'test.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.statusCode).toBe(500);
    // Multer wirft LIMIT_FILE_SIZE als eigenen Fehler, der die catch-Klausel der
    // Route nicht abfängt (fehlt vor upload.single()) und beim globalen
    // error-handler landet statt bei der 400-Behandlung für falsche Dateitypen.
    expect(res.body.error).toBe('Interner Serverfehler');
    expect(fs.readdirSync(mockUploadsDir)).toHaveLength(0);
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
      .attach('foto', bufferMitGroesse(1024), { filename, contentType: mimeType });

    if (erlaubt) {
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    } else {
      // Tatsächliches Verhalten (Bug, siehe Testbericht): der fileFilter-Fehler
      // entsteht in der multer-Middleware VOR dem Route-Handler und erreicht
      // dessen try/catch (der auf "Nur"/"erlaubt" prüft und 400 liefern würde)
      // nie – er landet stattdessen ungefangen im globalen error-handler mit 500.
      // Dokumentierte/erwünschte Antwort wäre 400 + "Nur JPG, PNG und GIF Dateien
      // sind erlaubt".
      expect(res.statusCode).toBe(500);
      expect(res.body.error).toBe('Interner Serverfehler');
    }
  });

  it('lehnt einen Upload ohne Datei mit 400 ab', async () => {
    const res = await request(app).post('/api/schmuckstuecke/upload?artikelnummer=MPO010');

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Keine Datei hochgeladen');
  });
});
