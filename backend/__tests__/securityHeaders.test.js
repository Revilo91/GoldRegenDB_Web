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
const securityHeaders = require('../src/middleware/securityHeaders');

function buildApp() {
  const app = express();
  app.use(securityHeaders);
  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  return app;
}

describe('securityHeaders', () => {
  let app;
  let csp;
  let headers;

  beforeAll(async () => {
    app = buildApp();
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

  it('setzt Strict-Transport-Security', () => {
    expect(headers['strict-transport-security']).toContain('max-age=');
  });

  it('erlaubt Fotos als data:- und blob:-URL', () => {
    expect(csp).toContain("img-src 'self' data: blob:");
  });

  it('erlaubt Inline-Styles und Google Fonts', () => {
    expect(csp).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
    expect(csp).toContain('font-src');
    expect(csp).toContain('https://fonts.gstatic.com');
  });

  it('erzwingt kein Upgrade auf https (Deployment läuft ohne TLS)', () => {
    expect(csp).not.toContain('upgrade-insecure-requests');
  });

  it('erlaubt Cross-Origin-Zugriff auf Ressourcen (Vite-Dev-Server)', () => {
    expect(headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('verbietet Objekt-/Plugin-Einbettung', () => {
    expect(csp).toContain("object-src 'none'");
  });
});
