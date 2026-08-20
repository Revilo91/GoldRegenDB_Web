'use strict';

// Der Foto-Index ersetzt das frühere readdirSync pro Datensatz. Regressionen
// hier fallen im Betrieb kaum auf – es werden nur stumm keine oder falsche
// Fotos aufgelöst –, deshalb sind Auflösung und Invalidierung abgedeckt.

const fs = require('fs');
const path = require('path');

const { resolvePhotoFile, invalidate, uploadsDir } = require('../src/utils/photoIndex');

// Eigener Präfix, damit echte Fotos im uploads-Verzeichnis unangetastet bleiben
const PREFIX = 'JESTFOTO';
const angelegteDateien = new Set();

function schreibeFoto(name) {
  const ziel = path.join(uploadsDir, name);
  fs.writeFileSync(ziel, 'x');
  angelegteDateien.add(ziel);
  invalidate();
}

function loescheFoto(name) {
  const ziel = path.join(uploadsDir, name);
  fs.rmSync(ziel, { force: true });
  angelegteDateien.delete(ziel);
  invalidate();
}

afterEach(() => {
  for (const datei of angelegteDateien) fs.rmSync(datei, { force: true });
  angelegteDateien.clear();
  invalidate();
});

describe('resolvePhotoFile', () => {
  it('lehnt leere Bezeichner ab', () => {
    expect(resolvePhotoFile('').error).toBe('Ungültiger Dateiname');
    expect(resolvePhotoFile(null).error).toBe('Ungültiger Dateiname');
  });

  it('findet die Datei bei exaktem Namen', () => {
    schreibeFoto(`${PREFIX}002.jpg`);
    const lookup = resolvePhotoFile(`${PREFIX}002.jpg`);
    expect(lookup.error).toBeUndefined();
    expect(lookup.resolvedFileName).toBe(`${PREFIX}002.jpg`);
    expect(lookup.resolvedBy).toBe('exact');
    expect(lookup.filePath).toBe(path.join(uploadsDir, `${PREFIX}002.jpg`));
  });

  it('findet die Datei über die Basis-Artikelnummer ohne Endung', () => {
    schreibeFoto(`${PREFIX}002.jpg`);
    const lookup = resolvePhotoFile(`${PREFIX}002`);
    expect(lookup.resolvedFileName).toBe(`${PREFIX}002.jpg`);
    expect(lookup.resolvedBy).toBe('basename');
  });

  it('ignoriert den Mengen-Suffix _1 / _2', () => {
    schreibeFoto(`${PREFIX}002.jpg`);
    expect(resolvePhotoFile(`${PREFIX}002_2`).resolvedFileName).toBe(`${PREFIX}002.jpg`);
  });

  it('meldet "Foto nicht gefunden" für unbekannte Artikelnummern', () => {
    expect(resolvePhotoFile(`${PREFIX}999`).error).toBe('Foto nicht gefunden');
  });

  it('verhindert Pfad-Ausbrüche über ../', () => {
    const lookup = resolvePhotoFile('../../../etc/passwd');
    expect(lookup.error).toBe('Foto nicht gefunden');
    expect(lookup.filePath).toBeUndefined();
  });

  it('sieht neu abgelegte Dateien nach invalidate()', () => {
    expect(resolvePhotoFile(`${PREFIX}003`).error).toBe('Foto nicht gefunden');
    schreibeFoto(`${PREFIX}003.png`);
    expect(resolvePhotoFile(`${PREFIX}003`).resolvedFileName).toBe(`${PREFIX}003.png`);
  });

  it('sieht gelöschte Dateien nach invalidate()', () => {
    schreibeFoto(`${PREFIX}004.jpg`);
    expect(resolvePhotoFile(`${PREFIX}004`).error).toBeUndefined();
    loescheFoto(`${PREFIX}004.jpg`);
    expect(resolvePhotoFile(`${PREFIX}004`).error).toBe('Foto nicht gefunden');
  });
});
