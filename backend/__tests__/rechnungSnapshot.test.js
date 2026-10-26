'use strict';

jest.mock('../src/utils/rabatt', () => ({ belegSummen: jest.fn() }));

const { belegSummen } = require('../src/utils/rabatt');
const { schreibeSnapshot, leereSnapshot, wendeSnapshotAn, istEingefroren } = require('../src/services/rechnungSnapshot');
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
    expect(belegSummen).toHaveBeenCalledWith(client, 'Rechnung', 7, { live: true });
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

describe('wendeSnapshotAn', () => {
  const eingefroren = {
    status: 'final', snapshot_am: '2026-10-01T10:00:00Z', rabatt_gesamt: '10.00', rabatt_positionen: { MHO1: 5 },
    summe_brutto: '100.00', rabatt_gesamt_betrag: '10.00', provision_prozent: '40.00', versand_betrag: '4.90',
    versandkosten: '99.00',
  };
  const stuecke = [
    { Artikelnummer: 'MHO1_1', Verkaufspreis: '99.00', snapshot_einzelpreis: '20.00', snapshot_positionsrabatt: '25.00' },
    { Artikelnummer: 'SHO2_1', Verkaufspreis: '7.00', snapshot_einzelpreis: null, snapshot_positionsrabatt: null },
  ];

  it('legt bei finalen Rechnungen den gespeicherten Stand über Preise, Rabatte, Versand und Provision', () => {
    const erg = wendeSnapshotAn(eingefroren, stuecke);

    expect(erg.stuecke[0].Verkaufspreis).toBe('20.00');
    expect(erg.stuecke[1].Verkaufspreis).toBe('7.00'); // ohne Snapshot-Zeile bleibt live
    expect(erg.rechnung.rabatt_positionen).toEqual({ MHO1: 25 });
    expect(erg.rechnung.versandkosten).toBe('4.90');
    expect(erg.rechnung.rabatt_gesamt).toBe(10);
    expect(erg.provisionProzent).toBe('40.00');
  });

  it('rechnet den Gesamtrabatt-Prozentwert aus dem Betrag zurück, wenn rabatt_gesamt nachträglich geändert wurde', () => {
    const erg = wendeSnapshotAn({ ...eingefroren, rabatt_gesamt: '50.00' }, stuecke);

    expect(erg.rechnung.rabatt_gesamt).toBe(10);
  });

  it('lässt Entwürfe und Rechnungen ohne Snapshot unverändert', () => {
    const entwurf = { ...eingefroren, status: 'entwurf' };
    const ohne = { ...eingefroren, snapshot_am: null };

    expect(wendeSnapshotAn(entwurf, stuecke)).toEqual({ rechnung: entwurf, stuecke, provisionProzent: null });
    expect(wendeSnapshotAn(ohne, stuecke)).toEqual({ rechnung: ohne, stuecke, provisionProzent: null });
    expect(istEingefroren(entwurf)).toBe(false);
    expect(istEingefroren(eingefroren)).toBe(true);
  });
});
