const express = require("express");
const router = express.Router();
const db = require("../config/db");
const logger = require("../utils/logger");
const { validate } = require("../middleware/validate");
const { lagerinventurSchema } = require("../schemas");
const { where } = require("../utils/whereClauseBuilder");

/**
 * @swagger
 * /lagerinventur/drafts:
 *   get:
 *     summary: Eigene Lager-Inventur-Entwürfe abrufen (status=entwurf)
 *     description: 'Nur Entwürfe des angemeldeten Benutzers. Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Lager-Inventur]
 *     responses:
 *       200:
 *         description: Entwürfe
 *         content:
 *           application/json:
 *             schema: { type: array, items: { $ref: '#/components/schemas/LagerinventurEntwurf' } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get("/drafts", async (req, res) => {
  try {
    const userId = req.user.id;
    const { rows } = await db.query(
      "SELECT * FROM lagerinventur WHERE user_id = $1 AND status = $2 ORDER BY updated_at DESC",
      [userId, "entwurf"],
    );
    res.json(rows);
  } catch (err) {
    logger.error("LAGERINVENTUR", "Fehler beim Abrufen der Entwürfe", { message: err.message });
    res.status(500).json({ error: "Fehler beim Abrufen der Entwürfe" });
  }
});

/**
 * @swagger
 * /lagerinventur/drafts/{id}:
 *   get:
 *     summary: Einzelnen Lager-Inventur-Entwurf abrufen
 *     description: 'Nur der eigene Entwurf des angemeldeten Benutzers. Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Lager-Inventur]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: Entwurf
 *         content: { application/json: { schema: { $ref: '#/components/schemas/LagerinventurEntwurf' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get("/drafts/:id", async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { rows } = await db.query(
      "SELECT * FROM lagerinventur WHERE id = $1 AND user_id = $2",
      [id, userId],
    );
    if (rows.length === 0)
      return res.status(404).json({ error: "Entwurf nicht gefunden" });
    res.json(rows[0]);
  } catch (err) {
    logger.error("LAGERINVENTUR", "Fehler beim Abrufen des Entwurfs", { message: err.message });
    res.status(500).json({ error: "Fehler beim Abrufen des Entwurfs" });
  }
});

/**
 * @swagger
 * /lagerinventur/drafts:
 *   post:
 *     summary: Neuen Lager-Inventur-Entwurf anlegen
 *     description: 'Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Lager-Inventur]
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
 *             required: [data]
 *             properties:
 *               data:
 *                 type: object
 *                 description: Gezählte Menge je Artikelnummer
 *                 additionalProperties: { type: integer, minimum: 1 }
 *                 example: { MHO123_1: 3 }
 *               kommentar: { type: string, nullable: true, maxLength: 1000 }
 *     responses:
 *       201:
 *         description: Entwurf erstellt
 *         content: { application/json: { schema: { $ref: '#/components/schemas/LagerinventurEntwurf' } } }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post("/drafts", validate(lagerinventurSchema), async (req, res) => {
  try {
    const userId = req.user.id;
    const { data, kommentar } = req.body;
    const { rows } = await db.query(
      "INSERT INTO lagerinventur (user_id, data, kommentar) VALUES ($1, $2, $3) RETURNING *",
      [userId, data, kommentar || null],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    logger.error("LAGERINVENTUR", "Fehler beim Anlegen des Entwurfs", { message: err.message });
    res.status(500).json({ error: "Fehler beim Anlegen des Entwurfs" });
  }
});

/**
 * @swagger
 * /lagerinventur/drafts/{id}:
 *   put:
 *     summary: Lager-Inventur-Entwurf aktualisieren
 *     description: 'Nur solange status=entwurf, und nur der eigene Entwurf. Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Lager-Inventur]
 *     security:
 *       - cookieAuth: []
 *         csrfHeader: []
 *       - bearerAuth: []
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [data]
 *             properties:
 *               data:
 *                 type: object
 *                 additionalProperties: { type: integer, minimum: 1 }
 *                 example: { MHO123_1: 3 }
 *               kommentar: { type: string, nullable: true, maxLength: 1000 }
 *     responses:
 *       200:
 *         description: Entwurf aktualisiert
 *         content: { application/json: { schema: { $ref: '#/components/schemas/LagerinventurEntwurf' } } }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404:
 *         description: Entwurf nicht gefunden oder nicht mehr bearbeitbar (bereits abgeschlossen)
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 */
router.put("/drafts/:id", validate(lagerinventurSchema), async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { data, kommentar } = req.body;
    const { rows } = await db.query(
      "UPDATE lagerinventur SET data = $1, kommentar = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 AND user_id = $4 AND status = $5 RETURNING *",
      [data, kommentar || null, id, userId, "entwurf"],
    );
    if (rows.length === 0)
      return res
        .status(404)
        .json({ error: "Entwurf nicht gefunden oder nicht mehr bearbeitbar" });
    res.json(rows[0]);
  } catch (err) {
    logger.error("LAGERINVENTUR", "Fehler beim Aktualisieren des Entwurfs", { message: err.message });
    res.status(500).json({ error: "Fehler beim Aktualisieren des Entwurfs" });
  }
});

/**
 * @swagger
 * /lagerinventur/drafts/{id}/diff:
 *   get:
 *     summary: Soll/Ist-Vergleich des Entwurfs mit dem aktuellen Lagerbestand
 *     description: 'Soll = aktuell im Lager (Ausgelagert=0, Verkauft=0, Ausschuss=0), gruppiert nach
 *       Basis-Artikelnummer (ohne Suffix). Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Lager-Inventur]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: Differenz nach Basis-Artikelnummer
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 fehlend: { type: array, items: { type: object } }
 *                 gefunden: { type: array, items: { type: object } }
 *                 unbekannt: { type: array, items: { type: object } }
 *                 stats:
 *                   type: object
 *                   properties:
 *                     soll: { type: integer }
 *                     gescannt: { type: integer }
 *                     fehlend: { type: integer }
 *                     gefunden: { type: integer }
 *                     unbekannt: { type: integer }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get("/drafts/:id/diff", async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // Entwurf laden
    const { rows: draftRows } = await db.query(
      "SELECT * FROM lagerinventur WHERE id = $1 AND user_id = $2",
      [id, userId],
    );
    if (draftRows.length === 0)
      return res.status(404).json({ error: "Entwurf nicht gefunden" });

    const draft = draftRows[0];
    const scanned = draft.data || {}; // { "MXO001_1": 1, "MXO001_2": 2, ... }

    // Soll-Bestand: alle Artikel im Lager (nicht ausgelagert, nicht verkauft, kein Ausschuss)
    // Wort für Wort dasselbe wie builder.verfuegbar(), war aber von Hand
    // geschrieben (Befund F5).
    const lagerBuilder = where();
    lagerBuilder.verfuegbar();
    const { rows: lagerRows } = await db.query(
      `SELECT "Artikelnummer", "Name", "Verkaufspreis", "Art", "Material"
       FROM "Schmuckstück"
       ${lagerBuilder.build()}
       ORDER BY length("Artikelnummer"), "Artikelnummer"`,
      lagerBuilder.getParams(),
    );

    // Soll aggregieren
    const sollStats = {};
    for (const row of lagerRows) {
      const baseNr = row.Artikelnummer.split("_")[0];
      if (!sollStats[baseNr]) {
        sollStats[baseNr] = {
          BaseNr: baseNr,
          Name: row.Name,
          Art: row.Art,
          Verkaufspreis: row.Verkaufspreis,
          Soll: 0,
        };
      }
      sollStats[baseNr].Soll += 1;
    }

    // Ist aggregieren
    const istStats = {};
    for (const [nr, count] of Object.entries(scanned)) {
      const baseNr = nr.split("_")[0];
      istStats[baseNr] = (istStats[baseNr] || 0) + count;
    }

    const fehlend = [];
    const gefunden = [];
    const unbekannt = [];

    const allBaseNrs = new Set([
      ...Object.keys(sollStats),
      ...Object.keys(istStats),
    ]);

    let statsFehlend = 0;
    let statsUnbekannt = 0;
    let statsGefunden = 0;

    for (const baseNr of allBaseNrs) {
      const sollObj = sollStats[baseNr] || {
        BaseNr: baseNr,
        Name: "–",
        Art: "–",
        Verkaufspreis: 0,
        Soll: 0,
      };
      const ist = istStats[baseNr] || 0;
      const soll = sollObj.Soll;

      const item = {
        Artikelnummer: baseNr,
        Name: sollObj.Name,
        Art: sollObj.Art,
        Verkaufspreis: sollObj.Verkaufspreis,
        Soll: soll,
        Ist: ist,
      };

      if (ist === 0) {
        // Komplett fehlend
        item.Fehlt = soll;
        fehlend.push(item);
        statsFehlend += soll;
      } else if (soll === 0) {
        // Komplett unbekannt
        item.Zuviel = ist;
        unbekannt.push(item);
        statsUnbekannt += ist;
      } else {
        // Soll > 0 und Ist > 0
        if (ist < soll) {
          // es fehlen welche
          item.Fehlt = soll - ist;
          fehlend.push(item);
          statsFehlend += item.Fehlt;

          const gefItem = { ...item, Gefunden: ist };
          gefunden.push(gefItem);
          statsGefunden += ist;
        } else if (ist > soll) {
          // zu viele!
          item.Zuviel = ist - soll;
          unbekannt.push(item);
          statsUnbekannt += item.Zuviel;

          const gefItem = { ...item, Gefunden: soll };
          gefunden.push(gefItem);
          statsGefunden += soll;
        } else {
          // genau richtig
          const gefItem = { ...item, Gefunden: soll };
          gefunden.push(gefItem);
          statsGefunden += soll;
        }
      }
    }

    res.json({
      fehlend,
      gefunden,
      unbekannt,
      stats: {
        soll: lagerRows.length,
        gescannt: Object.values(scanned).reduce((s, c) => s + c, 0),
        fehlend: statsFehlend,
        gefunden: statsGefunden,
        unbekannt: statsUnbekannt,
      },
    });
  } catch (err) {
    logger.error("LAGERINVENTUR", "Fehler beim Vergleichen", { message: err.message });
    res.status(500).json({ error: "Fehler beim Vergleichen" });
  }
});

/**
 * @swagger
 * /lagerinventur/drafts/{id}/complete:
 *   post:
 *     summary: Entwurf abschließen (status → abgeschlossen)
 *     description: 'Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Lager-Inventur]
 *     security:
 *       - cookieAuth: []
 *         csrfHeader: []
 *       - bearerAuth: []
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: Entwurf abgeschlossen
 *         content: { application/json: { schema: { $ref: '#/components/schemas/LagerinventurEntwurf' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404:
 *         description: Entwurf nicht gefunden oder bereits abgeschlossen
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 */
router.post("/drafts/:id/complete", async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { rows } = await db.query(
      "UPDATE lagerinventur SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND user_id = $3 AND status = $4 RETURNING *",
      ["abgeschlossen", id, userId, "entwurf"],
    );
    if (rows.length === 0)
      return res
        .status(404)
        .json({ error: "Entwurf nicht gefunden oder bereits abgeschlossen" });
    res.json(rows[0]);
  } catch (err) {
    logger.error("LAGERINVENTUR", "Fehler beim Abschließen des Entwurfs", { message: err.message });
    res.status(500).json({ error: "Fehler beim Abschließen des Entwurfs" });
  }
});

module.exports = router;
