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
  const store = { username: 'anonym', client: null, clientPromise: null };

  // Release the request-scoped client once the response is fully done.
  // Both 'finish' and 'close' are registered; the null-check ensures the
  // client is released at most once even if both events fire.
  const releaseClient = () => {
    const { client, clientPromise } = store;
    store.client = null;
    store.clientPromise = null;
    if (client) {
      client.release();
    } else if (clientPromise) {
      // Acquisition still in flight – release whenever it settles.
      clientPromise.then((c) => c.release()).catch((err) => {
        logger.error('DB', 'Fehler beim Freigeben des Request-Clients', { message: err.message });
      });
    }
  };

  res.on('finish', releaseClient);
  res.on('close', releaseClient);

  requestContext.run(store, next);
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

// Returns a fresh pool client with app.current_user set.
// Used for explicit transaction management (e.g. backup import).
// Caller is responsible for releasing the returned client.
async function connect() {
  const client = await pool.connect();
  const username = getCurrentDbUsername();

  // Make authenticated app user available in SQL context (e.g. audit trigger).
  // false = session-local (persists for the connection lifetime, not just the current transaction).
  try {
    await client.query('SELECT set_config($1, $2, false)', ['app.current_user', username]);
    return client;
  } catch (err) {
    client.release();
    throw err;
  }
}

async function query(text, params) {
  const store = requestContext.getStore();

  // Outside a request context (e.g. startup queries): use the pool directly.
  if (!store) {
    return pool.query(text, params);
  }

  // Lazy acquisition of the request-scoped client.
  // set_config is called exactly once per request; all subsequent queries
  // reuse the same client, avoiding an extra roundtrip per query.
  if (!store.clientPromise) {
    store.clientPromise = pool.connect().then(async (client) => {
      try {
        // false = session-local (persists for the connection lifetime, not just the current transaction).
        await client.query('SELECT set_config($1, $2, false)', ['app.current_user', store.username]);
        store.client = client;
        return client;
      } catch (err) {
        client.release();
        throw err;
      }
    }).catch((err) => {
      // Allow a retry on the next query call if acquisition failed.
      store.clientPromise = null;
      throw err;
    });
  }

  const client = await store.clientPromise;
  return client.query(text, params);
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
        CONSTRAINT app_users_role_check CHECK (role IN ('admin', 'bearbeiter', 'user'))
      )
    `);
    // Migrate role constraint in existing deployments to support 'bearbeiter'
    await pool.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'app_users_role_check'
        ) THEN
          ALTER TABLE app_users DROP CONSTRAINT app_users_role_check;
        END IF;
        ALTER TABLE app_users
          ADD CONSTRAINT app_users_role_check
          CHECK (role IN ('admin', 'bearbeiter', 'user'));
      END
      $$;
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
                IF OLD."Ausschuss_Grund" IS DISTINCT FROM NEW."Ausschuss_Grund" THEN
                  INSERT INTO audit_log (table_name, artikelnummer_id, column_name, old_value, new_value, action_type, changed_by)
                  VALUES ('Schmuckstück', NEW."Artikelnummer", 'Ausschuss_Grund', OLD."Ausschuss_Grund", NEW."Ausschuss_Grund", 'UPDATE', COALESCE(current_setting('app.current_user', true), current_user));
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

// Enforce business rule at DB level:
// If a piece is marked as Ausschuss, a non-empty Ausschuss_Grund is required.
// Added as NOT VALID to keep existing legacy rows compatible while still
// enforcing the rule for all new inserts/updates.
async function ensureAusschussGrundConstraint() {
  const constraintName = 'schmuckstueck_ausschuss_grund_required_chk';
  try {
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          WHERE t.relname = 'Schmuckstück'
            AND c.conname = '${constraintName}'
        ) THEN
          ALTER TABLE "Schmuckstück"
          ADD CONSTRAINT ${constraintName}
          CHECK (
            COALESCE("Ausschuss", 0) = 0
            OR LENGTH(BTRIM(COALESCE("Ausschuss_Grund", ''))) > 0
          ) NOT VALID;
        END IF;
      END
      $$;
    `);
    logger.info('DB', 'Constraint für Ausschuss_Grund verifiziert');
  } catch (err) {
    logger.error('DB', 'Fehler beim Verifizieren der Ausschuss_Grund-Constraint', { message: err.message });
  }
}

// Ensure lagerinventur_entwurf table exists
async function ensureLagerinventurEntwurfTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lagerinventur_entwurf (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES app_users(id),
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          status VARCHAR(20) NOT NULL DEFAULT 'entwurf',
          data JSONB NOT NULL,
          kommentar TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_lagerinventur_user_status ON lagerinventur_entwurf(user_id, status);
    `);
    logger.info('DB', 'lagerinventur_entwurf Tabelle verifiziert');
  } catch (err) {
    logger.error('DB', 'Fehler beim Verifizieren der lagerinventur_entwurf Tabelle', { message: err.message });
  }
}

// Test connection and ensure schema on startup
pool.query('SELECT NOW() AS server_time')
  .then((res) => {
    logger.info('DB', `Verbindung erfolgreich hergestellt. Server-Zeit: ${res.rows[0].server_time}`);
    return ensureAppUsersTable()
      .then(() => ensureAuditUserContextFunction())
      .then(() => ensureAusschussGrundConstraint())
      .then(() => ensureLagerinventurEntwurfTable());
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
