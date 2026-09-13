'use strict';

/**
 * Tests für backend/src/middleware/securityHeaders.js
 *
 * Die CSP muss zum ausgelieferten Frontend passen: fehlt eine Direktive
 * (data:-Fotos, Google Fonts, style-Props), bleibt die Anwendung im Browser
 * funktionslos – ein Fehler, der ohne Test erst in Produktion auffällt.
 */

const request = require('supertest');
const express = require('express');

// Middleware liest FORCE_HTTPS beim Laden – Modul-Cache pro Konfiguration leeren
function loadSecurityHeaders(forceHttps) {
  jest.resetModules();
  if (forceHttps === undefined) {
    delete process.env.FORCE_HTTPS;
  } else {
    process.env.FORCE_HTTPS = forceHttps;
  }
  return require('../src/middleware/securityHeaders');
}

function buildApp(securityHeaders) {
  const app = express();
  app.use(securityHeaders);
  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  return app;
}

describe('securityHeaders ohne FORCE_HTTPS (Standard, kein TLS)', () => {
  let app;
  let csp;
  let headers;

  beforeAll(async () => {
    app = buildApp(loadSecurityHeaders(undefined));
    const res = await request(app).get('/api/health');
    headers = res.headers;
    csp = res.headers['content-security-policy'];
  });

  it('setzt eine Content-Security-Policy', () => {
    expect(csp).toBeTruthy();
    expect(csp).toContain("default-src 'self'");
  });

  it('verbietet das Einbetten in fremde Frames (Clickjacking)', () => {
    expect(csp).toContain("frame-ancestors 'none'");
    expect(headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('verhindert MIME-Sniffing', () => {
    expect(headers['x-content-type-options']).toBe('nosniff');
  });

  it('setzt kein Strict-Transport-Security (kein TLS terminiert)', () => {
    expect(headers['strict-transport-security']).toBeUndefined();
  });

  it('erlaubt Fotos als data:- und blob:-URL', () => {
    expect(csp).toContain("img-src 'self' data: blob:");
  });

  it('erlaubt Inline-Styles und Google Fonts', () => {
    expect(csp).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
    expect(csp).toContain('font-src');
    expect(csp).toContain('https://fonts.gstatic.com');
  });

  it('erzwingt kein Upgrade auf https (kein Reverse Proxy mit TLS davor)', () => {
    expect(csp).not.toContain('upgrade-insecure-requests');
  });

  it('erlaubt Cross-Origin-Zugriff auf Ressourcen (Vite-Dev-Server)', () => {
    expect(headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('verbietet Objekt-/Plugin-Einbettung', () => {
    expect(csp).toContain("object-src 'none'");
  });
});

describe('securityHeaders mit FORCE_HTTPS=true (TLS terminiert ein Reverse Proxy)', () => {
  let app;
  let csp;
  let headers;

  beforeAll(async () => {
    app = buildApp(loadSecurityHeaders('true'));
    const res = await request(app).get('/api/health');
    headers = res.headers;
    csp = res.headers['content-security-policy'];
  });

  afterAll(() => {
    delete process.env.FORCE_HTTPS;
  });

  it('setzt Strict-Transport-Security', () => {
    expect(headers['strict-transport-security']).toContain('max-age=15552000');
    expect(headers['strict-transport-security']).toContain('includeSubDomains');
  });

  it('erzwingt ein Upgrade auf https', () => {
    expect(csp).toContain('upgrade-insecure-requests');
  });
});

describe('securityHeaders mit HSTS_MAX_AGE', () => {
  afterAll(() => {
    delete process.env.FORCE_HTTPS;
    delete process.env.HSTS_MAX_AGE;
  });

  it('übernimmt eine konfigurierte HSTS-Gültigkeitsdauer', async () => {
    process.env.HSTS_MAX_AGE = '3600';
    const app = buildApp(loadSecurityHeaders('true'));
    const res = await request(app).get('/api/health');
    expect(res.headers['strict-transport-security']).toContain('max-age=3600');
  });
});
