/**
 * schmuckstueck-detail.spec.js – Schmuckstück Detail-Seite
 */
import { test, expect } from '@playwright/test';

// Zuerst Artikelnummer aus der Liste holen
test('Detail-Seite lädt über Navigation von Schmuckstücke-Liste', async ({ page }) => {
  await page.goto('/schmuckstuecke');
  await page.waitForLoadState('networkidle');

  const firstRow = page.locator('tbody tr').first();
  const rowCount = await page.locator('tbody tr').count();

  if (rowCount === 0) {
    test.skip(true, 'Keine Datensätze vorhanden');
    return;
  }

  await firstRow.click();
  await page.waitForURL(/\/schmuckstuecke\/.+/, { timeout: 5_000 });

  // Detail-Seite sollte Artikelnummer im Header zeigen
  const header = page.locator('h2');
  await expect(header).toBeVisible({ timeout: 5_000 });
});

test('Detail-Seite zeigt Schmuckstück-Informationen', async ({ page }) => {
  await page.goto('/schmuckstuecke');
  await page.waitForLoadState('networkidle');

  const firstRow = page.locator('tbody tr').first();
  const rowCount = await page.locator('tbody tr').count();

  if (rowCount === 0) {
    test.skip(true, 'Keine Datensätze vorhanden');
    return;
  }

  await firstRow.click();
  await page.waitForURL(/\/schmuckstuecke\/.+/, { timeout: 5_000 });

  // Detail-Grid sollte Attribute zeigen
  const detailGrid = page.locator('.detail-grid');
  await expect(detailGrid).toBeVisible({ timeout: 5_000 });

  const detailItems = page.locator('.detail-item');
  const detailCount = await detailItems.count();
  expect(detailCount).toBeGreaterThan(0);
});

test('Detail-Seite zeigt Status-Badge (Verkauft/Lager/Ausgelagert)', async ({ page }) => {
  await page.goto('/schmuckstuecke');
  await page.waitForLoadState('networkidle');

  const firstRow = page.locator('tbody tr').first();
  const rowCount = await page.locator('tbody tr').count();

  if (rowCount === 0) {
    test.skip(true, 'Keine Datensätze vorhanden');
    return;
  }

  await firstRow.click();
  await page.waitForURL(/\/schmuckstuecke\/.+/, { timeout: 5_000 });

  // Status-Badge prüfen
  const badge = page.locator('.badge').first();
  await expect(badge).toBeVisible({ timeout: 5_000 });
});

test('Zurück-Button navigiert zur Liste zurück', async ({ page }) => {
  await page.goto('/schmuckstuecke');
  await page.waitForLoadState('networkidle');

  const firstRow = page.locator('tbody tr').first();
  const rowCount = await page.locator('tbody tr').count();

  if (rowCount === 0) {
    test.skip(true, 'Keine Datensätze vorhanden');
    return;
  }

  await firstRow.click();
  await page.waitForURL(/\/schmuckstuecke\/.+/, { timeout: 5_000 });

  const backBtn = page.locator('button[title="Zurück"], button:has(.fa-arrow-left)').first();
  await expect(backBtn).toBeVisible({ timeout: 3_000 });
  await backBtn.click();

  await page.waitForURL('/schmuckstuecke', { timeout: 5_000 });
});

test('Detail-Seite zeigt Foto-Bereich', async ({ page }) => {
  await page.goto('/schmuckstuecke');
  await page.waitForLoadState('networkidle');

  const firstRow = page.locator('tbody tr').first();
  const rowCount = await page.locator('tbody tr').count();

  if (rowCount === 0) {
    test.skip(true, 'Keine Datensätze vorhanden');
    return;
  }

  await firstRow.click();
  await page.waitForURL(/\/schmuckstuecke\/.+/, { timeout: 5_000 });

  // Foto-Bereich: entweder Bild, Placeholder oder Lade-Indikator
  const photoArea = page.locator('.card-body img, .card-body div:has-text("Kein Bild"), .card-body div:has-text("geladen")').first();
  await expect(photoArea).toBeVisible({ timeout: 8_000 });
});

test('Detail-Seite: Direktzugriff auf ungültige Artikelnummer leitet um', async ({ page }) => {
  await page.goto('/schmuckstuecke/ZZZZZ_NICHT_EXISTIEREND');
  // Sollte auf /schmuckstuecke zurückgeleitet werden (navigate replace in catch)
  await page.waitForURL('/schmuckstuecke', { timeout: 10_000 });
});

test('Keine JavaScript-Fehler auf der Detail-Seite', async ({ page }) => {
  await page.goto('/schmuckstuecke');
  await page.waitForLoadState('networkidle');

  const firstRow = page.locator('tbody tr').first();
  const rowCount = await page.locator('tbody tr').count();

  if (rowCount === 0) {
    test.skip(true, 'Keine Datensätze vorhanden');
    return;
  }

  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await firstRow.click();
  await page.waitForURL(/\/schmuckstuecke\/.+/, { timeout: 5_000 });
  await page.waitForTimeout(2_000);
  expect(errors).toHaveLength(0);
});
