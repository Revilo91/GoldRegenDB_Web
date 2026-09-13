'use strict';

/**
 * Tests für backend/src/middleware/cors.js
 *
 * Vorher war CORS unkonfiguriert (`app.use(cors())`) und damit für jede
 * beliebige Website geöffnet. Diese Tests sichern ab, dass fremde Origins
 * keinen Access-Control-Allow-Origin-Header erhalten – und dass die
 * legitimen Fälle (same-origin, Dev-Server) weiterhin funktionieren.
 */

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const request = require('supertest');
const express = require('express');

// Middleware liest ALLOWED_ORIGINS beim Laden – Modul-Cache pro Konfiguration leeren
function loadCors(allowedOrigins) {
  jest.resetModules();
  if (allowedOrigins === undefined) {
    delete process.env.ALLOWED_ORIGINS;
  } else {
    process.env.ALLOWED_ORIGINS = allowedOrigins;
  }
  return require('../src/middleware/cors');
}

function buildApp(corsMiddleware) {
  const app = express();
  app.use(corsMiddleware);
  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.post('/api/kunden', (req, res) => res.json({ ok: true }));
  return app;
}

describe('CORS-Middleware mit gesetzter ALLOWED_ORIGINS', () => {
  let app;

  beforeAll(() => {
    app = buildApp(loadCors('https://schmuck.example.com,http://localhost:5173'));
  });

  it('erlaubt eine konfigurierte Origin', async () => {
    const res = await request(app)
      .get('/api/health')
      .set('Origin', 'https://schmuck.example.com');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://schmuck.example.com');
  });

  it('sendet keinen Allow-Origin-Header für eine fremde Origin', async () => {
    const res = await request(app)
      .get('/api/health')
      .set('Origin', 'https://evil.example.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('lehnt den Preflight einer fremden Origin ab', async () => {
    const res = await request(app)
      .options('/api/kunden')
      .set('Origin', 'https://evil.example.com')
      .set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('lässt Requests ohne Origin-Header durch (same-origin, curl, Healthcheck)', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
  });

  it('erlaubt Credentials für konfigurierte Origins', async () => {
    const res = await request(app)
      .get('/api/health')
      .set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('gibt Content-Disposition und X-Upload-File-Count für Downloads frei', async () => {
    const res = await request(app)
      .get('/api/health')
      .set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-expose-headers']).toContain('Content-Disposition');
    expect(res.headers['access-control-expose-headers']).toContain('X-Upload-File-Count');
  });

  it('beschränkt die erlaubten Methoden im Preflight', async () => {
    const res = await request(app)
      .options('/api/kunden')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST');
    const methods = res.headers['access-control-allow-methods'];
    expect(methods).toContain('POST');
    expect(methods).not.toContain('PATCH');
  });
});

describe('CORS-Middleware ohne ALLOWED_ORIGINS', () => {
  let app;

  beforeAll(() => {
    app = buildApp(loadCors(undefined));
  });

  it('fällt auf die lokalen Dev-Origins zurück', async () => {
    const res = await request(app)
      .get('/api/health')
      .set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('erlaubt trotzdem keine beliebige Origin', async () => {
    const res = await request(app)
      .get('/api/health')
      .set('Origin', 'https://evil.example.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
