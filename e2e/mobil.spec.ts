import { test, expect, Page } from '@playwright/test';

// Handy-Abläufe (Issue #291, Stufe 1). Läuft nur im Playwright-Projekt "mobile" (390 px Breite).
// Ablauf-Tests prüfen, dass die Funktion bedienbar ist; die Scroll-Tests ganz unten
// prüfen getrennt davon, dass die Seite nicht seitlich scrollt.

const USERNAME = process.env.TEST_USERNAME || 'admin';
const PASSWORD = process.env.TEST_PASSWORD || 'admin';

// 1x1-PNG, genügt der Magic-Byte-Prüfung des Foto-Uploads
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

// Schmuckstück-Liste: auf dem Handy eine Kompakt-Liste (#317) statt der Tabelle.
const KOMPAKT_LISTE = '.data-table-mobil';
const KOMPAKT_ZEILE = '.data-table-mobil-item';

// Kein horizontales Scrollen: Dokumentbreite darf die Fensterbreite nicht überschreiten.
async function seitlichesScrollen(page: Page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

async function erwarteKeinSeitlichesScrollen(page: Page) {
  const { scrollWidth, clientWidth } = await seitlichesScrollen(page);
  expect(scrollWidth, `scrollWidth ${scrollWidth} > clientWidth ${clientWidth}`).toBeLessThanOrEqual(clientWidth);
}

async function neuesSchmuckstueckOeffnen(page: Page) {
  await page.goto('/schmuckstuecke');
  await page.getByRole('button', { name: '+ Neues Schmuckstück' }).click();
  const modal = page.locator('.modal').first();
  await expect(modal).toBeVisible();

  const selects = modal.locator('.form-row').first().locator('select');
  await selects.nth(0).selectOption({ index: 1 });
  await selects.nth(1).selectOption({ index: 1 });
  await selects.nth(2).selectOption({ index: 1 });

  // Die Vorschau steht im Modal-Kopf und erscheint, sobald die Auswahl vollständig ist.
  const vorschau = modal.locator('.schmuckstuecke-form-nummer');
  await expect(vorschau).toBeVisible({ timeout: 8_000 });
  const artikelnummer = (await vorschau.textContent())?.split('×')[0].trim();
  expect(artikelnummer).toBeTruthy();
  return { modal, artikelnummer: artikelnummer! };
}

test.describe('Handy: Abläufe', () => {
  test.describe('Login', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('Anmelden über das Formular', async ({ page }) => {
      await page.goto('/login');
      await page.locator('#username').fill(USERNAME);
      await page.locator('#password').fill(PASSWORD);
      await page.getByRole('button', { name: 'Anmelden' }).click();
      await expect(page).toHaveURL('/', { timeout: 10_000 });
    });
  });

  test('Stück suchen', async ({ page }) => {
    // Eigenes Stück anlegen, damit die Suche unabhängig von Seed-Daten etwas findet
    const { artikelnummer } = await neuesSchmuckstueckOeffnen(page);
    await page.getByRole('button', { name: 'Speichern + Schließen' }).click();
    await expect(page.locator('.modal-overlay')).toHaveCount(0, { timeout: 8_000 });

    const suche = page.locator('input[placeholder*="Suche"]').first();
    await suche.fill(artikelnummer);
    await expect(page.locator(KOMPAKT_ZEILE).first()).toContainText(artikelnummer, { timeout: 8_000 });
  });

  test('Stück mit Foto anlegen (Kamera-Upload per Datei)', async ({ page }) => {
    const { modal, artikelnummer } = await neuesSchmuckstueckOeffnen(page);

    // Das Datei-Input ist visuell verborgen; setInputFiles braucht keinen Klick
    const uploadAntwort = page.waitForResponse(
      (r) => r.url().includes('/schmuckstuecke/upload') && r.request().method() === 'POST',
    );
    await modal.locator('input[type="file"]').setInputFiles({
      name: 'kamera.png',
      mimeType: 'image/png',
      buffer: PNG_1X1,
    });
    expect((await uploadAntwort).ok()).toBeTruthy();
    await expect(modal.locator('.photo-preview img')).toBeVisible();

    await page.getByRole('button', { name: 'Speichern + Schließen' }).click();
    await expect(page.locator('.modal-overlay')).toHaveCount(0, { timeout: 8_000 });

    const suche = page.locator('input[placeholder*="Suche"]').first();
    await suche.fill(artikelnummer);
    await expect(page.locator(KOMPAKT_ZEILE).first()).toContainText(artikelnummer, { timeout: 8_000 });
  });

  test('Bestellübersicht: Neue Bestellung anlegen', async ({ page }) => {
    const marker = `E2E-Mobil-${Date.now()}`;
    await page.goto('/bestelluebersicht');
    await page.getByRole('button', { name: '+ Neue Bestellung' }).click();

    const feld = (label: string) =>
      page.locator('.modal .form-group', { hasText: label }).locator('input, textarea');
    await feld('Name').fill(marker);
    await feld('E-Mail').fill('e2e-mobil@example.com');
    await feld('Telefonnummer').fill('0123456789');
    await feld('Auftragsbeschreibung').fill('E2E-Test mobil: Ring');
    // Echte Klicks: Das Modal passt seit #327 in das Fenster, nichts überdeckt Checkbox und Button.
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.locator('.modal-overlay')).toHaveCount(0, { timeout: 5_000 });

    await page.locator('input[placeholder*="Suche"]').first().fill(marker);
    await expect(page.locator('tbody tr').first()).toContainText(marker, { timeout: 8_000 });
  });
});

// Tab-Leiste unten (#320): echte Klicks statt page.goto, Seitenleiste und Mobile-Header entfallen.
test.describe('Handy: Navigation', () => {
  test('Tab-Leiste: Wechsel zwischen Tabs', async ({ page }) => {
    await page.goto('/schmuckstuecke');
    const leiste = page.getByRole('navigation', { name: 'Hauptnavigation mobil' });
    await expect(leiste).toBeVisible();
    await expect(page.locator('.sidebar')).toBeHidden();
    await expect(leiste.getByRole('link', { name: 'Stücke' })).toHaveAttribute('aria-current', 'page');

    await leiste.getByRole('link', { name: 'Inventur' }).click();
    await expect(page).toHaveURL(/\/inventur$/);
    await expect(leiste.getByRole('link', { name: 'Inventur' })).toHaveAttribute('aria-current', 'page');

    await leiste.getByRole('link', { name: 'Kunden' }).click();
    await expect(page).toHaveURL(/\/kunden$/);

    await leiste.getByRole('button', { name: 'Mehr' }).click();
    const sheet = page.getByRole('dialog', { name: 'Mehr' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('link', { name: 'Bestellübersicht' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Abmelden' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);

    await leiste.getByRole('button', { name: 'Mehr' }).click();
    await sheet.getByRole('link', { name: 'Bestellübersicht' }).click();
    await expect(page).toHaveURL(/\/bestelluebersicht$/);
    await expect(sheet).toHaveCount(0);

    await leiste.getByRole('button', { name: 'Belege' }).click();
    await page.getByRole('group', { name: 'Belege' }).getByRole('link', { name: 'Rechnungen' }).click();
    await expect(page).toHaveURL(/\/rechnungen$/);
    await expect(leiste.getByRole('button', { name: 'Belege' })).toHaveAttribute('aria-current', 'page');
  });
});

// Eigene Tests je Seite, damit ein Befund pro Seite sichtbar bleibt.
test.describe('Handy: kein horizontales Scrollen', () => {
  test.describe('Login-Seite', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('Login-Seite scrollt nicht seitlich', async ({ page }) => {
      await page.goto('/login');
      await expect(page.locator('#username')).toBeVisible();
      await erwarteKeinSeitlichesScrollen(page);
    });
  });

  // Behoben mit #327: Mit Bestellungen war scrollWidth 453 > 390, weil .main-content (Flex-Item) von der
  // Tabelle aufgeweitet wurde. Der Test ist nur mit vorhandenen Bestellungen aussagekräftig; die
  // Ablauf-Tests oben legen eine an.
  test('Bestellübersicht scrollt nicht seitlich', async ({ page }) => {
    await page.goto('/bestelluebersicht');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('table, .data-table').first()).toBeVisible({ timeout: 8_000 });
    await erwarteKeinSeitlichesScrollen(page);
  });

  // Seit #327 scrollt die Seite nicht mehr seitlich; die Kompakt-Liste (#317) ersetzt die
  // zehnspaltige Tabelle, damit auch der Karteninhalt nicht mehr seitlich scrollt.
  test('Schmuckstück-Liste scrollt nicht seitlich', async ({ page }) => {
    await page.goto('/schmuckstuecke');
    await page.waitForLoadState('networkidle');
    await expect(page.locator(KOMPAKT_LISTE)).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('table')).toHaveCount(0);
    await erwarteKeinSeitlichesScrollen(page);
    const karte = await page.locator('.card-body').first().evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(karte.scrollWidth, 'Karteninhalt scrollt seitlich').toBeLessThanOrEqual(karte.clientWidth);
  });

  test('Schmuckstück-Anlegen-Dialog scrollt nicht seitlich', async ({ page }) => {
    await neuesSchmuckstueckOeffnen(page);
    await erwarteKeinSeitlichesScrollen(page);
  });

  // #329: Filterzeile und Belegtabelle weiteten die Seite auf 565 px.
  for (const beleg of ['rechnungen', 'lieferscheine']) {
    test(`Beleg-Liste /${beleg} scrollt nicht seitlich`, async ({ page }) => {
      await page.goto(`/${beleg}`);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('.filter-group')).toBeVisible({ timeout: 8_000 });
      await erwarteKeinSeitlichesScrollen(page);
    });
  }
});
