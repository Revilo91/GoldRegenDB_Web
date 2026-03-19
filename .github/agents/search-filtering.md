# Search & Filtering Skill

## Overview

This skill covers advanced search and filtering capabilities using the WHERE clause builder, comprehensive multi-attribute querying, and consistent business logic application across the GoldRegenDB system.

## Core Concept: WHERE Clause Builder

### Why This Matters

**MANDATORY FOR ALL SCHMUCKSTÜCK QUERIES**

The WHERE clause builder encapsulates complex business logic:
- Status filtering rules (Verkauft/Ausschuss mutual exclusivity)
- Prefix-based filtering (Artikelnummer patterns)
- Multi-tenant isolation
- Prepared statement parameter management
- Audit trail integration

### File Location

`/backend/src/utils/whereClauseBuilder.js`

### Complete Documentation

Full technical reference available at:
`/backend/src/utils/WHERE_BUILDER.md`

## Basic Usage

### Initialization

```javascript
const { where } = require('../utils/whereClauseBuilder');

// Create builder instance
const builder = where();

// Add filters
builder.verfuegbar();              // Available items only
builder.grundmaterial('P');        // Perle (Pearl)
builder.produktart('A');           // Armband (Bracelet)

// Build SQL WHERE clause and get parameters
const query = `SELECT * FROM "Schmuckstück" ${builder.build()}`;
const params = builder.getParams();

// Execute query
const result = await db.query(query, params);
```

## Status Filters

### Available Items (Verfügbar)

```javascript
const builder = where();
builder.verfuegbar();

// Generated SQL:
// WHERE "Verkauft" = $1 AND "Ausschuss" = $2 AND "Ausgelagert" = $3
// Parameters: [0, 0, 0]

// Meaning: Not sold, not discarded, not consigned
```

### Sold Items (Verkauft)

```javascript
const builder = where();
builder.verkauft();

// Generated SQL:
// WHERE "Verkauft" = $1 AND "Ausschuss" = $2
// Parameters: [1, 0]

// Important: Excludes discarded items even if somehow marked as sold
```

### Discarded Items (Ausschuss)

```javascript
const builder = where();
builder.ausschuss();

// Generated SQL:
// WHERE "Ausschuss" = $1
// Parameters: [1]

// Note: Doesn't check Verkauft status
```

### Consigned Items (Ausgelagert)

```javascript
const builder = where();
builder.aktivAusgelagert();

// Generated SQL:
// WHERE "Ausgelagert" > $1 AND "Verkauft" = $2 AND "Ausschuss" = $3
// Parameters: [0, 0, 0]

// Meaning: Consigned (Ausgelagert > 0), not sold, not discarded

// Consigned to specific customer
builder.aktivAusgelagert(5);

// Generated SQL:
// WHERE "Ausgelagert" = $1 AND "Verkauft" = $2 AND "Ausschuss" = $3
// Parameters: [5, 0, 0]
```

## Prefix Filters

### Hersteller (Manufacturer)

```javascript
const builder = where();
builder.hersteller('M');

// Generated SQL:
// WHERE SUBSTRING("Artikelnummer", 1, 1) = $1
// Parameters: ['M']

// Manufacturers:
// M = Marina
// S = Saskia
```

### Grundmaterial (Base Material)

```javascript
const builder = where();
builder.grundmaterial('P');

// Generated SQL:
// WHERE SUBSTRING("Artikelnummer", 2, 1) = $1
// Parameters: ['P']

// Common materials:
// B = Beton (Concrete)
// P = Perle (Pearl)
// W = Holz (Wood)
// H = Harz (Resin)
// E = Edelstahl (Stainless Steel)
// L = Leder (Leather)
// M = Makramee (Macramé)
// N = Naturstein (Natural Stone)
```

### Produktart (Product Type)

```javascript
const builder = where();
builder.produktart('H');

// Generated SQL:
// WHERE SUBSTRING("Artikelnummer", 3, 1) = $1
// Parameters: ['H']

// Product types:
// H = Halskette (Necklace)
// A = Armband (Bracelet)
// O = Ohrring (Earring)
// S = Schlüsselanhänger (Keychain)
```

## Attribute Filters

### Filter by Single Attribute

```javascript
const builder = where();

// Filter by color
builder.art('Kette');
builder.farbe('Blau');
builder.material('Beton');

// Generated: Multiple AND conditions with ILIKE for case-insensitive matching
```

### Custom Field Filters

```javascript
const builder = where();

// Exact match
builder.field('Name', '=', 'Blue Necklace');
builder.field('Lieferschein_ID', '=', 42);

// Range filter
builder.field('Verkaufspreis', '>=', 20);
builder.field('Verkaufspreis', '<=', 50);

// ILIKE pattern
builder.field('Foto', 'like', 'MBH%');

// Generated SQL examples:
// "Name" = $1
// "Verkaufspreis" >= $1 AND "Verkaufspreis" <= $2
// "Foto" ILIKE $1
```

## Complex Filtering Examples

### Marina's Available Pearl Necklaces (Blue), Price 20-50 EUR

```javascript
const builder = where();

// Status
builder.verfuegbar();

// Artikelnummer prefix
builder.hersteller('M');
builder.grundmaterial('P');
builder.produktart('H');

// Attributes
builder.farbe('Blau');
builder.field('Verkaufspreis', '>=', 20);
builder.field('Verkaufspreis', '<=', 50);

// Ordering
const query = `
  SELECT * FROM "Schmuckstück"
  ${builder.build()}
  ORDER BY "Erstelldatum" DESC
`;

const result = await db.query(query, builder.getParams());
```

### Items Consigned to Specific Customer with Recent Changes

```javascript
const builder = where();

// Consignment filter
builder.aktivAusgelagert(5); // Customer ID 5

// Recently added
builder.field('Erstelldatum', '>=', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));

// Not discarded
builder.field('Ausschuss', '=', 0);

const query = `
  SELECT "Artikelnummer", "Name", "Verkaufspreis", "Erstelldatum"
  FROM "Schmuckstück"
  ${builder.build()}
  ORDER BY "Erstelldatum" DESC
`;

const result = await db.query(query, builder.getParams());
```

### Sold Items by Customer with Commission Calculation

```javascript
const builder = where();

// Sold items
builder.verkauft();

// Associated with customer
builder.field('Lieferschein_ID', '>', 0);

// Get matching records
const query = `
  SELECT
    s."Artikelnummer",
    s."Name",
    s."Verkaufspreis",
    k."Provision",
    (s."Verkaufspreis" * k."Provision" / 100) as commission,
    l."Erstelldatum"
  FROM "Schmuckstück" s
  LEFT JOIN "Lieferschein" l ON s."Lieferschein_ID" = l."ID"
  LEFT JOIN "Kunde" k ON l."Kunde_ID" = k."ID"
  ${builder.build()}
  ORDER BY l."Erstelldatum" DESC
`;
```

## API Endpoint Patterns

### Basic List with Filters

```javascript
router.get('/', authenticate, requireBearbeiter, async (req, res) => {
  const {
    status, hersteller, grundmaterial, produktart,
    art, farbe, material, ausgelagert, search,
    minPrice, maxPrice
  } = req.query;

  const builder = where();

  // Status filter
  if (status === 'verfuegbar') builder.verfuegbar();
  else if (status === 'verkauft') builder.verkauft();
  else if (status === 'ausschuss') builder.ausschuss();
  else if (status === 'ausgelagert') builder.aktivAusgelagert();

  // Prefix filters
  if (hersteller) builder.hersteller(hersteller);
  if (grundmaterial) builder.grundmaterial(grundmaterial);
  if (produktart) builder.produktart(produktart);

  // Attribute filters
  if (art) builder.art(art);
  if (farbe) builder.farbe(farbe);
  if (material) builder.material(material);

  // Price range
  if (minPrice) builder.field('Verkaufspreis', '>=', parseFloat(minPrice));
  if (maxPrice) builder.field('Verkaufspreis', '<=', parseFloat(maxPrice));

  // Consignment filter
  if (ausgelagert) builder.aktivAusgelagert(parseInt(ausgelagert));

  // Full-text search
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
    LIMIT 100
  `;

  const result = await db.query(query, builder.getParams());
  res.json(result.rows);
});
```

### Faceted Search (Filter Options)

```javascript
router.get('/filter-options', authenticate, requireBearbeiter, async (req, res) => {
  try {
    // Get available distinct values for dropdowns
    const artResult = await db.query(
      'SELECT DISTINCT "Art" FROM "Schmuckstück" WHERE "Art" IS NOT NULL ORDER BY "Art"'
    );

    const farbeResult = await db.query(
      'SELECT DISTINCT "Farbe" FROM "Schmuckstück" WHERE "Farbe" IS NOT NULL ORDER BY "Farbe"'
    );

    const materialResult = await db.query(
      'SELECT DISTINCT "Material" FROM "Schmuckstück" WHERE "Material" IS NOT NULL ORDER BY "Material"'
    );

    // Static mappings for prefix codes
    const HERSTELLER = [
      { code: 'M', name: 'Marina' },
      { code: 'S', name: 'Saskia' }
    ];

    const GRUNDMATERIAL = [
      { code: 'B', name: 'Beton' },
      { code: 'P', name: 'Perle' },
      { code: 'W', name: 'Holz' },
      { code: 'H', name: 'Harz' },
      { code: 'E', name: 'Edelstahl' },
      { code: 'L', name: 'Leder' },
      // ... complete list
    ];

    const PRODUKTART = [
      { code: 'H', name: 'Halskette' },
      { code: 'A', name: 'Armband' },
      { code: 'O', name: 'Ohrring' },
      { code: 'S', name: 'Schlüsselanhänger' }
    ];

    res.json({
      art: artResult.rows.map(r => r.Art),
      farbe: farbeResult.rows.map(r => r.Farbe),
      material: materialResult.rows.map(r => r.Material),
      hersteller: HERSTELLER,
      grundmaterial: GRUNDMATERIAL,
      produktart: PRODUKTART,
      status: [
        { value: 'verfuegbar', label: 'Verfügbar' },
        { value: 'ausgelagert', label: 'Ausgelagert' },
        { value: 'verkauft', label: 'Verkauft' },
        { value: 'ausschuss', label: 'Ausschuss' }
      ]
    });
  } catch (error) {
    logger.error('FILTER', 'Failed to fetch options', { message: error.message });
    res.status(500).json({ error: 'Failed to fetch filter options' });
  }
});
```

## Frontend Integration

### Search Component

```javascript
// frontend/src/components/FilterBar.jsx
import React, { useState, useEffect } from 'react';
import { api } from '../api';

export default function FilterBar({ onFiltersChange }) {
  const [filters, setFilters] = useState({
    status: 'verfuegbar',
    hersteller: '',
    grundmaterial: '',
    produktart: '',
    search: ''
  });

  const [options, setOptions] = useState({});

  useEffect(() => {
    loadFilterOptions();
  }, []);

  useEffect(() => {
    onFiltersChange(filters);
  }, [filters]);

  const loadFilterOptions = async () => {
    try {
      const data = await api.get('/api/schmuckstuecke/filter-options');
      setOptions(data);
    } catch (error) {
      console.error('Failed to load filter options:', error);
    }
  };

  const handleChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="filter-bar">
      <input
        type="text"
        placeholder="Search..."
        value={filters.search}
        onChange={(e) => handleChange('search', e.target.value)}
      />

      <select
        value={filters.status}
        onChange={(e) => handleChange('status', e.target.value)}
      >
        <option value="">All Status</option>
        {options.status?.map(s => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>

      <select
        value={filters.grundmaterial}
        onChange={(e) => handleChange('grundmaterial', e.target.value)}
      >
        <option value="">All Materials</option>
        {options.grundmaterial?.map(m => (
          <option key={m.code} value={m.code}>{m.name}</option>
        ))}
      </select>

      {/* Additional filters... */}
    </div>
  );
}
```

## Performance Optimization

### Add Database Indexes

```sql
-- Prefix-based queries
CREATE INDEX idx_artikelnummer_prefix ON "Schmuckstück" (SUBSTRING("Artikelnummer", 1, 1));
CREATE INDEX idx_grundmaterial ON "Schmuckstück" (SUBSTRING("Artikelnummer", 2, 1));
CREATE INDEX idx_produktart ON "Schmuckstück" (SUBSTRING("Artikelnummer", 3, 1));

-- Status queries
CREATE INDEX idx_status_composite ON "Schmuckstück" ("Verkauft", "Ausschuss", "Ausgelagert");

-- Attribute queries
CREATE INDEX idx_farbe ON "Schmuckstück" ("Farbe");
CREATE INDEX idx_art ON "Schmuckstück" ("Art");
CREATE INDEX idx_material ON "Schmuckstück" ("Material");

-- Full-text search
CREATE INDEX idx_name_search ON "Schmuckstück" USING gin(to_tsvector('german', "Name"));
CREATE INDEX idx_artikelnummer_search ON "Schmuckstück" USING gin(to_tsvector('simple', "Artikelnummer"));
```

### Query Analysis

```sql
-- Check query plan
EXPLAIN ANALYZE
SELECT * FROM "Schmuckstück"
WHERE SUBSTRING("Artikelnummer", 1, 1) = 'M'
AND "Verkauft" = 0
AND "Farbe" = 'Blau';

-- Look for sequential scans on large tables
```

## Related Skills

- [Inventory Management](./inventory-management.md) - Schmuckstück data structure
- [Database Operations](./database-operations.md) - Query execution patterns
- [Testing & Quality](./testing.md) - Testing WHERE builder

## Troubleshooting

### Slow Filter Queries

**Cause:** Missing indexes on frequently filtered columns
**Solution:**
1. Identify slow queries with EXPLAIN ANALYZE
2. Add indexes on Farbe, Art, Material
3. Use composite indexes for common filter combinations
4. Monitor query performance with pg_stat_statements

### Incorrect Filter Results

**Cause:** WHERE builder not used or improper condition
**Solution:**
1. Always use where() builder for Schmuckstück queries
2. Verify status filters (verkauft excludes ausschuss)
3. Check prefix extraction (first 3 characters)
4. Test with simpler queries first

### Artikelnummer Prefix Not Matching

**Cause:** Case sensitivity or padding issues
**Solution:**
1. Ensure uppercase conversion: `.toUpperCase()`
2. Verify 3-character pattern (M/S + 2 letters + 3 digits)
3. Test with explicit SUBSTRING: `SELECT SUBSTRING("Artikelnummer", 1, 1)`
4. Check for special characters or spaces

### Full-Text Search Not Working

**Cause:** GIN index missing or query syntax wrong
**Solution:**
1. Create full-text index: `CREATE INDEX idx_name_tsvector ON "Schmuckstück" USING gin(to_tsvector('german', "Name"));`
2. Use proper syntax: `Name @@ plainto_tsquery('german', search_term)`
3. Use ILIKE for simple substring matching instead
