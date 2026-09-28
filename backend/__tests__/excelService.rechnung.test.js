'use strict';

const ExcelJS = require('exceljs');
const { generateExcel } = require('../src/utils/excelService');

// Summenblock des Rechnungsbelegs: Werte kommen aus belegSummen() (SQL)
async function belegZellen(ueberschreiben = {}) {
  const buffer = await generateExcel('Rechnung', {
    Nummer: '2026-001',
    Datum: '2026-09-20T10:00:00Z',
    rabatt_gesamt: '0.00',
    rabatt_positionen: {},
    kunde: { ID: 15, Name: 'Online', Strasse: 'Weg', PLZ: 1067, Ort: 'Dresden', Provision: 0 },
    schmuckstuecke: [{ Artikelnummer: 'MHO123_1', Verkaufspreis: '40.00', Art: 'Stecker' }],
    summen: {
      gesamtwert: '40.00', gesamtrabatt_betrag: '0.00', summe_nach_rabatt: '40.00',
      provision_betrag: '0.00', ueberweisungsbetrag: '44.90',
    },
    versandkosten: '4.90',
    ...ueberschreiben,
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const werte = [];
  wb.worksheets[0].eachRow((row) => {
    werte.push([row.getCell(7).value, row.getCell(9).value]);
  });
  return werte;
}

describe('generateExcel – Versandkosten', () => {
  it('führt Versandkosten als eigene Zeile vor dem Überweisungsbetrag', async () => {
    const zeilen = await belegZellen();
    const labels = zeilen.map(([label]) => label);

    const versand = labels.indexOf('+ Versandkosten');
    expect(versand).toBeGreaterThan(labels.indexOf('- Provision'));
    expect(zeilen[versand][1]).toBe(4.9);
    expect(zeilen[versand + 1]).toEqual(['Überweisungsbetrag', 44.9]);
  });

  it('lässt die Zeile ohne Versandkosten weg', async () => {
    const labels = (await belegZellen({ versandkosten: null })).map(([label]) => label);

    expect(labels).not.toContain('+ Versandkosten');
  });
});
