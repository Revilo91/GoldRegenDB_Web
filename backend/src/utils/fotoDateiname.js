const path = require('path');
const { basisArtikelnummer } = require('./fotoService');

const ERLAUBTE_ENDUNGEN = new Set(['.jpg', '.jpeg', '.png', '.gif']);
const EINE_NUMMER = /^[A-Z]+\d+(?:_\d+)?$/i;
const NUMMER_TEIL = /^[A-Z]+\d+$/i;

// Ordnet einen Dateinamen aus dem Bestandsimport einer Basis-Artikelnummer zu.
// "MBH004.jpg" und "MBH004_2.jpg" → MBH004; "MBH004_MBH005.jpg" → mehrere.
function analysiereDateiname(dateiName) {
  const { name, ext } = path.parse(dateiName);
  if (!ERLAUBTE_ENDUNGEN.has(ext.toLowerCase())) {
    return { status: 'endung' };
  }

  const nummern = name.split(/[^A-Z0-9]+/i).filter((teil) => NUMMER_TEIL.test(teil));
  if (nummern.length > 1) {
    return { status: 'mehrere', nummern: nummern.map((n) => n.toUpperCase()) };
  }
  if (nummern.length === 0) {
    return { status: 'ohneNummer' };
  }

  const basis = EINE_NUMMER.test(name) ? basisArtikelnummer(dateiName) : null;
  return basis ? { status: 'ok', basis } : { status: 'unklar' };
}

module.exports = { analysiereDateiname };
