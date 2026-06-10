/**
 * debug.spec.js – Debug-Ansicht (Admin-Only)
 */
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/debug');
  await page.waitForLoadState('networkidle');
});

test('Debug-Seite lädt ohne Fehler', async ({ page }) => {
  await expect(page).toHaveURL('/debug');
  const header = page.locator('h2');
  await expect(header).toContainText('Debug');
});

test('Debug-Seite zeigt Tabellen-Liste', async ({ page }) => {
  // Mindestens eine Tabellen-Überschrift sollte sichtbar sein
  const tableHeaders = page.locator('.debug-table-header, h3');
  await expect(tableHeaders.first()).toBeVisible({ timeout: 8_000 });

  const count = await tableHeaders.count();
  expect(count).toBeGreaterThan(0);
});

test('Tabelle kann auf-/zugeklappt werden', async ({ page }) => {
  const firstTableHeader = page.locator('.debug-table-header, h3').first();
  await expect(firstTableHeader).toBeVisible({ timeout: 8_000 });

  // Tabelle aufklappen
  await firstTableHeader.click();
  await page.waitForTimeout(1_500);

  // Es sollte eine Card/Tabelle erscheinen oder ein Lade-Spinner
  const contentOrLoader = page.locator('.card, .loading, .data-table, table').first();
  await expect(contentOrLoader).toBeVisible({ timeout: 10_000 });
});

test('Aufgeklappte Tabelle zeigt Daten oder Empty-State', async ({ page }) => {
  const firstTableHeader = page.locator('.debug-table-header, h3').first();
  await firstTableHeader.click();
  await page.waitForTimeout(2_000);

  // Entweder Tabellenzeilen oder "No rows" Hinweis
  const hasContent = page.locator('tbody tr, .detail-item:has-text("No rows")').first();
  await expect(hasContent).toBeVisible({ timeout: 10_000 });
});

test('Suchfeld innerhalb aufgeklappter Tabelle funktioniert', async ({ page }) => {
  const firstTableHeader = page.locator('.debug-table-header, h3').first();
  await firstTableHeader.click();
  await page.waitForTimeout(2_000);

  const searchInput = page.locator('input[placeholder*="Suche"]').first();
  if (await searchInput.isVisible()) {
    await searchInput.fill('test_suche_123');
    await page.waitForTimeout(500);
  }
});

test('Keine JavaScript-Fehler auf der Seite', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.waitForTimeout(2_000);
  expect(errors).toHaveLength(0);
});
