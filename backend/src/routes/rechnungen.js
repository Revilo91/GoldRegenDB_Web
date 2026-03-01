const express = require('express');
const router = express.Router();
const db = require('../config/db');

// GET all invoices
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT r.*, k."Name" as "KundenName"
       FROM "Rechnung" r
       LEFT JOIN "Kunde" k ON r."Kundennummer" = k."ID"
       ORDER BY r."Datum" DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
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
    console.error(err);
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

    const buffer = await generateExcel('Rechnung', {
      ...rows[0],
      kunde: rows[0],
      schmuckstuecke: pieces.rows
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Rechnung_${rows[0].Nummer}.xlsx`);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Excel-Generierung fehlgeschlagen' });
  }
});

// POST create
router.post('/', async (req, res) => {
  try {
    const { Nummer, Artikelnummern, Kundennummer, Datei } = req.body;
    const { rows } = await db.query(
      `INSERT INTO "Rechnung" ("Nummer", "Kundennummer", "Datei")
       VALUES ($1, $2, $3) RETURNING *`,
      [Nummer, Kundennummer, Datei]
    );

    const rechnungId = rows[0].ID;

    if (Artikelnummern && Artikelnummern.length > 0) {
      await db.query(
        `UPDATE "Schmuckstück" SET "Rechnung_ID" = $1, "Verkauft" = 1 WHERE "Artikelnummer" = ANY($2::text[])`,
        [rechnungId, Artikelnummern]
      );
    }

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fehler beim Erstellen der Rechnung' });
  }
});

// PUT update
router.put('/:id', async (req, res) => {
  try {
    const { Nummer, Artikelnummern, Kundennummer, Datei } = req.body;
    const { rows } = await db.query(
      `UPDATE "Rechnung" SET "Nummer" = $1, "Kundennummer" = $2, "Datei" = $3
       WHERE "ID" = $4 RETURNING *`,
      [Nummer, Kundennummer, Datei, req.params.id]
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

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
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
    res.json({ message: 'Rechnung gelöscht' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fehler beim Löschen der Rechnung' });
  }
});

module.exports = router;
