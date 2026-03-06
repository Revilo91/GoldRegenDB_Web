const { Pool } = require('pg');
const { AsyncLocalStorage } = require('async_hooks');
const bcrypt = require('bcryptjs');
const logger = require('../utils/logger');

const connectionString = process.env.DATABASE_URL;

// Log connection target (mask password)
const maskedUrl = connectionString
  ? connectionString.replace(/:([^@:]+)@/, ':****@')
  : '(nicht gesetzt)';
logger.info('DB', `Verbindung wird hergestellt zu: ${maskedUrl}`);

const pool = new Pool({
  connectionString,
});

const requestContext = new AsyncLocalStorage();

function requestContextMiddleware(req, res, next) {
  requestContext.run({ username: 'anonym' }, next);
}

function setCurrentDbUsername(username) {
  const store = requestContext.getStore();
  if (!store) {
    return;
  }
  store.username = username || 'anonym';
}

function getCurrentDbUsername() {
  const store = requestContext.getStore();
  return store?.username || 'anonym';
}

async function connect() {
  const client = await pool.connect();
  const username = getCurrentDbUsername();

  // Make authenticated app user available in SQL context (e.g. audit trigger).
  try {
    await client.query('SELECT set_config($1, $2, false)', ['app.current_user', username]);
    return client;
  } catch (err) {
    client.release();
    throw err;
  }
}

async function query(text, params) {
  const client = await connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

pool.on('error', (err) => {
  logger.error('DB', 'Unerwarteter Fehler auf Idle-Client', { message: err.message, code: err.code });
  process.exit(-1);
});

pool.on('connect', () => {
  logger.debug('DB', 'Neuer Client mit Pool verbunden');
});

// Ensure app_users table exists (safe for existing deployments where init.sql was not re-run)
async function ensureAppUsersTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        email TEXT DEFAULT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'user',
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP DEFAULT NULL,
        CONSTRAINT app_users_role_check CHECK (role IN ('admin', 'user'))
      )
    `);
    // Seed default admin if table is empty
    // Password: admin (SHA-256 hashed on frontend, then bcrypt-hashed on backend)
    // Hash = bcrypt(SHA-256("admin")) – generated with 10 rounds
    const { rows } = await pool.query('SELECT COUNT(*) AS cnt FROM app_users');
    if (parseInt(rows[0].cnt, 10) === 0) {
      const sha256ofAdmin = '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918';
      const adminHash = await bcrypt.hash(sha256ofAdmin, 10);
      await pool.query(
        `INSERT INTO app_users (username, password_hash, email, role, active)
         VALUES ('admin', $1, 'admin@goldregen.local', 'admin', TRUE)
         ON CONFLICT (username) DO NOTHING`,
        [adminHash]
      );
      logger.info('DB', 'Standard-Admin-Benutzer angelegt – Passwort nach erstem Login ändern!');
    }
    logger.info('DB', 'app_users Tabelle verifiziert');
  } catch (err) {
    logger.error('DB', 'Fehler beim Verifizieren der app_users Tabelle', { message: err.message });
  }
}

// Keep audit trigger compatible with app-level users in existing deployments.
async function ensureAuditUserContextFunction() {
  try {
    await pool.query(`
      CREATE OR REPLACE FUNCTION audit_schmuckstueck_changes()
      RETURNS TRIGGER AS $$
      BEGIN
          IF TG_OP = 'UPDATE' THEN
              IF OLD."Verkauft" IS DISTINCT FROM NEW."Verkauft" THEN
                  INSERT INTO audit_log (table_name, artikelnummer_id, column_name, old_value, new_value, action_type, changed_by)
                  VALUES ('Schmuckstück', NEW."Artikelnummer", 'Verkauft', OLD."Verkauft"::TEXT, NEW."Verkauft"::TEXT, 'UPDATE', COALESCE(current_setting('app.current_user', true), current_user));
              END IF;
              IF OLD."Ausgelagert" IS DISTINCT FROM NEW."Ausgelagert" THEN
                  INSERT INTO audit_log (table_name, artikelnummer_id, column_name, old_value, new_value, action_type, changed_by)
                  VALUES ('Schmuckstück', NEW."Artikelnummer", 'Ausgelagert', OLD."Ausgelagert"::TEXT, NEW."Ausgelagert"::TEXT, 'UPDATE', COALESCE(current_setting('app.current_user', true), current_user));
              END IF;
              IF OLD."Ausschuss" IS DISTINCT FROM NEW."Ausschuss" THEN
                  INSERT INTO audit_log (table_name, artikelnummer_id, column_name, old_value, new_value, action_type, changed_by)
                  VALUES ('Schmuckstück', NEW."Artikelnummer", 'Ausschuss', OLD."Ausschuss"::TEXT, NEW."Ausschuss"::TEXT, 'UPDATE', COALESCE(current_setting('app.current_user', true), current_user));
              END IF;
              IF OLD."Lieferschein_ID" IS DISTINCT FROM NEW."Lieferschein_ID" THEN
                  INSERT INTO audit_log (table_name, artikelnummer_id, column_name, old_value, new_value, action_type, changed_by)
                  VALUES ('Schmuckstück', NEW."Artikelnummer", 'Lieferschein_ID', OLD."Lieferschein_ID"::TEXT, NEW."Lieferschein_ID"::TEXT, 'UPDATE', COALESCE(current_setting('app.current_user', true), current_user));
              END IF;
              IF OLD."Rechnung_ID" IS DISTINCT FROM NEW."Rechnung_ID" THEN
                  INSERT INTO audit_log (table_name, artikelnummer_id, column_name, old_value, new_value, action_type, changed_by)
                  VALUES ('Schmuckstück', NEW."Artikelnummer", 'Rechnung_ID', OLD."Rechnung_ID"::TEXT, NEW."Rechnung_ID"::TEXT, 'UPDATE', COALESCE(current_setting('app.current_user', true), current_user));
              END IF;
              IF OLD."Online" IS DISTINCT FROM NEW."Online" THEN
                  INSERT INTO audit_log (table_name, artikelnummer_id, column_name, old_value, new_value, action_type, changed_by)
                  VALUES ('Schmuckstück', NEW."Artikelnummer", 'Online', OLD."Online"::TEXT, NEW."Online"::TEXT, 'UPDATE', COALESCE(current_setting('app.current_user', true), current_user));
              END IF;
          END IF;
          RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    logger.info('DB', 'Audit-Trigger-Funktion auf app.current_user aktualisiert');
  } catch (err) {
    logger.error('DB', 'Fehler beim Aktualisieren der Audit-Trigger-Funktion', { message: err.message });
  }
}

// Test connection and ensure schema on startup
pool.query('SELECT NOW() AS server_time')
  .then((res) => {
    logger.info('DB', `Verbindung erfolgreich hergestellt. Server-Zeit: ${res.rows[0].server_time}`);
    return ensureAppUsersTable().then(() => ensureAuditUserContextFunction());
  })
  .catch((err) => {
    logger.error('DB', 'Verbindung zur Datenbank fehlgeschlagen', { message: err.message, code: err.code });
  });

module.exports = {
  query,
  connect,
  setCurrentDbUsername,
  requestContextMiddleware,
  pool,
};
