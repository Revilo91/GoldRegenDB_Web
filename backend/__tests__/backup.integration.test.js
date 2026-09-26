'use strict';

// Backup/Restore gegen eine echte PostgreSQL-Datenbank. Die Mock-Tests in
// backup.routes.test.js prüfen, welches SQL gesendet wird – ob Postgres es
// annimmt (Constraints, Trigger, Sequences, Hash-Kette), zeigt erst dieser Lauf.
//
// Opt-in: ohne TEST_DATABASE_URL wird die Suite übersprungen. Der Import macht
// TRUNCATE, deshalb verweigert die Suite jede Datenbank, deren Name nicht
// "test" enthält. Einrichten (einmalig, Schema lädt die Suite selbst):
//   docker compose -f docker-compose.dev.yml exec db \
//     psql -U goldregen -d postgres -c 'CREATE DATABASE goldregendb_test'
//   TEST_DATABASE_URL=postgresql://goldregen:<DB_PASSWORD>@localhost:5432/goldregendb_test \
//     npm test -- backup.integration

process.env.JWT_SECRET = 'test-secret-do-not-use-in-prod';

jest.mock('../src/config/db', () => {
  const url = process.env.TEST_DATABASE_URL;
  const { Pool } = require('pg');
  const pool = url ? new Pool({ connectionString: url, max: 4 }) : null;
  return {
    _pool: pool,
    query: (...args) => pool.query(...args),
    connect: () => pool.connect(),
    setCurrentDbUsername: () => {},
    requestContextMiddleware: (req, res, next) => next(),
  };
});

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const express = require('express');
const db = require('../src/config/db');

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use((req, _res, next) => {
    req.user = { id: 1, username: 'admin', role: 'admin' };
    next();
  });
  app.use('/api/backup', require('../src/routes/backup'));
  return app;
}

const ALLE_TABELLEN =
  '"Kunde", "Lieferschein", "Rechnung", "Schmuckstück", app_users, audit_log, ' +
  'bestellung, bestellung_consent, bestellung_foto, bestellung_kunde, "Foto", lagerinventur';

// Alle 256 Bytewerte: fängt Kodierungsfehler (UTF-8, Vorzeichen) beim Round-Trip.
const FOTO = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from(Array.from({ length: 256 }, (_, i) => i)),
]);

describeDb('Backup/Restore gegen echte Datenbank', () => {
  const pool = db._pool;
  let app;

  const sql = (text, params) => pool.query(text, params);
  const exportiere = async () => (await request(app).get('/api/backup/export')).body;
  const ohneZeitstempel = (backup) => {
    const kopie = { ...backup };
    delete kopie.exportedAt;
    delete kopie.timestamp;
    return kopie;
  };
  const importiere = (tables, extra = {}) =>
    request(app)
      .post('/api/backup/import')
      .send({ backupData: { version: '1.0', tables }, ...extra });

  beforeAll(async () => {
    const { current_database: name } = (await sql('SELECT current_database()')).rows[0];
    if (!/test/i.test(name)) {
      throw new Error(`Verweigert: "${name}" ist keine Testdatenbank (Name muss "test" enthalten).`);
    }
    const { rows } = await sql(`SELECT to_regclass('"Schmuckstück"') AS t`);
    if (!rows[0].t) {
      await sql(fs.readFileSync(path.resolve(__dirname, '../../db/init.sql'), 'utf8'));
    }
    app = buildApp();
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await sql(`ALTER TABLE "Schmuckstück" DROP CONSTRAINT IF EXISTS test_grund_chk`);
    await sql(`TRUNCATE ${ALLE_TABELLEN} RESTART IDENTITY CASCADE`);
    await sql(
      `INSERT INTO app_users (username, password_hash, role) VALUES ('tester', 'x', 'admin')`,
    );
    await sql(
      `INSERT INTO "Kunde" ("Name", "Strasse", "Hausnummer", "Ort", "PLZ")
       VALUES ('Anna', 'Weg', 1, 'Ort', 12345), ('Berta', 'Weg', 2, 'Ort', 12345)`,
    );
    await sql(
      `INSERT INTO "Schmuckstück" ("Artikelnummer", "Verkaufspreis", "Herstellungskosten")
       VALUES ('MA1', 19.99, 5.5), ('MA2', 40, 10), ('MA3', 0, 3)`,
    );
    // Löst über den Trigger echte, hash-verkettete audit_log-Zeilen aus.
    await sql(`UPDATE "Schmuckstück" SET "Verkauft" = TRUE WHERE "Artikelnummer" = 'MA2'`);
    await sql(
      `UPDATE "Schmuckstück" SET "Ausschuss" = TRUE, "Ausschuss_Grund" = 'Bruch'
        WHERE "Artikelnummer" = 'MA3'`,
    );
    await sql(
      `INSERT INTO "Foto" ("Artikelnummer", "Daten", "MimeType", "Groesse") VALUES ('MA1', $1, 'image/png', $2)`,
      [FOTO, FOTO.length],
    );
    await sql(
      `INSERT INTO bestellung_foto (datei_name, daten, mime_type, groesse) VALUES ('abc', $1, 'image/png', $2)`,
      [FOTO, FOTO.length],
    );
  });

  it('Round-Trip: Export → Import → Export liefert identische Daten', async () => {
    const vorher = await exportiere();
    expect(vorher.tables['Schmuckstück']).toHaveLength(3);
    expect(vorher.tables.audit_log.length).toBeGreaterThan(0);

    const res = await importiere(vorher.tables);

    expect(res.status).toBe(200);
    expect(ohneZeitstempel(await exportiere())).toEqual(ohneZeitstempel(vorher));
  });

  it('stellt Fotos byte-genau wieder her', async () => {
    const backup = await exportiere();
    expect(backup.tables.Foto[0].Daten).toEqual({ type: 'Buffer', base64: FOTO.toString('base64') });
    await sql('TRUNCATE "Foto", bestellung_foto');

    const res = await importiere(backup.tables);

    expect(res.status).toBe(200);
    const foto = await sql(`SELECT "Daten", "MimeType", "Groesse" FROM "Foto" WHERE "Artikelnummer" = 'MA1'`);
    expect(foto.rows[0].Daten.equals(FOTO)).toBe(true);
    expect(foto.rows[0]).toMatchObject({ MimeType: 'image/png', Groesse: FOTO.length });
    const bestellFoto = await sql(`SELECT daten FROM bestellung_foto WHERE datei_name = 'abc'`);
    expect(bestellFoto.rows[0].daten.equals(FOTO)).toBe(true);
  });

  it('erhält die Audit-Hash-Kette (verify_audit_chain meldet nichts)', async () => {
    const vorher = await exportiere();

    const res = await importiere(vorher.tables);

    expect(res.body.auditKette).toEqual({ gueltig: true, kaputteEintraege: [] });
    expect((await sql('SELECT * FROM verify_audit_chain()')).rowCount).toBe(0);
  });

  it('zieht die Sequences nach: der nächste Kunde bekommt eine freie ID', async () => {
    const vorher = await exportiere();
    await importiere(vorher.tables);

    const { rows } = await sql(
      `INSERT INTO "Kunde" ("Name", "Strasse", "Hausnummer", "Ort", "PLZ")
       VALUES ('Clara', 'Weg', 3, 'Ort', 1) RETURNING "ID"`,
    );

    expect(rows[0].ID).toBe(3);
  });

  it('stellt ein Altbackup mit Verkauft ∧ Ausschuss wieder her (Ausschuss gewinnt)', async () => {
    const backup = await exportiere();
    const zeile = backup.tables['Schmuckstück'].find((r) => r.Artikelnummer === 'MA3');
    zeile.Verkauft = true; // Zustand vor schmuck_status_chk

    const res = await importiere(backup.tables);

    expect(res.status).toBe(200);
    const { rows } = await sql(
      `SELECT "Verkauft", "Ausschuss" FROM "Schmuckstück" WHERE "Artikelnummer" = 'MA3'`,
    );
    expect(rows[0]).toEqual({ Verkauft: false, Ausschuss: true });
  });

  it('lässt den Constraint schmuck_status_chk nach dem Import in Kraft', async () => {
    await importiere((await exportiere()).tables);

    await expect(
      sql(`UPDATE "Schmuckstück" SET "Verkauft" = TRUE WHERE "Artikelnummer" = 'MA3'`),
    ).rejects.toThrow(/schmuck_status_chk/);
  });

  it('stellt Zeilen wieder her, die einen NOT-VALID-Check verletzen, und legt ihn NOT VALID neu an', async () => {
    await sql(
      `ALTER TABLE "Schmuckstück" ADD CONSTRAINT test_grund_chk
         CHECK (NOT "Ausschuss" OR "Ausschuss_Grund" IS NOT NULL) NOT VALID`,
    );
    const backup = await exportiere();
    backup.tables['Schmuckstück'].find((r) => r.Artikelnummer === 'MA3').Ausschuss_Grund = null;

    const res = await importiere(backup.tables);

    expect(res.status).toBe(200);
    expect(res.body.geloesteChecks).toEqual(['test_grund_chk']);
    const { rows } = await sql(
      `SELECT convalidated FROM pg_constraint WHERE conname = 'test_grund_chk'`,
    );
    expect(rows).toEqual([{ convalidated: false }]);
  });

  it('rollt komplett zurück, wenn ein Insert scheitert – die Daten bleiben erhalten', async () => {
    const vorher = await exportiere();
    const kaputt = structuredClone(vorher.tables);
    kaputt.Kunde.push({ ...kaputt.Kunde[0] }); // doppelter Primärschlüssel

    const res = await importiere(kaputt);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Fehler beim Importieren/);
    expect(ohneZeitstempel(await exportiere())).toEqual(ohneZeitstempel(vorher));
  });

  it('Teilrestore: rührt nicht ausgewählte Tabellen nicht an', async () => {
    const backup = await exportiere();
    await sql(`UPDATE "Schmuckstück" SET "Verkaufspreis" = 99 WHERE "Artikelnummer" = 'MA1'`);
    await sql(`UPDATE app_users SET role = 'user' WHERE username = 'tester'`);

    const res = await importiere(backup.tables, { selectedTables: ['Schmuckstück'] });

    expect(res.status).toBe(200);
    const preis = await sql(
      `SELECT "Verkaufspreis" FROM "Schmuckstück" WHERE "Artikelnummer" = 'MA1'`,
    );
    expect(preis.rows[0].Verkaufspreis).toBe('19.99');
    const rolle = await sql(`SELECT role FROM app_users WHERE username = 'tester'`);
    expect(rolle.rows[0].role).toBe('user');
  });
});
