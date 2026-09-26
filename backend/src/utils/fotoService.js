const path = require('path');
const crypto = require('crypto');

const MAX_FOTO_BYTES = 5 * 1024 * 1024;
const PNG_SIGNATUR = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DATA_URL_REGEX = /^data:image\/(?:jpeg|png|gif);base64,([A-Za-z0-9+/=]+)$/;

// Beide Foto-Tabellen haben denselben Aufbau, nur die Spaltennamen folgen der
// Konvention ihres Bereichs (Schmuckstück: "Groß", Bestellung: snake_case).
const TABELLEN = {
  schmuckstueck: {
    tabelle: '"Foto"', schluessel: '"Artikelnummer"', daten: '"Daten"',
    mimeType: '"MimeType"', groesse: '"Groesse"', geaendert: '"Geaendert"',
  },
  bestellung: {
    tabelle: 'bestellung_foto', schluessel: 'datei_name', daten: 'daten',
    mimeType: 'mime_type', groesse: 'groesse', geaendert: 'geaendert',
  },
};

// Katalognamen, unter denen die JSON-Sicherung die Tabellen findet.
const FOTO_TABELLEN = Object.values(TABELLEN).map((t) => t.tabelle.replace(/"/g, ''));

class FotoFehler extends Error {}

// Typ aus den ersten Bytes, nicht aus Endung oder vom Client gemeldetem MIME-Typ.
function erkenneBildtyp(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 6) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(PNG_SIGNATUR)) return 'image/png';
  const kopf = buffer.subarray(0, 6).toString('latin1');
  if (kopf === 'GIF87a' || kopf === 'GIF89a') return 'image/gif';
  return null;
}

function pruefeBild(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new FotoFehler('Keine Bilddaten übermittelt');
  }
  if (buffer.length > MAX_FOTO_BYTES) {
    throw new FotoFehler('Foto ist zu groß (max. 5 MB)');
  }
  const mimeType = erkenneBildtyp(buffer);
  if (!mimeType) {
    throw new FotoFehler('Nur JPG, PNG und GIF Dateien sind erlaubt');
  }
  return mimeType;
}

// "MHO123_2", "MHO123.jpg" und "uploads/MHO123_1.png" teilen sich das Foto "MHO123".
function basisArtikelnummer(identifier) {
  const name = path.basename(String(identifier || '').trim());
  const basis = path.parse(name.split('_')[0]).name.toUpperCase();
  return basis.length > 0 && basis.length <= 20 ? basis : null;
}

// Referenzfoto aus dem Bestellformular: Data-URL prüfen, bevor die Transaktion beginnt.
function leseDataUrl(dataUrl) {
  const match = DATA_URL_REGEX.exec(dataUrl || '');
  if (!match) {
    throw new FotoFehler('Foto muss als JPG-, PNG- oder GIF-Bild übermittelt werden');
  }
  const buffer = Buffer.from(match[1], 'base64');
  return { buffer, mimeType: pruefeBild(buffer) };
}

function neuerBestellungFotoName() {
  return crypto.randomBytes(16).toString('hex');
}

async function speichereFoto(queryable, art, schluessel, buffer) {
  const t = TABELLEN[art];
  const mimeType = pruefeBild(buffer);
  await queryable.query(
    `INSERT INTO ${t.tabelle} (${t.schluessel}, ${t.daten}, ${t.mimeType}, ${t.groesse}, ${t.geaendert})
     VALUES ($1, $2, $3, $4, clock_timestamp())
     ON CONFLICT (${t.schluessel}) DO UPDATE SET
       ${t.daten} = EXCLUDED.${t.daten}, ${t.mimeType} = EXCLUDED.${t.mimeType},
       ${t.groesse} = EXCLUDED.${t.groesse}, ${t.geaendert} = EXCLUDED.${t.geaendert}`,
    [schluessel, buffer, mimeType, buffer.length],
  );
  return mimeType;
}

async function loescheFoto(queryable, art, schluessel) {
  const t = TABELLEN[art];
  const { rowCount } = await queryable.query(
    `DELETE FROM ${t.tabelle} WHERE ${t.schluessel} = $1`,
    [schluessel],
  );
  return rowCount > 0;
}

// Für das Foto-ZIP: alles außer den Bilddaten. octet_length liest bei
// ausgelagerten Werten nur den TOAST-Zeiger, nicht das Bild.
async function listeFotos(queryable, art) {
  const t = TABELLEN[art];
  const { rows } = await queryable.query(
    `SELECT ${t.schluessel} AS schluessel, ${t.mimeType} AS "mimeType",
            octet_length(${t.daten}) AS groesse, ${t.geaendert} AS geaendert
       FROM ${t.tabelle} ORDER BY ${t.schluessel}`,
  );
  return rows;
}

async function ladeFotoDaten(queryable, art, schluessel) {
  const t = TABELLEN[art];
  const { rows } = await queryable.query(
    `SELECT ${t.daten} AS daten FROM ${t.tabelle} WHERE ${t.schluessel} = $1`,
    [schluessel],
  );
  return rows.length > 0 ? rows[0].daten : null;
}

// Ein Tag aus If-None-Match ('"123"', 'W/"123"', Liste) ohne Anführungszeichen.
function ersterEtag(ifNoneMatch) {
  if (!ifNoneMatch) return null;
  return ifNoneMatch.split(',')[0].trim().replace(/^W\//, '').replace(/"/g, '') || null;
}

// Liefert das Foto mit ETag aus. Stimmt der ETag des Browsers, kommt 304 –
// die Bilddaten werden dann gar nicht erst aus der Datenbank gelesen.
// Gibt false zurück, wenn es kein Foto gibt; der Aufrufer antwortet dann selbst.
async function sendeFoto(req, res, queryable, art, schluessel) {
  const t = TABELLEN[art];
  const version = `(extract(epoch FROM ${t.geaendert}) * 1000000)::bigint::text`;
  const { rows } = await queryable.query(
    `SELECT ${t.mimeType} AS "mimeType", ${version} AS version,
            CASE WHEN ${version} = $2 THEN NULL ELSE ${t.daten} END AS daten
       FROM ${t.tabelle} WHERE ${t.schluessel} = $1`,
    [schluessel, ersterEtag(req.get('If-None-Match'))],
  );
  if (rows.length === 0) return false;

  const { mimeType, version: aktuell, daten } = rows[0];
  // Ohne Cache-Header lädt jede Tabellenseite dieselben Fotos erneut.
  // max-age=60 hält die Anzeige nach einem Neu-Upload trotzdem aktuell,
  // danach beantwortet der ETag-Abgleich die meisten Anfragen mit 304.
  res.set('Cache-Control', 'private, max-age=60');
  res.set('ETag', `"${aktuell}"`);
  if (daten === null) {
    res.status(304).end();
  } else {
    res.type(mimeType).send(daten);
  }
  return true;
}

module.exports = {
  MAX_FOTO_BYTES,
  FOTO_TABELLEN,
  FotoFehler,
  erkenneBildtyp,
  pruefeBild,
  basisArtikelnummer,
  leseDataUrl,
  neuerBestellungFotoName,
  speichereFoto,
  loescheFoto,
  listeFotos,
  ladeFotoDaten,
  sendeFoto,
};
