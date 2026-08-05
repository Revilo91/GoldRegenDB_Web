/**
 * Tests für die Auth-Aufrufe in frontend/src/api.js
 *
 * Zwei Regressionen sollen hier auffallen:
 *  - Vorhashen des Passworts (bis Issue #131) – das Backend würde den Hash
 *    dann als Passwort behandeln und die Anmeldung stillschweigend brechen
 *  - fehlendes credentials: 'include' (seit Issue #132) – ohne das sendet der
 *    Browser das httpOnly-Cookie nicht mit und jeder Request wäre anonym
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { authApi, api } from '../api';

function mockFetchOk(body = {}) {
  const spy = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  });
  globalThis.fetch = spy;
  return spy;
}

function bodyOf(spy) {
  return JSON.parse(spy.mock.calls[0][1].body);
}

describe('authApi', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('sendet das Login-Passwort im Klartext', async () => {
    const spy = mockFetchOk({ token: 't' });
    await authApi.login('admin', 'ein-sicheres-passwort');

    const [url, options] = spy.mock.calls[0];
    expect(url).toContain('/auth/login');
    expect(options.method).toBe('POST');
    expect(bodyOf(spy)).toEqual({ username: 'admin', password: 'ein-sicheres-passwort' });
  });

  it('sendet beim Passwortwechsel beide Passwörter im Klartext', async () => {
    const spy = mockFetchOk({ message: 'ok' });
    await authApi.changePassword('altes-passwort', 'neues-passwort');

    expect(bodyOf(spy)).toEqual({
      currentPassword: 'altes-passwort',
      newPassword: 'neues-passwort',
    });
  });

  it('hasht das Passwort nicht vor (kein 64-stelliger Hex-String)', async () => {
    const spy = mockFetchOk({ token: 't' });
    await authApi.login('admin', 'admin');

    expect(bodyOf(spy).password).not.toMatch(/^[0-9a-f]{64}$/);
  });

  it('fordert ein Reset-Token nur mit dem Benutzernamen an', async () => {
    const spy = mockFetchOk({ message: 'ok' });
    await authApi.forgotPassword('admin');

    expect(spy.mock.calls[0][0]).toContain('/auth/forgot-password');
    expect(bodyOf(spy)).toEqual({ username: 'admin' });
  });

  it('sendet Token und neues Passwort beim Zurücksetzen', async () => {
    const spy = mockFetchOk({ message: 'ok' });
    await authApi.resetPassword('a'.repeat(64), 'neues-sicheres-passwort');

    expect(spy.mock.calls[0][0]).toContain('/auth/reset-password');
    expect(bodyOf(spy)).toEqual({
      token: 'a'.repeat(64),
      newPassword: 'neues-sicheres-passwort',
    });
  });
});

describe('Benutzerverwaltung', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('legt einen Benutzer mit Klartext-Passwort an', async () => {
    const spy = mockFetchOk({ id: 1 });
    await api.createUser({ username: 'marina', password: 'ein-sicheres-passwort', role: 'bearbeiter' });

    expect(bodyOf(spy)).toEqual({
      username: 'marina',
      password: 'ein-sicheres-passwort',
      role: 'bearbeiter',
    });
  });

  it('setzt ein Passwort im Klartext zurück', async () => {
    const spy = mockFetchOk({ message: 'ok' });
    await api.resetUserPassword(7, 'neues-passwort');

    expect(spy.mock.calls[0][0]).toContain('/users/7/reset-password');
    expect(bodyOf(spy)).toEqual({ newPassword: 'neues-passwort' });
  });
});

describe('Cookie-basierte Authentifizierung', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('sendet Cookies bei jedem Request mit', async () => {
    const spy = mockFetchOk({});
    await api.getKunden();

    expect(spy.mock.calls[0][1].credentials).toBe('include');
  });

  it('setzt keinen Authorization-Header mehr', async () => {
    const spy = mockFetchOk({});
    await api.getKunden();

    expect(spy.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it('legt kein Token im localStorage ab', async () => {
    mockFetchOk({ user: { username: 'admin' } });
    await authApi.login('admin', 'ein-sicheres-passwort');

    expect(localStorage.getItem('token')).toBeNull();
  });

  it('meldet über einen eigenen Endpunkt ab – nur das Backend kann das Cookie löschen', async () => {
    const spy = mockFetchOk({ message: 'Abgemeldet' });
    await authApi.logout();

    expect(spy.mock.calls[0][0]).toContain('/auth/logout');
    expect(spy.mock.calls[0][1].method).toBe('POST');
    expect(spy.mock.calls[0][1].credentials).toBe('include');
  });
});
