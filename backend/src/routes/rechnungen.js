const express = require('express');
const router = express.Router();
const db = require('../config/db');
const logger = require('../utils/logger');

// GET all invoices
router.get('/', async (req, res) => {
  const tenantId = req.user.tenant_id ?? 1;
  try {
    const { rows } = await db.query(
      `SELECT r.*, k."Name" as "KundenName"
       FROM "Rechnung" r
       LEFT JOIN "Kunde" k ON r."Kundennummer" = k."ID"
       WHERE r."tenant_id" = $1
       ORDER BY r."Datum" DESC`,
      [tenantId]
    );
    logger.info('RECHNUNGEN', `${rows.length} Rechnungen geladen`);
    res.json(rows);
  } catch (err) {
    logger.error('RECHNUNGEN', 'Fehler beim Laden der Rechnungen', { message: err.message });
    res.status(500).json({ error: 'Fehler beim Laden der Rechnungen' });
  }
});

// GET single
router.get('/:id', async (req, res) => {
  const tenantId = req.user.tenant_id ?? 1;
  try {
    const { rows } = await db.query(
      `SELECT r.*, k."Name" as "KundenName", k."Provision"
       FROM "Rechnung" r
       LEFT JOIN "Kunde" k ON r."Kundennummer" = k."ID"
       WHERE r."ID" = $1 AND r."tenant_id" = $2`,
      [req.params.id, tenantId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Rechnung nicht gefunden' });
    }

    const pieces = await db.query(
      'SELECT * FROM "Schmuckstück" WHERE "Rechnung_ID" = $1 AND "tenant_id" = $2 ORDER BY length("Artikelnummer"), "Artikelnummer"',
      [req.params.id, tenantId]
    );

    res.json({ ...rows[0], schmuckstuecke: pieces.rows });
  } catch (err) {
    logger.error('RECHNUNGEN', `Fehler beim Laden der Rechnung ID=${req.params.id}`, { message: err.message });
    res.status(500).json({ error: 'Fehler beim Laden der Rechnung' });
  }
});

// GET excel
const { generateExcel } = require('../utils/excelService');

router.get('/:id/excel', async (req, res) => {
  const tenantId = req.user.tenant_id ?? 1;
  try {
    const { rows } = await db.query(
      `SELECT r.*, k.*
       FROM "Rechnung" r
       LEFT JOIN "Kunde" k ON r."Kundennummer" = k."ID"
       WHERE r."ID" = $1 AND r."tenant_id" = $2`,
      [req.params.id, tenantId]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Rechnung nicht gefunden' });

    const pieces = await db.query(
      'SELECT * FROM "Schmuckstück" WHERE "Rechnung_ID" = $1 AND "tenant_id" = $2 ORDER BY length("Artikelnummer"), "Artikelnummer"',
      [req.params.id, tenantId]
    );

    // Compute invoice period from Lieferschein dates of the pieces
    const lieferscheinIds = [...new Set(pieces.rows.map(p => p.Lieferschein_ID).filter(id => id > 0))];
    let rechungsZeitraum = null;
    if (lieferscheinIds.length > 0) {
      const lsResult = await db.query(
        `SELECT MIN("Datum") as min_datum, MAX("Datum") as max_datum FROM "Lieferschein" WHERE "ID" = ANY($1::int[]) AND "tenant_id" = $2`,
        [lieferscheinIds, tenantId]
      );
      if (lsResult.rows[0] && lsResult.rows[0].min_datum) {
        const minDate = new Date(lsResult.rows[0].min_datum).toLocaleDateString('de-DE', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        });
        const maxDate = new Date(lsResult.rows[0].max_datum).toLocaleDateString('de-DE', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        });
        rechungsZeitraum = minDate === maxDate ? minDate : `${minDate} bis ${maxDate}`;
      }
    }

    const buffer = await generateExcel('Rechnung', {
      ...rows[0],
      kunde: rows[0],
      rechungsZeitraum,
      schmuckstuecke: pieces.rows.sort((a, b) => a.Artikelnummer.localeCompare(b.Artikelnummer, undefined, { numeric: true }))
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Rechnung_${rows[0].Nummer}.xlsx`);
    res.send(buffer);
  } catch (err) {
    logger.error('RECHNUNGEN', `Excel-Generierung fehlgeschlagen für ID=${req.params.id}`, { message: err.message });
    res.status(500).json({ error: 'Excel-Generierung fehlgeschlagen' });
  }
});

// POST create
router.post('/', async (req, res) => {
  const tenantId = req.user.tenant_id ?? 1;
  try {
    const { Nummer, Artikelnummern, Kundennummer } = req.body;
    const { rows } = await db.query(
      `INSERT INTO "Rechnung" ("Nummer", "Kundennummer", "tenant_id")
       VALUES ($1, $2, $3) RETURNING *`,
      [Nummer, Kundennummer, tenantId]
    );

    const rechnungId = rows[0].ID;

    if (Artikelnummern && Artikelnummern.length > 0) {
      await db.query(
        `UPDATE "Schmuckstück" SET "Rechnung_ID" = $1, "Verkauft" = 1 WHERE "Artikelnummer" = ANY($2::text[]) AND "tenant_id" = $3`,
        [rechnungId, Artikelnummern, tenantId]
      );
    }

    logger.info('RECHNUNGEN', `Rechnung erstellt: ${rows[0].Nummer} (ID=${rechnungId})`, { artikelAnzahl: Artikelnummern?.length || 0 });
    res.status(201).json(rows[0]);
  } catch (err) {
    logger.error('RECHNUNGEN', 'Fehler beim Erstellen der Rechnung', { message: err.message });
    res.status(500).json({ error: 'Fehler beim Erstellen der Rechnung' });
  }
});

// PUT update
router.put('/:id', async (req, res) => {
  const tenantId = req.user.tenant_id ?? 1;
  try {
    const { Nummer, Artikelnummern, Kundennummer } = req.body;
    const { rows } = await db.query(
      `UPDATE "Rechnung" SET "Nummer" = $1, "Kundennummer" = $2
       WHERE "ID" = $3 AND "tenant_id" = $4 RETURNING *`,
      [Nummer, Kundennummer, req.params.id, tenantId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Rechnung nicht gefunden' });
    }

    // Reset old associations
    await db.query(`UPDATE "Schmuckstück" SET "Rechnung_ID" = 0, "Verkauft" = 0 WHERE "Rechnung_ID" = $1 AND "tenant_id" = $2`, [req.params.id, tenantId]);

    // Set new associations
    if (Artikelnummern && Artikelnummern.length > 0) {
      await db.query(
        `UPDATE "Schmuckstück" SET "Rechnung_ID" = $1, "Verkauft" = 1 WHERE "Artikelnummer" = ANY($2::text[]) AND "tenant_id" = $3`,
        [req.params.id, Artikelnummern, tenantId]
      );
    }

    logger.info('RECHNUNGEN', `Rechnung aktualisiert: ID=${req.params.id}`);
    res.json(rows[0]);
  } catch (err) {
    logger.error('RECHNUNGEN', `Fehler beim Aktualisieren der Rechnung ID=${req.params.id}`, { message: err.message });
    res.status(500).json({ error: 'Fehler beim Aktualisieren der Rechnung' });
  }
});

// DELETE
router.delete('/:id', async (req, res) => {
  const tenantId = req.user.tenant_id ?? 1;
  try {
    // Reset associations before deleting
    await db.query(
      `UPDATE "Schmuckstück" SET "Rechnung_ID" = 0, "Verkauft" = 0 WHERE "Rechnung_ID" = $1 AND "tenant_id" = $2`,
      [req.params.id, tenantId]
    );
    const { rowCount } = await db.query(
      'DELETE FROM "Rechnung" WHERE "ID" = $1 AND "tenant_id" = $2',
      [req.params.id, tenantId]
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Rechnung nicht gefunden' });
    }
    logger.info('RECHNUNGEN', `Rechnung gelöscht: ID=${req.params.id}`);
    res.json({ message: 'Rechnung gelöscht' });
  } catch (err) {
    logger.error('RECHNUNGEN', `Fehler beim Löschen der Rechnung ID=${req.params.id}`, { message: err.message });
    res.status(500).json({ error: 'Fehler beim Löschen der Rechnung' });
  }
});

module.exports = router;
