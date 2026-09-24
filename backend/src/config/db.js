const { Pool } = require('pg');
const { AsyncLocalStorage } = require('async_hooks');
const bcrypt = require('bcryptjs');
const logger = require('../utils/logger');
const { getSecret } = require('./secrets');

// DATABASE_URL (bzw. DATABASE_URL_FILE) hat Vorrang, falls gesetzt – das ist
// der bisherige Weg (Docker-Compose baut die URL aus DB_PASSWORD zusammen).
// Ohne DATABASE_URL wird die URL aus den Einzelteilen zusammengesetzt, damit
// auch ein reines DB_PASSWORD_FILE (Docker-Secret) ohne Compose-Interpolation
// funktioniert (siehe Issue #140).
function buildConnectionString() {
  const explicit = getSecret('DATABASE_URL');
  if (explicit) {
    return explicit;
  }
  const user = process.env.POSTGRES_USER;
  const password = getSecret('DB_PASSWORD');
  const database = process.env.POSTGRES_DB;
  if (!user || !password || !database) {
    return undefined;
  }
  const host = process.env.DB_HOST || 'db';
  const port = process.env.DB_PORT || '5432';
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

const connectionString = buildConnectionString();

// Log connection target (mask password)
const maskedUrl = connectionString
  ? connectionString.replace(/:([^@:]+)@/, ':****@')
  : '(nicht gesetzt)';
logger.info('DB', 'Verbindung wird hergestellt', { database_url: maskedUrl });

// Jeder Request belegt einen Client für seine gesamte Dauer (siehe
// requestContextMiddleware). Mit dem pg-Standard von 10 Clients stauen sich
// parallele Requests deshalb schon bei zwei aktiven Browser-Tabs.
const pool = new Pool({
  connectionString,
  max: parseInt(process.env.DB_POOL_MAX, 10) || 25,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
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
    // E-Rechnung (EN 16931): Ländercode BT-55, USt-IdNr. BT-48, Leitweg-ID/Käuferreferenz BT-10
    await pool.query(`
      ALTER TABLE "Kunde" ADD COLUMN IF NOT EXISTS "Land" CHAR(2) NOT NULL DEFAULT 'DE';
      ALTER TABLE "Kunde" ADD COLUMN IF NOT EXISTS "UStIdNr" VARCHAR(20) DEFAULT NULL;
      ALTER TABLE "Kunde" ADD COLUMN IF NOT EXISTS "Leitweg_ID" VARCHAR(50) DEFAULT NULL;
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
    // Migrate: add status column if missing
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'Lieferschein' AND column_name = 'status'
        ) THEN
          ALTER TABLE "Lieferschein" ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'final';
        END IF;
      END
      $$;
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
    // Migrate: add status column if missing
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'Rechnung' AND column_name = 'status'
        ) THEN
          ALTER TABLE "Rechnung" ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'final';
        END IF;
      END
      $$;
    `);
    // Migrate: add rabatt_gesamt column if missing
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'Rechnung' AND column_name = 'rabatt_gesamt'
        ) THEN
          ALTER TABLE "Rechnung" ADD COLUMN rabatt_gesamt NUMERIC(5,2) NOT NULL DEFAULT 0;
        END IF;
      END
      $$;
    `);
    // Migrate: add rabatt_positionen column if missing
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'Rechnung' AND column_name = 'rabatt_positionen'
        ) THEN
          ALTER TABLE "Rechnung" ADD COLUMN rabatt_positionen JSONB NOT NULL DEFAULT '{}';
        END IF;
      END
      $$;
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
      -- Sortierreihenfolge der Listenansicht; ohne diesen Index sortiert
      -- Postgres bei jedem Seitenwechsel die komplette Tabelle neu.
      CREATE INDEX IF NOT EXISTS idx_schmuck_artikelnummer_sort
        ON "Schmuckstück" (length("Artikelnummer"), "Artikelnummer");
      -- Statusfilter (verfügbar / verkauft / Ausschuss) aus dem whereClauseBuilder
      CREATE INDEX IF NOT EXISTS idx_schmuck_status
        ON "Schmuckstück" ("Verkauft", "Ausschuss", "Ausgelagert");
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

// ---- Tamper-Schutz audit_log (Issue #139): Hash-Kette + Immutabilität ----
// Reihenfolge ist zwingend: Spalten/Funktionen anlegen → Alt-Einträge per
// backfill_audit_chain() nachverketten → erst danach trg_audit_log_immutable
// anlegen. Sonst würde der Immutable-Trigger das eigene Backfill-UPDATE blockieren.

async function ensureAuditLogTamperProtection() {
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await pool.query(`
      ALTER TABLE audit_log
        ADD COLUMN IF NOT EXISTS previous_hash CHAR(64),
        ADD COLUMN IF NOT EXISTS hash CHAR(64);
    `);

    await pool.query(`
      CREATE OR REPLACE FUNCTION audit_log_hash_chain()
      RETURNS TRIGGER AS $$
      DECLARE
          prev_hash CHAR(64);
      BEGIN
          PERFORM pg_advisory_xact_lock(hashtext('audit_log_chain'));
          SELECT hash INTO prev_hash FROM audit_log ORDER BY id DESC LIMIT 1;
          NEW.previous_hash := prev_hash;
          NEW.hash := encode(digest(concat_ws('|',
              NEW.id::text, NEW.table_name, COALESCE(NEW.artikelnummer_id, ''),
              COALESCE(NEW.column_name, ''), COALESCE(NEW.old_value, ''),
              COALESCE(NEW.new_value, ''), NEW.action_type, COALESCE(NEW.changed_by, ''),
              NEW.change_timestamp::text, COALESCE(NEW.previous_hash, '')
          ), 'sha256'), 'hex');
          RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await pool.query(`
      CREATE OR REPLACE FUNCTION audit_log_prevent_tamper()
      RETURNS TRIGGER AS $$
      BEGIN
          RAISE EXCEPTION 'audit_log ist unveränderlich (Tamper-Schutz, Issue #139): % ist nicht erlaubt', TG_OP;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await pool.query(`
      CREATE OR REPLACE FUNCTION backfill_audit_chain()
      RETURNS VOID AS $$
      DECLARE
          rec RECORD;
          prev_hash CHAR(64);
          new_hash CHAR(64);
      BEGIN
          SELECT hash INTO prev_hash FROM audit_log WHERE hash IS NOT NULL ORDER BY id DESC LIMIT 1;
          FOR rec IN SELECT * FROM audit_log WHERE hash IS NULL ORDER BY id LOOP
              new_hash := encode(digest(concat_ws('|',
                  rec.id::text, rec.table_name, COALESCE(rec.artikelnummer_id, ''),
                  COALESCE(rec.column_name, ''), COALESCE(rec.old_value, ''),
                  COALESCE(rec.new_value, ''), rec.action_type, COALESCE(rec.changed_by, ''),
                  rec.change_timestamp::text, COALESCE(prev_hash, '')
              ), 'sha256'), 'hex');
              UPDATE audit_log SET previous_hash = prev_hash, hash = new_hash WHERE id = rec.id;
              prev_hash := new_hash;
          END LOOP;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await pool.query(`
      CREATE OR REPLACE FUNCTION verify_audit_chain()
      RETURNS TABLE(id INTEGER, problem TEXT) AS $$
      BEGIN
          RETURN QUERY
          WITH chain AS (
              SELECT a.id, a.hash, a.previous_hash,
                     lag(a.hash) OVER (ORDER BY a.id) AS expected_previous_hash,
                     encode(digest(concat_ws('|',
                         a.id::text, a.table_name, COALESCE(a.artikelnummer_id, ''),
                         COALESCE(a.column_name, ''), COALESCE(a.old_value, ''),
                         COALESCE(a.new_value, ''), a.action_type, COALESCE(a.changed_by, ''),
                         a.change_timestamp::text, COALESCE(a.previous_hash, '')
                     ), 'sha256'), 'hex') AS recomputed_hash
              FROM audit_log a
          )
          SELECT chain.id,
                 CASE
                     WHEN chain.hash IS DISTINCT FROM chain.recomputed_hash THEN 'hash_mismatch'
                     ELSE 'chain_broken'
                 END AS problem
          FROM chain
          WHERE chain.hash IS DISTINCT FROM chain.recomputed_hash
             OR chain.previous_hash IS DISTINCT FROM chain.expected_previous_hash
          ORDER BY chain.id;
      END;
      $$ LANGUAGE plpgsql STABLE;
    `);

    // Alt-Einträge ohne Hash nachverketten (No-Op, wenn bereits vollständig verkettet)
    await pool.query('SELECT backfill_audit_chain()');

    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_log_hash_chain'
        ) THEN
          CREATE TRIGGER trg_audit_log_hash_chain
            BEFORE INSERT ON audit_log
            FOR EACH ROW
            EXECUTE FUNCTION audit_log_hash_chain();
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_log_immutable'
        ) THEN
          CREATE TRIGGER trg_audit_log_immutable
            BEFORE UPDATE OR DELETE ON audit_log
            FOR EACH STATEMENT
            EXECUTE FUNCTION audit_log_prevent_tamper();
        END IF;
      END
      $$;
    `);

    logger.info('DB', 'audit_log Tamper-Schutz (Hash-Kette + Immutabilität) verifiziert');
  } catch (err) {
    logger.error('DB', 'Fehler beim Verifizieren des audit_log Tamper-Schutzes', { message: err.message });
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
        failed_login_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until TIMESTAMP DEFAULT NULL,
        reset_token_hash TEXT DEFAULT NULL,
        reset_token_expiry TIMESTAMP DEFAULT NULL,
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
    // Migrate: Spalten für Account-Lockout und Passwort-Reset (Issue #137)
    await pool.query(`
      ALTER TABLE app_users
        ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS reset_token_hash TEXT DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS reset_token_expiry TIMESTAMP DEFAULT NULL;
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
    // Passwort: admin – muss nach dem ersten Login geändert werden
    const { rows } = await pool.query('SELECT COUNT(*) AS cnt FROM app_users');
    if (parseInt(rows[0].cnt, 10) === 0) {
      const adminHash = await bcrypt.hash('admin', 10);
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

// ---- Tabelle: lagerinventur ----

async function ensureLagerinventurEntwurfTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lagerinventur (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES app_users(id),
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          status VARCHAR(20) NOT NULL DEFAULT 'entwurf',
          data JSONB NOT NULL,
          kommentar TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_lagerinventur_user_status ON lagerinventur(user_id, status);
    `);
    logger.info('DB', 'lagerinventur Tabelle verifiziert');
  } catch (err) {
    logger.error('DB', 'Fehler beim Verifizieren der lagerinventur Tabelle', { message: err.message });
  }
}

// ---- Bestellübersicht (DSGVO): bestellung_kunde, bestellung, bestellung_consent ----

async function ensureBestelluebersichtSchema() {
  try {
    await pool.query(`
      DO $$
      BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'versandart_typ') THEN
              CREATE TYPE versandart_typ AS ENUM ('lieferung', 'abholung');
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bestellstatus_typ') THEN
              CREATE TYPE bestellstatus_typ AS ENUM ('offen', 'in_bearbeitung', 'abgeschlossen', 'storniert');
          END IF;
      END
      $$;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS bestellung_kunde (
          id SERIAL PRIMARY KEY,
          kunde_pseudonym VARCHAR(20) NOT NULL UNIQUE,
          name_enc          BYTEA DEFAULT NULL,
          email_enc         BYTEA DEFAULT NULL,
          telefonnummer_enc BYTEA DEFAULT NULL,
          strasse_enc       BYTEA DEFAULT NULL,
          hausnummer_enc    BYTEA DEFAULT NULL,
          plz_enc           BYTEA DEFAULT NULL,
          ort_enc           BYTEA DEFAULT NULL,
          anonymisiert      BOOLEAN NOT NULL DEFAULT FALSE,
          anonymisiert_am   TIMESTAMP DEFAULT NULL,
          erstellt_am       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // Migrate: name_enc darf NULL sein (Anonymisierungsfunktion muss den Wert löschen können)
    await pool.query(`ALTER TABLE bestellung_kunde ALTER COLUMN name_enc DROP NOT NULL;`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS bestellung (
          id SERIAL PRIMARY KEY,
          bestellnummer   VARCHAR(20) NOT NULL UNIQUE,
          kunde_id        INTEGER NOT NULL REFERENCES bestellung_kunde(id),
          versandart      versandart_typ NOT NULL,
          erfassungsdatum TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          wunschdatum     DATE DEFAULT NULL,
          beschreibung    TEXT NOT NULL,
          status          bestellstatus_typ NOT NULL DEFAULT 'offen',
          rechnung_nummer VARCHAR(20) DEFAULT NULL REFERENCES "Rechnung"("Nummer"),
          erstellt_von    VARCHAR(100) NOT NULL,
          erstellt_am     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          aktualisiert_am TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          foto_pfad       VARCHAR(255) DEFAULT NULL,
          CONSTRAINT bestellung_wunschdatum_check
              CHECK (wunschdatum IS NULL OR wunschdatum >= erfassungsdatum::date)
      );
      CREATE INDEX IF NOT EXISTS idx_bestellung_kunde ON bestellung(kunde_id);
      CREATE INDEX IF NOT EXISTS idx_bestellung_status ON bestellung(status);
      CREATE INDEX IF NOT EXISTS idx_bestellung_erfassungsdatum ON bestellung(erfassungsdatum);
      ALTER TABLE bestellung ADD COLUMN IF NOT EXISTS foto_pfad VARCHAR(255) DEFAULT NULL;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS bestellung_consent (
          id SERIAL PRIMARY KEY,
          kunde_id            INTEGER NOT NULL REFERENCES bestellung_kunde(id),
          consent_typ         VARCHAR(50) NOT NULL DEFAULT 'datenverarbeitung_bestellung',
          consent_erteilt     BOOLEAN NOT NULL,
          consent_zeitpunkt   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          datenschutz_version VARCHAR(20) NOT NULL,
          ip_hash             TEXT DEFAULT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_bestellung_consent_kunde ON bestellung_consent(kunde_id);
    `);

    await pool.query(`
      CREATE OR REPLACE FUNCTION check_datenminimierung_versandart()
      RETURNS TRIGGER AS $$
      DECLARE
          hat_adresse BOOLEAN;
          hat_telefon BOOLEAN;
          ist_anonymisiert BOOLEAN;
      BEGIN
          SELECT (strasse_enc IS NOT NULL AND hausnummer_enc IS NOT NULL
                  AND plz_enc IS NOT NULL AND ort_enc IS NOT NULL),
                 (telefonnummer_enc IS NOT NULL),
                 anonymisiert
            INTO hat_adresse, hat_telefon, ist_anonymisiert
            FROM bestellung_kunde WHERE id = NEW.kunde_id;

          IF NOT ist_anonymisiert THEN
              IF NOT hat_telefon THEN
                  RAISE EXCEPTION 'Telefonnummer ist erforderlich';
              END IF;
              IF NEW.versandart = 'lieferung' AND NOT hat_adresse THEN
                  RAISE EXCEPTION 'Versandart "lieferung" erfordert eine vollständige Adresse (Art. 5 Abs. 1 lit. c DSGVO)';
              END IF;
          END IF;
          RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await pool.query(`
      CREATE OR REPLACE FUNCTION update_bestellung_aktualisiert()
      RETURNS TRIGGER AS $$
      BEGIN
          NEW.erfassungsdatum = OLD.erfassungsdatum;
          NEW.aktualisiert_am = CURRENT_TIMESTAMP;
          RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await pool.query(`
      CREATE OR REPLACE FUNCTION anonymisiere_bestellung_kunde(p_kunde_id INTEGER)
      RETURNS VOID AS $$
      BEGIN
          UPDATE bestellung_kunde
          SET name_enc = NULL,
              email_enc = NULL,
              telefonnummer_enc = NULL,
              strasse_enc = NULL,
              hausnummer_enc = NULL,
              plz_enc = NULL,
              ort_enc = NULL,
              anonymisiert = TRUE,
              anonymisiert_am = CURRENT_TIMESTAMP
          WHERE id = p_kunde_id AND anonymisiert = FALSE;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger WHERE tgname = 'trg_bestellung_datenminimierung'
        ) THEN
          CREATE TRIGGER trg_bestellung_datenminimierung
            BEFORE INSERT OR UPDATE ON bestellung
            FOR EACH ROW
            EXECUTE FUNCTION check_datenminimierung_versandart();
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger WHERE tgname = 'trg_bestellung_aktualisiert'
        ) THEN
          CREATE TRIGGER trg_bestellung_aktualisiert
            BEFORE UPDATE ON bestellung
            FOR EACH ROW
            EXECUTE FUNCTION update_bestellung_aktualisiert();
        END IF;
      END
      $$;
    `);

    logger.info('DB', 'Bestellübersicht-Schema verifiziert');
  } catch (err) {
    logger.error('DB', 'Fehler beim Verifizieren des Bestellübersicht-Schemas', { message: err.message });
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
//   7. audit_log Tamper-Schutz (Hash-Kette + Immutable-Trigger, Issue #139;
//      muss nach audit_log, aber vor jedem weiteren Schritt, der dort einträgt)
//   8. app_users (wird von lagerinventur referenziert)
//   9. Bestellübersicht (bestellung_kunde/bestellung/bestellung_consent, braucht Rechnung)
//   10. lagerinventur
//   11. Constraints & Trigger (brauchen die Tabellen)

pool.query('SELECT NOW() AS server_time')
  .then((res) => {
    logger.info('DB', 'Verbindung erfolgreich hergestellt', { server_time: res.rows[0].server_time });
    return ensureTriggerFunctions()
      .then(() => ensureKundeTable())
      .then(() => ensureLieferscheinTable())
      .then(() => ensureRechnungTable())
      .then(() => ensureSchmuckstueckTable())
      .then(() => ensureAuditLogTable())
      .then(() => ensureAuditLogTamperProtection())
      .then(() => ensureAppUsersTable())
      .then(() => ensureBestelluebersichtSchema())
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
  connectionString,
};
