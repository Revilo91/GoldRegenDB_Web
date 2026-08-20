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
const { encryptField } = require('../src/utils/encryptionService');
const bestelluebersichtRoutes = require('../src/routes/bestelluebersicht');

function buildApp(role = 'bearbeiter') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 1, username: 'testuser', role };
    next();
  });
  app.use('/api/bestelluebersicht', bestelluebersichtRoutes);
  return app;
}

function makeClient() {
  return { query: jest.fn(), release: jest.fn() };
}

describe('Bestellübersicht API', () => {
  beforeEach(() => jest.clearAllMocks());

  it('POST / legt Bestellung mit Versandart "abholung" ohne Adresse an', async () => {
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
          beschreibung: 'Test Bestellung',
          status: 'offen',
          erstellt_von: 'testuser',
          erfassungsdatum: new Date(),
          aktualisiert_am: new Date(),
        }],
      }) // INSERT bestellung
      .mockResolvedValueOnce({}); // COMMIT

    const res = await request(buildApp())
      .post('/api/bestelluebersicht')
      .send({
        versandart: 'abholung',
        beschreibung: 'Test Bestellung',
        kunde: { name: 'Erika Mustermann', email: 'erika@example.com', telefonnummer: '0123456789' },
        consent: { erteilt: true },
      });

    expect(res.status).toBe(201);
    expect(res.body.bestellnummer).toBe('BE-2026-001');
    expect(res.body.kunde.name).toBe('Erika Mustermann');
    expect(db.connect).toHaveBeenCalled();
  });

  it('POST / lehnt fehlende Telefonnummer ab (Datenminimierung)', async () => {
    const res = await request(buildApp())
      .post('/api/bestelluebersicht')
      .send({
        versandart: 'abholung',
        beschreibung: 'Test',
        kunde: { name: 'Max Mustermann' },
        consent: { erteilt: true },
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Telefonnummer/);
    expect(db.connect).not.toHaveBeenCalled();
  });

  it('POST / lehnt Versandart "lieferung" ohne Adresse ab (Datenminimierung)', async () => {
    const res = await request(buildApp())
      .post('/api/bestelluebersicht')
      .send({
        versandart: 'lieferung',
        beschreibung: 'Test',
        kunde: { name: 'Max Mustermann', telefonnummer: '0123456789' },
        consent: { erteilt: true },
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Adresse/);
    expect(db.connect).not.toHaveBeenCalled();
  });

  it('POST / lehnt fehlende Einwilligung ab', async () => {
    const res = await request(buildApp())
      .post('/api/bestelluebersicht')
      .send({
        versandart: 'abholung',
        beschreibung: 'Test',
        kunde: { name: 'Max Mustermann', email: 'max@example.com', telefonnummer: '0123456789' },
        consent: { erteilt: false },
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Einwilligung/);
    expect(db.connect).not.toHaveBeenCalled();
  });

  it('GET / liefert entschlüsselte Kundendaten', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        id: 1,
        bestellnummer: 'BE-2026-001',
        kunde_id: 1,
        versandart: 'abholung',
        beschreibung: 'Test',
        status: 'offen',
        kunde_pseudonym: 'BK-abc123',
        anonymisiert: false,
        name_enc: encryptField('Erika Mustermann'),
        email_enc: encryptField('erika@example.com'),
        telefonnummer_enc: null,
        strasse_enc: null,
        hausnummer_enc: null,
        plz_enc: null,
        ort_enc: null,
      }],
    });

    const res = await request(buildApp()).get('/api/bestelluebersicht');

    expect(res.status).toBe(200);
    expect(res.body[0].kunde.name).toBe('Erika Mustermann');
    expect(res.body[0].kunde.email).toBe('erika@example.com');
    expect(res.body[0].name_enc).toBeUndefined();
  });

  it('POST /:id/anonymisieren verweigert Zugriff ohne Admin-Rolle', async () => {
    const res = await request(buildApp('bearbeiter')).post('/api/bestelluebersicht/1/anonymisieren');
    expect(res.status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('POST /:id/anonymisieren anonymisiert Kundendaten (Admin)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ kunde_id: 1 }] })
      .mockResolvedValueOnce({});

    const res = await request(buildApp('admin')).post('/api/bestelluebersicht/1/anonymisieren');

    expect(res.status).toBe(200);
    expect(db.query).toHaveBeenCalledWith('SELECT anonymisiere_bestellung_kunde($1)', [1]);
  });
});
