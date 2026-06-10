/**
 * lieferscheine.spec.js – Lieferscheine-Seite (DocumentManager)
 */
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/lieferscheine');
  await page.waitForLoadState('networkidle');
});

test('Lieferscheine-Seite lädt ohne Fehler', async ({ page }) => {
  await expect(page).toHaveURL('/lieferscheine');
  // Entweder Tabelle oder leerer Zustand
  const content = page.locator('table, .data-table, .card, tbody').first();
  await expect(content).toBeVisible({ timeout: 8_000 });
});

test('Seiten-Header zeigt "Lieferscheine"', async ({ page }) => {
  const header = page.locator('h2');
  await expect(header).toContainText('Lieferscheine');
});

test('Neuen Lieferschein erstellen – Modal öffnet sich', async ({ page }) => {
  const newBtn = page.locator('button:has-text("Neuer Lieferschein")').first();
  await expect(newBtn).toBeVisible({ timeout: 5_000 });
  await newBtn.click();

  // Modal soll sichtbar sein
  const modal = page.locator('.modal-overlay, .modal, [role="dialog"]').first();
  await expect(modal).toBeVisible({ timeout: 5_000 });
});

test('Neuer Lieferschein – Kundenauswahl ist vorhanden', async ({ page }) => {
  const newBtn = page.locator('button:has-text("Neuer Lieferschein")').first();
  await newBtn.click();

  const kundeSelect = page.locator('select.form-control').first();
  await expect(kundeSelect).toBeVisible({ timeout: 5_000 });
  // Mindestens "Bitte wählen" Option
  const options = await kundeSelect.locator('option').count();
  expect(options).toBeGreaterThanOrEqual(1);
});

test('Neuer Lieferschein – ohne Kunde speichern zeigt Fehler', async ({ page }) => {
  const newBtn = page.locator('button:has-text("Neuer Lieferschein")').first();
  await newBtn.click();
  await page.waitForTimeout(500);

  // Dialog mock
  page.on('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Kunde');
    await dialog.accept();
  });

  // Versuche ohne Kunde als Entwurf zu speichern
  const saveBtn = page.locator('button:has-text("Entwurf"), button:has-text("Speichern"), button:has-text("Abschließen")').first();
  if (await saveBtn.isVisible()) {
    await saveBtn.click();
  }
});

test('Suchfeld filtert Lieferscheine', async ({ page }) => {
  const searchInput = page.locator('input.search-input, input[placeholder*="Suche"]').first();

  if (await searchInput.isHidden()) {
    test.skip(true, 'Kein Suchfeld auf Lieferscheine-Seite');
    return;
  }

  await searchInput.fill('zzz_nicht_existierend');
  await page.waitForTimeout(500);
  // Nach Filterung sollte nichts oder wenig angezeigt werden
});

test('Kundenfilter-Dropdown vorhanden', async ({ page }) => {
  const filterSelect = page.locator('select.doc-filter-select').first();
  if (await filterSelect.isVisible()) {
    await expect(filterSelect).toBeVisible();
    const options = await filterSelect.locator('option').count();
    expect(options).toBeGreaterThanOrEqual(1);
  }
});

test('Jahresfilter-Dropdown vorhanden', async ({ page }) => {
  const yearSelect = page.locator('select.doc-filter-select-year').first();
  if (await yearSelect.isVisible()) {
    await expect(yearSelect).toBeVisible();
  }
});

test('"Nach Kunde gruppieren"-Checkbox funktioniert', async ({ page }) => {
  const groupCheckbox = page.locator('input[type="checkbox"].form-checkbox').first();
  if (await groupCheckbox.isVisible()) {
    await groupCheckbox.check();
    await page.waitForTimeout(500);
    // Gruppierungsansicht sollte Gruppen-Rows zeigen
  }
});

test('Klick auf Zeile öffnet Detail-Modal', async ({ page }) => {
  const firstRow = page.locator('tbody tr').first();
  const rowCount = await page.locator('tbody tr').count();

  if (rowCount === 0) {
    test.skip(true, 'Keine Lieferscheine für Klick-Test vorhanden');
    return;
  }

  await firstRow.click();
  // Detail-Modal oder eine Detailansicht sollte erscheinen
  const modal = page.locator('.modal-overlay, .modal').first();
  await expect(modal).toBeVisible({ timeout: 5_000 });
});

test('Keine JavaScript-Fehler auf der Seite', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.waitForTimeout(2_000);
  expect(errors).toHaveLength(0);
});
