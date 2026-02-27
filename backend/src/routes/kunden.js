const express = require('express');
const router = express.Router();
const db = require('../config/db');

// GET all customers
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM "Kunde" ORDER BY "Name"'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fehler beim Laden der Kunden' });
  }
});

// GET single customer by ID
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM "Kunde" WHERE "ID" = $1',
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Kunde nicht gefunden' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fehler beim Laden des Kunden' });
  }
});

// GET jewelry pieces for a customer (ausgelagert)
router.get('/:id/schmuckstuecke', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM "Schmuckstück" WHERE "Ausgelagert" = $1 ORDER BY length("Artikelnummer"), "Artikelnummer"',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fehler beim Laden der Schmuckstücke' });
  }
});

// POST create customer
router.post('/', async (req, res) => {
  try {
    const { Name, Strasse, Hausnummer, Ort, PLZ, Email, Telefonnummer, Provision, Aktiv, Artikelnummern_Erforderlich } = req.body;
    const { rows } = await db.query(
      `INSERT INTO "Kunde" ("Name", "Strasse", "Hausnummer", "Ort", "PLZ", "Email", "Telefonnummer", "Provision", "Aktiv", "Artikelnummern_Erforderlich")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [Name, Strasse, Hausnummer, Ort, PLZ, Email, Telefonnummer, Provision || 0, Aktiv || false, Artikelnummern_Erforderlich || false]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fehler beim Erstellen des Kunden' });
  }
});

// PUT update customer
router.put('/:id', async (req, res) => {
  try {
    const { Name, Strasse, Hausnummer, Ort, PLZ, Email, Telefonnummer, Provision, Aktiv, Artikelnummern_Erforderlich } = req.body;
    const { rows } = await db.query(
      `UPDATE "Kunde" SET "Name" = $1, "Strasse" = $2, "Hausnummer" = $3, "Ort" = $4,
       "PLZ" = $5, "Email" = $6, "Telefonnummer" = $7, "Provision" = $8,
       "Aktiv" = $9, "Artikelnummern_Erforderlich" = $10
       WHERE "ID" = $11 RETURNING *`,
      [Name, Strasse, Hausnummer, Ort, PLZ, Email, Telefonnummer, Provision, Aktiv, Artikelnummern_Erforderlich, req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Kunde nicht gefunden' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fehler beim Aktualisieren des Kunden' });
  }
});

// DELETE customer
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await db.query(
      'DELETE FROM "Kunde" WHERE "ID" = $1',
      [req.params.id]
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Kunde nicht gefunden' });
    }
    res.json({ message: 'Kunde gelöscht' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fehler beim Löschen des Kunden' });
  }
});

module.exports = router;
