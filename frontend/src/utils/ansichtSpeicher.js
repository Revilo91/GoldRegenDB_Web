const SCHLUESSEL = "schmuckstuecke-ansicht";
export const ANSICHT = { LISTE: "liste", TABELLE: "tabelle", RASTER: "raster" };

// Liefert die gespeicherte Wahl oder null (nichts gespeichert, ungültig, localStorage fehlt oder wirft):
// dann bestimmt die Seite den Standard je nach Fensterbreite.
export function leseAnsicht() {
  try {
    const wert = localStorage.getItem(SCHLUESSEL);
    return Object.values(ANSICHT).includes(wert) ? wert : null;
  } catch {
    return null;
  }
}

export function schreibeAnsicht(ansicht) {
  try {
    localStorage.setItem(SCHLUESSEL, ansicht);
  } catch {
    // Ohne Speicher gilt die Wahl nur für diese Sitzung.
  }
}
