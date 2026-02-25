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
      `SELECT r.*, k."Name" as "KundenName"
       FROM "Rechnung" r
       LEFT JOIN "Kunde" k ON r."Kundennummer" = k."ID"
       WHERE r."ID" = $1`,
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Rechnung nicht gefunden' });
    }

    const pieces = await db.query(
      'SELECT * FROM "Schmuckstück" WHERE "Rechnung_ID" = $1 ORDER BY "Artikelnummer"',
      [req.params.id]
    );

    res.json({ ...rows[0], schmuckstuecke: pieces.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fehler beim Laden der Rechnung' });
  }
});

// POST create
router.post('/', async (req, res) => {
  try {
    const { Nummer, Artikelnummern, Kundennummer, Datei } = req.body;
    const { rows } = await db.query(
      `INSERT INTO "Rechnung" ("Nummer", "Artikelnummern", "Kundennummer", "Datei")
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [Nummer, Artikelnummern, Kundennummer, Datei]
    );
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
      `UPDATE "Rechnung" SET "Nummer" = $1, "Artikelnummern" = $2, "Kundennummer" = $3, "Datei" = $4
       WHERE "ID" = $5 RETURNING *`,
      [Nummer, Artikelnummern, Kundennummer, Datei, req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Rechnung nicht gefunden' });
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
