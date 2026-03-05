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
    // Seed default admin if table is empty (hash = bcrypt(SHA-256("admin")))
    const { rows } = await pool.query('SELECT COUNT(*) AS cnt FROM app_users');
    if (parseInt(rows[0].cnt, 10) === 0) {
      await pool.query(
        `INSERT INTO app_users (username, password_hash, email, role, active)
         VALUES ('admin', '$2b$10$oxmaxGKMc6AHPtrr1G3QbOnaXJziFbSdvC5HlU6k/2lBnVyqqOX5W', 'admin@goldregen.local', 'admin', TRUE)
         ON CONFLICT (username) DO NOTHING`
      );
      logger.info('DB', 'Standard-Admin-Benutzer angelegt – Passwort nach erstem Login ändern!');
    }
    logger.info('DB', 'app_users Tabelle verifiziert');
  } catch (err) {
    logger.error('DB', 'Fehler beim Verifizieren der app_users Tabelle', { message: err.message });
  }
}

// Test connection and ensure schema on startup
pool.query('SELECT NOW() AS server_time')
  .then((res) => {
    logger.info('DB', `Verbindung erfolgreich hergestellt. Server-Zeit: ${res.rows[0].server_time}`);
    return ensureAppUsersTable();
  })
  .catch((err) => {
    logger.error('DB', 'Verbindung zur Datenbank fehlgeschlagen', { message: err.message, code: err.code });
  });

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
