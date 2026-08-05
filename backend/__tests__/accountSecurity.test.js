'use strict';

/**
 * Tests für backend/src/utils/accountSecurity.js
 *
 * Die Sperrlogik entscheidet, ob sich ein legitimer Benutzer noch anmelden
 * kann. Ein Off-by-one beim Zähler sperrt entweder zu früh (Benutzer
 * ausgesperrt) oder nie (Brute-Force weiterhin möglich).
 */

const {
  MAX_FEHLVERSUCHE,
  SPERRDAUER_MINUTEN,
  RESET_TOKEN_GUELTIGKEIT_MINUTEN,
  istGesperrt,
  verbleibendeSperrminuten,
  naechsterFehlversuch,
  erzeugeResetToken,
  hashResetToken,
} = require('../src/utils/accountSecurity');

const JETZT = new Date('2026-08-05T12:00:00Z');

describe('istGesperrt', () => {
  it('ist false ohne locked_until', () => {
    expect(istGesperrt({ locked_until: null }, JETZT)).toBe(false);
    expect(istGesperrt({}, JETZT)).toBe(false);
    expect(istGesperrt(undefined, JETZT)).toBe(false);
  });

  it('ist true, solange die Sperre in der Zukunft liegt', () => {
    const locked = new Date(JETZT.getTime() + 60000);
    expect(istGesperrt({ locked_until: locked }, JETZT)).toBe(true);
  });

  it('ist false, sobald die Sperre abgelaufen ist', () => {
    const locked = new Date(JETZT.getTime() - 1000);
    expect(istGesperrt({ locked_until: locked }, JETZT)).toBe(false);
  });

  it('kommt auch mit einem Zeitstempel als String zurecht (pg liefert je nach Typ)', () => {
    const locked = new Date(JETZT.getTime() + 120000).toISOString();
    expect(istGesperrt({ locked_until: locked }, JETZT)).toBe(true);
  });
});

describe('verbleibendeSperrminuten', () => {
  it('rundet auf volle Minuten auf', () => {
    const locked = new Date(JETZT.getTime() + 90 * 1000); // 1,5 Minuten
    expect(verbleibendeSperrminuten({ locked_until: locked }, JETZT)).toBe(2);
  });

  it('ist 0 für ein nicht gesperrtes Konto', () => {
    expect(verbleibendeSperrminuten({ locked_until: null }, JETZT)).toBe(0);
  });
});

describe('naechsterFehlversuch', () => {
  it('zählt ab 0 hoch, ohne zu sperren', () => {
    expect(naechsterFehlversuch({ failed_login_attempts: 0 }, JETZT)).toEqual({
      versuche: 1,
      lockedUntil: null,
    });
  });

  it('sperrt nicht beim vorletzten Versuch', () => {
    const { versuche, lockedUntil } = naechsterFehlversuch(
      { failed_login_attempts: MAX_FEHLVERSUCHE - 2 },
      JETZT,
    );
    expect(versuche).toBe(MAX_FEHLVERSUCHE - 1);
    expect(lockedUntil).toBeNull();
  });

  it('sperrt genau beim Erreichen der Höchstzahl', () => {
    const { versuche, lockedUntil } = naechsterFehlversuch(
      { failed_login_attempts: MAX_FEHLVERSUCHE - 1 },
      JETZT,
    );
    expect(versuche).toBe(MAX_FEHLVERSUCHE);
    expect(lockedUntil).toEqual(new Date(JETZT.getTime() + SPERRDAUER_MINUTEN * 60000));
  });

  it('behandelt ein Konto ohne Zählerstand wie 0', () => {
    expect(naechsterFehlversuch({}, JETZT).versuche).toBe(1);
  });
});

describe('erzeugeResetToken', () => {
  it('liefert ein 64-stelliges Hex-Token', () => {
    const { token } = erzeugeResetToken(JETZT);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('speichert nur den Hash, nicht das Token selbst', () => {
    const { token, tokenHash } = erzeugeResetToken(JETZT);
    expect(tokenHash).not.toBe(token);
    expect(tokenHash).toBe(hashResetToken(token));
  });

  it('erzeugt bei jedem Aufruf ein anderes Token', () => {
    const a = erzeugeResetToken(JETZT).token;
    const b = erzeugeResetToken(JETZT).token;
    expect(a).not.toBe(b);
  });

  it('setzt die Ablaufzeit auf die konfigurierte Gültigkeit', () => {
    const { expiry } = erzeugeResetToken(JETZT);
    expect(expiry).toEqual(
      new Date(JETZT.getTime() + RESET_TOKEN_GUELTIGKEIT_MINUTEN * 60000),
    );
  });
});
