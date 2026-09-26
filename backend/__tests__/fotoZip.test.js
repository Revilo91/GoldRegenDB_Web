'use strict';

const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const yazl = require('yazl');
const {
  eintragsName,
  zerlegeEintragsName,
  erstelleFotoZip,
  importiereFotoZip,
} = require('../src/utils/fotoZip');

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from(Array.from({ length: 256 }, (_, i) => i)),
]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 7)]);

// Hält beide Foto-Tabellen im Speicher und beantwortet genau die Abfragen aus
// fotoService (Liste, Bilddaten, Upsert).
function speicherDb(anfang = {}) {
  const fotos = new Map(Object.entries(anfang));
  const artVon = (sql) => (sql.includes('bestellung_foto') ? 'bestellung' : 'schmuckstueck');
  const query = jest.fn(async (sql, params = []) => {
    const art = artVon(sql);
    if (sql.trimStart().startsWith('INSERT')) {
      fotos.set(`${art}:${params[0]}`, { daten: params[1], mimeType: params[2] });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('octet_length')) {
      const rows = [...fotos.entries()]
        .filter(([k]) => k.startsWith(`${art}:`))
        .map(([k, f]) => ({
          schluessel: k.slice(art.length + 1),
          mimeType: f.mimeType,
          groesse: f.daten.length,
          geaendert: new Date('2026-01-02T03:04:05Z'),
        }))
        .sort((a, b) => a.schluessel.localeCompare(b.schluessel));
      return { rows, rowCount: rows.length };
    }
    const foto = fotos.get(`${art}:${params[0]}`);
    return { rows: foto ? [{ daten: foto.daten }] : [], rowCount: foto ? 1 : 0 };
  });
  return { query, fotos };
}

async function alsBuffer(stream) {
  const teile = [];
  for await (const teil of stream) teile.push(teil);
  return Buffer.concat(teile);
}

let tmpDir;
beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fotozip-test-'));
});
afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function schreibeZip(eintraege) {
  const zip = new yazl.ZipFile();
  for (const [name, daten] of eintraege) {
    if (name.endsWith('/')) zip.addEmptyDirectory(name);
    else zip.addBuffer(daten, name);
  }
  zip.end();
  const pfad = path.join(tmpDir, `${Math.random().toString(36).slice(2)}.zip`);
  await fs.writeFile(pfad, await alsBuffer(zip.outputStream));
  return pfad;
}

describe('Eintragsnamen', () => {
  it('hängt die Endung passend zum Typ an', () => {
    expect(eintragsName('schmuckstueck', 'MBH001', 'image/png')).toBe('schmuckstueck/MBH001.png');
    expect(eintragsName('bestellung', 'abc.jpg', 'image/jpeg')).toBe('bestellung/abc.jpg.jpg');
  });

  it.each([
    ['schmuckstueck/MBH001.jpg', { art: 'schmuckstueck', schluessel: 'MBH001' }],
    ['schmuckstueck/mbh001.png', { art: 'schmuckstueck', schluessel: 'MBH001' }],
    ['bestellung/0123abcd.png', { art: 'bestellung', schluessel: '0123abcd' }],
    ['bestellung/abc.jpg.jpg', { art: 'bestellung', schluessel: 'abc.jpg' }],
  ])('%s → Schlüssel', (name, erwartet) => {
    expect(zerlegeEintragsName(name)).toEqual(erwartet);
  });

  it.each([
    'MBH001.jpg',
    'ordner/MBH001.jpg',
    'schmuckstueck/sub/MBH001.jpg',
    'schmuckstueck/MBH001_2.jpg',
    'schmuckstueck/.jpg',
    'bestellung/.versteckt.png',
    'bestellung/a b.png',
  ])('lehnt %s ab', (name) => {
    expect(zerlegeEintragsName(name)).toBeNull();
  });
});

describe('Foto-ZIP Round-Trip', () => {
  it('exportiert alle Fotos und stellt sie byte-genau wieder her', async () => {
    const quelle = speicherDb({
      'schmuckstueck:MBH001': { daten: PNG, mimeType: 'image/png' },
      'schmuckstueck:MHO002': { daten: JPG, mimeType: 'image/jpeg' },
      'bestellung:abc123': { daten: JPG, mimeType: 'image/jpeg' },
    });

    const { stream, anzahl, groesse } = await erstelleFotoZip(quelle);
    const zipDaten = await alsBuffer(stream);
    expect(anzahl).toBe(3);
    expect(zipDaten.length).toBe(groesse);

    const pfad = path.join(tmpDir, 'roundtrip.zip');
    await fs.writeFile(pfad, zipDaten);
    const ziel = speicherDb();
    const stand = await importiereFotoZip(pfad, ziel);

    expect(stand).toMatchObject({
      gesamt: 3,
      verarbeitet: 3,
      gespeichert: { schmuckstueck: 2, bestellung: 1 },
      uebersprungen: 0,
    });
    expect(ziel.fotos.get('schmuckstueck:MBH001').daten.equals(PNG)).toBe(true);
    expect(ziel.fotos.get('schmuckstueck:MHO002').daten.equals(JPG)).toBe(true);
    expect(ziel.fotos.get('bestellung:abc123')).toMatchObject({ mimeType: 'image/jpeg' });
  });

  it('liefert ein gültiges leeres ZIP, wenn es keine Fotos gibt', async () => {
    const { stream, anzahl, groesse } = await erstelleFotoZip(speicherDb());
    const zipDaten = await alsBuffer(stream);
    expect(anzahl).toBe(0);
    expect(zipDaten.length).toBe(groesse);

    const pfad = path.join(tmpDir, 'leer.zip');
    await fs.writeFile(pfad, zipDaten);
    expect(await importiereFotoZip(pfad, speicherDb())).toMatchObject({ gesamt: 0, verarbeitet: 0 });
  });

  it('bricht den Stream ab, wenn ein Foto zwischen Liste und Laden verschwindet', async () => {
    const quelle = speicherDb({ 'schmuckstueck:MBH001': { daten: PNG, mimeType: 'image/png' } });
    const { stream } = await erstelleFotoZip(quelle);
    quelle.fotos.clear();

    await expect(alsBuffer(stream)).rejects.toThrow();
  });

  it('lädt nach einem Abbruch keine Bilddaten mehr', async () => {
    const quelle = speicherDb({ 'schmuckstueck:MBH001': { daten: PNG, mimeType: 'image/png' } });
    const abbruch = new AbortController();
    const { stream } = await erstelleFotoZip(quelle, abbruch.signal);
    abbruch.abort();

    await expect(alsBuffer(stream)).rejects.toThrow();
    expect(quelle.query.mock.calls.some(([sql]) => sql.includes('WHERE'))).toBe(false);
  });
});

describe('Foto-ZIP Import', () => {
  it('überspringt fremde Pfade, zu große und ungültige Dateien und meldet den Grund', async () => {
    const pfad = await schreibeZip([
      ['schmuckstueck/', null],
      ['schmuckstueck/MBH001.png', PNG],
      ['notiz.txt', Buffer.from('hallo')],
      ['schmuckstueck/MBH002.jpg', Buffer.from('kein Bild')],
      ['schmuckstueck/MBH003.jpg', Buffer.concat([JPG, Buffer.alloc(5 * 1024 * 1024)])],
    ]);
    const ziel = speicherDb();

    const stand = await importiereFotoZip(pfad, ziel);

    expect(stand.gespeichert).toEqual({ schmuckstueck: 1, bestellung: 0 });
    expect(stand.verarbeitet).toBe(5);
    expect(stand.uebersprungen).toBe(3);
    expect(stand.uebersprungenDetails).toEqual([
      { datei: 'notiz.txt', grund: expect.stringMatching(/Unbekannter Pfad/) },
      { datei: 'schmuckstueck/MBH002.jpg', grund: 'Nur JPG, PNG und GIF Dateien sind erlaubt' },
      { datei: 'schmuckstueck/MBH003.jpg', grund: 'Foto ist zu groß (max. 5 MB)' },
    ]);
  });

  it('überschreibt vorhandene Fotos und lässt andere stehen', async () => {
    const pfad = await schreibeZip([['schmuckstueck/MBH001.jpg', JPG]]);
    const ziel = speicherDb({
      'schmuckstueck:MBH001': { daten: PNG, mimeType: 'image/png' },
      'schmuckstueck:MBH009': { daten: PNG, mimeType: 'image/png' },
    });

    await importiereFotoZip(pfad, ziel);

    expect(ziel.fotos.get('schmuckstueck:MBH001').daten.equals(JPG)).toBe(true);
    expect(ziel.fotos.has('schmuckstueck:MBH009')).toBe(true);
  });

  it('meldet Fortschritt nach jedem Eintrag', async () => {
    const pfad = await schreibeZip([
      ['schmuckstueck/MBH001.png', PNG],
      ['bestellung/abc.png', PNG],
    ]);
    const verlauf = [];

    await importiereFotoZip(pfad, speicherDb(), (s) => verlauf.push(s.verarbeitet));

    expect(verlauf).toEqual([0, 1, 2]);
  });

  it('bricht bei einem Datenbankfehler ab statt ihn als übersprungen zu zählen', async () => {
    const pfad = await schreibeZip([['schmuckstueck/MBH001.png', PNG]]);
    const kaputt = { query: jest.fn().mockRejectedValue(new Error('Verbindung weg')) };

    await expect(importiereFotoZip(pfad, kaputt)).rejects.toThrow('Verbindung weg');
  });

  it('lehnt eine Datei ab, die kein ZIP ist', async () => {
    const pfad = path.join(tmpDir, 'kein.zip');
    await fs.writeFile(pfad, 'kein zip');

    await expect(importiereFotoZip(pfad, speicherDb())).rejects.toThrow();
  });
});
