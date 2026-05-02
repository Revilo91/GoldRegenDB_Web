const express = require('express');
const router = express.Router();
const db = require('../config/db');
const logger = require('../utils/logger');

function formatJahresNummer(jahr, laufnummer) {
  return `${jahr}-${String(laufnummer).padStart(3, '0')}`;
}

// GET all invoices
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT r.*, k."Name" as "KundenName"
       FROM "Rechnung" r
       LEFT JOIN "Kunde" k ON r."Kundennummer" = k."ID"
       ORDER BY r."Datum" DESC`
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
  let client;
  try {
    const { Nummer, Artikelnummern, Kundennummer } = req.body;
    client = await db.connect();
    await client.query('BEGIN');
    await client.query('LOCK TABLE "Rechnung" IN SHARE ROW EXCLUSIVE MODE');

    let rechnungsNummer = String(Nummer || '').trim();
    if (!rechnungsNummer) {
      const aktuellesJahr = new Date().getFullYear();
      const { rows: nummerRows } = await client.query(
        `SELECT COALESCE(MAX(CAST(SPLIT_PART("Nummer", '-', 2) AS INTEGER)), 0) AS max_num
         FROM "Rechnung"
         WHERE "Nummer" ~ $1`,
        [`^${aktuellesJahr}-[0-9]+$`]
      );
      rechnungsNummer = formatJahresNummer(
        aktuellesJahr,
        Number(nummerRows[0].max_num) + 1,
      );
    }

    const { rows } = await client.query(
      `INSERT INTO "Rechnung" ("Nummer", "Kundennummer")
       VALUES ($1, $2) RETURNING *`,
      [rechnungsNummer, Kundennummer]
    );

    const rechnungId = rows[0].ID;

    if (Artikelnummern && Artikelnummern.length > 0) {
      await client.query(
        `UPDATE "Schmuckstück" SET "Rechnung_ID" = $1, "Verkauft" = 1 WHERE "Artikelnummer" = ANY($2::text[])`,
        [rechnungId, Artikelnummern]
      );
    }

    await client.query('COMMIT');

    logger.info('RECHNUNGEN', `Rechnung erstellt: ${rows[0].Nummer} (ID=${rechnungId})`, { artikelAnzahl: Artikelnummern?.length || 0 });
    res.status(201).json(rows[0]);
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        logger.error('RECHNUNGEN', 'Rollback fehlgeschlagen bei Rechnungserstellung', { message: rollbackErr.message });
      }
    }
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Rechnungsnummer existiert bereits' });
    }
    logger.error('RECHNUNGEN', 'Fehler beim Erstellen der Rechnung', { message: err.message });
    res.status(500).json({ error: 'Fehler beim Erstellen der Rechnung' });
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
      `UPDATE "Rechnung" SET "Nummer" = $1, "Kundennummer" = $2
       WHERE "ID" = $3 RETURNING *`,
      [Nummer, Kundennummer, req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Rechnung nicht gefunden' });
    }

    // Reset old associations
    await db.query(`UPDATE "Schmuckstück" SET "Rechnung_ID" = 0, "Verkauft" = 0 WHERE "Rechnung_ID" = $1`, [req.params.id]);

    // Set new associations
    if (Artikelnummern && Artikelnummern.length > 0) {
      await db.query(
        `UPDATE "Schmuckstück" SET "Rechnung_ID" = $1, "Verkauft" = 1 WHERE "Artikelnummer" = ANY($2::text[])`,
        [req.params.id, Artikelnummern]
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
