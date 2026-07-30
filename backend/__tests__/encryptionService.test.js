'use strict';

process.env.BESTELLUNG_ENCRYPTION_KEY = 'b3ae96f21e2f1ca8b65351153ccb3d8f0a1aa9b495c91b11530467d34c2e9336';

const { encryptField, decryptField, hashValue } = require('../src/utils/encryptionService');

describe('encryptionService', () => {
  it('verschlüsselt und entschlüsselt einen Wert verlustfrei', () => {
    const encrypted = encryptField('Max Mustermann');
    expect(Buffer.isBuffer(encrypted)).toBe(true);
    expect(decryptField(encrypted)).toBe('Max Mustermann');
  });

  it('erzeugt unterschiedliches Chiffrat bei gleichem Klartext (zufälliger IV pro Aufruf)', () => {
    const a = encryptField('gleicher text');
    const b = encryptField('gleicher text');
    expect(a.equals(b)).toBe(false);
    expect(decryptField(a)).toBe(decryptField(b));
  });

  it('gibt null für leere/NULL/undefined Werte zurück', () => {
    expect(encryptField(null)).toBeNull();
    expect(encryptField(undefined)).toBeNull();
    expect(encryptField('')).toBeNull();
    expect(decryptField(null)).toBeNull();
    expect(decryptField(undefined)).toBeNull();
  });

  it('lehnt manipuliertes Chiffrat ab (GCM-Authentizität)', () => {
    const encrypted = encryptField('geheime Adresse');
    const tampered = Buffer.from(encrypted);
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => decryptField(tampered)).toThrow();
  });

  it('hashValue liefert deterministischen, nicht umkehrbaren Hash', () => {
    expect(hashValue('192.168.1.1')).toBe(hashValue('192.168.1.1'));
    expect(hashValue('192.168.1.1')).not.toBe('192.168.1.1');
    expect(hashValue(null)).toBeNull();
  });
});
