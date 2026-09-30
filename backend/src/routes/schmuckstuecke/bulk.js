const router = require("express").Router();
const db = require("../../config/db");
const logger = require("../../utils/logger");
const { validate } = require("../../middleware/validate");
const { schmuckstueckBulkSchema } = require("../../schemas");
const { requireBearbeiter } = require("../../middleware/auth");
const { GRUNDMATERIAL, PRODUKTART } = require("../../utils/constants");
const {
  AUSSCHUSS_GRUND_CONSTRAINT,
  resolveAusschussGrund,
  parseBulkItemsFromPayload,
} = require("../../services/schmuckstueckService");

/**
 * @swagger
 * /schmuckstuecke/next-artikelnummer:
 *   get:
 *     summary: Nächste Artikelnummer für ein Präfix ermitteln
 *     description: 'Präfix = Hersteller + Grundmaterial + Produktart (z. B. MHO -> MHO127).
 *       Erfordert eine gültige Anmeldung (jede Rolle).'
 *     tags: [Schmuckstücke]
 *     parameters:
 *       - name: prefix
 *         in: query
 *         required: true
 *         schema: { type: string, pattern: '^[A-Z]{3}$', example: MHO }
 *     responses:
 *       200:
 *         description: Nächste Artikelnummer
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 prefix: { type: string }
 *                 nextNum: { type: integer }
 *                 artikelnummer: { type: string, example: MHO127 }
 *       400:
 *         description: Ungültiger oder unbekannter Präfix
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get("/next-artikelnummer", async (req, res) => {
  try {
    const rawPrefix = String(req.query.prefix || "").toUpperCase().trim();

    if (!/^[A-Z]{3}$/.test(rawPrefix)) {
      return res.status(400).json({
        error: "Ungültiger Präfix. Erwartet werden genau 3 Buchstaben.",
      });
    }

    const [herstellerCode, grundmaterialCode, produktartCode] = rawPrefix;
    if (
      !["M", "S"].includes(herstellerCode) ||
      !GRUNDMATERIAL[grundmaterialCode] ||
      !PRODUKTART[produktartCode]
    ) {
      return res.status(400).json({
        error: "Ungültige Präfix-Kombination für Hersteller, Material oder Produktart.",
      });
    }

    const { rows } = await db.query(
      `SELECT MAX(CAST(SUBSTRING("Artikelnummer", 4, 3) AS INTEGER)) as max_num
       FROM "Schmuckstück"
       WHERE "Artikelnummer" LIKE $1`,
      [`${rawPrefix}%`],
    );

    const nextNum = (rows[0]?.max_num || 0) + 1;
    const artikelnummer = `${rawPrefix}${nextNum.toString().padStart(3, "0")}`;

    res.json({
      prefix: rawPrefix,
      nextNum,
      artikelnummer,
    });
  } catch (err) {
    logger.error("SCHMUCK", "Fehler beim Ermitteln der nächsten Artikelnummer", {
      message: err.message,
    });
    res.status(500).json({
      error: "Fehler beim Ermitteln der nächsten Artikelnummer",
    });
  }
});

/**
 * @swagger
 * /schmuckstuecke/bulk:
 *   post:
 *     summary: Mehrere Schmuckstücke per expliziten Artikelnummern anlegen
 *     description: 'Zwei Eingabeformen: entweder eine items-Liste (je Eintrag eine vollständige
 *       Artikelnummer inkl. Suffix, z. B. MHO123_1) oder template + artikelnummern (Vorlage wird auf
 *       jede Artikelnummer angewendet). Maximal 200 Einträge, alle Artikelnummern müssen neu sein.
 *       Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Schmuckstücke]
 *     security:
 *       - cookieAuth: []
 *         csrfHeader: []
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               items:
 *                 type: array
 *                 maxItems: 200
 *                 items:
 *                   type: object
 *                   required: [Artikelnummer]
 *                   properties: { Artikelnummer: { type: string, example: MHO123_1 } }
 *               template: { type: object, description: 'Freitext-/Zahlenfelder, auf alle artikelnummern angewendet' }
 *               artikelnummern:
 *                 description: Liste oder durch Zeilenumbruch/Komma/Semikolon getrennter Text
 *                 oneOf: [{ type: array, items: { type: string }, maxItems: 200 }, { type: string, maxLength: 5000 }]
 *     responses:
 *       201:
 *         description: Schmuckstücke erstellt
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 createdCount: { type: integer }
 *                 createdArtikelnummern: { type: array, items: { type: string } }
 *                 items: { type: array, items: { $ref: '#/components/schemas/Schmuckstueck' } }
 *       400:
 *         description: Validierungsfehler, ungültiges/dupliziertes Format
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       409:
 *         description: Mindestens eine Artikelnummer existiert bereits
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *                 existingArtikelnummern: { type: array, items: { type: string } }
 */
router.post("/bulk", requireBearbeiter, validate(schmuckstueckBulkSchema), async (req, res) => {
  let client;
  try {
    client = await db.connect();
  } catch (err) {
    logger.error("SCHMUCK", "Fehler beim Herstellen der DB-Verbindung", {
      message: err.message,
    });
    return res
      .status(500)
      .json({ error: "Fehler beim Herstellen der Datenbankverbindung" });
  }

  try {
    const payload = req.body || {};
    const items = parseBulkItemsFromPayload(payload);

    if (items.length === 0) {
      return res.status(400).json({
        error: "Bitte mindestens einen Tabellen-Eintrag angeben.",
      });
    }

    if (items.length > 200) {
      return res.status(400).json({
        error: "Es koennen maximal 200 Artikelnummern pro Mehrfach-Erfassung verarbeitet werden.",
      });
    }

    const artikelnummern = items.map((item) => item.Artikelnummer);

    if (artikelnummern.some((value) => !value)) {
      return res.status(400).json({
        error: "Jede Tabellen-Zeile muss eine Artikelnummer enthalten.",
      });
    }

    const invalidArtikelnummern = artikelnummern.filter(
      (value) => !/^[A-Z]{3}\d{3}_\d+$/.test(value),
    );
    if (invalidArtikelnummern.length > 0) {
      return res.status(400).json({
        error:
          "Ungueltige Artikelnummern gefunden. Erlaubtes Format: ABC123_1 (Praefix + 3 Ziffern + Suffix).",
        invalidArtikelnummern,
      });
    }

    const seen = new Set();
    const duplicateInRequest = [];
    for (const artikelnummer of artikelnummern) {
      if (seen.has(artikelnummer)) {
        duplicateInRequest.push(artikelnummer);
      }
      seen.add(artikelnummer);
    }
    if (duplicateInRequest.length > 0) {
      return res.status(400).json({
        error: "Mindestens eine Artikelnummer ist in der Tabelle doppelt enthalten.",
        duplicateArtikelnummern: [...new Set(duplicateInRequest)],
      });
    }

    await client.query("BEGIN");

    const { rows: existingRows } = await client.query(
      'SELECT "Artikelnummer" FROM "Schmuckstück" WHERE "Artikelnummer" = ANY($1::text[])',
      [artikelnummern],
    );
    const existingArtikelnummern = existingRows.map((row) => row.Artikelnummer);

    if (existingArtikelnummern.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error:
          "Mindestens eine Artikelnummer existiert bereits. Es wurden keine Daten gespeichert.",
        existingArtikelnummern,
      });
    }

    const createdItems = [];
    for (const item of items) {
      const ausschussGrundValue = resolveAusschussGrund(
        item.Ausschuss,
        item.Ausschuss_Grund,
      );
      const { rows } = await client.query(
        `INSERT INTO "Schmuckstück" (
            "Artikelnummer", "Name", "Art", "Form", "Länge", "Fassung", "Farbe",
            "Inhalt_Material", "Inhalt_Farbe", "Inhalt_Farbakzent", "Inhalt_Zusatzmaterial",
            "Anhänger_Fassung", "Anhänger_Form", "Anhänger_Farbe", "Anhänger_Grösse",
            "Anhänger_Inhalt_Material", "Anhänger_Inhalt_Farbe", "Anhänger_Inhalt_Farbakzente",
            "Anhänger_Inhalt_Zusatzmaterial", "Material", "Grösse", "Anhänger", "Zwischenstück",
            "Herstellungskosten", "Verkaufspreis", "Ausgelagert", "Verkauft", "Ausschuss", "Ausschuss_Grund"
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29
          ) RETURNING *`,
        [
          item.Artikelnummer,
          item.Name || "",
          item.Art || "",
          item.Form || "",
          item.Länge || 0,
          item.Fassung || "",
          item.Farbe || "",
          item.Inhalt_Material || "",
          item.Inhalt_Farbe || "",
          item.Inhalt_Farbakzent || "",
          item.Inhalt_Zusatzmaterial || "",
          item.Anhänger_Fassung || "",
          item.Anhänger_Form || "",
          item.Anhänger_Farbe || "",
          item.Anhänger_Grösse || 0,
          item.Anhänger_Inhalt_Material || "",
          item.Anhänger_Inhalt_Farbe || "",
          item.Anhänger_Inhalt_Farbakzente || "",
          item.Anhänger_Inhalt_Zusatzmaterial || "",
          item.Material || "",
          item.Grösse || 0,
          item.Anhänger || "",
          item.Zwischenstück || "",
          item.Herstellungskosten || 0,
          item.Verkaufspreis || 0,
          0,      // Ausgelagert
          false,  // Verkauft
          false,  // Ausschuss (item.Ausschuss wird verworfen, Befund C12)
          ausschussGrundValue,
        ],
      );

      createdItems.push(rows[0]);
      await client.query(
        `INSERT INTO audit_log (table_name, artikelnummer_id, column_name, old_value, new_value, action_type, changed_by)
           VALUES ('Schmuckstück', $1, 'Erstellung Mehrfach', NULL, $2, 'INSERT', COALESCE(current_setting('app.current_user', true), current_user))`,
        [item.Artikelnummer, JSON.stringify(rows[0])],
      );
    }

    await client.query("COMMIT");
    res.status(201).json({
      createdCount: createdItems.length,
      createdArtikelnummern: createdItems.map((item) => item.Artikelnummer),
      items: createdItems,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23514" && err.constraint === AUSSCHUSS_GRUND_CONSTRAINT) {
      return res.status(400).json({
        error:
          "Wenn ein Schmuckstueck als Ausschuss markiert ist, muss ein Ausschuss Grund angegeben werden.",
      });
    }

    logger.error("SCHMUCK", "Fehler bei der Mehrfach-Erfassung von Schmuckstücken", {
      message: err.message,
    });
    res.status(500).json({
      error: "Fehler bei der Mehrfach-Erfassung von Schmuckstuecken: " + err.message,
    });
  } finally {
    client.release();
  }
});

module.exports = router;
