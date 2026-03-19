# Reporting & Analytics Skill

## Overview

This skill covers dashboard statistics, business intelligence queries, inventory analysis, and reporting capabilities powered by recharts visualization in the GoldRegenDB system.

## Core Concepts

### Dashboard Statistics

The dashboard provides real-time business metrics through aggregated queries:

- **Total Inventory:** Count of all Schmuckstücke items
- **Available Stock:** Verfügbar items (not sold, not discarded, not consigned)
- **Consigned Items:** Active Ausgelagert assignments by customer
- **Sold Items:** Total revenue and unit count
- **Discarded Items:** Ausschuss tracking
- **Customer Metrics:** Active/inactive dealer count

## Key Files

- `/backend/src/routes/dashboard.js` - Statistics endpoints
- `/backend/src/routes/inventur.js` - Customer-specific inventory
- `/.github/copilot-instructions.md` - Business logic documentation

## Dashboard Endpoints

### GET /api/dashboard

**Response Format:**

```json
{
  "statistics": {
    "totalPieces": 456,
    "soldPieces": 123,
    "outsourcedPieces": 89,
    "rejectPieces": 12,
    "inStockPieces": 232,
    "totalRevenue": 4523.50,
    "totalCost": 1850.00,
    "totalCustomers": 15,
    "activeCustomers": 12
  },
  "recentChanges": [
    {
      "Artikelnummer": "MBH001",
      "Name": "Blue Necklace",
      "action": "sold",
      "timestamp": "2024-01-15T14:30:00Z"
    }
  ],
  "piecesByArt": [
    { "Art": "Halskette", "count": 120 },
    { "Art": "Armband", "count": 85 },
    { "Art": "Ohrring", "count": 150 }
  ],
  "piecesByKunde": [
    {
      "kundeId": 5,
      "name": "Schmuckgalerie Dresden",
      "count": 25,
      "provision": 30
    }
  ],
  "monthlyRevenueTrend": [
    { "month": "2024-01", "revenue": 1250.00 },
    { "month": "2024-02", "revenue": 1500.50 }
  ],
  "manufacturerStats": [
    { "manufacturer": "Marina", "total": 250, "sold": 100 },
    { "manufacturer": "Saskia", "total": 206, "sold": 23 }
  ]
}
```

### Implementation

**File:** `/backend/src/routes/dashboard.js`

```javascript
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const logger = require('../utils/logger');
const { where } = require('../utils/whereClauseBuilder');

router.get('/', async (req, res) => {
  try {
    const tenantId = req.user?.tenant_id ?? null;

    // Build WHERE clauses for each status using builder
    const soldCondition = where().verkauft().buildConditions();
    const outsourcedCondition = where().aktivAusgelagert().buildConditions();
    const rejectCondition = where().ausschuss().buildConditions();
    const inStockCondition = where().verfuegbar().buildConditions();

    // Main statistics query
    const statisticsResult = await db.query(`
      SELECT
        COUNT(*)::INT AS "totalPieces",
        COUNT(*) FILTER (WHERE ${soldCondition})::INT AS "soldPieces",
        COUNT(*) FILTER (WHERE ${outsourcedCondition})::INT AS "outsourcedPieces",
        COUNT(*) FILTER (WHERE ${rejectCondition})::INT AS "rejectPieces",
        COUNT(*) FILTER (WHERE ${inStockCondition})::INT AS "inStockPieces",
        COALESCE(SUM("Verkaufspreis") FILTER (WHERE ${soldCondition}), 0)::DOUBLE PRECISION AS "totalRevenue",
        COALESCE(SUM("Herstellungskosten"), 0)::DOUBLE PRECISION AS "totalCost"
      FROM "Schmuckstück"
      WHERE tenant_id = $1
    `, [tenantId ?? 1]);

    // Customer statistics
    const customerResult = await db.query(`
      SELECT
        COUNT(*)::INT AS "totalCustomers",
        COUNT(*) FILTER (WHERE "Aktiv" = true)::INT AS "activeCustomers"
      FROM "Kunde"
      WHERE tenant_id = $1
    `, [tenantId ?? 1]);

    // Pieces by Art (product type) pie chart
    const piecesByArtResult = await db.query(`
      SELECT
        "Art",
        COUNT(*)::INT AS "count"
      FROM "Schmuckstück"
      WHERE tenant_id = $1
      AND "Art" IS NOT NULL
      GROUP BY "Art"
      ORDER BY "count" DESC
    `, [tenantId ?? 1]);

    // Pieces by Customer (consignment breakdown)
    const piecesByKundeResult = await db.query(`
      SELECT
        k."ID" AS "kundeId",
        k."Name" AS "name",
        COUNT(s."Artikelnummer")::INT AS "count",
        k."Provision" AS "provision"
      FROM "Kunde" k
      LEFT JOIN "Schmuckstück" s ON s."Ausgelagert" = k."ID" AND s."Verkauft" = 0 AND s."Ausschuss" = 0
      WHERE k.tenant_id = $1
      GROUP BY k."ID", k."Name", k."Provision"
      ORDER BY "count" DESC
    `, [tenantId ?? 1]);

    // Monthly revenue trend
    const monthlyRevenueResult = await db.query(`
      SELECT
        TO_CHAR(r."Erstelldatum", 'YYYY-MM') AS "month",
        SUM(s."Verkaufspreis")::DOUBLE PRECISION AS "revenue",
        COUNT(s."Artikelnummer")::INT AS "salesCount"
      FROM "Rechnung" r
      LEFT JOIN "Schmuckstück" s ON s."Rechnung_ID" = r."ID"
      WHERE r.tenant_id = $1
      GROUP BY TO_CHAR(r."Erstelldatum", 'YYYY-MM')
      ORDER BY "month" DESC
      LIMIT 12
    `, [tenantId ?? 1]);

    // Recent changes
    const recentChangesResult = await db.query(`
      SELECT
        "Artikelnummer",
        "Name",
        CASE
          WHEN "Verkauft" = 1 THEN 'sold'
          WHEN "Ausschuss" = 1 THEN 'discarded'
          WHEN "Ausgelagert" > 0 THEN 'consigned'
          ELSE 'available'
        END as "action",
        "Letzte_Aenderung" as "timestamp"
      FROM "Schmuckstück"
      WHERE tenant_id = $1
      ORDER BY "Letzte_Aenderung" DESC
      LIMIT 10
    `, [tenantId ?? 1]);

    // Manufacturer breakdown
    const manufacturerResult = await db.query(`
      SELECT
        CASE SUBSTRING("Artikelnummer", 1, 1)
          WHEN 'M' THEN 'Marina'
          WHEN 'S' THEN 'Saskia'
          ELSE 'Unknown'
        END as "manufacturer",
        COUNT(*)::INT AS "total",
        COUNT(*) FILTER (WHERE "Verkauft" = 1)::INT AS "sold"
      FROM "Schmuckstück"
      WHERE tenant_id = $1
      GROUP BY SUBSTRING("Artikelnummer", 1, 1)
      ORDER BY "total" DESC
    `, [tenantId ?? 1]);

    // Combine results
    const response = {
      statistics: {
        ...statisticsResult.rows[0],
        ...customerResult.rows[0]
      },
      recentChanges: recentChangesResult.rows,
      piecesByArt: piecesByArtResult.rows,
      piecesByKunde: piecesByKundeResult.rows,
      monthlyRevenueTrend: monthlyRevenueResult.rows,
      manufacturerStats: manufacturerResult.rows
    };

    res.json(response);
  } catch (error) {
    logger.error('DASHBOARD', 'Failed to fetch statistics', { message: error.message });
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

module.exports = router;
```

## Inventur (Customer Inventory)

### GET /api/inventur/:kundeId

**Response Format:**

```json
{
  "kunde": {
    "ID": 5,
    "Name": "Schmuckgalerie Dresden",
    "Provision": 30,
    "Aktiv": true
  },
  "inventory": [
    {
      "Artikelnummer": "MBH001",
      "Name": "Blue Necklace",
      "Art": "Halskette",
      "Farbe": "Blau",
      "Verkaufspreis": 35.00,
      "Provision": 30,
      "provisionsAmount": 10.50,
      "consignedDate": "2024-01-10"
    }
  ],
  "summary": {
    "totalItems": 25,
    "totalValue": 875.00,
    "totalCommission": 262.50
  }
}
```

### Implementation

**File:** `/backend/src/routes/inventur.js`

```javascript
router.get('/:kundeId', authenticate, requireBearbeiter, async (req, res) => {
  try {
    const { kundeId } = req.params;

    // Get customer info
    const kundeResult = await db.query(
      'SELECT * FROM "Kunde" WHERE "ID" = $1',
      [kundeId]
    );

    if (kundeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const kunde = kundeResult.rows[0];

    // Get consigned items for this customer
    const builder = where();
    builder.aktivAusgelagert(kundeId);

    const itemsResult = await db.query(
      `SELECT * FROM "Schmuckstück"
       ${builder.build()}
       ORDER BY "Artikelnummer"`,
      builder.getParams()
    );

    // Calculate summary
    const totalValue = itemsResult.rows.reduce((sum, item) => sum + item.Verkaufspreis, 0);
    const totalCommission = (totalValue * kunde.Provision) / 100;

    // Add commission to each item
    const items = itemsResult.rows.map(item => ({
      ...item,
      provisionsAmount: (item.Verkaufspreis * kunde.Provision) / 100
    }));

    res.json({
      kunde,
      inventory: items,
      summary: {
        totalItems: items.length,
        totalValue,
        totalCommission
      }
    });
  } catch (error) {
    logger.error('INVENTUR', 'Failed to fetch inventory', { message: error.message });
    res.status(500).json({ error: 'Failed to fetch inventory' });
  }
});
```

## Frontend Dashboard

### Using Recharts for Visualization

**File:** `/frontend/src/pages/Dashboard.jsx`

```javascript
import React, { useEffect, useState } from 'react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { api } from '../api';

const COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff7c7c', '#8dd1e1'];

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    try {
      const response = await api.get('/api/dashboard');
      setData(response);
    } catch (error) {
      console.error('Failed to load dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div>Loading...</div>;
  if (!data) return <div>No data available</div>;

  const { statistics, piecesByArt, monthlyRevenueTrend, manufacturerStats } = data;

  return (
    <div className="dashboard">
      <h1>Dashboard</h1>

      {/* Key Metrics */}
      <div className="metrics-grid">
        <div className="metric-card">
          <h3>Total Inventory</h3>
          <p className="metric-value">{statistics.totalPieces}</p>
        </div>

        <div className="metric-card">
          <h3>Available</h3>
          <p className="metric-value">{statistics.inStockPieces}</p>
        </div>

        <div className="metric-card">
          <h3>Sold</h3>
          <p className="metric-value">{statistics.soldPieces}</p>
          <p className="metric-detail">€{statistics.totalRevenue.toFixed(2)}</p>
        </div>

        <div className="metric-card">
          <h3>Consigned</h3>
          <p className="metric-value">{statistics.outsourcedPieces}</p>
        </div>

        <div className="metric-card">
          <h3>Customers</h3>
          <p className="metric-value">{statistics.activeCustomers}/{statistics.totalCustomers}</p>
        </div>

        <div className="metric-card">
          <h3>Margin</h3>
          <p className="metric-value">
            €{(statistics.totalRevenue - statistics.totalCost).toFixed(2)}
          </p>
        </div>
      </div>

      {/* Pieces by Art */}
      <div className="chart-container">
        <h3>Inventory by Type</h3>
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={piecesByArt}
              dataKey="count"
              nameKey="Art"
              cx="50%"
              cy="50%"
              outerRadius={80}
            >
              {piecesByArt.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Monthly Revenue Trend */}
      <div className="chart-container">
        <h3>Monthly Revenue Trend</h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={monthlyRevenueTrend}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line
              type="monotone"
              dataKey="revenue"
              stroke="#8884d8"
              dot={{ fill: '#8884d8', r: 4 }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Manufacturer Breakdown */}
      <div className="chart-container">
        <h3>Manufacturer Performance</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={manufacturerStats}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="manufacturer" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="total" fill="#8884d8" name="Total" />
            <Bar dataKey="sold" fill="#82ca9d" name="Sold" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Recent Activity */}
      <div className="recent-activity">
        <h3>Recent Activity</h3>
        <table>
          <thead>
            <tr>
              <th>Article</th>
              <th>Name</th>
              <th>Action</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {data.recentChanges.map((change, idx) => (
              <tr key={idx}>
                <td>{change.Artikelnummer}</td>
                <td>{change.Name}</td>
                <td className={`action-${change.action}`}>{change.action}</td>
                <td>{new Date(change.timestamp).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

## Analytics Queries

### Sales by Day

```sql
SELECT
  DATE("Erstelldatum") as "date",
  COUNT(*)::INT as "sales_count",
  SUM(s."Verkaufspreis")::NUMERIC(10,2) as "daily_revenue"
FROM "Rechnung" r
LEFT JOIN "Schmuckstück" s ON s."Rechnung_ID" = r."ID"
GROUP BY DATE("Erstelldatum")
ORDER BY "date" DESC;
```

### Top Performing Customers

```sql
SELECT
  k."Name",
  COUNT(s."Artikelnummer")::INT as "items_consigned",
  SUM(s."Verkaufspreis")::NUMERIC(10,2) as "total_value",
  k."Provision"
FROM "Kunde" k
LEFT JOIN "Schmuckstück" s ON s."Ausgelagert" = k."ID"
WHERE s."Ausgelagert" > 0
GROUP BY k."ID", k."Name", k."Provision"
ORDER BY "total_value" DESC;
```

### Inventory Turnover Rate

```sql
SELECT
  DATE_TRUNC('week', s."Letzte_Aenderung") as "week",
  COUNT(*)::INT as "items_changed",
  COUNT(*) FILTER (WHERE s."Verkauft" = 1)::INT as "items_sold",
  COUNT(*) FILTER (WHERE s."Ausschuss" = 1)::INT as "items_rejected"
FROM "Schmuckstück" s
WHERE s."Letzte_Aenderung" > NOW() - INTERVAL '8 weeks'
GROUP BY DATE_TRUNC('week', s."Letzte_Aenderung")
ORDER BY "week" DESC;
```

## Related Skills

- [Inventory Management](./inventory-management.md) - Data source for analytics
- [Customer Management](./customer-management.md) - Customer statistics
- [Database Operations](./database-operations.md) - Query optimization
- [Search & Filtering](./search-filtering.md) - Filtering data for reports

## Troubleshooting

### Dashboard Loads Slowly

**Cause:** Complex queries without indexes
**Solution:**
1. Add indexes on frequently aggregated columns
2. Use database query caching
3. Limit historical data scope
4. Implement incremental updates

### Revenue Calculation Incorrect

**Cause:** Missing or orphaned Rechnung references
**Solution:**
1. Verify Rechnung_ID is set correctly
2. Check for orphaned Schmuckstücke
3. Validate Verkaufspreis values
4. Run integrity checks

### Charts Not Displaying

**Cause:** Empty data or data format mismatch
**Solution:**
1. Check API response in browser DevTools
2. Verify recharts data structure matches expectations
3. Add error boundaries in React
4. Test with hardcoded sample data
