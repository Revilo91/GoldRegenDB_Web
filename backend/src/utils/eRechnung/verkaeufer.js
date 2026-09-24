// Stammdaten des Rechnungsstellers (EN 16931 BG-4 Seller, BG-6 Contact, BG-17 Überweisung).
// Standardwerte entsprechen den bisher fest im Excel-Export hinterlegten Angaben;
// Steuernummer bzw. USt-IdNr. gibt es nur per Umgebungsvariable (siehe .env.example).

// Leere Werte (z. B. "${VAR:-}" aus docker-compose) gelten als nicht gesetzt
const env = (name, fallback = '') => (process.env[name] || '').trim() || fallback;

function getVerkaeufer() {
  return {
    firma: env('VERKAEUFER_FIRMA', 'Goldregen Schmuckdesign'),
    name: env('VERKAEUFER_NAME', 'Marina Südholt'),
    strasse: env('VERKAEUFER_STRASSE', 'Herzogin-Ludmilla-Ring 5'),
    plz: env('VERKAEUFER_PLZ', '84085'),
    ort: env('VERKAEUFER_ORT', 'Langquaid'),
    land: env('VERKAEUFER_LAND', 'DE').toUpperCase(),
    telefon: env('VERKAEUFER_TELEFON', '0152 22731186'),
    email: env('VERKAEUFER_EMAIL', 'goldregen.schmuckdesign@gmail.com'),
    website: env('VERKAEUFER_WEBSITE', 'www.goldregenschmuckdesign.de'),
    bank: env('VERKAEUFER_BANK', 'UniCredit Bank AG'),
    iban: env('VERKAEUFER_IBAN', 'DE51750200730029262020').replace(/\s+/g, '').toUpperCase(),
    bic: env('VERKAEUFER_BIC', 'HYVEDEMM447').replace(/\s+/g, '').toUpperCase(),
    steuernummer: env('VERKAEUFER_STEUERNUMMER'),
    ustIdNr: env('VERKAEUFER_USTIDNR').replace(/\s+/g, '').toUpperCase(),
  };
}

const formatIban = (iban) => iban.replace(/(.{4})(?=.)/g, '$1 ');

module.exports = { getVerkaeufer, formatIban };
