'use strict';

/**
 * Tests for backend/src/utils/logger.js
 *
 * The logger is a pure formatting utility used everywhere in the backend.
 * Verifying its output format prevents silent regressions in structured logging.
 */

const logger = require('../src/utils/logger');

describe('logger', () => {
  let consoleSpy;
  let consoleWarnSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.LOG_LEVEL;
  });

  describe('info()', () => {
    it('calls console.log with INFO level, component and message', () => {
      logger.info('TEST', 'hello world');
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const output = consoleSpy.mock.calls[0][0];
      expect(output).toMatch(/\[INFO\]/);
      expect(output).toMatch(/\[TEST\]/);
      expect(output).toMatch(/hello world/);
    });

    it('includes ISO timestamp prefix', () => {
      logger.info('COMP', 'msg');
      const output = consoleSpy.mock.calls[0][0];
      expect(output).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('serialises meta as JSON when provided', () => {
      logger.info('COMP', 'msg', { key: 'value' });
      const output = consoleSpy.mock.calls[0][0];
      expect(output).toContain('{"key":"value"}');
    });

    it('omits meta section when no meta is given', () => {
      logger.info('COMP', 'msg');
      const output = consoleSpy.mock.calls[0][0];
      expect(output).not.toMatch(/\|/);
    });
  });

  describe('warn()', () => {
    it('calls console.warn with WARN level', () => {
      logger.warn('COMP', 'warning message');
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      const output = consoleWarnSpy.mock.calls[0][0];
      expect(output).toMatch(/\[WARN\]/);
      expect(output).toMatch(/warning message/);
    });
  });

  describe('error()', () => {
    it('calls console.error with ERROR level', () => {
      logger.error('COMP', 'error message');
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const output = consoleErrorSpy.mock.calls[0][0];
      expect(output).toMatch(/\[ERROR\]/);
      expect(output).toMatch(/error message/);
    });
  });

  describe('debug()', () => {
    it('does NOT output when LOG_LEVEL is not "debug"', () => {
      logger.debug('COMP', 'debug message');
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('outputs when LOG_LEVEL=debug', () => {
      process.env.LOG_LEVEL = 'debug';
      logger.debug('COMP', 'debug message');
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const output = consoleSpy.mock.calls[0][0];
      expect(output).toMatch(/\[DEBUG\]/);
    });
  });

  describe('JSON-Modus (LOG_FORMAT=json)', () => {
    afterEach(() => {
      delete process.env.LOG_FORMAT;
    });

    it('gibt ein einzelnes valides JSON-Objekt mit allen Pflichtfeldern aus', () => {
      process.env.LOG_FORMAT = 'json';
      logger.info('KUNDEN', 'Kunde erstellt', { id: 42 });
      const output = consoleSpy.mock.calls[0][0];
      const entry = JSON.parse(output);
      expect(entry).toMatchObject({
        level: 'INFO',
        component: 'KUNDEN',
        message: 'Kunde erstellt',
        id: 42,
        pid: process.pid,
      });
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(typeof entry.hostname).toBe('string');
    });

    it('NODE_ENV=production wählt JSON ohne explizites LOG_FORMAT', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      logger.info('SERVER', 'startet');
      process.env.NODE_ENV = originalEnv;
      const output = consoleSpy.mock.calls[0][0];
      expect(() => JSON.parse(output)).not.toThrow();
    });
  });

  describe('Pretty-Modus (Default außerhalb von Produktion)', () => {
    afterEach(() => {
      delete process.env.LOG_FORMAT;
    });

    it('bleibt für Menschen lesbar statt reines JSON', () => {
      process.env.LOG_FORMAT = 'pretty';
      logger.info('KUNDEN', 'Kunde erstellt', { id: 42 });
      const output = consoleSpy.mock.calls[0][0];
      expect(output).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.*\[INFO\] \[KUNDEN\] Kunde erstellt \{"id":42\}$/);
      expect(() => JSON.parse(output)).toThrow();
    });
  });

  describe('Redaction', () => {
    it('ersetzt bekannte sensible Feldnamen durch [REDACTED]', () => {
      logger.warn('AUTH', 'Login fehlgeschlagen', {
        password: 'geheim123',
        token: 'abc.def.ghi',
        reset_token: 'xyz',
        user: 'alice',
      });
      const output = consoleWarnSpy.mock.calls[0][0];
      expect(output).not.toContain('geheim123');
      expect(output).not.toContain('abc.def.ghi');
      expect(output).not.toContain('xyz');
      expect(output).toContain('[REDACTED]');
      expect(output).toContain('alice');
    });

    it('redigiert sensible Felder auch verschachtelt', () => {
      logger.error('AUTH', 'Fehler', { context: { authorization: 'Bearer secret-token' } });
      const output = consoleErrorSpy.mock.calls[0][0];
      expect(output).not.toContain('secret-token');
      expect(output).toContain('[REDACTED]');
    });

    it('lässt harmlose Feldnamen mit "cookie"/"token" als Teilwort unangetastet', () => {
      logger.warn('CSRF', 'Request abgelehnt', { hatCookie: true, hatHeader: false });
      const output = consoleWarnSpy.mock.calls[0][0];
      expect(output).toContain('"hatCookie":true');
      expect(output).toContain('"hatHeader":false');
    });
  });

  describe('Rückwärtskompatibilität', () => {
    it('funktioniert ohne meta-Argument und ohne [object Object]', () => {
      logger.info('HTTP', 'GET /api/health');
      const output = consoleSpy.mock.calls[0][0];
      expect(output).not.toContain('[object Object]');
      expect(output).toContain('GET /api/health');
    });
  });
});
