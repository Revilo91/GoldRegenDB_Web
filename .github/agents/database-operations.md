# Database Operations Skill

## Overview

This skill covers PostgreSQL patterns, request-scoped database client management, session configuration for audit logging, migration patterns, and prepared statement best practices in the GoldRegenDB system.

## Connection Management

### Architecture: AsyncLocalStorage for Request Scoping

**Why This Approach?**
- Each HTTP request gets its own database client
- Session-local configuration (app.current_user) persists for entire request
- Prevents connection leaks
- Audit triggers can access authenticated user

### Implementation

**File:** `/backend/src/config/db.js`

```javascript
const { Pool } = require('pg');
const { AsyncLocalStorage } = require('async_hooks');
const logger = require('../utils/logger');

const connectionString = process.env.DATABASE_URL;

const pool = new Pool({ connectionString });

// Request-scoped storage using AsyncLocalStorage
const requestContext = new AsyncLocalStorage();

// Middleware to set up request context
function requestContextMiddleware(req, res, next) {
  const store = { username: 'anonym', client: null, clientPromise: null };

  // Release client when response is done
  const releaseClient = () => {
    const { client, clientPromise } = store;
    store.client = null;
    store.clientPromise = null;

    if (client) {
      client.release();
    } else if (clientPromise) {
      // Still acquiring, release when ready
      clientPromise
        .then((c) => c.release())
        .catch((err) => {
          logger.error('DB', 'Error releasing client', { message: err.message });
        });
    }
  };

  res.on('finish', releaseClient);
  res.on('close', releaseClient);

  requestContext.run(store, next);
}

// Set the current database user for this request
// Used by audit triggers to track who made changes
function setCurrentDbUsername(username) {
  const store = requestContext.getStore();
  if (!store) return;
  store.username = username || 'anonym';
}

// Get the current database user
function getCurrentDbUsername() {
  const store = requestContext.getStore();
  return store?.username || 'anonym';
}

// Get explicit connection (for transactions)
async function connect() {
  const client = await pool.connect();
  const username = getCurrentDbUsername();

  try {
    // Set session-local config for audit triggers
    await client.query(
      'SELECT set_config($1, $2, false)',
      ['app.current_user', username]
    );
    return client;
  } catch (err) {
    client.release();
    throw err;
  }
}

// Main query function - lazy acquires request-scoped client
async function query(text, params) {
  const store = requestContext.getStore();

  // Outside request context: use pool directly
  if (!store) {
    return pool.query(text, params);
  }

  // Lazy acquire request-scoped client (once per request)
  if (!store.clientPromise) {
    store.clientPromise = pool.connect().then(async (client) => {
      try {
        await client.query(
          'SELECT set_config($1, $2, false)',
          ['app.current_user', store.username]
        );
        store.client = client;
        return client;
      } catch (err) {
        client.release();
        throw err;
      }
    }).catch((err) => {
      // Allow retry on next call if acquisition failed
      store.clientPromise = null;
      throw err;
    });
  }

  const client = await store.clientPromise;
  return client.query(text, params);
}

module.exports = {
  query,
  connect,
  requestContextMiddleware,
  setCurrentDbUsername,
  getCurrentDbUsername,
  pool
};
```

## Request Middleware Setup

**File:** `/backend/src/index.js`

```javascript
const express = require('express');
const db = require('./config/db');

const app = express();

// Apply request context middleware FIRST (before all routes)
app.use(db.requestContextMiddleware);

// Then apply authentication middleware
const { authenticate } = require('./middleware/auth');
app.use(authenticate);

// Routes...
app.use('/api/schmuckstuecke', require('./routes/schmuckstuecke'));
```

### Authentication Middleware Sets User

**File:** `/backend/src/middleware/auth.js`

```javascript
const { authenticate } = require('../middleware/auth');

const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Fetch user data
    const result = await db.query(
      'SELECT id, username, role, email, tenant_id FROM app_users WHERE id = $1 AND active = TRUE',
      [decoded.userId]
    );

    req.user = result.rows[0];

    // CRITICAL: Set authenticated user for audit triggers
    // This is called automatically by the request-scoped client
    // on first query, but we can set it explicitly here too
    const store = requestContext.getStore();
    if (store) {
      db.setCurrentDbUsername(req.user.username);
    }

    next();
  } catch (error) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
};
```

## Prepared Statements (Best Practice)

### Always Use Parameterized Queries

**CORRECT - Prevents SQL Injection:**

```javascript
// Using parameterized queries
await db.query(
  'SELECT * FROM "Schmuckstück" WHERE "Artikelnummer" = $1 AND "Verkauft" = $2',
  [artikelnummer, 0]
);

// Multiple parameters
await db.query(
  'UPDATE "Kunde" SET "Provision" = $1, "Aktiv" = $2 WHERE "ID" = $3',
  [newProvision, isActive, kundeId]
);
```

**WRONG - SQL Injection Vulnerability:**

```javascript
// NEVER DO THIS!
const query = `SELECT * FROM "Schmuckstück" WHERE "Artikelnummer" = '${artikelnummer}'`;
await db.query(query);

// NEVER DO THIS EITHER!
const query = `UPDATE "Kunde" SET "Provision" = ${userInput}`;
await db.query(query);
```

## Transaction Patterns

### Simple Transaction

```javascript
const client = await db.connect();

try {
  await client.query('BEGIN');

  // Operation 1: Create Rechnung
  const invoiceResult = await client.query(
    `INSERT INTO "Rechnung" ("Kunde_ID", "Status", "Summe", "Erstelldatum")
     VALUES ($1, $2, $3, NOW())
     RETURNING *`,
    [kundeId, 'open', totalAmount]
  );

  const invoiceId = invoiceResult.rows[0].ID;

  // Operation 2: Update items
  for (const artikelnummer of items) {
    await client.query(
      `UPDATE "Schmuckstück"
       SET "Verkauft" = 1, "Rechnung_ID" = $1
       WHERE "Artikelnummer" = $2`,
      [invoiceId, artikelnummer]
    );
  }

  await client.query('COMMIT');
  logger.info('TX', 'Transaction committed', { invoiceId });

} catch (error) {
  await client.query('ROLLBACK');
  logger.error('TX', 'Transaction rolled back', { message: error.message });
  throw error;
} finally {
  client.release();
}
```

### Savepoint for Partial Rollback

```javascript
const client = await db.connect();

try {
  await client.query('BEGIN');

  // Main operation
  await client.query(`INSERT INTO "Lieferschein" ...`);

  // Optional operation with savepoint
  await client.query('SAVEPOINT sp1');

  try {
    // This might fail
    await client.query(`INSERT INTO "Schmuckstück" ...`);
  } catch (err) {
    // Rollback just this part
    await client.query('ROLLBACK TO sp1');
    logger.warn('TX', 'Savepoint rolled back');
  }

  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
```

## Migrations

### Structure

**Directory:** `/backend/db/migrations/`

**File Format:** `{YYYYMMDD_HHMMSS}_{description}.sql`

Examples:
- `20240101_000000_initial_schema.sql`
- `20240115_143000_add_audit_log.sql`
- `20240120_090000_add_indexes.sql`

### Migration Runner

**File:** `/backend/src/db/runMigrations.js`

```javascript
const fs = require('fs');
const path = require('path');
const db = require('../config/db');
const logger = require('../utils/logger');

async function runMigrations() {
  const migrationsDir = path.join(__dirname, '../db/migrations');

  // Ensure migrations table exists
  await db.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) UNIQUE NOT NULL,
      executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Get list of migration files
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  // Check which have been executed
  const executedResult = await db.query(
    'SELECT filename FROM migrations'
  );
  const executed = new Set(executedResult.rows.map(r => r.filename));

  // Run pending migrations
  for (const filename of files) {
    if (executed.has(filename)) {
      logger.debug('DB', `Migration already executed: ${filename}`);
      continue;
    }

    const filepath = path.join(migrationsDir, filename);
    const sql = fs.readFileSync(filepath, 'utf8');

    try {
      logger.info('DB', `Running migration: ${filename}`);

      await db.query(sql);
      await db.query('INSERT INTO migrations (filename) VALUES ($1)', [filename]);

      logger.info('DB', `Migration completed: ${filename}`);
    } catch (error) {
      logger.error('DB', `Migration failed: ${filename}`, {
        message: error.message,
        code: error.code
      });
      throw error;
    }
  }

  logger.info('DB', 'All migrations completed');
}

module.exports = { runMigrations };
```

### Running Migrations at Startup

**In `/backend/src/index.js`:**

```javascript
const { runMigrations } = require('./db/runMigrations');

async function start() {
  try {
    // Run migrations before starting server
    await runMigrations();

    // Start server
    const port = process.env.PORT || 5000;
    app.listen(port, () => {
      logger.info('SERVER', `Server running on port ${port}`);
    });
  } catch (error) {
    logger.error('STARTUP', 'Failed to start server', { message: error.message });
    process.exit(1);
  }
}

start();
```

## Query Optimization

### EXPLAIN ANALYZE

```javascript
async function analyzeQuery(query, params) {
  const result = await db.query(`EXPLAIN ANALYZE ${query}`, params);
  console.log(result.rows.map(r => r['QUERY PLAN']).join('\n'));
}

// Usage
await analyzeQuery(
  `SELECT * FROM "Schmuckstück" WHERE "Farbe" = $1 AND "Verkauft" = 0`,
  ['Blau']
);
```

### Common Index Patterns

```sql
-- Status filtering
CREATE INDEX idx_schmuckstueck_status ON "Schmuckstück" ("Verkauft", "Ausschuss", "Ausgelagert");

-- Prefix-based filtering
CREATE INDEX idx_hersteller ON "Schmuckstück" (SUBSTRING("Artikelnummer", 1, 1));
CREATE INDEX idx_grundmaterial ON "Schmuckstück" (SUBSTRING("Artikelnummer", 2, 1));

-- Attribute filtering
CREATE INDEX idx_farbe ON "Schmuckstück" ("Farbe");
CREATE INDEX idx_art ON "Schmuckstück" ("Art");

-- Foreign keys
CREATE INDEX idx_lieferschein_id ON "Schmuckstück" ("Lieferschein_ID");
CREATE INDEX idx_rechnung_id ON "Schmuckstück" ("Rechnung_ID");

-- Date filtering
CREATE INDEX idx_erstelldatum ON "Schmuckstück" ("Erstelldatum" DESC);

-- Full-text search
CREATE INDEX idx_name_search ON "Schmuckstück" USING gin(to_tsvector('german', "Name"));
```

## Connection Pool Configuration

**In `.env`:**

```bash
DATABASE_URL=postgresql://goldregen:password@db:5432/goldregendb?sslmode=disable

# Pool configuration
DB_POOL_MIN=2
DB_POOL_MAX=10
DB_POOL_IDLE_TIMEOUT=30000
DB_POOL_REAP_INTERVAL=1000
```

**In `/backend/src/config/db.js`:**

```javascript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  min: parseInt(process.env.DB_POOL_MIN || 2),
  max: parseInt(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT || 30000),
  connectionTimeoutMillis: 2000
});

pool.on('error', (err) => {
  logger.error('DB_POOL', 'Unexpected pool error', { message: err.message });
});

pool.on('connect', () => {
  logger.debug('DB_POOL', 'New connection acquired');
});
```

## Related Skills

- [Authentication & Authorization](./authentication.md) - User tracking in requests
- [Audit & Compliance](./audit-compliance.md) - Session user for triggers
- [Inventory Management](./inventory-management.md) - Query examples
- [Testing & Quality](./testing.md) - Testing database operations

## Troubleshooting

### "Client Already Released" Error

**Cause:** Double client.release() call
**Solution:**
1. Don't manually release in request handlers (middleware handles it)
2. Only release explicitly acquired clients from `connect()`
3. Check for multiple release() calls in error handlers

### Connection Pool Exhausted

**Cause:** Clients not being released
**Solution:**
1. Ensure all queries use the request-scoped client
2. Check for infinite loops acquiring connections
3. Increase pool max size
4. Monitor with: `SELECT COUNT(*) FROM pg_stat_activity;`

### Audit Trigger Not Capturing User

**Cause:** app.current_user not set
**Solution:**
1. Verify authenticate middleware is applied
2. Check setCurrentDbUsername is called
3. Verify set_config is called in connection setup
4. Test with direct SQL: `SELECT current_setting('app.current_user');`

### Slow Queries

**Cause:** Missing indexes or inefficient WHERE clauses
**Solution:**
1. Use EXPLAIN ANALYZE to identify bottlenecks
2. Add indexes on frequently filtered columns
3. Verify WHERE builder is used for Schmuckstück queries
4. Use query caching for read-heavy operations

### Transaction Deadlock

**Cause:** Concurrent transactions accessing tables in different order
**Solution:**
1. Ensure consistent lock ordering
2. Use SERIALIZABLE isolation level for critical sections
3. Implement retry logic with exponential backoff
4. Log deadlock errors for analysis

### Migration Failures

**Cause:** Schema conflicts or missing dependencies
**Solution:**
1. Test migrations in development first
2. Keep migrations reversible (include both up and down)
3. Check for conflicts with running applications
4. Use savepoints in complex migrations
