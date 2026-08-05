'use strict';

/**
 * Tests für backend/src/middleware/csrf.js (Issue #135)
 *
 * Zwei Fehlerbilder sind hier gleichermaßen teuer:
 *  - zu lasch: eine fremde Website kann Requests im Namen des angemeldeten
 *    Benutzers auslösen
 *  - zu streng: Login, das öffentliche Bestellformular oder Skripte mit
 *    Bearer-Token werden blockiert und die Anwendung ist unbenutzbar
 */

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');

const {
  CSRF_COOKIE_NAME,
  csrfProtection,
  csrfTokenHandler,
  erzeugeToken,
} = require('../src/middleware/csrf');
const { AUTH_COOKIE_NAME } = require('../src/utils/authCookie');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.get('/api/csrf-token', csrfTokenHandler);
  app.use(csrfProtection);
  app.get('/api/kunden', (req, res) => res.json({ ok: true }));
  app.post('/api/kunden', (req, res) => res.json({ ok: true }));
  app.put('/api/kunden/1', (req, res) => res.json({ ok: true }));
  app.delete('/api/kunden/1', (req, res) => res.json({ ok: true }));
  app.post('/api/auth/login', (req, res) => res.json({ ok: true }));
  return app;
}

const TOKEN = erzeugeToken();
const SESSION = `${AUTH_COOKIE_NAME}=beliebiges-jwt`;

describe('GET /api/csrf-token', () => {
  it('gibt ein Token zurück und legt es im Cookie ab', async () => {
    const res = await request(buildApp()).get('/api/csrf-token');
    expect(res.status).toBe(200);
    expect(res.body.csrfToken).toMatch(/^[0-9a-f]{64}$/);
    expect(res.headers['set-cookie'][0]).toContain(`${CSRF_COOKIE_NAME}=${res.body.csrfToken}`);
  });

  it('setzt das Cookie bewusst NICHT httpOnly – das Frontend muss es lesen können', async () => {
    const res = await request(buildApp()).get('/api/csrf-token');
    expect(res.headers['set-cookie'][0]).not.toMatch(/HttpOnly/i);
  });

  it('behält ein bereits vorhandenes Token bei', async () => {
    const res = await request(buildApp())
      .get('/api/csrf-token')
      .set('Cookie', [`${CSRF_COOKIE_NAME}=${TOKEN}`]);
    expect(res.body.csrfToken).toBe(TOKEN);
  });
});

describe('csrfProtection – Cookie-Sitzung', () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  it('lässt einen POST mit passendem Cookie und Header durch', async () => {
    const res = await request(app)
      .post('/api/kunden')
      .set('Cookie', [SESSION, `${CSRF_COOKIE_NAME}=${TOKEN}`])
      .set('X-CSRF-Token', TOKEN);
    expect(res.status).toBe(200);
  });

  it('blockt einen POST ohne Header – der klassische CSRF-Fall', async () => {
    const res = await request(app)
      .post('/api/kunden')
      .set('Cookie', [SESSION, `${CSRF_COOKIE_NAME}=${TOKEN}`]);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF_TOKEN_INVALID');
  });

  it('blockt einen POST mit falschem Header-Token', async () => {
    const res = await request(app)
      .post('/api/kunden')
      .set('Cookie', [SESSION, `${CSRF_COOKIE_NAME}=${TOKEN}`])
      .set('X-CSRF-Token', erzeugeToken());
    expect(res.status).toBe(403);
  });

  it('blockt einen POST ohne CSRF-Cookie', async () => {
    const res = await request(app)
      .post('/api/kunden')
      .set('Cookie', [SESSION])
      .set('X-CSRF-Token', TOKEN);
    expect(res.status).toBe(403);
  });

  it('schützt auch PUT und DELETE', async () => {
    const put = await request(app).put('/api/kunden/1').set('Cookie', [SESSION]);
    const del = await request(app).delete('/api/kunden/1').set('Cookie', [SESSION]);
    expect(put.status).toBe(403);
    expect(del.status).toBe(403);
  });

  it('lässt GET unangetastet', async () => {
    const res = await request(app).get('/api/kunden').set('Cookie', [SESSION]);
    expect(res.status).toBe(200);
  });
});

describe('csrfProtection – Ausnahmen', () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  it('lässt unauthentifizierte Requests durch (Login, öffentliches Bestellformular)', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'a', password: 'b' });
    expect(res.status).toBe(200);
  });

  it('lässt Requests mit Bearer-Token durch (Skripte, E2E-Tests)', async () => {
    const res = await request(app)
      .post('/api/kunden')
      .set('Authorization', 'Bearer irgendein-jwt');
    expect(res.status).toBe(200);
  });

  it('schützt weiterhin, sobald ein Auth-Cookie mitkommt – auch mit Bearer-Header', async () => {
    const res = await request(app)
      .post('/api/kunden')
      .set('Cookie', [SESSION])
      .set('Authorization', 'Bearer irgendein-jwt');
    expect(res.status).toBe(403);
  });
});

describe('Token-Vergleich', () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  it('lehnt ein Token mit passendem Präfix, aber falscher Länge ab', async () => {
    const res = await request(app)
      .post('/api/kunden')
      .set('Cookie', [SESSION, `${CSRF_COOKIE_NAME}=${TOKEN}`])
      .set('X-CSRF-Token', TOKEN.slice(0, 32));
    expect(res.status).toBe(403);
  });

  it('lehnt ein leeres Header-Token ab', async () => {
    const res = await request(app)
      .post('/api/kunden')
      .set('Cookie', [SESSION, `${CSRF_COOKIE_NAME}=${TOKEN}`])
      .set('X-CSRF-Token', '');
    expect(res.status).toBe(403);
  });
});
