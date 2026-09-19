const { Pool } = require('pg');

function buildConnectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const user = process.env.POSTGRES_USER;
  const password = process.env.DB_PASSWORD;
  const database = process.env.POSTGRES_DB;
  if (!user || !password || !database) {
    throw new Error(
      'DB-Verbindung fehlt: setze DATABASE_URL oder POSTGRES_USER/DB_PASSWORD/POSTGRES_DB.'
    );
  }
  const host = process.env.DB_HOST || 'localhost';
  const port = process.env.DB_PORT || '5432';
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

const pool = new Pool({ connectionString: buildConnectionString() });

// Blockt Schreiboperationen zusätzlich zur Statement-Whitelist in tools.js:
// jede Query läuft in einer READ ONLY-Transaktion, Postgres selbst lehnt
// INSERT/UPDATE/DELETE/DDL dann ab, auch falls die Whitelist mal lückenhaft ist.
async function readOnlyQuery(sql, params = []) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    const result = await client.query(sql, params);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, readOnlyQuery };
