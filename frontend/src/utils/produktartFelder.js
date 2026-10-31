// Welche Feldgruppen im Schmuckstück-Formular zu welcher Produktart gehören
// (A = Armband, H = Halskette, O = Ohrring, S = Schlüsselanhänger).
// Alle übrigen Felder sind bei jeder Produktart sichtbar.
const GRUPPEN_NACH_PRODUKTART = {
  A: ['laenge', 'zwischenstueck'],
  H: ['laenge', 'zwischenstueck', 'anhaenger'],
  O: ['laenge'],
  S: ['anhaenger'],
};

// Produktart-Code aus dem Formular, sonst aus dem dritten Zeichen der
// Artikelnummer (beim Bearbeiten gibt es nur die Nummer).
export function produktartCodeVon({ ProduktartCode, Artikelnummer } = {}) {
  const code = ProduktartCode || String(Artikelnummer || '').charAt(2);
  return code.toUpperCase();
}

// Ob eine Feldgruppe zur Produktart gehört. Ohne bekannte Produktart bleibt
// alles sichtbar. Ausgeblendete Felder behalten ihren Wert im Formular.
export function zeigtFeldgruppe(produktartCode, gruppe) {
  const gruppen = GRUPPEN_NACH_PRODUKTART[produktartCode];
  return gruppen ? gruppen.includes(gruppe) : true;
}
