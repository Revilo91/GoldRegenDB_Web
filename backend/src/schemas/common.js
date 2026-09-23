const { z } = require('zod');

// Leerstrings aus HTML-Formularen bedeuten "kein Wert" und werden zu null.
const leerZuNull = (v) => (typeof v === 'string' && v.trim() === '' ? null : v);

// Optionaler Text mit Längenlimit. Fehlt das Feld, bleibt es undefined –
// die Routen setzen dann ihre bisherigen Defaults ein.
const text = (max) =>
  z.preprocess(leerZuNull, z.string().max(max, `darf maximal ${max} Zeichen lang sein`).nullish());

// Pflichttext: muss vorhanden und nach dem Trimmen nicht leer sein.
const pflichttext = (max) =>
  z
    .string({ error: 'ist erforderlich' })
    .trim()
    .min(1, 'darf nicht leer sein')
    .max(max, `darf maximal ${max} Zeichen lang sein`);

// Zahlen kommen aus Formularen häufig als String ("12.50"). Leere Werte
// werden zu null, damit sie nicht als 0 in die Datenbank wandern.
const zahl = (opts = {}) => {
  const { min, max } = opts;
  let schema = z.number({ error: 'muss eine Zahl sein' }).finite('muss eine endliche Zahl sein');
  if (min !== undefined) schema = schema.min(min, `darf nicht kleiner als ${min} sein`);
  if (max !== undefined) schema = schema.max(max, `darf nicht größer als ${max} sein`);
  return z.preprocess((v) => {
    const bereinigt = leerZuNull(v);
    if (bereinigt === null || bereinigt === undefined) return bereinigt;
    if (typeof bereinigt === 'string') {
      // Deutsche Eingaben kommen als "12,50". Number("12,50") ist NaN, die
      // Validierung meldete dann "muss eine Zahl sein" – für einen
      // deutschsprachigen Betrieb der wahrscheinlichste Alltagsfehler
      // (Befund D2). Ein Punkt bleibt weiterhin erlaubt.
      const n = Number(bereinigt.replace(',', '.'));
      return Number.isNaN(n) ? bereinigt : n;
    }
    return bereinigt;
  }, schema.nullish());
};

const ganzzahl = (opts = {}) => zahl(opts).refine(
  (v) => v === null || v === undefined || Number.isInteger(v),
  'muss eine ganze Zahl sein',
);

// Checkbox-Werte können als true/false, "true"/"false" oder 0/1 ankommen.
const bool = () =>
  z.preprocess((v) => {
    if (v === 'true' || v === 1 || v === '1') return true;
    if (v === 'false' || v === 0 || v === '0') return false;
    return leerZuNull(v);
  }, z.boolean().nullish());

// Datenbank-IDs aus der URL (req.params) sind immer Strings.
const idParam = z
  .string()
  .regex(/^\d+$/, 'muss eine gültige ID sein')
  .refine((v) => Number(v) <= Number.MAX_SAFE_INTEGER, 'ist zu groß');

// Artikelnummern: Präfix (3 Buchstaben) + 3 Ziffern, optional mit Suffix.
// Beim Anlegen sind auch verkürzte Formen erlaubt (siehe routes/schmuckstuecke.js).
const ARTIKELNUMMER_REGEX = /^[A-Za-zÄÖÜäöü]{3}\d{3}(_\d+)?$/;

const artikelnummer = z
  .string({ error: 'ist erforderlich' })
  .trim()
  .min(1, 'darf nicht leer sein')
  .max(20, 'darf maximal 20 Zeichen lang sein');

const vollstaendigeArtikelnummer = artikelnummer.regex(
  ARTIKELNUMMER_REGEX,
  'hat ein ungültiges Format (erwartet z. B. MHO123 oder MHO123_1)',
);

const {
  MIN_PASSWORT_LAENGE,
  MAX_PASSWORT_LAENGE,
} = require('../utils/passwordService');

// Passwörter kommen seit Issue #131 im Klartext (über TLS) an und werden erst
// im Backend mit bcrypt gehasht.
const neuesPasswort = z
  .string({ error: 'ist erforderlich' })
  .min(MIN_PASSWORT_LAENGE, `muss mindestens ${MIN_PASSWORT_LAENGE} Zeichen lang sein`)
  .max(MAX_PASSWORT_LAENGE, `darf maximal ${MAX_PASSWORT_LAENGE} Zeichen lang sein`);

// Beim Login wird die Mindestlänge bewusst nicht geprüft: Altkonten dürfen
// kürzere Passwörter haben und sollen sich weiterhin anmelden können (danach
// greift must_change_password).
const bestehendesPasswort = z
  .string({ error: 'ist erforderlich' })
  .min(1, 'darf nicht leer sein')
  .max(MAX_PASSWORT_LAENGE, `darf maximal ${MAX_PASSWORT_LAENGE} Zeichen lang sein`);

module.exports = {
  text,
  pflichttext,
  zahl,
  ganzzahl,
  bool,
  idParam,
  artikelnummer,
  vollstaendigeArtikelnummer,
  neuesPasswort,
  bestehendesPasswort,
  ARTIKELNUMMER_REGEX,
};
