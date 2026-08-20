'use strict';

/**
 * Tests for the graceful JWT-Secret-Rollover (Issue #140): während einer
 * Rotation muss authenticate() Tokens akzeptieren, die entweder mit dem
 * aktuellen JWT_SECRET oder mit JWT_SECRET_OLD signiert wurden.
 */

process.env.JWT_SECRET = 'current-secret-do-not-use-in-prod';
process.env.JWT_SECRET_OLD = 'old-secret-do-not-use-in-prod';

jest.mock('../src/config/db', () => ({
  setCurrentDbUsername: jest.fn(),
  query: jest.fn(),
  requestContextMiddleware: (req, res, next) => next(),
}));

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const jwt = require('jsonwebtoken');
const logger = require('../src/utils/logger');
const { authenticate } = require('../src/middleware/auth');

function makeReqResMock(authHeader) {
  const req = { headers: {}, method: 'GET', originalUrl: '/test' };
  if (authHeader !== undefined) req.headers['authorization'] = authHeader;
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();
  return { req, res, next };
}

describe('JWT-Rollover (JWT_SECRET_OLD)', () => {
  it('akzeptiert ein mit dem aktuellen JWT_SECRET signiertes Token', () => {
    const token = jwt.sign({ id: 1, username: 'alice', role: 'admin' }, 'current-secret-do-not-use-in-prod', { expiresIn: '1h' });
    const { req, res, next } = makeReqResMock(`Bearer ${token}`);
    authenticate(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toMatchObject({ username: 'alice' });
  });

  it('akzeptiert ein mit JWT_SECRET_OLD signiertes Token (Graceful Rollover)', () => {
    const token = jwt.sign({ id: 2, username: 'bob', role: 'user' }, 'old-secret-do-not-use-in-prod', { expiresIn: '1h' });
    const { req, res, next } = makeReqResMock(`Bearer ${token}`);
    authenticate(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toMatchObject({ username: 'bob' });
    expect(logger.info).toHaveBeenCalledWith('AUTH', expect.stringContaining('JWT_SECRET_OLD'));
  });

  it('lehnt ein Token ab, das mit keinem der beiden Secrets signiert wurde', () => {
    const token = jwt.sign({ id: 3, username: 'mallory', role: 'admin' }, 'irgendein-anderes-secret', { expiresIn: '1h' });
    const { req, res, next } = makeReqResMock(`Bearer ${token}`);
    authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
