const path = require('path');
const { Readable } = require('stream');
const yazl = require('yazl');
const yauzl = require('yauzl');
const {
  MAX_FOTO_BYTES,
  FotoFehler,
  basisArtikelnummer,
  speichereFoto,
  listeFotos,
  ladeFotoDaten,
} = require('./fotoService');

// Foto-Sicherung als ZIP direkt aus der Datenbank. In der JSON-Sicherung
// wären die Bilder (rund 1,6 GB) base64-kodiert im Request-Body – weit über dem
// Body-Limit. Das ZIP wird gestreamt: im Speicher liegt immer nur ein Foto.

const ARTEN = ['schmuckstueck', 'bestellung'];
const ENDUNG = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif' };
const BESTELLUNG_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;
const MAX_DETAILS = 100;

// Der Export hängt die Endung immer an, der Import schneidet sie immer ab –
// so kommt auch ein Altname wie "abc.jpg" unverändert zurück.
function eintragsName(art, schluessel, mimeType) {
  return `${art}/${schluessel}.${ENDUNG[mimeType] || 'bin'}`;
}

function zerlegeEintragsName(name) {
  const teile = String(name).split('/');
  if (teile.length !== 2 || !ARTEN.includes(teile[0])) return null;
  const [art, datei] = teile;
  const endung = path.extname(datei);
  if (!endung) return null;
  const ohneEndung = datei.slice(0, -endung.length);
  if (art === 'schmuckstueck') {
    const basis = basisArtikelnummer(ohneEndung);
    return basis && basis === ohneEndung.toUpperCase() ? { art, schluessel: basis } : null;
  }
  return BESTELLUNG_NAME.test(ohneEndung) ? { art, schluessel: ohneEndung } : null;
}

// Bilddaten erst holen, wenn yazl den Eintrag tatsächlich schreibt.
async function* fotoDaten(queryable, art, schluessel, signal) {
  if (signal?.aborted) return;
  const daten = await ladeFotoDaten(queryable, art, schluessel);
  if (daten) yield daten;
}

// Liefert den ZIP-Stream und dessen Länge (für Content-Length). Der
// Aufrufer hält queryable in einer REPEATABLE-READ-Transaktion, sonst passt
// die gelistete Größe eines zwischendurch geänderten Fotos nicht mehr.
async function erstelleFotoZip(queryable, signal) {
  const zip = new yazl.ZipFile();
  const abbrechen = (err) => zip.outputStream.destroy(err);
  zip.on('error', abbrechen);

  let anzahl = 0;
  for (const art of ARTEN) {
    for (const foto of await listeFotos(queryable, art)) {
      const daten = Readable.from(fotoDaten(queryable, art, foto.schluessel, signal), {
        objectMode: false,
      });
      daten.on('error', abbrechen);
      zip.addReadStream(daten, eintragsName(art, foto.schluessel, foto.mimeType), {
        compress: false, // JPEG/PNG/GIF sind bereits komprimiert
        mtime: foto.geaendert,
        size: foto.groesse,
      });
      anzahl += 1;
    }
  }

  const groesse = await new Promise((resolve) => zip.end(resolve));
  return { stream: zip.outputStream, anzahl, groesse };
}

function oeffneZip(pfad) {
  return new Promise((resolve, reject) => {
    yauzl.open(pfad, { lazyEntries: true, autoClose: false }, (err, zip) =>
      err ? reject(err) : resolve(zip),
    );
  });
}

function naechsterEintrag(zip) {
  return new Promise((resolve, reject) => {
    const aufraeumen = () => {
      zip.off('entry', beiEintrag);
      zip.off('end', beiEnde);
      zip.off('error', beiFehler);
    };
    const beiEintrag = (eintrag) => { aufraeumen(); resolve(eintrag); };
    const beiEnde = () => { aufraeumen(); resolve(null); };
    const beiFehler = (err) => { aufraeumen(); reject(err); };
    zip.on('entry', beiEintrag);
    zip.on('end', beiEnde);
    zip.on('error', beiFehler);
    zip.readEntry();
  });
}

async function leseEintrag(zip, eintrag) {
  const stream = await new Promise((resolve, reject) => {
    zip.openReadStream(eintrag, (err, s) => (err ? reject(err) : resolve(s)));
  });
  const teile = [];
  for await (const teil of stream) teile.push(teil);
  return Buffer.concat(teile);
}

// Fotos aus dem ZIP per Upsert übernehmen. Vorhandene Fotos, die nicht im ZIP
// stehen, bleiben erhalten; ein abgebrochener Import lässt sich wiederholen.
async function importiereFotoZip(pfad, queryable, beiFortschritt = () => {}) {
  const stand = {
    gesamt: 0,
    verarbeitet: 0,
    gespeichert: { schmuckstueck: 0, bestellung: 0 },
    uebersprungen: 0,
    uebersprungenDetails: [],
  };
  const uebergehe = (datei, grund) => {
    stand.uebersprungen += 1;
    if (stand.uebersprungenDetails.length < MAX_DETAILS) {
      stand.uebersprungenDetails.push({ datei, grund });
    }
  };

  const zip = await oeffneZip(pfad);
  try {
    stand.gesamt = zip.entryCount;
    beiFortschritt(stand);
    for (let eintrag = await naechsterEintrag(zip); eintrag; eintrag = await naechsterEintrag(zip)) {
      const ziel = zerlegeEintragsName(eintrag.fileName);
      if (eintrag.fileName.endsWith('/')) {
        // Verzeichniseintrag, kein Foto
      } else if (!ziel) {
        uebergehe(eintrag.fileName, 'Unbekannter Pfad (erwartet schmuckstueck/… oder bestellung/…)');
      } else if (eintrag.uncompressedSize > MAX_FOTO_BYTES) {
        uebergehe(eintrag.fileName, 'Foto ist zu groß (max. 5 MB)');
      } else {
        try {
          await speichereFoto(queryable, ziel.art, ziel.schluessel, await leseEintrag(zip, eintrag));
          stand.gespeichert[ziel.art] += 1;
        } catch (err) {
          if (!(err instanceof FotoFehler)) throw err;
          uebergehe(eintrag.fileName, err.message);
        }
      }
      stand.verarbeitet += 1;
      beiFortschritt(stand);
    }
  } finally {
    zip.close();
  }
  return stand;
}

module.exports = { eintragsName, zerlegeEintragsName, erstelleFotoZip, importiereFotoZip };
