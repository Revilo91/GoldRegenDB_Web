/**
 * kunden.spec.js – Kundenverwaltung
 */
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/kunden');
  await page.waitForLoadState('networkidle');
});

test('Kunden-Seite lädt ohne Fehler', async ({ page }) => {
  await expect(page).toHaveURL('/kunden');
  // Entweder Tabelle oder "Keine Kunden"-Hinweis
  const content = page.locator('table, .data-table, .empty-state, tbody').first();
  await expect(content).toBeVisible({ timeout: 8_000 });
});

test('Kunden-Tabelle zeigt Spaltenköpfe', async ({ page }) => {
  const headers = page.locator('thead th, [role="columnheader"]');
  await expect(headers.first()).toBeVisible({ timeout: 5_000 });
  const count = await headers.count();
  expect(count).toBeGreaterThan(0);
});

test('Suchfeld filtert Kunden', async ({ page }) => {
  const searchInput = page.locator('input[placeholder*="Suche"], input[type="search"]').first();

  if (await searchInput.isHidden()) {
    test.skip(true, 'Kein Suchfeld auf Kunden-Seite');
    return;
  }

  await searchInput.fill('zzz_kein_ergebnis');
  await page.waitForTimeout(500);

  const rows = await page.locator('tbody tr').count();
  expect(rows).toBeLessThanOrEqual(1); // 0 oder "keine Einträge"-Zeile
});
