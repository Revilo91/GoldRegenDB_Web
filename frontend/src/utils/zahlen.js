// Zahlen- und Geldbehandlung an einer Stelle.
//
// Vorher lag beides verstreut: parseFloat(e.target.value) ohne NaN-Schutz an
// fünf Stellen in Schmuckstuecke.jsx (nur eine hatte "|| 0"), und vier
// verschiedene Geldformatierungen (`${wert}€`, toFixed(0), toFixed(2),
// toLocaleString). Nur Inventur.jsx formatierte deutsch korrekt.

// Liest eine Nutzereingabe als Zahl.
//
// Wichtig für deutsche Eingaben: "12,50" wird zu 12.5. Ein leeres Feld ergibt
// null (nicht 0 und nicht NaN) – parseFloat("") war NaN, und NaN wird von
// JSON.stringify zu null, was als explizites NULL in der Datenbank landete und
// den Preis stillschweigend löschte.
export function parseZahl(eingabe) {
  if (eingabe === null || eingabe === undefined) return null;
  const text = String(eingabe).trim();
  if (text === '') return null;
  const n = Number(text.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// Wie parseZahl, fällt aber auf einen Ersatzwert zurück statt auf null.
// Für Felder, die in der Datenbank NOT NULL sind oder fachlich 0 bedeuten.
export function parseZahlOderNull(eingabe, ersatz = null) {
  const n = parseZahl(eingabe);
  return n === null ? ersatz : n;
}

// Für den Wert eines Eingabefeldes: null/undefined werden zu "", damit React
// das Feld als kontrolliert behandelt und der Nutzer es leeren kann.
export function zahlFuerEingabe(wert) {
  if (wert === null || wert === undefined || Number.isNaN(wert)) return '';
  return String(wert).replace('.', ',');
}

// Geldbetrag in deutscher Schreibweise: 12,50 €
export function formatEur(wert) {
  return Number(wert ?? 0).toLocaleString('de-DE', {
    style: 'currency',
    currency: 'EUR',
  });
}

// Zahl in deutscher Schreibweise ohne Währung, z. B. für Maße.
export function formatZahl(wert, nachkommastellen = 2) {
  if (wert === null || wert === undefined || wert === '') return '';
  return Number(wert).toLocaleString('de-DE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: nachkommastellen,
  });
}
