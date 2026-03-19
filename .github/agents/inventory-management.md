# Inventory Management Skill

## Overview

This skill covers managing jewelry items (Schmuckstücke) with 34+ attributes, complex filtering using the mandatory WHERE clause builder, and business logic enforcement.

## Core Concepts

### Schmuckstück (Jewelry Item) Schema

**Table:** `Schmuckstück`
**Primary Key:** `Artikelnummer` (VARCHAR(20))

**Key Attributes:**
- **Identity:** Artikelnummer, Name, Art, Form
- **Physical:** Laenge, Groesse, Material, Farbe
- **Composition:** Inhalt_Material, Inhalt_Farbe, Fassung, Zwischenstueck
- **Pendant (Anhänger):** Anhaenger_*, 10+ attributes
- **Pricing:** Herstellungskosten, Verkaufspreis
- **Status:** Verkauft, Ausschuss, Ausgelagert
- **Associations:** Lieferschein_ID, Rechnung_ID
- **Photo:** Foto (filename)
- **Audit:** Erstelldatum, Letzte_Aenderung

### Business Rules

**CRITICAL RULE:** Verkauft and Ausschuss are mutually exclusive!

```
✓ Verkauft = 1 AND Ausschuss = 0  (Item sold)
✓ Ausschuss = 1 AND Verkauft = 0  (Item discarded)
✗ Verkauft = 1 AND Ausschuss = 1  (INVALID - never both!)
```

**Status States:**

| State | Verkauft | Ausschuss | Ausgelagert | Meaning |
|-------|----------|-----------|-------------|---------|
| Verfügbar | 0 | 0 | 0 | Available in stock |
| Ausgelagert | 0 | 0 | > 0 | Consigned to customer |
| Verkauft | 1 | 0 | - | Sold (regardless of consignment) |
| Ausschuss | - | 1 | - | Discarded (requires Ausschuss_Grund) |

**Constraint:** If `Ausschuss = 1`, then `Ausschuss_Grund` must be non-empty.

### Artikelnummer Format

**Pattern:** `[Hersteller][Grundmaterial][Produktart]###_Suffix`

**Example:** `MBH001_1`
- `M` = Marina (Hersteller)
- `B` = Beton (Grundmaterial)
- `H` = Halskette (Produktart)
- `001` = Type number
- `_1` = Instance suffix (for duplicates)

**Hersteller (1st character):**
- `M` = Marina
- `S` = Saskia

**Grundmaterial (2nd character):**
- `A` = Alkoholtinte, `B` = Beton, `C` = Cucio, `E` = Edelstahl
- `F` = Fimo, `H` = Harz, `I` = Phiole, `J` = Papier
- `K` = Kordel, `L` = Leder, `M` = Makramee, `N` = Naturstein
- `P` = Perle, `S` = Schrumpffolie, `W` = Holz
- `X` = 3D-Druck, `Y` = Cabochon

**Produktart (3rd character):**
- `A` = Armband (Bracelet)
- `H` = Halskette (Necklace)
- `O` = Ohrring (Earring)
- `S` = Schlüsselanhänger (Keychain)

## WHERE Clause Builder (MANDATORY!)

**⚠️ CRITICAL:** All queries filtering Schmuckstücke **MUST** use the WHERE clause builder!

### File Location
`/backend/src/utils/whereClauseBuilder.js`

### Full Documentation
`/backend/src/utils/WHERE_BUILDER.md`

### Basic Usage

```javascript
const { where } = require('../utils/whereClauseBuilder');

// Create builder instance
const builder = where();

// Add filters
builder.verfuegbar();              // Available items only
builder.grundmaterial('P');        // Perle (Pearl)
builder.produktart('A');           // Armband (Bracelet)

// Build SQL WHERE clause
const query = `SELECT * FROM "Schmuckstück" ${builder.build()}`;
const params = builder.getParams();

// Execute query
const result = await db.query(query, params);
```

### Status Filters

```javascript
const builder = where();

// Available items (not sold, not discarded, not consigned)
builder.verfuegbar();
// WHERE Verkauft = 0 AND Ausschuss = 0 AND Ausgelagert = 0

// Sold items (excludes discarded items!)
builder.verkauft();
// WHERE Verkauft = 1 AND Ausschuss = 0

// Discarded items
builder.ausschuss();
// WHERE Ausschuss = 1

// Consigned items (active consignments only)
builder.aktivAusgelagert();
// WHERE Ausgelagert > 0 AND Verkauft = 0 AND Ausschuss = 0

// Consigned to specific customer
builder.aktivAusgelagert(5);
// WHERE Ausgelagert = 5 AND Verkauft = 0 AND Ausschuss = 0
```

### Prefix Filters

```javascript
const builder = where();

// Filter by manufacturer
builder.hersteller('M');
// WHERE SUBSTRING("Artikelnummer", 1, 1) = 'M'

// Filter by base material
builder.grundmaterial('B');
// WHERE SUBSTRING("Artikelnummer", 2, 1) = 'B'

// Filter by product type
builder.produktart('H');
// WHERE SUBSTRING("Artikelnummer", 3, 1) = 'H'

// Combine multiple prefix filters
builder.hersteller('M');
builder.grundmaterial('P');
builder.produktart('A');
// Marina's pearl bracelets
```

### Attribute Filters

```javascript
const builder = where();

// Filter by attributes
builder.art('Kette');
builder.farbe('Blau');
builder.material('Edelstahl');

// Custom field filters
builder.field('Name', 'like', 'Ozean%');
builder.field('Verkaufspreis', '>=', 25.00);
builder.field('Lieferschein_ID', '=', 42);
```

### Complex Example

```javascript
// Find available Marina pearl necklaces, blue color, price 20-50 EUR
const builder = where();
builder.verfuegbar();
builder.hersteller('M');
builder.grundmaterial('P');
builder.produktart('H');
builder.farbe('Blau');
builder.field('Verkaufspreis', '>=', 20);
builder.field('Verkaufspreis', '<=', 50);

const query = `
  SELECT * FROM "Schmuckstück"
  ${builder.build()}
  ORDER BY "Erstelldatum" DESC
`;
const result = await db.query(query, builder.getParams());
```

## API Endpoints

### List Schmuckstücke

**Endpoint:** `GET /api/schmuckstuecke`

**Query Parameters:**
- `status` - verfuegbar | verkauft | ausschuss | ausgelagert
- `hersteller` - M | S
- `grundmaterial` - A | B | C | E | F | H | I | J | K | L | M | N | P | S | W | X | Y
- `produktart` - A | H | O | S
- `art` - Filter by Art attribute
- `farbe` - Filter by Farbe attribute
- `material` - Filter by Material attribute
- `ausgelagert` - Customer ID (for consignment filtering)
- `search` - Search in Name or Artikelnummer

**Implementation:**
```javascript
router.get('/', authenticate, requireBearbeiter, async (req, res) => {
  const {
    status, hersteller, grundmaterial, produktart,
    art, farbe, material, ausgelagert, search
  } = req.query;

  const builder = where();

  // Apply status filter
  if (status === 'verfuegbar') builder.verfuegbar();
  else if (status === 'verkauft') builder.verkauft();
  else if (status === 'ausschuss') builder.ausschuss();
  else if (status === 'ausgelagert') builder.aktivAusgelagert();

  // Apply prefix filters
  if (hersteller) builder.hersteller(hersteller);
  if (grundmaterial) builder.grundmaterial(grundmaterial);
  if (produktart) builder.produktart(produktart);

  // Apply attribute filters
  if (art) builder.art(art);
  if (farbe) builder.farbe(farbe);
  if (material) builder.material(material);
  if (ausgelagert) builder.field('Ausgelagert', '=', parseInt(ausgelagert));

  // Apply search
  if (search) {
    builder.or([
      { field: 'Name', op: 'ilike', value: `%${search}%` },
      { field: 'Artikelnummer', op: 'ilike', value: `%${search}%` }
    ]);
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

### Get Filter Options

**Endpoint:** `GET /api/schmuckstuecke/filter-options`

**Response:**
```json
{
  "art": ["Kette", "Armband", "Ohrringe"],
  "farbe": ["Blau", "Grün", "Rot", "Gold"],
  "material": ["Beton", "Perle", "Holz"],
  "form": ["Rund", "Oval", "Eckig"],
  "hersteller": [
    { "code": "M", "name": "Marina" },
    { "code": "S", "name": "Saskia" }
  ],
  "grundmaterial": [
    { "code": "B", "name": "Beton" },
    { "code": "P", "name": "Perle" }
  ],
  "produktart": [
    { "code": "A", "name": "Armband" },
    { "code": "H", "name": "Halskette" }
  ]
}
```

**Implementation:**
```javascript
router.get('/filter-options', authenticate, requireBearbeiter, async (req, res) => {
  // Query distinct values for dropdown filters
  const artResult = await db.query(
    'SELECT DISTINCT "Art" FROM "Schmuckstück" WHERE "Art" IS NOT NULL ORDER BY "Art"'
  );

  const farbeResult = await db.query(
    'SELECT DISTINCT "Farbe" FROM "Schmuckstück" WHERE "Farbe" IS NOT NULL ORDER BY "Farbe"'
  );

  // ... similar queries for other attributes

  res.json({
    art: artResult.rows.map(r => r.Art),
    farbe: farbeResult.rows.map(r => r.Farbe),
    // ... static mappings for prefix codes
    hersteller: [
      { code: 'M', name: 'Marina' },
      { code: 'S', name: 'Saskia' }
    ],
    grundmaterial: [
      { code: 'B', name: 'Beton' },
      { code: 'P', name: 'Perle' },
      { code: 'W', name: 'Holz' }
      // ... complete list
    ]
  });
});
```

### Create Schmuckstück

**Endpoint:** `POST /api/schmuckstuecke`

**Request:**
```json
{
  "Artikelnummer": "MBH002_1",
  "Name": "Beton Halskette Ozean",
  "Art": "Halskette",
  "Farbe": "Blau",
  "Material": "Beton",
  "Herstellungskosten": 12.50,
  "Verkaufspreis": 35.00,
  "Foto": "MBH002_1.jpg"
}
```

**Validation:**
- Artikelnummer must be unique
- Artikelnummer format validation (prefix + number + suffix)
- If Ausschuss = 1, Ausschuss_Grund required
- Numeric values for costs and prices
- Photo filename validation (if provided)

**Implementation:**
```javascript
router.post('/', authenticate, async (req, res) => {
  // Note: user role can create, bearbeiter/admin can create
  const data = req.body;

  // Validate Artikelnummer uniqueness
  const existing = await db.query(
    'SELECT "Artikelnummer" FROM "Schmuckstück" WHERE "Artikelnummer" = $1',
    [data.Artikelnummer]
  );

  if (existing.rows.length > 0) {
    return res.status(400).json({ error: 'Artikelnummer already exists' });
  }

  // Validate Ausschuss constraint
  if (data.Ausschuss === 1 && !data.Ausschuss_Grund) {
    return res.status(400).json({
      error: 'Ausschuss_Grund required when Ausschuss = 1'
    });
  }

  // Insert with all 34+ columns
  const result = await db.query(
    `INSERT INTO "Schmuckstück"
     ("Artikelnummer", "Name", "Art", "Farbe", "Material",
      "Herstellungskosten", "Verkaufspreis", "Foto",
      "Verkauft", "Ausschuss", "Ausgelagert", "tenant_id")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      data.Artikelnummer, data.Name, data.Art, data.Farbe, data.Material,
      data.Herstellungskosten, data.Verkaufspreis, data.Foto,
      data.Verkauft ?? 0, data.Ausschuss ?? 0, data.Ausgelagert ?? 0,
      req.user.tenant_id ?? 1
    ]
  );

  res.status(201).json(result.rows[0]);
});
```

### Update Schmuckstück

**Endpoint:** `PUT /api/schmuckstuecke/:artikelnummer`

**Partial Update Support:** Yes (only provided fields are updated)

**Business Logic Enforcement:**
```javascript
router.put('/:artikelnummer', authenticate, requireBearbeiter, async (req, res) => {
  const { artikelnummer } = req.params;
  const data = req.body;

  // Prevent Verkauft = 1 AND Ausschuss = 1
  if (data.Verkauft === 1 && data.Ausschuss === 1) {
    return res.status(400).json({
      error: 'Item cannot be both sold and discarded'
    });
  }

  // If setting Ausschuss = 1, require Ausschuss_Grund
  if (data.Ausschuss === 1 && !data.Ausschuss_Grund) {
    // Check if existing record has Ausschuss_Grund
    const existing = await db.query(
      'SELECT "Ausschuss_Grund" FROM "Schmuckstück" WHERE "Artikelnummer" = $1',
      [artikelnummer]
    );

    if (!existing.rows[0].Ausschuss_Grund) {
      return res.status(400).json({
        error: 'Ausschuss_Grund required when marking as discarded'
      });
    }
  }

  // Build dynamic UPDATE query
  const fields = [];
  const values = [];
  let paramCount = 1;

  for (const [key, value] of Object.entries(data)) {
    fields.push(`"${key}" = $${paramCount}`);
    values.push(value);
    paramCount++;
  }

  values.push(artikelnummer);

  const query = `
    UPDATE "Schmuckstück"
    SET ${fields.join(', ')}
    WHERE "Artikelnummer" = $${paramCount}
    RETURNING *
  `;

  const result = await db.query(query, values);

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Schmuckstück not found' });
  }

  res.json(result.rows[0]);
});
```

### Delete Schmuckstück

**Endpoint:** `DELETE /api/schmuckstuecke/:artikelnummer`

**Soft Delete Recommended:** Mark as Ausschuss instead of hard delete

```javascript
router.delete('/:artikelnummer', authenticate, requireAdmin, async (req, res) => {
  const { artikelnummer } = req.params;

  // Soft delete: mark as Ausschuss
  const result = await db.query(
    `UPDATE "Schmuckstück"
     SET "Ausschuss" = 1, "Ausschuss_Grund" = 'Gelöscht', "Verkauft" = 0
     WHERE "Artikelnummer" = $1
     RETURNING *`,
    [artikelnummer]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Schmuckstück not found' });
  }

  res.json({ message: 'Schmuckstück marked as discarded' });
});
```

## Common Operations

### Mark as Sold

```javascript
async function markAsSold(artikelnummer, rechnungId = null) {
  const builder = where();
  builder.field('Artikelnummer', '=', artikelnummer);

  // Ensure item can be sold (not already sold or discarded)
  const checkQuery = `
    SELECT "Verkauft", "Ausschuss"
    FROM "Schmuckstück"
    ${builder.build()}
  `;

  const check = await db.query(checkQuery, builder.getParams());

  if (check.rows.length === 0) {
    throw new Error('Item not found');
  }

  if (check.rows[0].Verkauft === 1) {
    throw new Error('Item already sold');
  }

  if (check.rows[0].Ausschuss === 1) {
    throw new Error('Cannot sell discarded item');
  }

  // Update to sold
  await db.query(
    `UPDATE "Schmuckstück"
     SET "Verkauft" = 1, "Ausschuss" = 0, "Rechnung_ID" = $1
     WHERE "Artikelnummer" = $2`,
    [rechnungId ?? 0, artikelnummer]
  );
}
```

### Consign to Customer

```javascript
async function consignToCustomer(artikelnummer, kundeId, lieferscheinId = null) {
  // Verify item is available
  const builder = where();
  builder.verfuegbar();
  builder.field('Artikelnummer', '=', artikelnummer);

  const check = await db.query(
    `SELECT "Artikelnummer" FROM "Schmuckstück" ${builder.build()}`,
    builder.getParams()
  );

  if (check.rows.length === 0) {
    throw new Error('Item not available for consignment');
  }

  // Update to consigned
  await db.query(
    `UPDATE "Schmuckstück"
     SET "Ausgelagert" = $1, "Lieferschein_ID" = $2
     WHERE "Artikelnummer" = $3`,
    [kundeId, lieferscheinId ?? 0, artikelnummer]
  );
}
```

### Return from Consignment

```javascript
async function returnFromConsignment(artikelnummer) {
  // Verify item is consigned
  const builder = where();
  builder.aktivAusgelagert();
  builder.field('Artikelnummer', '=', artikelnummer);

  const check = await db.query(
    `SELECT "Artikelnummer" FROM "Schmuckstück" ${builder.build()}`,
    builder.getParams()
  );

  if (check.rows.length === 0) {
    throw new Error('Item not currently consigned');
  }

  // Return to stock
  await db.query(
    `UPDATE "Schmuckstück"
     SET "Ausgelagert" = 0, "Lieferschein_ID" = 0
     WHERE "Artikelnummer" = $1`,
    [artikelnummer]
  );
}
```

## Frontend Integration

### Schmuckstücke List Component

```javascript
// frontend/src/pages/Schmuckstuecke.jsx
import React, { useState, useEffect } from 'react';
import { getSchmuckstuecke, getFilterOptions } from '../api';

function Schmuckstuecke() {
  const [items, setItems] = useState([]);
  const [filters, setFilters] = useState({
    status: 'verfuegbar',
    hersteller: '',
    grundmaterial: '',
    produktart: '',
    search: ''
  });
  const [filterOptions, setFilterOptions] = useState({});

  useEffect(() => {
    loadFilterOptions();
  }, []);

  useEffect(() => {
    loadItems();
  }, [filters]);

  const loadFilterOptions = async () => {
    const options = await getFilterOptions();
    setFilterOptions(options);
  };

  const loadItems = async () => {
    const data = await getSchmuckstuecke(filters);
    setItems(data);
  };

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div>
      <h1>Schmuckstücke</h1>

      {/* Filters */}
      <div className="filters">
        <select
          value={filters.status}
          onChange={(e) => handleFilterChange('status', e.target.value)}
        >
          <option value="">Alle Status</option>
          <option value="verfuegbar">Verfügbar</option>
          <option value="ausgelagert">Ausgelagert</option>
          <option value="verkauft">Verkauft</option>
          <option value="ausschuss">Ausschuss</option>
        </select>

        <select
          value={filters.grundmaterial}
          onChange={(e) => handleFilterChange('grundmaterial', e.target.value)}
        >
          <option value="">Alle Materialien</option>
          {filterOptions.grundmaterial?.map(m => (
            <option key={m.code} value={m.code}>{m.name}</option>
          ))}
        </select>

        <input
          type="text"
          placeholder="Suche..."
          value={filters.search}
          onChange={(e) => handleFilterChange('search', e.target.value)}
        />
      </div>

      {/* Items Grid */}
      <div className="items-grid">
        {items.map(item => (
          <div key={item.Artikelnummer} className="item-card">
            {item.Foto && (
              <img src={`/api/schmuckstuecke/foto/${item.Foto}`} alt={item.Name} />
            )}
            <h3>{item.Name}</h3>
            <p>{item.Artikelnummer}</p>
            <p>{item.Verkaufspreis} €</p>
          </div>
        ))}
      </div>
    </div>
  );
}
```

## Database Triggers

### Auto-Update Last Modified

```sql
CREATE OR REPLACE FUNCTION update_letzte_aenderung()
RETURNS TRIGGER AS $$
BEGIN
  NEW."Letzte_Aenderung" = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_letzte_aenderung
  BEFORE UPDATE ON "Schmuckstück"
  FOR EACH ROW
  EXECUTE FUNCTION update_letzte_aenderung();
```

### Audit Log Trigger

```sql
CREATE OR REPLACE FUNCTION audit_schmuckstueck()
RETURNS TRIGGER AS $$
BEGIN
  -- Track changes to critical fields
  IF OLD."Verkauft" IS DISTINCT FROM NEW."Verkauft" THEN
    INSERT INTO audit_log (table_name, artikelnummer_id, column_name, old_value, new_value, action_type, changed_by)
    VALUES ('Schmuckstück', NEW."Artikelnummer", 'Verkauft', OLD."Verkauft"::TEXT, NEW."Verkauft"::TEXT, 'UPDATE', current_setting('app.current_user', true));
  END IF;

  -- Similar checks for Ausgelagert, Ausschuss, Ausschuss_Grund, Lieferschein_ID, Rechnung_ID

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_schmuckstueck
  AFTER UPDATE ON "Schmuckstück"
  FOR EACH ROW
  EXECUTE FUNCTION audit_schmuckstueck();
```

## Testing

### WHERE Builder Tests

```javascript
// backend/__tests__/whereClauseBuilder.test.js
const { where } = require('../src/utils/whereClauseBuilder');

describe('WHERE Clause Builder', () => {
  test('verfuegbar filter', () => {
    const builder = where();
    builder.verfuegbar();

    expect(builder.build()).toContain('Verkauft = $1');
    expect(builder.build()).toContain('Ausschuss = $2');
    expect(builder.build()).toContain('Ausgelagert = $3');
    expect(builder.getParams()).toEqual([0, 0, 0]);
  });

  test('verkauft excludes ausschuss', () => {
    const builder = where();
    builder.verkauft();

    expect(builder.build()).toContain('Verkauft = $1');
    expect(builder.build()).toContain('Ausschuss = $2');
    expect(builder.getParams()).toEqual([1, 0]);
  });

  test('prefix filters', () => {
    const builder = where();
    builder.hersteller('M');
    builder.grundmaterial('P');
    builder.produktart('A');

    expect(builder.build()).toContain('SUBSTRING("Artikelnummer", 1, 1)');
    expect(builder.build()).toContain('SUBSTRING("Artikelnummer", 2, 1)');
    expect(builder.build()).toContain('SUBSTRING("Artikelnummer", 3, 1)');
  });
});
```

## Related Skills

- [Search & Filtering](./search-filtering.md) - WHERE clause builder details
- [Photo Asset Management](./photo-management.md) - Photo upload for Schmuckstücke
- [Audit & Compliance](./audit-compliance.md) - Change tracking
- [Customer Management](./customer-management.md) - Consignment tracking
- [Document Generation](./document-generation.md) - Lieferscheine and Rechnungen

## Troubleshooting

### "Verkauft and Ausschuss both set" Error

**Cause:** Attempting to mark item as both sold and discarded
**Solution:** Choose one status - items can't be both sold and discarded

### WHERE Clause Not Using Builder

**Symptom:** Inconsistent filtering results
**Solution:** Always use the WHERE clause builder for Schmuckstück queries

### Ausschuss Without Grund

**Cause:** Marking item as Ausschuss without providing Ausschuss_Grund
**Solution:** Always provide a reason when discarding items
