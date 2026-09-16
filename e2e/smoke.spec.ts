import { test, expect } from '@playwright/test';

// Kernworkflow-Smoke-Test: Login (UI) -> Schmuckstück anlegen -> Lieferschein erzeugen.
// Läuft bewusst ohne die gespeicherte Session aus auth.setup.ts, um den Login selbst zu prüfen.
test.use({ storageState: { cookies: [], origins: [] } });

const USERNAME = process.env.TEST_USERNAME || 'admin';
const PASSWORD = process.env.TEST_PASSWORD || 'admin';

test('Login -> Schmuckstück anlegen -> Lieferschein erzeugen', async ({ page }) => {
  // 1. Login
  await page.goto('/login');
  await page.locator('#username').fill(USERNAME);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL('/', { timeout: 10_000 });

  // 2. Schmuckstück anlegen
  await page.goto('/schmuckstuecke');
  await page.getByRole('button', { name: '+ Neues Schmuckstück' }).click();
  const modal = page.locator('.modal').first();
  await expect(modal).toBeVisible();

  // Hersteller/Grundmaterial/Produktart erzeugen zusammen die Artikelnummer
  const selects = modal.locator('.form-row').first().locator('select');
  await selects.nth(0).selectOption({ index: 1 });
  await selects.nth(1).selectOption({ index: 1 });
  await selects.nth(2).selectOption({ index: 1 });

  const artikelnummerPreview = modal
    .locator('.form-group', { hasText: 'Artikelnummer' })
    .locator('.form-control');
  await expect(artikelnummerPreview).not.toHaveText('---', { timeout: 8_000 });
  const artikelnummer = (await artikelnummerPreview.textContent())?.trim();
  expect(artikelnummer).toBeTruthy();

  await page.getByRole('button', { name: 'Speichern + Schließen' }).click();
  await expect(page.locator('.modal-overlay')).toHaveCount(0, { timeout: 8_000 });

  const searchInput = page.locator('input[placeholder*="Suche"]').first();
  await searchInput.fill(artikelnummer!);
  await expect(page.locator('tbody tr').first()).toContainText(artikelnummer!, { timeout: 8_000 });

  // 3. Lieferschein für das neue Schmuckstück erzeugen
  await page.goto('/lieferscheine');
  await page.getByRole('button', { name: '+ Neuer Lieferschein' }).click();
  const docModal = page.locator('.modal').first();
  await expect(docModal).toBeVisible();

  const kundeSelect = docModal.locator('.form-group', { hasText: 'Kunde' }).locator('select');
  await kundeSelect.selectOption({ index: 1 });
  const kundenName = await kundeSelect.locator('option:checked').textContent();

  await docModal.locator('input[placeholder="Artikelnummer eingeben..."]').fill(artikelnummer!);
  await docModal.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(docModal.locator('.piece-side').last()).toContainText(artikelnummer!);

  await docModal.getByRole('button', { name: 'Speichern & Abschließen' }).click();
  await expect(page.locator('.modal-overlay')).toHaveCount(0, { timeout: 8_000 });

  const docSearch = page.locator('input[placeholder*="Suche"]').first();
  await docSearch.fill(kundenName!.trim());
  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 8_000 });
});
