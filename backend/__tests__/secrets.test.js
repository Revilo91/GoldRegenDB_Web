'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { getSecret, validateProductionSecrets, extractDatabaseUrlPassword } = require('../src/config/secrets');

describe('getSecret', () => {
  const envKeysToClean = ['TEST_SECRET', 'TEST_SECRET_FILE'];
  let tmpFile;

  afterEach(() => {
    envKeysToClean.forEach((key) => delete process.env[key]);
    if (tmpFile && fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
      tmpFile = undefined;
    }
  });

  it('liest aus der normalen Env-Var, wenn keine *_FILE-Variable gesetzt ist', () => {
    process.env.TEST_SECRET = 'plaintext-value';
    expect(getSecret('TEST_SECRET')).toBe('plaintext-value');
  });

  it('bevorzugt den (getrimmten) Dateiinhalt gegenüber der Env-Var', () => {
    tmpFile = path.join(os.tmpdir(), `secret-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, '  file-value\n');
    process.env.TEST_SECRET = 'plaintext-value';
    process.env.TEST_SECRET_FILE = tmpFile;
    expect(getSecret('TEST_SECRET')).toBe('file-value');
  });

  it('wirft einen Fehler, wenn die referenzierte Datei nicht gelesen werden kann', () => {
    process.env.TEST_SECRET_FILE = '/nicht/vorhanden/secret.txt';
    expect(() => getSecret('TEST_SECRET')).toThrow(/konnte nicht gelesen werden/);
  });

  it('liefert undefined, wenn weder Env-Var noch Datei gesetzt sind', () => {
    expect(getSecret('TEST_SECRET')).toBeUndefined();
  });
});

describe('validateProductionSecrets', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('liefert immer eine leere Liste außerhalb von production', () => {
    process.env.NODE_ENV = 'development';
    const probleme = validateProductionSecrets([
      { name: 'JWT_SECRET', value: 'changeme', minLength: 32 },
    ]);
    expect(probleme).toEqual([]);
  });

  it('meldet Platzhalterwerte in production', () => {
    process.env.NODE_ENV = 'production';
    const probleme = validateProductionSecrets([
      { name: 'JWT_SECRET', value: 'change-this-to-a-long-random-secret', minLength: 32 },
    ]);
    expect(probleme).toEqual(
      expect.arrayContaining([expect.stringContaining('JWT_SECRET verwendet noch einen Platzhalterwert')]),
    );
  });

  it('meldet zu kurze Secrets in production', () => {
    process.env.NODE_ENV = 'production';
    const probleme = validateProductionSecrets([
      { name: 'DB_PASSWORD', value: 'kurz', minLength: 12 },
    ]);
    expect(probleme).toEqual(
      expect.arrayContaining([expect.stringContaining('DB_PASSWORD ist zu kurz')]),
    );
  });

  it('meldet nichts für ein starkes, individuelles Secret', () => {
    process.env.NODE_ENV = 'production';
    const probleme = validateProductionSecrets([
      { name: 'JWT_SECRET', value: 'a'.repeat(40), minLength: 32 },
    ]);
    expect(probleme).toEqual([]);
  });

  it('überspringt fehlende Werte (das wird an der Verwendungsstelle erzwungen)', () => {
    process.env.NODE_ENV = 'production';
    const probleme = validateProductionSecrets([
      { name: 'JWT_SECRET', value: undefined, minLength: 32 },
    ]);
    expect(probleme).toEqual([]);
  });
});

describe('extractDatabaseUrlPassword', () => {
  it('extrahiert das Passwort aus einer postgresql://-URL', () => {
    expect(extractDatabaseUrlPassword('postgresql://goldregen:geheim123@db:5432/goldregendb')).toBe('geheim123');
  });

  it('dekodiert URL-kodierte Sonderzeichen im Passwort', () => {
    expect(extractDatabaseUrlPassword('postgresql://user:p%40ss%23word@db:5432/db')).toBe('p@ss#word');
  });

  it('liefert undefined für undefined/leere Eingaben', () => {
    expect(extractDatabaseUrlPassword(undefined)).toBeUndefined();
    expect(extractDatabaseUrlPassword('')).toBeUndefined();
  });

  it('liefert undefined für eine URL ohne Passwort', () => {
    expect(extractDatabaseUrlPassword('postgresql://db:5432/db')).toBeUndefined();
  });
});
