const express = require('express');
const router = express.Router();
const db = require('../config/db');

// GET all delivery notes
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT l.*, k."Name" as "KundenName"
       FROM "Lieferschein" l
       LEFT JOIN "Kunde" k ON l."Kundennummer" = k."ID"
       ORDER BY l."Datum" DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fehler beim Laden der Lieferscheine' });
  }
});

// GET single
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT l.*, k."Name" as "KundenName"
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
      'SELECT * FROM "Schmuckstück" WHERE "Lieferschein_ID" = $1 ORDER BY "Artikelnummer"',
      [req.params.id]
    );

    res.json({ ...rows[0], schmuckstuecke: pieces.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fehler beim Laden des Lieferscheins' });
  }
});

// POST create
router.post('/', async (req, res) => {
  try {
    const { Nummer, Artikelnummern, Kundennummer, Datei } = req.body;
    const { rows } = await db.query(
      `INSERT INTO "Lieferschein" ("Nummer", "Artikelnummern", "Kundennummer", "Datei")
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [Nummer, Artikelnummern, Kundennummer, Datei]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fehler beim Erstellen des Lieferscheins' });
  }
});

// PUT update
router.put('/:id', async (req, res) => {
  try {
    const { Nummer, Artikelnummern, Kundennummer, Datei } = req.body;
    const { rows } = await db.query(
      `UPDATE "Lieferschein" SET "Nummer" = $1, "Artikelnummern" = $2, "Kundennummer" = $3, "Datei" = $4
       WHERE "ID" = $5 RETURNING *`,
      [Nummer, Artikelnummern, Kundennummer, Datei, req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Lieferschein nicht gefunden' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fehler beim Aktualisieren des Lieferscheins' });
  }
});

// DELETE
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await db.query(
      'DELETE FROM "Lieferschein" WHERE "ID" = $1',
      [req.params.id]
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Lieferschein nicht gefunden' });
    }
    res.json({ message: 'Lieferschein gelöscht' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fehler beim Löschen des Lieferscheins' });
  }
});

module.exports = router;
