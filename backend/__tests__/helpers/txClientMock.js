'use strict';

// Client-Mock für Handler, die über db.connect() in einer Transaktion
// arbeiten. Statt einer langen Kette aus mockResolvedValueOnce wird je
// SQL-Fragment ein Ergebnis hinterlegt; alles andere liefert ein leeres
// Resultat. Damit bleiben die Tests lesbar, auch wenn ein Handler eine
// weitere Query dazubekommt.
//
//   const client = createTxClientMock({
//     ergebnisse: { 'UPDATE "Lieferschein"': { rows: [{ ID: 1 }] } },
//     fehlerBei: 'UPDATE "Schmuckstück"',
//   });
//
// fehlerBei lässt genau die Query scheitern, deren SQL das Fragment enthält –
// so wird geprüft, ob der erste Schritt zurückgerollt wird.
// Standardantwort für belegSummen() (Snapshot beim Speichern einer Rechnung)
const BELEG_SUMMEN_NULL = {
  rows: [{
    gesamtwert: '0.00', gesamtrabatt_betrag: '0.00', provision: '0', provision_betrag: '0.00',
    versandkosten: '0', ueberweisungsbetrag: '0.00',
  }],
  rowCount: 1,
};

function createTxClientMock({ ergebnisse: eigene = {}, fehlerBei = null, fehler = null } = {}) {
  const ergebnisse = { ...eigene, 'WITH positionen AS': BELEG_SUMMEN_NULL };
  const client = {
    query: jest.fn(async (sql) => {
      const text = String(sql);
      if (fehlerBei && text.includes(fehlerBei)) {
        throw fehler || Object.assign(new Error('Testfehler in der Datenbank'), { code: 'XX000' });
      }
      for (const [fragment, ergebnis] of Object.entries(ergebnisse)) {
        if (text.includes(fragment)) {
          return ergebnis;
        }
      }
      return { rows: [], rowCount: 0 };
    }),
    release: jest.fn(),
  };
  return client;
}

// Die SQL-Texte aller Aufrufe in Reihenfolge – für Erwartungen wie
// expect(sqlVerlauf(client)).toContain('ROLLBACK').
function sqlVerlauf(client) {
  return client.query.mock.calls.map((aufruf) => String(aufruf[0]));
}

module.exports = { createTxClientMock, sqlVerlauf };
