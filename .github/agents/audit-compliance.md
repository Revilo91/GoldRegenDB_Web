# Audit & Compliance Skill

## Overview

This skill covers audit logging, change tracking, compliance monitoring, and historical data analysis for jewelry inventory management and regulatory requirements.

## Core Concepts

### Audit Log

**Purpose:** Track all modifications to critical data for compliance and troubleshooting

**Table:** `audit_log`

**Schema:**
```sql
CREATE TABLE audit_log (
  id SERIAL PRIMARY KEY,
  table_name VARCHAR(255),
  artikelnummer_id VARCHAR(20),      -- For Schmuckstück changes
  column_name VARCHAR(255),          -- Which field changed
  old_value TEXT,                    -- Previous value
  new_value TEXT,                    -- New value
  action_type VARCHAR(50),           -- INSERT, UPDATE, DELETE
  changed_by VARCHAR(255),           -- User who made change (from app.current_user)
  change_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ip_address VARCHAR(45)             -- Optional IP address
);
```

### Tracked Tables

| Table | Critical Fields | Trigger | File |
|-------|-----------------|---------|------|
| `Schmuckstück` | Verkauft, Ausgelagert, Ausschuss, Rechnung_ID, Lieferschein_ID | `trg_audit_schmuckstueck` | `db/init.sql` |
| `Kunde` | Provision, Aktiv | `trg_audit_kunde` | `db/init.sql` |
| `Lieferschein` | Status | `trg_audit_lieferschein` | `db/init.sql` |
| `Rechnung` | Status, Zahlungsdatum | `trg_audit_rechnung` | `db/init.sql` |

## Key Files

- `/backend/src/routes/auditLog.js` - Audit log API
- `/backend/src/middleware/auth.js` - Sets current_user for audit
- `/db/init.sql` - Trigger definitions
- `/.github/copilot-instructions.md` - Business logic documentation

## Database Triggers

### Audit Trigger for Schmuckstück

**File:** `/db/init.sql`

```sql
CREATE OR REPLACE FUNCTION audit_schmuckstueck()
RETURNS TRIGGER AS $$
BEGIN
  -- Track Verkauft changes (item sold status)
  IF OLD."Verkauft" IS DISTINCT FROM NEW."Verkauft" THEN
    INSERT INTO audit_log (
      table_name, artikelnummer_id, column_name, old_value, new_value,
      action_type, changed_by, change_timestamp
    ) VALUES (
      'Schmuckstück', NEW."Artikelnummer", 'Verkauft',
      OLD."Verkauft"::TEXT, NEW."Verkauft"::TEXT,
      'UPDATE', current_setting('app.current_user', true), CURRENT_TIMESTAMP
    );
  END IF;

  -- Track Ausgelagert changes (consignment)
  IF OLD."Ausgelagert" IS DISTINCT FROM NEW."Ausgelagert" THEN
    INSERT INTO audit_log (
      table_name, artikelnummer_id, column_name, old_value, new_value,
      action_type, changed_by, change_timestamp
    ) VALUES (
      'Schmuckstück', NEW."Artikelnummer", 'Ausgelagert',
      OLD."Ausgelagert"::TEXT, NEW."Ausgelagert"::TEXT,
      'UPDATE', current_setting('app.current_user', true), CURRENT_TIMESTAMP
    );
  END IF;

  -- Track Ausschuss changes (item rejected/discarded)
  IF OLD."Ausschuss" IS DISTINCT FROM NEW."Ausschuss" THEN
    INSERT INTO audit_log (
      table_name, artikelnummer_id, column_name, old_value, new_value,
      action_type, changed_by, change_timestamp
    ) VALUES (
      'Schmuckstück', NEW."Artikelnummer", 'Ausschuss',
      OLD."Ausschuss"::TEXT, NEW."Ausschuss"::TEXT,
      'UPDATE', current_setting('app.current_user', true), CURRENT_TIMESTAMP
    );
  END IF;

  -- Track Rechnung_ID changes (invoice assignment)
  IF OLD."Rechnung_ID" IS DISTINCT FROM NEW."Rechnung_ID" THEN
    INSERT INTO audit_log (
      table_name, artikelnummer_id, column_name, old_value, new_value,
      action_type, changed_by, change_timestamp
    ) VALUES (
      'Schmuckstück', NEW."Artikelnummer", 'Rechnung_ID',
      OLD."Rechnung_ID"::TEXT, NEW."Rechnung_ID"::TEXT,
      'UPDATE', current_setting('app.current_user', true), CURRENT_TIMESTAMP
    );
  END IF;

  -- Track Lieferschein_ID changes (delivery note assignment)
  IF OLD."Lieferschein_ID" IS DISTINCT FROM NEW."Lieferschein_ID" THEN
    INSERT INTO audit_log (
      table_name, artikelnummer_id, column_name, old_value, new_value,
      action_type, changed_by, change_timestamp
    ) VALUES (
      'Schmuckstück', NEW."Artikelnummer", 'Lieferschein_ID',
      OLD."Lieferschein_ID"::TEXT, NEW."Lieferschein_ID"::TEXT,
      'UPDATE', current_setting('app.current_user', true), CURRENT_TIMESTAMP
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_schmuckstueck
  AFTER UPDATE ON "Schmuckstück"
  FOR EACH ROW
  EXECUTE FUNCTION audit_schmuckstueck();
```

### Setting Current User

**Authentication Middleware (`/backend/src/middleware/auth.js`):**

```javascript
const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Fetch user from database
    const result = await client.query(
      'SELECT id, username, role, email, tenant_id FROM app_users WHERE id = $1 AND active = TRUE',
      [decoded.userId]
    );

    req.user = result.rows[0];

    // Set database session user for audit triggers
    // This is crucial for audit logging to capture changed_by
    await client.query(
      "SELECT set_config('app.current_user', $1, false)",
      [req.user.username]
    );

    next();
  } catch (error) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
};
```

## API Endpoints

### List Audit Log

**Endpoint:** `GET /api/audit-log`

**Query Parameters:**
- `page` (INT) - Page number (default: 1)
- `limit` (INT) - Results per page (default: 100)
- `search` (STRING) - Search in all fields

**Response:**

```json
{
  "data": [
    {
      "id": 1,
      "table_name": "Schmuckstück",
      "artikelnummer_id": "MBH001",
      "column_name": "Verkauft",
      "old_value": "0",
      "new_value": "1",
      "action_type": "UPDATE",
      "changed_by": "bearbeiter",
      "change_timestamp": "2024-01-15T14:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 100,
    "total": 5420,
    "totalPages": 55
  }
}
```

**Implementation (`/backend/src/routes/auditLog.js`):**

```javascript
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';

    let where = [];
    let params = [];
    let paramIdx = 1;

    if (search) {
      where.push(`(
        artikelnummer_id ILIKE $${paramIdx} OR
        changed_by ILIKE $${paramIdx} OR
        old_value ILIKE $${paramIdx} OR
        new_value ILIKE $${paramIdx} OR
        column_name ILIKE $${paramIdx} OR
        action_type ILIKE $${paramIdx}
      )`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

    // Get total count
    const countResult = await db.query(
      `SELECT COUNT(*) FROM audit_log ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    // Get paginated results
    const { rows } = await db.query(
      `SELECT * FROM audit_log ${whereClause}
       ORDER BY change_timestamp DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
    );

    res.json({
      data: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    logger.error('AUDIT-LOG', 'Failed to fetch audit log', {
      message: err.message
    });
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});
```

### Get Change History for Item

**Endpoint:** `GET /api/audit-log/artikel/:artikelnummer`

**Response:**

```json
[
  {
    "id": 42,
    "table_name": "Schmuckstück",
    "artikelnummer_id": "MPA425_2",
    "column_name": "Ausgelagert",
    "old_value": "0",
    "new_value": "5",
    "action_type": "UPDATE",
    "changed_by": "marina",
    "change_timestamp": "2024-01-14T10:15:00Z"
  },
  {
    "id": 41,
    "table_name": "Schmuckstück",
    "artikelnummer_id": "MPA425_2",
    "column_name": "Lieferschein_ID",
    "old_value": "0",
    "new_value": "18",
    "action_type": "UPDATE",
    "changed_by": "marina",
    "change_timestamp": "2024-01-14T10:15:00Z"
  }
]
```

**Implementation:**

```javascript
router.get('/artikel/:artikelnummer', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM audit_log
       WHERE artikelnummer_id = $1
       ORDER BY change_timestamp DESC`,
      [req.params.artikelnummer]
    );

    res.json(rows);
  } catch (err) {
    logger.error('AUDIT-LOG', 'Failed to fetch item history', {
      message: err.message,
      artikelnummer: req.params.artikelnummer
    });
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});
```

## Frontend Integration

### Audit Log View

```javascript
// frontend/src/pages/AuditLog.jsx
import React, { useState, useEffect } from 'react';
import { api } from '../api';

export default function AuditLog() {
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 50,
    total: 0
  });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadLogs();
  }, [pagination.page, search]);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const response = await api.get('/api/audit-log', {
        page: pagination.page,
        limit: pagination.limit,
        search: search
      });

      setLogs(response.data);
      setPagination(response.pagination);
    } catch (error) {
      console.error('Failed to load audit log:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="audit-log-container">
      <h1>Audit Log</h1>

      <input
        type="text"
        placeholder="Search..."
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPagination(prev => ({ ...prev, page: 1 }));
        }}
      />

      <table>
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>User</th>
            <th>Article</th>
            <th>Field</th>
            <th>Old Value</th>
            <th>New Value</th>
          </tr>
        </thead>
        <tbody>
          {logs.map(log => (
            <tr key={log.id}>
              <td>{new Date(log.change_timestamp).toLocaleString()}</td>
              <td>{log.changed_by}</td>
              <td>{log.artikelnummer_id}</td>
              <td>{log.column_name}</td>
              <td className="old-value">{log.old_value}</td>
              <td className="new-value">{log.new_value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Pagination controls */}
    </div>
  );
}
```

### Item History View

```javascript
// Within an item detail page
async function loadItemHistory(artikelnummer) {
  try {
    const history = await api.get(`/api/audit-log/artikel/${artikelnummer}`);
    setHistory(history);
  } catch (error) {
    console.error('Failed to load history:', error);
  }
}
```

## Analytics Queries

### Sales Timeline

```sql
SELECT
  DATE(change_timestamp) as date,
  COUNT(*) as sales_count,
  COUNT(DISTINCT changed_by) as unique_users
FROM audit_log
WHERE column_name = 'Verkauft' AND new_value = '1'
GROUP BY DATE(change_timestamp)
ORDER BY date DESC;
```

### User Activity Report

```sql
SELECT
  changed_by,
  COUNT(*) as total_changes,
  COUNT(DISTINCT artikelnummer_id) as items_modified,
  COUNT(*) FILTER (WHERE column_name = 'Verkauft') as sales,
  COUNT(*) FILTER (WHERE column_name = 'Ausgelagert') as consignments,
  MAX(change_timestamp) as last_activity
FROM audit_log
WHERE change_timestamp > CURRENT_TIMESTAMP - INTERVAL '30 days'
GROUP BY changed_by
ORDER BY total_changes DESC;
```

### Change Frequency

```sql
SELECT
  column_name,
  COUNT(*) as change_count,
  COUNT(DISTINCT artikelnummer_id) as affected_items,
  AVG(EXTRACT(EPOCH FROM (lead(change_timestamp) OVER (ORDER BY change_timestamp) - change_timestamp))) as avg_seconds_between_changes
FROM audit_log
WHERE table_name = 'Schmuckstück'
GROUP BY column_name
ORDER BY change_count DESC;
```

## Related Skills

- [Authentication & Authorization](./authentication.md) - User tracking in audit logs
- [Inventory Management](./inventory-management.md) - What gets audited
- [Database Operations](./database-operations.md) - Trigger and session configuration
- [Testing & Quality](./testing.md) - Testing audit functionality

## Troubleshooting

### Changed_by Shows "anonym"

**Cause:** Database session user not set
**Solution:**
1. Verify authenticate middleware calls set_config
2. Check JWT_SECRET is correct
3. Ensure request context exists (not background job)

### No Audit Records Created

**Cause:** Triggers not firing
**Solution:**
1. Verify triggers exist: `\dt+ audit_log`
2. Check trigger function is compiled: `\df audit_schmuckstueck`
3. Verify data is actually changing
4. Check database logs for trigger errors

### Slow Audit Log Queries

**Cause:** Missing indexes
**Solution:**
1. Create index on change_timestamp: `CREATE INDEX idx_audit_timestamp ON audit_log(change_timestamp DESC);`
2. Create index on artikelnummer: `CREATE INDEX idx_audit_artikelnummer ON audit_log(artikelnummer_id);`
3. Create index on changed_by: `CREATE INDEX idx_audit_user ON audit_log(changed_by);`

### Audit Log Grows Too Large

**Cause:** Years of history accumulating
**Solution:**
1. Archive old records: `INSERT INTO audit_log_archive SELECT * FROM audit_log WHERE change_timestamp < NOW() - INTERVAL '1 year';`
2. Delete archived records: `DELETE FROM audit_log WHERE change_timestamp < NOW() - INTERVAL '1 year';`
3. Implement retention policy in application

### Compliance Reporting Issues

**Cause:** Incomplete or unclear audit trail
**Solution:**
1. Include IP address in audit_log
2. Track session IDs for session-level correlation
3. Create comprehensive audit export with filters
4. Document business logic for each audit trail entry
