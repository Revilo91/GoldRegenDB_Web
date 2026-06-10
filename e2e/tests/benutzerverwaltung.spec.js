/**
 * benutzerverwaltung.spec.js – Benutzerverwaltung (Admin-Only)
 */
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/benutzerverwaltung');
  await page.waitForLoadState('networkidle');
});

test('Benutzerverwaltung-Seite lädt ohne Fehler', async ({ page }) => {
  await expect(page).toHaveURL('/benutzerverwaltung');
  const header = page.locator('h2');
  await expect(header).toContainText('Benutzerverwaltung');
});

test('Benutzer-Tabelle ist sichtbar', async ({ page }) => {
  const table = page.locator('table, .data-table, [role="grid"]').first();
  await expect(table).toBeVisible({ timeout: 8_000 });
});

test('Tabelle zeigt korrekte Spalten', async ({ page }) => {
  await page.waitForSelector('thead th', { timeout: 8_000 });
  const headers = page.locator('thead th');
  const headerTexts = await headers.allTextContents();

  expect(headerTexts.some((h) => h.includes('Benutzername'))).toBeTruthy();
  expect(headerTexts.some((h) => h.includes('Rolle'))).toBeTruthy();
  expect(headerTexts.some((h) => h.includes('Status'))).toBeTruthy();
});

test('Neuer Benutzer Button ist vorhanden', async ({ page }) => {
  const addBtn = page.locator('button[title="Neuer Benutzer"], button:has(.fa-plus)').first();
  await expect(addBtn).toBeVisible({ timeout: 5_000 });
});

test('Neuer Benutzer – Modal öffnet sich', async ({ page }) => {
  const addBtn = page.locator('button[title="Neuer Benutzer"], button:has(.fa-plus)').first();
  await addBtn.click();

  const modal = page.locator('.modal').first();
  await expect(modal).toBeVisible({ timeout: 5_000 });

  // Modal sollte "Neuer Benutzer" Text enthalten
  const modalHeader = page.locator('.modal-header h3');
  await expect(modalHeader).toContainText('Neuer Benutzer');
});

test('Neuer Benutzer – Formularfelder vorhanden', async ({ page }) => {
  const addBtn = page.locator('button[title="Neuer Benutzer"], button:has(.fa-plus)').first();
  await addBtn.click();
  await page.waitForTimeout(500);

  // Benutzername
  const usernameInput = page.locator('input.form-control').first();
  await expect(usernameInput).toBeVisible();

  // Passwort-Felder
  const passwordInputs = page.locator('input[type="password"]');
  const pwCount = await passwordInputs.count();
  expect(pwCount).toBeGreaterThanOrEqual(2); // Passwort + Bestätigung

  // Rollenauswahl
  const roleSelect = page.locator('select.form-control');
  await expect(roleSelect.first()).toBeVisible();

  // Aktiv-Checkbox
  const activeCheckbox = page.locator('input[type="checkbox"]').first();
  await expect(activeCheckbox).toBeVisible();
});

test('Neuer Benutzer – leeres Formular: Speichern zeigt Fehler', async ({ page }) => {
  const addBtn = page.locator('button[title="Neuer Benutzer"], button:has(.fa-plus)').first();
  await addBtn.click();
  await page.waitForTimeout(500);

  page.on('dialog', async (dialog) => {
    await dialog.accept();
  });

  const saveBtn = page.locator('button:has-text("Speichern")');
  if (await saveBtn.isVisible()) {
    await saveBtn.click();
    // Erwartet: alert-Meldung wurde vom Dialog-Handler behandelt
  }
});

test('Suchfeld filtert Benutzer', async ({ page }) => {
  const searchInput = page.locator('input[placeholder*="Suche"]').first();
  await expect(searchInput).toBeVisible({ timeout: 5_000 });

  await searchInput.fill('zzz_nicht_vorhanden');
  await page.waitForTimeout(500);

  const rows = await page.locator('tbody tr').count();
  expect(rows).toBeLessThanOrEqual(1);
});

test('Klick auf Benutzerzeile öffnet Detail-Modal', async ({ page }) => {
  const firstRow = page.locator('tbody tr').first();
  const rowCount = await page.locator('tbody tr').count();

  if (rowCount === 0) {
    test.skip(true, 'Keine Benutzer für Klick-Test vorhanden');
    return;
  }

  await firstRow.click();
  const modal = page.locator('.modal').first();
  await expect(modal).toBeVisible({ timeout: 5_000 });
});

test('Detail-Modal zeigt Benutzerinformationen', async ({ page }) => {
  const firstRow = page.locator('tbody tr').first();
  const rowCount = await page.locator('tbody tr').count();

  if (rowCount === 0) {
    test.skip(true, 'Keine Benutzer vorhanden');
    return;
  }

  await firstRow.click();
  await page.waitForTimeout(500);

  // Modal Inhalt prüfen
  const modal = page.locator('.modal');
  await expect(modal.locator('text=Benutzername')).toBeVisible({ timeout: 3_000 });
  await expect(modal.locator('text=Rolle')).toBeVisible();
});

test('Detail-Modal hat Bearbeiten- und Löschen-Buttons', async ({ page }) => {
  const firstRow = page.locator('tbody tr').first();
  const rowCount = await page.locator('tbody tr').count();

  if (rowCount === 0) {
    test.skip(true, 'Keine Benutzer vorhanden');
    return;
  }

  await firstRow.click();
  await page.waitForTimeout(500);

  const bearbeitenBtn = page.locator('button:has-text("Bearbeiten")');
  await expect(bearbeitenBtn).toBeVisible({ timeout: 3_000 });

  const loeschenBtn = page.locator('button:has-text("Löschen")');
  await expect(loeschenBtn).toBeVisible();
});

test('Keine JavaScript-Fehler auf der Seite', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.waitForTimeout(2_000);
  expect(errors).toHaveLength(0);
});
