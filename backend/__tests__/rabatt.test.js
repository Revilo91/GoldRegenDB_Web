'use strict';

/**
 * Tests für utils/rabatt.js.
 *
 * Befund C17/C18/G7: Rabatte wurden nur in excelService.js angewandt. Dashboard,
 * Inventur und die Auszahlungsaufteilung im Frontend rechneten ohne sie -- bei
 * 20 % Rabatt stand im Modal ein um 20 % zu hoher Auszahlungsbetrag je
 * Herstellerin, und genau danach wird abgerechnet.
 *
 * Die Reihenfolge stammt aus dem Beleg selbst (excelService.js, "Total Block"),
 * nicht aus einer eigenen Idee:
 *   Gesamtwert -> - Gesamtrabatt -> - Provision -> Überweisungsbetrag
 */

const {
  preisNachPositionsrabattSql,
  preisNachAllenRabattenSql,
  preisNachPositionsrabatt,
  rechnungsSummen,
} = require('../src/utils/rabatt');

describe('preisNachPositionsrabatt(preis, rabatt)', () => {
  it('gibt den Preis unverändert zurück, wenn kein Rabatt gesetzt ist', () => {
    expect(preisNachPositionsrabatt('15.00', 0)).toBe(15);
    expect(preisNachPositionsrabatt('15.00', null)).toBe(15);
    expect(preisNachPositionsrabatt('15.00', undefined)).toBe(15);
  });

  it('zieht den Positionsrabatt ab und rundet auf Cent', () => {
    expect(preisNachPositionsrabatt('15.00', 10)).toBe(13.5);
    expect(preisNachPositionsrabatt('19.99', 10)).toBe(17.99);
    // 19.99 * 0.85 = 16.9915 -> 16.99, nicht 16.991500000000002
    expect(preisNachPositionsrabatt('19.99', 15)).toBe(16.99);
  });

  it('nimmt numeric auch als String (so liefert pg es, Befund B1)', () => {
    expect(preisNachPositionsrabatt('24.50', '50')).toBe(12.25);
  });

  it('behandelt unlesbare Werte als 0', () => {
    expect(preisNachPositionsrabatt(null, 10)).toBe(0);
    expect(preisNachPositionsrabatt('abc', 10)).toBe(0);
  });
});

describe('SQL-Ausdrücke', () => {
  it('schlüsselt den Positionsrabatt nach der BASIS-Artikelnummer', () => {
    const sql = preisNachPositionsrabattSql('s', 'r');
    // rabatt_positionen enthält MHO123, nicht MHO123_1
    expect(sql).toContain("split_part(s.\"Artikelnummer\", '_', 1)");
    expect(sql).toContain('s."Verkaufspreis"');
    expect(sql).toContain('r.rabatt_positionen');
  });

  it('respektiert übergebene Tabellenaliase', () => {
    const sql = preisNachPositionsrabattSql('stueck', 'rech');
    expect(sql).toContain('stueck."Verkaufspreis"');
    expect(sql).toContain('rech.rabatt_positionen');
  });

  it('castet den JSON-Wert auf numeric und fängt Leerstrings ab', () => {
    const sql = preisNachPositionsrabattSql();
    expect(sql).toContain('::numeric');
    // NULLIF: ein leerer JSON-Wert würde beim Cast auf numeric werfen
    expect(sql).toContain('NULLIF(');
  });

  it('nimmt im Gesamtausdruck zusätzlich rabatt_gesamt', () => {
    const sql = preisNachAllenRabattenSql();
    expect(sql).toContain('rabatt_positionen');
    expect(sql).toContain('r.rabatt_gesamt');
  });
});

describe('rechnungsSummen(queryable, id)', () => {
  it('castet die Provision auf numeric', async () => {
    // "Provision" ist INTEGER (Befund B8). 40 / 100 ist in SQL
    // Ganzzahldivision, also 0 -- ohne den Cast war der Überweisungsbetrag
    // gleich der Summe vor Provision. Das ist beim Abnahmetest aufgefallen.
    const queryable = { query: jest.fn().mockResolvedValue({ rows: [{}] }) };

    await rechnungsSummen(queryable, 10);

    const sql = String(queryable.query.mock.calls[0][0]);
    expect(sql).toContain('COALESCE(k."Provision", 0)::numeric');
    expect(sql).toContain('COALESCE(r.rabatt_gesamt, 0)::numeric');
  });

  it('rechnet in der Reihenfolge des Belegs und rundet jede Zeile auf Cent', async () => {
    const queryable = { query: jest.fn().mockResolvedValue({ rows: [{}] }) };

    await rechnungsSummen(queryable, 10);

    const sql = String(queryable.query.mock.calls[0][0]);
    for (const feld of [
      'gesamtwert', 'gesamtrabatt_betrag', 'summe_nach_rabatt',
      'provision_betrag', 'ueberweisungsbetrag',
      'marina_brutto', 'marina_netto', 'saskia_brutto', 'saskia_netto',
    ]) {
      expect(sql).toContain(`AS ${feld}`);
    }
    // Jede Summe wird gerundet: numeric * numeric ergibt sonst 40 Stellen
    expect(sql.match(/round\(/g).length).toBeGreaterThanOrEqual(9);
    expect(queryable.query.mock.calls[0][1]).toEqual([10]);
  });

  it('teilt nach Herstellerkürzel M und S auf (Befund G7)', async () => {
    const queryable = { query: jest.fn().mockResolvedValue({ rows: [{}] }) };

    await rechnungsSummen(queryable, 10);

    const sql = String(queryable.query.mock.calls[0][0]);
    expect(sql).toContain("FILTER (WHERE hersteller = 'M')");
    expect(sql).toContain("FILTER (WHERE hersteller = 'S')");
  });

  it('liefert null, wenn die Rechnung nicht existiert', async () => {
    const queryable = { query: jest.fn().mockResolvedValue({ rows: [] }) };

    await expect(rechnungsSummen(queryable, 999)).resolves.toBeNull();
  });
});
