'use strict';

/**
 * Tests für backend/src/utils/authCookie.js und die Cookie-Authentifizierung
 * in backend/src/middleware/auth.js (Issue #132).
 *
 * Die Cookie-Attribute sind sicherheitsrelevant und gleichzeitig leicht
 * kaputtzumachen: fehlt httpOnly, kann ein XSS das Token wieder auslesen;
 * steht secure fälschlich auf true, verwirft der Browser das Cookie über
 * HTTP und niemand kommt mehr in die Anwendung.
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

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

const { AUTH_COOKIE_NAME, setAuthCookie, clearAuthCookie } = require('../src/utils/authCookie');
const { authenticate } = require('../src/middleware/auth');

function buildApp() {
  const app = express();
  app.use(cookieParser());
  app.post('/setzen', (req, res) => {
    setAuthCookie(res, 'test-token');
    res.json({ ok: true });
  });
  app.post('/loeschen', (req, res) => {
    clearAuthCookie(res);
    res.json({ ok: true });
  });
  app.get('/geschuetzt', authenticate, (req, res) => res.json({ user: req.user }));
  return app;
}

function gueltigesToken() {
  return jwt.sign({ id: 1, username: 'admin', role: 'admin' }, 'test-secret-do-not-use-in-prod', {
    expiresIn: '1h',
  });
}

describe('Auth-Cookie-Attribute', () => {
  let setCookie;

  beforeAll(async () => {
    delete process.env.COOKIE_SECURE;
    const res = await request(buildApp()).post('/setzen');
    setCookie = res.headers['set-cookie'][0];
  });

  it('setzt das Cookie unter dem erwarteten Namen', () => {
    expect(setCookie).toMatch(new RegExp(`^${AUTH_COOKIE_NAME}=`));
  });

  it('markiert es als HttpOnly – JavaScript kommt nicht daran', () => {
    expect(setCookie).toMatch(/HttpOnly/i);
  });

  it('setzt SameSite=Lax als CSRF-Grundschutz', () => {
    expect(setCookie).toMatch(/SameSite=Lax/i);
  });

  it('gilt für die gesamte Anwendung', () => {
    expect(setCookie).toMatch(/Path=\//);
  });

  it('läuft nach 8 Stunden ab – passend zur JWT-Laufzeit', () => {
    expect(setCookie).toMatch(/Max-Age=28800/);
  });

  it('setzt Secure nicht, solange COOKIE_SECURE nicht aktiv ist (Deployment ohne TLS)', () => {
    expect(setCookie).not.toMatch(/Secure/);
  });
});

describe('Auth-Cookie mit COOKIE_SECURE=true', () => {
  it('setzt Secure, sobald die Umgebungsvariable gesetzt ist', async () => {
    process.env.COOKIE_SECURE = 'true';
    const res = await request(buildApp()).post('/setzen');
    delete process.env.COOKIE_SECURE;
    expect(res.headers['set-cookie'][0]).toMatch(/Secure/);
  });
});

describe('clearAuthCookie', () => {
  it('löscht das Cookie mit passenden Attributen', async () => {
    const res = await request(buildApp()).post('/loeschen');
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toMatch(new RegExp(`^${AUTH_COOKIE_NAME}=;`));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\//);
  });
});

describe('authenticate – Token-Quellen', () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  it('akzeptiert das JWT aus dem Cookie', async () => {
    const res = await request(app)
      .get('/geschuetzt')
      .set('Cookie', [`${AUTH_COOKIE_NAME}=${gueltigesToken()}`]);
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('admin');
  });

  it('akzeptiert weiterhin den Bearer-Header (Skripte, E2E-Tests)', async () => {
    const res = await request(app)
      .get('/geschuetzt')
      .set('Authorization', `Bearer ${gueltigesToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('admin');
  });

  it('bevorzugt das Cookie vor dem Header', async () => {
    const cookieToken = jwt.sign(
      { id: 2, username: 'aus-cookie', role: 'user' },
      'test-secret-do-not-use-in-prod',
      { expiresIn: '1h' },
    );
    const res = await request(app)
      .get('/geschuetzt')
      .set('Cookie', [`${AUTH_COOKIE_NAME}=${cookieToken}`])
      .set('Authorization', `Bearer ${gueltigesToken()}`);
    expect(res.body.user.username).toBe('aus-cookie');
  });

  it('lehnt einen Request ohne Cookie und ohne Header ab', async () => {
    const res = await request(app).get('/geschuetzt');
    expect(res.status).toBe(401);
  });

  it('lehnt ein ungültiges Cookie-Token ab', async () => {
    const res = await request(app)
      .get('/geschuetzt')
      .set('Cookie', [`${AUTH_COOKIE_NAME}=kein-jwt`]);
    expect(res.status).toBe(401);
  });

  it('lehnt ein abgelaufenes Token ab', async () => {
    const abgelaufen = jwt.sign(
      { id: 1, username: 'admin', role: 'admin' },
      'test-secret-do-not-use-in-prod',
      { expiresIn: '-1s' },
    );
    const res = await request(app)
      .get('/geschuetzt')
      .set('Cookie', [`${AUTH_COOKIE_NAME}=${abgelaufen}`]);
    expect(res.status).toBe(401);
  });
});
