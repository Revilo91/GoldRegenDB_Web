const {
  markiereVerkauft,
  hebeVerkauftAuf,
  lagereAus,
  lagereOffeneAus,
  hebeAuslagerungAuf,
  lagereZurueck,
} = require('../src/utils/statusUebergaenge');

const mockClient = (rowCount = 2) => ({ query: jest.fn().mockResolvedValue({ rowCount, rows: [] }) });

describe('statusUebergaenge', () => {
  describe('markiereVerkauft', () => {
    it('setzt Verkauft und Rechnung_ID parametrisiert', async () => {
      const client = mockClient();
      const n = await markiereVerkauft(client, ['MHO1_1', 'MHO2_1'], 7);
      expect(n).toBe(2);
      const [sql, params] = client.query.mock.calls[0];
      expect(sql).toContain('"Verkauft" = TRUE');
      expect(sql).toContain('"Rechnung_ID" = $1');
      expect(params).toEqual([7, ['MHO1_1', 'MHO2_1']]);
    });

    it.each([[[]], [null], [undefined]])('führt bei leerer Liste %p keine Query aus', async (liste) => {
      const client = mockClient();
      expect(await markiereVerkauft(client, liste, 7)).toBe(0);
      expect(client.query).not.toHaveBeenCalled();
    });

    it('liefert 0 bei unbekannter Artikelnummer', async () => {
      expect(await markiereVerkauft(mockClient(0), ['XXX999_1'], 7)).toBe(0);
    });
  });

  describe('hebeVerkauftAuf', () => {
    it('setzt Verkauft = FALSE und Rechnung_ID = 0 für die Rechnung', async () => {
      const client = mockClient(3);
      expect(await hebeVerkauftAuf(client, 5)).toBe(3);
      const [sql, params] = client.query.mock.calls[0];
      expect(sql).toContain('"Verkauft" = FALSE');
      expect(sql).toContain('"Rechnung_ID" = 0');
      expect(params).toEqual([5]);
    });
  });

  describe('lagereAus', () => {
    it('setzt Ausgelagert (Kunde) und Lieferschein_ID', async () => {
      const client = mockClient();
      expect(await lagereAus(client, ['MHO1_1'], 4, 9)).toBe(2);
      const [sql, params] = client.query.mock.calls[0];
      expect(sql).toContain('"Ausgelagert" = $2');
      expect(params).toEqual([9, 4, ['MHO1_1']]);
    });

    it('führt bei leerer Liste keine Query aus', async () => {
      const client = mockClient();
      expect(await lagereAus(client, [], 4, 9)).toBe(0);
      expect(client.query).not.toHaveBeenCalled();
    });
  });

  describe('lagereOffeneAus', () => {
    it('filtert auf nicht verkauft und kein Ausschuss mit korrekten Parameter-Indizes', async () => {
      const client = mockClient();
      await lagereOffeneAus(client, ['MHO1_1'], 4, 9);
      const [sql, params] = client.query.mock.calls[0];
      expect(sql).toContain('"Artikelnummer" = ANY($3)');
      expect(sql).toContain('"Verkauft" IS FALSE');
      expect(sql).toContain('"Ausschuss" IS FALSE');
      expect(params).toEqual([4, 9, ['MHO1_1']]);
    });

    it('führt bei leerer Liste keine Query aus', async () => {
      const client = mockClient();
      expect(await lagereOffeneAus(client, [], 4, 9)).toBe(0);
      expect(client.query).not.toHaveBeenCalled();
    });
  });

  describe('hebeAuslagerungAuf', () => {
    it('setzt Lieferschein_ID und Ausgelagert auf 0', async () => {
      const client = mockClient(1);
      expect(await hebeAuslagerungAuf(client, 8)).toBe(1);
      const [sql, params] = client.query.mock.calls[0];
      expect(sql).toContain('"Lieferschein_ID" = 0, "Ausgelagert" = 0');
      expect(params).toEqual([8]);
    });
  });

  describe('lagereZurueck', () => {
    it('lagert alle aktiv beim Kunden liegenden Stücke zurück', async () => {
      const client = mockClient(5);
      expect(await lagereZurueck(client, 3)).toBe(5);
      const [sql, params] = client.query.mock.calls[0];
      expect(sql).toContain('SET "Ausgelagert" = 0, "Lieferschein_ID" = 0');
      expect(sql).toContain('"Ausgelagert" = $1');
      expect(sql).toContain('"Verkauft" IS FALSE');
      expect(sql).toContain('"Ausschuss" IS FALSE');
      expect(params).toEqual([3]);
    });

    it('beschränkt auf die übergebenen Artikelnummern', async () => {
      const client = mockClient(1);
      await lagereZurueck(client, 3, ['MHO1_1']);
      const [sql, params] = client.query.mock.calls[0];
      expect(sql).toContain('"Artikelnummer" = ANY($1)');
      expect(params).toEqual([['MHO1_1'], 3]);
    });

    it('führt bei leerer Liste keine Query aus', async () => {
      const client = mockClient();
      expect(await lagereZurueck(client, 3, [])).toBe(0);
      expect(client.query).not.toHaveBeenCalled();
    });

    it('liefert 0 bei unbekannter Artikelnummer', async () => {
      expect(await lagereZurueck(mockClient(0), 3, ['XXX999_1'])).toBe(0);
    });
  });
});
