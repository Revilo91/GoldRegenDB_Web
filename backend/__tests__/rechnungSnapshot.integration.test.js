'use strict';

// Snapshot gegen echtes PostgreSQL: Backfill (Migration 0006) und
// schreibeSnapshot() müssen dieselben Summen liefern wie belegSummen().
// Opt-in wie migrations.integration.test.js (TEST_DATABASE_URL, "test" im Namen).

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { runMigrations } = require('../src/config/migrate');
const { belegSummen, preisNachAllenRabattenSql } = require('../src/utils/rabatt');
const { schreibeSnapshot, wendeSnapshotAn } = require('../src/services/rechnungSnapshot');

const BASIS_URL = process.env.TEST_DATABASE_URL;
const describeDb = BASIS_URL ? describe : describe.skip;
const MIGRATION_0006 = fs.readFileSync(
  path.join(__dirname, '../src/config/migrations/0006_rechnung_snapshot.sql'), 'utf8',
);

describeDb('Rechnungs-Snapshot gegen echte Datenbank', () => {
  const basisPool = BASIS_URL ? new Pool({ connectionString: BASIS_URL, max: 1 }) : null;
  let name;
  let pool;

  const SUMMEN_SPALTEN = `summe_brutto, rabatt_gesamt_betrag, provision_prozent, provision_betrag,
    versand_betrag, summe_ueberweisung`;

  async function legeRechnungAn({ nummer, status, rabattGesamt, rabattPositionen, versand, stuecke }) {
    const { rows } = await pool.query(
      `INSERT INTO "Rechnung" ("Nummer", "Kundennummer", status, rabatt_gesamt, rabatt_positionen, versandkosten)
       VALUES ($1, 1, $2, $3, $4, $5) RETURNING "ID"`,
      [nummer, status, rabattGesamt, JSON.stringify(rabattPositionen), versand],
    );
    const id = rows[0].ID;
    for (const [artikelnummer, preis] of stuecke) {
      await pool.query(
        `INSERT INTO "Schmuckstück" ("Artikelnummer", "Verkaufspreis", "Verkauft", "Rechnung_ID")
         VALUES ($1, $2, TRUE, $3)`,
        [artikelnummer, preis, id],
      );
    }
    return id;
  }

  const snapshotZeile = async (id) => (await pool.query(
    `SELECT ${SUMMEN_SPALTEN}, snapshot_am FROM "Rechnung" WHERE "ID" = $1`, [id],
  )).rows[0];

  beforeAll(async () => {
    ({ current_database: name } = (await basisPool.query('SELECT current_database()')).rows[0]);
    if (!/test/i.test(name)) throw new Error(`Verweigert: "${name}" ist keine Testdatenbank.`);
    name = `${name}_snap`;
    await basisPool.query(`DROP DATABASE IF EXISTS "${name}"`);
    await basisPool.query(`CREATE DATABASE "${name}"`);
    const url = new URL(BASIS_URL);
    url.pathname = `/${name}`;
    pool = new Pool({ connectionString: url.toString(), max: 2 });
    await runMigrations({ pool, connectionString: url.toString(), env: { MIGRATION_SKIP_BACKUP: 'true' } });
    await pool.query(`INSERT INTO "Kunde" ("ID", "Name", "Strasse", "Ort", "PLZ", "Provision")
                      VALUES (1, 'Laden', 'Weg', 'Ort', 1067, 40)`);
  });

  afterAll(async () => {
    if (pool) await pool.end();
    await basisPool.query(`DROP DATABASE IF EXISTS "${name}"`);
    await basisPool.end();
  });

  it('Backfill: finale Rechnung bekommt Positionen und Summen wie belegSummen(), zweiter Lauf ändert nichts', async () => {
    const id = await legeRechnungAn({
      nummer: '2026-901', status: 'final', rabattGesamt: 12.5, versand: 4.9,
      rabattPositionen: { MHO123: 10, MBA9: 33.33 },
      stuecke: [['MHO123_1', 19.99], ['MHO123_2', 19.99], ['SBA9_1', 7.77], ['MBA9_1', 13.33]],
    });
    const leer = await legeRechnungAn({
      nummer: '2026-902', status: 'final', rabattGesamt: 0, rabattPositionen: {}, versand: null, stuecke: [],
    });
    const entwurf = await legeRechnungAn({
      nummer: '2026-903', status: 'entwurf', rabattGesamt: 0, rabattPositionen: {}, versand: null,
      stuecke: [['MXX1_1', 5]],
    });

    await pool.query(MIGRATION_0006);

    const summen = await belegSummen(pool, 'Rechnung', id);
    const zeile = await snapshotZeile(id);
    expect(zeile).toMatchObject({
      summe_brutto: summen.gesamtwert,
      rabatt_gesamt_betrag: summen.gesamtrabatt_betrag,
      provision_prozent: '40.00',
      provision_betrag: summen.provision_betrag,
      versand_betrag: summen.versandkosten,
      summe_ueberweisung: summen.ueberweisungsbetrag,
    });
    expect(zeile.snapshot_am).not.toBeNull();
    const positionen = (await pool.query(
      'SELECT artikelnummer_id, basis_artikelnummer, einzelpreis, positionsrabatt FROM "Rechnung_Position" WHERE rechnung_id = $1 ORDER BY 1', [id],
    )).rows;
    expect(positionen).toEqual([
      { artikelnummer_id: 'MBA9_1', basis_artikelnummer: 'MBA9', einzelpreis: '13.33', positionsrabatt: '33.33' },
      { artikelnummer_id: 'MHO123_1', basis_artikelnummer: 'MHO123', einzelpreis: '19.99', positionsrabatt: '10.00' },
      { artikelnummer_id: 'MHO123_2', basis_artikelnummer: 'MHO123', einzelpreis: '19.99', positionsrabatt: '10.00' },
      { artikelnummer_id: 'SBA9_1', basis_artikelnummer: 'SBA9', einzelpreis: '7.77', positionsrabatt: '0.00' },
    ]);
    expect((await snapshotZeile(leer)).summe_ueberweisung).toBe('0.00');
    expect((await snapshotZeile(entwurf)).snapshot_am).toBeNull();

    // Zweiter Lauf, auch nach Preisänderung: der eingefrorene Stand bleibt
    const vorher = await snapshotZeile(id);
    await pool.query('UPDATE "Schmuckstück" SET "Verkaufspreis" = 99 WHERE "Rechnung_ID" = $1', [id]);
    await pool.query(MIGRATION_0006);
    expect(await snapshotZeile(id)).toEqual(vorher);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM "Rechnung_Position" WHERE rechnung_id = $1', [id])).rows[0].n)
      .toBe(4);
  });

  it('schreibeSnapshot ersetzt Positionen und stimmt mit belegSummen() überein', async () => {
    const id = await legeRechnungAn({
      nummer: '2026-910', status: 'entwurf', rabattGesamt: 5, versand: 3,
      rabattPositionen: { MHO7: 20 }, stuecke: [['MHO7_1', 10.05], ['MHO7_2', 10.05], ['SHA2_1', 33.3]],
    });

    await schreibeSnapshot(pool, id);
    await schreibeSnapshot(pool, id);

    const summen = await belegSummen(pool, 'Rechnung', id);
    expect(await snapshotZeile(id)).toMatchObject({
      summe_brutto: summen.gesamtwert,
      rabatt_gesamt_betrag: summen.gesamtrabatt_betrag,
      provision_betrag: summen.provision_betrag,
      versand_betrag: '3.00',
      summe_ueberweisung: summen.ueberweisungsbetrag,
    });
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM "Rechnung_Position" WHERE rechnung_id = $1', [id]);
    expect(rows[0].n).toBe(3);
  });

  // Dieselbe Umsatzformel wie dashboard.js und inventur.js (Alias s/r, LEFT JOIN auf Rechnung)
  const umsatz = async (id) => (await pool.query(
    `SELECT round(COALESCE(SUM(${preisNachAllenRabattenSql('s', 'r')}), 0), 2) AS wert
     FROM "Schmuckstück" s LEFT JOIN "Rechnung" r ON r."ID" = s."Rechnung_ID"
     WHERE s."Rechnung_ID" = $1`, [id],
  )).rows[0].wert;

  // Spätere Änderungen an Preis, Kunden-Provision und Rabatten der Rechnung
  async function aendereNachtraeglich(id) {
    await pool.query('UPDATE "Schmuckstück" SET "Verkaufspreis" = "Verkaufspreis" * 2 + 1 WHERE "Rechnung_ID" = $1', [id]);
    await pool.query('UPDATE "Kunde" SET "Provision" = 10 WHERE "ID" = 1');
    await pool.query(
      `UPDATE "Rechnung" SET rabatt_gesamt = 50, rabatt_positionen = '{"MLE1": 90, "MLF1": 90}'::jsonb WHERE "ID" = $1`, [id],
    );
  }

  describe('Leser nutzen den eingefrorenen Stand (Issue #283, Schritt 3)', () => {
    afterEach(async () => {
      await pool.query('UPDATE "Kunde" SET "Provision" = 40 WHERE "ID" = 1');
    });

    it('finale Rechnung: Summen, Umsatz und Inventurwert bleiben nach nachträglichen Änderungen gleich', async () => {
      const id = await legeRechnungAn({
        nummer: '2026-930', status: 'final', rabattGesamt: 10, versand: 4.9,
        rabattPositionen: { MLE1: 25 }, stuecke: [['MLE1_1', 20], ['MLE1_2', 20], ['SLE2_1', 33.33]],
      });
      await schreibeSnapshot(pool, id);
      const summenVorher = await belegSummen(pool, 'Rechnung', id);
      const umsatzVorher = await umsatz(id);
      expect(summenVorher).toMatchObject({
        gesamtwert: '63.33', gesamtrabatt_betrag: '6.33', summe_nach_rabatt: '57.00',
        provision_betrag: '22.80', versandkosten: '4.90', ueberweisungsbetrag: '39.10',
        marina_brutto: '27.00', saskia_brutto: '30.00', rabatt_gesamt: '10.00', provision: '40.00',
      });
      expect(umsatzVorher).toBe('57.00');

      await aendereNachtraeglich(id);

      // Live gerechnet wäre das ein ganz anderer Betrag
      const live = await belegSummen(pool, 'Rechnung', id, { live: true });
      expect(live.ueberweisungsbetrag).not.toBe(summenVorher.ueberweisungsbetrag);
      expect(await belegSummen(pool, 'Rechnung', id)).toEqual(summenVorher);
      expect(await umsatz(id)).toBe(umsatzVorher);
    });

    it('wendeSnapshotAn liefert eingefrorene Preise, Rabatte und Provision für Excel/E-Rechnung', async () => {
      const id = await legeRechnungAn({
        nummer: '2026-931', status: 'final', rabattGesamt: 10, versand: 4.9,
        rabattPositionen: { MLF1: 25 }, stuecke: [['MLF1_1', 20], ['SLF2_1', 33.33]],
      });
      await schreibeSnapshot(pool, id);
      await aendereNachtraeglich(id);

      const { rows: [rechnung] } = await pool.query('SELECT * FROM "Rechnung" WHERE "ID" = $1', [id]);
      const { rows: stuecke } = await pool.query(
        `SELECT s.*, p.einzelpreis AS snapshot_einzelpreis, p.positionsrabatt AS snapshot_positionsrabatt
         FROM "Schmuckstück" s LEFT JOIN "Rechnung_Position" p
           ON p.rechnung_id = s."Rechnung_ID" AND p.artikelnummer_id = s."Artikelnummer"
         WHERE s."Rechnung_ID" = $1 ORDER BY s."Artikelnummer"`, [id],
      );
      const eingefroren = wendeSnapshotAn(rechnung, stuecke);

      expect(eingefroren.stuecke.map((s) => s.Verkaufspreis)).toEqual(['20.00', '33.33']);
      expect(eingefroren.rechnung.rabatt_positionen).toEqual({ MLF1: 25, SLF2: 0 });
      // rabatt_gesamt wurde auf 50 geändert; zurückgerechnet aus Betrag 4.83 / Brutto 48.33 (reproduziert den Betrag in Cent)
      expect(eingefroren.rechnung.rabatt_gesamt).toBe(9.99);
      expect(Math.round(4833 * eingefroren.rechnung.rabatt_gesamt / 100)).toBe(483);
      expect(eingefroren.rechnung.versandkosten).toBe('4.90');
      expect(eingefroren.provisionProzent).toBe('40.00');
    });

    it('Entwurf mit Snapshot rechnet weiter live', async () => {
      const id = await legeRechnungAn({
        nummer: '2026-932', status: 'entwurf', rabattGesamt: 10, versand: null,
        rabattPositionen: {}, stuecke: [['MLE3_1', 100]],
      });
      await schreibeSnapshot(pool, id);
      expect((await belegSummen(pool, 'Rechnung', id)).gesamtwert).toBe('100.00');
      expect(await umsatz(id)).toBe('90.00');

      await pool.query('UPDATE "Schmuckstück" SET "Verkaufspreis" = 200 WHERE "Rechnung_ID" = $1', [id]);
      await pool.query('UPDATE "Rechnung" SET rabatt_gesamt = 50 WHERE "ID" = $1', [id]);

      const summen = await belegSummen(pool, 'Rechnung', id);
      expect(summen).toMatchObject({ gesamtwert: '200.00', gesamtrabatt_betrag: '100.00' });
      expect(await umsatz(id)).toBe('100.00');
    });

    it('Lieferschein bleibt live', async () => {
      const { rows } = await pool.query(
        `INSERT INTO "Lieferschein" ("Nummer", "Kundennummer") VALUES ('2026-L930', 1) RETURNING "ID"`,
      );
      const lieferschein = rows[0].ID;
      await pool.query(
        `INSERT INTO "Schmuckstück" ("Artikelnummer", "Verkaufspreis", "Lieferschein_ID") VALUES ('MLE4_1', 10, $1)`,
        [lieferschein],
      );
      expect((await belegSummen(pool, 'Lieferschein', lieferschein)).gesamtwert).toBe('10.00');

      await pool.query('UPDATE "Schmuckstück" SET "Verkaufspreis" = 30 WHERE "Lieferschein_ID" = $1', [lieferschein]);

      expect((await belegSummen(pool, 'Lieferschein', lieferschein)).gesamtwert).toBe('30.00');
    });

    it('Zurücksetzen auf Entwurf und erneutes Finalisieren friert den neuen Stand ein', async () => {
      const id = await legeRechnungAn({
        nummer: '2026-933', status: 'final', rabattGesamt: 0, versand: null,
        rabattPositionen: {}, stuecke: [['MLE5_1', 10]],
      });
      await schreibeSnapshot(pool, id);
      await pool.query('UPDATE "Schmuckstück" SET "Verkaufspreis" = 20 WHERE "Rechnung_ID" = $1', [id]);
      expect((await belegSummen(pool, 'Rechnung', id)).gesamtwert).toBe('10.00');

      // PUT-Ablauf: Status final, der alte Snapshot ist noch da -> schreibeSnapshot muss live rechnen
      await schreibeSnapshot(pool, id);

      expect((await belegSummen(pool, 'Rechnung', id)).gesamtwert).toBe('20.00');
    });
  });

  it('löscht die Positionen mit der Rechnung (ON DELETE CASCADE)', async () => {
    const id = await legeRechnungAn({
      nummer: '2026-920', status: 'entwurf', rabattGesamt: 0, rabattPositionen: {}, versand: null,
      stuecke: [['MZZ1_1', 1]],
    });
    await schreibeSnapshot(pool, id);
    await pool.query('UPDATE "Schmuckstück" SET "Rechnung_ID" = 0 WHERE "Rechnung_ID" = $1', [id]);
    await pool.query('DELETE FROM "Rechnung" WHERE "ID" = $1', [id]);

    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM "Rechnung_Position" WHERE rechnung_id = $1', [id]);
    expect(rows[0].n).toBe(0);
  });
});
