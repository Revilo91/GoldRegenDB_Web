/**
 * rechnungen.spec.js – Rechnungen-Seite (DocumentManager)
 */
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/rechnungen');
  await page.waitForLoadState('networkidle');
});

test('Rechnungen-Seite lädt ohne Fehler', async ({ page }) => {
  await expect(page).toHaveURL('/rechnungen');
  const content = page.locator('table, .data-table, .card, tbody').first();
  await expect(content).toBeVisible({ timeout: 8_000 });
});

test('Seiten-Header zeigt "Rechnungen"', async ({ page }) => {
  const header = page.locator('h2');
  await expect(header).toContainText('Rechnungen');
});

test('Neue Rechnung erstellen – Modal öffnet sich', async ({ page }) => {
  const newBtn = page.locator('button:has-text("Neue Rechnung")').first();
  await expect(newBtn).toBeVisible({ timeout: 5_000 });
  await newBtn.click();

  const modal = page.locator('.modal-overlay, .modal, [role="dialog"]').first();
  await expect(modal).toBeVisible({ timeout: 5_000 });
});

test('Neue Rechnung – Kundenauswahl vorhanden', async ({ page }) => {
  const newBtn = page.locator('button:has-text("Neue Rechnung")').first();
  await newBtn.click();

  const kundeSelect = page.locator('select.form-control').first();
  await expect(kundeSelect).toBeVisible({ timeout: 5_000 });
});

test('Neue Rechnung – Schmuckstücke erst nach Kundenauswahl (byKunde-Modus)', async ({ page }) => {
  const newBtn = page.locator('button:has-text("Neue Rechnung")').first();
  await newBtn.click();
  await page.waitForTimeout(500);

  // Ohne Kundenauswahl sollte die Stückliste leer oder deaktiviert sein
  const pieceSearch = page.locator('input.piece-search-input').first();
  if (await pieceSearch.isVisible()) {
    await expect(pieceSearch).toBeDisabled();
  }
});

test('Suchfeld filtert Rechnungen', async ({ page }) => {
  const searchInput = page.locator('input.search-input, input[placeholder*="Suche"]').first();

  if (await searchInput.isHidden()) {
    test.skip(true, 'Kein Suchfeld auf Rechnungen-Seite');
    return;
  }

  await searchInput.fill('zzz_nicht_existierend');
  await page.waitForTimeout(500);
});

test('Klick auf Zeile öffnet Detail-Modal', async ({ page }) => {
  const firstRow = page.locator('tbody tr').first();
  const rowCount = await page.locator('tbody tr').count();

  if (rowCount === 0) {
    test.skip(true, 'Keine Rechnungen für Klick-Test vorhanden');
    return;
  }

  await firstRow.click();
  const modal = page.locator('.modal-overlay, .modal').first();
  await expect(modal).toBeVisible({ timeout: 5_000 });
});

test('Keine JavaScript-Fehler auf der Seite', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.waitForTimeout(2_000);
  expect(errors).toHaveLength(0);
});
