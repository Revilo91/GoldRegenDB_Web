const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { generateInventurExcel } = require('../utils/excelService');
const logger = require('../utils/logger');

// GET inventory summary for all customers with items ausgelagert
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
    logger.info('INVENTUR', `Inventur-Übersicht geladen: ${rows.length} Kunden`);
    res.json(rows);
  } catch (err) {
    logger.error('INVENTUR', 'Fehler beim Laden der Inventur', { message: err.message });
    res.status(500).json({ error: 'Fehler beim Laden der Inventur' });
  }
});

// GET inventory detail for a single customer
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

    const itemsRes = await db.query(
      `SELECT * FROM "Schmuckstück"
       WHERE "Ausgelagert" = $1
       ORDER BY length("Artikelnummer"), "Artikelnummer"`,
      [kundeId]
    );

    const items = itemsRes.rows;
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
    logger.error('INVENTUR', `Fehler beim Laden der Inventur für Kunde ID=${req.params.kundeId}`, { message: err.message });
    res.status(500).json({ error: 'Fehler beim Laden der Inventur' });
  }
});

// GET Excel export for a single customer
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

    const itemsRes = await db.query(
      `SELECT * FROM "Schmuckstück"
       WHERE "Ausgelagert" = $1
       ORDER BY length("Artikelnummer"), "Artikelnummer"`,
      [kundeId]
    );

    const kunde = kundeRes.rows[0];
    const items = itemsRes.rows;

    const buffer = await generateInventurExcel(kunde, items);

    const safeName = String(kunde.Name || kundeId).replace(/[\\/:*?"<>|]+/g, '_');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Inventur_${safeName}.xlsx"`);
    logger.info('INVENTUR', `Excel-Export erstellt für Kunde: ${kunde.Name} (${items.length} Artikel)`);
    res.send(buffer);
  } catch (err) {
    logger.error('INVENTUR', `Fehler beim Excel-Export für Kunde ID=${req.params.kundeId}`, { message: err.message });
    res.status(500).json({ error: 'Fehler beim Erstellen des Excel-Exports' });
  }
});

module.exports = router;
