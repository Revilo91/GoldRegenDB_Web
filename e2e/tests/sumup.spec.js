/**
 * sumup.spec.js – SumUp Verwaltung Seite
 */
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/sumup');
  await page.waitForLoadState('networkidle');
});

test('SumUp-Seite lädt ohne Fehler', async ({ page }) => {
  await expect(page).toHaveURL('/sumup');
  const header = page.locator('h2');
  await expect(header).toContainText('SumUp');
});

test('Export-Bereich ist sichtbar', async ({ page }) => {
  const exportHeader = page.locator('h3:has-text("SumUp Export")');
  await expect(exportHeader).toBeVisible({ timeout: 5_000 });
});

test('Import-Bereich ist sichtbar', async ({ page }) => {
  const importHeader = page.locator('h3:has-text("Verkaufsbericht importieren")');
  await expect(importHeader).toBeVisible({ timeout: 5_000 });
});

test('CSV Download Button vorhanden und klickbar', async ({ page }) => {
  const downloadBtn = page.locator('button:has-text("CSV für SumUp herunterladen")');
  await expect(downloadBtn).toBeVisible({ timeout: 5_000 });
  await expect(downloadBtn).toBeEnabled();
});

test('CSV Import-Button (Label als Button) vorhanden', async ({ page }) => {
  const importLabel = page.locator('label[for="sumup-import-file"]');
  await expect(importLabel).toBeVisible({ timeout: 5_000 });
  await expect(importLabel).toContainText('CSV-Datei wählen');
});

test('Datei-Input ist versteckt (hidden)', async ({ page }) => {
  const fileInput = page.locator('#sumup-import-file');
  await expect(fileInput).toBeHidden();
});

test('Export-Checkliste zeigt Features an', async ({ page }) => {
  const features = page.locator('li');
  const count = await features.count();
  expect(count).toBeGreaterThanOrEqual(3);
});

test('Keine JavaScript-Fehler auf der Seite', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.waitForTimeout(2_000);
  expect(errors).toHaveLength(0);
});
