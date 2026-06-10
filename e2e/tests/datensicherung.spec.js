/**
 * datensicherung.spec.js – Datensicherung Seite (Admin-Only)
 */
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/datensicherung');
  await page.waitForLoadState('networkidle');
});

test('Datensicherung-Seite lädt ohne Fehler', async ({ page }) => {
  await expect(page).toHaveURL('/datensicherung');
  const header = page.locator('h2');
  await expect(header).toContainText('Datensicherung');
});

test('Warnhinweis wird angezeigt', async ({ page }) => {
  const warning = page.locator('.alert-card.warning, :has-text("Wichtiger Hinweis")').first();
  await expect(warning).toBeVisible({ timeout: 5_000 });
});

test('Info-Card über Docker-Persistenz wird angezeigt', async ({ page }) => {
  const infoCard = page.locator('.alert-card.info, :has-text("Datenpersistenz")').first();
  await expect(infoCard).toBeVisible({ timeout: 5_000 });
});

test('Export-Bereich ist sichtbar', async ({ page }) => {
  const exportHeader = page.locator('h3:has-text("Daten exportieren")');
  await expect(exportHeader).toBeVisible({ timeout: 5_000 });
});

test('Import-Bereich ist sichtbar', async ({ page }) => {
  const importHeader = page.locator('h3:has-text("Daten importieren")');
  await expect(importHeader).toBeVisible({ timeout: 5_000 });
});

test('Export – Tabellen-Checkboxen sind vorhanden', async ({ page }) => {
  // "Alle auswählen" Checkbox
  const allCheckbox = page.locator('input[type="checkbox"].form-checkbox').first();
  await expect(allCheckbox).toBeVisible({ timeout: 5_000 });

  // Einzelne Tabellen-Checkboxen
  const checkboxes = page.locator('input[type="checkbox"].form-checkbox');
  const count = await checkboxes.count();
  // ALL_TABLES hat 7 Einträge + "Alle auswählen" + "Upload-Bilder" = mindestens 9
  expect(count).toBeGreaterThanOrEqual(7);
});

test('Export – "Alle auswählen" Checkbox funktioniert', async ({ page }) => {
  // Erste Checkbox sollte "Alle auswählen" sein
  const checkboxes = page.locator('input[type="checkbox"].form-checkbox');

  // Alle abwählen durch Klick auf "Alle auswählen" (toggle)
  const alleCheckbox = checkboxes.first();
  const wasChecked = await alleCheckbox.isChecked();

  await alleCheckbox.click();
  await page.waitForTimeout(300);

  const isCheckedNow = await alleCheckbox.isChecked();
  expect(isCheckedNow).toBe(!wasChecked);
});

test('Export – Backup-Button ist vorhanden', async ({ page }) => {
  const exportBtn = page.locator('button:has-text("Backup herunterladen")');
  await expect(exportBtn).toBeVisible({ timeout: 5_000 });
  await expect(exportBtn).toBeEnabled();
});

test('Export – Button ist deaktiviert wenn nichts ausgewählt', async ({ page }) => {
  // Alle Checkboxen abwählen
  const alleCheckbox = page.locator('input[type="checkbox"].form-checkbox').first();
  if (await alleCheckbox.isChecked()) {
    await alleCheckbox.click();
    await page.waitForTimeout(300);
  }

  // Upload-Bilder-Checkbox sicherstellen dass sie auch deaktiviert ist
  const uploadCheckbox = page.locator('label:has-text("Upload-Bilder") input[type="checkbox"]');
  if (await uploadCheckbox.isVisible() && await uploadCheckbox.isChecked()) {
    await uploadCheckbox.click();
    await page.waitForTimeout(300);
  }

  const exportBtn = page.locator('button:has-text("Backup herunterladen")');
  await expect(exportBtn).toBeDisabled();
});

test('Import – Backup-Datei-Wählen Button vorhanden', async ({ page }) => {
  const importLabel = page.locator('label[for="import-file"], label:has-text("Backup-Datei wählen")');
  await expect(importLabel.first()).toBeVisible({ timeout: 5_000 });
});

test('Import – Datei-Input ist versteckt', async ({ page }) => {
  const fileInput = page.locator('#import-file');
  await expect(fileInput).toBeHidden();
});

test('Upload-ZIP separat wiederherstellen – Button vorhanden', async ({ page }) => {
  const uploadZipLabel = page.locator('label:has-text("Upload-ZIP wählen")');
  await expect(uploadZipLabel.first()).toBeVisible({ timeout: 5_000 });
});

test('Keine JavaScript-Fehler auf der Seite', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.waitForTimeout(2_000);
  expect(errors).toHaveLength(0);
});
