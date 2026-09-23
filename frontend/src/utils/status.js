// Status eines Schmuckstücks an EINER Stelle.
//
// Befund G22: die Status-Logik existierte dreifach im Frontend --
// Schmuckstuecke.jsx, SchmuckstueckModal.jsx und Inventur.jsx -- und zeigte
// dabei *unterschiedliche* Badges für denselben Zustand: "Lager" war einmal
// `badge gold` und einmal `badge warning`. Die verbindliche Definition steht
// laut CLAUDE.md im whereClauseBuilder; hier ist ihr Gegenstück für die
// Anzeige.
//
// "Verkauft" und "Ausschuss" sind seit der Boolean-Migration echte Booleans
// (Befund B6). Die Prüfungen sind deshalb truthy und nicht `=== 1` -- so
// funktionieren sie auch, wenn ein älterer Aufrufer noch 0/1 schickt.

export const STATUS = {
  VERKAUFT: "verkauft",
  AUSSCHUSS: "ausschuss",
  AUSGELAGERT: "ausgelagert",
  LAGER: "lager",
};

/**
 * Der Status eines Stücks, in derselben Reihenfolge wie der whereClauseBuilder
 * sie prüft: Ausschuss schlägt alles, dann Verkauft, dann Ausgelagert.
 */
export function statusVon(stueck) {
  if (!stueck) return STATUS.LAGER;
  if (istWahr(stueck.Ausschuss)) return STATUS.AUSSCHUSS;
  if (istWahr(stueck.Verkauft)) return STATUS.VERKAUFT;
  if (Number(stueck.Ausgelagert) > 0) return STATUS.AUSGELAGERT;
  return STATUS.LAGER;
}

// true, "true", 1 und "1" gelten als gesetzt.
export function istWahr(wert) {
  return wert === true || wert === 1 || wert === "1" || wert === "true";
}

const BADGES = {
  [STATUS.VERKAUFT]: { label: "Verkauft", klasse: "badge success" },
  [STATUS.AUSSCHUSS]: { label: "Ausschuss", klasse: "badge danger" },
  [STATUS.AUSGELAGERT]: { label: "Ausgelagert", klasse: "badge gold" },
  [STATUS.LAGER]: { label: "Lager", klasse: "badge gold" },
};

/**
 * Label und CSS-Klasse für das Status-Badge.
 * @param {object} stueck
 * @param {(kundeId: number) => string} [kundenName] Löst Ausgelagert auf einen
 *   Kundennamen auf; ohne das bleibt es beim Wort "Ausgelagert".
 */
export function statusBadge(stueck, kundenName) {
  const status = statusVon(stueck);
  const badge = BADGES[status];
  if (status === STATUS.AUSGELAGERT && kundenName) {
    return { ...badge, label: kundenName(stueck.Ausgelagert) };
  }
  return badge;
}
