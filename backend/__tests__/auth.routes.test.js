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

// Passwörter werden seit Issue #131 im Klartext übertragen und im Backend gehasht
const PASSWORT = 'ein-sicheres-passwort';
// So sah der Hash von Altkonten aus: bcrypt(sha256(passwort))
const sha256 = (t) => require('crypto').createHash('sha256').update(t, 'utf8').digest('hex');

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
      .send({ password: PASSWORT });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('returns 400 when password is missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when password is empty', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: '' });
    expect(res.status).toBe(400);
  });

  it('erlaubt beim Login auch kurze Passwörter von Altkonten', async () => {
    const hash = await bcrypt.hash('admin', 10);
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 1, username: 'admin', password_hash: hash, role: 'admin', active: true, must_change_password: true }],
      })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin' });
    expect(res.status).toBe(200);
  });

  it('returns 401 when user does not exist', async () => {
    // DB returns no rows → non-existent user
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'nonexistent', password: PASSWORT });
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
      .send({ username: 'admin', password: PASSWORT });
    expect(res.status).toBe(401);
  });

  it('returns 403 when account is deactivated', async () => {
    const hash = await bcrypt.hash(PASSWORT, 10);
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
      .send({ username: 'inactive', password: PASSWORT });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/deaktiviert/);
  });

  it('returns 200 with JWT token and user info on success', async () => {
    const hash = await bcrypt.hash(PASSWORT, 10);
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
      .send({ username: 'admin', password: PASSWORT });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user).toMatchObject({ id: 1, username: 'admin', role: 'admin' });
    expect(res.body.mustChangePassword).toBe(false);
    // Verify the token can be decoded
    const decoded = jwt.verify(res.body.token, 'test-secret-do-not-use-in-prod');
    expect(decoded.username).toBe('admin');
  });

  it('sets mustChangePassword=true when flag is set', async () => {
    const hash = await bcrypt.hash(PASSWORT, 10);
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
      .send({ username: 'newuser', password: PASSWORT });
    expect(res.status).toBe(200);
    expect(res.body.mustChangePassword).toBe(true);
  });

  it('stellt den Hash eines Altkontos beim Login auf bcrypt(klartext) um', async () => {
    // Altkonto: gespeichert ist bcrypt(sha256(passwort))
    const legacyHash = await bcrypt.hash(sha256(PASSWORT), 10);
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 9, username: 'alt', password_hash: legacyHash, role: 'user', active: true, must_change_password: false }],
      })
      .mockResolvedValueOnce({ rows: [] }) // UPDATE password_hash
      .mockResolvedValueOnce({ rows: [] }); // UPDATE last_login
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alt', password: PASSWORT });

    expect(res.status).toBe(200);
    const rehashCall = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('SET password_hash'),
    );
    expect(rehashCall).toBeDefined();
    // Der neu gespeicherte Hash muss den Klartext akzeptieren
    await expect(bcrypt.compare(PASSWORT, rehashCall[1][0])).resolves.toBe(true);
  });

  it('schreibt keinen neuen Hash, wenn er bereits aktuell ist', async () => {
    const hash = await bcrypt.hash(PASSWORT, 10);
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 10, username: 'neu', password_hash: hash, role: 'user', active: true, must_change_password: false }],
      })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'neu', password: PASSWORT });

    expect(res.status).toBe(200);
    const rehashCall = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('SET password_hash'),
    );
    expect(rehashCall).toBeUndefined();
  });

  it('returns 503 when the database is unreachable (ECONNREFUSED)', async () => {
    const err = new Error('connect ECONNREFUSED');
    err.code = 'ECONNREFUSED';
    mockQuery.mockRejectedValueOnce(err);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: PASSWORT });
    expect(res.status).toBe(503);
  });

  it('returns 500 for unexpected DB errors', async () => {
    mockQuery.mockRejectedValueOnce(new Error('unexpected'));
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: PASSWORT });
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
  const NEUES_PASSWORT = 'noch-ein-sicheres-passwort';

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
      .send({ currentPassword: PASSWORT, newPassword: NEUES_PASSWORT });
    expect(res.status).toBe(401);
  });

  it('returns 400 when passwords are missing', async () => {
    const res = await request(app)
      .put('/api/auth/change-password')
      .set('Authorization', authHeader())
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 when the new password is too short', async () => {
    const res = await request(app)
      .put('/api/auth/change-password')
      .set('Authorization', authHeader())
      .send({ currentPassword: PASSWORT, newPassword: 'kurz' });
    expect(res.status).toBe(400);
  });

  it('returns 401 when current password is wrong', async () => {
    const wrongHash = await bcrypt.hash('c'.repeat(64), 10);
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 5, password_hash: wrongHash }] });
    const res = await request(app)
      .put('/api/auth/change-password')
      .set('Authorization', authHeader())
      .send({ currentPassword: PASSWORT, newPassword: NEUES_PASSWORT });
    expect(res.status).toBe(401);
  });

  it('returns 200 on successful password change', async () => {
    const currentHash = await bcrypt.hash(PASSWORT, 10);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 5, password_hash: currentHash }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE
    const res = await request(app)
      .put('/api/auth/change-password')
      .set('Authorization', authHeader())
      .send({ currentPassword: PASSWORT, newPassword: NEUES_PASSWORT });
    expect(res.status).toBe(200);
    expect(res.body.message).toBeTruthy();
  });
});
