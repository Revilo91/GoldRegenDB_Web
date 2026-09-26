# Customer Management Skill

## Overview

This skill covers managing customers/dealers (Kunden), consignment tracking (Ausgelagert), and commission management in the GoldRegenDB system.

## Core Concepts

### Kunde (Customer) Schema

**Table:** `Kunde`
**Primary Key:** `Name` (VARCHAR(100))
**Unique Key:** `ID` (SERIAL)

**Attributes:**
- **Identity:** ID, Name
- **Address:** Strasse, Hausnummer, Ort, PLZ
- **Contact:** Email, Telefonnummer
- **Business:** Provision (0-40%), Aktiv (boolean)
- **Multi-tenancy:** tenant_id

### Customer Types

Customers in GoldRegenDB represent different sales channels:

- **Retail Shops** - Physical stores selling consigned jewelry
- **Online Platforms** - E-commerce channels
- **Trade Shows** - Temporary event-based sales (Messen)
- **Custom Orders** - Special commission work (Sonderanfertigung)
- **Storage Locations** - Warehouses (using Ausgelagert = 0 for main stock)

### Commission (Provision)

- **Range:** 0% to 40%
- **Usage:** Calculated on Verkaufspreis when item is sold while consigned
- **Example:** Item at 100€ with 30% commission → Customer keeps 70€, supplier gets 30€

## Key Files

- `/backend/src/routes/kunden.js` - Customer CRUD and operations
- `/frontend/src/pages/Kunden.jsx` - Customer management UI
- `/frontend/src/pages/Inventur.jsx` - Inventory per customer

## API Endpoints

### List Customers

**Endpoint:** `GET /api/kunden`

**Query Parameters:**
- `aktiv` - Filter by active status (true/false)
- `search` - Search in Name, Ort, or Email

**Response:**
```json
[
  {
    "ID": 1,
    "Name": "Schmuckgalerie Dresden",
    "Strasse": "Hauptstraße",
    "Hausnummer": 42,
    "Ort": "Dresden",
    "PLZ": 1069,
    "Email": "info@schmuckgalerie-dd.de",
    "Telefonnummer": "+49 351 123456",
    "Provision": 30,
    "Aktiv": true,
    "tenant_id": 1
  }
]
```

**Implementation:**
```javascript
router.get('/', authenticate, requireBearbeiter, async (req, res) => {
  const { aktiv, search } = req.query;
  const { tenant_id } = req.user;

  let query = 'SELECT * FROM "Kunde" WHERE tenant_id = $1';
  const params = [tenant_id ?? 1];
  let paramCount = 2;

  // Filter by active status
  if (aktiv !== undefined) {
    query += ` AND "Aktiv" = $${paramCount}`;
    params.push(aktiv === 'true');
    paramCount++;
  }

  // Search filter
  if (search) {
    query += ` AND ("Name" ILIKE $${paramCount} OR "Ort" ILIKE $${paramCount} OR "Email" ILIKE $${paramCount})`;
    params.push(`%${search}%`);
    paramCount++;
  }

  query += ' ORDER BY "Name"';

  const result = await db.query(query, params);
  res.json(result.rows);
});
```

### Get Customer Details

**Endpoint:** `GET /api/kunden/:id`

**Response:**
```json
{
  "kunde": {
    "ID": 1,
    "Name": "Schmuckgalerie Dresden",
    "Provision": 30,
    "Aktiv": true
  },
  "statistics": {
    "total_consigned": 15,
    "total_sold": 8,
    "total_value_consigned": 450.00,
    "total_value_sold": 320.00,
    "commission_owed": 96.00
  }
}
```

**Implementation:**
```javascript
router.get('/:id', authenticate, requireBearbeiter, async (req, res) => {
  const kundeId = parseInt(req.params.id);

  // Get customer data
  const kundeResult = await db.query(
    'SELECT * FROM "Kunde" WHERE "ID" = $1 AND tenant_id = $2',
    [kundeId, req.user.tenant_id ?? 1]
  );

  if (kundeResult.rows.length === 0) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  const kunde = kundeResult.rows[0];

  // Get consigned items statistics
  const builder = where();
  builder.aktivAusgelagert(kundeId);

  const statsQuery = `
    SELECT
      COUNT(*) as total_consigned,
      COALESCE(SUM("Verkaufspreis"), 0) as total_value_consigned
    FROM "Schmuckstück"
    ${builder.build()}
  `;

  const statsResult = await db.query(statsQuery, builder.getParams());

  // Get sold items from this customer
  const soldBuilder = where();
  soldBuilder.verkauft();
  soldBuilder.field('Ausgelagert', '=', kundeId);

  const soldQuery = `
    SELECT
      COUNT(*) as total_sold,
      COALESCE(SUM("Verkaufspreis"), 0) as total_value_sold
    FROM "Schmuckstück"
    ${soldBuilder.build()}
  `;

  const soldResult = await db.query(soldQuery, soldBuilder.getParams());

  // Calculate commission owed
  const commissionRate = kunde.Provision / 100;
  const totalValueSold = parseFloat(soldResult.rows[0].total_value_sold);
  const commissionOwed = totalValueSold * commissionRate;

  res.json({
    kunde,
    statistics: {
      total_consigned: parseInt(statsResult.rows[0].total_consigned),
      total_sold: parseInt(soldResult.rows[0].total_sold),
      total_value_consigned: parseFloat(statsResult.rows[0].total_value_consigned),
      total_value_sold: totalValueSold,
      commission_owed: commissionOwed
    }
  });
});
```

### Get Customer's Schmuckstücke

**Endpoint:** `GET /api/kunden/:id/schmuckstuecke`

**Query Parameters:**
- `status` - verfuegbar | verkauft (filters consigned items)

**Response:**
```json
[
  {
    "Artikelnummer": "MBH001_1",
    "Name": "Beton Halskette Ozean",
    "Verkaufspreis": 35.00,
    "Ausgelagert": 1,
    "Verkauft": 0,
    "hatFoto": true
  }
]
```

**Implementation:**
```javascript
router.get('/:id/schmuckstuecke', authenticate, requireBearbeiter, async (req, res) => {
  const kundeId = parseInt(req.params.id);
  const { status } = req.query;

  const builder = where();

  if (status === 'verkauft') {
    // Sold items that were consigned to this customer
    builder.verkauft();
    builder.field('Ausgelagert', '=', kundeId);
  } else {
    // Currently consigned items (default)
    builder.aktivAusgelagert(kundeId);
  }

  const query = `
    SELECT * FROM "Schmuckstück"
    ${builder.build()}
    ORDER BY "Erstelldatum" DESC
  `;

  const result = await db.query(query, builder.getParams());
  res.json(result.rows);
});
```

### Create Customer

**Endpoint:** `POST /api/kunden`

**Request:**
```json
{
  "Name": "Neue Galerie",
  "Strasse": "Teststraße",
  "Hausnummer": 10,
  "Ort": "Leipzig",
  "PLZ": 4103,
  "Email": "info@neue-galerie.de",
  "Telefonnummer": "+49 341 987654",
  "Provision": 25,
  "Aktiv": true
}
```

**Validation:**
- Name must be unique (primary key)
- Provision must be between 0 and 100
- Email format validation (optional)
- PLZ must be numeric

**Implementation:**
```javascript
router.post('/', authenticate, requireBearbeiter, async (req, res) => {
  const { Name, Strasse, Hausnummer, Ort, PLZ, Email, Telefonnummer, Provision, Aktiv } = req.body;

  // Validate Name uniqueness
  const existing = await db.query(
    'SELECT "Name" FROM "Kunde" WHERE "Name" = $1 AND tenant_id = $2',
    [Name, req.user.tenant_id ?? 1]
  );

  if (existing.rows.length > 0) {
    return res.status(400).json({ error: 'Customer with this name already exists' });
  }

  // Validate Provision range
  if (Provision < 0 || Provision > 100) {
    return res.status(400).json({ error: 'Provision must be between 0 and 100' });
  }

  // Insert customer
  const result = await db.query(
    `INSERT INTO "Kunde"
     ("Name", "Strasse", "Hausnummer", "Ort", "PLZ", "Email", "Telefonnummer", "Provision", "Aktiv", "tenant_id")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [Name, Strasse, Hausnummer, Ort, PLZ, Email, Telefonnummer, Provision, Aktiv !== false, req.user.tenant_id ?? 1]
  );

  res.status(201).json(result.rows[0]);
});
```

### Update Customer

**Endpoint:** `PUT /api/kunden/:id`

**Request:** Partial updates supported

**Implementation:**
```javascript
router.put('/:id', authenticate, requireBearbeiter, async (req, res) => {
  const kundeId = parseInt(req.params.id);
  const data = req.body;

  // Validate Provision if provided
  if (data.Provision !== undefined && (data.Provision < 0 || data.Provision > 100)) {
    return res.status(400).json({ error: 'Provision must be between 0 and 100' });
  }

  // If changing Name, check uniqueness
  if (data.Name) {
    const existing = await db.query(
      'SELECT "ID" FROM "Kunde" WHERE "Name" = $1 AND "ID" != $2 AND tenant_id = $3',
      [data.Name, kundeId, req.user.tenant_id ?? 1]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Customer with this name already exists' });
    }
  }

  // Build dynamic UPDATE
  const fields = [];
  const values = [];
  let paramCount = 1;

  for (const [key, value] of Object.entries(data)) {
    if (key !== 'ID' && key !== 'tenant_id') {
      fields.push(`"${key}" = $${paramCount}`);
      values.push(value);
      paramCount++;
    }
  }

  values.push(kundeId);
  values.push(req.user.tenant_id ?? 1);

  const query = `
    UPDATE "Kunde"
    SET ${fields.join(', ')}
    WHERE "ID" = $${paramCount} AND tenant_id = $${paramCount + 1}
    RETURNING *
  `;

  const result = await db.query(query, values);

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  res.json(result.rows[0]);
});
```

### Delete Customer

**Endpoint:** `DELETE /api/kunden/:id`

**Business Logic:** Cannot delete customer with active consignments

**Implementation:**
```javascript
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  const kundeId = parseInt(req.params.id);

  // Check for active consignments
  const builder = where();
  builder.aktivAusgelagert(kundeId);

  const consignedCheck = await db.query(
    `SELECT COUNT(*) as count FROM "Schmuckstück" ${builder.build()}`,
    builder.getParams()
  );

  if (parseInt(consignedCheck.rows[0].count) > 0) {
    return res.status(400).json({
      error: 'Cannot delete customer with active consignments',
      consigned_items: parseInt(consignedCheck.rows[0].count)
    });
  }

  // Soft delete: mark as inactive instead
  const result = await db.query(
    `UPDATE "Kunde"
     SET "Aktiv" = FALSE
     WHERE "ID" = $1 AND tenant_id = $2
     RETURNING *`,
    [kundeId, req.user.tenant_id ?? 1]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  res.json({ message: 'Customer deactivated', kunde: result.rows[0] });
});
```

## Consignment Operations

### Restock All Items

**Endpoint:** `PUT /api/kunden/:id/restock`

**Description:** Return all consigned items from a customer back to stock

**Implementation:**
```javascript
router.put('/:id/restock', authenticate, requireBearbeiter, async (req, res) => {
  const kundeId = parseInt(req.params.id);

  // Verify customer exists
  const kundeCheck = await db.query(
    'SELECT "ID", "Name" FROM "Kunde" WHERE "ID" = $1 AND tenant_id = $2',
    [kundeId, req.user.tenant_id ?? 1]
  );

  if (kundeCheck.rows.length === 0) {
    return res.status(404).json({ error: 'Customer not found' });
  }

  // Get all actively consigned items
  const builder = where();
  builder.aktivAusgelagert(kundeId);

  const itemsQuery = `
    SELECT "Artikelnummer" FROM "Schmuckstück"
    ${builder.build()}
  `;

  const itemsResult = await db.query(itemsQuery, builder.getParams());

  // Return all to stock
  const updateResult = await db.query(
    `UPDATE "Schmuckstück"
     SET "Ausgelagert" = 0, "Lieferschein_ID" = 0
     WHERE "Ausgelagert" = $1 AND "Verkauft" = 0 AND "Ausschuss" = 0`,
    [kundeId]
  );

  res.json({
    message: `Returned ${updateResult.rowCount} items to stock`,
    customer: kundeCheck.rows[0].Name,
    items_returned: updateResult.rowCount,
    artikelnummern: itemsResult.rows.map(r => r.Artikelnummer)
  });
});
```

### Restock Selected Items

**Endpoint:** `PUT /api/kunden/:id/restock-selective`

**Request:**
```json
{
  "artikelnummern": ["MBH001_1", "MPA002_3", "SWA010_2"]
}
```

**Implementation:**
```javascript
router.put('/:id/restock-selective', authenticate, requireBearbeiter, async (req, res) => {
  const kundeId = parseInt(req.params.id);
  const { artikelnummern } = req.body;

  if (!Array.isArray(artikelnummern) || artikelnummern.length === 0) {
    return res.status(400).json({ error: 'artikelnummern array required' });
  }

  // Verify all items are consigned to this customer
  const builder = where();
  builder.aktivAusgelagert(kundeId);

  const placeholders = artikelnummern.map((_, i) => `$${i + 1}`).join(', ');
  const verifyQuery = `
    SELECT "Artikelnummer"
    FROM "Schmuckstück"
    WHERE "Artikelnummer" IN (${placeholders})
    AND "Ausgelagert" = ${kundeId}
    AND "Verkauft" = 0
    AND "Ausschuss" = 0
  `;

  const verifyResult = await db.query(verifyQuery, artikelnummern);

  if (verifyResult.rows.length !== artikelnummern.length) {
    const found = verifyResult.rows.map(r => r.Artikelnummer);
    const notFound = artikelnummern.filter(a => !found.includes(a));

    return res.status(400).json({
      error: 'Some items not found or not consigned to this customer',
      not_found: notFound
    });
  }

  // Return selected items to stock
  const updateQuery = `
    UPDATE "Schmuckstück"
    SET "Ausgelagert" = 0, "Lieferschein_ID" = 0
    WHERE "Artikelnummer" IN (${placeholders})
  `;

  const updateResult = await db.query(updateQuery, artikelnummern);

  res.json({
    message: `Returned ${updateResult.rowCount} items to stock`,
    items_returned: updateResult.rowCount,
    artikelnummern
  });
});
```

## Frontend Integration

### Customer List Component

```javascript
// frontend/src/pages/Kunden.jsx
import React, { useState, useEffect } from 'react';
import { getKunden, createKunde, updateKunde } from '../api';

function Kunden() {
  const [kunden, setKunden] = useState([]);
  const [selectedKunde, setSelectedKunde] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [filters, setFilters] = useState({
    aktiv: 'true',
    search: ''
  });

  useEffect(() => {
    loadKunden();
  }, [filters]);

  const loadKunden = async () => {
    const data = await getKunden(filters);
    setKunden(data);
  };

  const handleCreate = async (formData) => {
    await createKunde(formData);
    loadKunden();
    setShowForm(false);
  };

  const handleUpdate = async (id, formData) => {
    await updateKunde(id, formData);
    loadKunden();
    setSelectedKunde(null);
  };

  return (
    <div>
      <h1>Kundenverwaltung</h1>

      {/* Filters */}
      <div className="filters">
        <select
          value={filters.aktiv}
          onChange={(e) => setFilters({ ...filters, aktiv: e.target.value })}
        >
          <option value="">Alle</option>
          <option value="true">Nur Aktive</option>
          <option value="false">Nur Inaktive</option>
        </select>

        <input
          type="text"
          placeholder="Suche..."
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
        />

        <button onClick={() => setShowForm(true)}>Neuer Kunde</button>
      </div>

      {/* Customer List */}
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Ort</th>
            <th>Provision</th>
            <th>Status</th>
            <th>Aktionen</th>
          </tr>
        </thead>
        <tbody>
          {kunden.map(kunde => (
            <tr key={kunde.ID}>
              <td>{kunde.Name}</td>
              <td>{kunde.Ort}</td>
              <td>{kunde.Provision}%</td>
              <td>{kunde.Aktiv ? 'Aktiv' : 'Inaktiv'}</td>
              <td>
                <button onClick={() => setSelectedKunde(kunde)}>Bearbeiten</button>
                <button onClick={() => viewInventory(kunde.ID)}>Inventur</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

### Customer Inventory View

```javascript
// frontend/src/pages/Inventur.jsx
import React, { useState, useEffect } from 'react';
import { getKunden, getKundeSchmuckstuecke, restockAll } from '../api';

function Inventur() {
  const [kunden, setKunden] = useState([]);
  const [selectedKunde, setSelectedKunde] = useState(null);
  const [items, setItems] = useState([]);
  const [statistics, setStatistics] = useState({});

  useEffect(() => {
    loadKunden();
  }, []);

  const loadKunden = async () => {
    const data = await getKunden({ aktiv: 'true' });
    setKunden(data);
  };

  const loadKundeInventory = async (kundeId) => {
    const data = await getKundeSchmuckstuecke(kundeId);
    setItems(data);
    calculateStatistics(data);
  };

  const calculateStatistics = (items) => {
    const total = items.length;
    const totalValue = items.reduce((sum, item) => sum + item.Verkaufspreis, 0);

    setStatistics({ total, totalValue });
  };

  const handleRestockAll = async (kundeId) => {
    if (confirm('Alle Artikel zurücklagern?')) {
      await restockAll(kundeId);
      loadKundeInventory(kundeId);
    }
  };

  return (
    <div>
      <h1>Inventur pro Kunde</h1>

      <select onChange={(e) => {
        const kundeId = parseInt(e.target.value);
        setSelectedKunde(kundeId);
        loadKundeInventory(kundeId);
      }}>
        <option value="">Kunde wählen...</option>
        {kunden.map(kunde => (
          <option key={kunde.ID} value={kunde.ID}>{kunde.Name}</option>
        ))}
      </select>

      {selectedKunde && (
        <>
          <div className="statistics">
            <div className="stat">
              <span>Gesamt:</span>
              <strong>{statistics.total} Stück</strong>
            </div>
            <div className="stat">
              <span>Wert:</span>
              <strong>{statistics.totalValue?.toFixed(2)} €</strong>
            </div>
          </div>

          <button onClick={() => handleRestockAll(selectedKunde)}>
            Alle zurücklagern
          </button>

          <table>
            <thead>
              <tr>
                <th>Artikelnummer</th>
                <th>Name</th>
                <th>Preis</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.Artikelnummer}>
                  <td>{item.Artikelnummer}</td>
                  <td>{item.Name}</td>
                  <td>{item.Verkaufspreis} €</td>
                  <td>{item.Verkauft ? 'Verkauft' : 'Ausgelagert'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
```

## Business Logic Patterns

### Commission Calculation

```javascript
function calculateCommission(verkaufspreis, provisionRate) {
  const commission = verkaufspreis * (provisionRate / 100);
  return {
    total: verkaufspreis,
    commission: commission,
    supplier_receives: verkaufspreis - commission,
    customer_keeps: commission
  };
}

// Example: 100€ item with 30% commission
const breakdown = calculateCommission(100, 30);
// {
//   total: 100,
//   commission: 30,
//   supplier_receives: 70,
//   customer_keeps: 30
// }
```

### Consignment Report

```javascript
async function generateConsignmentReport(kundeId) {
  const builder = where();
  builder.aktivAusgelagert(kundeId);

  const query = `
    SELECT
      "Artikelnummer",
      "Name",
      "Verkaufspreis",
      "Erstelldatum",
      "Lieferschein_ID"
    FROM "Schmuckstück"
    ${builder.build()}
    ORDER BY "Erstelldatum" DESC
  `;

  const items = await db.query(query, builder.getParams());

  const totalValue = items.rows.reduce(
    (sum, item) => sum + parseFloat(item.Verkaufspreis),
    0
  );

  return {
    items: items.rows,
    count: items.rows.length,
    totalValue,
    generatedAt: new Date()
  };
}
```

## Testing

### Customer CRUD Tests

```javascript
// backend/__tests__/kunden.routes.test.js
describe('Kunden Routes', () => {
  test('create customer with valid data', async () => {
    const newKunde = {
      Name: 'Test Galerie',
      Ort: 'Berlin',
      Provision: 25,
      Aktiv: true
    };

    const response = await request(app)
      .post('/api/kunden')
      .set('Authorization', `Bearer ${token}`)
      .send(newKunde)
      .expect(201);

    expect(response.body.Name).toBe('Test Galerie');
    expect(response.body.Provision).toBe(25);
  });

  test('reject duplicate customer name', async () => {
    // Create first customer
    await request(app)
      .post('/api/kunden')
      .set('Authorization', `Bearer ${token}`)
      .send({ Name: 'Duplicate' });

    // Try to create duplicate
    const response = await request(app)
      .post('/api/kunden')
      .set('Authorization', `Bearer ${token}`)
      .send({ Name: 'Duplicate' })
      .expect(400);

    expect(response.body.error).toContain('already exists');
  });

  test('restock all items from customer', async () => {
    const response = await request(app)
      .put('/api/kunden/1/restock')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.items_returned).toBeGreaterThanOrEqual(0);
  });
});
```

## Related Skills

- [Inventory Management](./inventory-management.md) - Consignment tracking (Ausgelagert)
- [Document Generation](./document-generation.md) - Lieferscheine for consignments
- [Reporting & Analytics](./reporting-analytics.md) - Customer statistics
- [Database Operations](./database-operations.md) - Query patterns

## Troubleshooting

### Cannot Delete Customer

**Cause:** Customer has active consignments
**Solution:**
1. Restock all items first using `/api/kunden/:id/restock`
2. Then deactivate or delete customer

### Commission Calculation Incorrect

**Cause:** Provision rate confusion (percentage vs decimal)
**Solution:** Store as integer (0-100), divide by 100 for calculation

### Customer Not Appearing in Lists

**Cause:** Inactive customer with aktiv filter enabled
**Solution:** Check Aktiv status or remove filter
