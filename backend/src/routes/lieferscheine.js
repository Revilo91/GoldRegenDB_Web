const express = require('express');
const router = express.Router();
const db = require('../config/db');
const logger = require('../utils/logger');

function formatJahresNummer(jahr, laufnummer) {
  return `${jahr}-${String(laufnummer).padStart(3, '0')}`;
}

// GET all delivery notes
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT l.*, k."Name" as "KundenName"
       FROM "Lieferschein" l
       LEFT JOIN "Kunde" k ON l."Kundennummer" = k."ID"
       ORDER BY l."Datum" DESC`
    );
    logger.info('LIEFERSCHEINE', `${rows.length} Lieferscheine geladen`);
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
  let client;
  try {
    const { Nummer, Artikelnummern, Kundennummer } = req.body;
    client = await db.connect();
    await client.query('BEGIN');
    await client.query('LOCK TABLE "Lieferschein" IN SHARE ROW EXCLUSIVE MODE');

    let lieferscheinNummer = String(Nummer || '').trim();
    if (!lieferscheinNummer) {
      const aktuellesJahr = new Date().getFullYear();
      const { rows: nummerRows } = await client.query(
        `SELECT COALESCE(MAX(CAST(SPLIT_PART("Nummer", '-', 2) AS INTEGER)), 0) AS max_num
         FROM "Lieferschein"
         WHERE "Nummer" ~ $1`,
        [`^${aktuellesJahr}-[0-9]+$`]
      );
      lieferscheinNummer = formatJahresNummer(
        aktuellesJahr,
        Number(nummerRows[0].max_num) + 1,
      );
    }

    const { rows } = await client.query(
      `INSERT INTO "Lieferschein" ("Nummer", "Kundennummer")
       VALUES ($1, $2) RETURNING *`,
      [lieferscheinNummer, Kundennummer]
    );

    const lieferscheinId = rows[0].ID;

    // Assign products to this delivery note and mark as outsourced to customer
    if (Artikelnummern && Artikelnummern.length > 0) {
      await client.query(
        `UPDATE "Schmuckstück" SET "Lieferschein_ID" = $1, "Ausgelagert" = $2 WHERE "Artikelnummer" = ANY($3::text[])`,
        [lieferscheinId, parseInt(Kundennummer), Artikelnummern]
      );
    }

    await client.query('COMMIT');

    logger.info('LIEFERSCHEINE', `Lieferschein erstellt: ${rows[0].Nummer} (ID=${lieferscheinId})`, { artikelAnzahl: Artikelnummern?.length || 0 });
    res.status(201).json(rows[0]);
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        logger.error('LIEFERSCHEINE', 'Rollback fehlgeschlagen bei Lieferscheinerstellung', { message: rollbackErr.message });
      }
    }
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Lieferscheinnummer existiert bereits' });
    }
    logger.error('LIEFERSCHEINE', 'Fehler beim Erstellen des Lieferscheins', { message: err.message });
    res.status(500).json({ error: 'Fehler beim Erstellen des Lieferscheins' });
  } finally {
    if (client) {
      client.release();
    }
  }
});

// PUT update
router.put('/:id', async (req, res) => {
  try {
    const { Nummer, Artikelnummern, Kundennummer } = req.body;
    const { rows } = await db.query(
      `UPDATE "Lieferschein" SET "Nummer" = $1, "Kundennummer" = $2
       WHERE "ID" = $3 RETURNING *`,
      [Nummer, Kundennummer, req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Lieferschein nicht gefunden' });
    }

    // Reset old associations
    await db.query(`UPDATE "Schmuckstück" SET "Lieferschein_ID" = 0, "Ausgelagert" = 0 WHERE "Lieferschein_ID" = $1`, [req.params.id]);

    // Set new associations
    if (Artikelnummern && Artikelnummern.length > 0) {
      await db.query(
        `UPDATE "Schmuckstück" SET "Lieferschein_ID" = $1, "Ausgelagert" = $2 WHERE "Artikelnummer" = ANY($3::text[])`,
        [req.params.id, parseInt(Kundennummer), Artikelnummern]
      );
    }

    logger.info('LIEFERSCHEINE', `Lieferschein aktualisiert: ID=${req.params.id}`);
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
