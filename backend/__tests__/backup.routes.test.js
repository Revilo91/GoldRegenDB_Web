'use strict';

process.env.JWT_SECRET = 'test-secret-do-not-use-in-prod';

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
const path = require('path');
const fs = require('fs/promises');
const AdmZip = require('adm-zip');

const UPLOADS_DIR = path.resolve(__dirname, '../.tmp-test-uploads');
const TEST_FILE_NAME = 'JEST_TEST_UPLOAD_IMAGE.png';
const TEST_FILE_PATH = path.join(UPLOADS_DIR, TEST_FILE_NAME);

process.env.BACKUP_UPLOADS_DIR = UPLOADS_DIR;

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  // In der echten App ist /api/backup admin-geschützt. Für diese Route-Tests
  // injizieren wir einen Admin-Nutzer direkt.
  app.use((req, _res, next) => {
    req.user = { id: 1, username: 'admin', role: 'admin' };
    next();
  });

  const backupRouter = require('../src/routes/backup');
  app.use('/api/backup', backupRouter);
  return app;
}

describe('backup uploads zip routes', () => {
  let app;

  beforeAll(async () => {
    app = buildApp();
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(UPLOADS_DIR, { recursive: true, force: true });
  });

  afterEach(async () => {
    await fs.rm(TEST_FILE_PATH, { force: true });
  });

  it('POST /api/backup/import-uploads-zip returns 400 when no file is provided', async () => {
    const res = await request(app).post('/api/backup/import-uploads-zip');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ZIP-Datei/);
  });

  it('POST /api/backup/import-uploads-zip imports files from zip', async () => {
    const zip = new AdmZip();
    zip.addFile(TEST_FILE_NAME, Buffer.from('fake-image-content', 'utf8'));
    const zipBuffer = zip.toBuffer();

    const res = await request(app)
      .post('/api/backup/import-uploads-zip')
      .attach('uploadsZip', zipBuffer, {
        filename: 'uploads.zip',
        contentType: 'application/zip',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.uploads.restored).toBe(1);
    const written = await fs.readFile(TEST_FILE_PATH, 'utf8');
    expect(written).toBe('fake-image-content');
  });

  it('GET /api/backup/export-uploads returns zip content', async () => {
    await fs.writeFile(TEST_FILE_PATH, 'fake-image-content');

    const res = await request(app)
      .get('/api/backup/export-uploads')
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/zip');
    expect(res.headers['content-disposition']).toContain('goldregendb_uploads_');

    const zip = new AdmZip(res.body);
    const entries = zip.getEntries().map((e) => e.entryName);
    expect(entries).toContain(TEST_FILE_NAME);
  });
});

// ── Q10: Tabellenliste, Reihenfolge, Sequences, Hash-Trigger ───────────────
//
// Das Schema, das die Katalog-Abfragen im Test liefern: zehn Tabellen, sechs
// Fremdschlüssel – exakt wie die echte Datenbank es zurückgibt. `bestellung`,
// `bestellung_kunde` und `bestellung_consent` fehlten in der alten Handliste.
const KATALOG_TABELLEN = [
  'Kunde',
  'Lieferschein',
  'Rechnung',
  'Schmuckstück',
  'app_users',
  'audit_log',
  'bestellung',
  'bestellung_consent',
  'bestellung_kunde',
  'lagerinventur',
];

const KATALOG_FKS = [
  { kind: 'Lieferschein', eltern: 'Kunde' },
  { kind: 'Rechnung', eltern: 'Kunde' },
  { kind: 'bestellung', eltern: 'bestellung_kunde' },
  { kind: 'bestellung', eltern: 'Rechnung' },
  { kind: 'bestellung_consent', eltern: 'bestellung_kunde' },
  { kind: 'lagerinventur', eltern: 'app_users' },
];

const KATALOG_PKS = [
  { tabelle: 'Kunde', spalte: 'Name' },
  { tabelle: 'Lieferschein', spalte: 'Nummer' },
  { tabelle: 'Rechnung', spalte: 'Nummer' },
  { tabelle: 'Schmuckstück', spalte: 'Artikelnummer' },
  { tabelle: 'app_users', spalte: 'id' },
  { tabelle: 'audit_log', spalte: 'id' },
  { tabelle: 'bestellung', spalte: 'id' },
  { tabelle: 'bestellung_consent', spalte: 'id' },
  { tabelle: 'bestellung_kunde', spalte: 'id' },
  { tabelle: 'lagerinventur', spalte: 'id' },
];

// Spalten je Tabelle – daraus leitet der Handler die Sequences (hat_sequenz)
// und die als Text zu exportierenden Zeitspalten ab.
const spalte = (tabelle, spalte, typ = 'text', hat_sequenz = false) => ({
  tabelle,
  spalte,
  typ,
  hat_sequenz,
});

const KATALOG_SPALTEN = [
  spalte('Kunde', 'ID', 'integer', true),
  spalte('Kunde', 'Name'),
  spalte('Lieferschein', 'ID', 'integer', true),
  spalte('Lieferschein', 'Nummer'),
  spalte('Lieferschein', 'Datum', 'timestamp without time zone'),
  spalte('Rechnung', 'ID', 'integer', true),
  spalte('Rechnung', 'Nummer'),
  spalte('Schmuckstück', 'Artikelnummer'),
  spalte('Schmuckstück', 'Verkaufspreis', 'numeric'),
  spalte('Schmuckstück', 'Letzte_Änderung', 'timestamp without time zone'),
  spalte('app_users', 'id', 'integer', true),
  spalte('audit_log', 'id', 'integer', true),
  spalte('audit_log', 'change_timestamp', 'timestamp without time zone'),
  spalte('audit_log', 'hash'),
  spalte('bestellung', 'id', 'integer', true),
  spalte('bestellung', 'wunschdatum', 'date'),
  spalte('bestellung_consent', 'id', 'integer', true),
  spalte('bestellung_kunde', 'id', 'integer', true),
  spalte('bestellung_kunde', 'name_enc', 'bytea'),
  spalte('lagerinventur', 'id', 'integer', true),
];

// Antwortet auf die Katalogabfragen wie die echte Datenbank; alles andere
// bekommt ein leeres Resultat. Spaltenlisten für den Import kommen aus
// information_schema.columns, dieselbe Abfrage nutzt der Handler auch für die
// Sequenzspalten – unterschieden wird über das Fragment 'nextval'.
function katalogAntwort(sql) {
  const text = String(sql);
  if (text.includes("c.relkind = 'r'")) {
    return { rows: KATALOG_TABELLEN.map((name) => ({ name })), rowCount: KATALOG_TABELLEN.length };
  }
  if (text.includes("k.contype = 'f'")) {
    return { rows: KATALOG_FKS, rowCount: KATALOG_FKS.length };
  }
  if (text.includes("'PRIMARY KEY'")) {
    return { rows: KATALOG_PKS, rowCount: KATALOG_PKS.length };
  }
  if (text.includes("column_default LIKE 'nextval%'")) {
    return { rows: KATALOG_SPALTEN, rowCount: KATALOG_SPALTEN.length };
  }
  if (text.includes('NOT c.convalidated')) {
    return { rows: [], rowCount: 0 };
  }
  return null;
}

describe('GET /api/backup/export', () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    db.query.mockReset();
    db.query.mockImplementation(async (sql) => {
      const katalog = katalogAntwort(sql);
      if (katalog) return katalog;
      return { rows: [], rowCount: 0 };
    });
  });

  it('exportiert alle Tabellen aus dem Katalog, inklusive der Bestelltabellen', async () => {
    const res = await request(app).get('/api/backup/export');

    expect(res.status).toBe(200);
    // Befund B18: die alte Handliste kannte diese drei nicht.
    expect(Object.keys(res.body.tables)).toEqual(
      expect.arrayContaining(['bestellung', 'bestellung_kunde', 'bestellung_consent']),
    );
    expect(Object.keys(res.body.tables)).toHaveLength(KATALOG_TABELLEN.length);
  });

  it('sortiert jeden SELECT nach dem Primärschlüssel (Befund B19)', async () => {
    await request(app).get('/api/backup/export');

    const selects = db.query.mock.calls
      .map((c) => String(c[0]))
      .filter((sql) => / FROM "[^"]+" ORDER BY /.test(sql));

    expect(selects).toHaveLength(KATALOG_TABELLEN.length);
    expect(selects.every((sql) => sql.includes('ORDER BY'))).toBe(true);
    expect(selects).toContain(
      'SELECT "id", "change_timestamp"::text AS "change_timestamp", "hash" ' +
        'FROM "audit_log" ORDER BY "id"',
    );
    expect(
      selects.find((sql) => sql.includes('FROM "Schmuckstück"')),
    ).toContain('ORDER BY "Artikelnummer"');
  });

  it('exportiert Zeitspalten als Text, damit Mikrosekunden erhalten bleiben', async () => {
    await request(app).get('/api/backup/export');

    const selects = db.query.mock.calls
      .map((c) => String(c[0]))
      .filter((sql) => sql.startsWith('SELECT "'));

    // node-postgres liefert timestamp als JS-Date (Millisekunden). Ohne ::text
    // verlor der Export die Mikrosekunden und der Audit-Hash stimmte nach dem
    // Import nicht mehr – gemessen 29 hash_mismatch von 4368 Zeilen.
    const audit = selects.find((sql) => sql.includes('FROM "audit_log"'));
    expect(audit).toContain('"change_timestamp"::text AS "change_timestamp"');
    const bestellung = selects.find((sql) => sql.includes('FROM "bestellung"'));
    expect(bestellung).toContain('"wunschdatum"::text AS "wunschdatum"');

    // Nicht-Zeitspalten bleiben unangetastet.
    expect(audit).toContain('"hash"');
    expect(audit).not.toContain('"hash"::text');
  });

  it('beschränkt sich auf die angefragten Tabellen', async () => {
    const res = await request(app).get('/api/backup/export?tables=Kunde,bestellung');

    expect(Object.keys(res.body.tables).sort()).toEqual(['Kunde', 'bestellung']);
  });
});

describe('POST /api/backup/import', () => {
  let app;
  let client;

  const backupMit = (tabellen) => ({
    backupData: { version: '1.0', tables: tabellen },
  });

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    client = {
      query: jest.fn(async (sql) => {
        const text = String(sql);
        const katalog = katalogAntwort(text);
        if (katalog) return katalog;
        // Spaltenliste je Tabelle für insertRows
        if (text.includes('FROM information_schema.columns')) {
          return {
            rows: [
              { column_name: 'id' },
              { column_name: 'ID' },
              { column_name: 'Name' },
              { column_name: 'name_enc' },
            ],
            rowCount: 4,
          };
        }
        if (text.includes('FROM pg_trigger')) return { rows: [{ '?column?': 1 }], rowCount: 1 };
        if (text.includes('verify_audit_chain')) return { rows: [], rowCount: 0 };
        if (text.includes('proname')) return { rows: [{ '?column?': 1 }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }),
      release: jest.fn(),
    };
    db.connect.mockReset();
    db.connect.mockResolvedValue(client);
  });

  const verlauf = () => client.query.mock.calls.map((c) => String(c[0]));

  it('fügt Eltern vor Kindern ein (topologisch, nicht geraten)', async () => {
    const res = await request(app)
      .post('/api/backup/import')
      .send(
        backupMit({
          bestellung: [{ id: 1 }],
          bestellung_kunde: [{ id: 1 }],
          Kunde: [{ ID: 1, Name: 'A' }],
          Rechnung: [{ ID: 1 }],
        }),
      );

    expect(res.status).toBe(200);
    const inserts = verlauf().filter((sql) => sql.startsWith('INSERT INTO'));
    const pos = (t) => inserts.findIndex((sql) => sql.includes(`INSERT INTO "${t}"`));
    expect(pos('Kunde')).toBeGreaterThanOrEqual(0);
    expect(pos('Kunde')).toBeLessThan(pos('Rechnung'));
    expect(pos('bestellung_kunde')).toBeLessThan(pos('bestellung'));
    expect(pos('Rechnung')).toBeLessThan(pos('bestellung'));
  });

  it('zieht auch die lagerinventur-Sequence nach (Befund B17)', async () => {
    await request(app)
      .post('/api/backup/import')
      .send(backupMit({ lagerinventur: [{ id: 7 }], app_users: [{ id: 1 }] }));

    const setvals = client.query.mock.calls
      .filter((c) => String(c[0]).includes('setval'))
      .map((c) => c[1][0]);

    // Die alte Handliste kannte nur app_users, audit_log, Kunde,
    // Lieferschein und Rechnung – lagerinventur lief danach in duplicate key.
    expect(setvals).toContain('"lagerinventur"');
    expect(setvals).toContain('"app_users"');
  });

  it('schaltet den Audit-Hash-Trigger um die Inserts herum ab (Befund B19)', async () => {
    await request(app)
      .post('/api/backup/import')
      .send(backupMit({ audit_log: [{ id: 1 }] }));

    const sqls = verlauf();
    const aus = sqls.findIndex((s) => s.includes('DISABLE TRIGGER trg_audit_log_hash_chain'));
    const insert = sqls.findIndex((s) => s.includes('INSERT INTO "audit_log"'));
    const an = sqls.findIndex((s) => s.includes('ENABLE TRIGGER trg_audit_log_hash_chain'));

    expect(aus).toBeGreaterThanOrEqual(0);
    expect(aus).toBeLessThan(insert);
    expect(insert).toBeLessThan(an);
    expect(an).toBeLessThan(sqls.lastIndexOf('COMMIT'));
  });

  it('benennt, was TRUNCATE CASCADE zusätzlich leert', async () => {
    const res = await request(app)
      .post('/api/backup/import')
      .send({
        backupData: { version: '1.0', tables: { Kunde: [{ ID: 1, Name: 'A' }] } },
        selectedTables: ['Kunde'],
      });

    expect(res.status).toBe(200);
    // Kunde -> Lieferschein/Rechnung -> bestellung: still geleert, jetzt benannt.
    expect(res.body.kaskadierteTabellen).toEqual([
      'Lieferschein',
      'Rechnung',
      'bestellung',
    ]);
  });

  it('meldet Tabellen aus dem Backup, die es im Schema nicht gibt', async () => {
    const res = await request(app)
      .post('/api/backup/import')
      .send(backupMit({ Kunde: [{ ID: 1, Name: 'A' }], alte_tabelle: [{ id: 1 }] }));

    expect(res.status).toBe(200);
    expect(res.body.ignorierteTabellen).toEqual(['alte_tabelle']);
    expect(Object.keys(res.body.counts)).toEqual(['Kunde']);
  });

  it('rollt zurück und meldet den ursprünglichen Fehler, wenn ein INSERT scheitert', async () => {
    client.query.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.startsWith('INSERT INTO')) throw new Error('Testfehler beim Insert');
      const katalog = katalogAntwort(text);
      if (katalog) return katalog;
      if (text.includes('FROM information_schema.columns')) {
        return { rows: [{ column_name: 'ID' }, { column_name: 'Name' }], rowCount: 2 };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .post('/api/backup/import')
      .send(backupMit({ Kunde: [{ ID: 1, Name: 'A' }] }));

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Testfehler beim Insert/);
    expect(verlauf()).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});

// ── Restore: Datenbereinigung, Formate, Batches, Constraints ───────────────
describe('POST /api/backup/import – Daten und Constraints', () => {
  let app;
  let client;
  let spaltenJeTabelle;
  let nichtValidierteChecks;
  let auditPruefung;

  const backupMit = (tabellen) => ({
    backupData: { version: '1.0', tables: tabellen },
  });
  const verlauf = () => client.query.mock.calls.map((c) => String(c[0]));
  const inserts = (tabelle) =>
    client.query.mock.calls.filter((c) =>
      String(c[0]).startsWith(`INSERT INTO "${tabelle}"`),
    );

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    spaltenJeTabelle = {
      Schmuckstück: ['Artikelnummer', 'Verkauft', 'Ausschuss', 'Ausgelagert'],
      Kunde: ['ID', 'Name'],
      bestellung_kunde: ['id', 'name_enc'],
    };
    nichtValidierteChecks = [];
    auditPruefung = [];
    client = {
      query: jest.fn(async (sql, params) => {
        const text = String(sql);
        if (text.includes('NOT c.convalidated')) {
          return { rows: nichtValidierteChecks, rowCount: nichtValidierteChecks.length };
        }
        const katalog = katalogAntwort(text);
        if (katalog) return katalog;
        if (text.includes('FROM information_schema.columns')) {
          const rows = (spaltenJeTabelle[params[0]] || []).map((column_name) => ({ column_name }));
          return { rows, rowCount: rows.length };
        }
        if (text.includes('FROM pg_trigger')) return { rows: [{ x: 1 }], rowCount: 1 };
        if (text.includes('FROM pg_proc')) return { rows: [{ x: 1 }], rowCount: 1 };
        if (text.includes('verify_audit_chain()')) {
          return { rows: auditPruefung, rowCount: auditPruefung.length };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: jest.fn(),
    };
    db.connect.mockReset();
    db.connect.mockResolvedValue(client);
  });

  describe('Statuswiderspruch Verkauft ∧ Ausschuss (schmuck_status_chk)', () => {
    // Entscheidungstabelle: Verkauft × Ausschuss × Schreibweise
    it.each([
      ['boolean', true, true, false, true],
      ['0/1-Zahl', 1, 1, false, 1],
      ['Text "1"', '1', '1', false, '1'],
    ])('Ausschuss gewinnt bei Verkauft ∧ Ausschuss (%s)', async (_n, verkauft, ausschuss, erwV, erwA) => {
      const res = await request(app)
        .post('/api/backup/import')
        .send(backupMit({ Schmuckstück: [{ Artikelnummer: 'A1', Verkauft: verkauft, Ausschuss: ausschuss, Ausgelagert: 0 }] }));

      expect(res.status).toBe(200);
      // Spaltenreihenfolge im INSERT: Artikelnummer, Verkauft, Ausschuss, Ausgelagert
      expect(inserts('Schmuckstück')[0][1]).toEqual(['A1', erwV, erwA, 0]);
    });

    it.each([
      ['nur verkauft', { Verkauft: true, Ausschuss: false }],
      ['nur Ausschuss', { Verkauft: false, Ausschuss: true }],
      ['weder noch', { Verkauft: false, Ausschuss: false }],
    ])('lässt konsistente Zeilen unverändert (%s)', async (_n, status) => {
      await request(app)
        .post('/api/backup/import')
        .send(backupMit({ Schmuckstück: [{ Artikelnummer: 'A1', ...status, Ausgelagert: 0 }] }));

      expect(inserts('Schmuckstück')[0][1]).toEqual(['A1', status.Verkauft, status.Ausschuss, 0]);
    });

    it('korrigiert nur die widersprüchlichen Zeilen eines Batches', async () => {
      await request(app)
        .post('/api/backup/import')
        .send(
          backupMit({
            Schmuckstück: [
              { Artikelnummer: 'A1', Verkauft: true, Ausschuss: true, Ausgelagert: 0 },
              { Artikelnummer: 'A2', Verkauft: true, Ausschuss: false, Ausgelagert: 0 },
            ],
          }),
        );

      expect(inserts('Schmuckstück')[0][1]).toEqual([
        'A1', false, true, 0,
        'A2', true, false, 0,
      ]);
    });

    it('fasst andere Tabellen nicht an', async () => {
      spaltenJeTabelle.Kunde = ['ID', 'Name', 'Verkauft', 'Ausschuss'];
      await request(app)
        .post('/api/backup/import')
        .send(backupMit({ Kunde: [{ ID: 1, Name: 'A', Verkauft: true, Ausschuss: true }] }));

      expect(inserts('Kunde')[0][1]).toEqual([1, 'A', true, true]);
    });
  });

  describe('NOT-VALID-Constraints', () => {
    const notValid = {
      tabelle: '"Schmuckstück"',
      name: 'schmuckstueck_ausschuss_grund_required_chk',
      definition: 'CHECK ((NOT "Ausschuss") OR ("Ausschuss_Grund" IS NOT NULL)) NOT VALID',
    };

    it('löst sie vor den Inserts und legt sie danach wieder als NOT VALID an', async () => {
      nichtValidierteChecks = [notValid];

      const res = await request(app)
        .post('/api/backup/import')
        .send(backupMit({ Schmuckstück: [{ Artikelnummer: 'A1', Verkauft: false, Ausschuss: false, Ausgelagert: 0 }] }));

      const sqls = verlauf();
      const drop = sqls.findIndex((s) => s.includes('DROP CONSTRAINT "schmuckstueck_ausschuss_grund_required_chk"'));
      const insert = sqls.findIndex((s) => s.startsWith('INSERT INTO "Schmuckstück"'));
      const add = sqls.findIndex((s) => s.includes('ADD CONSTRAINT "schmuckstueck_ausschuss_grund_required_chk"'));

      expect(res.body.geloesteChecks).toEqual(['schmuckstueck_ausschuss_grund_required_chk']);
      expect(drop).toBeGreaterThanOrEqual(0);
      expect(drop).toBeLessThan(insert);
      expect(insert).toBeLessThan(add);
      expect(add).toBeLessThan(sqls.lastIndexOf('COMMIT'));
      expect(sqls[add]).toMatch(/NOT VALID$/);
    });

    it('hängt NOT VALID an, wenn die Definition es nicht enthält', async () => {
      nichtValidierteChecks = [{ ...notValid, definition: 'CHECK (("Ausschuss" IS NOT NULL))' }];

      await request(app)
        .post('/api/backup/import')
        .send(backupMit({ Schmuckstück: [{ Artikelnummer: 'A1', Verkauft: false, Ausschuss: false, Ausgelagert: 0 }] }));

      const add = verlauf().find((s) => s.includes('ADD CONSTRAINT'));
      expect(add).toMatch(/NOT VALID$/);
    });

    it('löst nichts, wenn keine NOT-VALID-Checks existieren', async () => {
      const res = await request(app)
        .post('/api/backup/import')
        .send(backupMit({ Kunde: [{ ID: 1, Name: 'A' }] }));

      expect(res.body.geloesteChecks).toEqual([]);
      expect(verlauf().some((s) => s.includes('DROP CONSTRAINT'))).toBe(false);
    });

    it('lässt validierte Checks in Kraft (Abfrage filtert auf NOT convalidated)', async () => {
      await request(app).post('/api/backup/import').send(backupMit({ Kunde: [{ ID: 1, Name: 'A' }] }));

      const abfrage = client.query.mock.calls.find((c) => String(c[0]).includes('NOT c.convalidated'));
      expect(abfrage[1][0]).toEqual(['Kunde']);
    });
  });

  describe('Insert-Mechanik', () => {
    it('teilt große Tabellen in Batches zu je 100 Zeilen', async () => {
      const zeilen = Array.from({ length: 250 }, (_, i) => ({ ID: i + 1, Name: `K${i}` }));

      const res = await request(app).post('/api/backup/import').send(backupMit({ Kunde: zeilen }));

      const batches = inserts('Kunde');
      expect(batches.map((c) => c[1].length)).toEqual([200, 200, 100]); // 2 Spalten je Zeile
      expect(res.body.counts.Kunde).toBe(250);
    });

    it('ignoriert Spalten, die das aktuelle Schema nicht kennt', async () => {
      await request(app)
        .post('/api/backup/import')
        .send(backupMit({ Kunde: [{ ID: 1, Name: 'A', alte_spalte: 'x' }] }));

      const [sql, werte] = inserts('Kunde')[0];
      expect(sql).not.toContain('alte_spalte');
      expect(werte).toEqual([1, 'A']);
    });

    it('stellt JSON-serialisierte Buffer (bytea) wieder her', async () => {
      await request(app)
        .post('/api/backup/import')
        .send(backupMit({ bestellung_kunde: [{ id: 1, name_enc: { type: 'Buffer', data: [1, 2, 3] } }] }));

      const werte = inserts('bestellung_kunde')[0][1];
      expect(Buffer.isBuffer(werte[1])).toBe(true);
      expect([...werte[1]]).toEqual([1, 2, 3]);
    });

    it('leert und importiert nur die gewählten Tabellen', async () => {
      await request(app)
        .post('/api/backup/import')
        .send({
          backupData: { version: '1.0', tables: { Kunde: [{ ID: 1, Name: 'A' }], bestellung_kunde: [{ id: 1 }] } },
          selectedTables: ['bestellung_kunde'],
        });

      expect(inserts('Kunde')).toHaveLength(0);
      expect(inserts('bestellung_kunde')).toHaveLength(1);
      const truncate = verlauf().find((s) => s.startsWith('TRUNCATE'));
      expect(truncate).toContain('"bestellung_kunde"');
      expect(truncate).not.toContain('"Kunde"');
    });

    it('TRUNCATE steht vor dem ersten INSERT, COMMIT als letztes', async () => {
      await request(app).post('/api/backup/import').send(backupMit({ Kunde: [{ ID: 1, Name: 'A' }] }));

      const sqls = verlauf();
      expect(sqls[0]).toBe('BEGIN');
      expect(sqls.findIndex((s) => s.startsWith('TRUNCATE'))).toBeLessThan(
        sqls.findIndex((s) => s.startsWith('INSERT INTO')),
      );
      expect(sqls[sqls.length - 1]).toBe('COMMIT');
    });

    it('importiert ein leeres Backup ohne TRUNCATE und ohne Fehler', async () => {
      const res = await request(app).post('/api/backup/import').send(backupMit({}));

      expect(res.status).toBe(200);
      expect(res.body.counts).toEqual({});
      expect(verlauf().some((s) => s.startsWith('TRUNCATE'))).toBe(false);
    });
  });

  describe('Backup-Formate', () => {
    // Nur das Standard-Backup in der backupData-Hülle wird angenommen; das
    // direkte Format, das SQL-Export-Array und JSON-Strings gibt es nicht mehr.
    it.each([
      ['direktes Format ohne backupData-Hülle', { version: '1.0', tables: { Kunde: [] } }],
      ['SQL-Export-Array', { backupData: [{ type: 'table', name: 'Kunde', data: [] }] }],
      ['JSON-String', { backupData: JSON.stringify({ version: '1.0', tables: {} }) }],
    ])('lehnt %s an der Validierung ab', async (_n, body) => {
      const res = await request(app).post('/api/backup/import').send(body);

      expect(res.status).toBe(400);
      expect(db.connect).not.toHaveBeenCalled();
    });

    it.each([
      ['ohne version', { backupData: { tables: { Kunde: [] } } }],
      ['ohne tables', { backupData: { version: '1.0' } }],
      ['tables kein Objekt', { backupData: { version: '1.0', tables: 'x' } }],
    ])('weist ein ungültiges Format ab (%s)', async (_n, body) => {
      const res = await request(app).post('/api/backup/import').send(body);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Ungültiges Backup-Format/);
      expect(db.connect).not.toHaveBeenCalled();
    });
  });

  describe('Audit-Kette und Fehlerpfade', () => {
    it('meldet eine gebrochene Audit-Kette, ohne den Import abzubrechen', async () => {
      auditPruefung = [{ id: 5, problem: 'hash_mismatch' }];

      const res = await request(app)
        .post('/api/backup/import')
        .send(backupMit({ audit_log: [{ id: 1 }] }));

      expect(res.status).toBe(200);
      expect(res.body.auditKette).toEqual({ gueltig: false, kaputteEintraege: auditPruefung });
    });

    it('meldet eine intakte Audit-Kette als gültig', async () => {
      const res = await request(app)
        .post('/api/backup/import')
        .send(backupMit({ audit_log: [{ id: 1 }] }));

      expect(res.body.auditKette).toEqual({ gueltig: true, kaputteEintraege: [] });
    });

    it('liefert die ursprüngliche Meldung, wenn auch das ROLLBACK scheitert', async () => {
      client.query.mockImplementation(async (sql) => {
        const text = String(sql);
        if (text.startsWith('INSERT INTO')) throw new Error('Insert kaputt');
        if (text === 'ROLLBACK') throw new Error('Verbindung weg');
        if (text.includes('FROM information_schema.columns')) {
          return { rows: [{ column_name: 'ID' }, { column_name: 'Name' }], rowCount: 2 };
        }
        return katalogAntwort(text) || { rows: [], rowCount: 0 };
      });

      const res = await request(app)
        .post('/api/backup/import')
        .send(backupMit({ Kunde: [{ ID: 1, Name: 'A' }] }));

      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/Insert kaputt/);
      expect(client.release).toHaveBeenCalled();
    });

    it('gibt die Verbindung auch bei Erfolg frei', async () => {
      await request(app).post('/api/backup/import').send(backupMit({ Kunde: [{ ID: 1, Name: 'A' }] }));

      expect(client.release).toHaveBeenCalledTimes(1);
    });
  });
});
