'use strict';

/**
 * Tests for the utility functions exported from
 * backend/src/routes/schmuckstuecke.js
 *
 * resolveAusschussGrund is called on every CREATE and UPDATE of a Schmuckstück.
 * A regression here could silently clear the mandatory Ausschuss_Grund field
 * or fail the DB CHECK constraint.
 *
 * GRUNDMATERIAL and PRODUKTART are used to decode article-number prefixes.
 */

process.env.JWT_SECRET = 'test-secret-do-not-use-in-prod';

jest.mock('../src/config/db', () => ({
  query: jest.fn(),
  setCurrentDbUsername: jest.fn(),
  requestContextMiddleware: (req, res, next) => next(),
}));

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const {
  resolveAusschussGrund,
  GRUNDMATERIAL,
  PRODUKTART,
} = require('../src/routes/schmuckstuecke');

// ── resolveAusschussGrund ────────────────────────────────────────────────────

describe('resolveAusschussGrund(ausschuss, ausschussGrund)', () => {
  describe('when ausschuss = 1 (item is defective)', () => {
    it('returns the provided reason when given', () => {
      expect(resolveAusschussGrund(1, 'Riss')).toBe('Riss');
    });

    it('returns "Defekt" as default when reason is empty string', () => {
      expect(resolveAusschussGrund(1, '')).toBe('Defekt');
    });

    it('returns "Defekt" as default when reason is whitespace only', () => {
      expect(resolveAusschussGrund(1, '   ')).toBe('Defekt');
    });

    it('returns "Defekt" when reason is null', () => {
      expect(resolveAusschussGrund(1, null)).toBe('Defekt');
    });

    it('returns "Defekt" when reason is undefined', () => {
      expect(resolveAusschussGrund(1, undefined)).toBe('Defekt');
    });

    it('trims whitespace from the provided reason', () => {
      expect(resolveAusschussGrund(1, '  Bruch  ')).toBe('Bruch');
    });

    it('accepts ausschuss as string "1"', () => {
      expect(resolveAusschussGrund('1', 'Verfärbung')).toBe('Verfärbung');
    });
  });

  describe('when ausschuss = 0 (item is NOT defective)', () => {
    it('returns null when no reason is given', () => {
      expect(resolveAusschussGrund(0, '')).toBeNull();
    });

    it('returns null when reason is null', () => {
      expect(resolveAusschussGrund(0, null)).toBeNull();
    });

    it('returns the provided reason string when ausschuss=0', () => {
      // A reason can still be stored when ausschuss=0 (e.g. clearing a past reason)
      expect(resolveAusschussGrund(0, 'OldReason')).toBe('OldReason');
    });

    it('accepts ausschuss as string "0"', () => {
      expect(resolveAusschussGrund('0', '')).toBeNull();
    });

    it('treats any non-1 numeric value as 0', () => {
      expect(resolveAusschussGrund(2, '')).toBeNull();
      expect(resolveAusschussGrund(-1, '')).toBeNull();
    });
  });
});

// ── GRUNDMATERIAL lookup table ───────────────────────────────────────────────

describe('GRUNDMATERIAL', () => {
  it('maps each defined code to a non-empty string', () => {
    expect(Object.keys(GRUNDMATERIAL).length).toBeGreaterThan(0);
    for (const [code, name] of Object.entries(GRUNDMATERIAL)) {
      expect(typeof code).toBe('string');
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it('covers the documented article-number prefix codes', () => {
    const documented = ['A', 'B', 'C', 'E', 'F', 'H', 'I', 'J', 'K', 'L',
      'M', 'N', 'P', 'S', 'W', 'X', 'Y'];
    for (const code of documented) {
      expect(GRUNDMATERIAL).toHaveProperty(code);
    }
  });

  it('returns "Beton" for code "B"', () => {
    expect(GRUNDMATERIAL['B']).toBe('Beton');
  });
});

// ── PRODUKTART lookup table ──────────────────────────────────────────────────

describe('PRODUKTART', () => {
  it('maps each defined code to a non-empty string', () => {
    expect(Object.keys(PRODUKTART).length).toBeGreaterThan(0);
    for (const [code, name] of Object.entries(PRODUKTART)) {
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it('covers the four documented product types', () => {
    expect(PRODUKTART['A']).toBe('Armband');
    expect(PRODUKTART['H']).toBe('Halskette');
    expect(PRODUKTART['O']).toBe('Ohrring');
    expect(PRODUKTART['S']).toBe('Schlüsselanhänger');
  });
});
