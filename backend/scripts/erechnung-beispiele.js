#!/usr/bin/env node
// Erzeugt Beispiel-E-Rechnungen (XRechnung-XML, ZUGFeRD-PDF und dessen factur-x.xml) mit dem
// echten Generator – für die Prüfung mit dem offiziellen KoSIT-Validator bzw. Mustang/veraPDF
// (siehe .github/workflows/tests.yml, Job "erechnung-validator").
//
//   node scripts/erechnung-beispiele.js <zielordner>
const fs = require('fs');
const path = require('path');
const { PDFDocument, PDFName, decodePDFRawStream } = require('pdf-lib');
const { erstelleERechnung } = require('../src/utils/eRechnung');

process.env.VERKAEUFER_STEUERNUMMER ||= '201/123/45678';

const stueck = (Artikelnummer, Verkaufspreis, extra = {}) =>
  ({ Artikelnummer, Verkaufspreis, Lieferschein_ID: 1, ...extra });

const BEISPIELE = {
  // Kommissionsware mit Positions- und Gesamtrabatt, Provision und Leistungszeitraum aus Lieferscheinen
  kommission: {
    rechnung: {
      Nummer: '2026-101', Datum: '2026-09-01T09:00:00Z', status: 'final',
      rabatt_gesamt: '5.00', rabatt_positionen: { MHO123: 10 },
    },
    kunde: {
      ID: 12, Name: 'Boutique Sonnenschein', Strasse: 'Marktplatz', Hausnummer: 4, PLZ: 1067, Ort: 'Dresden',
      Email: 'einkauf@boutique.example', Provision: 30, Land: 'DE',
    },
    schmuckstuecke: [
      stueck('MHO123_1', 34.9, { Art: 'Creole', Form: 'rund', Farbe: 'gold' }),
      stueck('MHO123_2', 34.9, { Art: 'Creole', Form: 'rund', Farbe: 'gold' }),
      stueck('MSH042_1', 59, { Name: 'Kette „Sonnenblume“ & Anhänger' }),
      stueck('MSA007_1', 27.5, { Art: 'Armband', Farbe: 'silber', Anhänger: 'Herz' }),
    ],
    leistungszeitraum: { von: '2026-07-03', bis: '2026-08-28' },
  },
  // Direktverkauf ohne Lieferschein und Provision an einen Kunden in Österreich mit USt-IdNr. und Leitweg-ID
  ausland: {
    rechnung: {
      Nummer: '2026-102', Datum: '2026-09-15T09:00:00Z', status: 'final', rabatt_gesamt: '0', rabatt_positionen: {},
    },
    kunde: {
      ID: 31, Name: 'Galerie Alpenglühen GmbH', Strasse: 'Getreidegasse', Hausnummer: 9, PLZ: 5020, Ort: 'Salzburg',
      Email: 'rechnung@galerie.example', Provision: 0, Land: 'AT', UStIdNr: 'ATU12345678', Leitweg_ID: 'PO-2026-0815',
    },
    schmuckstuecke: [stueck('MHO200_1', 120, { Lieferschein_ID: 0, Name: 'Ohrhänger Bergkristall' })],
    leistungszeitraum: null,
  },
};

async function eingebettetesXml(pdf) {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const anhang = doc.catalog.lookup(PDFName.of('AF')).lookup(0);
  return Buffer.from(decodePDFRawStream(anhang.lookup(PDFName.of('EF')).lookup(PDFName.of('F'))).decode());
}

(async () => {
  const ziel = path.resolve(process.argv[2] || 'erechnung-beispiele');
  fs.mkdirSync(ziel, { recursive: true });

  for (const [name, daten] of Object.entries(BEISPIELE)) {
    const xrechnung = await erstelleERechnung(daten, 'xrechnung');
    fs.writeFileSync(path.join(ziel, `${name}-xrechnung.xml`), xrechnung.inhalt);

    const zugferd = await erstelleERechnung(daten, 'zugferd');
    fs.writeFileSync(path.join(ziel, `${name}-zugferd.pdf`), zugferd.inhalt);
    fs.writeFileSync(path.join(ziel, `${name}-zugferd-factur-x.xml`), await eingebettetesXml(zugferd.inhalt));
  }
  console.log(`Beispiel-E-Rechnungen geschrieben nach ${ziel}`);
})().catch((err) => {
  console.error(err.message, err.fehler || '');
  process.exit(1);
});
