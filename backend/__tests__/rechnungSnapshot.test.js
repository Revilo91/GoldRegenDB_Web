'use strict';

jest.mock('../src/utils/rabatt', () => ({ belegSummen: jest.fn() }));

const { belegSummen } = require('../src/utils/rabatt');
const { schreibeSnapshot, leereSnapshot } = require('../src/services/rechnungSnapshot');
const { createTxClientMock, sqlVerlauf } = require('./helpers/txClientMock');

beforeEach(() => jest.clearAllMocks());

const SUMMEN = {
  gesamtwert: '100.00', gesamtrabatt_betrag: '10.00', provision: '40', provision_betrag: '36.00',
  versandkosten: '4.90', ueberweisungsbetrag: '58.90',
};

describe('schreibeSnapshot', () => {
  it('ersetzt die Positionen und schreibt die Summen aus belegSummen()', async () => {
    belegSummen.mockResolvedValueOnce(SUMMEN);
    const client = createTxClientMock();

    await schreibeSnapshot(client, 7);

    const verlauf = sqlVerlauf(client);
    expect(verlauf[0]).toContain('DELETE FROM "Rechnung_Position"');
    expect(verlauf[1]).toContain('INSERT INTO "Rechnung_Position"');
    // Positionsrabatt je Basis-Artikelnummer
    expect(verlauf[1]).toContain("split_part(s.\"Artikelnummer\", '_', 1)");
    expect(verlauf[1]).toContain('rabatt_positionen ->>');
    expect(belegSummen).toHaveBeenCalledWith(client, 'Rechnung', 7);
    const update = client.query.mock.calls[2];
    expect(update[0]).toContain('UPDATE "Rechnung"');
    expect(update[1]).toEqual([7, '100.00', '10.00', '40', '36.00', '4.90', '58.90']);
  });

  it('schreibt keine eigenen Statusfilter oder Statusänderungen', async () => {
    belegSummen.mockResolvedValueOnce(SUMMEN);
    const client = createTxClientMock();

    await schreibeSnapshot(client, 1);

    for (const sql of sqlVerlauf(client)) {
      expect(sql).not.toMatch(/"Verkauft"|"Ausschuss"|"Ausgelagert"/);
    }
  });

  it('bricht ab, wenn belegSummen scheitert, statt halbe Summen zu schreiben', async () => {
    belegSummen.mockRejectedValueOnce(new Error('kaputt'));
    const client = createTxClientMock();

    await expect(schreibeSnapshot(client, 1)).rejects.toThrow('kaputt');
    expect(sqlVerlauf(client).some((s) => s.includes('UPDATE "Rechnung"'))).toBe(false);
  });
});

describe('leereSnapshot', () => {
  it('löscht Positionen und setzt alle Summen samt snapshot_am auf NULL', async () => {
    const client = createTxClientMock();

    await leereSnapshot(client, 3);

    const [loeschen, update] = client.query.mock.calls;
    expect(loeschen[0]).toContain('DELETE FROM "Rechnung_Position"');
    expect(loeschen[1]).toEqual([3]);
    expect(update[0]).toContain('snapshot_am = NULL');
    expect(update[0]).toContain('summe_ueberweisung = NULL');
  });
});
