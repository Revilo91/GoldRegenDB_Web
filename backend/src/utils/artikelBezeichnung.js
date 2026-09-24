const { GRUNDMATERIAL } = require('./constants');

const ARTIKEL_TYP = { H: 'Halskette', O: 'Ohrring', A: 'Armband', S: 'Schlüsselanhänger' };

// Artikelnummer "MHO123_2" → Basis "MHO123" (Stücke desselben Artikels teilen sich eine Rechnungsposition)
const artikelnummerBasis = (artikelnummer) => (artikelnummer || '').split('_')[0];

function artikelKategorie(s) {
  return GRUNDMATERIAL[artikelnummerBasis(s.Artikelnummer)[1]] || s.Art || '';
}

// Positionstext für Lieferschein/Rechnung (ursprünglich aus dem Python-Export portiert)
function artikelBezeichnung(s) {
  const getVal = (val) => (val && val !== '0' && val !== 0 ? val : '-');
  const artikelTyp = ARTIKEL_TYP[artikelnummerBasis(s.Artikelnummer)[2]] || '';

  if (s.Name && s.Name.trim()) return `${artikelTyp}: ${s.Name}`;
  if (artikelTyp === 'Ohrring') {
    return `${artikelTyp}: ${getVal(s.Art)} ${getVal(s.Form)} ${getVal(s.Fassung)} ${getVal(s.Farbe)}, `
      + getVal(s.Inhalt_Zusatzmaterial);
  }
  if (artikelTyp === 'Halskette') {
    return `${artikelTyp}: Fassung ${getVal(s.Anhänger_Fassung)} ${getVal(s.Anhänger_Form)}, `
      + `${getVal(s.Anhänger_Inhalt_Farbe)} ${getVal(s.Anhänger_Inhalt_Zusatzmaterial)}`;
  }
  if (artikelTyp === 'Armband') {
    return `${artikelTyp}: ${getVal(s.Art)} ${getVal(s.Farbe)}, ${getVal(s.Anhänger)}, ${getVal(s.Zwischenstück)}`;
  }
  if (artikelTyp === 'Schlüsselanhänger') return `${artikelTyp}: ${getVal(s.Art)} ${getVal(s.Form)}`;
  return `${s.Art || ''}: ${s.Material || ''} ${s.Farbe || ''}`;
}

module.exports = { artikelnummerBasis, artikelKategorie, artikelBezeichnung };
