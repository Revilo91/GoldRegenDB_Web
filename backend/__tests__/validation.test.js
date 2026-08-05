'use strict';

/**
 * Tests für backend/src/middleware/validate.js und backend/src/schemas
 *
 * Zwei Risiken werden hier abgesichert:
 *  1. Zu lasch – ungültige Werte erreichen die Datenbank (Zweck von Issue #136)
 *  2. Zu streng – die bestehenden Frontend-Payloads werden abgelehnt und die
 *     Anwendung ist kaputt. Deshalb prüft jeder Block auch den Gutfall mit
 *     genau der Struktur, die das React-Frontend heute sendet.
 */

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const request = require('supertest');
const express = require('express');
const { validate } = require('../src/middleware/validate');
const schemas = require('../src/schemas');

// Baut eine Mini-App, die den geparsten Body zurückgibt
function buildApp(schema) {
  const app = express();
  app.use(express.json());
  app.post('/', validate(schema), (req, res) => res.json(req.body));
  return app;
}

function post(schema, body) {
  return request(buildApp(schema)).post('/').send(body);
}

// ── validate-Middleware ──────────────────────────────────────────────────────

describe('validate-Middleware', () => {
  it('antwortet mit 400 und nennt das fehlerhafte Feld', async () => {
    const res = await post(schemas.kundeSchema, { Name: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/^Name:/);
  });

  it('liefert alle Fehler in details', async () => {
    const res = await post(schemas.kundeSchema, {});
    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.details)).toBe(true);
    expect(res.body.details.length).toBeGreaterThan(1);
  });

  it('entfernt unbekannte Felder aus dem Body', async () => {
    const res = await post(schemas.kundeSchema, {
      Name: 'Testkunde', Strasse: 'Hauptstr', Hausnummer: 1, Ort: 'Berlin', PLZ: 10115,
      Provision: 10, Aktiv: true,
      istAdmin: true, '"; DROP TABLE "Kunde"; --': 'x',
    });
    expect(res.status).toBe(200);
    expect(res.body.istAdmin).toBeUndefined();
    expect(Object.keys(res.body)).not.toContain('"; DROP TABLE "Kunde"; --');
  });
});

// ── Kunde ────────────────────────────────────────────────────────────────────

describe('kundeSchema', () => {
  const gueltig = {
    Name: 'Goldschmiede Meyer', Strasse: 'Hauptstraße', Hausnummer: 12,
    Ort: 'Hamburg', PLZ: 20095, Email: 'kontakt@meyer.de',
    Telefonnummer: '040 123456', Provision: 15, Aktiv: true,
  };

  it('akzeptiert den Payload des Kunden-Formulars', async () => {
    const res = await post(schemas.kundeSchema, gueltig);
    expect(res.status).toBe(200);
    expect(res.body.Name).toBe('Goldschmiede Meyer');
  });

  it('akzeptiert Zahlenfelder als String (HTML-Formular)', async () => {
    const res = await post(schemas.kundeSchema, { ...gueltig, Hausnummer: '12', PLZ: '20095', Provision: '15' });
    expect(res.status).toBe(200);
    expect(res.body.Hausnummer).toBe(12);
    expect(res.body.PLZ).toBe(20095);
  });

  it('wandelt leere optionale Felder in null', async () => {
    const res = await post(schemas.kundeSchema, { ...gueltig, Email: '', Telefonnummer: '' });
    expect(res.status).toBe(200);
    expect(res.body.Email).toBeNull();
    expect(res.body.Telefonnummer).toBeNull();
  });

  it('lehnt eine ungültige E-Mail-Adresse ab', async () => {
    const res = await post(schemas.kundeSchema, { ...gueltig, Email: 'keine-email' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Email/);
  });

  it('lehnt eine Provision über 100 % ab', async () => {
    const res = await post(schemas.kundeSchema, { ...gueltig, Provision: 250 });
    expect(res.status).toBe(400);
  });

  it('lehnt einen zu langen Namen ab', async () => {
    const res = await post(schemas.kundeSchema, { ...gueltig, Name: 'a'.repeat(101) });
    expect(res.status).toBe(400);
  });

  it('lehnt einen leeren Pflichtnamen ab', async () => {
    const res = await post(schemas.kundeSchema, { ...gueltig, Name: '   ' });
    expect(res.status).toBe(400);
  });
});

// ── Schmuckstück ─────────────────────────────────────────────────────────────

describe('schmuckstueckCreateSchema', () => {
  it('akzeptiert eine Kurz-Artikelnummer (Präfix)', async () => {
    const res = await post(schemas.schmuckstueckCreateSchema, { Artikelnummer: 'MHO', Anzahl: 3 });
    expect(res.status).toBe(200);
    expect(res.body.Anzahl).toBe(3);
  });

  it('akzeptiert Preise als String', async () => {
    const res = await post(schemas.schmuckstueckCreateSchema, {
      Artikelnummer: 'MHO123', Verkaufspreis: '49.90', Herstellungskosten: '12',
    });
    expect(res.status).toBe(200);
    expect(res.body.Verkaufspreis).toBe(49.9);
  });

  it('lehnt einen negativen Verkaufspreis ab', async () => {
    const res = await post(schemas.schmuckstueckCreateSchema, { Artikelnummer: 'MHO123', Verkaufspreis: -5 });
    expect(res.status).toBe(400);
  });

  it('lehnt einen nicht-numerischen Preis ab', async () => {
    const res = await post(schemas.schmuckstueckCreateSchema, { Artikelnummer: 'MHO123', Verkaufspreis: 'teuer' });
    expect(res.status).toBe(400);
  });

  it('lehnt eine fehlende Artikelnummer ab', async () => {
    const res = await post(schemas.schmuckstueckCreateSchema, { Name: 'Kette' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Artikelnummer/);
  });

  it('lehnt eine zu lange Artikelnummer ab (VARCHAR(20))', async () => {
    const res = await post(schemas.schmuckstueckCreateSchema, { Artikelnummer: 'M'.repeat(21) });
    expect(res.status).toBe(400);
  });

  it('begrenzt Verkauft/Ausschuss auf 0 oder 1', async () => {
    const ok = await post(schemas.schmuckstueckUpdateSchema, { Verkauft: 1, Ausschuss: 0 });
    expect(ok.status).toBe(200);
    const res = await post(schemas.schmuckstueckUpdateSchema, { Verkauft: 7 });
    expect(res.status).toBe(400);
  });

  it('begrenzt die Menge auf 200 Stück', async () => {
    const res = await post(schemas.schmuckstueckCreateSchema, { Artikelnummer: 'MHO', Anzahl: 500 });
    expect(res.status).toBe(400);
  });
});

describe('schmuckstueckBulkSchema', () => {
  it('akzeptiert die items-Variante', async () => {
    const res = await post(schemas.schmuckstueckBulkSchema, {
      items: [{ Artikelnummer: 'MHO123_1', Verkaufspreis: 20 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });

  it('akzeptiert die template-Variante', async () => {
    const res = await post(schemas.schmuckstueckBulkSchema, {
      template: { Art: 'Kette', Verkaufspreis: 20 },
      artikelnummern: ['MHO123_1', 'MHO123_2'],
    });
    expect(res.status).toBe(200);
    expect(res.body.artikelnummern).toHaveLength(2);
  });

  it('lehnt mehr als 200 Einträge ab', async () => {
    const items = Array.from({ length: 201 }, (_, i) => ({ Artikelnummer: `MHO123_${i}` }));
    const res = await post(schemas.schmuckstueckBulkSchema, { items });
    expect(res.status).toBe(400);
  });
});

// ── Lieferschein / Rechnung ──────────────────────────────────────────────────

describe('lieferschein-/rechnungSchema', () => {
  it('akzeptiert den Payload des DocumentManagers', async () => {
    const res = await post(schemas.rechnungSchema, {
      Nummer: 'R-2026-001', Kundennummer: 4, status: 'final',
      Artikelnummern: ['MHO123_1', 'MHO124_2'],
      rabatt_gesamt: 10, rabatt_positionen: { MHO123: 5 },
    });
    expect(res.status).toBe(200);
    expect(res.body.rabatt_positionen.MHO123).toBe(5);
  });

  it('akzeptiert einen leeren Entwurf ohne Nummer', async () => {
    const res = await post(schemas.lieferscheinSchema, { Nummer: '', Kundennummer: 4, status: 'entwurf' });
    expect(res.status).toBe(200);
  });

  it('lehnt einen unbekannten Status ab', async () => {
    const res = await post(schemas.lieferscheinSchema, { Kundennummer: 4, status: 'geloescht' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/status/);
  });

  it('lehnt einen Rabatt über 100 % ab', async () => {
    const res = await post(schemas.rechnungSchema, { Kundennummer: 4, rabatt_gesamt: 150 });
    expect(res.status).toBe(400);
  });

  it('lehnt eine ungültige Artikelnummer in der Positionsliste ab', async () => {
    const res = await post(schemas.lieferscheinSchema, {
      Kundennummer: 4, Artikelnummern: ["MHO123_1'; DROP TABLE x; --"],
    });
    expect(res.status).toBe(400);
  });
});

// ── Benutzerverwaltung / Auth ────────────────────────────────────────────────

describe('user- und auth-Schemas', () => {
  const SHA256 = 'a'.repeat(64);

  it('akzeptiert einen gültigen Benutzer', async () => {
    const res = await post(schemas.userCreateSchema, {
      username: 'marina', password: SHA256, email: 'm@goldregen.local', role: 'bearbeiter', active: true,
    });
    expect(res.status).toBe(200);
  });

  it('lehnt eine unbekannte Rolle ab', async () => {
    const res = await post(schemas.userCreateSchema, { username: 'x', password: SHA256, role: 'superadmin' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/role/);
  });

  it('lehnt ein Passwort ab, das kein SHA-256-Hash ist', async () => {
    const res = await post(schemas.loginSchema, { username: 'admin', password: 'geheim' });
    expect(res.status).toBe(400);
  });

  it('lehnt einen Großbuchstaben-Hash ab', async () => {
    const res = await post(schemas.loginSchema, { username: 'admin', password: 'A'.repeat(64) });
    expect(res.status).toBe(400);
  });

  it('verlangt beide Passwörter beim Wechsel', async () => {
    const res = await post(schemas.changePasswordSchema, { currentPassword: SHA256 });
    expect(res.status).toBe(400);
  });
});

// ── Bestellungen ─────────────────────────────────────────────────────────────

describe('bestellungSchemas', () => {
  const gueltig = {
    versandart: 'abholung',
    wunschdatum: null,
    beschreibung: 'Ring mit Aquamarin',
    kunde: { name: 'Anna', email: 'anna@example.com', telefonnummer: '', strasse: '', hausnummer: '', plz: '', ort: '' },
    consent: { erteilt: true },
  };

  it('akzeptiert den Payload des öffentlichen Formulars', async () => {
    const res = await post(schemas.bestellungPublicSchema, gueltig);
    expect(res.status).toBe(200);
  });

  it('akzeptiert PLZ und Hausnummer auch als Zahl', async () => {
    const res = await post(schemas.bestellungPublicSchema, {
      ...gueltig, versandart: 'lieferung',
      kunde: { ...gueltig.kunde, strasse: 'Weg', hausnummer: 7, plz: 20095, ort: 'Hamburg', telefonnummer: '040' },
    });
    expect(res.status).toBe(200);
    expect(res.body.kunde.plz).toBe('20095');
  });

  it('lehnt eine unbekannte Versandart ab', async () => {
    const res = await post(schemas.bestellungPublicSchema, { ...gueltig, versandart: 'drohne' });
    expect(res.status).toBe(400);
  });

  it('lehnt eine leere Beschreibung ab', async () => {
    const res = await post(schemas.bestellungPublicSchema, { ...gueltig, beschreibung: '   ' });
    expect(res.status).toBe(400);
  });

  it('begrenzt die Beschreibung auf 2000 Zeichen', async () => {
    const res = await post(schemas.bestellungPublicSchema, { ...gueltig, beschreibung: 'x'.repeat(2001) });
    expect(res.status).toBe(400);
  });

  it('lehnt ein ungültiges Wunschdatum ab', async () => {
    const res = await post(schemas.bestellungPublicSchema, { ...gueltig, wunschdatum: '31.12.2026' });
    expect(res.status).toBe(400);
  });

  it('behält das Honeypot-Feld, damit die Route es prüfen kann', async () => {
    const res = await post(schemas.bestellungPublicSchema, { ...gueltig, webseite: 'bot' });
    expect(res.status).toBe(200);
    expect(res.body.webseite).toBe('bot');
  });
});

// ── Lager-Inventur ───────────────────────────────────────────────────────────

describe('lagerinventurSchema', () => {
  it('akzeptiert einen leeren neuen Entwurf', async () => {
    const res = await post(schemas.lagerinventurSchema, { data: {}, kommentar: '' });
    expect(res.status).toBe(200);
  });

  it('akzeptiert gezählte Mengen', async () => {
    const res = await post(schemas.lagerinventurSchema, { data: { MHO123_1: 3, MHO124_2: 1 }, kommentar: 'Regal 2' });
    expect(res.status).toBe(200);
  });

  it('lehnt eine Menge von 0 oder negativ ab', async () => {
    const res = await post(schemas.lagerinventurSchema, { data: { MHO123_1: 0 } });
    expect(res.status).toBe(400);
  });

  it('lehnt eine nicht-numerische Menge ab', async () => {
    const res = await post(schemas.lagerinventurSchema, { data: { MHO123_1: 'viele' } });
    expect(res.status).toBe(400);
  });
});

// ── Debug (Admin) ────────────────────────────────────────────────────────────

describe('debugUpdateSchema', () => {
  it('akzeptiert eine Zellenänderung', async () => {
    const res = await post(schemas.debugUpdateSchema, {
      primaryKey: 'Artikelnummer', id: 'MHO123_1', field: 'Name', value: 'Kette',
    });
    expect(res.status).toBe(200);
  });

  it('lehnt Bezeichner mit Sonderzeichen ab (Identifier werden interpoliert)', async () => {
    const res = await post(schemas.debugUpdateSchema, {
      primaryKey: 'ID', id: 1, field: 'Name" = \'x\'; --', value: 'y',
    });
    expect(res.status).toBe(400);
  });
});

// ── SumUp ────────────────────────────────────────────────────────────────────

describe('sumupImportSchema', () => {
  it('akzeptiert einen CSV-String', async () => {
    const res = await post(schemas.sumupImportSchema, { csvData: 'Datum,Betrag\n2026-01-01,10' });
    expect(res.status).toBe(200);
  });

  it('lehnt einen leeren Import ab', async () => {
    const res = await post(schemas.sumupImportSchema, { csvData: '' });
    expect(res.status).toBe(400);
  });
});
