const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { generateInventurExcel } = require('../utils/excelService');
const { where } = require('../utils/whereClauseBuilder');
const logger = require('../utils/logger');

/**
 * @swagger
 * /inventur:
 *   get:
 *     summary: Inventurübersicht aller Kunden mit ausgelagerten Stücken
 *     description: 'Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Inventur]
 *     responses:
 *       200:
 *         description: Ein Eintrag je Kunde mit ausgelagerten Artikeln
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   ID: { type: integer }
 *                   Name: { type: string }
 *                   Ort: { type: string }
 *                   Provision: { type: integer }
 *                   Aktiv: { type: boolean }
 *                   gesamt: { type: integer }
 *                   aktiv: { type: integer }
 *                   verkauft: { type: integer }
 *                   ausschuss: { type: integer }
 *                   wert_aktiv: { type: number }
 *                   wert_verkauft: { type: number }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT
         k."ID",
         k."Name",
         k."Ort",
         k."Provision",
         k."Aktiv",
         COUNT(s."Artikelnummer")::int                                        AS "gesamt",
         SUM(CASE WHEN s."Verkauft" = 0 AND s."Ausschuss" = 0 THEN 1 ELSE 0 END)::int AS "aktiv",
         SUM(CASE WHEN s."Verkauft" = 1                       THEN 1 ELSE 0 END)::int AS "verkauft",
         SUM(CASE WHEN s."Ausschuss" = 1                      THEN 1 ELSE 0 END)::int AS "ausschuss",
         SUM(CASE WHEN s."Verkauft" = 0 AND s."Ausschuss" = 0 THEN COALESCE(s."Verkaufspreis", 0) ELSE 0 END) AS "wert_aktiv",
         SUM(CASE WHEN s."Verkauft" = 1                       THEN COALESCE(s."Verkaufspreis", 0) ELSE 0 END) AS "wert_verkauft"
       FROM "Kunde" k
       JOIN "Schmuckstück" s ON s."Ausgelagert" = k."ID"
       GROUP BY k."ID", k."Name", k."Ort", k."Provision", k."Aktiv"
       ORDER BY k."Name"`
    );
    logger.info('INVENTUR', 'Inventur-Übersicht geladen', { anzahl: rows.length });
    res.json(rows);
  } catch (err) {
    logger.error('INVENTUR', 'Fehler beim Laden der Inventur', { message: err.message });
    res.status(500).json({ error: 'Fehler beim Laden der Inventur' });
  }
});

/**
 * @swagger
 * /inventur/{kundeId}:
 *   get:
 *     summary: Inventurdetail für einen Kunden
 *     description: 'Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Inventur]
 *     parameters:
 *       - { name: kundeId, in: path, required: true, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: Kunde, ausgelagerte Artikel und Kennzahlen
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 kunde: { $ref: '#/components/schemas/Kunde' }
 *                 items: { type: array, items: { $ref: '#/components/schemas/Schmuckstueck' } }
 *                 stats:
 *                   type: object
 *                   properties:
 *                     gesamt: { type: integer }
 *                     aktiv: { type: integer }
 *                     verkauft: { type: integer }
 *                     ausschuss: { type: integer }
 *                     wert_aktiv: { type: number }
 *                     wert_verkauft: { type: number }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:kundeId', async (req, res) => {
  try {
    const { kundeId } = req.params;

    const kundeRes = await db.query(
      'SELECT * FROM "Kunde" WHERE "ID" = $1',
      [kundeId]
    );
    if (kundeRes.rows.length === 0) {
      return res.status(404).json({ error: 'Kunde nicht gefunden' });
    }

    const builder = where();
    builder.ausgelagert(kundeId);

    const { rows: items } = await db.query(
      `SELECT
         s.*,
         l."Datum" AS "Lieferschein_Datum",
         r."Datum" AS "Rechnung_Datum"
       FROM "Schmuckstück" s
       LEFT JOIN "Lieferschein" l ON l."ID" = s."Lieferschein_ID"
       LEFT JOIN "Rechnung" r ON r."ID" = s."Rechnung_ID"
      ${builder.build()}
       ORDER BY length(s."Artikelnummer"), s."Artikelnummer"`,
      builder.getParams()
    );

    const stats = {
      gesamt: items.length,
      aktiv: items.filter(i => Number(i.Verkauft) === 0 && Number(i.Ausschuss) === 0).length,
      verkauft: items.filter(i => Number(i.Verkauft) === 1).length,
      ausschuss: items.filter(i => Number(i.Ausschuss) === 1).length,
      wert_aktiv: items
        .filter(i => Number(i.Verkauft) === 0 && Number(i.Ausschuss) === 0)
        .reduce((s, i) => s + (Number(i.Verkaufspreis) || 0), 0),
      wert_verkauft: items
        .filter(i => Number(i.Verkauft) === 1)
        .reduce((s, i) => s + (Number(i.Verkaufspreis) || 0), 0),
    };

    res.json({ kunde: kundeRes.rows[0], items, stats });
  } catch (err) {
    logger.error('INVENTUR', 'Fehler beim Laden der Inventur für Kunde', { id: req.params.kundeId, message: err.message });
    res.status(500).json({ error: 'Fehler beim Laden der Inventur' });
  }
});

/**
 * @swagger
 * /inventur/{kundeId}/excel:
 *   get:
 *     summary: Inventur eines Kunden als Excel-Datei herunterladen
 *     description: 'Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Inventur]
 *     parameters:
 *       - { name: kundeId, in: path, required: true, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: XLSX-Datei
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema: { type: string, format: binary }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:kundeId/excel', async (req, res) => {
  try {
    const { kundeId } = req.params;

    const kundeRes = await db.query(
      'SELECT * FROM "Kunde" WHERE "ID" = $1',
      [kundeId]
    );
    if (kundeRes.rows.length === 0) {
      return res.status(404).json({ error: 'Kunde nicht gefunden' });
    }

    const builder = where();
    builder.ausgelagert(kundeId);

    const { rows: items } = await db.query(
      `SELECT
         s.*,
         l."Datum" AS "Lieferschein_Datum",
         r."Datum" AS "Rechnung_Datum"
       FROM "Schmuckstück" s
       LEFT JOIN "Lieferschein" l ON l."ID" = s."Lieferschein_ID"
       LEFT JOIN "Rechnung" r ON r."ID" = s."Rechnung_ID"
      ${builder.build()}
       ORDER BY length(s."Artikelnummer"), s."Artikelnummer"`,
      builder.getParams()
    );

    const kunde = kundeRes.rows[0];

    const buffer = await generateInventurExcel(kunde, items);

    const safeName = String(kunde.Name || kundeId).replace(/[\\/:*?"<>|]+/g, '_');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Inventur_${safeName}.xlsx"`);
    logger.info('INVENTUR', 'Excel-Export erstellt', { id: kundeId, artikelAnzahl: items.length });
    res.send(buffer);
  } catch (err) {
    logger.error('INVENTUR', 'Fehler beim Excel-Export für Kunde', { id: req.params.kundeId, message: err.message });
    res.status(500).json({ error: 'Fehler beim Erstellen des Excel-Exports' });
  }
});

module.exports = router;
