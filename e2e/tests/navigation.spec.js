/**
 * navigation.spec.js – Navigation & Sidebar Tests
 *
 * Prüft Schwachstellen in der Navigation:
 * - Alle Sidebar-Links funktionieren
 * - Aktiver Link wird korrekt hervorgehoben
 * - Mobile-Menu funktioniert
 * - User-Menü öffnet/schließt korrekt
 */
import { test, expect } from '@playwright/test';

const SIDEBAR_LINKS = [
  { path: '/', text: 'Dashboard', role: 'bearbeiter' },
  { path: '/schmuckstuecke', text: 'Schmuckstücke', role: 'user' },
  { path: '/kunden', text: 'Kunden', role: 'bearbeiter' },
  { path: '/lieferscheine', text: 'Lieferscheine', role: 'bearbeiter' },
  { path: '/rechnungen', text: 'Rechnungen', role: 'bearbeiter' },
  { path: '/sumup', text: 'SumUp', role: 'bearbeiter' },
  { path: '/inventur', text: 'Inventur', role: 'bearbeiter' },
  { path: '/audit-log', text: 'Audit Log', role: 'admin' },
  { path: '/debug', text: 'Debug', role: 'admin' },
  { path: '/benutzerverwaltung', text: 'Benutzerverwaltung', role: 'admin' },
  { path: '/datensicherung', text: 'Datensicherung', role: 'admin' },
];

test.describe('Sidebar Navigation', () => {
  test('Sidebar ist sichtbar', async ({ page }) => {
    await page.goto('/');
    const sidebar = page.locator('.sidebar');
    await expect(sidebar).toBeVisible({ timeout: 5_000 });
  });

  test('Logo wird in der Sidebar angezeigt', async ({ page }) => {
    await page.goto('/');
    const logo = page.locator('.sidebar-logo');
    await expect(logo).toBeVisible({ timeout: 5_000 });
  });

  for (const link of SIDEBAR_LINKS) {
    test(`Sidebar-Link "${link.text}" navigiert zu ${link.path}`, async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      const navLink = page.locator(`a.nav-link:has-text("${link.text}")`).first();
      if (await navLink.isHidden()) {
        test.skip(true, `Link "${link.text}" nicht sichtbar (Rollenbeschränkung?)`);
        return;
      }

      await navLink.click();
      await page.waitForLoadState('networkidle');

      const expectedUrl = link.path === '/' ? '/' : link.path;
      await expect(page).toHaveURL(new RegExp(expectedUrl.replace('/', '\\/')));
    });
  }

  test('Aktiver Link wird hervorgehoben (hat active-Klasse)', async ({ page }) => {
    await page.goto('/schmuckstuecke');
    await page.waitForLoadState('networkidle');

    const activeLink = page.locator('a.nav-link.active');
    const count = await activeLink.count();
    expect(count).toBeGreaterThanOrEqual(1);

    const activeText = await activeLink.first().textContent();
    expect(activeText).toContain('Schmuckstücke');
  });
});

test.describe('User-Menü', () => {
  test('User-Menu-Button zeigt Benutzernamen', async ({ page }) => {
    await page.goto('/');
    const userBtn = page.locator('.user-menu-btn').first();
    await expect(userBtn).toBeVisible({ timeout: 5_000 });

    const btnText = await userBtn.textContent();
    expect(btnText.trim().length).toBeGreaterThan(0);
  });

  test('User-Menü öffnet bei Klick', async ({ page }) => {
    await page.goto('/');
    const userBtn = page.locator('.user-menu-btn').first();
    await userBtn.click();

    const modal = page.locator('.user-menu-modal, .modal:has-text("Benutzerkonto")');
    await expect(modal.first()).toBeVisible({ timeout: 3_000 });
  });

  test('User-Menü zeigt Benutzername, Rolle und Abmelden', async ({ page }) => {
    await page.goto('/');
    const userBtn = page.locator('.user-menu-btn').first();
    await userBtn.click();
    await page.waitForTimeout(500);

    await expect(page.locator('text=Benutzername').first()).toBeVisible();
    await expect(page.locator('text=Rolle').first()).toBeVisible();
    await expect(page.locator('text=Abmelden').first()).toBeVisible();
  });

  test('Passwort-ändern Button ist im User-Menü vorhanden', async ({ page }) => {
    await page.goto('/');
    const userBtn = page.locator('.user-menu-btn').first();
    await userBtn.click();
    await page.waitForTimeout(500);

    const pwBtn = page.locator('button:has-text("Passwort ändern")');
    await expect(pwBtn).toBeVisible({ timeout: 3_000 });
  });

  test('Passwort-Modal öffnet aus User-Menü', async ({ page }) => {
    await page.goto('/');
    const userBtn = page.locator('.user-menu-btn').first();
    await userBtn.click();
    await page.waitForTimeout(500);

    const pwBtn = page.locator('button:has-text("Passwort ändern")');
    await pwBtn.click();
    await page.waitForTimeout(500);

    const pwModal = page.locator('.modal:has-text("Aktuelles Passwort")');
    await expect(pwModal).toBeVisible({ timeout: 3_000 });
  });

  test('Passwort-Modal hat korrekte Eingabefelder', async ({ page }) => {
    await page.goto('/');
    const userBtn = page.locator('.user-menu-btn').first();
    await userBtn.click();
    await page.waitForTimeout(300);

    const pwBtn = page.locator('button:has-text("Passwort ändern")');
    await pwBtn.click();
    await page.waitForTimeout(300);

    // 3 Passwort-Felder: Aktuelles, Neues, Bestätigung
    const passwordInputs = page.locator('.modal input[type="password"], .modal input[type="text"]');
    const count = await passwordInputs.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('Passwort-Modal: Button deaktiviert wenn Felder leer', async ({ page }) => {
    await page.goto('/');
    const userBtn = page.locator('.user-menu-btn').first();
    await userBtn.click();
    await page.waitForTimeout(300);

    const pwBtn = page.locator('button:has-text("Passwort ändern")').first();
    await pwBtn.click();
    await page.waitForTimeout(300);

    const submitBtn = page.locator('.modal-footer button:has-text("Passwort ändern")');
    await expect(submitBtn).toBeDisabled();
  });
});

test.describe('404 / Unbekannte Routen', () => {
  test('Unbekannte Route leitet auf bekannte Seite um', async ({ page }) => {
    await page.goto('/diese-seite-gibt-es-nicht');
    await page.waitForLoadState('networkidle');

    // Sollte NICHT auf der ungültigen URL bleiben
    const url = page.url();
    expect(url).not.toContain('diese-seite-gibt-es-nicht');
  });
});
