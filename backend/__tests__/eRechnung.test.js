'use strict';

const { PDFDocument, PDFName, decodePDFRawStream } = require('pdf-lib');
const { buildRechnungsModell, pruefePflichtangaben, ibanGueltig } = require('../src/utils/eRechnung/modell');
const { toCII } = require('../src/utils/eRechnung/cii');
const { validiereCII } = require('../src/utils/eRechnung/validator');
const { getVerkaeufer } = require('../src/utils/eRechnung/verkaeufer');
const { erstelleERechnung, ERechnungFehler } = require('../src/utils/eRechnung');
const { kundeSchema } = require('../src/schemas');

// Die Schematron-Prüfung (EN 16931 + XRechnung) läuft hier echt – das dauert pro Aufruf einige 100 ms.
jest.setTimeout(30000);

const ENV_BACKUP = { ...process.env };
beforeEach(() => {
  process.env = { ...ENV_BACKUP, VERKAEUFER_STEUERNUMMER: '201/123/45678' };
});
afterAll(() => {
  process.env = ENV_BACKUP;
});

function beispielDaten(ueberschreiben = {}) {
  return {
    rechnung: {
      ID: 7,
      Nummer: '2026-007',
      Datum: '2026-09-20T10:00:00Z',
      status: 'final',
      rabatt_gesamt: '10.00',
      rabatt_positionen: { MHO123: 15 },
      ...ueberschreiben.rechnung,
    },
    kunde: {
      ID: 4,
      Name: 'Laden & Söhne <GmbH>',
      Strasse: 'Hauptstraße',
      Hausnummer: 3,
      PLZ: 1067,
      Ort: 'Dresden',
      Email: 'info@laden.example',
      Provision: 20,
      ...ueberschreiben.kunde,
    },
    schmuckstuecke: ueberschreiben.schmuckstuecke || [
      { Artikelnummer: 'MHO123_2', Verkaufspreis: 29.99, Art: 'Stecker' },
      { Artikelnummer: 'MHO123_1', Verkaufspreis: 29.99, Art: 'Stecker' },
      { Artikelnummer: 'MSH007_1', Verkaufspreis: 45.5, Name: 'Sonnenkette' },
    ],
    leistungszeitraum: 'leistungszeitraum' in ueberschreiben
      ? ueberschreiben.leistungszeitraum
      : { von: '2026-08-01', bis: '2026-08-31' },
  };
}

const modell = (profil = 'xrechnung', ueberschreiben) =>
  buildRechnungsModell({ ...beispielDaten(ueberschreiben), verkaeufer: getVerkaeufer() }, profil);

describe('buildRechnungsModell', () => {
  it('fasst Stücke eines Artikels zu einer Position zusammen und rechnet Rabatte in Cent', () => {
    const m = modell();

    expect(m.positionen).toHaveLength(2);
    expect(m.positionen[0]).toMatchObject({
      artikelnummer: 'MHO123',
      menge: 2,
      bruttopreis: 2999,
      preisnachlass: 450, // 15 % von 29,99 € = 4,4985 € → 4,50 €
      nettopreis: 2549,
      nettobetrag: 5098,
    });
    expect(m.positionen[1]).toMatchObject({ artikelnummer: 'MSH007', menge: 1, nettobetrag: 4550 });

    // 96,48 € − 10 % Gesamtrabatt (9,65 €) − 20 % Provision auf 86,83 € (17,37 €) = 69,46 €
    expect(m.nachlaesse.map((n) => [n.grund, n.betrag])).toEqual([['Gesamtrabatt', 965], ['Provision', 1737]]);
    expect(m.summen).toEqual({
      positionen: 9648, nachlaesse: 2702, netto: 6946, steuer: 0, brutto: 6946, zahlbetrag: 6946,
    });
  });

  it('trennt Stücke gleicher Basis-Artikelnummer mit unterschiedlichem Preis', () => {
    const m = modell('xrechnung', {
      schmuckstuecke: [
        { Artikelnummer: 'MHO123_1', Verkaufspreis: 20 },
        { Artikelnummer: 'MHO123_2', Verkaufspreis: 25 },
      ],
    });
    expect(m.positionen.map((p) => [p.menge, p.nettobetrag])).toEqual([[1, 1700], [1, 2125]]);
  });

  it('stellt führende Nullen deutscher PLZ wieder her und nutzt die Kundennummer als Käuferreferenz', () => {
    const m = modell();
    expect(m.kaeufer.plz).toBe('01067');
    expect(m.kaeuferReferenz).toBe('4');
  });

  it('verwendet eine hinterlegte Leitweg-ID als Käuferreferenz (BT-10)', () => {
    expect(modell('xrechnung', { kunde: { Leitweg_ID: ' 991-12345-67 ' } }).kaeuferReferenz).toBe('991-12345-67');
  });

  it('setzt ohne Lieferscheine das Rechnungsdatum als Leistungsdatum', () => {
    const m = modell('xrechnung', { leistungszeitraum: null });
    expect(m.leistungszeitraum).toBeNull();
    expect(m.lieferdatum).toEqual(m.datum);
  });
});

describe('pruefePflichtangaben', () => {
  const bts = (fehler) => fehler.map((f) => f.bt);

  it('akzeptiert vollständige Daten', () => {
    expect(pruefePflichtangaben(modell())).toEqual([]);
  });

  it('meldet fehlende Steuernummer/USt-IdNr. mit Hinweis auf die Umgebungsvariable', () => {
    delete process.env.VERKAEUFER_STEUERNUMMER;
    const fehler = pruefePflichtangaben(modell());
    expect(bts(fehler)).toEqual(['BT-31/BT-32']);
    expect(fehler[0].meldung).toContain('VERKAEUFER_STEUERNUMMER');
  });

  it('verlangt die E-Mail des Kunden nur für XRechnung (BT-49)', () => {
    const ohneMail = { kunde: { Email: null } };
    expect(bts(pruefePflichtangaben(modell('xrechnung', ohneMail)))).toEqual(['BT-49']);
    expect(pruefePflichtangaben(modell('zugferd', ohneMail))).toEqual([]);
  });

  it('meldet unvollständige Kundenadresse und ungültigen Ländercode', () => {
    const kunde = { Strasse: '', Ort: ' ', PLZ: 0, Land: 'Deutschland' };
    const fehler = pruefePflichtangaben(modell('xrechnung', { kunde }));
    expect(bts(fehler)).toEqual(['BT-50', 'BT-53', 'BT-52', 'BT-55']);
    expect(fehler[0].meldung).toBe('Straße des Kunden fehlt – bitte in Kundendaten (Kunden → bearbeiten) ergänzen.');
  });

  it('lehnt Entwürfe, leere Rechnungen und ungültige IBAN ab', () => {
    process.env.VERKAEUFER_IBAN = 'DE00 1234 5678 9012 3456 78';
    const fehler = pruefePflichtangaben(modell('xrechnung', { rechnung: { status: 'entwurf' }, schmuckstuecke: [] }));
    expect(bts(fehler)).toEqual(['BT-1', 'BG-25', 'BT-84']);
  });

  it('prüft das Format einer angegebenen USt-IdNr.', () => {
    expect(bts(pruefePflichtangaben(modell('xrechnung', { kunde: { UStIdNr: '123' } })))).toEqual(['BT-48']);
  });
});

describe('ibanGueltig', () => {
  it('prüft die Prüfziffer nach ISO 13616', () => {
    expect(ibanGueltig('DE51750200730029262020')).toBe(true);
    expect(ibanGueltig('DE52750200730029262020')).toBe(false);
    expect(ibanGueltig('keine IBAN')).toBe(false);
  });
});

describe('toCII + validiereCII', () => {
  it.each(['xrechnung', 'zugferd'])('erzeugt für %s ein XML ohne Befunde (XSD + Schematron)', async (profil) => {
    const xml = toCII(modell(profil));
    const ergebnis = await validiereCII(xml, profil);

    expect(ergebnis).toEqual({ gueltig: true, fehler: [], warnungen: [] });
  });

  it('bildet die Pflichtfelder auf die richtigen CII-Elemente ab', () => {
    const xml = toCII(modell());

    expect(xml).toContain('<ram:ID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</ram:ID>');
    expect(xml).toContain('<ram:BuyerReference>4</ram:BuyerReference>');
    expect(xml).toContain('<ram:ID schemeID="FC">201/123/45678</ram:ID>');
    expect(xml).toContain('<ram:URIID schemeID="EM">info@laden.example</ram:URIID>');
    expect(xml).toContain('<ram:IBANID>DE51750200730029262020</ram:IBANID>');
    expect(xml).toContain('<ram:CategoryCode>E</ram:CategoryCode>');
    expect(xml).toContain('<ram:ExemptionReason>Kleinunternehmer gemäß § 19 UStG</ram:ExemptionReason>');
    expect(xml).toContain('<ram:DuePayableAmount>69.46</ram:DuePayableAmount>');
  });

  it('maskiert Sonderzeichen aus der Datenbank', () => {
    expect(toCII(modell())).toContain('<ram:Name>Laden &amp; Söhne &lt;GmbH&gt;</ram:Name>');
  });

  it('meldet verletzte Summenregeln der EN 16931', async () => {
    const xml = toCII(modell('zugferd')).replace('<ram:DuePayableAmount>69.46', '<ram:DuePayableAmount>70.00');
    const ergebnis = await validiereCII(xml, 'zugferd');

    expect(ergebnis.gueltig).toBe(false);
    expect(ergebnis.fehler.map((f) => f.regel)).toContain('BR-CO-16');
  });

  it('meldet fehlende XRechnung-Pflichtfelder (BR-DE-15 Käuferreferenz)', async () => {
    const xml = toCII(modell()).replace(/<ram:BuyerReference>.*?<\/ram:BuyerReference>/, '');
    const ergebnis = await validiereCII(xml, 'xrechnung');

    expect(ergebnis.fehler.map((f) => f.regel)).toContain('BR-DE-15');
    expect(ergebnis.fehler.find((f) => f.regel === 'BR-DE-15').meldung).toContain('Buyer reference');
  });

  it('meldet Schemafehler vor der Schematron-Prüfung', async () => {
    const xml = toCII(modell()).replace('<ram:TypeCode>380</ram:TypeCode>', '<ram:Typ>380</ram:Typ>');
    const ergebnis = await validiereCII(xml, 'xrechnung');

    expect(ergebnis.gueltig).toBe(false);
    expect(ergebnis.fehler.every((f) => f.regel === 'XSD')).toBe(true);
  });
});

describe('erstelleERechnung', () => {
  it('liefert eine XRechnung als XML', async () => {
    const ergebnis = await erstelleERechnung(beispielDaten(), 'xrechnung');

    expect(ergebnis.mimeType).toBe('application/xml');
    expect(ergebnis.dateiname).toBe('Rechnung_2026-007_XRechnung.xml');
    expect(ergebnis.inhalt.toString('utf8')).toMatch(/^<\?xml/);
  });

  it('liefert ein PDF/A-3 mit eingebetteter factur-x.xml', async () => {
    const ergebnis = await erstelleERechnung(beispielDaten(), 'zugferd');
    const doc = await PDFDocument.load(ergebnis.inhalt, { updateMetadata: false });
    const katalog = (name) => doc.catalog.lookup(PDFName.of(name));

    expect(ergebnis.mimeType).toBe('application/pdf');
    expect(ergebnis.dateiname).toBe('Rechnung_2026-007_ZUGFeRD.pdf');
    expect(doc.getTitle()).toBe('Rechnung 2026-007');
    expect(doc.getPageCount()).toBe(1);

    const xmp = Buffer.from(katalog('Metadata').getContents()).toString('utf8');
    expect(xmp).toContain('<pdfaid:part>3</pdfaid:part>');
    expect(xmp).toContain('<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>');
    expect(katalog('OutputIntents').lookup(0).get(PDFName.of('S'))).toEqual(PDFName.of('GTS_PDFA1'));

    const anhang = katalog('AF').lookup(0);
    expect(anhang.lookup(PDFName.of('UF')).decodeText()).toBe('factur-x.xml');
    expect(anhang.get(PDFName.of('AFRelationship'))).toEqual(PDFName.of('Alternative'));
    const eingebettet = anhang.lookup(PDFName.of('EF')).lookup(PDFName.of('F'));
    const xml = Buffer.from(decodePDFRawStream(eingebettet).decode()).toString('utf8');
    expect(xml).toContain('<ram:ID>urn:cen.eu:en16931:2017</ram:ID>');
  });

  it('bricht mit verständlichen Meldungen ab, wenn Pflichtangaben fehlen', async () => {
    delete process.env.VERKAEUFER_STEUERNUMMER;
    const promise = erstelleERechnung(beispielDaten({ kunde: { Email: '' } }), 'xrechnung');

    await expect(promise).rejects.toBeInstanceOf(ERechnungFehler);
    await expect(promise).rejects.toMatchObject({
      message: 'E-Rechnung kann nicht erstellt werden: Pflichtangaben fehlen.',
      fehler: [
        expect.objectContaining({ bt: 'BT-31/BT-32' }),
        expect.objectContaining({ bt: 'BT-49' }),
      ],
    });
  });
});

describe('kundeSchema (E-Rechnung-Felder)', () => {
  const basis = { Name: 'Laden', Strasse: 'Weg', Hausnummer: 1, Ort: 'Ort', PLZ: 12345 };

  it('normalisiert Ländercode und USt-IdNr.', () => {
    const r = kundeSchema.parse({ ...basis, Land: 'at', UStIdNr: 'atu 123 456 78' });
    expect(r).toMatchObject({ Land: 'AT', UStIdNr: 'ATU12345678' });
  });

  it('lehnt ungültige Werte ab', () => {
    expect(kundeSchema.safeParse({ ...basis, Land: 'Deutschland' }).success).toBe(false);
    expect(kundeSchema.safeParse({ ...basis, UStIdNr: '12' }).success).toBe(false);
  });
});
