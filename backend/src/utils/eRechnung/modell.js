// Abbildung Rechnung/Kunde/Schmuckstücke aus der DB auf das semantische Modell der EN 16931.
// Alle Beträge werden in ganzen Cent gerechnet, damit Summenregeln (BR-CO-10 ff.) exakt aufgehen.
const { artikelnummerBasis, artikelKategorie, artikelBezeichnung } = require('../artikelBezeichnung');

const PROFILE = {
  xrechnung: {
    name: 'XRechnung 3.0',
    guideline: 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0',
  },
  zugferd: {
    name: 'ZUGFeRD 2 / Factur-X (Profil EN 16931)',
    guideline: 'urn:cen.eu:en16931:2017',
  },
};

const KLEINUNTERNEHMER_HINWEIS = 'Gemäß § 19 Abs. 1 UStG wird keine Umsatzsteuer ausgewiesen.';
const ZAHLUNGSBEDINGUNG = 'Die Rechnung ist sofort bei Erhalt fällig.';

const cent = (euro) => Math.round((Number(euro) || 0) * 100);
const prozentVon = (betragCent, prozent) => Math.round((betragCent * prozent) / 100);
const leer = (v) => v === null || v === undefined || String(v).trim() === '';

function buildRechnungsModell({ rechnung, kunde, schmuckstuecke, leistungszeitraum, verkaeufer }, profil) {
  const rabattPositionen = rechnung.rabatt_positionen || {};
  const sortiert = [...schmuckstuecke].sort((a, b) =>
    String(a.Artikelnummer).localeCompare(String(b.Artikelnummer), undefined, { numeric: true }),
  );

  // Stücke desselben Artikels (gleiche Basis-Artikelnummer und gleicher Preis) → eine Position
  const gruppen = new Map();
  for (const s of sortiert) {
    const basis = artikelnummerBasis(s.Artikelnummer);
    const key = `${basis}|${cent(s.Verkaufspreis)}`;
    if (!gruppen.has(key)) gruppen.set(key, { basis, stueck: s, menge: 0 });
    gruppen.get(key).menge += 1;
  }

  const positionen = [...gruppen.values()].map(({ basis, stueck, menge }, i) => {
    const bruttopreis = cent(stueck.Verkaufspreis);
    const rabattProzent = Number(rabattPositionen[basis]) || 0;
    const preisnachlass = prozentVon(bruttopreis, rabattProzent);
    const nettopreis = bruttopreis - preisnachlass;
    return {
      id: String(i + 1),
      artikelnummer: basis,
      kategorie: artikelKategorie(stueck),
      bezeichnung: artikelBezeichnung(stueck),
      menge,
      bruttopreis,
      rabattProzent,
      preisnachlass,
      nettopreis,
      nettobetrag: nettopreis * menge,
    };
  });

  const summePositionen = positionen.reduce((sum, p) => sum + p.nettobetrag, 0);

  const nachlaesse = [];
  const rabattGesamt = Number(rechnung.rabatt_gesamt) || 0;
  if (rabattGesamt > 0) {
    nachlaesse.push({
      grund: 'Gesamtrabatt',
      grundCode: '95',
      prozent: rabattGesamt,
      basis: summePositionen,
      betrag: prozentVon(summePositionen, rabattGesamt),
    });
  }
  const nachRabatt = summePositionen - nachlaesse.reduce((sum, n) => sum + n.betrag, 0);
  const provision = Number(kunde.Provision) || 0;
  if (provision > 0) {
    nachlaesse.push({
      grund: 'Provision',
      prozent: provision,
      basis: nachRabatt,
      betrag: prozentVon(nachRabatt, provision),
    });
  }

  const summeNachlaesse = nachlaesse.reduce((sum, n) => sum + n.betrag, 0);
  const netto = summePositionen - summeNachlaesse;
  const land = (kunde.Land || 'DE').trim().toUpperCase();
  const datum = new Date(rechnung.Datum);
  const zeitraum = leistungszeitraum
    ? { von: new Date(leistungszeitraum.von), bis: new Date(leistungszeitraum.bis) }
    : null;

  return {
    profil,
    guideline: PROFILE[profil].guideline,
    nummer: rechnung.Nummer,
    status: rechnung.status,
    datum,
    typCode: '380',
    waehrung: 'EUR',
    kaeuferReferenz: leer(kunde.Leitweg_ID) ? String(kunde.ID) : kunde.Leitweg_ID.trim(),
    hinweise: [KLEINUNTERNEHMER_HINWEIS],
    leistungszeitraum: zeitraum,
    // Letzte Lieferung laut Lieferscheinen; ohne Lieferschein gilt das Rechnungsdatum als Leistungsdatum
    lieferdatum: zeitraum ? zeitraum.bis : datum,
    verkaeufer,
    kaeufer: {
      kundennummer: String(kunde.ID),
      name: kunde.Name,
      strasse: leer(kunde.Strasse)
        ? ''
        : [kunde.Strasse.trim(), Number(kunde.Hausnummer) > 0 ? kunde.Hausnummer : null].filter(Boolean).join(' '),
      // PLZ ist in der DB ein INTEGER (0 = nicht gepflegt) – führende Nullen deutscher PLZ (01067) wiederherstellen
      plz: !(Number(kunde.PLZ) > 0) ? '' : land === 'DE' ? String(kunde.PLZ).padStart(5, '0') : String(kunde.PLZ),
      ort: kunde.Ort,
      land,
      email: (kunde.Email || '').trim(),
      ustIdNr: (kunde.UStIdNr || '').replace(/\s+/g, '').toUpperCase(),
    },
    zahlung: {
      code: '58', // SEPA-Überweisung
      iban: verkaeufer.iban,
      bic: verkaeufer.bic,
      kontoinhaber: verkaeufer.firma,
      verwendungszweck: rechnung.Nummer,
      bedingungen: ZAHLUNGSBEDINGUNG,
    },
    steuer: { kategorie: 'E', satz: 0, befreiungsgrund: 'Kleinunternehmer gemäß § 19 UStG' },
    positionen,
    nachlaesse,
    summen: {
      positionen: summePositionen,
      nachlaesse: summeNachlaesse,
      netto,
      steuer: 0,
      brutto: netto,
      zahlbetrag: netto,
    },
  };
}

function ibanGueltig(iban) {
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const ziffern = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  return BigInt(ziffern) % 97n === 1n;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LAENDERCODE = /^[A-Z]{2}$/;
const KUNDE = 'Kundendaten (Kunden → bearbeiten)';
const ENV = (name) => `Umgebungsvariable ${name}`;

// Prüft vor der Erzeugung, ob alle Pflichtangaben vorhanden sind – mit Hinweis, wo sie gepflegt werden.
function pruefePflichtangaben(m) {
  const fehler = [];
  const melde = (bt, feld, meldung) => fehler.push({ bt, feld, meldung });
  const fehlt = (bt, feld, quelle) => melde(bt, feld, `${feld} fehlt – bitte in ${quelle} ergänzen.`);
  const v = m.verkaeufer;
  const k = m.kaeufer;

  if (m.status !== 'final') {
    melde('BT-1', 'Rechnungsstatus', 'Nur abgeschlossene Rechnungen können als E-Rechnung erzeugt werden.');
  }
  if (m.positionen.length === 0) {
    melde('BG-25', 'Rechnungspositionen', 'Die Rechnung enthält keine Positionen.');
  }
  for (const p of m.positionen) {
    if (p.bruttopreis < 0) {
      melde('BT-148', `Preis ${p.artikelnummer}`, `Artikel ${p.artikelnummer} hat einen negativen Verkaufspreis.`);
    }
  }

  if (leer(v.firma)) fehlt('BT-27', 'Firmenname des Verkäufers', ENV('VERKAEUFER_FIRMA'));
  if (leer(v.strasse)) fehlt('BT-35', 'Straße des Verkäufers', ENV('VERKAEUFER_STRASSE'));
  if (leer(v.plz)) fehlt('BT-38', 'PLZ des Verkäufers', ENV('VERKAEUFER_PLZ'));
  if (leer(v.ort)) fehlt('BT-37', 'Ort des Verkäufers', ENV('VERKAEUFER_ORT'));
  if (!LAENDERCODE.test(v.land)) fehlt('BT-40', 'Ländercode des Verkäufers (z. B. DE)', ENV('VERKAEUFER_LAND'));
  if (leer(v.name)) fehlt('BT-41', 'Ansprechpartner des Verkäufers', ENV('VERKAEUFER_NAME'));
  if (leer(v.telefon)) fehlt('BT-42', 'Telefonnummer des Verkäufers', ENV('VERKAEUFER_TELEFON'));
  if (!EMAIL.test(v.email)) fehlt('BT-43', 'Gültige E-Mail-Adresse des Verkäufers', ENV('VERKAEUFER_EMAIL'));
  if (leer(v.steuernummer) && leer(v.ustIdNr)) {
    fehlt('BT-31/BT-32', 'Steuernummer oder USt-IdNr. des Verkäufers',
      `${ENV('VERKAEUFER_STEUERNUMMER')} bzw. VERKAEUFER_USTIDNR`);
  }
  if (!ibanGueltig(v.iban)) fehlt('BT-84', 'Gültige IBAN des Verkäufers', ENV('VERKAEUFER_IBAN'));

  if (leer(k.name)) fehlt('BT-44', 'Name des Kunden', KUNDE);
  if (leer(k.strasse)) fehlt('BT-50', 'Straße des Kunden', KUNDE);
  if (leer(k.plz)) fehlt('BT-53', 'PLZ des Kunden', KUNDE);
  if (leer(k.ort)) fehlt('BT-52', 'Ort des Kunden', KUNDE);
  if (!LAENDERCODE.test(k.land)) fehlt('BT-55', 'Ländercode des Kunden (z. B. DE)', KUNDE);
  if (m.profil === 'xrechnung' && leer(k.email)) {
    fehlt('BT-49', 'E-Mail-Adresse des Kunden (elektronische Adresse)', KUNDE);
  }
  if (!leer(k.email) && !EMAIL.test(k.email)) {
    melde('BT-49', 'E-Mail-Adresse des Kunden', `"${k.email}" ist keine gültige E-Mail-Adresse.`);
  }
  if (!leer(k.ustIdNr) && !/^[A-Z]{2}[A-Z0-9]{2,13}$/.test(k.ustIdNr)) {
    melde('BT-48', 'USt-IdNr. des Kunden', `"${k.ustIdNr}" ist keine gültige USt-IdNr. (z. B. DE123456789).`);
  }

  return fehler;
}

module.exports = { PROFILE, buildRechnungsModell, pruefePflichtangaben, ibanGueltig };
