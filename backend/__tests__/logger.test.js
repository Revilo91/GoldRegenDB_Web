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
});
