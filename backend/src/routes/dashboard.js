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
    const tenantId = req.user?.tenant_id ?? null;

    const soldCondition = where().verkauft().buildConditions();
    const outsourcedCondition = where().aktivAusgelagert().buildConditions();
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

    // Manufacturer-specific queries
    const manufacturerStatsBuilder = where(1, tenantId);
    const manufacturerStatsWhere = manufacturerStatsBuilder.build();
    const manufacturerStatsParams = manufacturerStatsBuilder.getParams();

    const manufacturerOutsourcedBuilder = where(1, tenantId);
    manufacturerOutsourcedBuilder.aktivAusgelagert();
    const manufacturerOutsourcedWhere = manufacturerOutsourcedBuilder.build();

    const manufacturerKundenBuilder = where(manufacturerOutsourcedBuilder.getNextParamIdx(), tenantId);
    const manufacturerKundenWhere = manufacturerKundenBuilder.build();
    const manufacturerByKundeParams = [
      ...manufacturerOutsourcedBuilder.getParams(),
      ...manufacturerKundenBuilder.getParams(),
    ];

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
            COALESCE(
              SUM(s."Verkaufspreis") FILTER (WHERE LEFT(s."Artikelnummer", 1) = 'M'),
              0
            )::DOUBLE PRECISION AS "marinaUmsatz",
            COALESCE(
              SUM(s."Verkaufspreis") FILTER (WHERE LEFT(s."Artikelnummer", 1) = 'S'),
              0
            )::DOUBLE PRECISION AS "saskiaUmsatz"
          FROM (
            SELECT "Rechnung_ID", "Verkaufspreis", "Artikelnummer"
            FROM "Schmuckstück"
            ${soldWithInvoiceWhere}
            AND LEFT("Artikelnummer", 1) IN ('M', 'S')
          ) s
          JOIN "Rechnung" r ON s."Rechnung_ID" = r."ID"
          ${rechnungScopeWhere}
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
            COALESCE(SUM("Verkaufspreis") FILTER (WHERE ${soldCondition}), 0)::DOUBLE PRECISION AS umsatz
          FROM "Schmuckstück"
          ${manufacturerStatsWhere}
          WHERE LEFT("Artikelnummer", 1) IN ('M', 'S')
          GROUP BY LEFT("Artikelnummer", 1)
          ORDER BY hersteller
        `,
          manufacturerStatsParams
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
          ${manufacturerKundenWhere}
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

/**
 * @swagger
 * /dashboard/hersteller-uebersicht:
 *   get:
 *     summary: Übersicht getrennt nach Hersteller (Marina/Saskia) und Mietfach-Verweildauer
 *     description: >-
 *       Bestand, Einnahmen (gesamt, Ø, pro Kunde, Monatsverlauf) und Mietfach-Aging
 *       je Hersteller. "Mietfach" = aktiv bei einem Kunden ausgelagert. Verweildauer
 *       wird abgeleitet aus Lieferschein-Datum, sonst letztem Audit-Log-Wechsel von
 *       "Ausgelagert", sonst Erstelldatum. Erfordert Rolle: bearbeiter oder admin.
 *     tags: [Dashboard]
 *     parameters:
 *       - in: query
 *         name: jahr
 *         schema: { type: integer }
 *         description: Optionaler Jahresfilter für die Einnahmen (Rechnungsdatum). Ohne Angabe alle Jahre.
 *     responses:
 *       200: { description: Übersicht je Hersteller }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get("/hersteller-uebersicht", async (req, res) => {
  try {
    // whereClauseBuilder-Fragmente (parameterlos, da einspaltige Bedingungen).
    // In den JOIN-Queries unten sind die Spalten eindeutig -> unqualifiziert ok.
    const soldCond = where().verkauft().buildConditions();
    const outsourcedCond = where().aktivAusgelagert().buildConditions();
    const availableCond = where().verfuegbar().buildConditions();
    const rejectCond = where().ausschuss().buildConditions();

    // "Im Mietfach" = aktiv ausgelagert UND noch nicht auf einer Rechnung.
    // Manche verkauften Stücke behalten faelschlich Verkauft=0, haben aber eine Rechnung_ID.
    const mietfachCond = `${outsourcedCond} AND COALESCE("Rechnung_ID", 0) = 0`;

    // Optionaler Jahresfilter (nur Einnahmen; Bestand/Mietfach sind immer aktueller Stand)
    const jahrRaw = Number.parseInt(req.query.jahr, 10);
    const aktuellesJahr = new Date().getFullYear();
    const jahr =
      Number.isInteger(jahrRaw) && jahrRaw >= 2005 && jahrRaw <= aktuellesJahr + 1 ? jahrRaw : null;
    const jahrClause = jahr ? `AND EXTRACT(YEAR FROM r."Datum") = $1` : "";
    const jahrParams = jahr ? [jahr] : [];

    const HERSTELLER = { M: "Marina", S: "Saskia" };
    const AGING_BUCKETS = [
      { key: "0-30", label: "≤ 30 Tage", min: 0, max: 30 },
      { key: "31-90", label: "31–90 Tage", min: 31, max: 90 },
      { key: "91-180", label: "91–180 Tage", min: 91, max: 180 },
      { key: "180+", label: "> 180 Tage", min: 181, max: Infinity },
    ];

    const [
      bestandResult,
      monatsumsatzResult,
      einnahmenProKundeResult,
      mietfachResult,
      jahreResult,
    ] = await Promise.all([
        db.query(`
          SELECT
            SUBSTRING("Artikelnummer", 1, 1) AS hersteller,
            COUNT(*)::INT AS total,
            COUNT(*) FILTER (WHERE ${availableCond})::INT AS verfuegbar,
            COUNT(*) FILTER (WHERE ${mietfachCond})::INT AS ausgelagert,
            COUNT(*) FILTER (WHERE ${soldCond})::INT AS verkauft,
            COUNT(*) FILTER (WHERE ${rejectCond})::INT AS ausschuss,
            COALESCE(SUM("Verkaufspreis") FILTER (WHERE ${mietfachCond}), 0)::DOUBLE PRECISION AS gebundener_wert
          FROM "Schmuckstück"
          WHERE SUBSTRING("Artikelnummer", 1, 1) IN ('M', 'S')
          GROUP BY 1
        `),
        db.query(
          `
          SELECT
            TO_CHAR(r."Datum", 'YYYY-MM') AS monat,
            SUBSTRING(s."Artikelnummer", 1, 1) AS hersteller,
            COALESCE(SUM(s."Verkaufspreis"), 0)::DOUBLE PRECISION AS umsatz,
            COUNT(*)::INT AS anzahl
          FROM "Schmuckstück" s
          JOIN "Rechnung" r ON s."Rechnung_ID" = r."ID"
          WHERE ${soldCond}
            AND SUBSTRING(s."Artikelnummer", 1, 1) IN ('M', 'S')
            AND r."Datum" >= DATE '2005-01-01'
            ${jahrClause}
          GROUP BY monat, hersteller
          ORDER BY monat
        `,
          jahrParams
        ),
        db.query(
          `
          SELECT
            SUBSTRING(s."Artikelnummer", 1, 1) AS hersteller,
            k."Name" AS kunde,
            COALESCE(SUM(s."Verkaufspreis"), 0)::DOUBLE PRECISION AS umsatz,
            COUNT(*)::INT AS anzahl
          FROM "Schmuckstück" s
          JOIN "Rechnung" r ON s."Rechnung_ID" = r."ID"
          JOIN "Kunde" k ON r."Kundennummer" = k."ID"
          WHERE ${soldCond}
            AND SUBSTRING(s."Artikelnummer", 1, 1) IN ('M', 'S')
            AND r."Datum" >= DATE '2005-01-01'
            ${jahrClause}
          GROUP BY hersteller, k."Name"
          ORDER BY hersteller, umsatz DESC
        `,
          jahrParams
        ),
        db.query(`
          WITH mietfach AS (
            SELECT
              s."Artikelnummer" AS artikelnummer,
              s."Name" AS name,
              COALESCE(s."Verkaufspreis", 0)::DOUBLE PRECISION AS wert,
              SUBSTRING(s."Artikelnummer", 1, 1) AS hersteller,
              k."Name" AS kunde,
              COALESCE(
                CASE WHEN l."Datum" >= DATE '2005-01-01' THEN l."Datum" END,
                au.ts,
                s."Erstelldatum"
              ) AS seit,
              CASE
                WHEN l."Datum" >= DATE '2005-01-01' THEN 'lieferschein'
                WHEN au.ts IS NOT NULL THEN 'audit'
                ELSE 'erstellt'
              END AS quelle
            FROM "Schmuckstück" s
            JOIN "Kunde" k ON s."Ausgelagert" = k."ID"
            LEFT JOIN "Lieferschein" l ON s."Lieferschein_ID" = l."ID"
            LEFT JOIN LATERAL (
              SELECT MAX(change_timestamp) AS ts
              FROM audit_log
              WHERE table_name = 'Schmuckstück'
                AND artikelnummer_id = s."Artikelnummer"
                AND column_name = 'Ausgelagert'
                AND new_value <> '0'
            ) au ON TRUE
            WHERE ${mietfachCond}
              AND SUBSTRING(s."Artikelnummer", 1, 1) IN ('M', 'S')
          )
          SELECT
            hersteller, artikelnummer, name, wert, kunde, quelle, seit,
            GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - seit)) / 86400))::INT AS tage
          FROM mietfach
          ORDER BY tage DESC
        `),
        db.query(`
          SELECT DISTINCT EXTRACT(YEAR FROM r."Datum")::INT AS jahr
          FROM "Schmuckstück" s
          JOIN "Rechnung" r ON s."Rechnung_ID" = r."ID"
          WHERE ${soldCond}
            AND SUBSTRING(s."Artikelnummer", 1, 1) IN ('M', 'S')
            AND r."Datum" >= DATE '2005-01-01'
          ORDER BY jahr DESC
        `),
      ]);

    const bucketOf = (tage) =>
      AGING_BUCKETS.find((b) => tage >= b.min && tage <= b.max) || AGING_BUCKETS[AGING_BUCKETS.length - 1];

    const median = (arr) => {
      if (!arr.length) return 0;
      const s = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
    };

    const hersteller = {};
    for (const [key, label] of Object.entries(HERSTELLER)) {
      const b = bestandResult.rows.find((r) => r.hersteller === key) || {};
      const mietfachRows = mietfachResult.rows.filter((r) => r.hersteller === key);
      const kundenRows = einnahmenProKundeResult.rows.filter((r) => r.hersteller === key);
      const monatsRows = monatsumsatzResult.rows.filter((r) => r.hersteller === key);

      // Einnahmen im gewählten Zeitraum (Rechnungsdatum) – deckt sich mit dem Umsatzverlauf
      const einnahmenGesamt = monatsRows.reduce((sum, r) => sum + r.umsatz, 0);
      const anzahlVerkauft = monatsRows.reduce((sum, r) => sum + r.anzahl, 0);

      const buckets = AGING_BUCKETS.map((bk) => ({
        key: bk.key,
        label: bk.label,
        anzahl: 0,
        wert: 0,
      }));
      const proKundeMap = new Map();
      for (const row of mietfachRows) {
        const bk = buckets.find((x) => x.key === bucketOf(row.tage).key);
        bk.anzahl += 1;
        bk.wert += row.wert;

        if (!proKundeMap.has(row.kunde)) {
          proKundeMap.set(row.kunde, { kunde: row.kunde, anzahl: 0, wert: 0, tage: [] });
        }
        const pk = proKundeMap.get(row.kunde);
        pk.anzahl += 1;
        pk.wert += row.wert;
        pk.tage.push(row.tage);
      }

      const proKunde = [...proKundeMap.values()]
        .map((pk) => ({
          kunde: pk.kunde,
          anzahl: pk.anzahl,
          wert: Number(pk.wert.toFixed(2)),
          aeltestesTage: Math.max(...pk.tage),
          schnittTage: Math.round(pk.tage.reduce((a, c) => a + c, 0) / pk.tage.length),
        }))
        .sort((a, b) => b.aeltestesTage - a.aeltestesTage);

      hersteller[key] = {
        label,
        bestand: {
          total: b.total || 0,
          verfuegbar: b.verfuegbar || 0,
          ausgelagert: b.ausgelagert || 0,
          verkauft: b.verkauft || 0,
          ausschuss: b.ausschuss || 0,
        },
        einnahmen: {
          gesamt: Number(einnahmenGesamt.toFixed(2)),
          durchschnitt: anzahlVerkauft > 0 ? Number((einnahmenGesamt / anzahlVerkauft).toFixed(2)) : 0,
          anzahlVerkauft,
          gebundenerWertMietfach: Number((b.gebundener_wert || 0).toFixed(2)),
          proKunde: kundenRows.slice(0, 12).map((r) => ({
            kunde: r.kunde,
            umsatz: Number(r.umsatz.toFixed(2)),
            anzahl: r.anzahl,
          })),
        },
        monatsumsatz: monatsRows.map((r) => ({
          monat: r.monat,
          umsatz: Number(r.umsatz.toFixed(2)),
          anzahl: r.anzahl,
        })),
        mietfach: {
          stuecke: mietfachRows.length,
          buckets: buckets.map((bk) => ({ ...bk, wert: Number(bk.wert.toFixed(2)) })),
          proKunde,
          aeltesteStuecke: mietfachRows.slice(0, 10).map((r) => ({
            artikelnummer: r.artikelnummer,
            name: r.name,
            kunde: r.kunde,
            tage: r.tage,
            seit: r.seit,
            quelle: r.quelle,
          })),
        },
      };
    }

    const einnahmenSumme = hersteller.M.einnahmen.gesamt + hersteller.S.einnahmen.gesamt;

    res.json({
      hersteller,
      jahr,
      verfuegbareJahre: jahreResult.rows.map((r) => r.jahr),
      vergleich: {
        einnahmenAnteil: {
          M: einnahmenSumme > 0 ? Number((hersteller.M.einnahmen.gesamt / einnahmenSumme).toFixed(4)) : 0,
          S: einnahmenSumme > 0 ? Number((hersteller.S.einnahmen.gesamt / einnahmenSumme).toFixed(4)) : 0,
        },
        mietfachAlterMedianTage: {
          M: median(mietfachResult.rows.filter((r) => r.hersteller === "M").map((r) => r.tage)),
          S: median(mietfachResult.rows.filter((r) => r.hersteller === "S").map((r) => r.tage)),
        },
      },
    });
  } catch (err) {
    logger.error("DASHBOARD", "Fehler beim Laden der Hersteller-Übersicht", {
      message: err.message,
    });
    res.status(500).json({ error: "Fehler beim Laden der Hersteller-Übersicht" });
  }
});

module.exports = router;
