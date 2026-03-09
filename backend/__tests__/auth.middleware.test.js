'use strict';

/**
 * Tests for backend/src/middleware/auth.js
 *
 * The auth middleware is the security boundary for every protected endpoint.
 * Regression here would allow unauthenticated or under-privileged access to
 * sensitive data and admin operations.
 */

// Set required env var BEFORE the module is loaded (it exits if missing)
process.env.JWT_SECRET = 'test-secret-do-not-use-in-prod';

// Mock the db module so the middleware does not need a real DB connection
jest.mock('../src/config/db', () => ({
  setCurrentDbUsername: jest.fn(),
  query: jest.fn(),
  requestContextMiddleware: (req, res, next) => next(),
}));

// Mock logger to avoid noisy output
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const jwt = require('jsonwebtoken');
const { authenticate, requireAdmin, requireBearbeiter } = require('../src/middleware/auth');

// ── helpers ─────────────────────────────────────────────────────────────────

function makeReqResMock(authHeader) {
  const req = { headers: {}, method: 'GET', originalUrl: '/test' };
  if (authHeader !== undefined) req.headers['authorization'] = authHeader;
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  const next = jest.fn();
  return { req, res, next };
}

function signToken(payload, secret = 'test-secret-do-not-use-in-prod', opts = {}) {
  return jwt.sign(payload, secret, { expiresIn: '1h', ...opts });
}

// ── authenticate ─────────────────────────────────────────────────────────────

describe('authenticate middleware', () => {
  it('returns 401 when Authorization header is missing', () => {
    const { req, res, next } = makeReqResMock();
    authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Nicht authentifiziert' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when Authorization header does not start with "Bearer "', () => {
    const { req, res, next } = makeReqResMock('Basic abc');
    authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for an invalid / tampered token', () => {
    const { req, res, next } = makeReqResMock('Bearer bad.token.value');
    authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('Ungültiges') }));
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for a token signed with a wrong secret', () => {
    const token = signToken({ id: 1, username: 'u', role: 'user' }, 'wrong-secret');
    const { req, res, next } = makeReqResMock(`Bearer ${token}`);
    authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for an expired token', () => {
    const token = signToken({ id: 1, username: 'u', role: 'user' }, undefined, { expiresIn: '-1s' });
    const { req, res, next } = makeReqResMock(`Bearer ${token}`);
    authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() and sets req.user for a valid token', () => {
    const payload = { id: 42, username: 'alice', role: 'admin' };
    const token = signToken(payload);
    const { req, res, next } = makeReqResMock(`Bearer ${token}`);
    authenticate(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toMatchObject({ id: 42, username: 'alice', role: 'admin' });
    expect(res.status).not.toHaveBeenCalled();
  });
});

// ── requireAdmin ─────────────────────────────────────────────────────────────

describe('requireAdmin middleware', () => {
  it('returns 403 when req.user is missing', () => {
    const { req, res, next } = makeReqResMock();
    req.user = undefined;
    requireAdmin(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 for role "bearbeiter"', () => {
    const { req, res, next } = makeReqResMock();
    req.user = { username: 'bob', role: 'bearbeiter' };
    requireAdmin(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 for role "user"', () => {
    const { req, res, next } = makeReqResMock();
    req.user = { username: 'carol', role: 'user' };
    requireAdmin(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() for role "admin"', () => {
    const { req, res, next } = makeReqResMock();
    req.user = { username: 'admin', role: 'admin' };
    requireAdmin(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});

// ── requireBearbeiter ────────────────────────────────────────────────────────

describe('requireBearbeiter middleware', () => {
  it('returns 403 when req.user is missing', () => {
    const { req, res, next } = makeReqResMock();
    req.user = undefined;
    requireBearbeiter(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 for role "user"', () => {
    const { req, res, next } = makeReqResMock();
    req.user = { username: 'dave', role: 'user' };
    requireBearbeiter(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() for role "bearbeiter"', () => {
    const { req, res, next } = makeReqResMock();
    req.user = { username: 'eve', role: 'bearbeiter' };
    requireBearbeiter(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('calls next() for role "admin"', () => {
    const { req, res, next } = makeReqResMock();
    req.user = { username: 'admin', role: 'admin' };
    requireBearbeiter(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
