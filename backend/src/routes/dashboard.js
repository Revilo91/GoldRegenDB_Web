const express = require("express");
const router = express.Router();
const db = require("../config/db");
const logger = require("../utils/logger");
const { where } = require("../utils/whereClauseBuilder");

// GET dashboard statistics
router.get("/", async (req, res) => {
  try {
    const [statisticsResult, recentChangesResult, piecesByArtResult, piecesByKundeResult, monthlyRevenueTrendResult] =
      await Promise.all([
        db.query(`
          SELECT
            s."totalPieces",
            s."soldPieces",
            s."outsourcedPieces",
            s."rejectPieces",
            s."inStockPieces",
            s."totalRevenue",
            s."totalCost",
            k."totalCustomers",
            k."activeCustomers"
          FROM (
            SELECT
              COUNT(*)::INT AS "totalPieces",
              COUNT(*) FILTER (WHERE "Verkauft" = 1 AND "Ausschuss" = 0)::INT AS "soldPieces",
              COUNT(*) FILTER (WHERE "Ausgelagert" > 0)::INT AS "outsourcedPieces",
              COUNT(*) FILTER (WHERE "Ausschuss" = 1)::INT AS "rejectPieces",
              COUNT(*) FILTER (WHERE "Verkauft" = 0 AND "Ausschuss" = 0 AND "Ausgelagert" = 0)::INT AS "inStockPieces",
              COALESCE(SUM("Verkaufspreis") FILTER (WHERE "Verkauft" = 1 AND "Ausschuss" = 0), 0)::DOUBLE PRECISION AS "totalRevenue",
              COALESCE(SUM("Herstellungskosten"), 0)::DOUBLE PRECISION AS "totalCost"
            FROM "Schmuckstück"
          ) s
          CROSS JOIN (
            SELECT
              COUNT(*)::INT AS "totalCustomers",
              COUNT(*) FILTER (WHERE "Aktiv" = true)::INT AS "activeCustomers"
            FROM "Kunde"
          ) k
        `),
        db.query(`
          SELECT *
          FROM audit_log
          ORDER BY change_timestamp DESC
          LIMIT 10
        `),
        db.query(`
          SELECT "Art", COUNT(*)::INT as count
          FROM "Schmuckstück"
          WHERE "Art" IS NOT NULL AND "Art" != ''
          GROUP BY "Art"
          ORDER BY count DESC
          LIMIT 10
        `),
        db.query(`
          SELECT k."Name", COUNT(s.*)::INT as count
          FROM "Schmuckstück" s
          JOIN "Kunde" k ON s."Ausgelagert" = k."ID"
          WHERE s."Ausgelagert" > 0 AND s."Verkauft" = 0 AND s."Ausschuss" = 0
          GROUP BY k."Name"
          ORDER BY count DESC
        `),
        db.query(`
          SELECT
            TO_CHAR(r."Datum", 'YYYY-MM') AS monat,
            COUNT(*)::INT AS stuecke,
            COALESCE(SUM(s."Verkaufspreis"), 0)::DOUBLE PRECISION AS umsatz
          FROM "Schmuckstück" s
          JOIN "Rechnung" r ON s."Rechnung_ID" = r."ID"
          WHERE s."Verkauft" = 1 AND s."Ausschuss" = 0 AND s."Rechnung_ID" > 0
          GROUP BY monat
          ORDER BY monat
        `),
      ]);

    const statistics = statisticsResult.rows[0];
    const inStockCount = statistics.inStockPieces;
    const outsourcedCount = statistics.outsourcedPieces;
    const soldCount = statistics.soldPieces;
    const rejectCount = statistics.rejectPieces;

    res.json({
      statistics,
      recentChanges: recentChangesResult.rows,
      piecesByArt: piecesByArtResult.rows,
      piecesByKunde: piecesByKundeResult.rows,
      statusDistribution: [
        { name: "Im Lager", value: inStockCount },
        { name: "Ausgelagert", value: outsourcedCount },
        { name: "Verkauft", value: soldCount },
        { name: "Ausschuss", value: rejectCount },
      ],
      monthlyRevenueTrend: monthlyRevenueTrendResult.rows,
    });
  } catch (err) {
    logger.error("DASHBOARD", "Fehler beim Laden des Dashboards", {
      message: err.message,
    });
    res.status(500).json({ error: "Fehler beim Laden des Dashboards" });
  }
});

module.exports = router;
