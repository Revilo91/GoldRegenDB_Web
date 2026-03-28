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

// ============================================================
// Schema-Ensure-Funktionen
// Stellen sicher, dass alle benötigten Tabellen, Funktionen,
// Trigger und Constraints existieren – auch wenn init.sql
// nicht (erneut) ausgeführt wurde.
// ============================================================

// ---- Trigger-Funktionen ----

async function ensureTriggerFunctions() {
  try {
    // Funktion: update_letzte_aenderung – setzt Letzte_Änderung bei jedem UPDATE
    await pool.query(`
      CREATE OR REPLACE FUNCTION update_letzte_aenderung()
      RETURNS TRIGGER AS $$
      BEGIN
          NEW."Letzte_Änderung" = CURRENT_TIMESTAMP;
          RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Funktion: audit_schmuckstueck_changes – schreibt Änderungen in audit_log
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

    logger.info('DB', 'Trigger-Funktionen verifiziert');
  } catch (err) {
    logger.error('DB', 'Fehler beim Verifizieren der Trigger-Funktionen', { message: err.message });
  }
}

// ---- Tabelle: Kunde ----

async function ensureKundeTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "Kunde" (
          "ID" SERIAL,
          "Name" VARCHAR(100) NOT NULL,
          "Strasse" TEXT NOT NULL,
          "Hausnummer" INTEGER NOT NULL,
          "Ort" TEXT NOT NULL,
          "PLZ" INTEGER NOT NULL,
          "Email" TEXT DEFAULT NULL,
          "Telefonnummer" TEXT DEFAULT NULL,
          "Provision" INTEGER NOT NULL DEFAULT 0,
          "Aktiv" BOOLEAN NOT NULL DEFAULT FALSE,
          PRIMARY KEY ("Name"),
          UNIQUE ("ID")
      );
    `);
    logger.info('DB', '"Kunde" Tabelle verifiziert');
  } catch (err) {
    logger.error('DB', 'Fehler beim Verifizieren der Kunde Tabelle', { message: err.message });
  }
}

// ---- Tabelle: Lieferschein ----

async function ensureLieferscheinTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "Lieferschein" (
          "ID" SERIAL,
          "Nummer" VARCHAR(20) NOT NULL,
          "Kundennummer" INTEGER NOT NULL,
          "Datum" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY ("Nummer"),
          UNIQUE ("ID"),
          CONSTRAINT "Lieferschein_ibfk_1" FOREIGN KEY ("Kundennummer") REFERENCES "Kunde" ("ID")
      );
    `);
    logger.info('DB', '"Lieferschein" Tabelle verifiziert');
  } catch (err) {
    logger.error('DB', 'Fehler beim Verifizieren der Lieferschein Tabelle', { message: err.message });
  }
}

// ---- Tabelle: Rechnung ----

async function ensureRechnungTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "Rechnung" (
          "ID" SERIAL,
          "Nummer" VARCHAR(20) NOT NULL,
          "Kundennummer" INTEGER NOT NULL,
          "Datum" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY ("Nummer"),
          CONSTRAINT "Rechnung_ibfk_1" FOREIGN KEY ("Kundennummer") REFERENCES "Kunde" ("ID")
      );
      CREATE INDEX IF NOT EXISTS idx_rechnung_id ON "Rechnung" ("ID");
      CREATE INDEX IF NOT EXISTS idx_rechnung_kundennummer ON "Rechnung" ("Kundennummer");
    `);
    logger.info('DB', '"Rechnung" Tabelle verifiziert');
  } catch (err) {
    logger.error('DB', 'Fehler beim Verifizieren der Rechnung Tabelle', { message: err.message });
  }
}

// ---- Tabelle: Schmuckstück ----

async function ensureSchmuckstueckTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "Schmuckstück" (
          "Artikelnummer" VARCHAR(20) NOT NULL,
          "Name" TEXT DEFAULT NULL,
          "Foto" TEXT DEFAULT NULL,
          "Art" TEXT DEFAULT NULL,
          "Form" TEXT DEFAULT NULL,
          "Länge" DOUBLE PRECISION DEFAULT 0,
          "Fassung" TEXT DEFAULT NULL,
          "Farbe" TEXT DEFAULT NULL,
          "Inhalt_Material" TEXT DEFAULT NULL,
          "Inhalt_Farbe" TEXT DEFAULT NULL,
          "Inhalt_Farbakzent" TEXT DEFAULT NULL,
          "Inhalt_Zusatzmaterial" TEXT DEFAULT NULL,
          "Anhänger_Fassung" TEXT DEFAULT NULL,
          "Anhänger_Form" TEXT DEFAULT NULL,
          "Anhänger_Farbe" TEXT DEFAULT NULL,
          "Anhänger_Grösse" DOUBLE PRECISION DEFAULT 0,
          "Anhänger_Inhalt_Material" TEXT DEFAULT NULL,
          "Anhänger_Inhalt_Farbe" TEXT DEFAULT NULL,
          "Anhänger_Inhalt_Farbakzente" TEXT DEFAULT NULL,
          "Anhänger_Inhalt_Zusatzmaterial" TEXT DEFAULT NULL,
          "Material" TEXT DEFAULT NULL,
          "Grösse" DOUBLE PRECISION DEFAULT 0,
          "Anhänger" TEXT DEFAULT NULL,
          "Zwischenstück" TEXT DEFAULT NULL,
          "Herstellungskosten" DOUBLE PRECISION DEFAULT 0,
          "Verkaufspreis" DOUBLE PRECISION DEFAULT 0,
          "Ausgelagert" INTEGER DEFAULT 0,
          "Verkauft" SMALLINT DEFAULT 0,
          "Ausschuss" SMALLINT DEFAULT 0,
          "Ausschuss_Grund" TEXT DEFAULT NULL,
          "Lieferschein_ID" INTEGER DEFAULT 0,
          "Rechnung_ID" INTEGER DEFAULT 0,
          "Erstelldatum" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          "Letzte_Änderung" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY ("Artikelnummer")
      );
      CREATE INDEX IF NOT EXISTS idx_schmuck_ausgelagert ON "Schmuckstück" ("Ausgelagert");
      CREATE INDEX IF NOT EXISTS idx_schmuck_lieferschein ON "Schmuckstück" ("Lieferschein_ID");
      CREATE INDEX IF NOT EXISTS idx_schmuck_rechnung ON "Schmuckstück" ("Rechnung_ID");
    `);
    logger.info('DB', '"Schmuckstück" Tabelle verifiziert');
  } catch (err) {
    logger.error('DB', 'Fehler beim Verifizieren der Schmuckstück Tabelle', { message: err.message });
  }
}

// ---- Tabelle: audit_log ----

async function ensureAuditLogTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
          id SERIAL PRIMARY KEY,
          table_name VARCHAR(255) NOT NULL,
          artikelnummer_id VARCHAR(20) DEFAULT NULL,
          column_name VARCHAR(255) DEFAULT NULL,
          old_value TEXT DEFAULT NULL,
          new_value TEXT DEFAULT NULL,
          action_type VARCHAR(10) NOT NULL,
          changed_by VARCHAR(255) DEFAULT NULL,
          change_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    logger.info('DB', 'audit_log Tabelle verifiziert');
  } catch (err) {
    logger.error('DB', 'Fehler beim Verifizieren der audit_log Tabelle', { message: err.message });
  }
}

// ---- Tabelle: app_users ----

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
        must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP DEFAULT NULL,
        CONSTRAINT app_users_role_check CHECK (role IN ('admin', 'bearbeiter', 'user'))
      )
    `);
    // Migrate: add must_change_password column if missing (existing deployments)
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'app_users' AND column_name = 'must_change_password'
        ) THEN
          ALTER TABLE app_users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
        END IF;
      END
      $$;
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
        `INSERT INTO app_users (username, password_hash, email, role, active, must_change_password)
         VALUES ('admin', $1, 'admin@goldregen.local', 'admin', TRUE, TRUE)
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

// ---- Tabelle: lagerinventur_entwurf ----

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

// ---- Constraint: Ausschuss_Grund ----

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

// ---- Trigger auf Schmuckstück ----

async function ensureTriggers() {
  try {
    // Trigger: update_letzte_aenderung
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger WHERE tgname = 'trg_update_letzte_aenderung'
        ) THEN
          CREATE TRIGGER trg_update_letzte_aenderung
            BEFORE UPDATE ON "Schmuckstück"
            FOR EACH ROW
            EXECUTE FUNCTION update_letzte_aenderung();
        END IF;
      END
      $$;
    `);
    // Trigger: audit_schmuckstueck_changes
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_schmuckstueck'
        ) THEN
          CREATE TRIGGER trg_audit_schmuckstueck
            AFTER UPDATE ON "Schmuckstück"
            FOR EACH ROW
            EXECUTE FUNCTION audit_schmuckstueck_changes();
        END IF;
      END
      $$;
    `);
    logger.info('DB', 'Trigger auf "Schmuckstück" verifiziert');
  } catch (err) {
    logger.error('DB', 'Fehler beim Verifizieren der Trigger', { message: err.message });
  }
}

// ============================================================
// Startup: Verbindung testen und Schema sicherstellen
// ============================================================
// Die Reihenfolge ist wichtig wegen Foreign-Key-Abhängigkeiten:
//   1. Trigger-Funktionen (werden von Triggern referenziert)
//   2. Kunde (wird von Lieferschein/Rechnung referenziert)
//   3. Lieferschein
//   4. Rechnung
//   5. Schmuckstück
//   6. audit_log (wird von Audit-Trigger beschrieben)
//   7. app_users (wird von lagerinventur_entwurf referenziert)
//   8. lagerinventur_entwurf
//   9. Constraints & Trigger (brauchen die Tabellen)

pool.query('SELECT NOW() AS server_time')
  .then((res) => {
    logger.info('DB', `Verbindung erfolgreich hergestellt. Server-Zeit: ${res.rows[0].server_time}`);
    return ensureTriggerFunctions()
      .then(() => ensureKundeTable())
      .then(() => ensureLieferscheinTable())
      .then(() => ensureRechnungTable())
      .then(() => ensureSchmuckstueckTable())
      .then(() => ensureAuditLogTable())
      .then(() => ensureAppUsersTable())
      .then(() => ensureLagerinventurEntwurfTable())
      .then(() => ensureAusschussGrundConstraint())
      .then(() => ensureTriggers());
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
