const express = require("express");
const router = express.Router();
const db = require("../config/db");
const logger = require("../utils/logger");
const { where } = require("../utils/whereClauseBuilder");

/**
 * @swagger
 * /dashboard:
 *   get:
 *     summary: Statistiken (Bestände, Umsatz, Verteilung nach Status/Hersteller)
 *     description: 'Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Dashboard]
 *     responses:
 *       200:
 *         description: Aggregierte Kennzahlen
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 statistics:
 *                   type: object
 *                   properties:
 *                     verkauft: { type: integer }
 *                     ausgelagert: { type: integer }
 *                     verfuegbar: { type: integer }
 *                     ausschuss: { type: integer }
 *                     umsatz: { type: number }
 *                 recentChanges: { type: array, items: { $ref: '#/components/schemas/AuditLogEintrag' } }
 *                 piecesByArt: { type: array, items: { type: object } }
 *                 piecesByKunde: { type: array, items: { type: object } }
 *                 statusDistribution: { type: array, items: { type: object } }
 *                 monthlyRevenueTrend: { type: array, items: { type: object } }
 *                 manufacturerStats: { type: object, additionalProperties: { type: object } }
 *                 manufacturerByKunde: { type: array, items: { type: object } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get("/", async (req, res) => {
  try {
    const soldCondition = where().verkauft().buildConditions();
    const outsourcedCondition = where().aktivAusgelagert().buildConditions();
    const rejectCondition = where().ausschuss().buildConditions();
    const inStockCondition = where().verfuegbar().buildConditions();

    const piecesByArtBuilder = where();
    piecesByArtBuilder.notEmpty("Art");
    const piecesByArtWhere = piecesByArtBuilder.build();
    const piecesByArtParams = piecesByArtBuilder.getParams();

    const activeOutsourcedBuilder = where();
    activeOutsourcedBuilder.aktivAusgelagert();
    const activeOutsourcedWhere = activeOutsourcedBuilder.build();
    const piecesByKundeParams = activeOutsourcedBuilder.getParams();

    const soldWithInvoiceBuilder = where();
    soldWithInvoiceBuilder.verkauft().mitRechnung();
    const soldWithInvoiceWhere = soldWithInvoiceBuilder.build();
    const monthlyRevenueParams = soldWithInvoiceBuilder.getParams();

    // Manufacturer-specific queries
    const manufacturerOutsourcedBuilder = where();
    manufacturerOutsourcedBuilder.aktivAusgelagert();
    const manufacturerOutsourcedWhere = manufacturerOutsourcedBuilder.build();
    const manufacturerByKundeParams = manufacturerOutsourcedBuilder.getParams();

    const [statisticsResult, recentChangesResult, piecesByArtResult, piecesByKundeResult, monthlyRevenueTrendResult, manufacturerStatsResult, manufacturerByKundeResult] =
      await Promise.all([
        db.query(
          `
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
              COUNT(*) FILTER (WHERE ${soldCondition})::INT AS "soldPieces",
              COUNT(*) FILTER (WHERE ${outsourcedCondition})::INT AS "outsourcedPieces",
              COUNT(*) FILTER (WHERE ${rejectCondition})::INT AS "rejectPieces",
              COUNT(*) FILTER (WHERE ${inStockCondition})::INT AS "inStockPieces",
              -- Kein ::DOUBLE PRECISION mehr (Befund B1): die Spalte ist
              -- numeric(10,2), der Cast haette die Exaktheit wieder
              -- weggeworfen. pg liefert numeric als String, formatEur im
              -- Frontend wandelt erst an der Anzeigekante.
              COALESCE(SUM("Verkaufspreis") FILTER (WHERE ${soldCondition}), 0) AS "totalRevenue",
              COALESCE(SUM("Herstellungskosten"), 0) AS "totalCost"
            FROM "Schmuckstück"
          ) s
          CROSS JOIN (
            SELECT
              COUNT(*)::INT AS "totalCustomers",
              COUNT(*) FILTER (WHERE "Aktiv" = true)::INT AS "activeCustomers"
            FROM "Kunde"
          ) k
        `
        ),
        db.query(`
          SELECT *
          FROM audit_log
          ORDER BY change_timestamp DESC
          LIMIT 10
        `),
        db.query(
          `
          SELECT "Art", COUNT(*)::INT as count
          FROM "Schmuckstück"
          ${piecesByArtWhere}
          GROUP BY "Art"
          ORDER BY count DESC
          LIMIT 10
        `,
          piecesByArtParams
        ),
        db.query(
          `
          SELECT k."Name", COUNT(s.*)::INT as count
          FROM (
            SELECT "Ausgelagert"
            FROM "Schmuckstück"
            ${activeOutsourcedWhere}
          ) s
          JOIN "Kunde" k ON s."Ausgelagert" = k."ID"
          GROUP BY k."Name"
          ORDER BY count DESC
        `,
          piecesByKundeParams
        ),
        db.query(
          `
          SELECT
            TO_CHAR(r."Datum", 'YYYY-MM') AS monat,
            COALESCE(
              SUM(s."Verkaufspreis") FILTER (WHERE LEFT(s."Artikelnummer", 1) = 'M'),
              0
            ) AS "marinaUmsatz",
            COALESCE(
              SUM(s."Verkaufspreis") FILTER (WHERE LEFT(s."Artikelnummer", 1) = 'S'),
              0
            ) AS "saskiaUmsatz"
          FROM (
            SELECT "Rechnung_ID", "Verkaufspreis", "Artikelnummer"
            FROM "Schmuckstück"
            ${soldWithInvoiceWhere}
            AND LEFT("Artikelnummer", 1) IN ('M', 'S')
          ) s
          JOIN "Rechnung" r ON s."Rechnung_ID" = r."ID"
          GROUP BY monat
          ORDER BY monat
        `,
          monthlyRevenueParams
        ),
        // Statistics by manufacturer (M = Marina, S = Saskia)
        db.query(
          `
          SELECT
            LEFT("Artikelnummer", 1) AS hersteller,
            COUNT(*)::INT AS total,
            COUNT(*) FILTER (WHERE ${soldCondition})::INT AS verkauft,
            COUNT(*) FILTER (WHERE ${outsourcedCondition})::INT AS ausgelagert,
            COUNT(*) FILTER (WHERE ${inStockCondition})::INT AS verfuegbar,
            COUNT(*) FILTER (WHERE ${rejectCondition})::INT AS ausschuss,
            COALESCE(SUM("Verkaufspreis") FILTER (WHERE ${soldCondition}), 0) AS umsatz
          FROM "Schmuckstück"
          WHERE LEFT("Artikelnummer", 1) IN ('M', 'S')
          GROUP BY LEFT("Artikelnummer", 1)
          ORDER BY hersteller
        `
        ),
        // Outsourced pieces by manufacturer and customer
        db.query(
          `
          SELECT
            LEFT(s."Artikelnummer", 1) AS hersteller,
            k."Name" AS kunde,
            COUNT(s.*)::INT AS anzahl
          FROM (
            SELECT "Ausgelagert", "Artikelnummer"
            FROM "Schmuckstück"
            ${manufacturerOutsourcedWhere}
            AND LEFT("Artikelnummer", 1) IN ('M', 'S')
          ) s
          JOIN "Kunde" k ON s."Ausgelagert" = k."ID"
          GROUP BY LEFT(s."Artikelnummer", 1), k."Name"
          ORDER BY hersteller, anzahl DESC
        `,
          manufacturerByKundeParams
        ),
      ]);

    const statistics = statisticsResult.rows[0];
    const inStockCount = statistics.inStockPieces;
    const outsourcedCount = statistics.outsourcedPieces;
    const soldCount = statistics.soldPieces;
    const rejectCount = statistics.rejectPieces;
    const totalStatusCount =
      inStockCount + outsourcedCount + soldCount + rejectCount;

    const createStatusDistributionItem = (name, value) => ({
      name,
      value,
      percentage:
        totalStatusCount > 0
          ? Number(((value / totalStatusCount) * 100).toFixed(1))
          : 0,
    });

    // Process manufacturer statistics
    const manufacturerStats = {};
    manufacturerStatsResult.rows.forEach((row) => {
      manufacturerStats[row.hersteller] = {
        total: row.total,
        verkauft: row.verkauft,
        ausgelagert: row.ausgelagert,
        verfuegbar: row.verfuegbar,
        ausschuss: row.ausschuss,
        umsatz: row.umsatz,
      };
    });

    // Process manufacturer by kunde
    const manufacturerByKunde = manufacturerByKundeResult.rows;

    res.json({
      statistics,
      recentChanges: recentChangesResult.rows,
      piecesByArt: piecesByArtResult.rows,
      piecesByKunde: piecesByKundeResult.rows,
      statusDistribution: [
        createStatusDistributionItem("Im Lager", inStockCount),
        createStatusDistributionItem("Ausgelagert", outsourcedCount),
        createStatusDistributionItem("Verkauft", soldCount),
        createStatusDistributionItem("Ausschuss", rejectCount),
      ],
      monthlyRevenueTrend: monthlyRevenueTrendResult.rows,
      manufacturerStats,
      manufacturerByKunde,
    });
  } catch (err) {
    logger.error("DASHBOARD", "Fehler beim Laden des Dashboards", {
      message: err.message,
    });
    res.status(500).json({ error: "Fehler beim Laden des Dashboards" });
  }
});

module.exports = router;
