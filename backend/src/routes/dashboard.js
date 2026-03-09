const express = require('express');
const router = express.Router();
const db = require('../config/db');
const logger = require('../utils/logger');

// GET dashboard statistics
router.get('/', async (req, res) => {
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
      monthlyRevenueTrend,
    ] = await Promise.all([
      db.query('SELECT COUNT(*) FROM "Schmuckstück"'),
      db.query('SELECT COUNT(*) FROM "Schmuckstück" WHERE "Verkauft" = 1'),
      db.query('SELECT COUNT(*) FROM "Schmuckstück" WHERE "Ausgelagert" > 0'),
      db.query('SELECT COUNT(*) FROM "Schmuckstück" WHERE "Ausschuss" = 1'),
      db.query('SELECT COUNT(*) FROM "Schmuckstück" WHERE "Verkauft" = 0 AND "Ausschuss" = 0 AND "Ausgelagert" = 0'),
      db.query('SELECT COUNT(*) FROM "Kunde"'),
      db.query('SELECT COUNT(*) FROM "Kunde" WHERE "Aktiv" = true'),
      db.query('SELECT COALESCE(SUM("Verkaufspreis"), 0) as total FROM "Schmuckstück" WHERE "Verkauft" = 1'),
      db.query('SELECT COALESCE(SUM("Herstellungskosten"), 0) as total FROM "Schmuckstück"'),
      db.query('SELECT * FROM audit_log ORDER BY change_timestamp DESC LIMIT 10'),
      db.query('SELECT "Art", COUNT(*) as count FROM "Schmuckstück" WHERE "Art" IS NOT NULL AND "Art" != \'\' GROUP BY "Art" ORDER BY count DESC LIMIT 10'),
      db.query(`SELECT k."Name", COUNT(s.*) as count 
                FROM "Schmuckstück" s 
                JOIN "Kunde" k ON s."Ausgelagert" = k."ID" 
                WHERE s."Ausgelagert" > 0 and s."Verkauft" = 0 and s."Ausschuss" = 0
                GROUP BY k."Name" ORDER BY count DESC`),
      db.query(`SELECT TO_CHAR(r."Datum", 'YYYY-MM') AS monat,
                  COUNT(*) AS stuecke,
                  COALESCE(SUM(s."Verkaufspreis"), 0) AS umsatz
                FROM "Schmuckstück" s
                JOIN "Rechnung" r ON s."Rechnung_ID" = r."ID"
                WHERE s."Verkauft" = 1 AND s."Rechnung_ID" > 0
                GROUP BY monat
                ORDER BY monat
                LIMIT 24`),
    ]);

    const inStockCount = parseInt(inStockPieces.rows[0].count);
    const outsourcedCount = parseInt(outsourcedPieces.rows[0].count);
    const soldCount = parseInt(soldPieces.rows[0].count);
    const rejectCount = parseInt(rejectPieces.rows[0].count);

    res.json({
      statistics: {
        totalPieces: parseInt(totalPieces.rows[0].count),
        soldPieces: soldCount,
        outsourcedPieces: outsourcedCount,
        rejectPieces: rejectCount,
        inStockPieces: inStockCount,
        totalCustomers: parseInt(totalCustomers.rows[0].count),
        activeCustomers: parseInt(activeCustomers.rows[0].count),
        totalRevenue: parseFloat(totalRevenue.rows[0].total),
        totalCost: parseFloat(totalCost.rows[0].total),
      },
      recentChanges: recentChanges.rows,
      piecesByArt: piecesByArt.rows,
      piecesByKunde: piecesByKunde.rows,
      statusDistribution: [
        { name: 'Im Lager', value: inStockCount },
        { name: 'Ausgelagert', value: outsourcedCount },
        { name: 'Verkauft', value: soldCount },
        { name: 'Ausschuss', value: rejectCount },
      ],
      monthlyRevenueTrend: monthlyRevenueTrend.rows.map((r) => ({
        monat: r.monat,
        stuecke: parseInt(r.stuecke),
        umsatz: parseFloat(r.umsatz),
      })),
    });
  } catch (err) {
    logger.error('DASHBOARD', 'Fehler beim Laden des Dashboards', { message: err.message });
    res.status(500).json({ error: 'Fehler beim Laden des Dashboards' });
  }
});

module.exports = router;
