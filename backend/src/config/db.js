const { Pool } = require('pg');
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

pool.on('error', (err) => {
  logger.error('DB', 'Unerwarteter Fehler auf Idle-Client', { message: err.message, code: err.code });
  process.exit(-1);
});

pool.on('connect', () => {
  logger.debug('DB', 'Neuer Client mit Pool verbunden');
});

// Test connection on startup
pool.query('SELECT NOW() AS server_time')
  .then((res) => {
    logger.info('DB', `Verbindung erfolgreich hergestellt. Server-Zeit: ${res.rows[0].server_time}`);
  })
  .catch((err) => {
    logger.error('DB', 'Verbindung zur Datenbank fehlgeschlagen', { message: err.message, code: err.code });
  });

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
