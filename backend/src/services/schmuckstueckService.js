const { hatFotoSql } = require("../utils/fotoService");

const HAT_FOTO_SQL = hatFotoSql('"Schmuckstück"');

const SEARCHABLE_FIELDS = [
  "Artikelnummer",
  "Name",
  "Art",
  "Form",
  "Länge",
  "Fassung",
  "Farbe",
  "Inhalt_Material",
  "Inhalt_Farbe",
  "Inhalt_Farbakzent",
  "Inhalt_Zusatzmaterial",
  "Anhänger_Fassung",
  "Anhänger_Form",
  "Anhänger_Farbe",
  "Anhänger_Grösse",
  "Anhänger_Inhalt_Material",
  "Anhänger_Inhalt_Farbe",
  "Anhänger_Inhalt_Farbakzente",
  "Anhänger_Inhalt_Zusatzmaterial",
  "Material",
  "Grösse",
  "Anhänger",
  "Zwischenstück",
  "Herstellungskosten",
  "Verkaufspreis",
  "Ausgelagert",
  "Verkauft",
  "Ausschuss",
  "Ausschuss_Grund",
  "Lieferschein_ID",
  "Rechnung_ID",
  "Erstelldatum",
  "Letzte_Änderung",
];

const AUSSCHUSS_GRUND_CONSTRAINT = "schmuckstueck_ausschuss_grund_required_chk";

// Statusfilter aus den Query-Parametern. Die Bedeutung von "verkauft" steht im
// whereClauseBuilder, nicht in dieser Route (Befund F5): vorher hiess es hier
// builder.equals("Verkauft", parseInt(verkauft)), also woertlich "Verkauft = 1"
// -- damit lieferte das Dropdown "Verkauft" auch Ausschussstuecke, obwohl
// CLAUDE.md Verkauft als "Verkauft=1 AND Ausschuss=0" definiert.
// parseInt("abc") ergab ausserdem NaN als Query-Parameter und damit HTTP 500
// statt 400 (Befund C25).
const FLAG_WERTE = { 1: true, 0: false, true: true, false: false };

// Leerstrings bedeuten wie ueberall im Projekt "kein Wert", nicht "= 0"
// (siehe leerZuNull in schemas/common.js).
const istLeer = (wert) => wert === undefined || String(wert).trim() === "";

/**
 * Haengt verkauft/ausschuss/ausgelagert an den Builder.
 * @returns {string|null} Fehlermeldung fuer HTTP 400, oder null
 */
function statusFilterAnwenden(builder, query) {
  if (!istLeer(query.verkauft)) {
    const flag = FLAG_WERTE[String(query.verkauft)];
    if (flag === undefined) return "verkauft muss 0 oder 1 sein";
    if (flag) builder.verkauft();
    else builder.nichtVerkauft();
  }

  if (!istLeer(query.ausschuss)) {
    const flag = FLAG_WERTE[String(query.ausschuss)];
    if (flag === undefined) return "ausschuss muss 0 oder 1 sein";
    if (flag) builder.ausschuss();
    else builder.keinAusschuss();
  }

  // Mehrere Werte ("0,15") für Direktverkauf-Rechnungen: Lager plus Kunde
  if (!istLeer(query.ausgelagert)) {
    const kundeIds = String(query.ausgelagert).split(",").map((v) => (v.trim() === "" ? NaN : Number(v)));
    if (kundeIds.some((id) => !Number.isInteger(id) || id < 0)) {
      return "ausgelagert muss eine Kundennummer oder 0 sein (mehrere durch Komma getrennt)";
    }
    if (kundeIds.length > 1) builder.ausgelagertIn(kundeIds);
    else if (kundeIds[0] === 0) builder.imLager();
    else builder.ausgelagert(kundeIds[0]);
  }

  return null;
}

// ausschuss kommt aus zod als boolean (Befund B6); aeltere Aufrufer und Tests
// schicken 0/1 oder "1" -- beides bleibt gueltig.
function resolveAusschussGrund(ausschuss, ausschussGrund) {
  const istAusschuss = ausschuss === true || ausschuss === 1 || ausschuss === "1";
  const normalizedGrund =
    typeof ausschussGrund === "string" ? ausschussGrund.trim() : "";

  if (istAusschuss) {
    return normalizedGrund || "Defekt";
  }
  return normalizedGrund || null;
}

// Normalisiert wird im zod-Schema (Befund D4). Hier wird nur noch getrennt und
// getrimmt -- die String-Variante ("MHO123, MHO124") kommt als ein Feld an und
// kann von zod nicht einzeln normalisiert werden.
function normalizeBulkArtikelnummern(input) {
  if (Array.isArray(input)) {
    return input.map((value) => String(value || "").trim().toUpperCase());
  }

  if (typeof input === "string") {
    return input
      .split(/[\n,;]+/)
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean);
  }

  return [];
}

function parseBulkItemsFromPayload(payload) {
  if (Array.isArray(payload?.items)) {
    return payload.items
      .map((item) => ({ ...(item || {}) }))
      .filter((item) => Object.keys(item).length > 0)
      // Artikelnummer ist hier bereits normalisiert (zod, Befund D4)
      .map((item) => ({ ...item }));
  }

  const template = payload?.template || {};
  const artikelnummern = normalizeBulkArtikelnummern(payload?.artikelnummern);
  return artikelnummern.map((artikelnummer) => ({
    ...template,
    Artikelnummer: artikelnummer,
  }));
}

// Sortierung wie zuvor die 27 ORDER-BY-Klauseln: Zahlen numerisch,
// Text nach deutscher Kollation.
function vergleicheFilterwerte(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "de");
}

// GET filter-options (must come before /:artikelnummer!)
// Früher: 27 einzelne SELECT DISTINCT – also 27 Full-Table-Scans pro Aufruf.
// Jetzt ein einziger Scan, der alle Spalten gleichzeitig aggregiert.
const FILTER_OPTION_FIELDS = [
  "arten",
  "farben",
  "materialien",
  "formen",
  "anhaenger_fassungen",
  "anhaenger_formen",
  "anhaenger_farben",
  "anhaenger_groessen",
  "anhaenger_inhalt_materialien",
  "anhaenger_inhalt_farben",
  "anhaenger_inhalt_farbakzente",
  "anhaenger_inhalt_zusatzmaterialien",
  "inhalt_materialien",
  "inhalt_farben",
  "inhalt_farbakzente",
  "inhalt_zusatzmaterialien",
  "zwischenstuecke",
  "fassungen",
  "laengen",
  "groessen",
  "namen",
  "verkaufspreise",
  "herstellungskosten",
  "ausschuesse",
  "anhaenger",
  "ausschussgruende",
];

module.exports = {
  HAT_FOTO_SQL,
  SEARCHABLE_FIELDS,
  AUSSCHUSS_GRUND_CONSTRAINT,
  statusFilterAnwenden,
  resolveAusschussGrund,
  parseBulkItemsFromPayload,
  vergleicheFilterwerte,
  FILTER_OPTION_FIELDS,
};
