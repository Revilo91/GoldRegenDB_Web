const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const bcrypt = require('bcryptjs');
const logger = require('../utils/logger');

// Schema-Migrationen (Issue #257): nummerierte SQL-Dateien, nur vorwärts, jede
// in einer eigenen Transaktion. Bereits angewandte Versionen stehen in
// schema_migrations. Eine Migration wird nie nachträglich geändert – jede
// Schemaänderung ist eine neue, höher nummerierte Datei.

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const MIGRATION_FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;
// Beliebige, aber feste Schlüsselzahl: parallele Starts (zwei Container, Neustart
// während eines laufenden Starts) warten aufeinander statt doppelt zu migrieren.
const MIGRATION_LOCK_KEY = 257001;
const DEFAULT_BACKUP_DIR = path.resolve(process.cwd(), 'migration-backups');
const ADMIN_BCRYPT_ROUNDS = 10;

function loadMigrations(dir = MIGRATIONS_DIR) {
  const migrations = fs.readdirSync(dir)
    .map((file) => ({ file, match: MIGRATION_FILE_PATTERN.exec(file) }))
    .filter(({ match }) => match)
    .map(({ file, match }) => ({
      version: match[1],
      name: match[2],
      sql: fs.readFileSync(path.join(dir, file), 'utf8'),
    }))
    .sort((a, b) => a.version.localeCompare(b.version));

  for (let i = 1; i < migrations.length; i++) {
    if (migrations[i].version === migrations[i - 1].version) {
      throw new Error(`Migration ${migrations[i].version} ist doppelt vergeben (${dir})`);
    }
  }
  return migrations;
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
        version    TEXT PRIMARY KEY,
        name       TEXT,
        applied_at TIMESTAMPTZ DEFAULT now()
    )
  `);
}

async function appliedVersions(client) {
  const { rows } = await client.query('SELECT version FROM schema_migrations');
  return new Set(rows.map((r) => r.version));
}

// Bestandsdatenbank = es gibt schon Tabellen außer der Migrationstabelle selbst.
async function hasUserTables(client) {
  const { rows } = await client.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        AND table_name <> 'schema_migrations'
    ) AS vorhanden
  `);
  return rows[0].vorhanden;
}

// Passwort nicht in der Kommandozeile (ps), sondern per PGPASSWORD.
function pgDumpInvocation(connectionString, file) {
  const url = new URL(connectionString);
  const password = decodeURIComponent(url.password);
  url.password = '';
  const env = { ...process.env };
  if (password) env.PGPASSWORD = password;
  return {
    args: ['--format=custom', `--file=${file}`, `--dbname=${url.toString()}`],
    env,
  };
}

function runExecFile(execFileImpl, command, args, options) {
  return new Promise((resolve, reject) => {
    execFileImpl(command, args, options, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        reject(err);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

function backupFailureMessage(err) {
  if (err.code === 'ENOENT') {
    return 'pg_dump nicht gefunden (postgresql-client installieren)';
  }
  const detail = String(err.stderr || '').trim() || err.message;
  return `pg_dump fehlgeschlagen: ${detail}`;
}

async function backupBeforeMigration({ connectionString, env, execFileImpl, firstPending }) {
  if (env.MIGRATION_SKIP_BACKUP === 'true') {
    logger.warn('MIGRATION', 'Backup vor der Migration übersprungen (MIGRATION_SKIP_BACKUP=true)');
    return null;
  }

  const dir = env.MIGRATION_BACKUP_DIR || DEFAULT_BACKUP_DIR;
  const zeitstempel = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `vor_migration_${firstPending}_${zeitstempel}.dump`);

  try {
    if (!connectionString) throw new Error('keine Datenbank-URL konfiguriert');
    await fs.promises.mkdir(dir, { recursive: true });
    const { args, env: dumpEnv } = pgDumpInvocation(connectionString, file);
    await runExecFile(execFileImpl, 'pg_dump', args, { env: dumpEnv, maxBuffer: 10 * 1024 * 1024 });
  } catch (err) {
    // Ein halb geschriebener Dump sähe wie ein gültiges Backup aus.
    await fs.promises.rm(file, { force: true }).catch(() => {});
    throw new Error(
      `Backup vor der Migration fehlgeschlagen – Start abgebrochen, Schema unverändert. `
      + `${backupFailureMessage(err)}. Ziel: ${dir}. `
      + 'MIGRATION_BACKUP_DIR prüfen oder, nur mit eigenem aktuellem Backup, MIGRATION_SKIP_BACKUP=true setzen.',
      { cause: err },
    );
  }

  logger.info('MIGRATION', 'Backup vor der Migration erstellt', { datei: file });
  return file;
}

async function applyMigration(client, migration) {
  const label = `${migration.version}_${migration.name}`;
  try {
    await client.query('BEGIN');
    await client.query(migration.sql);
    await client.query(
      'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
      [migration.version, migration.name],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw new Error(`Migration ${label} fehlgeschlagen und zurückgerollt: ${err.message}`, { cause: err });
  }
  logger.info('MIGRATION', `Migration ${label} angewandt`);
}

// Kein Schema, sondern Startdaten: läuft bei jedem Start, damit nach dem
// Löschen aller Benutzer wieder ein Zugang existiert.
// Passwort: admin – muss nach dem ersten Login geändert werden.
async function ensureStandardAdmin(client) {
  const { rows } = await client.query('SELECT COUNT(*) AS cnt FROM app_users');
  if (parseInt(rows[0].cnt, 10) > 0) return;
  const adminHash = await bcrypt.hash('admin', ADMIN_BCRYPT_ROUNDS);
  await client.query(
    `INSERT INTO app_users (username, password_hash, email, role, active, must_change_password)
     VALUES ('admin', $1, 'admin@goldregen.local', 'admin', TRUE, TRUE)
     ON CONFLICT (username) DO NOTHING`,
    [adminHash],
  );
  logger.info('DB', 'Standard-Admin-Benutzer angelegt – Passwort nach erstem Login ändern!');
}

// RAISE NOTICE/WARNING aus den Migrationen sind Meldungen für den Betrieb.
// "…, skipping" der IF-(NOT-)EXISTS-DDL ist bei idempotenten Migrationen der
// Normalfall und nur Debug-Rauschen (Postgres meldet es teils mit SQLSTATE 00000).
function logNotice(msg) {
  if (msg.severity === 'WARNING') {
    logger.warn('MIGRATION', msg.message);
  } else if (msg.code === '00000' && !msg.message.endsWith(', skipping')) {
    logger.info('MIGRATION', msg.message);
  } else {
    logger.debug('MIGRATION', msg.message);
  }
}

async function runMigrations({
  pool,
  connectionString,
  env = process.env,
  migrationsDir = MIGRATIONS_DIR,
  execFileImpl = execFile,
}) {
  const migrations = loadMigrations(migrationsDir);
  const client = await pool.connect();
  client.on('notice', logNotice);
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      const bestand = await hasUserTables(client);
      await ensureMigrationsTable(client);
      const applied = await appliedVersions(client);

      const bekannt = new Set(migrations.map((m) => m.version));
      const unbekannt = [...applied].filter((v) => !bekannt.has(v));
      if (unbekannt.length > 0) {
        logger.warn('MIGRATION', 'Datenbank kennt Migrationen, die dieser Version fehlen – älteres Image?',
          { versionen: unbekannt });
      }

      const pending = migrations.filter((m) => !applied.has(m.version));
      if (pending.length === 0) {
        logger.info('MIGRATION', 'Schema aktuell, keine Migration ausstehend');
      } else {
        logger.info('MIGRATION', `${pending.length} Migration(en) ausstehend`,
          { versionen: pending.map((m) => m.version) });
        if (bestand) {
          await backupBeforeMigration({ connectionString, env, execFileImpl, firstPending: pending[0].version });
        }
        for (const migration of pending) {
          await applyMigration(client, migration);
        }
      }

      await ensureStandardAdmin(client);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => {});
    }
  } finally {
    client.removeListener('notice', logNotice);
    client.release();
  }
}

module.exports = {
  runMigrations,
  loadMigrations,
  MIGRATIONS_DIR,
  MIGRATION_LOCK_KEY,
};
