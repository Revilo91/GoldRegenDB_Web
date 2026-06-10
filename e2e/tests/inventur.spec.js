/**
 * inventur.spec.js – Inventur-Seite
 */
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/inventur');
  await page.waitForLoadState('networkidle');
});

test('Inventur-Seite lädt ohne Fehler', async ({ page }) => {
  await expect(page).toHaveURL('/inventur');
  // Sollte Inventur-Inhalte zeigen
  const content = page.locator('table, .data-table, .card, .loading, h2').first();
  await expect(content).toBeVisible({ timeout: 8_000 });
});

test('Kunden-Tabelle oder Inventur-Übersicht ist sichtbar', async ({ page }) => {
  // Inventur zeigt Kunden mit ihren Schmuckstücken
  const table = page.locator('table, .data-table, .card').first();
  await expect(table).toBeVisible({ timeout: 8_000 });
});

test('Klick auf Kunden-Zeile öffnet Detail-Modal', async ({ page }) => {
  const firstRow = page.locator('tbody tr').first();
  const rowCount = await page.locator('tbody tr').count();

  if (rowCount === 0) {
    test.skip(true, 'Keine Kunden für Klick-Test vorhanden');
    return;
  }

  await firstRow.click();
  await page.waitForTimeout(1_000);

  // Detail-Modal oder Overlay sollte erscheinen
  const modal = page.locator('.modal-overlay, .modal').first();
  await expect(modal).toBeVisible({ timeout: 5_000 });
});

test('Detail-Modal zeigt Statistik-Karten', async ({ page }) => {
  const firstRow = page.locator('tbody tr').first();
  const rowCount = await page.locator('tbody tr').count();

  if (rowCount === 0) {
    test.skip(true, 'Keine Kunden vorhanden');
    return;
  }

  await firstRow.click();
  await page.waitForTimeout(1_500);

  const statCards = page.locator('.stat-card');
  const statCount = await statCards.count();
  expect(statCount).toBeGreaterThanOrEqual(1);
});

test('Detail-Modal zeigt Tabs (Nicht verkauft, Verkauft, etc.)', async ({ page }) => {
  const firstRow = page.locator('tbody tr').first();
  const rowCount = await page.locator('tbody tr').count();

  if (rowCount === 0) {
    test.skip(true, 'Keine Kunden vorhanden');
    return;
  }

  await firstRow.click();
  await page.waitForTimeout(1_500);

  // Tab-Buttons
  const tabs = page.locator('button.btn-sm');
  const tabTexts = await tabs.allTextContents();
  expect(tabTexts.join(' ')).toContain('Nicht verkauft');
});

test('Detail-Modal – Tab-Wechsel funktioniert', async ({ page }) => {
  const firstRow = page.locator('tbody tr').first();
  const rowCount = await page.locator('tbody tr').count();

  if (rowCount === 0) {
    test.skip(true, 'Keine Kunden vorhanden');
    return;
  }

  await firstRow.click();
  await page.waitForTimeout(1_500);

  // Verkauft-Tab klicken
  const verkauftTab = page.locator('button.btn-sm:has-text("Verkauft")').first();
  if (await verkauftTab.isVisible()) {
    await verkauftTab.click();
    await page.waitForTimeout(500);
    // Tab sollte aktiv werden (btn-primary Klasse)
    await expect(verkauftTab).toHaveClass(/btn-primary/);
  }
});

test('Detail-Modal – Excel Export Button vorhanden', async ({ page }) => {
  const firstRow = page.locator('tbody tr').first();
  const rowCount = await page.locator('tbody tr').count();

  if (rowCount === 0) {
    test.skip(true, 'Keine Kunden vorhanden');
    return;
  }

  await firstRow.click();
  await page.waitForTimeout(1_500);

  const excelBtn = page.locator('button:has-text("Excel Export")');
  await expect(excelBtn).toBeVisible({ timeout: 3_000 });
});

test('Detail-Modal kann geschlossen werden', async ({ page }) => {
  const firstRow = page.locator('tbody tr').first();
  const rowCount = await page.locator('tbody tr').count();

  if (rowCount === 0) {
    test.skip(true, 'Keine Kunden vorhanden');
    return;
  }

  await firstRow.click();
  await page.waitForTimeout(1_000);

  const closeBtn = page.locator('button:has-text("Schließen"), .modal-close').first();
  await closeBtn.click();

  await page.waitForTimeout(500);
  const modal = page.locator('.modal-overlay');
  await expect(modal).toBeHidden({ timeout: 3_000 });
});

test('Keine JavaScript-Fehler auf der Seite', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.waitForTimeout(2_000);
  expect(errors).toHaveLength(0);
});
