const { getSecret } = require('./secrets');

// Die URL wird aus POSTGRES_USER, POSTGRES_PASSWORD und POSTGRES_DB gebaut,
// dieselben Werte, die auch der Postgres-Container verwendet. So steht das
// Passwort nur einmal in der .env. DB_HOST ist im Container "db" (Standard),
// nativ (npm run dev) muss es in der .env auf localhost stehen.
// Eine gesetzte DATABASE_URL (bzw. DATABASE_URL_FILE) hat Vorrang, damit
// bestehende Installationen unverändert weiterlaufen.
function buildConnectionString() {
  const explicit = getSecret('DATABASE_URL');
  if (explicit) {
    return explicit;
  }
  const user = process.env.POSTGRES_USER;
  const password = getSecret('POSTGRES_PASSWORD');
  const database = process.env.POSTGRES_DB;
  if (!user || !password || !database) {
    return undefined;
  }
  const host = process.env.DB_HOST || 'db';
  const port = process.env.DB_PORT || '5432';
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

module.exports = { buildConnectionString };
