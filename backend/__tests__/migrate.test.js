'use strict';

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));
jest.mock('bcryptjs', () => ({ hash: jest.fn().mockResolvedValue('$2b$10$testhash') }));

const fs = require('fs');
const os = require('os');
const path = require('path');
const logger = require('../src/utils/logger');
const { runMigrations, loadMigrations, MIGRATION_LOCK_KEY } = require('../src/config/migrate');

const DB_URL = 'postgresql://goldregen:geh%40eim@db:5432/goldregendb';

let tmp;
let migrationsDir;
let backupDir;

function schreibeMigrationen(dateien) {
  for (const [name, sql] of Object.entries(dateien)) {
    fs.writeFileSync(path.join(migrationsDir, name), sql);
  }
}

// Client-Attrappe: beantwortet die Runner-Abfragen und protokolliert jedes SQL.
function fakeClient({ bestand = false, applied = [], adminCount = 1, failOn = null } = {}) {
  const sqls = [];
  const listeners = {};
  const client = {
    sqls,
    on: jest.fn((event, fn) => { listeners[event] = fn; }),
    removeListener: jest.fn(),
    release: jest.fn(),
    emit: (event, payload) => listeners[event](payload),
    query: jest.fn(async (sql) => {
      sqls.push(sql);
      if (failOn && sql.includes(failOn)) throw new Error('syntax error at or near "KAPUTT"');
      if (sql.includes('information_schema.tables')) return { rows: [{ vorhanden: bestand }] };
      if (sql.startsWith('SELECT version FROM schema_migrations')) {
        return { rows: applied.map((version) => ({ version })) };
      }
      if (sql.includes('COUNT(*) AS cnt FROM app_users')) return { rows: [{ cnt: String(adminCount) }] };
      return { rows: [] };
    }),
  };
  return client;
}

const poolFuer = (client) => ({ connect: jest.fn().mockResolvedValue(client) });

const execOk = () => jest.fn((cmd, args, opts, cb) => cb(null, '', ''));

function starte(client, { env = { MIGRATION_BACKUP_DIR: backupDir }, execFileImpl = execOk() } = {}) {
  return runMigrations({
    pool: poolFuer(client),
    connectionString: DB_URL,
    env,
    migrationsDir,
    execFileImpl,
  });
}

const ausgefuehrt = (client, marker) => client.sqls.filter((s) => s.includes(marker));

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'));
  migrationsDir = path.join(tmp, 'migrations');
  backupDir = path.join(tmp, 'backups');
  fs.mkdirSync(migrationsDir);
  schreibeMigrationen({
    '0001_baseline.sql': 'CREATE TABLE eins (id int); -- M1',
    '0002_zweite.sql': 'ALTER TABLE eins ADD COLUMN x int; -- M2',
    'README.md': 'keine Migration',
  });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('loadMigrations', () => {
  it('liest nur nummerierte .sql-Dateien, sortiert nach Version', () => {
    schreibeMigrationen({ '0010_spaeter.sql': '-- M10' });
    expect(loadMigrations(migrationsDir).map((m) => [m.version, m.name]))
      .toEqual([['0001', 'baseline'], ['0002', 'zweite'], ['0010', 'spaeter']]);
  });

  it('bricht bei doppelt vergebener Versionsnummer ab', () => {
    schreibeMigrationen({ '0002_doppelt.sql': '-- M2b' });
    expect(() => loadMigrations(migrationsDir)).toThrow(/0002 ist doppelt vergeben/);
  });

  it('die mitgelieferten Migrationen sind lückenlos nummeriert', () => {
    const versionen = loadMigrations().map((m) => Number(m.version));
    expect(versionen[0]).toBe(1);
    versionen.forEach((v, i) => expect(v).toBe(i + 1));
  });
});

describe('runMigrations', () => {
  it('Neuinstallation: wendet alle Migrationen je in eigener Transaktion an, ohne Backup', async () => {
    const client = fakeClient({ bestand: false, adminCount: 0 });
    const execFileImpl = execOk();

    await starte(client, { execFileImpl });

    expect(execFileImpl).not.toHaveBeenCalled();
    const eintrag = 'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)';
    const relevant = /^(BEGIN|COMMIT|INSERT INTO schema|CREATE TABLE eins|ALTER TABLE eins)/;
    const ablauf = client.sqls.filter((s) => relevant.test(s));
    expect(ablauf).toEqual([
      'BEGIN', 'CREATE TABLE eins (id int); -- M1', eintrag, 'COMMIT',
      'BEGIN', 'ALTER TABLE eins ADD COLUMN x int; -- M2', eintrag, 'COMMIT',
    ]);
    expect(client.query).toHaveBeenCalledWith(eintrag, ['0001', 'baseline']);
    expect(client.query).toHaveBeenCalledWith(eintrag, ['0002', 'zweite']);
    expect(ausgefuehrt(client, 'INSERT INTO app_users')).toHaveLength(1);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('hält den Advisory-Lock über den gesamten Lauf und gibt ihn wieder frei', async () => {
    const client = fakeClient();

    await starte(client);

    expect(client.sqls[0]).toBe('SELECT pg_advisory_lock($1)');
    expect(client.query).toHaveBeenCalledWith('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    expect(client.query).toHaveBeenLastCalledWith('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
  });

  it('Bestandsdatenbank ohne schema_migrations: erst pg_dump, dann alle Migrationen', async () => {
    const client = fakeClient({ bestand: true });
    const reihenfolge = [];
    const execFileImpl = jest.fn((cmd, args, opts, cb) => { reihenfolge.push('pg_dump'); cb(null, '', ''); });
    const originalQuery = client.query.getMockImplementation();
    client.query.mockImplementation(async (sql, params) => {
      if (sql === 'BEGIN') reihenfolge.push('BEGIN');
      return originalQuery(sql, params);
    });

    await starte(client, { execFileImpl });

    expect(reihenfolge).toEqual(['pg_dump', 'BEGIN', 'BEGIN']);
    const [cmd, args, opts] = execFileImpl.mock.calls[0];
    expect(cmd).toBe('pg_dump');
    expect(args[0]).toBe('--format=custom');
    expect(args[1]).toMatch(new RegExp(`^--file=${backupDir}/vor_migration_0001_.*\\.dump$`));
    // Passwort nie in der Kommandozeile, sondern dekodiert in PGPASSWORD
    expect(args[2]).toBe('--dbname=postgresql://goldregen@db:5432/goldregendb');
    expect(args.join(' ')).not.toContain('geh');
    expect(opts.env.PGPASSWORD).toBe('geh@eim');
    expect(fs.existsSync(backupDir)).toBe(true);
  });

  it('teilweise migrierter Bestand: nur ausstehende Versionen, Backup nach erster ausstehender benannt', async () => {
    const client = fakeClient({ bestand: true, applied: ['0001'] });
    const execFileImpl = execOk();

    await starte(client, { execFileImpl });

    expect(execFileImpl.mock.calls[0][1][1]).toMatch(/vor_migration_0002_/);
    expect(ausgefuehrt(client, '-- M1')).toHaveLength(0);
    expect(ausgefuehrt(client, '-- M2')).toHaveLength(1);
  });

  it('erneuter Lauf ohne ausstehende Migration: nichts ausgeführt, kein Backup', async () => {
    const client = fakeClient({ bestand: true, applied: ['0001', '0002'] });
    const execFileImpl = execOk();

    await starte(client, { execFileImpl });

    expect(execFileImpl).not.toHaveBeenCalled();
    expect(ausgefuehrt(client, 'BEGIN')).toHaveLength(0);
    expect(logger.info).toHaveBeenCalledWith('MIGRATION', 'Schema aktuell, keine Migration ausstehend');
  });

  it('warnt, wenn die Datenbank Versionen kennt, die dieser Code nicht hat', async () => {
    const client = fakeClient({ bestand: true, applied: ['0001', '0002', '0003'] });

    await starte(client);

    expect(logger.warn).toHaveBeenCalledWith(
      'MIGRATION', expect.stringContaining('älteres Image'), { versionen: ['0003'] },
    );
  });

  it('Fehler in einer Migration: ROLLBACK, kein Eintrag, Abbruch mit Versionsangabe', async () => {
    const client = fakeClient({ failOn: '-- M2', adminCount: 0 });

    await expect(starte(client)).rejects.toThrow(
      'Migration 0002_zweite fehlgeschlagen und zurückgerollt: syntax error at or near "KAPUTT"',
    );

    expect(client.sqls.filter((s) => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(s)))
      .toEqual(['BEGIN', 'COMMIT', 'BEGIN', 'ROLLBACK']);
    expect(client.query).not.toHaveBeenCalledWith(expect.anything(), ['0002', 'zweite']);
    expect(ausgefuehrt(client, 'INSERT INTO app_users')).toHaveLength(0);
    expect(client.query).toHaveBeenLastCalledWith('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('Backup fehlgeschlagen: Abbruch vor der ersten Migration, halber Dump wird entfernt', async () => {
    const client = fakeClient({ bestand: true });
    const execFileImpl = jest.fn((cmd, args, opts, cb) => {
      fs.writeFileSync(args[1].slice('--file='.length), 'halb');
      const err = Object.assign(new Error('Command failed'), { code: 1 });
      cb(err, '', 'pg_dump: error: connection refused\n');
    });

    await expect(starte(client, { execFileImpl })).rejects.toThrow(
      /Backup vor der Migration fehlgeschlagen.*pg_dump: error: connection refused.*MIGRATION_SKIP_BACKUP/s,
    );

    expect(ausgefuehrt(client, 'BEGIN')).toHaveLength(0);
    expect(fs.readdirSync(backupDir)).toEqual([]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('pg_dump fehlt im Image: klare Meldung und Abbruch', async () => {
    const client = fakeClient({ bestand: true });
    const enoent = Object.assign(new Error('spawn pg_dump ENOENT'), { code: 'ENOENT' });
    const execFileImpl = jest.fn((cmd, args, opts, cb) => cb(enoent));

    await expect(starte(client, { execFileImpl })).rejects.toThrow(/pg_dump nicht gefunden/);
    expect(ausgefuehrt(client, 'BEGIN')).toHaveLength(0);
  });

  it('ohne Datenbank-URL kein Backup möglich: Abbruch', async () => {
    const client = fakeClient({ bestand: true });

    await expect(runMigrations({
      pool: poolFuer(client), connectionString: undefined, env: {}, migrationsDir, execFileImpl: execOk(),
    })).rejects.toThrow(/keine Datenbank-URL konfiguriert/);
  });

  it('MIGRATION_SKIP_BACKUP=true: kein pg_dump, Warnung, Migrationen laufen', async () => {
    const client = fakeClient({ bestand: true });
    const execFileImpl = execOk();

    await starte(client, { env: { MIGRATION_SKIP_BACKUP: 'true' }, execFileImpl });

    expect(execFileImpl).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('MIGRATION', expect.stringContaining('MIGRATION_SKIP_BACKUP=true'));
    expect(ausgefuehrt(client, 'COMMIT')).toHaveLength(2);
  });

  it('legt keinen Standard-Admin an, wenn Benutzer existieren', async () => {
    const client = fakeClient({ adminCount: 3 });

    await starte(client);

    expect(ausgefuehrt(client, 'INSERT INTO app_users')).toHaveLength(0);
  });

  it('reicht RAISE NOTICE/WARNING der Migrationen an den Logger weiter, DDL-Hinweise nur als Debug', async () => {
    const client = fakeClient({ applied: ['0001', '0002'] });

    await starte(client);
    client.emit('notice', { severity: 'NOTICE', code: '00000', message: 'Statusfelder umgestellt' });
    client.emit('notice', { severity: 'WARNING', code: '01000', message: 'Kleinbuchstaben im Bestand' });
    client.emit('notice', { severity: 'NOTICE', code: '42P07', message: 'relation already exists, skipping' });
    client.emit('notice', { severity: 'NOTICE', code: '00000', message: 'index "x" does not exist, skipping' });

    expect(logger.info).toHaveBeenCalledWith('MIGRATION', 'Statusfelder umgestellt');
    expect(logger.warn).toHaveBeenCalledWith('MIGRATION', 'Kleinbuchstaben im Bestand');
    expect(logger.debug).toHaveBeenCalledWith('MIGRATION', 'relation already exists, skipping');
    expect(logger.debug).toHaveBeenCalledWith('MIGRATION', 'index "x" does not exist, skipping');
    expect(client.removeListener).toHaveBeenCalledWith('notice', expect.any(Function));
  });
});
