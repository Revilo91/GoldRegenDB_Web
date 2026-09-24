const { PROFILE, buildRechnungsModell, pruefePflichtangaben } = require('./modell');
const { toCII } = require('./cii');
const { validiereCII } = require('./validator');
const { erstelleZugferdPdf } = require('./zugferdPdf');
const { getVerkaeufer } = require('./verkaeufer');

const FORMATE = {
  xrechnung: { profil: 'xrechnung', endung: 'xml', mimeType: 'application/xml' },
  zugferd: { profil: 'zugferd', endung: 'pdf', mimeType: 'application/pdf' },
};

class ERechnungFehler extends Error {
  constructor(message, fehler) {
    super(message);
    this.fehler = fehler;
  }
}

// daten: { rechnung, kunde, schmuckstuecke, leistungszeitraum }
// Wirft ERechnungFehler, wenn Pflichtangaben fehlen oder das XML die EN-16931-/XRechnung-Prüfung nicht besteht.
async function erstelleERechnung(daten, format) {
  const { profil, endung, mimeType } = FORMATE[format];
  const modell = buildRechnungsModell({ ...daten, verkaeufer: getVerkaeufer() }, profil);

  const fehlend = pruefePflichtangaben(modell);
  if (fehlend.length > 0) {
    throw new ERechnungFehler('E-Rechnung kann nicht erstellt werden: Pflichtangaben fehlen.', fehlend);
  }

  const xml = toCII(modell);
  const pruefung = await validiereCII(xml, profil);
  if (!pruefung.gueltig) {
    throw new ERechnungFehler(
      `Die erzeugte E-Rechnung verletzt Regeln von ${PROFILE[profil].name}.`,
      pruefung.fehler.map((f) => ({ bt: f.regel, feld: f.regel, meldung: f.meldung })),
    );
  }

  const inhalt = format === 'zugferd' ? await erstelleZugferdPdf(modell, xml) : Buffer.from(xml, 'utf8');
  return {
    inhalt,
    mimeType,
    dateiname: `Rechnung_${modell.nummer}_${format === 'zugferd' ? 'ZUGFeRD' : 'XRechnung'}.${endung}`,
    warnungen: pruefung.warnungen,
  };
}

module.exports = { FORMATE, erstelleERechnung, ERechnungFehler };
