const SCHLUESSEL = "schmuckstuecke-ansicht";
export const ANSICHT = { TABELLE: "tabelle", RASTER: "raster" };

// localStorage kann fehlen oder werfen (privates Fenster, gesperrte Daten): dann gilt die Tabelle.
export function leseAnsicht() {
  try {
    return localStorage.getItem(SCHLUESSEL) === ANSICHT.RASTER ? ANSICHT.RASTER : ANSICHT.TABELLE;
  } catch {
    return ANSICHT.TABELLE;
  }
}

export function schreibeAnsicht(ansicht) {
  try {
    localStorage.setItem(SCHLUESSEL, ansicht);
  } catch {
    // Ohne Speicher gilt die Wahl nur für diese Sitzung.
  }
}
