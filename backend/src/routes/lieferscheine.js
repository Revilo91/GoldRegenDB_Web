const express = require('express');
const router = express.Router();
const db = require('../config/db');
const logger = require('../utils/logger');

// GET all delivery notes
router.get('/', async (req, res) => {
  try {
    const { status } = req.query; // Optional filter: ?status=entwurf or ?status=final
    let query = `SELECT l.*, k."Name" as "KundenName"
       FROM "Lieferschein" l
       LEFT JOIN "Kunde" k ON l."Kundennummer" = k."ID"`;
    const params = [];

    if (status) {
      query += ` WHERE l.status = $1`;
      params.push(status);
    }

    query += ` ORDER BY l."Datum" DESC`;

    const { rows } = await db.query(query, params);
    logger.info('LIEFERSCHEINE', `${rows.length} Lieferscheine geladen${status ? ` (status=${status})` : ''}`);
    res.json(rows);
  } catch (err) {
    logger.error('LIEFERSCHEINE', 'Fehler beim Laden der Lieferscheine', { message: err.message });
    res.status(500).json({ error: 'Fehler beim Laden der Lieferscheine' });
  }
});

// GET single
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT l.*, k."Name" as "KundenName", k."Provision"
       FROM "Lieferschein" l
       LEFT JOIN "Kunde" k ON l."Kundennummer" = k."ID"
       WHERE l."ID" = $1`,
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Lieferschein nicht gefunden' });
    }

    // Get associated jewelry pieces
    const pieces = await db.query(
      'SELECT * FROM "Schmuckstück" WHERE "Lieferschein_ID" = $1 ORDER BY length("Artikelnummer"), "Artikelnummer"',
      [req.params.id]
    );

    res.json({ ...rows[0], schmuckstuecke: pieces.rows });
  } catch (err) {
    logger.error('LIEFERSCHEINE', `Fehler beim Laden des Lieferscheins ID=${req.params.id}`, { message: err.message });
    res.status(500).json({ error: 'Fehler beim Laden des Lieferscheins' });
  }
});

// GET excel
const { generateExcel } = require('../utils/excelService');
router.get('/:id/excel', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT l.*, k.*
       FROM "Lieferschein" l
       LEFT JOIN "Kunde" k ON l."Kundennummer" = k."ID"
       WHERE l."ID" = $1`,
      [req.params.id]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Lieferschein nicht gefunden' });

    const pieces = await db.query(
      'SELECT * FROM "Schmuckstück" WHERE "Lieferschein_ID" = $1 ORDER BY length("Artikelnummer"), "Artikelnummer"',
      [req.params.id]
    );

    const buffer = await generateExcel('Lieferschein', {
      ...rows[0],
      kunde: rows[0], // rows[0] contains both l and k fields
      schmuckstuecke: pieces.rows.sort((a, b) => a.Artikelnummer.localeCompare(b.Artikelnummer, undefined, { numeric: true }))
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Lieferschein_${rows[0].Nummer}.xlsx`);
    res.send(buffer);
  } catch (err) {
    logger.error('LIEFERSCHEINE', `Excel-Generierung fehlgeschlagen für ID=${req.params.id}`, { message: err.message });
    res.status(500).json({ error: 'Excel-Generierung fehlgeschlagen' });
  }
});

// POST create
router.post('/', async (req, res) => {
  try {
    const { Nummer, Artikelnummern, Kundennummer, status = 'entwurf' } = req.body;
    const { rows } = await db.query(
      `INSERT INTO "Lieferschein" ("Nummer", "Kundennummer", status)
       VALUES ($1, $2, $3) RETURNING *`,
      [Nummer, Kundennummer, status]
    );

    const lieferscheinId = rows[0].ID;

    // Always assign Lieferschein_ID to track which pieces belong to this document
    // But only set Ausgelagert flag if status is 'final'
    if (Artikelnummern && Artikelnummern.length > 0) {
      if (status === 'final') {
        await db.query(
          `UPDATE "Schmuckstück" SET "Lieferschein_ID" = $1, "Ausgelagert" = $2 WHERE "Artikelnummer" = ANY($3::text[])`,
          [lieferscheinId, parseInt(Kundennummer), Artikelnummern]
        );
      } else {
        // Draft: only set Lieferschein_ID, don't change Ausgelagert
        await db.query(
          `UPDATE "Schmuckstück" SET "Lieferschein_ID" = $1 WHERE "Artikelnummer" = ANY($2::text[])`,
          [lieferscheinId, Artikelnummern]
        );
      }
    }

    logger.info('LIEFERSCHEINE', `Lieferschein erstellt: ${rows[0].Nummer} (ID=${lieferscheinId}, status=${status})`, { artikelAnzahl: Artikelnummern?.length || 0 });
    res.status(201).json(rows[0]);
  } catch (err) {
    logger.error('LIEFERSCHEINE', 'Fehler beim Erstellen des Lieferscheins', { message: err.message });
    res.status(500).json({ error: 'Fehler beim Erstellen des Lieferscheins' });
  }
});

// PUT update
router.put('/:id', async (req, res) => {
  try {
    const { Nummer, Artikelnummern, Kundennummer, status } = req.body;

    // Build update query
    let updateQuery = `UPDATE "Lieferschein" SET "Nummer" = $1, "Kundennummer" = $2`;
    const params = [Nummer, Kundennummer];

    if (status !== undefined) {
      updateQuery += `, status = $${params.length + 1}`;
      params.push(status);
    }

    updateQuery += ` WHERE "ID" = $${params.length + 1} RETURNING *`;
    params.push(req.params.id);

    const { rows } = await db.query(updateQuery, params);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Lieferschein nicht gefunden' });
    }

    const currentStatus = rows[0].status;

    // Always reset old associations first (both Lieferschein_ID and Ausgelagert)
    await db.query(`UPDATE "Schmuckstück" SET "Lieferschein_ID" = 0, "Ausgelagert" = 0 WHERE "Lieferschein_ID" = $1`, [req.params.id]);

    // Set new associations
    if (Artikelnummern && Artikelnummern.length > 0) {
      if (currentStatus === 'final') {
        // Final: set both Lieferschein_ID and Ausgelagert
        await db.query(
          `UPDATE "Schmuckstück" SET "Lieferschein_ID" = $1, "Ausgelagert" = $2 WHERE "Artikelnummer" = ANY($3::text[])`,
          [req.params.id, parseInt(Kundennummer), Artikelnummern]
        );
      } else {
        // Draft: only set Lieferschein_ID, don't change Ausgelagert
        await db.query(
          `UPDATE "Schmuckstück" SET "Lieferschein_ID" = $1 WHERE "Artikelnummer" = ANY($2::text[])`,
          [req.params.id, Artikelnummern]
        );
      }
    }

    logger.info('LIEFERSCHEINE', `Lieferschein aktualisiert: ID=${req.params.id}, status=${currentStatus}`);
    res.json(rows[0]);
  } catch (err) {
    logger.error('LIEFERSCHEINE', `Fehler beim Aktualisieren des Lieferscheins ID=${req.params.id}`, { message: err.message });
    res.status(500).json({ error: 'Fehler beim Aktualisieren des Lieferscheins' });
  }
});

// DELETE
router.delete('/:id', async (req, res) => {
  try {
    // Reset associations before deleting
    await db.query(
      `UPDATE "Schmuckstück" SET "Lieferschein_ID" = 0, "Ausgelagert" = 0 WHERE "Lieferschein_ID" = $1`,
      [req.params.id]
    );
    const { rowCount } = await db.query(
      'DELETE FROM "Lieferschein" WHERE "ID" = $1',
      [req.params.id]
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Lieferschein nicht gefunden' });
    }
    logger.info('LIEFERSCHEINE', `Lieferschein gelöscht: ID=${req.params.id}`);
    res.json({ message: 'Lieferschein gelöscht' });
  } catch (err) {
    logger.error('LIEFERSCHEINE', `Fehler beim Löschen des Lieferscheins ID=${req.params.id}`, { message: err.message });
    res.status(500).json({ error: 'Fehler beim Löschen des Lieferscheins' });
  }
});

module.exports = router;
