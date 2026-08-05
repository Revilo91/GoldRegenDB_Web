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
      const n = Number(bereinigt);
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

// Ein SHA-256-Hash ist immer ein 64-stelliger, kleingeschriebener Hex-String.
const sha256 = z
  .string({ error: 'ist erforderlich' })
  .regex(/^[0-9a-f]{64}$/, 'hat ein ungültiges Passwort-Format');

module.exports = {
  text,
  pflichttext,
  zahl,
  ganzzahl,
  bool,
  idParam,
  artikelnummer,
  vollstaendigeArtikelnummer,
  sha256,
  ARTIKELNUMMER_REGEX,
};
