const crypto = require('crypto');
const { encryptField, decryptField, hashValue } = require('./encryptionService');

const PRIVACY_POLICY_VERSION = process.env.PRIVACY_POLICY_VERSION || 'unbekannt';

function formatBestellnummer(jahr, laufnummer) {
  return `BE-${jahr}-${String(laufnummer).padStart(3, '0')}`;
}

async function getNextBestellnummer(queryable) {
  const aktuellesJahr = new Date().getFullYear();
  const { rows } = await queryable.query(
    `SELECT COALESCE(MAX(CAST(SPLIT_PART("bestellnummer", '-', 3) AS INTEGER)), 0) AS max_num
     FROM bestellung
     WHERE bestellnummer ~ $1`,
    [`^BE-${aktuellesJahr}-[0-9]+$`]
  );
  return formatBestellnummer(aktuellesJahr, Number(rows[0].max_num) + 1);
}

function generateKundePseudonym() {
  return `BK-${crypto.randomBytes(6).toString('hex')}`;
}

function decryptKunde(row) {
  return {
    kundeId: row.kunde_id,
    kundePseudonym: row.kunde_pseudonym,
    anonymisiert: row.anonymisiert,
    anonymisiertAm: row.anonymisiert_am,
    name: decryptField(row.name_enc),
    email: decryptField(row.email_enc),
    telefonnummer: decryptField(row.telefonnummer_enc),
    strasse: decryptField(row.strasse_enc),
    hausnummer: decryptField(row.hausnummer_enc),
    plz: decryptField(row.plz_enc),
    ort: decryptField(row.ort_enc),
  };
}

function toBestellungResponse(row) {
  // Kunde-Felder werden bewusst ausgeschlossen, decryptKunde() liest sie direkt aus `row`.
  const { kunde_id: _kunde_id, kunde_pseudonym: _kunde_pseudonym, anonymisiert: _anonymisiert,
    anonymisiert_am: _anonymisiert_am, name_enc: _name_enc, email_enc: _email_enc,
    telefonnummer_enc: _telefonnummer_enc, strasse_enc: _strasse_enc, hausnummer_enc: _hausnummer_enc,
    plz_enc: _plz_enc, ort_enc: _ort_enc, ...bestellung } = row;
  return {
    ...bestellung,
    kunde: decryptKunde(row),
  };
}

// Datenminimierung serverseitig prüfen (Frontend + DB-Trigger sind die anderen zwei Ebenen).
function validateDatenminimierung(versandart, kunde) {
  if (!kunde?.name?.trim()) {
    return 'Name ist erforderlich';
  }
  if (!kunde.telefonnummer?.trim()) {
    return 'Telefonnummer ist erforderlich';
  }
  if (versandart === 'lieferung') {
    if (!kunde.strasse?.trim() || !kunde.hausnummer?.toString().trim() || !kunde.plz?.toString().trim() || !kunde.ort?.trim()) {
      return 'Versandart "Lieferung" erfordert eine vollständige Adresse';
    }
  } else if (versandart !== 'abholung') {
    return 'Ungültige Versandart';
  }
  return null;
}

// Legt Kunde + Consent + Bestellung innerhalb einer laufenden Transaktion (BEGIN/LOCK bereits vom Aufrufer gesetzt) an.
async function insertBestellung(client, { versandart, wunschdatum, beschreibung, kunde, ip, erstelltVon, fotoPfad }) {
  const kundePseudonym = generateKundePseudonym();
  const { rows: kundeRows } = await client.query(
    `INSERT INTO bestellung_kunde
       (kunde_pseudonym, name_enc, email_enc, telefonnummer_enc, strasse_enc, hausnummer_enc, plz_enc, ort_enc)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      kundePseudonym,
      encryptField(kunde.name),
      encryptField(kunde.email),
      encryptField(kunde.telefonnummer),
      encryptField(kunde.strasse),
      encryptField(kunde.hausnummer),
      encryptField(kunde.plz),
      encryptField(kunde.ort),
    ]
  );
  const kundeId = kundeRows[0].id;

  // Consent-Zeitpunkt wird serverseitig gesetzt – niemals vom Client übernommen.
  await client.query(
    `INSERT INTO bestellung_consent (kunde_id, consent_erteilt, datenschutz_version, ip_hash)
     VALUES ($1, $2, $3, $4)`,
    [kundeId, true, PRIVACY_POLICY_VERSION, hashValue(ip)]
  );

  const bestellnummer = await getNextBestellnummer(client);
  const { rows } = await client.query(
    `INSERT INTO bestellung (bestellnummer, kunde_id, versandart, wunschdatum, beschreibung, erstellt_von, foto_pfad)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [bestellnummer, kundeId, versandart, wunschdatum || null, beschreibung.trim(), erstelltVon, fotoPfad || null]
  );

  return { bestellungRow: rows[0], kundeId, kundePseudonym };
}

module.exports = {
  PRIVACY_POLICY_VERSION,
  formatBestellnummer,
  getNextBestellnummer,
  generateKundePseudonym,
  decryptKunde,
  toBestellungResponse,
  validateDatenminimierung,
  insertBestellung,
};
