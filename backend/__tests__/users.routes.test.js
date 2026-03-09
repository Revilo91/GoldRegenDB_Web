'use strict';

/**
 * Tests for user-management route: backend/src/routes/users.js
 *
 * Key risks covered:
 * - Role validation (only admin/bearbeiter/user accepted)
 * - SHA-256 format enforcement on password fields
 * - Duplicate-username conflict handling (HTTP 409)
 * - Proper 404 when a user is not found
 */

process.env.JWT_SECRET = 'test-secret-do-not-use-in-prod';

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

function buildApp() {
  const app = express();
  app.use(express.json());
  // Inject a fake admin user so requireAdmin middleware passes
  app.use((req, res, next) => {
    req.user = { id: 99, username: 'admin', role: 'admin' };
    next();
  });
  const usersRouter = require('../src/routes/users');
  app.use('/api/users', usersRouter);
  return app;
}

const SHA256_PASS = '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918';

describe('POST /api/users (create user)', () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 when username is missing', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ password: SHA256_PASS, role: 'user' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when password is missing', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ username: 'newuser', role: 'user' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when password is not a valid SHA-256 string', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ username: 'newuser', password: 'plaintext', role: 'user' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Format/);
  });

  it('returns 400 when role is invalid', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ username: 'newuser', password: SHA256_PASS, role: 'superadmin' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Rolle/);
  });

  it('returns 409 when username is already taken', async () => {
    const err = new Error('duplicate key');
    err.code = '23505';
    mockQuery.mockRejectedValueOnce(err);
    const res = await request(app)
      .post('/api/users')
      .send({ username: 'admin', password: SHA256_PASS, role: 'user' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/vergeben/);
  });

  it('returns 201 with the created user on success', async () => {
    const newUser = {
      id: 10,
      username: 'newuser',
      email: null,
      role: 'user',
      active: true,
      must_change_password: true,
      created_at: new Date().toISOString(),
    };
    mockQuery.mockResolvedValueOnce({ rows: [newUser] });
    const res = await request(app)
      .post('/api/users')
      .send({ username: 'newuser', password: SHA256_PASS, role: 'user' });
    expect(res.status).toBe(201);
    expect(res.body.username).toBe('newuser');
    expect(res.body).not.toHaveProperty('password_hash');
  });
});

describe('PUT /api/users/:id (update user)', () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 for an invalid role', async () => {
    const res = await request(app)
      .put('/api/users/1')
      .send({ username: 'u', role: 'hacker', active: true });
    expect(res.status).toBe(400);
  });

  it('returns 404 when user is not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .put('/api/users/999')
      .send({ username: 'u', role: 'user', active: true });
    expect(res.status).toBe(404);
  });

  it('returns 409 when new username is already taken', async () => {
    const err = new Error('duplicate');
    err.code = '23505';
    mockQuery.mockRejectedValueOnce(err);
    const res = await request(app)
      .put('/api/users/1')
      .send({ username: 'admin', role: 'user', active: true });
    expect(res.status).toBe(409);
  });

  it('returns 200 with updated user on success', async () => {
    const updated = { id: 1, username: 'renamed', email: null, role: 'bearbeiter', active: true, created_at: new Date().toISOString(), last_login: null };
    mockQuery.mockResolvedValueOnce({ rows: [updated] });
    const res = await request(app)
      .put('/api/users/1')
      .send({ username: 'renamed', role: 'bearbeiter', active: true });
    expect(res.status).toBe(200);
    expect(res.body.username).toBe('renamed');
  });
});

describe('GET /api/users/:id', () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 404 when user does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/api/users/9999');
    expect(res.status).toBe(404);
  });

  it('returns the user without password_hash', async () => {
    const user = { id: 1, username: 'admin', email: null, role: 'admin', active: true, must_change_password: false, created_at: new Date().toISOString(), last_login: null };
    mockQuery.mockResolvedValueOnce({ rows: [user] });
    const res = await request(app).get('/api/users/1');
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('password_hash');
    expect(res.body.username).toBe('admin');
  });
});
