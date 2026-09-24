// Zeilentypen der Datenbank-Tabellen aus `db/init.sql`.
//
// Diese Typen bilden ab, was `pg` (node-postgres) tatsächlich zurückgibt,
// nicht das Postgres-Schema wörtlich. Wichtige Abweichungen:
// - INTEGER/SMALLINT/SERIAL/DOUBLE PRECISION -> number
// - NUMERIC/DECIMAL -> string (pg parst das bewusst NICHT zu number,
//   um Präzisionsverlust zu vermeiden – betrifft "Rechnung".rabatt_gesamt)
// - TIMESTAMP/DATE -> Date (pg's Default-Typ-Parser gibt hier ein Date-Objekt
//   zurück, kein ISO-String – es gibt keinen `types.setTypeParser`-Override
//   in diesem Projekt, siehe backend/src/config/db.js)
// - BOOLEAN -> boolean
// - JSONB -> bereits geparstes Objekt/Array (pg dekodiert JSON automatisch)
// - BYTEA -> Buffer
//
// Es gibt keine Query-Ergebnisse mit camelCase-Spalten: alle Original-Spalten
// aus init.sql tragen exakt ihre Groß-/Kleinschreibung inkl. Umlauten, weil
// sie in Postgres per doppelten Anführungszeichen angelegt wurden.

// ── Kunde ────────────────────────────────────────────────────────────────────

export interface KundeRow {
  ID: number;
  Name: string;
  Strasse: string;
  Hausnummer: number;
  Ort: string;
  PLZ: number;
  Email: string | null;
  Telefonnummer: string | null;
  Provision: number;
  Aktiv: boolean;
}

// ── Lieferschein / Rechnung ──────────────────────────────────────────────────

export type DokumentStatus = 'entwurf' | 'final';

export interface LieferscheinRow {
  ID: number;
  Nummer: string;
  Kundennummer: number;
  Datum: Date;
  status: DokumentStatus;
}

export interface RechnungRow {
  ID: number;
  Nummer: string;
  Kundennummer: number;
  Datum: Date;
  status: DokumentStatus;
  // NUMERIC(5,2) – kommt als String zurück, siehe Kommentar oben. Die Routen
  // wandeln das beim Lesen selbst per Number(...) um (routes/rechnungen.js).
  rabatt_gesamt: string;
  // JSONB, z. B. { "MHO123_1": 10 } – Rabatt je Artikelnummer in Prozent.
  rabatt_positionen: Record<string, number>;
}

// ── Schmuckstück ─────────────────────────────────────────────────────────────
//
// Status-Logik (siehe CLAUDE.md / WHERE_BUILDER.md) – KEIN eigenes
// "verfuegbar"-Feld in der DB, die drei Flags unten bestimmen den Status:
//   Verfügbar:        Verkauft IS FALSE AND Ausschuss IS FALSE AND Ausgelagert=0
//   Verkauft:         Verkauft IS TRUE  AND Ausschuss IS FALSE
//   Ausschuss:        Ausschuss IS TRUE
//   Aktiv ausgelagert: Ausgelagert>0 AND Verkauft IS FALSE AND Ausschuss IS FALSE
//
// "Verkauft"/"Ausschuss" sind boolean NOT NULL (Befund B6) – bis Gruppe 2 waren
// es nullable SMALLINT, in denen 2 oder NULL speicherbar war; so eine Zeile war
// in KEINEM Filter enthalten. Die Zod-Schemas nutzen bool(), das 0/1 und
// "1"/"0" weiterhin annimmt. Ein CHECK schmuck_status_chk verbietet
// Verkauft UND Ausschuss gleichzeitig.
// "Ausgelagert" ist eine Kundennummer (>0) oder 0, kein Boolean.
export interface SchmuckstueckRow {
  Artikelnummer: string;
  Name: string | null;
  Foto: string | null;
  Art: string | null;
  Form: string | null;
  Länge: number;
  Fassung: string | null;
  Farbe: string | null;
  Inhalt_Material: string | null;
  Inhalt_Farbe: string | null;
  Inhalt_Farbakzent: string | null;
  Inhalt_Zusatzmaterial: string | null;
  Anhänger_Fassung: string | null;
  Anhänger_Form: string | null;
  Anhänger_Farbe: string | null;
  Anhänger_Grösse: number;
  Anhänger_Inhalt_Material: string | null;
  Anhänger_Inhalt_Farbe: string | null;
  Anhänger_Inhalt_Farbakzente: string | null;
  Anhänger_Inhalt_Zusatzmaterial: string | null;
  Material: string | null;
  Grösse: number;
  Anhänger: string | null;
  Zwischenstück: string | null;
  /** NUMERIC(10,2) – kommt als String zurück, siehe Kommentar oben (Befund B1). */
  Herstellungskosten: string;
  /** NUMERIC(10,2) – kommt als String zurück, siehe Kommentar oben (Befund B1). */
  Verkaufspreis: string;
  /** 0 = nicht ausgelagert, sonst Kundennummer ("Kunde"."ID"), an die ausgelagert wurde. */
  Ausgelagert: number;
  Verkauft: boolean;
  Ausschuss: boolean;
  Ausschuss_Grund: string | null;
  /** 0 = keinem Lieferschein zugeordnet, sonst "Lieferschein"."ID". */
  Lieferschein_ID: number;
  /** 0 = keiner Rechnung zugeordnet, sonst "Rechnung"."ID". */
  Rechnung_ID: number;
  Erstelldatum: Date;
  Letzte_Änderung: Date;
}

// ── audit_log ────────────────────────────────────────────────────────────────

export type AuditActionType = 'INSERT' | 'UPDATE' | 'DELETE';

export interface AuditLogRow {
  id: number;
  table_name: string;
  artikelnummer_id: string | null;
  column_name: string | null;
  old_value: string | null;
  new_value: string | null;
  action_type: AuditActionType;
  changed_by: string | null;
  change_timestamp: Date;
}

// ── app_users ────────────────────────────────────────────────────────────────

export type AppRole = 'admin' | 'bearbeiter' | 'user';

export interface AppUserRow {
  id: number;
  username: string;
  password_hash: string;
  email: string | null;
  role: AppRole;
  active: boolean;
  must_change_password: boolean;
  created_at: Date;
  last_login: Date | null;
  failed_login_attempts: number;
  locked_until: Date | null;
  reset_token_hash: string | null;
  reset_token_expiry: Date | null;
}

// ── lagerinventur ────────────────────────────────────────────────────────────

export type LagerinventurStatus = 'entwurf' | 'abgeschlossen';

export interface LagerinventurRow {
  id: number;
  user_id: number;
  created_at: Date;
  updated_at: Date;
  status: LagerinventurStatus;
  // JSONB: { "MHO123_1": 3, ... } – gezählte Menge je Artikelnummer.
  data: Record<string, number>;
  kommentar: string | null;
}

// ── Bestellübersicht (DSGVO) ─────────────────────────────────────────────────

export type VersandartTyp = 'lieferung' | 'abholung';
export type BestellstatusTyp = 'offen' | 'in_bearbeitung' | 'abgeschlossen' | 'storniert';

// Alle *_enc-Spalten sind AES-256-GCM-verschlüsselt (encryptionService.js) und
// NULL, wenn nicht erfasst ODER bereits anonymisiert (Art. 17 DSGVO).
export interface BestellungKundeRow {
  id: number;
  kunde_pseudonym: string;
  name_enc: Buffer | null;
  email_enc: Buffer | null;
  telefonnummer_enc: Buffer | null;
  strasse_enc: Buffer | null;
  hausnummer_enc: Buffer | null;
  plz_enc: Buffer | null;
  ort_enc: Buffer | null;
  anonymisiert: boolean;
  anonymisiert_am: Date | null;
  erstellt_am: Date;
}

export interface BestellungRow {
  id: number;
  bestellnummer: string;
  kunde_id: number;
  versandart: VersandartTyp;
  erfassungsdatum: Date;
  // DATE-Spalte – kommt bei diesem Projekt (kein setTypeParser) ebenfalls als
  // Date zurück, nicht als "JJJJ-MM-TT"-String.
  wunschdatum: Date | null;
  beschreibung: string;
  status: BestellstatusTyp;
  rechnung_nummer: string | null;
  erstellt_von: string;
  erstellt_am: Date;
  aktualisiert_am: Date;
}

export interface BestellungConsentRow {
  id: number;
  kunde_id: number;
  consent_typ: string;
  consent_erteilt: boolean;
  consent_zeitpunkt: Date;
  datenschutz_version: string;
  ip_hash: string | null;
}
