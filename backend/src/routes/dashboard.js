const express = require('express');
const router = express.Router();
const db = require('../config/db');
const logger = require('../utils/logger');

// GET dashboard statistics
router.get('/', async (req, res) => {
  const tenantId = req.user.tenant_id ?? 1;
  try {
    const [
      totalPieces,
      soldPieces,
      outsourcedPieces,
      rejectPieces,
      inStockPieces,
      totalCustomers,
      activeCustomers,
      totalRevenue,
      totalCost,
      recentChanges,
      piecesByArt,
      piecesByKunde,
    ] = await Promise.all([
      db.query('SELECT COUNT(*) FROM "Schmuckstück" WHERE "tenant_id" = $1', [tenantId]),
      db.query('SELECT COUNT(*) FROM "Schmuckstück" WHERE "Verkauft" = 1 AND "tenant_id" = $1', [tenantId]),
      db.query('SELECT COUNT(*) FROM "Schmuckstück" WHERE "Ausgelagert" > 0 AND "tenant_id" = $1', [tenantId]),
      db.query('SELECT COUNT(*) FROM "Schmuckstück" WHERE "Ausschuss" = 1 AND "tenant_id" = $1', [tenantId]),
      db.query('SELECT COUNT(*) FROM "Schmuckstück" WHERE "Verkauft" = 0 AND "Ausschuss" = 0 AND "Ausgelagert" = 0 AND "tenant_id" = $1', [tenantId]),
      db.query('SELECT COUNT(*) FROM "Kunde" WHERE "tenant_id" = $1', [tenantId]),
      db.query('SELECT COUNT(*) FROM "Kunde" WHERE "Aktiv" = true AND "tenant_id" = $1', [tenantId]),
      db.query('SELECT COALESCE(SUM("Verkaufspreis"), 0) as total FROM "Schmuckstück" WHERE "Verkauft" = 1 AND "tenant_id" = $1', [tenantId]),
      db.query('SELECT COALESCE(SUM("Herstellungskosten"), 0) as total FROM "Schmuckstück" WHERE "tenant_id" = $1', [tenantId]),
      db.query('SELECT * FROM audit_log ORDER BY change_timestamp DESC LIMIT 10'),
      db.query('SELECT "Art", COUNT(*) as count FROM "Schmuckstück" WHERE "Art" IS NOT NULL AND "Art" != \'\' AND "tenant_id" = $1 GROUP BY "Art" ORDER BY count DESC LIMIT 10', [tenantId]),
      db.query(`SELECT k."Name", COUNT(s.*) as count 
                FROM "Schmuckstück" s 
                JOIN "Kunde" k ON s."Ausgelagert" = k."ID" 
                WHERE s."Ausgelagert" > 0 and s."Verkauft" = 0 and s."Ausschuss" = 0 AND s."tenant_id" = $1
                GROUP BY k."Name" ORDER BY count DESC`, [tenantId]),
    ]);

    res.json({
      statistics: {
        totalPieces: parseInt(totalPieces.rows[0].count),
        soldPieces: parseInt(soldPieces.rows[0].count),
        outsourcedPieces: parseInt(outsourcedPieces.rows[0].count),
        rejectPieces: parseInt(rejectPieces.rows[0].count),
        inStockPieces: parseInt(inStockPieces.rows[0].count),
        totalCustomers: parseInt(totalCustomers.rows[0].count),
        activeCustomers: parseInt(activeCustomers.rows[0].count),
        totalRevenue: parseFloat(totalRevenue.rows[0].total),
        totalCost: parseFloat(totalCost.rows[0].total),
      },
      recentChanges: recentChanges.rows,
      piecesByArt: piecesByArt.rows,
      piecesByKunde: piecesByKunde.rows,
    });
  } catch (err) {
    logger.error('DASHBOARD', 'Fehler beim Laden des Dashboards', { message: err.message });
    res.status(500).json({ error: 'Fehler beim Laden des Dashboards' });
  }
});

module.exports = router;
