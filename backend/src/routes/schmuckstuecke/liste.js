const router = require("express").Router();
const db = require("../../config/db");
const logger = require("../../utils/logger");
const { where } = require("../../utils/whereClauseBuilder");
const { GRUNDMATERIAL, PRODUKTART } = require("../../utils/constants");
const {
  HAT_FOTO_SQL,
  SEARCHABLE_FIELDS,
  statusFilterAnwenden,
  vergleicheFilterwerte,
  FILTER_OPTION_FIELDS,
} = require("../../services/schmuckstueckService");

/**
 * @swagger
 * /schmuckstuecke:
 *   get:
 *     summary: Schmuckstücke abrufen (paginiert, durchsuchbar, filterbar)
 *     description: 'Filter kombinieren sich per AND, umgesetzt über den whereClauseBuilder (siehe
 *       CLAUDE.md). Erfordert eine gültige Anmeldung (jede Rolle).'
 *     tags: [Schmuckstücke]
 *     parameters:
 *       - { name: page, in: query, schema: { type: integer, default: 1 } }
 *       - name: limit
 *         in: query
 *         description: '-1 lädt alle Treffer ohne Limit'
 *         schema: { type: integer, default: 50 }
 *       - name: search
 *         in: query
 *         description: Freitextsuche über alle Felder, oder ein Grundmaterial-Code/-Name (z. B. "Perle")
 *         schema: { type: string }
 *       - { name: grundmaterial, in: query, schema: { type: string, example: P } }
 *       - { name: artikelnummer_art, in: query, description: Produktart-Code, schema: { type: string, example: A } }
 *       - { name: verkauft, in: query, schema: { type: integer, enum: [0, 1] } }
 *       - { name: ausgelagert, in: query, description: '0 oder eine Kunde.ID; mehrere durch Komma ("0,15" = Lager plus Kunde 15)', schema: { type: string, example: '0,15' } }
 *       - { name: ausschuss, in: query, schema: { type: integer, enum: [0, 1] } }
 *     responses:
 *       200:
 *         description: Seite mit Schmuckstücken
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     allOf:
 *                       - $ref: '#/components/schemas/Schmuckstueck'
 *                       - type: object
 *                         properties:
 *                           Grundmaterial: { type: string, description: 'Klartext-Name, aus Artikelnummer[1]' }
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     page: { type: integer }
 *                     limit: { type: integer }
 *                     total: { type: integer }
 *                     totalPages: { type: integer }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get("/", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit);
    if (isNaN(limit)) limit = 50;
    const offset = (page - 1) * limit;
    const search = req.query.search || "";
    const artikelnummer_art = req.query.artikelnummer_art;

    // Initialisiere WHERE-Builder
    const builder = where();

    if (search) {
      // Überprüfe ob das Suchfeld ein Material-NAME ist (z.B. "Perle") oder ein Code (z.B. "P")
      const searchUpper = search.toUpperCase();
      let materialCode = null;

      // Versuch 1: Direct lookup (z.B. "P" -> Perle)
      if (GRUNDMATERIAL[searchUpper]) {
        materialCode = searchUpper;
      } else {
        // Versuch 2: Nach Material-Name suchen (z.B. "Perle" -> P)
        for (const [code, name] of Object.entries(GRUNDMATERIAL)) {
          if (name.toUpperCase() === searchUpper) {
            materialCode = code;
            break;
          }
        }
      }

      if (materialCode) {
        // Wenn das Suchfeld einem Material entspricht, suche nach dem Code
        builder.grundmaterial(materialCode);
      } else {
        // Textsuche über alle Schmuckstück-Felder
        const paramIdx = builder.getNextParamIdx();
        const searchClause = SEARCHABLE_FIELDS.map(
          (field) => `COALESCE("${field}"::text, '') ILIKE $${paramIdx}`,
        ).join(" OR ");
        builder.raw(
          `(${searchClause})`,
          `%${search}%`,
        );
      }
    }

    if (req.query.grundmaterial) {
      builder.grundmaterial(req.query.grundmaterial);
    }

    if (artikelnummer_art) {
      builder.produktart(artikelnummer_art);
    }

    const filterFehler = statusFilterAnwenden(builder, req.query);
    if (filterFehler) {
      return res.status(400).json({ error: filterFehler });
    }

    const whereClause = builder.build();
    const params = builder.getParams();
    const nextParamIdx = builder.getNextParamIdx();
    // Tabellendurchlauf weniger pro Seitenaufruf. Alle Requests teilen sich
    // denselben request-gebundenen DB-Client, laufen also ohnehin nacheinander.
    const ORDER_BY = 'ORDER BY length("Artikelnummer"), "Artikelnummer"';
    const sql =
      limit === -1
        ? `SELECT *, ${HAT_FOTO_SQL}, COUNT(*) OVER() AS "__total" FROM "Schmuckstück" ${whereClause} ${ORDER_BY}`
        : `SELECT *, ${HAT_FOTO_SQL}, COUNT(*) OVER() AS "__total" FROM "Schmuckstück" ${whereClause} ${ORDER_BY} LIMIT $${nextParamIdx} OFFSET $${nextParamIdx + 1}`;
    const sqlParams = limit === -1 ? params : [...params, limit, offset];

    const { rows } = await db.query(sql, sqlParams);

    let total = rows.length > 0 ? parseInt(rows[0].__total) : 0;
    if (rows.length === 0 && offset > 0) {
      // Leere Seite hinter dem Ende: Gesamtzahl separat ermitteln, damit die
      // Blätter-Navigation im Frontend korrekt bleibt.
      const countResult = await db.query(
        `SELECT COUNT(*) FROM "Schmuckstück" ${whereClause}`,
        params,
      );
      total = parseInt(countResult.rows[0].count);
    }

    const processedRows = rows.map(({ __total, ...row }) => {
      return {
        ...row,
        Grundmaterial: row.Artikelnummer
          // Kein toUpperCase: der CHECK in der Datenbank garantiert
          // Großbuchstaben (Befund D4).
          ? GRUNDMATERIAL[row.Artikelnummer[1]] || "Unbekannt"
          : "Keine Nummer",
      };
    });

    res.json({
      data: processedRows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    logger.error("SCHMUCK", "Fehler beim Laden der Schmuckstücke", {
      message: err.message,
    });
    res.status(500).json({ error: "Fehler beim Laden der Schmuckstücke" });
  }
});

/**
 * @swagger
 * /schmuckstuecke/filter-options:
 *   get:
 *     summary: Verfügbare Filter-Optionen (Art, Farbe, Material usw.)
 *     description: 'Ein aggregierter Scan statt 27 einzelner SELECT DISTINCT. Erfordert eine gültige
 *       Anmeldung (jede Rolle).'
 *     tags: [Schmuckstücke]
 *     responses:
 *       200:
 *         description: Distinct-Werte je Feld, sortiert (Zahlen numerisch, Text nach deutscher Kollation)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: { type: array, items: {} }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get("/filter-options", async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT
         array_agg(DISTINCT "Art") FILTER (WHERE "Art" IS NOT NULL AND "Art" <> '') AS arten,
         array_agg(DISTINCT "Farbe") FILTER (WHERE "Farbe" IS NOT NULL AND "Farbe" <> '') AS farben,
         array_agg(DISTINCT "Material") FILTER (WHERE "Material" IS NOT NULL AND "Material" <> '') AS materialien,
         array_agg(DISTINCT "Form") FILTER (WHERE "Form" IS NOT NULL AND "Form" <> '') AS formen,
         array_agg(DISTINCT "Anhänger_Fassung") FILTER (WHERE "Anhänger_Fassung" IS NOT NULL AND "Anhänger_Fassung" <> '') AS anhaenger_fassungen,
         array_agg(DISTINCT "Anhänger_Form") FILTER (WHERE "Anhänger_Form" IS NOT NULL AND "Anhänger_Form" <> '') AS anhaenger_formen,
         array_agg(DISTINCT "Anhänger_Farbe") FILTER (WHERE "Anhänger_Farbe" IS NOT NULL AND "Anhänger_Farbe" <> '') AS anhaenger_farben,
         array_agg(DISTINCT "Anhänger_Grösse") FILTER (WHERE "Anhänger_Grösse" IS NOT NULL) AS anhaenger_groessen,
         array_agg(DISTINCT "Anhänger_Inhalt_Material") FILTER (WHERE "Anhänger_Inhalt_Material" IS NOT NULL AND "Anhänger_Inhalt_Material" <> '') AS anhaenger_inhalt_materialien,
         array_agg(DISTINCT "Anhänger_Inhalt_Farbe") FILTER (WHERE "Anhänger_Inhalt_Farbe" IS NOT NULL AND "Anhänger_Inhalt_Farbe" <> '') AS anhaenger_inhalt_farben,
         array_agg(DISTINCT "Anhänger_Inhalt_Farbakzente") FILTER (WHERE "Anhänger_Inhalt_Farbakzente" IS NOT NULL AND "Anhänger_Inhalt_Farbakzente" <> '') AS anhaenger_inhalt_farbakzente,
         array_agg(DISTINCT "Anhänger_Inhalt_Zusatzmaterial") FILTER (WHERE "Anhänger_Inhalt_Zusatzmaterial" IS NOT NULL AND "Anhänger_Inhalt_Zusatzmaterial" <> '') AS anhaenger_inhalt_zusatzmaterialien,
         array_agg(DISTINCT "Inhalt_Material") FILTER (WHERE "Inhalt_Material" IS NOT NULL AND "Inhalt_Material" <> '') AS inhalt_materialien,
         array_agg(DISTINCT "Inhalt_Farbe") FILTER (WHERE "Inhalt_Farbe" IS NOT NULL AND "Inhalt_Farbe" <> '') AS inhalt_farben,
         array_agg(DISTINCT "Inhalt_Farbakzent") FILTER (WHERE "Inhalt_Farbakzent" IS NOT NULL AND "Inhalt_Farbakzent" <> '') AS inhalt_farbakzente,
         array_agg(DISTINCT "Inhalt_Zusatzmaterial") FILTER (WHERE "Inhalt_Zusatzmaterial" IS NOT NULL AND "Inhalt_Zusatzmaterial" <> '') AS inhalt_zusatzmaterialien,
         array_agg(DISTINCT "Zwischenstück") FILTER (WHERE "Zwischenstück" IS NOT NULL AND "Zwischenstück" <> '') AS zwischenstuecke,
         array_agg(DISTINCT "Fassung") FILTER (WHERE "Fassung" IS NOT NULL AND "Fassung" <> '') AS fassungen,
         array_agg(DISTINCT "Länge") FILTER (WHERE "Länge" IS NOT NULL) AS laengen,
         array_agg(DISTINCT "Grösse") FILTER (WHERE "Grösse" IS NOT NULL) AS groessen,
         array_agg(DISTINCT "Name") FILTER (WHERE "Name" IS NOT NULL AND "Name" <> '') AS namen,
         array_agg(DISTINCT "Verkaufspreis") FILTER (WHERE "Verkaufspreis" IS NOT NULL) AS verkaufspreise,
         array_agg(DISTINCT "Herstellungskosten") FILTER (WHERE "Herstellungskosten" IS NOT NULL) AS herstellungskosten,
         -- ::int, damit die Filter-Optionen weiter 0/1 liefern und das
         -- Dropdown im Frontend unberuehrt bleibt
         array_agg(DISTINCT "Ausschuss"::int) FILTER (WHERE "Ausschuss" IS NOT NULL) AS ausschuesse,
         array_agg(DISTINCT "Anhänger") FILTER (WHERE "Anhänger" IS NOT NULL AND "Anhänger" <> '') AS anhaenger,
         array_agg(DISTINCT "Ausschuss_Grund") FILTER (WHERE "Ausschuss_Grund" IS NOT NULL AND "Ausschuss_Grund" <> '') AS ausschussgruende
       FROM "Schmuckstück"`,
    );

    const row = rows[0] || {};
    const options = {};
    for (const key of FILTER_OPTION_FIELDS) {
      // array_agg liefert NULL, wenn die Tabelle leer ist
      options[key] = (row[key] || []).sort(vergleicheFilterwerte);
    }

    // GRUNDMATERIAL und PRODUKTART lagen vierfach im Projekt: utils/constants.js,
    // dieser Route (als eigene Kopie), Schmuckstuecke.jsx und nochmals
    // hartcodiert im Produktart-Dropdown (Befund G22). utils/constants.js ist
    // jetzt die einzige Quelle und reist über diese Antwort ins Frontend -- das
    // holt sie ohnehin schon beim Mount, ein zweiter Endpunkt wäre unnötig.
    options.grundmaterialien = Object.entries(GRUNDMATERIAL).map(([code, label]) => ({ code, label }));
    options.produktarten = Object.entries(PRODUKTART).map(([code, label]) => ({ code, label }));

    res.json(options);
  } catch (err) {
    logger.error("SCHMUCK", "Fehler beim Laden der Filter-Optionen", {
      message: err.message,
    });
    res.status(500).json({ error: "Fehler beim Laden der Filter-Optionen" });
  }
});

/**
 * @swagger
 * /schmuckstuecke/unique-artikelnummern:
 *   get:
 *     summary: Eindeutige Basis-Artikelnummern (ohne Suffix)
 *     description: 'Für die Lager-Inventur-Zählung. Unterstützt dieselben Filter wie GET /schmuckstuecke
 *       (verkauft, ausgelagert, ausschuss, artikelnummer_art, grundmaterial). Erfordert eine gültige
 *       Anmeldung (jede Rolle).'
 *     tags: [Schmuckstücke]
 *     parameters:
 *       - { name: verkauft, in: query, schema: { type: integer, enum: [0, 1] } }
 *       - { name: ausgelagert, in: query, description: '0 oder Kunde.ID, mehrere durch Komma', schema: { type: string } }
 *       - { name: ausschuss, in: query, schema: { type: integer, enum: [0, 1] } }
 *       - { name: artikelnummer_art, in: query, schema: { type: string } }
 *       - { name: grundmaterial, in: query, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Basis-Artikelnummern
 *         content:
 *           application/json:
 *             schema: { type: array, items: { type: string, example: MHO123 } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get("/unique-artikelnummern", async (req, res) => {
  try {
    const artikelnummer_art = req.query.artikelnummer_art;
    // Initialisiere WHERE-Builder
    const builder = where();

    const filterFehler = statusFilterAnwenden(builder, req.query);
    if (filterFehler) {
      return res.status(400).json({ error: filterFehler });
    }

    if (artikelnummer_art) {
      builder.produktart(artikelnummer_art);
    }
    if (req.query.grundmaterial) {
      builder.grundmaterial(req.query.grundmaterial);
    }

    const whereClauseBuilderResult = builder.build();
    let whereClause = whereClauseBuilderResult;

    const params = builder.getParams();
    const { rows } = await db.query(
      `SELECT base_nr FROM (
         SELECT DISTINCT split_part("Artikelnummer", '_', 1) as "base_nr"
         FROM "Schmuckstück"
         ${whereClause}
       ) ORDER BY length("base_nr"), "base_nr"`,
      params,
    );
    res.json(rows.map((r) => r.base_nr));
  } catch (err) {
    logger.error(
      "SCHMUCK",
      "Fehler beim Laden der einzigartigen Artikelnummern",
      { message: err.message },
    );
    res.status(500).json({
      error: "Fehler beim Laden der einzigartigen Artikelnummern",
    });
  }
});

/**
 * @swagger
 * /schmuckstuecke/{artikelnummer}:
 *   get:
 *     summary: Schmuckstück-Detail
 *     description: 'Erfordert eine gültige Anmeldung (jede Rolle).'
 *     tags: [Schmuckstücke]
 *     parameters:
 *       - { name: artikelnummer, in: path, required: true, schema: { type: string, example: MHO123_1 } }
 *     responses:
 *       200:
 *         description: Schmuckstück
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Schmuckstueck' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get("/:artikelnummer", async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT *, ${HAT_FOTO_SQL} FROM "Schmuckstück" WHERE "Artikelnummer" = $1`,
      [req.params.artikelnummer],
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Schmuckstück nicht gefunden" });
    }
    res.json(rows[0]);
  } catch (err) {
    logger.error(
      "SCHMUCK",
      "Fehler beim Laden des Schmuckstücks",
      { artikelnummer: req.params.artikelnummer, message: err.message },
    );
    res.status(500).json({ error: "Fehler beim Laden des Schmuckstücks" });
  }
});

module.exports = router;
