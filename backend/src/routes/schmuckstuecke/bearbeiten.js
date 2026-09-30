const router = require("express").Router();
const db = require("../../config/db");
const logger = require("../../utils/logger");
const { validate } = require("../../middleware/validate");
const { schmuckstueckUpdateSchema } = require("../../schemas");
const { requireBearbeiter } = require("../../middleware/auth");
const {
  AUSSCHUSS_GRUND_CONSTRAINT,
  resolveAusschussGrund,
} = require("../../services/schmuckstueckService");

/**
 * @swagger
 * /schmuckstuecke/{artikelnummer}:
 *   put:
 *     summary: Schmuckstück aktualisieren
 *     description: 'Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Schmuckstücke]
 *     security:
 *       - cookieAuth: []
 *         csrfHeader: []
 *       - bearerAuth: []
 *     parameters:
 *       - { name: artikelnummer, in: path, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               Name: { type: string, nullable: true }
 *               Art: { type: string, nullable: true }
 *               Form: { type: string, nullable: true }
 *               Material: { type: string, nullable: true }
 *               Farbe: { type: string, nullable: true }
 *               Länge: { type: number, nullable: true }
 *               Grösse: { type: number, nullable: true }
 *               Herstellungskosten: { type: number, nullable: true }
 *               Verkaufspreis: { type: number, nullable: true }
 *               Ausgelagert: { type: integer, description: '0 oder Kunde.ID' }
 *               Verkauft: { type: boolean }
 *               Ausschuss: { type: boolean }
 *               Ausschuss_Grund: { type: string, nullable: true }
 *               Lieferschein_ID: { type: integer }
 *               Rechnung_ID: { type: integer }
 *     responses:
 *       200:
 *         description: Aktualisiertes Schmuckstück
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Schmuckstueck' } } }
 *       400:
 *         description: Validierungsfehler, oder Ausschuss=1 ohne Ausschuss_Grund
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.put("/:artikelnummer", requireBearbeiter, validate(schmuckstueckUpdateSchema), async (req, res) => {
  try {
    const b = req.body;
    const ausschussGrundValue = resolveAusschussGrund(
      b.Ausschuss,
      b.Ausschuss_Grund,
    );

    const { rows } = await db.query(
      `UPDATE "Schmuckstück" SET
        "Name" = $1, "Art" = $2, "Form" = $3, "Länge" = $4,
        "Fassung" = $5, "Farbe" = $6, "Inhalt_Material" = $7, "Inhalt_Farbe" = $8,
        "Inhalt_Farbakzent" = $9, "Inhalt_Zusatzmaterial" = $10,
        "Anhänger_Fassung" = $11, "Anhänger_Form" = $12, "Anhänger_Farbe" = $13,
        "Anhänger_Grösse" = $14, "Anhänger_Inhalt_Material" = $15,
        "Anhänger_Inhalt_Farbe" = $16, "Anhänger_Inhalt_Farbakzente" = $17,
        "Anhänger_Inhalt_Zusatzmaterial" = $18, "Material" = $19, "Grösse" = $20,
        "Anhänger" = $21, "Zwischenstück" = $22,
        -- Auch die Geldspalten sind NOT NULL (Befund B1). Ohne COALESCE
        -- schrieb ein PUT ohne Preis frueher still NULL -- der Preis war weg,
        -- und der Audit-Trigger protokolliert Preisaenderungen nicht, die
        -- Spur fehlte also auch. Seit NOT NULL waere es stattdessen ein 500.
        "Herstellungskosten" = COALESCE($23, "Herstellungskosten"),
        "Verkaufspreis" = COALESCE($24, "Verkaufspreis"),
        -- COALESCE fuer die fuenf Statusfelder (Befund C8): sie stehen im
        -- Schema als .nullish(), ein PUT ohne diese Felder schrieb also NULL.
        -- Danach passte das Stueck auf keine Statusbedingung mehr -- weder
        -- verfuegbar (= 0) noch aktivAusgelagert (> 0) -- und fiel aus Liste,
        -- Dashboard, Inventur und SumUp-Export heraus.
        "Ausgelagert" = COALESCE($25, "Ausgelagert"),
        "Verkauft" = COALESCE($26, "Verkauft"),
        "Ausschuss" = COALESCE($27, "Ausschuss"),
        "Ausschuss_Grund" = $28,
        "Lieferschein_ID" = COALESCE($29, "Lieferschein_ID"),
        "Rechnung_ID" = COALESCE($30, "Rechnung_ID")
             WHERE "Artikelnummer" = $31 RETURNING *`,
      [
        b.Name,
        b.Art,
        b.Form,
        b.Länge,
        b.Fassung,
        b.Farbe,
        b.Inhalt_Material,
        b.Inhalt_Farbe,
        b.Inhalt_Farbakzent,
        b.Inhalt_Zusatzmaterial,
        b.Anhänger_Fassung,
        b.Anhänger_Form,
        b.Anhänger_Farbe,
        b.Anhänger_Grösse,
        b.Anhänger_Inhalt_Material,
        b.Anhänger_Inhalt_Farbe,
        b.Anhänger_Inhalt_Farbakzente,
        b.Anhänger_Inhalt_Zusatzmaterial,
        b.Material,
        b.Grösse,
        b.Anhänger,
        b.Zwischenstück,
        b.Herstellungskosten,
        b.Verkaufspreis,
        b.Ausgelagert,
        b.Verkauft,
        b.Ausschuss,
        ausschussGrundValue,
        b.Lieferschein_ID,
        b.Rechnung_ID,
        req.params.artikelnummer,
      ],
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Schmuckstück nicht gefunden" });
    }
    res.json(rows[0]);
  } catch (err) {
    if (err.code === "23514" && err.constraint === AUSSCHUSS_GRUND_CONSTRAINT) {
      return res.status(400).json({
        error:
          "Wenn ein Schmuckstueck als Ausschuss markiert ist, muss ein Ausschuss Grund angegeben werden.",
      });
    }
    logger.error(
      "SCHMUCK",
      "Fehler beim Aktualisieren des Schmuckstücks",
      { artikelnummer: req.params.artikelnummer, message: err.message },
    );
    res
      .status(500)
      .json({ error: "Fehler beim Aktualisieren des Schmuckstücks" });
  }
});

/**
 * @swagger
 * /schmuckstuecke/{artikelnummer}:
 *   delete:
 *     summary: Schmuckstück löschen
 *     description: 'Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Schmuckstücke]
 *     security:
 *       - cookieAuth: []
 *         csrfHeader: []
 *       - bearerAuth: []
 *     parameters:
 *       - { name: artikelnummer, in: path, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Schmuckstück gelöscht
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.delete("/:artikelnummer", requireBearbeiter, async (req, res) => {
  try {
    const { rowCount } = await db.query(
      'DELETE FROM "Schmuckstück" WHERE "Artikelnummer" = $1',
      [req.params.artikelnummer],
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: "Schmuckstück nicht gefunden" });
    }
    res.json({ message: "Schmuckstück gelöscht" });
  } catch (err) {
    logger.error(
      "SCHMUCK",
      "Fehler beim Löschen des Schmuckstücks",
      { artikelnummer: req.params.artikelnummer, message: err.message },
    );
    res.status(500).json({ error: "Fehler beim Löschen des Schmuckstücks" });
  }
});

module.exports = router;
