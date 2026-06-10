/**
 * auth.spec.js – Login / Logout UI-Tests
 *
 * Läuft OHNE gespeicherten Auth-State (storageState wird geleert).
 */
import { test, expect } from '@playwright/test';
import crypto from 'crypto';

// Kein gespeicherter Login-State für diese Datei
test.use({ storageState: { cookies: [], origins: [] } });

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

const USERNAME = process.env.TEST_USERNAME || 'admin';
const PASSWORD = process.env.TEST_PASSWORD || 'admin';

test.describe('Login', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('zeigt Login-Formular', async ({ page }) => {
    await expect(page.locator('#username')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('Login mit ungültigen Zugangsdaten zeigt Fehler', async ({ page }) => {
    await page.fill('#username', 'falscherBenutzer');
    await page.fill('#password', 'falschesPasswort');
    await page.click('button[type="submit"]');

    await expect(page.locator('.login-error')).toBeVisible({ timeout: 5_000 });
  });

  test('Login mit leerem Formular schlägt fehl', async ({ page }) => {
    await page.click('button[type="submit"]');
    // HTML5-Validierung verhindert Submit → Fehler-Element nicht sichtbar
    await expect(page).toHaveURL('/login');
  });

  test('Erfolgreicher Login leitet auf Dashboard weiter', async ({ page }) => {
    await page.fill('#username', USERNAME);
    await page.fill('#password', PASSWORD);
    await page.click('button[type="submit"]');

    // Entweder Dashboard (/) oder /schmuckstuecke je nach Rolle
    await page.waitForURL((url) => !url.pathname.includes('/login'), {
      timeout: 10_000,
    });

    const token = await page.evaluate(() => localStorage.getItem('token'));
    expect(token).toBeTruthy();
  });
});

test.describe('Logout', () => {
  test.beforeEach(async ({ page }) => {
    // Einloggen via API und Token setzen
    const resp = await page.request.post(
      `${process.env.API_URL || 'http://localhost:3001/api'}/auth/login`,
      { data: { username: USERNAME, password: sha256(PASSWORD) } },
    );
    const { token } = await resp.json();
    await page.addInitScript((t) => localStorage.setItem('token', t), token);
    await page.goto('/');
    await page.waitForURL((url) => !url.pathname.includes('/login'));
  });

  test('Logout entfernt Token und leitet auf /login', async ({ page }) => {
    // User-Menü öffnen (Avatar-Button oben rechts)
    await page.locator('.user-menu-btn').first().click();
    await page.locator('text=Abmelden').click();

    await page.waitForURL('/login', { timeout: 5_000 });

    const token = await page.evaluate(() => localStorage.getItem('token'));
    expect(token).toBeNull();
  });
});
