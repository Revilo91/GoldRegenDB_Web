'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { sammleFotos, smbZuGvfs } = require('../scripts/sammle-fotos');

jest.mock('../src/utils/logger');

describe('sammleFotos', () => {
  let quelle;
  let ziel;

  const lege = (rel, inhalt = rel) => {
    const pfad = path.join(quelle, rel);
    fs.mkdirSync(path.dirname(pfad), { recursive: true });
    fs.writeFileSync(pfad, inhalt);
  };
  const imZiel = (rel = '') => fs.readdirSync(path.join(ziel, rel)).sort();

  beforeEach(() => {
    const basis = fs.mkdtempSync(path.join(os.tmpdir(), 'sammle-fotos-'));
    quelle = path.join(basis, 'quelle');
    ziel = path.join(basis, 'ziel');
    fs.mkdirSync(quelle);
  });

  test('liest Wurzel und _-Ordner rekursiv, andere Ordner nicht', () => {
    lege('MBH004.jpg');
    lege('_Perlen/MPA057.jpg');
    lege('_Perlen/Armbänder/MPA058_2.png');
    lege('9. alte Fotos/MPA059.jpg');

    const { kopiert } = sammleFotos({ quelle, ziel });

    expect(kopiert.map((k) => k.ziel).sort()).toEqual(['MBH004.jpg', 'MPA057.jpg', 'MPA058_2.png']);
    expect(imZiel()).toEqual(['MBH004.jpg', 'MPA057.jpg', 'MPA058_2.png']);
  });

  test('ignoriert Dateien ohne Artikelnummer', () => {
    lege('_Perlen/PXL_20240108_051103729.jpg');
    lege('_Perlen/Übersicht Points.jpg');
    lege('_Perlen/MPA057.mp4');
    lege('_Perlen/Thumbs.db');
    lege('_Perlen/S1.jpg');
    lege('_Perlen/S12-3.jpg');
    lege('_Perlen/IMG1234.jpg');

    expect(sammleFotos({ quelle, ziel })).toEqual({ kopiert: [], vorhanden: [], manuell: [] });
  });

  test('uneindeutige Namen landen in _manuell mit Ordnerstruktur', () => {
    lege('_Perlen/MEA067+068.jpg');
    lege('_Perlen/MBH004_MBH005.jpg');

    const { manuell } = sammleFotos({ quelle, ziel });

    expect(manuell).toHaveLength(2);
    expect(imZiel('_manuell/_Perlen')).toEqual(['MBH004_MBH005.jpg', 'MEA067+068.jpg']);
  });

  test('weitere Fotos einer Nummer mit sauberem Foto werden übergangen', () => {
    lege('_3D-Druck/MXO100.jpg');
    lege('_3D-Druck/MXO100 (2).jpg');
    lege('_3D-Druck/MXO048 - Bloom Line.jpg');

    const { kopiert, manuell } = sammleFotos({ quelle, ziel });

    expect(kopiert.map((k) => k.ziel)).toEqual(['MXO100.jpg']);
    expect(manuell.map((m) => m.rel)).toEqual([path.join('_3D-Druck', 'MXO048 - Bloom Line.jpg')]);
  });

  test('gleicher Name mit gleichem Inhalt wird einmal kopiert', () => {
    lege('_Perlen/MPA057.jpg', 'bild');
    lege('_Perlen/Fotos alt/MPA057.jpg', 'bild');

    const { kopiert, manuell } = sammleFotos({ quelle, ziel });

    expect(kopiert).toHaveLength(1);
    expect(manuell).toEqual([]);
  });

  test('gleicher Name mit anderem Inhalt: alle Fassungen nach _manuell, keine ins Ziel', () => {
    lege('_Perlen/MPA057.jpg', 'neu');
    lege('_Perlen/Fotos alt/MPA057.jpg', 'alt');

    const { kopiert, manuell } = sammleFotos({ quelle, ziel });

    expect(kopiert).toEqual([]);
    expect(manuell.map((m) => m.grund)).toEqual(['gleicher Name, anderer Inhalt', 'gleicher Name, anderer Inhalt']);
    expect(fs.existsSync(path.join(ziel, 'MPA057.jpg'))).toBe(false);
    expect(fs.existsSync(path.join(ziel, '_manuell/_Perlen/Fotos alt/MPA057.jpg'))).toBe(true);
  });

  test('zweiter Lauf kopiert nichts neu', () => {
    lege('_Perlen/MPA057.jpg');
    sammleFotos({ quelle, ziel });

    const { kopiert, vorhanden } = sammleFotos({ quelle, ziel });

    expect(kopiert).toEqual([]);
    expect(vorhanden).toHaveLength(1);
  });

  test('Dry-Run schreibt nichts', () => {
    lege('_Perlen/MPA057.jpg');

    const { kopiert } = sammleFotos({ quelle, ziel, dryRun: true });

    expect(kopiert).toHaveLength(1);
    expect(fs.existsSync(ziel)).toBe(false);
  });
});

describe('smbZuGvfs', () => {
  test('übersetzt smb:// in den gvfs-Pfad', () => {
    expect(smbZuGvfs('smb://10.0.2.12/homes/Marina/Drive', 1000))
      .toBe('/run/user/1000/gvfs/smb-share:server=10.0.2.12,share=homes/Marina/Drive');
  });

  test('lässt normale Pfade unverändert', () => {
    expect(smbZuGvfs('/mnt/drive')).toBe('/mnt/drive');
  });
});
