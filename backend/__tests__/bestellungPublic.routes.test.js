'use strict';

process.env.JWT_SECRET = 'test-secret-do-not-use-in-prod';
process.env.BESTELLUNG_ENCRYPTION_KEY = 'b3ae96f21e2f1ca8b65351153ccb3d8f0a1aa9b495c91b11530467d34c2e9336';
process.env.PRIVACY_POLICY_VERSION = 'test-v1';

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

const request = require('supertest');
const express = require('express');
const db = require('../src/config/db');
const bestellungPublicRoutes = require('../src/routes/bestellungPublic');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/public/bestellung', bestellungPublicRoutes);
  return app;
}

function makeClient() {
  return { query: jest.fn(), release: jest.fn() };
}

describe('Öffentliches Bestellformular (kein Login)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('POST / legt Bestellung ohne Authentifizierung an und gibt nur die Bestellnummer zurück', async () => {
    const client = makeClient();
    db.connect.mockResolvedValue(client);
    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}) // LOCK TABLE
      .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // INSERT bestellung_kunde
      .mockResolvedValueOnce({}) // INSERT bestellung_consent
      .mockResolvedValueOnce({ rows: [{ max_num: 0 }] }) // getNextBestellnummer
      .mockResolvedValueOnce({
        rows: [{
          id: 1,
          bestellnummer: 'BE-2026-001',
          kunde_id: 1,
          versandart: 'abholung',
          wunschdatum: null,
          beschreibung: 'Online-Bestellung',
          status: 'offen',
          erstellt_von: 'Online-Formular',
          erfassungsdatum: new Date(),
          aktualisiert_am: new Date(),
        }],
      }) // INSERT bestellung
      .mockResolvedValueOnce({}); // COMMIT

    const res = await request(buildApp())
      .post('/api/public/bestellung')
      .send({
        versandart: 'abholung',
        beschreibung: 'Online-Bestellung',
        kunde: { name: 'Erika Mustermann', email: 'erika@example.com' },
        consent: { erteilt: true },
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ bestellnummer: 'BE-2026-001' });
    // Keine PII/Kunden-ID an den anonymen Aufrufer zurückgeben
    expect(res.body.kunde).toBeUndefined();
    expect(res.body.kundeId).toBeUndefined();
  });

  it('POST / lehnt Anfragen mit ausgefülltem Honeypot-Feld ab', async () => {
    const res = await request(buildApp())
      .post('/api/public/bestellung')
      .send({
        versandart: 'abholung',
        beschreibung: 'Spam',
        kunde: { name: 'Bot', email: 'bot@example.com' },
        consent: { erteilt: true },
        webseite: 'https://spam.example.com',
      });

    expect(res.status).toBe(400);
    expect(db.connect).not.toHaveBeenCalled();
  });

  it('POST / lehnt Versandart "lieferung" ohne Adresse/Telefon ab (Datenminimierung)', async () => {
    const res = await request(buildApp())
      .post('/api/public/bestellung')
      .send({
        versandart: 'lieferung',
        beschreibung: 'Test',
        kunde: { name: 'Max Mustermann' },
        consent: { erteilt: true },
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Adresse/);
    expect(db.connect).not.toHaveBeenCalled();
  });

  it('POST / lehnt fehlende Einwilligung ab', async () => {
    const res = await request(buildApp())
      .post('/api/public/bestellung')
      .send({
        versandart: 'abholung',
        beschreibung: 'Test',
        kunde: { name: 'Max Mustermann', email: 'max@example.com' },
        consent: { erteilt: false },
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Einwilligung/);
    expect(db.connect).not.toHaveBeenCalled();
  });

  it('POST / lehnt zu lange Auftragsbeschreibung ab', async () => {
    const res = await request(buildApp())
      .post('/api/public/bestellung')
      .send({
        versandart: 'abholung',
        beschreibung: 'x'.repeat(2001),
        kunde: { name: 'Max Mustermann', email: 'max@example.com' },
        consent: { erteilt: true },
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/maximal/);
    expect(db.connect).not.toHaveBeenCalled();
  });
});
