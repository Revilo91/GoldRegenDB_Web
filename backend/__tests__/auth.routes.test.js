'use strict';

/**
 * Tests for backend/src/routes/auth.js (login, /me, change-password)
 *
 * The login route is the entry point for all authenticated sessions.
 * Regressions here could allow login with invalid credentials, expose
 * user-enumeration timing attacks, or break the password-change flow.
 */

process.env.JWT_SECRET = 'test-secret-do-not-use-in-prod';

// ── Mock external dependencies ────────────────────────────────────────────────

const mockQuery = jest.fn();
jest.mock('../src/config/db', () => ({
  query: mockQuery,
  setCurrentDbUsername: jest.fn(),
  requestContextMiddleware: (req, res, next) => next(),
}));

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// Build a minimal Express app that wires the auth router
function buildApp() {
  const app = express();
  app.use(express.json());
  // auth middleware needs requestContextMiddleware already applied
  app.use((req, res, next) => {
    // Minimal stub so authenticate can call setCurrentDbUsername
    next();
  });
  const authRouter = require('../src/routes/auth');
  app.use('/api/auth', authRouter);
  return app;
}

// Known SHA-256 hash for the string "admin"
const SHA256_ADMIN = '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918';

// ── isValidSHA256 (exported helper) ─────────────────────────────────────────

describe('isValidSHA256', () => {
  let isValidSHA256;
  beforeAll(() => {
    ({ isValidSHA256 } = require('../src/routes/auth'));
  });

  it('accepts a valid 64-char lowercase hex string', () => {
    expect(isValidSHA256(SHA256_ADMIN)).toBe(true);
  });

  it('rejects a string that is too short', () => {
    expect(isValidSHA256('abc123')).toBe(false);
  });

  it('rejects a string with uppercase letters', () => {
    expect(isValidSHA256(SHA256_ADMIN.toUpperCase())).toBe(false);
  });

  it('rejects a non-string value', () => {
    expect(isValidSHA256(null)).toBe(false);
    expect(isValidSHA256(undefined)).toBe(false);
    expect(isValidSHA256(123)).toBe(false);
  });

  it('rejects a 64-char string containing non-hex characters', () => {
    const invalid = 'z'.repeat(64);
    expect(isValidSHA256(invalid)).toBe(false);
  });
});

// ── POST /api/auth/login ─────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 when username is missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: SHA256_ADMIN });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('returns 400 when password is missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when password is not a valid SHA-256 hex string', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'plaintext' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Format/);
  });

  it('returns 401 when user does not exist', async () => {
    // DB returns no rows → non-existent user
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'nonexistent', password: SHA256_ADMIN });
    expect(res.status).toBe(401);
    expect(res.body.error).toBeTruthy();
  });

  it('returns 401 when password is wrong', async () => {
    // Create a real bcrypt hash for a different password so comparison fails
    const wrongHash = await bcrypt.hash('a'.repeat(64), 10);
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 1,
        username: 'admin',
        password_hash: wrongHash,
        role: 'admin',
        active: true,
        must_change_password: false,
      }],
    });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: SHA256_ADMIN });
    expect(res.status).toBe(401);
  });

  it('returns 403 when account is deactivated', async () => {
    const hash = await bcrypt.hash(SHA256_ADMIN, 10);
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 2,
        username: 'inactive',
        password_hash: hash,
        role: 'user',
        active: false,
        must_change_password: false,
      }],
    });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'inactive', password: SHA256_ADMIN });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/deaktiviert/);
  });

  it('returns 200 with JWT token and user info on success', async () => {
    const hash = await bcrypt.hash(SHA256_ADMIN, 10);
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 1,
          username: 'admin',
          password_hash: hash,
          role: 'admin',
          active: true,
          must_change_password: false,
        }],
      })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE last_login
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: SHA256_ADMIN });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user).toMatchObject({ id: 1, username: 'admin', role: 'admin' });
    expect(res.body.mustChangePassword).toBe(false);
    // Verify the token can be decoded
    const decoded = jwt.verify(res.body.token, 'test-secret-do-not-use-in-prod');
    expect(decoded.username).toBe('admin');
  });

  it('sets mustChangePassword=true when flag is set', async () => {
    const hash = await bcrypt.hash(SHA256_ADMIN, 10);
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 3,
          username: 'newuser',
          password_hash: hash,
          role: 'user',
          active: true,
          must_change_password: true,
        }],
      })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'newuser', password: SHA256_ADMIN });
    expect(res.status).toBe(200);
    expect(res.body.mustChangePassword).toBe(true);
  });

  it('returns 503 when the database is unreachable (ECONNREFUSED)', async () => {
    const err = new Error('connect ECONNREFUSED');
    err.code = 'ECONNREFUSED';
    mockQuery.mockRejectedValueOnce(err);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: SHA256_ADMIN });
    expect(res.status).toBe(503);
  });

  it('returns 500 for unexpected DB errors', async () => {
    mockQuery.mockRejectedValueOnce(new Error('unexpected'));
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: SHA256_ADMIN });
    expect(res.status).toBe(500);
  });
});

// ── GET /api/auth/me ─────────────────────────────────────────────────────────

describe('GET /api/auth/me', () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  it('returns 401 without Authorization header', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns 200 with user payload for a valid token', async () => {
    const token = jwt.sign(
      { id: 1, username: 'admin', role: 'admin' },
      'test-secret-do-not-use-in-prod',
      { expiresIn: '1h' },
    );
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ username: 'admin', role: 'admin' });
  });
});

// ── PUT /api/auth/change-password ────────────────────────────────────────────

describe('PUT /api/auth/change-password', () => {
  let app;
  const SHA256_NEW = 'b'.repeat(64); // 64 hex chars, used as "new password"

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function authHeader() {
    const token = jwt.sign(
      { id: 5, username: 'tester', role: 'user' },
      'test-secret-do-not-use-in-prod',
      { expiresIn: '1h' },
    );
    return `Bearer ${token}`;
  }

  it('returns 401 without a token', async () => {
    const res = await request(app)
      .put('/api/auth/change-password')
      .send({ currentPassword: SHA256_ADMIN, newPassword: SHA256_NEW });
    expect(res.status).toBe(401);
  });

  it('returns 400 when passwords are missing', async () => {
    const res = await request(app)
      .put('/api/auth/change-password')
      .set('Authorization', authHeader())
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 when passwords are not valid SHA-256', async () => {
    const res = await request(app)
      .put('/api/auth/change-password')
      .set('Authorization', authHeader())
      .send({ currentPassword: 'short', newPassword: 'alsoShort' });
    expect(res.status).toBe(400);
  });

  it('returns 401 when current password is wrong', async () => {
    const wrongHash = await bcrypt.hash('c'.repeat(64), 10);
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 5, password_hash: wrongHash }] });
    const res = await request(app)
      .put('/api/auth/change-password')
      .set('Authorization', authHeader())
      .send({ currentPassword: SHA256_ADMIN, newPassword: SHA256_NEW });
    expect(res.status).toBe(401);
  });

  it('returns 200 on successful password change', async () => {
    const currentHash = await bcrypt.hash(SHA256_ADMIN, 10);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 5, password_hash: currentHash }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE
    const res = await request(app)
      .put('/api/auth/change-password')
      .set('Authorization', authHeader())
      .send({ currentPassword: SHA256_ADMIN, newPassword: SHA256_NEW });
    expect(res.status).toBe(200);
    expect(res.body.message).toBeTruthy();
  });
});
