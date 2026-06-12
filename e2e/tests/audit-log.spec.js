/**
 * audit-log.spec.js – Audit Log Seite (Admin-Only)
 */
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // await page.goto('/login');
  // await page.fill('#username', process.env.TEST_USERNAME || 'admin');
  // await page.fill('#password', process.env.TEST_PASSWORD || 'admin');
  // await page.click('button[type="submit"]');
  // await page.waitForURL((url) => !url.pathname.includes('/login'), {
  //   timeout: 10_000,
  // });
  await page.goto('/audit-log');
  await page.waitForLoadState('networkidle');
});

test('Audit-Log-Seite lädt ohne Fehler', async ({ page }) => {
  await expect(page).toHaveURL('/audit-log');
  const header = page.locator('h2');
  await expect(header).toContainText('Audit Log');
});

test('Audit-Log zeigt Eintrags-Zähler', async ({ page }) => {
  const counter = page.locator('p:has-text("Einträge")');
  await expect(counter).toBeVisible({ timeout: 5_000 });
});

test('Tabelle oder Lade-Indikator ist sichtbar', async ({ page }) => {
  const tableOrLoader = page.locator('table, .data-table, .loading, .spinner').first();
  await expect(tableOrLoader).toBeVisible({ timeout: 8_000 });
});

test('Suchfeld ist vorhanden', async ({ page }) => {
  const searchInput = page.locator('input[placeholder*="Suche"]').first();
  await expect(searchInput).toBeVisible({ timeout: 5_000 });
});

test('Suchfeld filtert Einträge', async ({ page }) => {
  const searchInput = page.locator('input[placeholder*="Suche"]').first();
  await expect(searchInput).toBeVisible({ timeout: 5_000 });
  await searchInput.fill('zzz_nicht_existierend');
  await page.waitForTimeout(1_000);

  // Entweder weniger Zeilen oder "keine Ergebnisse"-Hinweis
  const rows = await page.locator('tbody tr').count();
  expect(rows).toBeLessThanOrEqual(1);
});

test('Tabelle zeigt korrekte Spaltenköpfe', async ({ page }) => {
  // Warte bis die Tabelle geladen ist
  await page.waitForSelector('thead th, [role="columnheader"]', { timeout: 8_000 });
  const headers = page.locator('thead th');
  const headerTexts = await headers.allTextContents();

  // Mindestens einige der erwarteten Spalten
  const expectedColumns = ['ID', 'Artikel', 'Spalte', 'Aktion', 'Zeitpunkt'];
  for (const col of expectedColumns) {
    const found = headerTexts.some((h) => h.includes(col));
    expect(found, `Spalte "${col}" nicht gefunden in: ${headerTexts.join(', ')}`).toBeTruthy();
  }
});

test('Pagination funktioniert bei vielen Einträgen', async ({ page }) => {
  const pagination = page.locator('.pagination');
  if (await pagination.isVisible()) {
    const pageInfo = page.locator('.page-info');
    await expect(pageInfo).toBeVisible();
    await expect(pageInfo).toContainText('Seite');

    // Weiter-Button testen
    const weiterBtn = page.locator('button:has-text("Weiter")');
    if (await weiterBtn.isEnabled()) {
      await weiterBtn.click();
      await page.waitForTimeout(500);
      await expect(pageInfo).toContainText('2');
    }
  }
});

test('Keine JavaScript-Fehler auf der Seite', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.waitForTimeout(2_000);
  expect(errors).toHaveLength(0);
});
