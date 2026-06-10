/**
 * dashboard.spec.js – Dashboard-Seite
 */
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('Dashboard lädt ohne Fehler', async ({ page }) => {
  await expect(page).toHaveURL('/');
  // Keine JS-Fehler prüfen (Konsole)
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.waitForTimeout(1_000);
  expect(errors).toHaveLength(0);
});

test('Dashboard zeigt Statistik-Karten', async ({ page }) => {
  // Mindestens eine Karte mit Zahlenwert soll sichtbar sein
  await expect(page.locator('.stat-card, .dashboard-card, .kpi-card').first())
    .toBeVisible({ timeout: 8_000 });
});

test('Navigation: Link zu Schmuckstücken funktioniert', async ({ page }) => {
  await page.locator('a[href="/schmuckstuecke"]').first().click();
  await expect(page).toHaveURL('/schmuckstuecke');
});

test('Navigation: Link zu Kunden funktioniert', async ({ page }) => {
  await page.locator('a[href="/kunden"]').first().click();
  await expect(page).toHaveURL('/kunden');
});
