// Zeilentypen der Datenbank-Tabellen aus `db/init.sql`.
//
// Diese Typen bilden ab, was `pg` (node-postgres) tatsächlich zurückgibt,
// nicht das Postgres-Schema wörtlich. Wichtige Abweichungen:
// - INTEGER/SMALLINT/SERIAL/DOUBLE PRECISION -> number
// - NUMERIC/DECIMAL -> string (pg parst das bewusst NICHT zu number,
//   um Präzisionsverlust zu vermeiden – betrifft "Verkaufspreis")
// - TIMESTAMP/DATE -> Date (pg's Default-Typ-Parser gibt hier ein Date-Objekt
//   zurück, kein ISO-String – es gibt keinen `types.setTypeParser`-Override
//   in diesem Projekt, siehe backend/src/config/db.js)
// - BOOLEAN -> boolean
// - JSONB -> bereits geparstes Objekt/Array (pg dekodiert JSON automatisch)
// - BYTEA -> Buffer
//
// Bewusst nur die Tabellen, die per JSDoc referenziert werden (Schmuckstück,
// app_users); weitere Zeilentypen bei Bedarf aus db/init.sql ergänzen.
//
// Es gibt keine Query-Ergebnisse mit camelCase-Spalten: alle Original-Spalten
// aus init.sql tragen exakt ihre Groß-/Kleinschreibung inkl. Umlauten, weil
// sie in Postgres per doppelten Anführungszeichen angelegt wurden.

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
