// Hilfsfunktionen für Artikelnummern in der Mehrfach-Erfassung.

const PRAEFIX = /^[A-Z]{3}$/;
const MAX_LAUFNUMMER = 999;

// Liest die dreistellige Laufnummer aus "MHO127", "MHO127_1" usw. Gibt null
// zurück, wenn die Nummer ungültig ist oder ein anderes Präfix hat.
function laufnummerVon(artikelnummer, prefix) {
  const treffer = /^([A-Z]{3})(\d{3})(?:_\d+)?$/.exec(
    String(artikelnummer ?? '').trim().toUpperCase(),
  );
  if (!treffer || treffer[1] !== prefix) return null;
  return parseInt(treffer[2], 10);
}

// Bestimmt die Artikelnummer für eine neue Zeile aus einer Vorlage.
//
// Der Server reserviert Nummern nicht: Er liefert bei jeder Anfrage dieselbe
// nächste freie Nummer. Deshalb zählen wir hinter den Nummern weiter, die in
// den Zeilen der Tabelle schon vergeben, aber noch nicht gespeichert sind.
// Gibt "" zurück, wenn Präfix oder Serverantwort nicht passen oder die Nummer
// über 999 hinausginge (das Format erlaubt nur drei Stellen).
export function naechsteVorlagenNummer(prefix, serverArtikelnummer, rows) {
  if (!PRAEFIX.test(prefix)) return '';
  const vomServer = laufnummerVon(serverArtikelnummer, prefix);
  if (vomServer === null) return '';

  const hoechsteLokal = (rows || []).reduce((hoechste, row) => {
    const nummer = laufnummerVon(row?.Artikelnummer, prefix);
    return nummer === null ? hoechste : Math.max(hoechste, nummer);
  }, 0);

  const laufnummer = Math.max(vomServer, hoechsteLokal + 1);
  if (laufnummer > MAX_LAUFNUMMER) return '';
  return `${prefix}${String(laufnummer).padStart(3, '0')}_1`;
}
