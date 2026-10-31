'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ermittleBackupStatus, STANDARD_MAX_ALTER_STUNDEN } = require('../src/services/backupStatus');

const JETZT = new Date('2026-10-26T12:00:00.000Z');
const STUNDE_MS = 60 * 60 * 1000;
const vor = (stunden) => new Date(JETZT.getTime() - stunden * STUNDE_MS).toISOString();

describe('ermittleBackupStatus', () => {
  let verzeichnis;
  let datei;
  const schreibe = (inhalt) => fs.writeFileSync(datei, typeof inhalt === 'string' ? inhalt : JSON.stringify(inhalt));
  const status = (optionen = {}) => ermittleBackupStatus({ datei, jetzt: JETZT, ...optionen });

  beforeEach(() => {
    verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-status-'));
    datei = path.join(verzeichnis, 'backup-status.json');
  });
  afterEach(() => fs.rmSync(verzeichnis, { recursive: true, force: true }));

  it('hat 26 Stunden als Standard', () => {
    expect(STANDARD_MAX_ALTER_STUNDEN).toBe(26);
  });

  it('meldet "ok" bei erfolgreichem, frischem Lauf', () => {
    schreibe({ zeitpunkt: vor(2), ergebnis: 'ok', datei: 'x.sql.gz' });
    expect(status()).toBe('ok');
  });

  it('meldet "ok" genau an der Grenze von 26 Stunden', () => {
    schreibe({ zeitpunkt: vor(26), ergebnis: 'ok' });
    expect(status()).toBe('ok');
  });

  it('meldet "veraltet" eine Sekunde nach 26 Stunden', () => {
    schreibe({ zeitpunkt: new Date(JETZT.getTime() - 26 * STUNDE_MS - 1000).toISOString(), ergebnis: 'ok' });
    expect(status()).toBe('veraltet');
  });

  it('beachtet maxAlterStunden', () => {
    schreibe({ zeitpunkt: vor(5), ergebnis: 'ok' });
    expect(status({ maxAlterStunden: 4 })).toBe('veraltet');
    expect(status({ maxAlterStunden: 6 })).toBe('ok');
  });

  it('fällt bei ungültigem maxAlterStunden auf 26 zurück', () => {
    schreibe({ zeitpunkt: vor(10), ergebnis: 'ok' });
    expect(status({ maxAlterStunden: 'abc' })).toBe('ok');
    expect(status({ maxAlterStunden: -1 })).toBe('ok');
  });

  it('meldet "fehler", wenn der letzte Lauf fehlschlug (auch bei altem Lauf)', () => {
    schreibe({ zeitpunkt: vor(1), ergebnis: 'fehler', fehler: 'pg_dump' });
    expect(status()).toBe('fehler');
    schreibe({ zeitpunkt: vor(100), ergebnis: 'fehler' });
    expect(status()).toBe('fehler');
  });

  it('meldet "unbekannt" bei fehlender Datei', () => {
    expect(status()).toBe('unbekannt');
  });

  it('meldet "unbekannt" bei kaputtem JSON, ohne zu werfen', () => {
    schreibe('{"zeitpunkt": ');
    expect(status()).toBe('unbekannt');
  });

  it.each([
    ['leere Datei', ''],
    ['JSON null', 'null'],
    ['JSON-Array', '[]'],
    ['ohne Zeitpunkt', { ergebnis: 'ok' }],
    ['ungültiger Zeitpunkt', { zeitpunkt: 'gestern', ergebnis: 'ok' }],
    ['unbekanntes Ergebnis', { zeitpunkt: vor(1), ergebnis: 'vielleicht' }],
  ])('meldet "unbekannt": %s', (_name, inhalt) => {
    schreibe(inhalt);
    expect(status()).toBe('unbekannt');
  });

  it('meldet "unbekannt", wenn der Pfad ein Verzeichnis ist', () => {
    expect(ermittleBackupStatus({ datei: verzeichnis, jetzt: JETZT })).toBe('unbekannt');
  });

  it('gibt nur das Status-Wort zurück, nie Pfade, Dateinamen oder Fehlertext', () => {
    schreibe({ zeitpunkt: vor(1), ergebnis: 'fehler', datei: 'geheim.sql.gz', fehler: '/backups/daily boom', groesse_bytes: 4711 });
    const antwort = status();
    expect(typeof antwort).toBe('string');
    expect(['ok', 'veraltet', 'fehler', 'unbekannt']).toContain(antwort);
    expect(JSON.stringify({ backup: { status: antwort } })).toBe('{"backup":{"status":"fehler"}}');
  });

  it('liest Pfad und Grenze aus der Umgebung', () => {
    schreibe({ zeitpunkt: vor(3), ergebnis: 'ok' });
    const alt = { ...process.env };
    process.env.BACKUP_STATUS_DATEI = datei;
    process.env.BACKUP_MAX_ALTER_STUNDEN = '2';
    try {
      expect(ermittleBackupStatus({ jetzt: JETZT })).toBe('veraltet');
    } finally {
      process.env = alt;
    }
  });
});
