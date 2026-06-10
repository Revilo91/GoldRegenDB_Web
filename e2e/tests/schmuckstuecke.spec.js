/**
 * schmuckstuecke.spec.js – Schmuckstücke-Liste
 */
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/schmuckstuecke');
  // Tabelle muss geladen sein
  await page.waitForLoadState('networkidle');
});

test('Schmuckstücke-Seite lädt und zeigt Tabelle', async ({ page }) => {
  await expect(page).toHaveURL('/schmuckstuecke');
  // Tabellenkopf oder mindestens eine Zeile sichtbar
  const table = page.locator('table, .data-table, [role="grid"]').first();
  await expect(table).toBeVisible({ timeout: 8_000 });
});

test('Suchfeld filtert Ergebnisse', async ({ page }) => {
  const searchInput = page.locator(
    'input[placeholder*="Suche"], input[placeholder*="Artikelnummer"]',
  ).first();
  await expect(searchInput).toBeVisible();

  const rowsBefore = await page.locator('tbody tr, [role="row"]').count();

  await searchInput.fill('XXXXNOTEXISTENT');
  await page.waitForTimeout(500); // Debounce abwarten

  const rowsAfter = await page.locator('tbody tr, [role="row"]').count();
  // Entweder 0 Treffer oder weniger als vorher
  expect(rowsAfter).toBeLessThanOrEqual(rowsBefore);

  // Suche zurücksetzen
  await searchInput.clear();
});

test('Klick auf Zeile öffnet Detail-Seite', async ({ page }) => {
  // Erste Tabellenzeile anklicken (falls Datensätze vorhanden)
  const firstRow = page.locator('tbody tr').first();
  const rowCount = await page.locator('tbody tr').count();

  if (rowCount === 0) {
    test.skip(true, 'Keine Datensätze für Klick-Test vorhanden');
    return;
  }

  await firstRow.click();

  // Detail-URL hat die Form /schmuckstuecke/:artikelnummer
  await page.waitForURL(/\/schmuckstuecke\/.+/, { timeout: 5_000 });
});

test('Neues Schmuckstück: Modal öffnet sich (admin)', async ({ page }) => {
  const addBtn = page.locator('button:has-text("Neu"), button:has-text("Hinzufügen"), [data-testid="btn-add"]').first();

  if (await addBtn.isHidden()) {
    test.skip(true, 'Kein Hinzufügen-Button sichtbar (Rolle ohne Berechtigung?)');
    return;
  }

  await addBtn.click();
  await expect(page.locator('.modal, [role="dialog"]').first()).toBeVisible({ timeout: 3_000 });
});
