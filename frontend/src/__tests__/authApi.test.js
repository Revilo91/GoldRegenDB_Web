/**
 * Tests für die Passwort-Aufrufe in frontend/src/api.js
 *
 * Ersetzt den früheren hashPassword-Test: seit Issue #131 hasht das Frontend
 * nicht mehr vor, sondern sendet das Passwort im Klartext über TLS. Diese
 * Tests halten fest, dass genau das passiert – ein versehentlich
 * wiedereingeführtes Vorhashen würde die Anmeldung stillschweigend brechen,
 * weil das Backend den Hash dann als Passwort behandeln würde.
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

describe('Authorization-Header', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('hängt das gespeicherte Token an', async () => {
    localStorage.setItem('token', 'abc123');
    const spy = mockFetchOk({});
    await api.getKunden();

    expect(spy.mock.calls[0][1].headers.Authorization).toBe('Bearer abc123');
  });

  it('sendet ohne Token keinen Authorization-Header', async () => {
    const spy = mockFetchOk({});
    await api.getKunden();

    expect(spy.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });
});
