const { Pool } = require('pg');
const { AsyncLocalStorage } = require('async_hooks');
const logger = require('../utils/logger');
const { getSecret } = require('./secrets');
const { runMigrations } = require('./migrate');

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

// Ein Fehler auf einem *idle* Client ist kein Grund, den Prozess zu beenden:
// ein DB-Neustart, ein Netzwerk-Blip oder ein Spin-Down der NAS-Platte riss
// sonst alle laufenden Requests mit (Befund A6). pg entfernt den betroffenen
// Client selbst aus dem Pool; der naechste Request holt sich einen neuen.
pool.on('error', (err) => {
  logger.error('DB', 'Unerwarteter Fehler auf Idle-Client – Client wird verworfen', {
    message: err.message,
    code: err.code,
  });
});

pool.on('connect', () => {
  logger.debug('DB', 'Neuer Client mit Pool verbunden');
});

// Bis die Migrationen durch sind, darf die Anwendung keine Requests
// beantworten: sonst treffen die ersten Aufrufe ein Schema, dem noch Spalten
// fehlen (Befund A1). index.js wartet darauf und bricht bei einem Fehler den
// Start ab. Das Schema selbst liegt in config/migrations/ (Issue #257).
let schemaReady = false;

function isSchemaReady() {
  return schemaReady;
}

async function initializeDatabase() {
  const res = await pool.query('SELECT NOW() AS server_time');
  logger.info('DB', 'Verbindung erfolgreich hergestellt', { server_time: res.rows[0].server_time });

  await runMigrations({ pool, connectionString });

  schemaReady = true;
  logger.info('DB', 'Schema vollständig verifiziert');
}

module.exports = {
  query,
  connect,
  setCurrentDbUsername,
  requestContextMiddleware,
  initializeDatabase,
  isSchemaReady,
  pool,
  connectionString,
};
