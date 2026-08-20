const fs = require('fs');

// Platzhalter aus .env.example – dürfen in Produktion niemals scharf laufen.
const PLACEHOLDER_MARKERS = ['change-this', 'changeme'];

// Liest ein Secret bevorzugt aus einer Datei (Docker Secrets: `<NAME>_FILE`,
// typischerweise /run/secrets/...), sonst aus der normalen Umgebungsvariable
// `<NAME>`. Reine Env-Var-Nutzer sind davon nicht betroffen – ohne `<NAME>_FILE`
// verhält sich getSecret() wie process.env[name].
function getSecret(name) {
  const filePath = process.env[`${name}_FILE`];
  if (!filePath) {
    return process.env[name];
  }
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch (err) {
    throw new Error(`Secret-Datei für ${name} (${filePath}) konnte nicht gelesen werden: ${err.message}`);
  }
}

function pruefeSecret(name, value, { minLength = 20 } = {}) {
  const probleme = [];
  if (!value) {
    return probleme; // Fehlen wird an der jeweiligen Verwendungsstelle bereits erzwungen
  }
  if (PLACEHOLDER_MARKERS.some((marker) => value.includes(marker))) {
    probleme.push(`${name} verwendet noch einen Platzhalterwert aus .env.example`);
  }
  if (value.length < minLength) {
    probleme.push(`${name} ist zu kurz (${value.length} von mindestens ${minLength} Zeichen)`);
  }
  return probleme;
}

// Bricht in Produktion mit einer Fehlerliste ab, wenn Secrets noch
// Platzhalter sind oder zu kurz ausfallen. Im Dev-Betrieb (NODE_ENV !==
// 'production') liefert die Funktion immer eine leere Liste – dort blockiert
// nichts den Start.
function validateProductionSecrets(secrets) {
  if (process.env.NODE_ENV !== 'production') {
    return [];
  }
  return secrets.flatMap(({ name, value, minLength }) => pruefeSecret(name, value, { minLength }));
}

// Extrahiert das Passwort aus einer postgresql://user:pass@host/db-URL – für
// Fälle, in denen nur DATABASE_URL gesetzt ist (nicht DB_PASSWORD direkt,
// z.B. weil Docker Compose sie aus DB_PASSWORD zusammensetzt).
function extractDatabaseUrlPassword(url) {
  const match = url ? url.match(/:\/\/[^:/@]+:([^@]+)@/) : null;
  return match ? decodeURIComponent(match[1]) : undefined;
}

module.exports = { getSecret, validateProductionSecrets, extractDatabaseUrlPassword };
