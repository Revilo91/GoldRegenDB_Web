/**
 * gui-schwachstellen.spec.js – GUI-Schwachstellen & Qualitäts-Tests
 *
 * Systematische Prüfung auf häufige GUI-Probleme:
 * - Console-Fehler auf allen Seiten
 * - Fehlende Netzwerk-Fehlerbehandlung
 * - Responsive Design Probleme
 * - Accessibility-Grundlagen
 * - XSS-Grundschutz
 * - Memory-Leaks durch fehlende Cleanup
 */
import { test, expect } from '@playwright/test';

const ALL_PAGES = [
  { path: '/', name: 'Dashboard' },
  { path: '/schmuckstuecke', name: 'Schmuckstücke' },
  { path: '/kunden', name: 'Kunden' },
  { path: '/lieferscheine', name: 'Lieferscheine' },
  { path: '/rechnungen', name: 'Rechnungen' },
  { path: '/sumup', name: 'SumUp' },
  { path: '/inventur', name: 'Inventur' },
  { path: '/audit-log', name: 'Audit Log' },
  { path: '/debug', name: 'Debug' },
  { path: '/benutzerverwaltung', name: 'Benutzerverwaltung' },
  { path: '/datensicherung', name: 'Datensicherung' },
];

// ─────────────────────────────────────────────────────────────────
// 1. CONSOLE-FEHLER AUF ALLEN SEITEN
// ─────────────────────────────────────────────────────────────────
test.describe('Keine JavaScript-Konsolen-Fehler', () => {
  for (const pageInfo of ALL_PAGES) {
    test(`${pageInfo.name} (${pageInfo.path}) – keine JS-Fehler`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', (err) => errors.push(err.message));

      await page.goto(pageInfo.path);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2_000);

      if (errors.length > 0) {
        console.error(`JS-Fehler auf ${pageInfo.name}:`, errors);
      }
      expect(errors, `JavaScript-Fehler auf ${pageInfo.name}`).toHaveLength(0);
    });
  }
});

// ─────────────────────────────────────────────────────────────────
// 2. FEHLENDE LADE-INDIKATOREN / LOADING-STATES
// ─────────────────────────────────────────────────────────────────
test.describe('Loading-States sind vorhanden', () => {
  for (const pageInfo of ALL_PAGES) {
    test(`${pageInfo.name} – zeigt Loading-State oder Inhalt`, async ({ page }) => {
      await page.goto(pageInfo.path);

      // Entweder sofort Inhalt ODER Lade-Indikator sichtbar
      const contentOrLoader = page.locator(
        '.loading, .spinner, table, .data-table, .card, .stat-card, h2, .page-header',
      ).first();
      await expect(contentOrLoader).toBeVisible({ timeout: 10_000 });
    });
  }
});

// ─────────────────────────────────────────────────────────────────
// 3. FEHLGESCHLAGENE NETZWERK-REQUESTS (4xx/5xx)
// ─────────────────────────────────────────────────────────────────
test.describe('Keine fehlgeschlagenen API-Requests', () => {
  for (const pageInfo of ALL_PAGES) {
    test(`${pageInfo.name} – keine 4xx/5xx API-Fehler`, async ({ page }) => {
      const failedRequests = [];

      page.on('response', (response) => {
        const url = response.url();
        const status = response.status();
        // Nur API-Requests prüfen, nicht statische Assets
        if (url.includes('/api/') && status >= 400) {
          failedRequests.push({ url, status });
        }
      });

      await page.goto(pageInfo.path);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1_500);

      if (failedRequests.length > 0) {
        console.warn(`Fehlgeschlagene API-Requests auf ${pageInfo.name}:`, failedRequests);
      }
      expect(
        failedRequests,
        `Fehlgeschlagene API-Requests auf ${pageInfo.name}: ${JSON.stringify(failedRequests)}`,
      ).toHaveLength(0);
    });
  }
});

// ─────────────────────────────────────────────────────────────────
// 4. RESPONSIVE DESIGN – Mobil-Ansicht
// ─────────────────────────────────────────────────────────────────
test.describe('Responsive Design – Mobile Viewport', () => {
  test.use({ viewport: { width: 375, height: 812 } }); // iPhone 12

  for (const pageInfo of ALL_PAGES) {
    test(`${pageInfo.name} – kein horizontales Overflow auf Mobile`, async ({ page }) => {
      await page.goto(pageInfo.path);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1_000);

      const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
      const viewportWidth = await page.evaluate(() => window.innerWidth);

      // Body sollte nicht breiter als Viewport sein (mit kleiner Toleranz)
      expect(
        bodyWidth,
        `Horizontaler Overflow auf ${pageInfo.name}: body=${bodyWidth}px > viewport=${viewportWidth}px`,
      ).toBeLessThanOrEqual(viewportWidth + 5);
    });
  }

  test('Mobile-Header ist auf kleinem Viewport sichtbar', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const mobileHeader = page.locator('.mobile-header');
    await expect(mobileHeader).toBeVisible({ timeout: 5_000 });
  });

  test('Menu-Toggle Button funktioniert auf Mobile', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const menuToggle = page.locator('.menu-toggle');
    await expect(menuToggle).toBeVisible({ timeout: 5_000 });

    // Klick öffnet Sidebar
    await menuToggle.click();
    await page.waitForTimeout(500);

    const sidebar = page.locator('.sidebar.open');
    await expect(sidebar).toBeVisible({ timeout: 3_000 });
  });
});

// ─────────────────────────────────────────────────────────────────
// 5. ACCESSIBILITY GRUNDLAGEN
// ─────────────────────────────────────────────────────────────────
test.describe('Accessibility-Grundlagen', () => {
  test('Login-Seite: Formular-Labels vorhanden', async ({ page }) => {
    // Ohne Auth-State
    await page.goto('/login');
    await page.evaluate(() => localStorage.removeItem('token'));
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    const usernameLabel = page.locator('label[for="username"]');
    const passwordLabel = page.locator('label[for="password"]');

    await expect(usernameLabel).toBeVisible({ timeout: 5_000 });
    await expect(passwordLabel).toBeVisible({ timeout: 5_000 });
  });

  test('Buttons haben sichtbaren Text oder aria-label', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const buttons = page.locator('button');
    const buttonCount = await buttons.count();

    for (let i = 0; i < Math.min(buttonCount, 20); i++) {
      const button = buttons.nth(i);
      const text = (await button.textContent())?.trim();
      const ariaLabel = await button.getAttribute('aria-label');
      const title = await button.getAttribute('title');

      const hasAccessibleName = (text && text.length > 0) || ariaLabel || title;
      expect(
        hasAccessibleName,
        `Button ${i} hat keinen sichtbaren Text, kein aria-label und keinen title`,
      ).toBeTruthy();
    }
  });

  test('Bilder haben alt-Attribute', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const images = page.locator('img');
    const imageCount = await images.count();

    for (let i = 0; i < imageCount; i++) {
      const img = images.nth(i);
      const alt = await img.getAttribute('alt');
      expect(alt, `Bild ${i} hat kein alt-Attribut`).not.toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// 6. XSS GRUNDSCHUTZ – Eingabefelder
// ─────────────────────────────────────────────────────────────────
test.describe('XSS-Grundschutz', () => {
  test('Suchfeld auf Schmuckstücke escaped HTML-Input', async ({ page }) => {
    await page.goto('/schmuckstuecke');
    await page.waitForLoadState('networkidle');

    const searchInput = page.locator(
      'input[placeholder*="Suche"], input[placeholder*="Artikelnummer"]',
    ).first();
    await expect(searchInput).toBeVisible();

    // XSS-Versuch einfügen
    await searchInput.fill('<script>alert("xss")</script>');
    await page.waitForTimeout(500);

    // Es darf kein Alert-Dialog erscheinen
    let alertFired = false;
    page.on('dialog', () => { alertFired = true; });
    await page.waitForTimeout(1_000);
    expect(alertFired).toBe(false);

    // Script-Tag darf nicht im DOM auftauchen
    const scriptInDOM = await page.evaluate(() =>
      document.body.innerHTML.includes('<script>alert("xss")</script>'),
    );
    expect(scriptInDOM).toBe(false);
  });

  test('Kunden-Suchfeld escaped HTML-Input', async ({ page }) => {
    await page.goto('/kunden');
    await page.waitForLoadState('networkidle');

    const searchInput = page.locator(
      'input[placeholder*="Suche"], input[type="search"]',
    ).first();

    if (await searchInput.isHidden()) {
      test.skip(true, 'Kein Suchfeld vorhanden');
      return;
    }

    await searchInput.fill('<img onerror=alert(1) src=x>');
    await page.waitForTimeout(500);

    let alertFired = false;
    page.on('dialog', () => { alertFired = true; });
    await page.waitForTimeout(1_000);
    expect(alertFired).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────
// 7. SECURITY – Auth-Guard prüft Zugriff
// ─────────────────────────────────────────────────────────────────
test.describe('Auth-Guard Schutz', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const pageInfo of ALL_PAGES) {
    test(`${pageInfo.name} – ohne Login wird auf /login umgeleitet`, async ({ page }) => {
      await page.goto(pageInfo.path);
      await page.waitForLoadState('networkidle');

      // Ohne Token sollte zur Login-Seite umgeleitet werden
      await page.waitForURL('/login', { timeout: 10_000 });
    });
  }
});

// ─────────────────────────────────────────────────────────────────
// 8. PERFORMANCE – Seiten laden innerhalb Zeitlimit
// ─────────────────────────────────────────────────────────────────
test.describe('Performance – Seiten laden schnell', () => {
  for (const pageInfo of ALL_PAGES) {
    test(`${pageInfo.name} – lädt innerhalb von 10 Sekunden`, async ({ page }) => {
      const start = Date.now();
      await page.goto(pageInfo.path);
      await page.waitForLoadState('networkidle');
      const loadTime = Date.now() - start;

      expect(
        loadTime,
        `${pageInfo.name} brauchte ${loadTime}ms zum Laden (max. 10000ms)`,
      ).toBeLessThan(10_000);
    });
  }
});

// ─────────────────────────────────────────────────────────────────
// 9. MODAL VERHALTEN – Können alle Modals geschlossen werden?
// ─────────────────────────────────────────────────────────────────
test.describe('Modal-Verhalten', () => {
  test('User-Menü-Modal kann geschlossen werden', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const userBtn = page.locator('.user-menu-btn').first();
    await userBtn.click();
    await page.waitForTimeout(500);

    // Close-Button im Modal
    const closeBtn = page.locator('.modal button:has(.fa-times), .modal .btn-secondary').first();
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
      await page.waitForTimeout(500);

      // Modal sollte geschlossen sein
      const modal = page.locator('.user-menu-modal');
      await expect(modal).toBeHidden({ timeout: 3_000 });
    }
  });

  test('Lieferschein-Detail-Modal: Close-Button funktioniert', async ({ page }) => {
    await page.goto('/lieferscheine');
    await page.waitForLoadState('networkidle');

    const firstRow = page.locator('tbody tr').first();
    const rowCount = await page.locator('tbody tr').count();

    if (rowCount === 0) {
      test.skip(true, 'Keine Lieferscheine vorhanden');
      return;
    }

    await firstRow.click();
    await page.waitForTimeout(1_000);

    const closeBtn = page.locator('.modal-close, button:has-text("×")').first();
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
      await page.waitForTimeout(500);

      const modal = page.locator('.modal-overlay');
      await expect(modal).toBeHidden({ timeout: 3_000 });
    }
  });

  test('Benutzerverwaltung-Modal: Schließen-Button funktioniert', async ({ page }) => {
    await page.goto('/benutzerverwaltung');
    await page.waitForLoadState('networkidle');

    const firstRow = page.locator('tbody tr').first();
    const rowCount = await page.locator('tbody tr').count();

    if (rowCount === 0) {
      test.skip(true, 'Keine Benutzer vorhanden');
      return;
    }

    await firstRow.click();
    await page.waitForTimeout(500);

    const closeBtn = page.locator('button:has-text("Schließen"), .btn-ghost:has(.fa-times)').first();
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
      await page.waitForTimeout(500);
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// 10. SCHNELL HINTEREINANDER NAVIGIEREN (Race Conditions)
// ─────────────────────────────────────────────────────────────────
test.describe('Schnelle Navigation – keine Race Conditions', () => {
  test('Schnelles Wechseln zwischen Seiten verursacht keinen Crash', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    const pages = ['/', '/schmuckstuecke', '/kunden', '/lieferscheine', '/rechnungen', '/sumup'];

    for (const p of pages) {
      await page.goto(p);
      // Nicht auf networkidle warten – absichtlich schnell navigieren
      await page.waitForTimeout(200);
    }

    // Nach dem schnellen Navigieren nochmal kurz warten
    await page.waitForTimeout(2_000);

    // Keine unkontrollierten Fehler
    expect(errors).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────
// 11. LEERE ZUSTÄNDE – Wie verhalten sich Seiten ohne Daten?
// ─────────────────────────────────────────────────────────────────
test.describe('Suchfeld-Leerung – Reset funktioniert', () => {
  test('Schmuckstücke-Suche lässt sich zurücksetzen', async ({ page }) => {
    await page.goto('/schmuckstuecke');
    await page.waitForLoadState('networkidle');

    const searchInput = page.locator(
      'input[placeholder*="Suche"], input[placeholder*="Artikelnummer"]',
    ).first();
    await expect(searchInput).toBeVisible();

    // Füllen
    await searchInput.fill('XXXXNOTEXISTENT');
    await page.waitForTimeout(500);
    const rowsFiltered = await page.locator('tbody tr').count();

    // Leeren
    await searchInput.clear();
    await page.waitForTimeout(500);
    const rowsAll = await page.locator('tbody tr').count();

    expect(rowsAll).toBeGreaterThanOrEqual(rowsFiltered);
  });
});
