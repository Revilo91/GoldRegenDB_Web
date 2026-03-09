'use strict';

/**
 * Tests for parseCSVLines and extractArtikelnummer from
 * backend/src/routes/sumup.js
 *
 * These functions parse external SumUp CSV exports and extract article numbers.
 * A regression here would silently skip sales during import, or fail to
 * recognise valid article-number formats.
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

const { parseCSVLines, extractArtikelnummer } = require('../src/routes/sumup');

// ── parseCSVLines ────────────────────────────────────────────────────────────

describe('parseCSVLines(csvText)', () => {
  it('parses a single-line CSV', () => {
    const result = parseCSVLines('a,b,c');
    expect(result).toEqual([['a', 'b', 'c']]);
  });

  it('parses multiple lines separated by \\n', () => {
    const result = parseCSVLines('h1,h2\nv1,v2');
    expect(result).toEqual([['h1', 'h2'], ['v1', 'v2']]);
  });

  it('parses multiple lines separated by \\r\\n (Windows line endings)', () => {
    const result = parseCSVLines('h1,h2\r\nv1,v2');
    expect(result).toEqual([['h1', 'h2'], ['v1', 'v2']]);
  });

  it('handles quoted fields containing commas', () => {
    const result = parseCSVLines('"hello, world",second');
    expect(result).toEqual([['hello, world', 'second']]);
  });

  it('handles escaped double-quotes inside quoted fields ("")', () => {
    const result = parseCSVLines('"say ""hi""",end');
    expect(result).toEqual([['say "hi"', 'end']]);
  });

  it('handles quoted fields spanning a comma without quotes around them', () => {
    const result = parseCSVLines('a,"b,c",d');
    expect(result[0]).toEqual(['a', 'b,c', 'd']);
  });

  it('trims whitespace from unquoted fields', () => {
    const result = parseCSVLines(' a , b ');
    expect(result).toEqual([['a', 'b']]);
  });

  it('skips entirely empty lines', () => {
    const result = parseCSVLines('a,b\n\nc,d');
    // Empty line should not produce a record
    expect(result).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseCSVLines('')).toEqual([]);
  });

  it('handles a trailing newline without adding an extra record', () => {
    const result = parseCSVLines('a,b\n');
    expect(result).toEqual([['a', 'b']]);
  });
});

// ── extractArtikelnummer ─────────────────────────────────────────────────────

describe('extractArtikelnummer(text)', () => {
  it('returns null for null input', () => {
    expect(extractArtikelnummer(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractArtikelnummer('')).toBeNull();
  });

  it('extracts a plain article number (6 chars)', () => {
    expect(extractArtikelnummer('MBH001')).toBe('MBH001');
  });

  it('extracts an article number with suffix (_1)', () => {
    expect(extractArtikelnummer('MBH001_1')).toBe('MBH001_1');
  });

  it('extracts an article number embedded in a longer description', () => {
    expect(extractArtikelnummer('Betonring MBH001_2 blau')).toBe('MBH001_2');
  });

  it('is case-insensitive (also matches lowercase)', () => {
    const result = extractArtikelnummer('sbh001');
    expect(result).toBe('sbh001');
  });

  it('returns null when no article-number pattern is found', () => {
    expect(extractArtikelnummer('Random Text')).toBeNull();
  });

  it('handles "S" prefix (Saskia) articles', () => {
    expect(extractArtikelnummer('SPA425_3')).toBe('SPA425_3');
  });

  it('handles article numbers from the documented product type codes (A/H/O/S)', () => {
    expect(extractArtikelnummer('MAA100')).toBe('MAA100'); // Armband
    expect(extractArtikelnummer('MBH099')).toBe('MBH099'); // Halskette
    expect(extractArtikelnummer('MBO010')).toBe('MBO010'); // Ohrring
    expect(extractArtikelnummer('MBS005')).toBe('MBS005'); // Schlüsselanhänger
  });
});
