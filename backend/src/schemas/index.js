const { z } = require('zod');
const {
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
} = require('./common');

// ── Kunde ────────────────────────────────────────────────────────────────────

const kundeSchema = z.object({
  Name: pflichttext(100),
  Strasse: pflichttext(200),
  Hausnummer: ganzzahl({ min: 0, max: 99999 }),
  Ort: pflichttext(100),
  PLZ: ganzzahl({ min: 0, max: 99999 }),
  Email: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.email('ist keine gültige E-Mail-Adresse').max(200).nullish(),
  ),
  Telefonnummer: text(50),
  Provision: ganzzahl({ min: 0, max: 100 }),
  Aktiv: bool(),
});

const restockSelectiveSchema = z.object({
  artikelnummern: z
    .array(vollstaendigeArtikelnummer)
    .min(1, 'muss mindestens eine Artikelnummer enthalten')
    .max(1000, 'darf maximal 1000 Artikelnummern enthalten'),
});

// ── Schmuckstück ─────────────────────────────────────────────────────────────

// Freitext-Attribute des Schmuckstücks (alle TEXT-Spalten der Tabelle)
const schmuckTextfelder = {
  Name: text(200),
  Foto: text(255),
  Art: text(100),
  Form: text(100),
  Fassung: text(100),
  Farbe: text(100),
  Inhalt_Material: text(100),
  Inhalt_Farbe: text(100),
  Inhalt_Farbakzent: text(100),
  Inhalt_Zusatzmaterial: text(100),
  Anhänger_Fassung: text(100),
  Anhänger_Form: text(100),
  Anhänger_Farbe: text(100),
  Anhänger_Inhalt_Material: text(100),
  Anhänger_Inhalt_Farbe: text(100),
  Anhänger_Inhalt_Farbakzente: text(100),
  Anhänger_Inhalt_Zusatzmaterial: text(100),
  Material: text(100),
  Anhänger: text(100),
  Zwischenstück: text(100),
  Ausschuss_Grund: text(500),
};

const schmuckZahlenfelder = {
  Länge: zahl({ min: 0, max: 100000 }),
  Anhänger_Grösse: zahl({ min: 0, max: 100000 }),
  Grösse: zahl({ min: 0, max: 100000 }),
  Herstellungskosten: zahl({ min: 0, max: 1000000 }),
  Verkaufspreis: zahl({ min: 0, max: 1000000 }),
  Ausgelagert: ganzzahl({ min: 0 }),
  Verkauft: ganzzahl({ min: 0, max: 1 }),
  Ausschuss: ganzzahl({ min: 0, max: 1 }),
  Lieferschein_ID: ganzzahl({ min: 0 }),
  Rechnung_ID: ganzzahl({ min: 0 }),
};

const schmuckstueckCreateSchema = z.object({
  // Beim Anlegen sind auch Kurzformen erlaubt (nur Präfix bzw. Präfix + Nummer),
  // die Route ergänzt die laufende Nummer selbst.
  Artikelnummer: artikelnummer,
  Anzahl: ganzzahl({ min: 1, max: 200 }),
  ...schmuckTextfelder,
  ...schmuckZahlenfelder,
});

const schmuckstueckUpdateSchema = z.object({
  ...schmuckTextfelder,
  ...schmuckZahlenfelder,
});

const bulkEintrag = z.object({
  Artikelnummer: artikelnummer,
  ...schmuckTextfelder,
  ...schmuckZahlenfelder,
});

// Die Route akzeptiert zwei Formen (siehe parseBulkItemsFromPayload):
// entweder eine items-Liste oder eine Vorlage plus Artikelnummern.
const schmuckstueckBulkSchema = z.object({
  items: z.array(bulkEintrag).max(200, 'darf maximal 200 Einträge enthalten').optional(),
  template: z.object({ ...schmuckTextfelder, ...schmuckZahlenfelder }).optional(),
  artikelnummern: z
    .union([z.array(artikelnummer).max(200, 'darf maximal 200 Artikelnummern enthalten'), z.string().max(5000)])
    .optional(),
});

// ── Lieferschein / Rechnung ──────────────────────────────────────────────────

const dokumentStatus = z.enum(['entwurf', 'final'], { error: "muss 'entwurf' oder 'final' sein" });

const lieferscheinSchema = z.object({
  Nummer: text(20),
  Kundennummer: ganzzahl({ min: 1 }),
  Artikelnummern: z
    .array(vollstaendigeArtikelnummer)
    .max(1000, 'darf maximal 1000 Artikelnummern enthalten')
    .optional(),
  status: dokumentStatus.optional(),
});

const rechnungSchema = lieferscheinSchema.extend({
  rabatt_gesamt: zahl({ min: 0, max: 100 }),
  // Rabatte je Position: { "MHO123_1": 10 }
  rabatt_positionen: z.record(vollstaendigeArtikelnummer, zahl({ min: 0, max: 100 })).nullish(),
});

// ── Benutzerverwaltung / Auth ────────────────────────────────────────────────

const rolle = z.enum(['admin', 'bearbeiter', 'user'], { error: 'ist keine gültige Rolle' });

const userCreateSchema = z.object({
  username: pflichttext(100),
  password: neuesPasswort,
  email: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.email('ist keine gültige E-Mail-Adresse').max(200).nullish(),
  ),
  role: rolle,
  active: bool(),
});

const userUpdateSchema = userCreateSchema.omit({ password: true });

const resetPasswordSchema = z.object({ newPassword: neuesPasswort });

// Beim Login gilt bewusst keine Mindestlänge: Altkonten mit kürzerem Passwort
// sollen sich weiterhin anmelden können (danach greift must_change_password).
const loginSchema = z.object({
  username: pflichttext(100),
  password: bestehendesPasswort,
});

const changePasswordSchema = z.object({
  currentPassword: bestehendesPasswort,
  newPassword: neuesPasswort,
});

const forgotPasswordSchema = z.object({
  username: pflichttext(100),
});

const resetPasswordWithTokenSchema = z.object({
  // crypto.randomBytes(32).toString('hex') – siehe utils/accountSecurity.js
  token: z.string().regex(/^[0-9a-f]{64}$/, 'ist kein gültiges Reset-Token'),
  newPassword: neuesPasswort,
});

// ── Bestellungen (DSGVO) ─────────────────────────────────────────────────────

// Hausnummer und PLZ dürfen als Zahl ankommen – bestellungService behandelt
// sie ohnehin per toString(). Deshalb hier tolerant nach String wandeln.
const textOderZahl = (max) =>
  z.preprocess(
    (v) => (typeof v === 'number' ? String(v) : v),
    text(max),
  );

const bestellungKundeSchema = z.object({
  name: text(200),
  email: text(200),
  telefonnummer: text(200),
  strasse: text(200),
  hausnummer: textOderZahl(200),
  plz: textOderZahl(200),
  ort: text(200),
});

const versandart = z.enum(['abholung', 'lieferung'], {
  error: "muss 'abholung' oder 'lieferung' sein",
});

const bestellungBasisSchema = z.object({
  versandart,
  wunschdatum: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.iso.date('muss ein Datum im Format JJJJ-MM-TT sein').nullish(),
  ),
  beschreibung: pflichttext(2000),
  kunde: bestellungKundeSchema.nullish(),
  consent: z.object({ erteilt: bool(), version: text(50) }).nullish(),
  // Referenzfoto als Data-URL (base64); 5 MB Bild ≈ 6,7 MB Base64-Text, Puffer für den Data-URL-Header.
  foto: text(7 * 1024 * 1024),
});

const bestellungPublicSchema = bestellungBasisSchema.extend({
  // Honeypot: für Menschen unsichtbar, wird nur von Bots ausgefüllt
  webseite: text(200),
});

const bestellungUpdateSchema = bestellungBasisSchema.extend({
  status: text(50),
});

// ── Lager-Inventur ───────────────────────────────────────────────────────────

const lagerinventurSchema = z.object({
  // Gezählte Mengen je Artikelnummer ({ "MHO123_1": 3 }), als JSONB gespeichert
  data: z.record(
    z.string().max(20, 'ist keine gültige Artikelnummer'),
    z.number().int('muss eine ganze Zahl sein').min(1, 'muss mindestens 1 sein').max(100000),
  ),
  kommentar: text(1000),
});

// ── Debug (Admin) ────────────────────────────────────────────────────────────

const bezeichnerRegex = /^[\p{L}\p{N}_]+$/u;

const debugUpdateSchema = z.object({
  primaryKey: z.string().max(100).regex(bezeichnerRegex, 'enthält unerlaubte Zeichen'),
  id: z.union([z.string().max(200), z.number()]),
  field: z.string().max(100).regex(bezeichnerRegex, 'enthält unerlaubte Zeichen'),
  value: z.union([z.string().max(10000), z.number(), z.boolean(), z.null()]).optional(),
});

// ── SumUp / Backup ───────────────────────────────────────────────────────────

const sumupImportSchema = z.object({
  csvData: z.union([
    z.string().min(1, 'darf nicht leer sein').max(20 * 1024 * 1024, 'ist zu groß (max. 20 MB)'),
    z.array(z.unknown()).max(100000, 'enthält zu viele Zeilen'),
  ]),
});

const backupImportSchema = z.object({
  backupData: z.union([z.string(), z.record(z.string(), z.unknown())]),
  selectedTables: z.array(z.string().max(100)).nullish(),
});

module.exports = {
  idParam,
  kundeSchema,
  restockSelectiveSchema,
  schmuckstueckCreateSchema,
  schmuckstueckUpdateSchema,
  schmuckstueckBulkSchema,
  lieferscheinSchema,
  rechnungSchema,
  userCreateSchema,
  userUpdateSchema,
  resetPasswordSchema,
  loginSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordWithTokenSchema,
  bestellungPublicSchema,
  bestellungBasisSchema,
  bestellungUpdateSchema,
  lagerinventurSchema,
  debugUpdateSchema,
  sumupImportSchema,
  backupImportSchema,
};
