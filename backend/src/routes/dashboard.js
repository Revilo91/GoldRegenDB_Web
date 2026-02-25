const express = require('express');
const router = express.Router();
const db = require('../config/db');

// GET dashboard statistics
router.get('/', async (req, res) => {
  try {
    const [
      totalPieces,
      soldPieces,
      outsourcedPieces,
      onlinePieces,
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
      db.query('SELECT COUNT(*) FROM "Schmuckstück"'),
      db.query('SELECT COUNT(*) FROM "Schmuckstück" WHERE "Verkauft" = 1'),
      db.query('SELECT COUNT(*) FROM "Schmuckstück" WHERE "Ausgelagert" > 0'),
      db.query('SELECT COUNT(*) FROM "Schmuckstück" WHERE "Online" = 1'),
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
                WHERE s."Ausgelagert" > 0
                GROUP BY k."Name" ORDER BY count DESC`),
    ]);

    res.json({
      statistics: {
        totalPieces: parseInt(totalPieces.rows[0].count),
        soldPieces: parseInt(soldPieces.rows[0].count),
        outsourcedPieces: parseInt(outsourcedPieces.rows[0].count),
        onlinePieces: parseInt(onlinePieces.rows[0].count),
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
    console.error(err);
    res.status(500).json({ error: 'Fehler beim Laden des Dashboards' });
  }
});

module.exports = router;
