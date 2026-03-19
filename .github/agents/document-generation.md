# Document Generation Skill

## Overview

This skill covers creating professional business documents (Lieferscheine/delivery notes and Rechnungen/invoices) and Excel exports for inventory management and reporting in the GoldRegenDB system.

## Core Concepts

### Document Types

**Lieferschein (Delivery Note)**
- Tracks items sent to customers on consignment
- References Schmuckstücke via Lieferschein_ID
- Contains customer, date, and item list
- Used for stock management and auditing

**Rechnung (Invoice)**
- Generated when items are sold
- References Schmuckstücke via Rechnung_ID
- Contains billing information and totals
- Legal sales document with company details

**Excel Exports**
- Inventory status report
- Customer-specific inventory
- Sales statistics
- Custom filtering support

## Key Files

- `/backend/src/utils/excelService.js` - Excel generation and formatting
- `/backend/src/routes/lieferscheine.js` - Delivery note management
- `/backend/src/routes/rechnungen.js` - Invoice management
- `/backend/src/routes/schmuckstuecke.js` - Includes Excel export endpoints

## Excel Generation

### File: `/backend/src/utils/excelService.js`

**Main Functions:**

```javascript
const { generateExcel, generateInventurExcel } = require('../utils/excelService');

// Export inventory report
async function exportInventory(data) {
  const stream = await generateExcel('Inventur', data);
  // Send to client as downloadable file
}

// Export inventory by customer (Inventur)
async function exportInventorByCustomer(data) {
  const stream = await generateInventurExcel(data);
  // Send to client as downloadable file
}
```

### Usage in Routes

**Endpoint:** `GET /api/schmuckstuecke/export/excel`

```javascript
router.get('/export/excel', authenticate, requireBearbeiter, async (req, res) => {
  try {
    // Build WHERE clause for filtering
    const builder = where();

    // Apply filters from query parameters
    if (req.query.status === 'verfuegbar') builder.verfuegbar();
    if (req.query.grundmaterial) builder.grundmaterial(req.query.grundmaterial);

    // Query filtered items
    const query = `SELECT * FROM "Schmuckstück" ${builder.build()}`;
    const result = await db.query(query, builder.getParams());

    // Generate Excel file
    const workbook = await generateExcel('Schmuckstücke', result.rows);

    // Send to client
    res.setHeader('Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',
      'attachment; filename="schmuckstuecke.xlsx"');

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    logger.error('EXPORT', 'Excel export failed', { message: error.message });
    res.status(500).json({ error: 'Export failed' });
  }
});
```

### Excel Formatting Features

**Company Branding:**

```javascript
const CONTACTS = {
  GOLDREGEN: {
    name: "Marina Südholt",
    mobile: "0152 22731186",
    email: "goldregen.schmuckdesign@gmail.com",
    website: "www.goldregenschmuckdesign.de",
    bank: "UniCredit Bank AG\nDE51 7502 0073 0029 2620 20\nHYVEDEMM447"
  }
};

const BUSINESS_ADDRESS = "Herzogin-Ludmilla-Ring 5 • 84085 Langquaid";

const DEFAULT_LOGO_PATH = path.join(__dirname, "../assets/Logo trasparent weißer Kreis.png");
```

**Auto-Fit Columns:**

```javascript
function autoFitColumns(worksheet) {
  const columnWidths = {};

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      if (!cell.value) return;

      const cellValue = cell.value.toString();
      const length = cellValue.length;

      columnWidths[colNumber] = Math.max(columnWidths[colNumber] || 0, length);
    });
  });

  worksheet.columns.forEach((column, index) => {
    const colNumber = index + 1;
    column.width = Math.min(Math.max((columnWidths[colNumber] || 0) + 1, 5), 50);
  });
}
```

## Lieferscheine (Delivery Notes)

### Schema

**Table:** `Lieferschein`
- `ID` (SERIAL) - Primary key
- `Kunde_ID` (INT) - Customer reference
- `Erstelldatum` (TIMESTAMP) - Creation date
- `Notizen` (TEXT) - Notes/comments
- `Status` (VARCHAR) - open, shipped, returned

### API Endpoints

**List Lieferscheine:**

```javascript
router.get('/', authenticate, requireBearbeiter, async (req, res) => {
  const { status, kundeId, search } = req.query;

  let query = `
    SELECT l.*,
           COUNT(s."Artikelnummer") as item_count,
           k."Name" as kunde_name
    FROM "Lieferschein" l
    LEFT JOIN "Kunde" k ON l."Kunde_ID" = k."ID"
    LEFT JOIN "Schmuckstück" s ON s."Lieferschein_ID" = l."ID"
    WHERE 1=1
  `;

  const params = [];
  let paramCount = 1;

  if (status) {
    query += ` AND l."Status" = $${paramCount}`;
    params.push(status);
    paramCount++;
  }

  if (kundeId) {
    query += ` AND l."Kunde_ID" = $${paramCount}`;
    params.push(kundeId);
    paramCount++;
  }

  if (search) {
    query += ` AND (k."Name" ILIKE $${paramCount} OR l."Notizen" ILIKE $${paramCount})`;
    params.push(`%${search}%`);
    paramCount++;
  }

  query += ' GROUP BY l."ID", k."Name" ORDER BY l."Erstelldatum" DESC';

  const result = await db.query(query, params);
  res.json(result.rows);
});
```

**Get Items in Lieferschein:**

```javascript
router.get('/:id/items', authenticate, requireBearbeiter, async (req, res) => {
  const { id } = req.params;

  const builder = where();
  builder.field('Lieferschein_ID', '=', parseInt(id));

  const query = `
    SELECT * FROM "Schmuckstück"
    ${builder.build()}
    ORDER BY "Artikelnummer"
  `;

  const result = await db.query(query, builder.getParams());
  res.json(result.rows);
});
```

**Create Lieferschein:**

```javascript
router.post('/', authenticate, requireBearbeiter, async (req, res) => {
  const { kundeId, items, notizen } = req.body;

  try {
    // Insert Lieferschein
    const lieferscheinResult = await db.query(
      `INSERT INTO "Lieferschein"
       ("Kunde_ID", "Status", "Notizen", "Erstelldatum")
       VALUES ($1, $2, $3, NOW())
       RETURNING *`,
      [kundeId, 'open', notizen || '']
    );

    const lieferschein = lieferscheinResult.rows[0];

    // Update items to reference this Lieferschein
    if (items && items.length > 0) {
      for (const artikelnummer of items) {
        await db.query(
          `UPDATE "Schmuckstück"
           SET "Lieferschein_ID" = $1, "Ausgelagert" = $2
           WHERE "Artikelnummer" = $3`,
          [lieferschein.ID, kundeId, artikelnummer]
        );
      }
    }

    res.status(201).json(lieferschein);
  } catch (error) {
    logger.error('LIEFERSCHEIN', 'Create failed', { message: error.message });
    res.status(500).json({ error: 'Failed to create Lieferschein' });
  }
});
```

## Rechnungen (Invoices)

### Schema

**Table:** `Rechnung`
- `ID` (SERIAL) - Primary key
- `Kunde_ID` (INT) - Customer reference
- `Erstelldatum` (TIMESTAMP) - Invoice date
- `Zahlungsdatum` (TIMESTAMP) - Payment date (if paid)
- `Status` (VARCHAR) - open, paid, overdue
- `Summe` (NUMERIC) - Total amount

### Invoice Creation Logic

**Automatic Invoice Creation from SumUp:**

```javascript
// In /backend/src/routes/sumup.js
async function createInvoiceFromSales(items, kundeId) {
  try {
    // Calculate totals
    let totalAmount = 0;
    const itemList = [];

    for (const item of items) {
      const builder = where();
      builder.field('Artikelnummer', '=', item.artikelnummer);

      const result = await db.query(
        `SELECT "Verkaufspreis" FROM "Schmuckstück" ${builder.build()}`,
        builder.getParams()
      );

      if (result.rows.length > 0) {
        const price = result.rows[0].Verkaufspreis;
        totalAmount += price;
        itemList.push({
          artikelnummer: item.artikelnummer,
          price: price
        });
      }
    }

    // Create invoice
    const invoiceResult = await db.query(
      `INSERT INTO "Rechnung"
       ("Kunde_ID", "Status", "Summe", "Erstelldatum")
       VALUES ($1, $2, $3, NOW())
       RETURNING *`,
      [kundeId, 'open', totalAmount]
    );

    const invoice = invoiceResult.rows[0];

    // Mark items as sold
    for (const item of itemList) {
      await db.query(
        `UPDATE "Schmuckstück"
         SET "Verkauft" = 1, "Rechnung_ID" = $1, "Ausgelagert" = 0
         WHERE "Artikelnummer" = $2`,
        [invoice.ID, item.artikelnummer]
      );
    }

    logger.info('INVOICE', 'Invoice created from sales', {
      invoiceId: invoice.ID,
      itemCount: itemList.length,
      total: totalAmount
    });

    return invoice;
  } catch (error) {
    logger.error('INVOICE', 'Failed to create invoice', { message: error.message });
    throw error;
  }
}
```

## Common Patterns

### Generate Excel Report

```javascript
async function generateInventoryReport(filters = {}) {
  try {
    // Build query with filters
    const builder = where();

    if (filters.status) {
      if (filters.status === 'available') builder.verfuegbar();
      if (filters.status === 'sold') builder.verkauft();
      if (filters.status === 'consigned') builder.aktivAusgelagert();
    }

    if (filters.grundmaterial) {
      builder.grundmaterial(filters.grundmaterial);
    }

    // Query items
    const query = `
      SELECT * FROM "Schmuckstück"
      ${builder.build()}
      ORDER BY "Artikelnummer"
    `;

    const result = await db.query(query, builder.getParams());

    // Generate Excel
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Inventory');

    // Add headers
    const columns = [
      'Artikelnummer', 'Name', 'Art', 'Farbe', 'Material',
      'Verkaufspreis', 'Status', 'Erstelldatum'
    ];
    worksheet.addRow(columns);

    // Add data rows
    result.rows.forEach(item => {
      worksheet.addRow([
        item.Artikelnummer,
        item.Name,
        item.Art,
        item.Farbe,
        item.Material,
        item.Verkaufspreis,
        item.Verkauft ? 'Sold' : item.Ausschuss ? 'Rejected' : 'Available',
        item.Erstelldatum
      ]);
    });

    autoFitColumns(worksheet);
    return workbook;
  } catch (error) {
    logger.error('EXPORT', 'Report generation failed', { message: error.message });
    throw error;
  }
}
```

## Related Skills

- [Inventory Management](./inventory-management.md) - Item status and associations
- [Customer Management](./customer-management.md) - Customer data in documents
- [Data Synchronization](./data-sync.md) - Automatic invoice creation from SumUp
- [Database Operations](./database-operations.md) - Transaction patterns

## Troubleshooting

### Excel File Corrupted

**Cause:** Improper stream handling or encoding issues
**Solution:**
1. Ensure worksheet is properly disposed
2. Set correct Content-Type header
3. Use workbook.xlsx.write(stream) not toString()

### Missing Branding in Export

**Cause:** Logo file path not found
**Solution:**
1. Verify logo file exists at `/backend/src/assets/`
2. Check file permissions
3. Use fallback logo if primary missing

### Invoice Items Not Marked as Sold

**Cause:** Rechnung_ID not set during invoice creation
**Solution:**
1. Ensure UPDATE statement includes Rechnung_ID
2. Verify item Artikelnummer matches exactly
3. Check transaction isolation level

### Lieferschein Items Not Showing

**Cause:** Lieferschein_ID not properly set or cleared
**Solution:**
1. Check item Lieferschein_ID in database
2. Verify foreign key constraints
3. Clear old references before reassigning items
