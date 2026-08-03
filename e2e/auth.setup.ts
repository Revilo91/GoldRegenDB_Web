import { test as setup, expect } from '@playwright/test';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';

const AUTH_FILE = path.join(__dirname, '.auth/user.json');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const API_URL = process.env.API_URL || 'http://localhost:3001/api';
const USERNAME = process.env.TEST_USERNAME || 'admin';
const PASSWORD = process.env.TEST_PASSWORD || 'admin';

function sha256(text: string) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

setup('Admin-Token holen und speichern', async ({ request }) => {
  const response = await request.post(`${API_URL}/auth/login`, {
    data: { username: USERNAME, password: sha256(PASSWORD) },
  });

  expect(response.ok(), `Login fehlgeschlagen: ${await response.text()}`).toBeTruthy();
  const { token } = await response.json();
  expect(token, 'Kein Token in der Antwort').toBeTruthy();

  // storageState als JSON direkt schreiben – kein Browser nötig
  const storageState = {
    cookies: [],
    origins: [
      {
        origin: BASE_URL,
        localStorage: [{ name: 'token', value: token }],
      },
    ],
  };

  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify(storageState, null, 2));
});
