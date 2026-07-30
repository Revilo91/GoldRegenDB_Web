import { test, expect, Page } from '@playwright/test';

// Felder sind nicht per <label for> mit ihrem <input> verknüpft (wie im Rest der App),
// daher über den umschließenden .form-group-Container anhand des Label-Texts suchen.
function field(page: Page, label: string) {
  return page.locator('.modal .form-group', { hasText: label }).locator('input, textarea');
}

test.describe('Bestellübersicht', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/bestelluebersicht');
    await page.waitForLoadState('networkidle');
  });

  test('Seite lädt und zeigt Tabelle', async ({ page }) => {
    await expect(page).toHaveURL('/bestelluebersicht');
    await expect(page.locator('table, .data-table').first()).toBeVisible({ timeout: 8_000 });
  });

  test('Formular verlangt Adresse/Telefon nur bei Versandart "Lieferung" (Datenminimierung)', async ({ page }) => {
    await page.getByRole('button', { name: '+ Neue Bestellung' }).click();
    await expect(page.locator('.modal').first()).toBeVisible();

    // Default: Abholung -> keine Adressfelder sichtbar
    await expect(field(page, 'Straße')).toHaveCount(0);
    await expect(field(page, 'Telefonnummer')).toHaveCount(0);

    // Auf Lieferung umschalten -> Adressfelder erscheinen
    await page.locator('.modal select').first().selectOption('lieferung');
    await expect(field(page, 'Straße')).toBeVisible();
    await expect(field(page, 'Telefonnummer')).toBeVisible();
    await expect(field(page, 'PLZ')).toBeVisible();

    await page.locator('.modal-close').click();
  });

  test('Speichern-Button ist ohne Einwilligung deaktiviert', async ({ page }) => {
    await page.getByRole('button', { name: '+ Neue Bestellung' }).click();
    const saveBtn = page.getByRole('button', { name: 'Speichern' });
    await expect(saveBtn).toBeDisabled();

    await page.getByRole('checkbox').check();
    await expect(saveBtn).toBeEnabled();

    await page.locator('.modal-close').click();
  });

  test('Neue Bestellung mit Versandart "Abholung" kann angelegt werden (ohne Adresse)', async ({ page }) => {
    const marker = `E2E-Abholung-${Date.now()}`;

    await page.getByRole('button', { name: '+ Neue Bestellung' }).click();
    await field(page, 'Name').fill(marker);
    await field(page, 'E-Mail').fill('e2e-test@example.com');
    await field(page, 'Auftragsbeschreibung').fill('E2E-Test: Ring, Größe 52');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Speichern' }).click();

    await expect(page.locator('.modal-overlay')).toHaveCount(0, { timeout: 5_000 });

    const searchInput = page.locator('input[placeholder*="Suche"]').first();
    await searchInput.fill(marker);
    await page.waitForTimeout(400);

    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr').first()).toContainText(marker);
  });

  test('Neue Bestellung mit Versandart "Lieferung" erfordert vollständige Adresse', async ({ page }) => {
    const marker = `E2E-Lieferung-${Date.now()}`;

    await page.getByRole('button', { name: '+ Neue Bestellung' }).click();
    await page.locator('.modal select').first().selectOption('lieferung');
    await field(page, 'Name').fill(marker);
    await field(page, 'Telefonnummer').fill('0123456789');
    await field(page, 'Straße').fill('Musterstraße');
    await field(page, 'Hausnummer').fill('12');
    await field(page, 'PLZ').fill('12345');
    await field(page, 'Ort').fill('Musterstadt');
    await field(page, 'Auftragsbeschreibung').fill('E2E-Test: Halskette mit Gravur');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Speichern' }).click();

    await expect(page.locator('.modal-overlay')).toHaveCount(0, { timeout: 5_000 });

    const searchInput = page.locator('input[placeholder*="Suche"]').first();
    await searchInput.fill(marker);
    await page.waitForTimeout(400);

    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr').first()).toContainText(marker);
  });
});
