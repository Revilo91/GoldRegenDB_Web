const fs = require('fs');
const path = require('path');

// Opt-in-Liste für tsc (checkJs bleibt false, siehe TYPESCRIPT.md). Fällt ein
// `// @ts-check` weg, prüft `npm run typecheck` die Datei still nicht mehr –
// dieser Test macht das sichtbar. Neue Datei unter @ts-check: hier eintragen.
const TS_CHECK_DATEIEN = [
  'middleware/auth.js',
  'middleware/csrf.js',
  'middleware/httpsRedirect.js',
  'middleware/validate.js',
  'utils/accountSecurity.js',
  'utils/artikelBezeichnung.js',
  'utils/authCookie.js',
  'utils/constants.js',
  'utils/encryptionService.js',
  'utils/fotoDateiname.js',
  'utils/passwordService.js',
  'utils/rabatt.js',
  'utils/whereClauseBuilder.js',
];

const SRC = path.join(__dirname, '..', 'src');

function findeJsDateien(verzeichnis) {
  return fs.readdirSync(verzeichnis, { withFileTypes: true }).flatMap((eintrag) => {
    const pfad = path.join(verzeichnis, eintrag.name);
    if (eintrag.isDirectory()) return findeJsDateien(pfad);
    return pfad.endsWith('.js') ? [pfad] : [];
  });
}

const traegtTsCheck = (datei) => fs.readFileSync(datei, 'utf8').startsWith('// @ts-check');

describe('@ts-check Opt-in', () => {
  it.each(TS_CHECK_DATEIEN)('%s trägt // @ts-check in der ersten Zeile', (datei) => {
    expect(traegtTsCheck(path.join(SRC, datei))).toBe(true);
  });

  it('jede Datei mit // @ts-check steht in der Liste', () => {
    const inListe = new Set(TS_CHECK_DATEIEN.map((d) => path.join(SRC, d)));
    const fehlend = findeJsDateien(SRC).filter((d) => traegtTsCheck(d) && !inListe.has(d));
    expect(fehlend.map((d) => path.relative(SRC, d))).toEqual([]);
  });
});
