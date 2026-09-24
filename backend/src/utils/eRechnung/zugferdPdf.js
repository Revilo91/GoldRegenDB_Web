// ZUGFeRD 2 / Factur-X: sichtbare Rechnung als PDF/A-3b mit eingebetteter factur-x.xml (Profil EN 16931).
// PDF/A verlangt eingebettete Schriften, ein Output Intent (sRGB) und XMP-Metadaten inkl. Factur-X-Schema.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PDFDocument, PDFName, PDFHexString, PDFString, AFRelationship, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const { formatIban } = require('./verkaeufer');

const ASSETS = path.join(__dirname, '../../assets/erechnung/pdf');
const LOGO = path.join(ASSETS, 'logo.png');
const XML_DATEINAME = 'factur-x.xml';
const PRODUCER = 'GoldRegenDB';
const BOM = '\uFEFF'; // XMP-Paketkopf verlangt ein Byte-Order-Mark

const A4 = [595.28, 841.89];
const SCHWARZ = rgb(0, 0, 0);
const LINIE = rgb(0.737, 0.737, 0.737);
const KOPF = rgb(0.949, 0.949, 0.949);
const SUMME = rgb(0.737, 0.737, 0.737);

const euro = (c) => {
  const [ganz, dez] = (Math.abs(c) / 100).toFixed(2).split('.');
  return `${c < 0 ? '-' : ''}${ganz.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dez} €`;
};
const datumDe = (d) =>
  `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
const xmlEsc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function umbrechen(text, font, groesse, breite) {
  const zeilen = [];
  let zeile = '';
  for (const wort of String(text).split(/\s+/)) {
    const kandidat = zeile ? `${zeile} ${wort}` : wort;
    if (zeile && font.widthOfTextAtSize(kandidat, groesse) > breite) {
      zeilen.push(zeile);
      zeile = wort;
    } else {
      zeile = kandidat;
    }
  }
  if (zeile) zeilen.push(zeile);
  return zeilen.length ? zeilen : [''];
}

function xmpMetadaten({ titel, autor, jetzt }) {
  const iso = jetzt.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return `<?xpacket begin="${BOM}" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
   <pdfaid:part>3</pdfaid:part>
   <pdfaid:conformance>B</pdfaid:conformance>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
   <dc:format>application/pdf</dc:format>
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEsc(titel)}</rdf:li></rdf:Alt></dc:title>
   <dc:creator><rdf:Seq><rdf:li>${xmlEsc(autor)}</rdf:li></rdf:Seq></dc:creator>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
   <xmp:CreatorTool>${PRODUCER}</xmp:CreatorTool>
   <xmp:CreateDate>${iso}</xmp:CreateDate>
   <xmp:ModifyDate>${iso}</xmp:ModifyDate>
   <xmp:MetadataDate>${iso}</xmp:MetadataDate>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
   <pdf:Producer>${PRODUCER}</pdf:Producer>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">
   <fx:DocumentType>INVOICE</fx:DocumentType>
   <fx:DocumentFileName>${XML_DATEINAME}</fx:DocumentFileName>
   <fx:Version>1.0</fx:Version>
   <fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/"
    xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
   <pdfaExtension:schemas><rdf:Bag><rdf:li rdf:parseType="Resource">
    <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
    <pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>
    <pdfaSchema:prefix>fx</pdfaSchema:prefix>
    <pdfaSchema:property><rdf:Seq>${[
    ['DocumentFileName', 'Name of the embedded XML invoice file'],
    ['DocumentType', 'INVOICE'],
    ['Version', 'The actual version of the Factur-X XML schema'],
    ['ConformanceLevel', 'The conformance level of the embedded Factur-X data'],
  ].map(([name, beschreibung]) => `
     <rdf:li rdf:parseType="Resource">
      <pdfaProperty:name>${name}</pdfaProperty:name>
      <pdfaProperty:valueType>Text</pdfaProperty:valueType>
      <pdfaProperty:category>external</pdfaProperty:category>
      <pdfaProperty:description>${beschreibung}</pdfaProperty:description>
     </rdf:li>`).join('')}
    </rdf:Seq></pdfaSchema:property>
   </rdf:li></rdf:Bag></pdfaExtension:schemas>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

function pdfaAusstattung(doc, { titel, autor, jetzt }) {
  const ctx = doc.context;
  const xmp = ctx.stream(Buffer.from(xmpMetadaten({ titel, autor, jetzt }), 'utf8'), {
    Type: 'Metadata',
    Subtype: 'XML',
  });
  doc.catalog.set(PDFName.of('Metadata'), ctx.register(xmp));

  const icc = ctx.flateStream(fs.readFileSync(path.join(ASSETS, 'sRGB.icc')), { N: 3 });
  const outputIntent = ctx.obj({
    Type: 'OutputIntent',
    S: 'GTS_PDFA1',
    OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'),
    Info: PDFString.of('sRGB IEC61966-2.1'),
    DestOutputProfile: ctx.register(icc),
  });
  doc.catalog.set(PDFName.of('OutputIntents'), ctx.obj([ctx.register(outputIntent)]));

  const id = PDFHexString.of(crypto.randomBytes(16).toString('hex'));
  ctx.trailerInfo.ID = ctx.obj([id, id]);
}

async function erstelleZugferdPdf(m, xml) {
  const jetzt = new Date(Math.floor(Date.now() / 1000) * 1000);
  const v = m.verkaeufer;
  const k = m.kaeufer;
  const titel = `Rechnung ${m.nummer}`;

  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.registerFontkit(fontkit);
  const normal = await doc.embedFont(fs.readFileSync(path.join(ASSETS, 'NotoSans-Regular.ttf')), { subset: true });
  const fett = await doc.embedFont(fs.readFileSync(path.join(ASSETS, 'NotoSans-Bold.ttf')), { subset: true });
  const logo = fs.existsSync(LOGO) ? await doc.embedPng(fs.readFileSync(LOGO)) : null;

  doc.setTitle(titel);
  doc.setAuthor(v.firma);
  doc.setCreator(PRODUCER);
  doc.setProducer(PRODUCER);
  doc.setCreationDate(jetzt);
  doc.setModificationDate(jetzt);
  doc.setLanguage('de-DE');

  // Layout folgt dem Excel-Rechnungsexport (Maße in pt, gemessen von oben wie im Original)
  let seite;
  const text = (t, x, oben, { font = normal, groesse = 8.5, rechts = false, mitte = false } = {}) => {
    const breite = font.widthOfTextAtSize(String(t), groesse);
    const xPos = rechts ? x - breite : mitte ? x - breite / 2 : x;
    seite.drawText(String(t), { x: xPos, y: A4[1] - oben - groesse * 1.07, size: groesse, font, color: SCHWARZ });
  };
  const linie = (x1, x2, oben, farbe = LINIE) =>
    seite.drawLine({ start: { x: x1, y: A4[1] - oben }, end: { x: x2, y: A4[1] - oben }, thickness: 0.64, color: farbe });
  const senkrecht = (x, oben, unten) =>
    seite.drawLine({ start: { x, y: A4[1] - oben }, end: { x, y: A4[1] - unten }, thickness: 0.64, color: LINIE });
  const flaeche = (x1, x2, oben, hoehe, farbe) =>
    seite.drawRectangle({ x: x1, y: A4[1] - oben - hoehe, width: x2 - x1, height: hoehe, color: farbe });

  // Spaltengrenzen der Positionstabelle
  const X = [50.33, 99.75, 149.79, 367.32, 426.55, 479.87, 541.09];
  const ZEILE = 12.77;
  const INHALT_ENDE = 780; // darunter beginnt die Fußzeile

  neueSeite();

  function neueSeite() {
    seite = doc.addPage(A4);
  }

  // Kopf: Logo, Absenderzeile, Empfänger
  if (logo) seite.drawImage(logo, { x: 313.06, y: A4[1] - 251.55, width: 197.6, height: 197.6 });
  text(`${v.name} • ${v.strasse} • ${v.plz} ${v.ort}`, 51, 159, { groesse: 6.8 });
  linie(50.33, 312.94, 168.66, SCHWARZ);
  const empfaenger = [
    k.name, k.strasse, `${k.plz} ${k.ort}`,
    k.land !== 'DE' ? k.land : null,
    k.ustIdNr && `USt-IdNr.: ${k.ustIdNr}`,
  ].filter(Boolean);
  empfaenger.forEach((z, i) => text(z, 51, 182 + i * 12.6));

  // Titel und Rechnungsdaten
  text('Rechnung', 51, 242, { font: fett, groesse: 17 });
  text('Rechnung Nr.', 51, 279);
  text(m.nummer, 51, 292);
  if (m.kaeuferReferenz !== k.kundennummer) {
    text('Ihre Referenz', 200, 279);
    text(m.kaeuferReferenz, 200, 292);
  }
  text('Datum', 368, 279);
  text(datumDe(m.datum), 368, 292);
  linie(50.33, 541.09, 304.15);

  const einleitung = m.leistungszeitraum
    ? `Für die verkauften Artikel im Zeitraum vom ${datumDe(m.leistungszeitraum.von)} bis `
      + `${datumDe(m.leistungszeitraum.bis)} stellen wir Ihnen folgende Positionen in Rechnung:`
    : `Für die verkauften Artikel (Leistungsdatum ${datumDe(m.lieferdatum)}) stellen wir Ihnen folgende `
      + 'Positionen in Rechnung:';
  let oben = 317;
  for (const z of umbrechen(einleitung, normal, 8.5, X[6] - 51)) {
    text(z, 51, oben);
    oben += 12.6;
  }
  oben += 0.4;

  // Positionstabelle mit Gitter; Kopfzeile wird auf Folgeseiten wiederholt
  let tabelleOben;
  const tabellenkopf = () => {
    tabelleOben = oben;
    flaeche(X[0], X[6], oben, ZEILE, KOPF);
    linie(X[0], X[6], oben);
    ['Artikelnr.', 'Kategorie', 'Bezeichnung', 'Menge', 'Einzelpreis', 'Gesamtpreis']
      .forEach((t, i) => text(t, (X[i] + X[i + 1]) / 2, oben + 0.6, { font: fett, mitte: true }));
    oben += ZEILE;
    linie(X[0], X[6], oben);
  };
  const tabelleSchliessen = () => X.forEach((x) => senkrecht(x, tabelleOben, oben));

  tabellenkopf();
  for (const p of m.positionen) {
    const bezeichnung = p.rabattProzent > 0 ? `${p.bezeichnung} (Rabatt: ${p.rabattProzent}%)` : p.bezeichnung;
    const zeilen = umbrechen(bezeichnung, normal, 8.5, X[3] - X[2] - 3);
    const hoehe = zeilen.length * ZEILE;
    if (oben + hoehe > INHALT_ENDE) {
      tabelleSchliessen();
      neueSeite();
      oben = 60;
      tabellenkopf();
    }
    const t = oben + 0.6;
    text(p.artikelnummer, X[0] + 1, t);
    text(p.kategorie, X[1] + 1.5, t);
    zeilen.forEach((z, i) => text(z, X[2] + 1.5, t + i * ZEILE));
    text(p.menge, X[4] - 2, t, { rechts: true });
    text(euro(p.nettopreis), X[5] - 2, t, { rechts: true });
    text(euro(p.nettobetrag), X[6] - 2, t, { rechts: true });
    oben += hoehe;
    linie(X[0], X[6], oben);
  }
  tabelleSchliessen();

  // Summenblock (Darstellung wie im Excel-Export: Gesamtrabatt negativ, Provision als Betrag)
  const summen = [['Gesamtwert', null, m.summen.positionen]];
  for (const n of m.nachlaesse) {
    summen.push([`- ${n.grund}`, `${n.prozent} %`, n.grund === 'Provision' ? n.betrag : -n.betrag]);
  }
  const abschluss = [
    ...m.hinweise,
    'Bitte überweisen Sie den Rechnungsbetrag an u.g. Bankverbindung.',
    m.zahlung.bedingungen,
    'Vielen Dank',
  ];
  // Summen, Hinweise, Grußformel und Unterschrift bleiben zusammen auf einer Seite
  const benoetigt = 11.5 + summen.length * 13 + 39 + abschluss.length * 12.8 + 13 + 64;
  if (oben + benoetigt > INHALT_ENDE) {
    neueSeite();
    oben = 48;
  }
  oben += 11.5;
  for (const [label, prozent, betrag] of summen) {
    if (prozent) {
      text(label, X[4] - 1, oben, { font: fett, groesse: 9.3, rechts: true });
      text(prozent, X[4] + 1, oben, { font: fett, groesse: 9.3 });
    } else {
      text(label, 368, oben, { font: fett, groesse: 9.3 });
    }
    text(euro(betrag), X[6] - 2, oben + 0.8, { rechts: true });
    oben += 13;
  }
  flaeche(X[3], X[6], oben + 0.5, ZEILE, SUMME);
  text('Überweisungsbetrag', 368, oben, { font: fett, groesse: 9.3 });
  text(euro(m.summen.zahlbetrag), X[6] - 2, oben + 0.8, { rechts: true });
  linie(X[5], X[6], oben + 13.3, SCHWARZ);
  linie(X[5], X[6], oben + 14.6, SCHWARZ);

  oben += 39;
  for (const h of abschluss) {
    for (const z of umbrechen(h, normal, 8.5, X[6] - 51)) {
      text(z, 51, oben);
      oben += 12.8;
    }
  }
  oben += 13;
  text('Mit freundlichen Grüßen', 51, oben);
  linie(50.33, 258, oben + 48);
  text(v.name, 51, oben + 51);

  // Fußzeile wie im Excel-Export: links Anschrift, Mitte Kontakt, rechts Bankverbindung
  const seiten = doc.getPages();
  const steuerangabe = v.ustIdNr ? `USt-IdNr.: ${v.ustIdNr}` : `Steuernummer: ${v.steuernummer}`;
  seiten.forEach((s, i) => {
    seite = s;
    [v.firma, v.name, `${v.strasse} • ${v.plz} ${v.ort}`, steuerangabe]
      .forEach((z, j) => text(z, 52, 792 + j * 9.5, { groesse: 6.8 }));
    [v.telefon, v.email, v.website].filter(Boolean)
      .forEach((z, j) => text(z, A4[0] / 2, 792 + j * 9.5, { groesse: 6.8, mitte: true }));
    [v.bank, formatIban(m.zahlung.iban), m.zahlung.bic].filter(Boolean)
      .forEach((z, j) => text(z, 543, 792 + j * 9.5, { groesse: 6.8, rechts: true }));
    if (seiten.length > 1) text(`Seite ${i + 1} von ${seiten.length}`, 543, 822, { groesse: 6.8, rechts: true });
  });

  await doc.attach(Buffer.from(xml, 'utf8'), XML_DATEINAME, {
    mimeType: 'text/xml',
    description: 'Factur-X / ZUGFeRD Rechnungsdaten (EN 16931)',
    creationDate: jetzt,
    modificationDate: jetzt,
    afRelationship: AFRelationship.Alternative,
  });
  pdfaAusstattung(doc, { titel, autor: v.firma, jetzt });

  return Buffer.from(await doc.save());
}

module.exports = { erstelleZugferdPdf, XML_DATEINAME };
