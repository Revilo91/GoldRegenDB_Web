const express = require('express');
const router = express.Router();
const db = require('../config/db');
const logger = require('../utils/logger');

// GET all invoices
router.get('/', async (req, res) => {
  try {
    const { status } = req.query; // Optional filter: ?status=entwurf or ?status=final
    let query = `SELECT r.*, k."Name" as "KundenName"
       FROM "Rechnung" r
       LEFT JOIN "Kunde" k ON r."Kundennummer" = k."ID"`;
    const params = [];

    if (status) {
      query += ` WHERE r.status = $1`;
      params.push(status);
    }

    query += ` ORDER BY r."Datum" DESC`;

    const { rows } = await db.query(query, params);
    logger.info('RECHNUNGEN', `${rows.length} Rechnungen geladen${status ? ` (status=${status})` : ''}`);
    res.json(rows);
  } catch (err) {
    logger.error('RECHNUNGEN', 'Fehler beim Laden der Rechnungen', { message: err.message });
    res.status(500).json({ error: 'Fehler beim Laden der Rechnungen' });
  }
});

// GET single
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT r.*, k."Name" as "KundenName", k."Provision"
       FROM "Rechnung" r
       LEFT JOIN "Kunde" k ON r."Kundennummer" = k."ID"
       WHERE r."ID" = $1`,
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Rechnung nicht gefunden' });
    }

    const pieces = await db.query(
      'SELECT * FROM "Schmuckstück" WHERE "Rechnung_ID" = $1 ORDER BY length("Artikelnummer"), "Artikelnummer"',
      [req.params.id]
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
  try {
    const { rows } = await db.query(
      `SELECT r.*, k.*
       FROM "Rechnung" r
       LEFT JOIN "Kunde" k ON r."Kundennummer" = k."ID"
       WHERE r."ID" = $1`,
      [req.params.id]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Rechnung nicht gefunden' });

    const pieces = await db.query(
      'SELECT * FROM "Schmuckstück" WHERE "Rechnung_ID" = $1 ORDER BY length("Artikelnummer"), "Artikelnummer"',
      [req.params.id]
    );

    // Compute invoice period from Lieferschein dates of the pieces
    const lieferscheinIds = [...new Set(pieces.rows.map(p => p.Lieferschein_ID).filter(id => id > 0))];
    let rechungsZeitraum = null;
    if (lieferscheinIds.length > 0) {
      const lsResult = await db.query(
        `SELECT MIN("Datum") as min_datum, MAX("Datum") as max_datum FROM "Lieferschein" WHERE "ID" = ANY($1::int[])`,
        [lieferscheinIds]
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
  try {
    const { Nummer, Artikelnummern, Kundennummer, status = 'entwurf' } = req.body;
    const { rows } = await db.query(
      `INSERT INTO "Rechnung" ("Nummer", "Kundennummer", status)
       VALUES ($1, $2, $3) RETURNING *`,
      [Nummer, Kundennummer, status]
    );

    const rechnungId = rows[0].ID;

    // Only assign products and mark as sold if status is 'final'
    // Drafts don't modify Schmuckstück records
    if (status === 'final' && Artikelnummern && Artikelnummern.length > 0) {
      await db.query(
        `UPDATE "Schmuckstück" SET "Rechnung_ID" = $1, "Verkauft" = 1 WHERE "Artikelnummer" = ANY($2::text[])`,
        [rechnungId, Artikelnummern]
      );
    }

    logger.info('RECHNUNGEN', `Rechnung erstellt: ${rows[0].Nummer} (ID=${rechnungId}, status=${status})`, { artikelAnzahl: Artikelnummern?.length || 0 });
    res.status(201).json(rows[0]);
  } catch (err) {
    logger.error('RECHNUNGEN', 'Fehler beim Erstellen der Rechnung', { message: err.message });
    res.status(500).json({ error: 'Fehler beim Erstellen der Rechnung' });
  }
});

// PUT update
router.put('/:id', async (req, res) => {
  try {
    const { Nummer, Artikelnummern, Kundennummer, status } = req.body;

    // Build update query
    let updateQuery = `UPDATE "Rechnung" SET "Nummer" = $1, "Kundennummer" = $2`;
    const params = [Nummer, Kundennummer];

    if (status !== undefined) {
      updateQuery += `, status = $${params.length + 1}`;
      params.push(status);
    }

    updateQuery += ` WHERE "ID" = $${params.length + 1} RETURNING *`;
    params.push(req.params.id);

    const { rows } = await db.query(updateQuery, params);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Rechnung nicht gefunden' });
    }

    const currentStatus = rows[0].status;

    // Only modify Schmuckstück records if status is 'final'
    if (currentStatus === 'final') {
      // Reset old associations
      await db.query(`UPDATE "Schmuckstück" SET "Rechnung_ID" = 0, "Verkauft" = 0 WHERE "Rechnung_ID" = $1`, [req.params.id]);

      // Set new associations
      if (Artikelnummern && Artikelnummern.length > 0) {
        await db.query(
          `UPDATE "Schmuckstück" SET "Rechnung_ID" = $1, "Verkauft" = 1 WHERE "Artikelnummer" = ANY($2::text[])`,
          [req.params.id, Artikelnummern]
        );
      }
    }

    logger.info('RECHNUNGEN', `Rechnung aktualisiert: ID=${req.params.id}, status=${currentStatus}`);
    res.json(rows[0]);
  } catch (err) {
    logger.error('RECHNUNGEN', `Fehler beim Aktualisieren der Rechnung ID=${req.params.id}`, { message: err.message });
    res.status(500).json({ error: 'Fehler beim Aktualisieren der Rechnung' });
  }
});

// DELETE
router.delete('/:id', async (req, res) => {
  try {
    // Reset associations before deleting
    await db.query(
      `UPDATE "Schmuckstück" SET "Rechnung_ID" = 0, "Verkauft" = 0 WHERE "Rechnung_ID" = $1`,
      [req.params.id]
    );
    const { rowCount } = await db.query(
      'DELETE FROM "Rechnung" WHERE "ID" = $1',
      [req.params.id]
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
