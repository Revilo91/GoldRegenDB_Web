// @ts-check

// Postgres liest POSTGRES_PASSWORD nur beim ersten Anlegen des Volumes
// (pgdata_dev). Ändert sich der Wert später in .env, bleibt das alte Passwort in
// der Datenbank – der Hinweis nennt deshalb genau diese Falle und die Reparatur.
const HINWEIS_PASSWORT_FEHLGESCHLAGEN = [
  'Das Passwort passt nicht zur Datenbank (POSTGRES_PASSWORD in .env).',
  'Postgres übernimmt POSTGRES_PASSWORD nur beim ersten Anlegen des Volumes pgdata_dev,',
  'eine spätere Änderung in .env wirkt also nicht.',
  'Lösung: Passwort in der Datenbank angleichen, z. B.',
  "docker compose -f docker-compose.dev.yml exec db psql -U goldregen -d goldregendb -c \"ALTER ROLE goldregen PASSWORD '<POSTGRES_PASSWORD aus .env>'\"",
].join(' ');

/**
 * Liefert einen Reparaturhinweis zu einem bekannten Datenbankfehler, sonst null.
 *
 * @param {{ code?: string } | null | undefined} err
 * @returns {string | null}
 */
function dbFehlerHinweis(err) {
  if (err?.code === '28P01') {
    return HINWEIS_PASSWORT_FEHLGESCHLAGEN;
  }
  return null;
}

module.exports = { dbFehlerHinweis };
