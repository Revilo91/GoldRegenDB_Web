# Data Synchronization Skill

## Overview

This skill covers integrating SumUp sales data into the GoldRegenDB system, automatic document creation, and inventory synchronization for multi-channel sales operations.

## SumUp Integration

### Overview

SumUp is a mobile payment processor. The integration allows:
1. Import CSV exports of sales transactions
2. Automatic identification of sold items via article numbers
3. Creation of Rechnungen (invoices) and Lieferscheine (delivery notes)
4. Inventory status updates (Verkauft = 1)
5. Revenue tracking per sale

### Key Files

- `/backend/src/routes/sumup.js` - SumUp import/export endpoints
- `/backend/src/utils/whereClauseBuilder.js` - Item lookup queries

## CSV Import Flow

### Endpoint: `POST /api/sumup/import`

**Request Format:**

```json
{
  "csvData": "Beschreibung,Betrag,Datum\nMBH001 Blue Necklace,35.00,2024-01-15\nMPA425_2 Pearl Bracelet,45.00,2024-01-15"
}
```

**CSV Column Mapping:**

The system looks for article numbers in these columns (in order):
1. `Beschreibung` (Description) - Primary field from SumUp
2. `SKU` - Stock keeping unit
3. `Barcode` - Product barcode
4. `Artikelnummer` - Article number
5. `Name` - Product name

**Article Number Format:**

Valid patterns:
- `MBH001` - Full article number
- `MBH001_1` - With instance suffix
- `MPA425_2` - Multiple instances

### Implementation

**File:** `/backend/src/routes/sumup.js`

```javascript
router.post('/import', async (req, res) => {
  try {
    const csvData = req.body.csvData;

    if (!csvData) {
      return res.status(400).json({ error: 'No CSV data provided' });
    }

    // Parse CSV lines
    const lines = parseCSVLines(csvData);
    if (lines.length < 2) {
      return res.status(400).json({ error: 'Empty or invalid CSV' });
    }

    const headers = lines[0];
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i];
      const row = {};
      headers.forEach((header, idx) => {
        row[header] = values[idx] || '';
      });
      rows.push(row);
    }

    // Extract article numbers
    const artikelnummern = new Set();

    rows.forEach((row, idx) => {
      const value = row['Beschreibung'];
      if (value) {
        const extracted = extractArtikelnummer(value);
        if (extracted) {
          logger.debug('SUMUP', `Row ${idx}: Found "${extracted}" in "${value}"`);
          artikelnummern.add(extracted.toUpperCase());
        }
      }
    });

    if (artikelnummern.size === 0) {
      return res.status(400).json({
        error: 'No valid article numbers found',
        hinweis: 'CSV must contain valid article numbers like MBH001 or MPA425_2',
        availableColumns: Object.keys(rows[0] || {})
      });
    }

    // Query matching items
    const likePatterns = Array.from(artikelnummern).map(num => `${num}%`);
    const builder = where();
    builder.verfuegbar(); // Only available items
    builder.raw('"Artikelnummer" LIKE ANY($' + builder.getNextParamIdx() + '::text[])', likePatterns);

    const { rows: matchingItems } = await db.query(
      `SELECT "Artikelnummer", "Verkaufspreis"
       FROM "Schmuckstück"
       ${builder.build()}`,
      builder.getParams()
    );

    // Response shows matched items
    res.json({
      success: true,
      imported: matchingItems.length,
      items: matchingItems,
      notFound: Array.from(artikelnummern).filter(
        num => !matchingItems.some(item => item.Artikelnummer.startsWith(num))
      )
    });

  } catch (error) {
    logger.error('SUMUP', 'Import failed', { message: error.message });
    res.status(500).json({ error: 'Import failed' });
  }
});
```

## Available Items Export

### Endpoint: `GET /api/sumup/available-items`

**Response Format:**

```json
[
  {
    "Artikelnummer": "MBH001",
    "Name": "Blue Concrete Necklace",
    "Verkaufspreis": 35.00,
    "Art": "Halskette",
    "Farbe": "Blau"
  },
  {
    "Artikelnummer": "MPA425_2",
    "Name": "Pearl Bracelet",
    "Verkaufspreis": 45.00,
    "Art": "Armband",
    "Farbe": "Weiß"
  }
]
```

**Implementation:**

```javascript
router.get('/available-items', async (req, res) => {
  try {
    const builder = where();
    builder.verfuegbar();

    const query = `
      SELECT "Artikelnummer", "Name", "Verkaufspreis", "Art", "Farbe"
      FROM "Schmuckstück"
      ${builder.build()}
      ORDER BY "Artikelnummer"
    `;

    const result = await db.query(query, builder.getParams());

    // Format for SumUp export
    const csvContent = [
      ['SKU', 'Name', 'Price', 'Description'],
      ...result.rows.map(item => [
        item.Artikelnummer,
        item.Name,
        item.Verkaufspreis,
        `${item.Art} - ${item.Farbe}`
      ])
    ];

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="sumup_inventory.csv"');

    const csvString = csvContent.map(row =>
      row.map(cell => `"${cell}"`).join(',')
    ).join('\n');

    res.send(csvString);
  } catch (error) {
    logger.error('SUMUP', 'Export failed', { message: error.message });
    res.status(500).json({ error: 'Export failed' });
  }
});
```

## Automatic Document Creation

### SumUp to Invoice Workflow

When SumUp items are imported, the system can automatically create:

1. **Rechnung (Invoice)** - If customer is identified
2. **Lieferschein (Delivery Note)** - If consignment tracking needed
3. **Status Updates** - Mark items as Verkauft = 1

### Implementation

```javascript
async function processSumUpImport(importData, kundeId = null) {
  try {
    const { items } = importData;
    let totalAmount = 0;
    const processedItems = [];

    // 1. Validate and prepare items
    for (const item of items) {
      const builder = where();
      builder.verfuegbar();
      builder.field('Artikelnummer', '=', item.Artikelnummer);

      const result = await db.query(
        `SELECT "Verkaufspreis" FROM "Schmuckstück" ${builder.build()}`,
        builder.getParams()
      );

      if (result.rows.length > 0) {
        const price = result.rows[0].Verkaufspreis;
        totalAmount += price;
        processedItems.push({
          artikelnummer: item.Artikelnummer,
          price: price
        });
      }
    }

    if (processedItems.length === 0) {
      throw new Error('No valid items to process');
    }

    // 2. Create Rechnung (Invoice)
    const invoiceResult = await db.query(
      `INSERT INTO "Rechnung"
       ("Kunde_ID", "Status", "Summe", "Erstelldatum")
       VALUES ($1, $2, $3, NOW())
       RETURNING *`,
      [kundeId || 0, 'open', totalAmount]
    );

    const invoice = invoiceResult.rows[0];

    // 3. Mark items as sold
    for (const item of processedItems) {
      await db.query(
        `UPDATE "Schmuckstück"
         SET "Verkauft" = 1, "Rechnung_ID" = $1, "Ausgelagert" = 0
         WHERE "Artikelnummer" = $2`,
        [invoice.ID, item.artikelnummer]
      );
    }

    logger.info('SUMUP_SYNC', 'Import processed', {
      invoiceId: invoice.ID,
      itemCount: processedItems.length,
      totalAmount: totalAmount
    });

    return {
      success: true,
      invoiceId: invoice.ID,
      itemCount: processedItems.length,
      totalAmount: totalAmount
    };

  } catch (error) {
    logger.error('SUMUP_SYNC', 'Processing failed', { message: error.message });
    throw error;
  }
}
```

## Data Validation

### Article Number Extraction

```javascript
function extractArtikelnummer(text) {
  // Pattern: M or S, followed by 2 letters, followed by 3 digits
  // Optional: underscore and suffix (e.g., _1, _2)
  const pattern = /([MS][A-Z]{2}\d{3}(?:_\d+)?)/i;
  const match = text.match(pattern);
  return match ? match[1] : null;
}
```

### CSV Line Parser

```javascript
function parseCSVLines(csvString) {
  const lines = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < csvString.length; i++) {
    const char = csvString[i];
    const nextChar = csvString[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++; // Skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      lines.push(current);
      current = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (current.trim()) {
        lines.push(current);
      }
      if (char === '\r' && nextChar === '\n') {
        i++; // Skip \n in \r\n
      }
      return [lines, csvString.substring(i + 1)];
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    lines.push(current);
  }

  return [lines];
}
```

## Frontend Integration

### SumUp Import Form

```javascript
// frontend/src/pages/SumUpImport.jsx
import React, { useState } from 'react';
import { api } from '../api';

export default function SumUpImport() {
  const [csvText, setCsvText] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleImport = async () => {
    if (!csvText.trim()) {
      setError('Please paste CSV data');
      return;
    }

    setImporting(true);
    setError(null);

    try {
      const response = await api.post('/api/sumup/import', {
        csvData: csvText
      });

      setResult({
        imported: response.imported,
        items: response.items,
        notFound: response.notFound
      });
    } catch (err) {
      setError(err.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div>
      <h1>SumUp Import</h1>

      <textarea
        value={csvText}
        onChange={(e) => setCsvText(e.target.value)}
        placeholder="Paste SumUp CSV here..."
        rows={10}
      />

      <button onClick={handleImport} disabled={importing}>
        {importing ? 'Importing...' : 'Import'}
      </button>

      {error && <div className="error">{error}</div>}

      {result && (
        <div className="results">
          <h3>Import Results</h3>
          <p>Imported: {result.imported} items</p>
          {result.notFound.length > 0 && (
            <div>
              <h4>Not Found ({result.notFound.length}):</h4>
              <ul>
                {result.notFound.map(item => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

## Batch Processing

### Processing Large Imports

```javascript
async function batchProcessSumUpImport(items, batchSize = 100) {
  const results = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);

    try {
      const batchResult = await Promise.all(
        batch.map(item =>
          db.query(
            `UPDATE "Schmuckstück"
             SET "Verkauft" = 1
             WHERE "Artikelnummer" = $1`,
            [item.Artikelnummer]
          )
        )
      );

      results.push(...batchResult);

      logger.info('SUMUP_BATCH', `Processed batch ${Math.floor(i / batchSize) + 1}`, {
        batchSize: batch.length
      });
    } catch (error) {
      logger.error('SUMUP_BATCH', 'Batch failed', {
        batch: i / batchSize + 1,
        message: error.message
      });
      throw error;
    }
  }

  return results;
}
```

## Related Skills

- [Inventory Management](./inventory-management.md) - Item status updates
- [Document Generation](./document-generation.md) - Invoice and Lieferschein creation
- [Customer Management](./customer-management.md) - Customer association
- [Audit & Compliance](./audit-compliance.md) - Change tracking for synced items

## Troubleshooting

### Article Numbers Not Found

**Cause:** Incorrect format in CSV description
**Solution:**
1. Verify article number format (e.g., MBH001 or MPA425_2)
2. Check CSV column name (Beschreibung is primary)
3. Use available-items export to verify format

### Items Already Sold

**Cause:** Items marked Verkauft before import
**Solution:**
1. Only available items (Verkauft = 0) are imported
2. Use filter to find only available inventory
3. Return sold items to stock if needed

### Invoice Not Created

**Cause:** Customer ID missing or invalid
**Solution:**
1. Provide valid kundeId when processing
2. Set default customer for SumUp sales
3. Manual invoice creation as fallback

### CSV Parsing Errors

**Cause:** Special characters or encoding issues
**Solution:**
1. Use UTF-8 encoding
2. Escape quotes properly in CSV
3. Test with simple CSV first

### Duplicate Items in Import

**Cause:** Multiple rows with same article number
**Solution:**
1. Deduplicate CSV before import
2. Use Set to prevent duplicates
3. Check for suffix variants (e.g., MBH001_1 vs MBH001_2)
