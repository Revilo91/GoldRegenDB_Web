'use strict';

/**
 * Tests für backend/src/middleware/httpsRedirect.js (Issue #138).
 *
 * Die Middleware ist nur aktiv, wenn FORCE_HTTPS=true in index.js gesetzt
 * wird (nicht Teil dieser Middleware selbst) – hier wird nur ihr Verhalten
 * bei eingehängter Nutzung getestet.
 */

const request = require('supertest');
const express = require('express');
const httpsRedirect = require('../src/middleware/httpsRedirect');

function buildApp() {
  const app = express();
  app.use(httpsRedirect);
  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  return app;
}

describe('httpsRedirect', () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  it('leitet http über den Proxy (X-Forwarded-Proto: http) auf https um', async () => {
    const res = await request(app)
      .get('/api/health')
      .set('X-Forwarded-Proto', 'http')
      .set('Host', 'schmuck.example.com');
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('https://schmuck.example.com/api/health');
  });

  it('lässt https (X-Forwarded-Proto: https) unverändert durch', async () => {
    const res = await request(app)
      .get('/api/health')
      .set('X-Forwarded-Proto', 'https');
    expect(res.status).toBe(200);
  });

  it('leitet nicht um, wenn der Header fehlt (z. B. Docker-Healthcheck ohne Proxy)', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
  });

  it('behält Pfad und Query-String beim Redirect bei', async () => {
    const res = await request(app)
      .get('/api/health?foo=bar')
      .set('X-Forwarded-Proto', 'http')
      .set('Host', 'schmuck.example.com');
    expect(res.headers.location).toBe('https://schmuck.example.com/api/health?foo=bar');
  });
});
