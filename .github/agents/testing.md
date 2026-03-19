# Testing & Quality Skill

## Overview

This skill covers testing patterns for backend (Jest) and frontend (Vitest), mock strategies for database and middleware, test isolation, and CI/CD integration for the GoldRegenDB system.

## Testing Philosophy

### Key Principles

1. **Isolation:** Each test is independent
2. **Determinism:** Same code always produces same result
3. **Speed:** Tests run quickly (<5ms each)
4. **Coverage:** Critical paths are tested
5. **Clarity:** Test name describes what's being tested

## Backend Testing (Jest)

### Test Environment Setup

**File:** `/backend/jest.config.js`

```javascript
module.exports = {
  testEnvironment: 'node',
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/index.js',
    '!src/config/**'
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70
    }
  },
  testMatch: ['**/__tests__/**/*.test.js'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js']
};
```

### Jest Setup

**File:** `/backend/jest.setup.js`

```javascript
// Set JWT_SECRET before any module loads
process.env.JWT_SECRET = 'test-secret-do-not-use-in-prod';

// Suppress console output in tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};
```

## Mock Patterns

### Mock Database

**File:** `/backend/__tests__/auth.middleware.test.js`

```javascript
// Set JWT_SECRET BEFORE modules load
process.env.JWT_SECRET = 'test-secret-do-not-use-in-prod';

// Mock database before loading middleware
jest.mock('../src/config/db', () => ({
  query: jest.fn(),
  requestContextMiddleware: (req, res, next) => next(),
  setCurrentDbUsername: jest.fn()
}));

// Mock logger to reduce noise
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

const jwt = require('jsonwebtoken');
const { authenticate, requireAdmin } = require('../src/middleware/auth');
const db = require('../src/config/db');

describe('Authentication Middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns 401 when Authorization header missing', () => {
    const req = { headers: {} };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    const next = jest.fn();

    authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('validates JWT token correctly', async () => {
    const token = jwt.sign(
      { userId: 1, username: 'testuser', role: 'admin' },
      'test-secret-do-not-use-in-prod'
    );

    // Mock database to return user
    db.query.mockResolvedValueOnce({
      rows: [{
        id: 1,
        username: 'testuser',
        role: 'admin',
        email: 'test@example.com',
        active: true
      }]
    });

    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(req.user).toBeDefined();
    expect(req.user.username).toBe('testuser');
    expect(next).toHaveBeenCalled();
  });

  test('requireAdmin blocks non-admin users', () => {
    const req = { user: { role: 'user' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
```

### Mock Routes

**File:** `/backend/__tests__/schmuckstuecke.routes.test.js`

```javascript
process.env.JWT_SECRET = 'test-secret';

jest.mock('../src/config/db');
jest.mock('../src/utils/logger');
jest.mock('../src/middleware/auth');

const request = require('supertest');
const app = require('../src/index');
const db = require('../src/config/db');
const { authenticate, requireBearbeiter } = require('../src/middleware/auth');

describe('Schmuckstücke Routes', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    // Mock authentication middleware
    authenticate.mockImplementation((req, res, next) => {
      req.user = { id: 1, username: 'test', role: 'bearbeiter', tenant_id: 1 };
      next();
    });

    requireBearbeiter.mockImplementation((req, res, next) => next());
  });

  describe('GET /api/schmuckstuecke', () => {
    test('returns list of items', async () => {
      db.query.mockResolvedValueOnce({
        rows: [
          {
            Artikelnummer: 'MBH001',
            Name: 'Blue Necklace',
            Verkaufspreis: 35.00
          }
        ]
      });

      const response = await request(app)
        .get('/api/schmuckstuecke')
        .expect(200);

      expect(response.body).toBeInstanceOf(Array);
      expect(response.body[0].Artikelnummer).toBe('MBH001');
      expect(db.query).toHaveBeenCalled();
    });

    test('filters by status', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .get('/api/schmuckstuecke?status=verfuegbar')
        .expect(200);

      // Verify query was called with WHERE clause
      const callArgs = db.query.mock.calls[0];
      expect(callArgs[0]).toContain('WHERE');
    });
  });

  describe('POST /api/schmuckstuecke', () => {
    test('creates new item', async () => {
      db.query.mockResolvedValueOnce({ rows: [] }); // Check uniqueness
      db.query.mockResolvedValueOnce({
        rows: [{
          Artikelnummer: 'MBH002',
          Name: 'New Necklace',
          Verkaufspreis: 40.00
        }]
      });

      const response = await request(app)
        .post('/api/schmuckstuecke')
        .send({
          Artikelnummer: 'MBH002',
          Name: 'New Necklace',
          Verkaufspreis: 40.00
        })
        .expect(201);

      expect(response.body.Artikelnummer).toBe('MBH002');
    });

    test('rejects invalid Artikelnummer format', async () => {
      const response = await request(app)
        .post('/api/schmuckstuecke')
        .send({
          Artikelnummer: 'INVALID',
          Name: 'Test'
        })
        .expect(400);

      expect(response.body.error).toBeDefined();
    });

    test('prevents Verkauft and Ausschuss both set', async () => {
      const response = await request(app)
        .post('/api/schmuckstuecke')
        .send({
          Artikelnummer: 'MBH003',
          Verkauft: 1,
          Ausschuss: 1
        })
        .expect(400);

      expect(response.body.error).toContain('cannot be both');
    });
  });
});
```

## WHERE Clause Builder Tests

**File:** `/backend/__tests__/whereClauseBuilder.test.js`

```javascript
const { where } = require('../src/utils/whereClauseBuilder');

describe('WHERE Clause Builder', () => {
  describe('Status filters', () => {
    test('verfuegbar filters available items', () => {
      const builder = where();
      builder.verfuegbar();

      const sql = builder.build();
      const params = builder.getParams();

      expect(sql).toContain('Verkauft = $1');
      expect(sql).toContain('Ausschuss = $2');
      expect(sql).toContain('Ausgelagert = $3');
      expect(params).toEqual([0, 0, 0]);
    });

    test('verkauft excludes ausschuss', () => {
      const builder = where();
      builder.verkauft();

      const sql = builder.build();
      const params = builder.getParams();

      expect(sql).toContain('Verkauft = $1');
      expect(sql).toContain('Ausschuss = $2');
      expect(params).toEqual([1, 0]);
    });

    test('ausschuss filter', () => {
      const builder = where();
      builder.ausschuss();

      const sql = builder.build();
      expect(sql).toContain('Ausschuss = $1');
    });
  });

  describe('Prefix filters', () => {
    test('hersteller filter', () => {
      const builder = where();
      builder.hersteller('M');

      const sql = builder.build();
      expect(sql).toContain('SUBSTRING');
      expect(sql).toContain('1, 1');
    });

    test('grundmaterial filter', () => {
      const builder = where();
      builder.grundmaterial('P');

      const sql = builder.build();
      expect(sql).toContain('SUBSTRING');
      expect(sql).toContain('2, 1');
    });
  });

  describe('Attribute filters', () => {
    test('custom field filter', () => {
      const builder = where();
      builder.field('Farbe', '=', 'Blau');

      const sql = builder.build();
      const params = builder.getParams();

      expect(sql).toContain('Farbe');
      expect(params).toContain('Blau');
    });

    test('multiple filters combined', () => {
      const builder = where();
      builder.verfuegbar();
      builder.farbe('Blau');
      builder.field('Verkaufspreis', '>=', 20);

      const sql = builder.build();
      expect(sql).toContain('AND');
    });
  });
});
```

## Frontend Testing (Vitest)

### Vitest Setup

**File:** `/frontend/vitest.config.js`

```javascript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './vitest.setup.js',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/'
      ]
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
});
```

### Vitest Setup File

**File:** `/frontend/vitest.setup.js`

```javascript
import { expect, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn()
};

global.localStorage = localStorageMock;

// Mock fetch
global.fetch = vi.fn();
```

### Frontend Component Tests

**File:** `/frontend/src/__tests__/PhotoUpload.test.jsx`

```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PhotoUpload from '../components/PhotoUpload';

describe('PhotoUpload Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders upload zone', () => {
    render(
      <PhotoUpload
        artikelnummer="MBH001"
        onPhotoSelected={vi.fn()}
      />
    );

    expect(screen.getByText(/drag photo here/i)).toBeTruthy();
  });

  it('validates file size', async () => {
    const onPhotoSelected = vi.fn();
    render(
      <PhotoUpload
        artikelnummer="MBH001"
        onPhotoSelected={onPhotoSelected}
      />
    );

    const file = new File(['x'.repeat(6 * 1024 * 1024)], 'large.jpg', {
      type: 'image/jpeg'
    });

    const input = screen.getByDisplayValue('file');
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText(/too large/i)).toBeTruthy();
    });

    expect(onPhotoSelected).not.toHaveBeenCalled();
  });

  it('validates file type', async () => {
    const onPhotoSelected = vi.fn();
    render(
      <PhotoUpload
        artikelnummer="MBH001"
        onPhotoSelected={onPhotoSelected}
      />
    );

    const file = new File(['content'], 'test.pdf', {
      type: 'application/pdf'
    });

    const input = screen.getByDisplayValue('file');
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText(/JPG, PNG, and GIF/i)).toBeTruthy();
    });
  });

  it('handles drag and drop', () => {
    render(
      <PhotoUpload
        artikelnummer="MBH001"
        onPhotoSelected={vi.fn()}
      />
    );

    const zone = screen.getByText(/drag photo here/i).parentElement;
    expect(zone).toBeTruthy();

    fireEvent.dragEnter(zone);
    expect(zone).toHaveClass('active');

    fireEvent.dragLeave(zone);
    expect(zone).not.toHaveClass('active');
  });
});
```

## Running Tests

### Backend Tests

```bash
# Run all tests
cd backend && npm test

# Run with coverage
npm test -- --coverage

# Watch mode (rerun on file change)
npm test -- --watch

# Run specific test file
npm test -- auth.middleware.test.js

# Run tests matching pattern
npm test -- --testNamePattern="verfuegbar"
```

### Frontend Tests

```bash
# Run all tests
cd frontend && npm run test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage

# Run specific file
npm run test PhotoUpload.test.jsx
```

## CI/CD Integration

### GitHub Actions Workflow

**File:** `/.github/workflows/test.yml`

```yaml
name: Tests

on: [push, pull_request]

jobs:
  backend:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_DB: goldregendb_test
          POSTGRES_USER: goldregen
          POSTGRES_PASSWORD: testpass

    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install backend dependencies
        run: cd backend && npm ci

      - name: Run backend tests
        run: cd backend && npm test -- --coverage
        env:
          DATABASE_URL: postgresql://goldregen:testpass@localhost:5432/goldregendb_test
          JWT_SECRET: test-secret

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./backend/coverage/coverage-final.json

  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install frontend dependencies
        run: cd frontend && npm ci

      - name: Run frontend tests
        run: cd frontend && npm run test:coverage

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./frontend/coverage/coverage-final.json
```

## Test Isolation Best Practices

### Database Test Isolation

```javascript
// Before each test - fresh database state
beforeEach(async () => {
  // Clear all tables
  await db.query('TRUNCATE TABLE "Schmuckstück" CASCADE');
  await db.query('TRUNCATE TABLE "Kunde" CASCADE');
  await db.query('TRUNCATE TABLE "Rechnung" CASCADE');
});

// Or use transactions and rollback
let testTransaction;

beforeEach(async () => {
  testTransaction = await db.connect();
  await testTransaction.query('BEGIN');
});

afterEach(async () => {
  if (testTransaction) {
    await testTransaction.query('ROLLBACK');
    testTransaction.release();
  }
});
```

### Mock Date/Time

```javascript
import { vi } from 'vitest';

beforeEach(() => {
  const mockDate = new Date('2024-01-15T12:00:00Z');
  vi.useFakeTimers();
  vi.setSystemTime(mockDate);
});

afterEach(() => {
  vi.useRealTimers();
});
```

## Related Skills

- [Authentication & Authorization](./authentication.md) - Testing auth flows
- [Database Operations](./database-operations.md) - Database query testing
- [Inventory Management](./inventory-management.md) - Testing business logic

## Troubleshooting

### Tests Fail Intermittently

**Cause:** Async operations not awaited
**Solution:**
1. Use async/await in all async operations
2. Use waitFor() for async state changes
3. Mock timers for time-dependent code

### Database Connection Errors in Tests

**Cause:** Wrong connection string or missing test database
**Solution:**
1. Set DATABASE_URL env var for tests
2. Ensure test database exists
3. Check PostgreSQL is running
4. Use in-memory database or Docker container

### Mock Not Working

**Cause:** Module already loaded before mock definition
**Solution:**
1. Mock BEFORE require() statements
2. Set environment variables first
3. Clear mocks between tests with jest.clearAllMocks()

### Slow Tests

**Cause:** Real database queries or network calls
**Solution:**
1. Mock all I/O operations
2. Use faster test database (SQLite in memory)
3. Run tests in parallel: `npm test -- --maxWorkers=4`
