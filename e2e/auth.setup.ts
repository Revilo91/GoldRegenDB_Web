import { test as setup, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const AUTH_FILE = path.join(__dirname, '.auth/user.json');

const API_URL = process.env.API_URL || 'http://localhost:3001/api';
const USERNAME = process.env.TEST_USERNAME || 'admin';
const PASSWORD = process.env.TEST_PASSWORD || 'admin';

setup('Admin-Session holen und speichern', async ({ request }) => {
  const response = await request.post(`${API_URL}/auth/login`, {
    data: { username: USERNAME, password: PASSWORD },
  });

  expect(response.ok(), `Login fehlgeschlagen: ${await response.text()}`).toBeTruthy();

  // Das JWT kommt seit Issue #132 als httpOnly-Cookie. Der Request-Context von
  // Playwright hat es beim Login eingesammelt; storageState übernimmt es
  // inklusive Cookie in die Browser-Kontexte der Tests.
  const storageState = await request.storageState();
  const jwtCookie = storageState.cookies.find((c) => c.name === 'jwt');
  expect(jwtCookie, 'Kein jwt-Cookie in der Antwort').toBeTruthy();

  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify(storageState, null, 2));
});
