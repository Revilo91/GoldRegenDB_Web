'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { importiereFotos, logZeilen } = require('../scripts/import-fotos');
const { MAX_FOTO_BYTES } = require('../src/utils/fotoService');

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

// Simuliert die drei Abfragen des Imports: Schmuckstück-Basen, vorhandene Fotos, Upsert.
function mockClient({ schmuckstuecke = [], fotos = [], insertFehler = null } = {}) {
  const geschrieben = [];
  const query = jest.fn(async (sql, params) => {
    if (sql.includes('FROM "Schmuckstück"')) {
      return { rows: params[0].filter((b) => schmuckstuecke.includes(b)).map((basis) => ({ basis })) };
    }
    if (sql.includes('FROM "Foto"')) {
      return { rows: params[0].filter((b) => fotos.includes(b)).map((b) => ({ Artikelnummer: b })) };
    }
    if (sql.includes('INSERT INTO "Foto"')) {
      if (insertFehler) throw new Error(insertFehler);
      geschrieben.push(params[0]);
      return { rowCount: 1 };
    }
    throw new Error(`Unerwartete Abfrage: ${sql}`);
  });
  return { query, geschrieben };
}

const grund = (ergebnis, datei) => ergebnis.uebersprungen.find((u) => u.datei === datei);

describe('importiereFotos', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-fotos-'));
    const dateien = {
      'MBH001.jpg': JPEG,
      'MBH002.jpg': JPEG,
      'MBH002_2.jpg': JPEG,
      'MBH003.jpg': JPEG,
      'MBH003.png': PNG,
      'MBH004_MBH005.jpg': JPEG,
      'MEH.jpg': JPEG,
      'notizen.txt': Buffer.from('text'),
      'XXX999.jpg': JPEG,
      'MBH006.jpg': JPEG,
      'MBH007.jpg': Buffer.from('kein bild'),
      'MBH010_3.png': PNG,
    };
    for (const [name, inhalt] of Object.entries(dateien)) fs.writeFileSync(path.join(dir, name), inhalt);
    fs.writeFileSync(path.join(dir, 'MBH008.jpg'), Buffer.concat([JPEG, Buffer.alloc(MAX_FOTO_BYTES)]));
    fs.mkdirSync(path.join(dir, 'bestellungen'));
    fs.writeFileSync(path.join(dir, 'bestellungen', 'MBH009.jpg'), JPEG);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const bekannt = ['MBH001', 'MBH002', 'MBH003', 'MBH006', 'MBH007', 'MBH008', 'MBH009', 'MBH010'];

  it('importiert eindeutige Dateien und überspringt den Rest mit Grund', async () => {
    const client = mockClient({ schmuckstuecke: bekannt, fotos: ['MBH006'] });
    const ergebnis = await importiereFotos({ client, dir });

    expect(ergebnis.importiert).toEqual([
      { datei: 'MBH001.jpg', basis: 'MBH001', ersetzt: false },
      { datei: 'MBH010_3.png', basis: 'MBH010', ersetzt: false },
    ]);
    expect(client.geschrieben).toEqual(['MBH001', 'MBH010']);
    expect(ergebnis.fehler).toEqual([]);

    expect(grund(ergebnis, 'MBH002.jpg')).toMatchObject({ grund: 'duplikat', detail: 'MBH002.jpg, MBH002_2.jpg' });
    expect(grund(ergebnis, 'MBH002_2.jpg').grund).toBe('duplikat');
    expect(grund(ergebnis, 'MBH003.jpg').grund).toBe('duplikat');
    expect(grund(ergebnis, 'MBH003.png').grund).toBe('duplikat');
    expect(grund(ergebnis, 'MBH004_MBH005.jpg')).toMatchObject({ grund: 'mehrere', detail: 'MBH004, MBH005' });
    expect(grund(ergebnis, 'MEH.jpg').grund).toBe('ohneNummer');
    expect(grund(ergebnis, 'notizen.txt').grund).toBe('endung');
    expect(grund(ergebnis, 'XXX999.jpg').grund).toBe('existiertNicht');
    expect(grund(ergebnis, 'MBH006.jpg').grund).toBe('vorhanden');
    expect(grund(ergebnis, 'MBH007.jpg').grund).toBe('keinBild');
    expect(grund(ergebnis, 'MBH008.jpg').grund).toBe('zuGross');
    expect(ergebnis.uebersprungen).toHaveLength(11);
  });

  it('liest keine Unterordner', async () => {
    const ergebnis = await importiereFotos({ client: mockClient({ schmuckstuecke: bekannt }), dir });
    const alle = [...ergebnis.importiert, ...ergebnis.uebersprungen].map((e) => e.datei);
    expect(alle).not.toContain('MBH009.jpg');
    expect(alle).not.toContain('bestellungen');
  });

  it('ersetzt vorhandene Fotos nur mit overwrite', async () => {
    const client = mockClient({ schmuckstuecke: bekannt, fotos: ['MBH006'] });
    const ergebnis = await importiereFotos({ client, dir, overwrite: true });
    expect(ergebnis.importiert).toContainEqual({ datei: 'MBH006.jpg', basis: 'MBH006', ersetzt: true });
    expect(client.geschrieben).toContain('MBH006');
  });

  it('schreibt im Dry-Run nichts', async () => {
    const client = mockClient({ schmuckstuecke: bekannt });
    const ergebnis = await importiereFotos({ client, dir, dryRun: true });
    expect(ergebnis.importiert.map((i) => i.basis)).toEqual(['MBH001', 'MBH006', 'MBH010']);
    expect(client.query.mock.calls.some(([sql]) => sql.includes('INSERT'))).toBe(false);
  });

  it('ist idempotent: vorhandene Fotos werden beim zweiten Lauf übersprungen', async () => {
    const client = mockClient({ schmuckstuecke: bekannt, fotos: ['MBH001', 'MBH006', 'MBH010'] });
    const ergebnis = await importiereFotos({ client, dir });
    expect(ergebnis.importiert).toEqual([]);
    expect(client.geschrieben).toEqual([]);
  });

  it('meldet Datenbankfehler beim Schreiben als Fehler, nicht als übersprungen', async () => {
    const client = mockClient({ schmuckstuecke: ['MBH001'], insertFehler: 'connection lost' });
    const ergebnis = await importiereFotos({ client, dir });
    expect(ergebnis.fehler).toEqual([{ datei: 'MBH001.jpg', meldung: 'connection lost' }]);
    expect(ergebnis.importiert).toEqual([]);
  });

  it('schreibt eine Log-Zeile pro übersprungener Datei, nach Grund sortiert', async () => {
    const client = mockClient({ schmuckstuecke: bekannt, fotos: ['MBH006'] });
    const zeilen = logZeilen(await importiereFotos({ client, dir }));
    expect(zeilen).toHaveLength(11);
    expect(zeilen[0]).toBe('MBH004_MBH005.jpg\tmehrere Artikelnummern im Namen\tMBH004, MBH005');
    expect(zeilen[1]).toBe('MEH.jpg\tkeine Artikelnummer im Namen\t');
  });
});
