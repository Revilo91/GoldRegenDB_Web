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
const RAND = 56;
const FUSS_HOEHE = 70;
const GRAU = rgb(0.45, 0.45, 0.45);
const LINIE = rgb(0.74, 0.74, 0.74);

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
  const normal = await doc.embedFont(fs.readFileSync(path.join(ASSETS, 'DejaVuSans.ttf')), { subset: true });
  const fett = await doc.embedFont(fs.readFileSync(path.join(ASSETS, 'DejaVuSans-Bold.ttf')), { subset: true });
  const logo = fs.existsSync(LOGO) ? await doc.embedPng(fs.readFileSync(LOGO)) : null;

  doc.setTitle(titel);
  doc.setAuthor(v.firma);
  doc.setCreator(PRODUCER);
  doc.setProducer(PRODUCER);
  doc.setCreationDate(jetzt);
  doc.setModificationDate(jetzt);
  doc.setLanguage('de-DE');

  const breite = A4[0] - 2 * RAND;
  let seite;
  let y;

  const text = (t, x, yPos, { font = normal, groesse = 9, farbe, rechts = false } = {}) => {
    const xPos = rechts ? x - font.widthOfTextAtSize(String(t), groesse) : x;
    seite.drawText(String(t), { x: xPos, y: yPos, size: groesse, font, color: farbe });
  };
  const linie = (yPos, dicke = 0.5) =>
    seite.drawLine({ start: { x: RAND, y: yPos }, end: { x: A4[0] - RAND, y: yPos }, thickness: dicke, color: LINIE });

  const spalten = [
    { titel: 'Pos.', x: RAND },
    { titel: 'Artikelnr.', x: RAND + 28 },
    { titel: 'Bezeichnung', x: RAND + 95 },
    { titel: 'Menge', x: RAND + 330, rechts: true },
    { titel: 'Einzelpreis', x: RAND + 410, rechts: true },
    { titel: 'Gesamt', x: RAND + breite, rechts: true },
  ];
  const bezeichnungBreite = 225;

  const tabellenkopf = () => {
    spalten.forEach((s) => text(s.titel, s.x, y, { font: fett, rechts: s.rechts }));
    y -= 5;
    linie(y);
    y -= 13;
  };
  const neueSeite = () => {
    seite = doc.addPage(A4);
    y = A4[1] - RAND;
  };
  const platzFuer = (hoehe, mitKopf = false) => {
    if (y - hoehe < RAND + FUSS_HOEHE) {
      neueSeite();
      if (mitKopf) tabellenkopf();
    }
  };

  // Kopf: Absender, Logo, Empfänger, Rechnungsdaten
  neueSeite();
  if (logo) {
    const s = logo.scaleToFit(110, 110);
    seite.drawImage(logo, { x: A4[0] - RAND - s.width, y: A4[1] - RAND - s.height + 20, ...s });
  }
  text(v.firma, RAND, y, { font: fett, groesse: 16 });
  y -= 90;
  text(`${v.name} • ${v.strasse} • ${v.plz} ${v.ort}`, RAND, y, { groesse: 7, farbe: GRAU });
  y -= 16;
  for (const z of [k.name, k.strasse, `${k.plz} ${k.ort}`, k.land !== 'DE' ? k.land : null].filter(Boolean)) {
    text(z, RAND, y, { groesse: 10 });
    y -= 13;
  }

  const infos = [
    ['Rechnungsnummer', m.nummer],
    ['Rechnungsdatum', datumDe(m.datum)],
    ['Kundennummer', k.kundennummer],
    m.kaeuferReferenz !== k.kundennummer && ['Ihre Referenz', m.kaeuferReferenz],
    m.leistungszeitraum
      ? ['Leistungszeitraum', `${datumDe(m.leistungszeitraum.von)} – ${datumDe(m.leistungszeitraum.bis)}`]
      : ['Leistungsdatum', datumDe(m.lieferdatum)],
    k.ustIdNr && ['USt-IdNr. Kunde', k.ustIdNr],
  ].filter(Boolean);
  let yInfo = A4[1] - RAND - 124;
  for (const [label, wert] of infos) {
    text(label, RAND + 250, yInfo, { farbe: GRAU });
    text(wert, RAND + breite, yInfo, { rechts: true });
    yInfo -= 13;
  }

  y = Math.min(y, yInfo) - 24;
  text('Rechnung', RAND, y, { font: fett, groesse: 20 });
  y -= 24;
  const einleitung = m.leistungszeitraum
    ? `Für die verkauften Artikel im Zeitraum vom ${datumDe(m.leistungszeitraum.von)} bis `
      + `${datumDe(m.leistungszeitraum.bis)} stellen wir Ihnen folgende Positionen in Rechnung:`
    : 'Wir stellen Ihnen folgende Positionen in Rechnung:';
  for (const z of umbrechen(einleitung, normal, 9, breite)) {
    text(z, RAND, y);
    y -= 12;
  }
  y -= 10;

  // Positionen
  tabellenkopf();
  for (const p of m.positionen) {
    const bezeichnung = p.rabattProzent > 0 ? `${p.bezeichnung} (Rabatt: ${p.rabattProzent} %)` : p.bezeichnung;
    const zeilen = umbrechen(bezeichnung, normal, 9, bezeichnungBreite);
    platzFuer(zeilen.length * 11 + 4, true);
    text(p.id, spalten[0].x, y);
    text(p.artikelnummer, spalten[1].x, y);
    zeilen.forEach((z, i) => text(z, spalten[2].x, y - i * 11));
    text(p.menge, spalten[3].x, y, { rechts: true });
    text(euro(p.nettopreis), spalten[4].x, y, { rechts: true });
    text(euro(p.nettobetrag), spalten[5].x, y, { rechts: true });
    y -= zeilen.length * 11 + 4;
  }
  linie(y + 8);

  // Summen
  const summen = [
    ['Gesamtwert', euro(m.summen.positionen)],
    ...m.nachlaesse.map((n) => [`- ${n.grund} ${n.prozent} %`, euro(-n.betrag)]),
  ];
  platzFuer(summen.length * 14 + 60);
  y -= 8;
  for (const [label, wert] of summen) {
    text(label, RAND + 300, y);
    text(wert, RAND + breite, y, { rechts: true });
    y -= 14;
  }
  seite.drawRectangle({ x: RAND + 295, y: y - 5, width: breite - 295, height: 17, color: rgb(0.9, 0.9, 0.9) });
  text('Überweisungsbetrag', RAND + 300, y, { font: fett });
  text(euro(m.summen.zahlbetrag), RAND + breite, y, { font: fett, rechts: true });
  y -= 34;

  const hinweise = [
    ...m.hinweise,
    `Bitte überweisen Sie den Rechnungsbetrag unter Angabe der Rechnungsnummer ${m.nummer} `
      + 'an die unten genannte Bankverbindung.',
    m.zahlung.bedingungen,
    '',
    'Vielen Dank',
  ];
  for (const h of hinweise) {
    for (const z of umbrechen(h, normal, 9, breite)) {
      platzFuer(12);
      text(z, RAND, y);
      y -= 12;
    }
  }

  // Fußzeile auf allen Seiten
  const seiten = doc.getPages();
  const steuerangabe = v.ustIdNr ? `USt-IdNr.: ${v.ustIdNr}` : `Steuernummer: ${v.steuernummer}`;
  const fuss = [
    { x: RAND, zeilen: [v.firma, v.name, `${v.strasse}, ${v.plz} ${v.ort}`, steuerangabe] },
    { x: RAND + 180, zeilen: [v.telefon, v.email, v.website].filter(Boolean) },
    {
      x: RAND + 340,
      zeilen: [v.bank, `IBAN: ${formatIban(m.zahlung.iban)}`, m.zahlung.bic && `BIC: ${m.zahlung.bic}`].filter(Boolean),
    },
  ];
  seiten.forEach((s, i) => {
    seite = s;
    linie(RAND + FUSS_HOEHE - 18);
    for (const block of fuss) {
      block.zeilen.forEach((z, j) => text(z, block.x, RAND + FUSS_HOEHE - 30 - j * 9, { groesse: 7, farbe: GRAU }));
    }
    text(`Seite ${i + 1} von ${seiten.length}`, A4[0] - RAND, RAND - 14, { groesse: 7, farbe: GRAU, rechts: true });
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
