'use strict';

// Migrationen gegen echtes PostgreSQL (Issue #257). Prüft, dass alle Wege zum
// selben Schema führen:
//   (a) leere Datenbank + Migrationen
//   (b) leere Datenbank + db/init.sql (Docker-Entrypoint) + Migrationen
//   (c) Bestandsdatenbank alten Stands ohne schema_migrations + Migrationen
// und dass ein erneuter Lauf der kompletten Kette keinen Audit-Hash verändert.
//
// Opt-in wie backup.integration.test.js: ohne TEST_DATABASE_URL übersprungen.
// Die Suite legt eigene Datenbanken an (<Testdatenbank>_mig_a/_b/_c) und
// löscht sie am Ende; die Rolle braucht dafür CREATEDB. Datenbanken ohne
// "test" im Namen werden verweigert.

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Pool } = require('pg');
const { runMigrations } = require('../src/config/migrate');
const { schemaSnapshot } = require('./helpers/schemaSnapshot');

const BASIS_URL = process.env.TEST_DATABASE_URL;
const describeDb = BASIS_URL ? describe : describe.skip;
const INIT_SQL = path.resolve(__dirname, '../../db/init.sql');

function pgDumpVorhanden() {
  try {
    execFileSync('pg_dump', ['--version'], { stdio: 'ignore' });
    return true;
  } catch (_err) {
    return false;
  }
}

// Ausgangslage einer frühen Installation: SMALLINT-Status, Float-Preise,
// Hausnummer als INTEGER, audit_log ohne Hash-Kette, alter Rollen-Constraint.
const ALTBESTAND_SQL = `
  CREATE TABLE "Kunde" (
    "ID" SERIAL, "Name" VARCHAR(100) NOT NULL, "Strasse" TEXT NOT NULL,
    "Hausnummer" INTEGER NOT NULL DEFAULT 0, "Ort" TEXT NOT NULL, "PLZ" INTEGER NOT NULL,
    "Email" TEXT DEFAULT NULL, "Telefonnummer" TEXT DEFAULT NULL,
    "Provision" INTEGER NOT NULL DEFAULT 0, "Aktiv" BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY ("Name"), UNIQUE ("ID")
  );
  CREATE TABLE "Rechnung" (
    "ID" SERIAL, "Nummer" VARCHAR(20) NOT NULL, "Kundennummer" INTEGER NOT NULL,
    "Datum" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY ("Nummer"),
    CONSTRAINT "Rechnung_ibfk_1" FOREIGN KEY ("Kundennummer") REFERENCES "Kunde" ("ID")
  );
  CREATE INDEX idx_rechnung_id ON "Rechnung" ("ID");
  CREATE TABLE "Schmuckstück" (
    "Artikelnummer" VARCHAR(20) NOT NULL,
    "Name" TEXT DEFAULT NULL, "Art" TEXT DEFAULT NULL, "Form" TEXT DEFAULT NULL,
    "Länge" DOUBLE PRECISION DEFAULT 0, "Fassung" TEXT DEFAULT NULL, "Farbe" TEXT DEFAULT NULL,
    "Inhalt_Material" TEXT DEFAULT NULL, "Inhalt_Farbe" TEXT DEFAULT NULL,
    "Inhalt_Farbakzent" TEXT DEFAULT NULL, "Inhalt_Zusatzmaterial" TEXT DEFAULT NULL,
    "Anhänger_Fassung" TEXT DEFAULT NULL, "Anhänger_Form" TEXT DEFAULT NULL,
    "Anhänger_Farbe" TEXT DEFAULT NULL, "Anhänger_Grösse" DOUBLE PRECISION DEFAULT 0,
    "Anhänger_Inhalt_Material" TEXT DEFAULT NULL, "Anhänger_Inhalt_Farbe" TEXT DEFAULT NULL,
    "Anhänger_Inhalt_Farbakzente" TEXT DEFAULT NULL, "Anhänger_Inhalt_Zusatzmaterial" TEXT DEFAULT NULL,
    "Material" TEXT DEFAULT NULL, "Grösse" DOUBLE PRECISION DEFAULT 0,
    "Anhänger" TEXT DEFAULT NULL, "Zwischenstück" TEXT DEFAULT NULL,
    "Herstellungskosten" DOUBLE PRECISION DEFAULT 0, "Verkaufspreis" DOUBLE PRECISION DEFAULT 0,
    "Ausgelagert" INTEGER DEFAULT 0, "Verkauft" SMALLINT DEFAULT 0, "Ausschuss" SMALLINT DEFAULT 0,
    "Ausschuss_Grund" TEXT DEFAULT NULL, "Lieferschein_ID" INTEGER DEFAULT 0,
    "Rechnung_ID" INTEGER DEFAULT 0, "Foto" TEXT DEFAULT NULL,
    "Erstelldatum" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "Letzte_Änderung" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("Artikelnummer")
  );
  CREATE TABLE audit_log (
    id SERIAL PRIMARY KEY, table_name VARCHAR(255) NOT NULL,
    artikelnummer_id VARCHAR(20) DEFAULT NULL, column_name VARCHAR(255) DEFAULT NULL,
    old_value TEXT DEFAULT NULL, new_value TEXT DEFAULT NULL,
    action_type VARCHAR(10) NOT NULL, changed_by VARCHAR(255) DEFAULT NULL,
    change_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE app_users (
    id SERIAL PRIMARY KEY, username VARCHAR(100) NOT NULL UNIQUE, password_hash TEXT NOT NULL,
    email TEXT DEFAULT NULL, role VARCHAR(20) NOT NULL DEFAULT 'user',
    active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP DEFAULT NULL,
    CONSTRAINT app_users_role_check CHECK (role IN ('admin', 'user'))
  );

  INSERT INTO "Kunde" ("Name", "Strasse", "Hausnummer", "Ort", "PLZ")
    VALUES ('Online', 'Weg', 0, 'Ort', 12345), ('Laden', 'Gasse', 12, 'Ort', 12345);
  INSERT INTO "Schmuckstück" ("Artikelnummer", "Verkaufspreis", "Herstellungskosten", "Verkauft", "Ausschuss", "Foto")
    VALUES ('MHO1_1', 19.99, 5.555, 1, 1, 'alt.jpg'),
           ('MHO1_2', NULL, 3, 0, 0, NULL),
           ('MHO1_3', 40, 10, 1, 0, NULL);
  INSERT INTO audit_log
    (table_name, artikelnummer_id, column_name, old_value, new_value, action_type, changed_by, change_timestamp)
    VALUES ('Schmuckstück', 'MHO1_1', 'Verkauft', '0', '1', 'UPDATE', 'root', '2025-01-01 10:00:00'),
           ('Schmuckstück', 'MHO1_3', 'Verkauft', '0', '1', 'UPDATE', 'root', '2025-01-02 10:00:00');
  INSERT INTO app_users (username, password_hash, role) VALUES ('marina', 'x', 'admin');
  -- NOT VALID: Altbestand hat Ausschuss ohne Grund (Befund D7)
  ALTER TABLE "Schmuckstück" ADD CONSTRAINT schmuckstueck_ausschuss_grund_required_chk
    CHECK (COALESCE("Ausschuss", 0) = 0 OR LENGTH(BTRIM(COALESCE("Ausschuss_Grund", ''))) > 0) NOT VALID;
`;

describeDb('Migrationen gegen echte Datenbank', () => {
  const basisPool = BASIS_URL ? new Pool({ connectionString: BASIS_URL, max: 1 }) : null;
  const pools = [];
  let basisName;
  let backupDir;

  const dbUrl = (name) => {
    const url = new URL(BASIS_URL);
    url.pathname = `/${name}`;
    return url.toString();
  };

  async function neueDatenbank(suffix) {
    const name = `${basisName}_mig_${suffix}`;
    await basisPool.query(`DROP DATABASE IF EXISTS "${name}"`);
    await basisPool.query(`CREATE DATABASE "${name}"`);
    const url = dbUrl(name);
    const pool = new Pool({ connectionString: url, max: 2 });
    pools.push({ pool, name });
    return { pool, url };
  }

  const migriere = ({ pool, url }, env = { MIGRATION_SKIP_BACKUP: 'true' }) =>
    runMigrations({ pool, connectionString: url, env });

  const q = (pool) => (sql, params) => pool.query(sql, params);

  // Mit pg_dump echtes Backup in ein eigenes Verzeichnis, sonst Gate überspringen.
  const backupEnv = (name) => (pgDumpVorhanden()
    ? { MIGRATION_BACKUP_DIR: path.join(backupDir, name) }
    : { MIGRATION_SKIP_BACKUP: 'true' });

  beforeAll(async () => {
    ({ current_database: basisName } = (await basisPool.query('SELECT current_database()')).rows[0]);
    if (!/test/i.test(basisName)) {
      throw new Error(`Verweigert: "${basisName}" ist keine Testdatenbank (Name muss "test" enthalten).`);
    }
    backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-backup-'));
  });

  afterAll(async () => {
    for (const { pool, name } of pools) {
      await pool.end();
      await basisPool.query(`DROP DATABASE IF EXISTS "${name}"`);
    }
    await basisPool.end();
    fs.rmSync(backupDir, { recursive: true, force: true });
  });

  let a;
  let schemaA;

  it('(a) Neuinstallation: alle Migrationen laufen durch und legen den Admin an', async () => {
    a = await neueDatenbank('a');
    await migriere(a);

    schemaA = await schemaSnapshot(q(a.pool), { mitSpaltenreihenfolge: true });
    expect(schemaA.migrationen.map((m) => m.version)).toEqual(['0001', '0002', '0003', '0004', '0005']);
    const { rows } = await a.pool.query('SELECT username, must_change_password FROM app_users');
    expect(rows).toEqual([{ username: 'admin', must_change_password: true }]);
  });

  it('(b) init.sql + Migrationen ergibt dasselbe Schema wie (a), inklusive Spaltenreihenfolge', async () => {
    const b = await neueDatenbank('b');
    await b.pool.query(fs.readFileSync(INIT_SQL, 'utf8'));
    await migriere(b, backupEnv('b'));

    const schemaB = await schemaSnapshot(q(b.pool), { mitSpaltenreihenfolge: true });
    expect(schemaB).toEqual(schemaA);
  });

  it('(c) Bestandsdatenbank ohne schema_migrations: Backup, Umstellung, gleiches Schema', async () => {
    const c = await neueDatenbank('c');
    await c.pool.query(ALTBESTAND_SQL);

    const env = backupEnv('c');
    await migriere(c, env);

    if (!env.MIGRATION_SKIP_BACKUP) {
      const dateien = fs.readdirSync(env.MIGRATION_BACKUP_DIR);
      expect(dateien).toEqual([expect.stringMatching(/^vor_migration_0001_.*\.dump$/)]);
      expect(fs.statSync(path.join(env.MIGRATION_BACKUP_DIR, dateien[0])).size).toBeGreaterThan(0);
    }

    expect(await schemaSnapshot(q(c.pool))).toEqual(await schemaSnapshot(q(a.pool)));

    const stuecke = (await c.pool.query(`
      SELECT "Artikelnummer", "Verkauft", "Ausschuss", "Verkaufspreis", "Herstellungskosten"
      FROM "Schmuckstück" ORDER BY 1
    `)).rows;
    const stueck = (Artikelnummer, Verkauft, Ausschuss, Verkaufspreis, Herstellungskosten) =>
      ({ Artikelnummer, Verkauft, Ausschuss, Verkaufspreis, Herstellungskosten });
    expect(stuecke).toEqual([
      // Verkauft UND Ausschuss: Ausschuss gewinnt (Befund B6); Preise gerundet, NULL -> 0
      stueck('MHO1_1', false, true, '19.99', '5.56'),
      stueck('MHO1_2', false, false, '0.00', '3.00'),
      stueck('MHO1_3', true, false, '40.00', '10.00'),
    ]);
    const kunden = (await c.pool.query(
      'SELECT "Name", "Hausnummer", "Direktverkauf" FROM "Kunde" ORDER BY 1',
    )).rows;
    expect(kunden).toEqual([
      { Name: 'Laden', Hausnummer: '12', Direktverkauf: false },
      { Name: 'Online', Hausnummer: '', Direktverkauf: true },
    ]);
    // Vorhandene Benutzer bleiben, kein zusätzlicher Standard-Admin
    expect((await c.pool.query('SELECT username FROM app_users')).rows).toEqual([{ username: 'marina' }]);

    // Alt-Einträge nachverkettet, Kette intakt, Tamper-Schutz aktiv
    const audit = (await c.pool.query('SELECT id, hash FROM audit_log ORDER BY id')).rows;
    expect(audit).toHaveLength(2);
    expect(audit.every((r) => /^[0-9a-f]{64}$/.test(r.hash))).toBe(true);
    expect((await c.pool.query('SELECT * FROM verify_audit_chain()')).rows).toEqual([]);
    await expect(c.pool.query('DELETE FROM audit_log')).rejects.toThrow(/unveränderlich/);

    // Erneuter Lauf der kompletten Kette (schema_migrations verloren, z. B.
    // nach einem Teil-Restore): nichts ändert sich, kein Hash wird neu berechnet.
    await c.pool.query('UPDATE "Schmuckstück" SET "Verkauft" = FALSE WHERE "Artikelnummer" = \'MHO1_3\'');
    const hashesVorher = (await c.pool.query('SELECT id, previous_hash, hash FROM audit_log ORDER BY id')).rows;
    const schemaVorher = await schemaSnapshot(q(c.pool), { mitSpaltenreihenfolge: true });
    await c.pool.query('DROP TABLE schema_migrations');
    await migriere(c);

    expect((await c.pool.query('SELECT id, previous_hash, hash FROM audit_log ORDER BY id')).rows)
      .toEqual(hashesVorher);
    expect(await schemaSnapshot(q(c.pool), { mitSpaltenreihenfolge: true })).toEqual(schemaVorher);
    expect((await c.pool.query('SELECT * FROM verify_audit_chain()')).rows).toEqual([]);
  });

  it('erneuter Start ohne ausstehende Migration führt nichts aus und macht kein Backup', async () => {
    const execFileImpl = jest.fn();
    await runMigrations({ pool: a.pool, connectionString: a.url, env: {}, execFileImpl });

    expect(execFileImpl).not.toHaveBeenCalled();
    expect(await schemaSnapshot(q(a.pool), { mitSpaltenreihenfolge: true })).toEqual(schemaA);
  });
});
