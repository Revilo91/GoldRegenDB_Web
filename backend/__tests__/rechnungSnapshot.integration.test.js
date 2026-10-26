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
const { belegSummen } = require('../src/utils/rabatt');
const { schreibeSnapshot } = require('../src/services/rechnungSnapshot');

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
