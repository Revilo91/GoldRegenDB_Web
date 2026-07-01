# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth.spec.js >> Login >> Erfolgreicher Login leitet auf Dashboard weiter
- Location: auth.spec.js:44:3

# Error details

```
Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
Call log:
  - navigating to "/login", waiting until "load"

```

# Test source

```ts
  1  | /**
  2  |  * auth.spec.js – Login / Logout UI-Tests
  3  |  *
  4  |  * Läuft OHNE gespeicherten Auth-State (storageState wird geleert).
  5  |  */
  6  | import { test, expect } from '@playwright/test';
  7  | import crypto from 'crypto';
  8  | 
  9  | // Kein gespeicherter Login-State für diese Datei
  10 | test.use({ storageState: { cookies: [], origins: [] } });
  11 | 
  12 | function sha256(text) {
  13 |   return crypto.createHash('sha256').update(text).digest('hex');
  14 | }
  15 | 
  16 | const USERNAME = process.env.TEST_USERNAME || 'admin';
  17 | const PASSWORD = process.env.TEST_PASSWORD || 'admin';
  18 | 
  19 | test.describe('Login', () => {
  20 |   test.beforeEach(async ({ page }) => {
> 21 |     await page.goto('/login');
     |                ^ Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
  22 |   });
  23 | 
  24 |   test('zeigt Login-Formular', async ({ page }) => {
  25 |     await expect(page.locator('#username')).toBeVisible();
  26 |     await expect(page.locator('#password')).toBeVisible();
  27 |     await expect(page.locator('button[type="submit"]')).toBeVisible();
  28 |   });
  29 | 
  30 |   test('Login mit ungültigen Zugangsdaten zeigt Fehler', async ({ page }) => {
  31 |     await page.fill('#username', 'falscherBenutzer');
  32 |     await page.fill('#password', 'falschesPasswort');
  33 |     await page.click('button[type="submit"]');
  34 | 
  35 |     await expect(page.locator('.login-error')).toBeVisible({ timeout: 5_000 });
  36 |   });
  37 | 
  38 |   test('Login mit leerem Formular schlägt fehl', async ({ page }) => {
  39 |     await page.click('button[type="submit"]');
  40 |     // HTML5-Validierung verhindert Submit → Fehler-Element nicht sichtbar
  41 |     await expect(page).toHaveURL('/login');
  42 |   });
  43 | 
  44 |   test('Erfolgreicher Login leitet auf Dashboard weiter', async ({ page }) => {
  45 |     await page.fill('#username', USERNAME);
  46 |     await page.fill('#password', PASSWORD);
  47 |     await page.click('button[type="submit"]');
  48 | 
  49 |     // Entweder Dashboard (/) oder /schmuckstuecke je nach Rolle
  50 |     await page.waitForURL((url) => !url.pathname.includes('/login'), {
  51 |       timeout: 10_000,
  52 |     });
  53 | 
  54 |     const token = await page.evaluate(() => localStorage.getItem('token'));
  55 |     expect(token).toBeTruthy();
  56 |   });
  57 | });
  58 | 
  59 | test.describe('Logout', () => {
  60 |   test.beforeEach(async ({ page }) => {
  61 |     // Einloggen via API und Token setzen
  62 |     const resp = await page.request.post(
  63 |       `${process.env.API_URL || 'http://localhost:3001/api'}/auth/login`,
  64 |       { data: { username: USERNAME, password: sha256(PASSWORD) } },
  65 |     );
  66 |     const { token } = await resp.json();
  67 |     await page.addInitScript((t) => localStorage.setItem('token', t), token);
  68 |     await page.goto('/');
  69 |     await page.waitForURL((url) => !url.pathname.includes('/login'));
  70 |   });
  71 | 
  72 |   test('Logout entfernt Token und leitet auf /login', async ({ page }) => {
  73 |     // User-Menü öffnen (Avatar-Button oben rechts)
  74 |     await page.locator('.user-menu-btn').first().click();
  75 |     await page.locator('text=Abmelden').click();
  76 | 
  77 |     await page.waitForURL('/login', { timeout: 5_000 });
  78 | 
  79 |     const token = await page.evaluate(() => localStorage.getItem('token'));
  80 |     expect(token).toBeNull();
  81 |   });
  82 | });
  83 | 
```