'use strict';

/**
 * Tests für backend/src/utils/passwordService.js
 *
 * Kritisch ist hier der Migrationspfad: bis Issue #131 hashte das Frontend
 * mit SHA-256 vor, gespeichert wurde bcrypt(sha256(passwort)). Bestehende
 * Konten tragen diesen Hash noch. Fällt der Fallback weg oder greift er
 * falsch, kann sich niemand mehr anmelden.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const {
  hashPassword,
  verifyPassword,
  legacySha256,
  MIN_PASSWORT_LAENGE,
} = require('../src/utils/passwordService');

const PASSWORT = 'ein-sicheres-passwort';

describe('hashPassword', () => {
  it('erzeugt einen bcrypt-Hash des Klartexts', async () => {
    const hash = await hashPassword(PASSWORT);
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);
    expect(await bcrypt.compare(PASSWORT, hash)).toBe(true);
  });

  it('erzeugt bei gleichem Passwort unterschiedliche Hashes (Salt)', async () => {
    const [a, b] = await Promise.all([hashPassword(PASSWORT), hashPassword(PASSWORT)]);
    expect(a).not.toBe(b);
  });
});

describe('verifyPassword – aktuelles Verfahren', () => {
  it('akzeptiert das richtige Passwort ohne Rehash-Bedarf', async () => {
    const hash = await hashPassword(PASSWORT);
    await expect(verifyPassword(PASSWORT, hash)).resolves.toEqual({
      valid: true,
      needsRehash: false,
    });
  });

  it('lehnt ein falsches Passwort ab', async () => {
    const hash = await hashPassword(PASSWORT);
    await expect(verifyPassword('falsch', hash)).resolves.toEqual({
      valid: false,
      needsRehash: false,
    });
  });
});

describe('verifyPassword – Altkonten (bcrypt(sha256(passwort)))', () => {
  it('akzeptiert das Passwort und meldet Rehash-Bedarf', async () => {
    const legacyHash = await bcrypt.hash(legacySha256(PASSWORT), 10);
    await expect(verifyPassword(PASSWORT, legacyHash)).resolves.toEqual({
      valid: true,
      needsRehash: true,
    });
  });

  it('lehnt ein falsches Passwort auch gegen einen Alt-Hash ab', async () => {
    const legacyHash = await bcrypt.hash(legacySha256(PASSWORT), 10);
    await expect(verifyPassword('falsch', legacyHash)).resolves.toEqual({
      valid: false,
      needsRehash: false,
    });
  });

  it('legacySha256 entspricht dem, was das alte Frontend berechnet hat', () => {
    // Referenzwert: SHA-256("admin"), wie ihn die frühere hashPassword() lieferte
    expect(legacySha256('admin')).toBe(
      '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918',
    );
    expect(legacySha256(PASSWORT)).toBe(
      crypto.createHash('sha256').update(PASSWORT, 'utf8').digest('hex'),
    );
  });
});

describe('verifyPassword – Randfälle', () => {
  it('läuft ohne gespeicherten Hash gegen den Dummy-Hash und schlägt fehl', async () => {
    await expect(verifyPassword(PASSWORT, null)).resolves.toEqual({
      valid: false,
      needsRehash: false,
    });
  });

  it('wirft bei einem defekten Hash nicht, sondern liefert valid: false', async () => {
    await expect(verifyPassword(PASSWORT, 'kein-bcrypt-hash')).resolves.toEqual({
      valid: false,
      needsRehash: false,
    });
  });

  it('definiert eine Mindestlänge für neue Passwörter', () => {
    expect(MIN_PASSWORT_LAENGE).toBeGreaterThanOrEqual(8);
  });
});
