const logger = require("../utils/logger");
const { FOTO_TABELLEN } = require("../utils/fotoService");

// ── Tabellen und Schlüssel aus dem Systemkatalog (Befunde B18, B17, B19) ────
//
// Vorher stand hier eine handgepflegte Liste von sieben Tabellennamen. Sie ließ
// `bestellung`, `bestellung_kunde` und `bestellung_consent` aus – also die
// komplette Bestellübersicht samt der DSGVO-Consent-Nachweise. Ein Export
// "aller Tabellen" war damit unvollständig, und nach einem Import (der mit
// TRUNCATE ... CASCADE beginnt) waren die Nachweise weg, ohne dass es irgendwo
// auffiel. Jede handgeschriebene Liste vergisst irgendwann einen Eintrag;
// deshalb wird sie hier aus `pg_class` abgeleitet und über die echten
// FK-Beziehungen aus `pg_constraint` topologisch sortiert.
const AUDIT_HASH_TRIGGER = "trg_audit_log_hash_chain";

// Kahn: Eltern zuerst. Bei gleicher Bereitschaft alphabetisch, damit die
// Reihenfolge – und damit ein Export – reproduzierbar ist.
function topologischSortieren(tabellen, kanten, aufZyklus) {
  const offen = new Set(tabellen);
  const elternVon = new Map(tabellen.map((t) => [t, new Set()]));
  for (const { kind, eltern } of kanten) {
    if (offen.has(kind) && offen.has(eltern)) elternVon.get(kind).add(eltern);
  }

  const sortiert = [];
  while (offen.size > 0) {
    const bereit = [...offen]
      .filter((t) => [...elternVon.get(t)].every((e) => !offen.has(e)))
      .sort();
    if (bereit.length === 0) {
      // FK-Zyklus: nicht auflösbar, Rest alphabetisch anhängen und melden.
      const rest = [...offen].sort();
      if (aufZyklus) aufZyklus(rest);
      sortiert.push(...rest);
      break;
    }
    for (const t of bereit) {
      sortiert.push(t);
      offen.delete(t);
    }
  }
  return sortiert;
}

// Alles, was Export und Import über das Schema wissen müssen – in einem Aufruf.
async function ermittleSchemaInfo(queryable) {
  const { rows: tabellenZeilen } = await queryable.query(
    `SELECT c.relname AS name
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname`,
  );
  // Fotos laufen über das Foto-ZIP (GET /export-fotos), nicht über das JSON.
  const tabellen = tabellenZeilen
    .map((r) => r.name)
    .filter((t) => !FOTO_TABELLEN.includes(t));

  const { rows: kanten } = await queryable.query(
    `SELECT src.relname AS kind, ziel.relname AS eltern
       FROM pg_constraint k
       JOIN pg_class src  ON src.oid  = k.conrelid
       JOIN pg_class ziel ON ziel.oid = k.confrelid
       JOIN pg_namespace n ON n.oid = src.relnamespace
      WHERE k.contype = 'f' AND n.nspname = 'public' AND src.oid <> ziel.oid`,
  );

  const { rows: pkZeilen } = await queryable.query(
    `SELECT tc.table_name AS tabelle, kcu.column_name AS spalte
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name
        AND kcu.table_schema    = tc.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema    = 'public'
      ORDER BY tc.table_name, kcu.ordinal_position`,
  );
  const primaerschluessel = new Map();
  for (const { tabelle, spalte } of pkZeilen) {
    if (!primaerschluessel.has(tabelle)) primaerschluessel.set(tabelle, []);
    primaerschluessel.get(tabelle).push(spalte);
  }

  const { rows: spaltenZeilen } = await queryable.query(
    `SELECT table_name  AS tabelle,
            column_name AS spalte,
            data_type   AS typ,
            column_default LIKE 'nextval%' AS hat_sequenz
       FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position`,
  );

  const spalten = new Map();
  for (const zeile of spaltenZeilen) {
    if (!spalten.has(zeile.tabelle)) spalten.set(zeile.tabelle, []);
    spalten.get(zeile.tabelle).push({ name: zeile.spalte, typ: zeile.typ });
  }

  // Befund B17: die setval-Handliste kannte lagerinventur nicht – der nächste
  // Inventur-Entwurf lief nach einem Import so lange in "duplicate key", bis
  // die Sequence aufgeholt hatte.
  const sequenzspalten = spaltenZeilen
    .filter((z) => z.hat_sequenz)
    .map((z) => ({ tabelle: z.tabelle, spalte: z.spalte }));

  const reihenfolge = topologischSortieren(tabellen, kanten, (rest) =>
    logger.warn("BACKUP", "FK-Zyklus im Schema, Reihenfolge unbestimmt", {
      tabellen: rest,
    }),
  );

  return { reihenfolge, kanten, primaerschluessel, sequenzspalten, spalten };
}

// Welche Tabellen räumt `TRUNCATE ... CASCADE` zusätzlich leer, weil sie auf
// eine der ausgewählten zeigen? Ohne diese Warnung ist ein selektiver Import
// von z. B. nur "Kunde" ein stiller Totalverlust der Bestellungen.
function ermittleKaskade(kanten, ausgewaehlt) {
  const betroffen = new Set(ausgewaehlt);
  let gewachsen = true;
  while (gewachsen) {
    gewachsen = false;
    for (const { kind, eltern } of kanten) {
      if (betroffen.has(eltern) && !betroffen.has(kind)) {
        betroffen.add(kind);
        gewachsen = true;
      }
    }
  }
  return [...betroffen].filter((t) => !ausgewaehlt.includes(t)).sort();
}

// `bytea` kommt aus pg als Buffer. Buffer.toJSON() ergibt
// {"type":"Buffer","data":[...]} – eine Zahl samt Komma je Byte, für die Fotos
// in "Foto"/bestellung_foto (Issue #208) rund das Vierfache der Bildgröße.
// Der Export schreibt deshalb {"type":"Buffer","base64":"..."}.
function dbWertZuJson(wert) {
  return Buffer.isBuffer(wert)
    ? { type: "Buffer", base64: wert.toString("base64") }
    : wert;
}

// Beim Import ist ein Buffer ein Objekt, kein Puffer – die verschlüsselten
// Bestellkunden-Felder (name_enc, telefonnummer_enc, …) und Fotos kämen als
// JSON-Text in der Spalte an. Hier zurück in einen Buffer; ältere Backups
// enthalten noch die data-Form.
function jsonWertZuDb(wert) {
  if (wert && typeof wert === "object" && wert.type === "Buffer") {
    if (typeof wert.base64 === "string") return Buffer.from(wert.base64, "base64");
    if (Array.isArray(wert.data)) return Buffer.from(wert.data);
  }
  return wert;
}

// Constraints, die die Datenbank selbst als NOT VALID führt, sind von den
// vorhandenen Zeilen nachweislich nicht erfüllt (hier:
// schmuckstueck_ausschuss_grund_required_chk, 240 Ausschuss-Stücke ohne Grund,
// Befund D7). Ein Import ist ein Wiederherstellen genau dieser Zeilen – als
// INSERT werden sie aber geprüft, und der komplette Import scheitert. Deshalb
// wird ein NOT-VALID-Constraint für die Dauer des Imports entfernt und danach
// wieder als NOT VALID angelegt: dieselbe Reihenfolge, die pg_dump benutzt
// (Daten vor Constraints). Validierte Constraints bleiben in Kraft – Daten, die
// gegen sie verstoßen, können in der Quelle nicht existiert haben.
async function ermittleNichtValidierteChecks(queryable, tabellen) {
  if (tabellen.length === 0) return [];
  const { rows } = await queryable.query(
    `SELECT c.conrelid::regclass::text AS tabelle,
            c.conname                  AS name,
            pg_get_constraintdef(c.oid) AS definition
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE c.contype = 'c' AND NOT c.convalidated
        AND n.nspname = 'public' AND t.relname = ANY($1::text[])`,
    [tabellen],
  );
  return rows;
}

async function loeseNichtValidierteChecks(client, tabellen) {
  const rows = await ermittleNichtValidierteChecks(client, tabellen);
  for (const { tabelle, name } of rows) {
    await client.query(`ALTER TABLE ${tabelle} DROP CONSTRAINT "${name}"`);
  }
  if (rows.length > 0) {
    logger.info("BACKUP", "NOT-VALID-Checks für den Import gelöst", {
      constraints: rows.map((r) => r.name),
    });
  }
  return rows;
}

// pg_get_constraintdef liefert die Definition inklusive "NOT VALID".
const checkWiederAnlegen = ({ tabelle, name, definition }) =>
  `ALTER TABLE ${tabelle} ADD CONSTRAINT "${name}" ${
    /NOT VALID\s*$/.test(definition) ? definition : `${definition} NOT VALID`
  }`;

async function stelleChecksWiederHer(client, geloest) {
  for (const check of geloest) {
    await client.query(checkWiederAnlegen(check));
  }
}

// node-postgres liefert timestamp/date als JS-Date – und ein Date kennt nur
// Millisekunden. Der Export verlor damit die Mikrosekunden jeder Zeile, die die
// laufende Anwendung geschrieben hat (CURRENT_TIMESTAMP liefert sechs Stellen).
// Für audit_log ist das fatal: `change_timestamp::text` geht in den SHA-256 der
// Hash-Kette ein, also meldete `verify_audit_chain()` nach jedem Import
// `hash_mismatch` für genau diese Zeilen – gemessen 29 von 4368, nämlich alle,
// die nicht aus dem Seed stammten. Als ::text exportiert bleibt der Wert exakt,
// und Postgres parst ihn beim Import unverändert zurück.
const ZEITTYPEN = new Set([
  "timestamp without time zone",
  "timestamp with time zone",
  "date",
  "time without time zone",
  "time with time zone",
]);

function selectListe(tabelle, spalten) {
  const liste = spalten.get(tabelle);
  if (!liste || liste.length === 0) return "*";
  return liste
    .map(({ name, typ }) =>
      ZEITTYPEN.has(typ) ? `"${name}"::text AS "${name}"` : `"${name}"`,
    )
    .join(", ");
}

function orderByPk(tabelle, primaerschluessel) {
  const spalten = primaerschluessel.get(tabelle);
  if (!spalten || spalten.length === 0) return "";
  return ` ORDER BY ${spalten.map((c) => `"${c}"`).join(", ")}`;
}

module.exports = {
  AUDIT_HASH_TRIGGER,
  ermittleSchemaInfo,
  ermittleKaskade,
  dbWertZuJson,
  jsonWertZuDb,
  ermittleNichtValidierteChecks,
  loeseNichtValidierteChecks,
  checkWiederAnlegen,
  stelleChecksWiederHer,
  selectListe,
  orderByPk,
};
