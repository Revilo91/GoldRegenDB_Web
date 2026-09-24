// Prüft erzeugtes CII-XML mit denselben Artefakten wie der KoSIT-Validator (Szenario "XRechnung CII"):
//   1. XML-Schema UN/CEFACT CII D16B
//   2. Schematron EN 16931 (CEN, CII-Syntax)
//   3. Schematron XRechnung CIUS (nur Profil xrechnung, inkl. übernommener Peppol-Regeln)
// Die Schematron-Regeln liegen als vorkompilierte SaxonJS-Stylesheets (SEF) vor –
// Herkunft und Neuerzeugung: backend/src/assets/erechnung/README.md.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const SaxonJS = require('saxon-js');
const { validateXML } = require('xmllint-wasm');
const { ibanGueltig } = require('./modell');

const ASSETS = path.join(__dirname, '../../assets/erechnung');
const XSD_HAUPTDATEI = 'CrossIndustryInvoice_100pD16B.xsd';

let xsdDateien;
const stylesheets = {};

function ladeXsd() {
  if (!xsdDateien) {
    const dir = path.join(ASSETS, 'xsd');
    xsdDateien = fs.readdirSync(dir).filter((f) => f.endsWith('.xsd'))
      .map((fileName) => ({ fileName, contents: fs.readFileSync(path.join(dir, fileName), 'utf8') }));
  }
  return xsdDateien;
}

function ladeStylesheet(name) {
  if (!stylesheets[name]) {
    const gz = fs.readFileSync(path.join(ASSETS, 'schematron', `${name}.sef.json.gz`));
    stylesheets[name] = JSON.parse(zlib.gunzipSync(gz).toString('utf8'));
  }
  return stylesheets[name];
}

async function pruefeSchema(xml) {
  const dateien = ladeXsd();
  const { valid, errors } = await validateXML({
    xml: [{ fileName: 'rechnung.xml', contents: xml }],
    schema: dateien.filter((f) => f.fileName === XSD_HAUPTDATEI),
    preload: dateien.filter((f) => f.fileName !== XSD_HAUPTDATEI),
  });
  if (valid) return [];
  return errors.map((e) => ({
    regel: 'XSD',
    schwere: 'fatal',
    meldung: e.message.trim(),
    ort: e.loc?.lineNumber ? `Zeile ${e.loc.lineNumber}` : undefined,
  }));
}

function pruefeSchematron(xml, name) {
  const { principalResult } = SaxonJS.transform({
    stylesheetInternal: ladeStylesheet(name),
    sourceText: xml,
    destination: 'document',
  }, 'sync');

  const befunde = SaxonJS.XPath.evaluate(
    `//svrl:failed-assert ! map {
      'regel': string(@id), 'schwere': string((@flag, 'fatal')[1]),
      'meldung': normalize-space(svrl:text), 'ort': string(@location) }`,
    principalResult,
    { namespaceContext: { svrl: 'http://purl.oclc.org/dsdl/svrl' }, resultForm: 'array' },
  );
  return befunde
    .filter((b) => !(IBAN_REGELN.includes(b.regel) && ibansGueltig(xml)))
    .map((b) => ({ ...b, ort: b.ort || undefined }));
}

// SaxonJS rechnet xs:integer-Modulo mit Gleitkommazahlen, die IBAN-Prüfsummen von BR-DE-19 (Überweisung)
// und BR-DE-20 (Lastschrift) schlagen deshalb auch bei korrekter IBAN an. Sie werden mit BigInt nachgerechnet.
const IBAN_REGELN = ['BR-DE-19', 'BR-DE-20'];
function ibansGueltig(xml) {
  const ibans = [...xml.matchAll(/<ram:IBANID>([^<]*)<\/ram:IBANID>/g)].map((m) => m[1].replace(/\s+/g, ''));
  return ibans.length > 0 && ibans.every(ibanGueltig);
}

// Liefert { gueltig, fehler, warnungen }; "gueltig" heißt: keine Befunde mit Schwere fatal/error.
async function validiereCII(xml, profil) {
  const befunde = await pruefeSchema(xml);
  if (befunde.length === 0) {
    befunde.push(...pruefeSchematron(xml, 'EN16931-CII-validation'));
    if (profil === 'xrechnung') befunde.push(...pruefeSchematron(xml, 'XRechnung-CII-validation'));
  }
  const fehler = befunde.filter((b) => b.schwere !== 'warning' && b.schwere !== 'information');
  const warnungen = befunde.filter((b) => !fehler.includes(b));
  return { gueltig: fehler.length === 0, fehler, warnungen };
}

module.exports = { validiereCII };
