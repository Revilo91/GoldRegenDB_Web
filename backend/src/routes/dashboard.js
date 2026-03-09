const express = require("express");
const router = express.Router();
const db = require("../config/db");
const logger = require("../utils/logger");
const { where } = require("../utils/whereClauseBuilder");

// GET dashboard statistics
router.get("/", async (req, res) => {
  try {
    const tenantId = req.user?.tenant_id ?? null;

    const soldCondition = where().verkauft().buildConditions();
    const outsourcedCondition = where().ausgelagert().buildConditions();
    const rejectCondition = where().ausschuss().buildConditions();
    const inStockCondition = where().verfuegbar().buildConditions();

    const schmuckStatsScopeBuilder = where(1, tenantId);
    const schmuckStatsScope = schmuckStatsScopeBuilder.build();
    const schmuckStatsParams = schmuckStatsScopeBuilder.getParams();

    const kundenStatsScopeBuilder = where(
      schmuckStatsScopeBuilder.getNextParamIdx(),
      tenantId
    );
    const kundenStatsScope = kundenStatsScopeBuilder.build();
    const kundenStatsParams = kundenStatsScopeBuilder.getParams();

    const piecesByArtBuilder = where(1, tenantId);
    piecesByArtBuilder.notEmpty("Art");
    const piecesByArtWhere = piecesByArtBuilder.build();
    const piecesByArtParams = piecesByArtBuilder.getParams();

    const activeOutsourcedBuilder = where(1, tenantId);
    activeOutsourcedBuilder.aktivAusgelagert();
    const activeOutsourcedWhere = activeOutsourcedBuilder.build();

    const kundenScopeBuilder = where(activeOutsourcedBuilder.getNextParamIdx(), tenantId);
    const kundenScopeWhere = kundenScopeBuilder.build();
    const piecesByKundeParams = [
      ...activeOutsourcedBuilder.getParams(),
      ...kundenScopeBuilder.getParams(),
    ];

    const soldWithInvoiceBuilder = where(1, tenantId);
    soldWithInvoiceBuilder.verkauft().mitRechnung();
    const soldWithInvoiceWhere = soldWithInvoiceBuilder.build();

    const rechnungScopeBuilder = where(soldWithInvoiceBuilder.getNextParamIdx(), tenantId);
    const rechnungScopeWhere = rechnungScopeBuilder.build();
    const monthlyRevenueParams = [
      ...soldWithInvoiceBuilder.getParams(),
      ...rechnungScopeBuilder.getParams(),
    ];

    const [statisticsResult, recentChangesResult, piecesByArtResult, piecesByKundeResult, monthlyRevenueTrendResult] =
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
              COALESCE(SUM("Verkaufspreis") FILTER (WHERE ${soldCondition}), 0)::DOUBLE PRECISION AS "totalRevenue",
              COALESCE(SUM("Herstellungskosten"), 0)::DOUBLE PRECISION AS "totalCost"
            FROM "Schmuckstück"
            ${schmuckStatsScope}
          ) s
          CROSS JOIN (
            SELECT
              COUNT(*)::INT AS "totalCustomers",
              COUNT(*) FILTER (WHERE "Aktiv" = true)::INT AS "activeCustomers"
            FROM "Kunde"
            ${kundenStatsScope}
          ) k
        `,
          [...schmuckStatsParams, ...kundenStatsParams]
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
          ${kundenScopeWhere}
          GROUP BY k."Name"
          ORDER BY count DESC
        `,
          piecesByKundeParams
        ),
        db.query(
          `
          SELECT
            TO_CHAR(r."Datum", 'YYYY-MM') AS monat,
            COUNT(*)::INT AS stuecke,
            COALESCE(SUM(s."Verkaufspreis"), 0)::DOUBLE PRECISION AS umsatz
          FROM (
            SELECT "Rechnung_ID", "Verkaufspreis"
            FROM "Schmuckstück"
            ${soldWithInvoiceWhere}
          ) s
          JOIN "Rechnung" r ON s."Rechnung_ID" = r."ID"
          ${rechnungScopeWhere}
          GROUP BY monat
          ORDER BY monat
        `,
          monthlyRevenueParams
        ),
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
