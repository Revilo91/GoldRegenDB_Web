const express = require('express');
const router = express.Router();
const db = require('../config/db');
const logger = require('../utils/logger');
const { where } = require('../utils/whereClauseBuilder');

// GET all customers
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM "Kunde" ORDER BY "Name"'
    );
    logger.info('KUNDEN', `${rows.length} Kunden geladen`);
    res.json(rows);
  } catch (err) {
    logger.error('KUNDEN', 'Fehler beim Laden der Kunden', { message: err.message });
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
      logger.warn('KUNDEN', `Kunde nicht gefunden: ID=${req.params.id}`);
      return res.status(404).json({ error: 'Kunde nicht gefunden' });
    }
    res.json(rows[0]);
  } catch (err) {
    logger.error('KUNDEN', `Fehler beim Laden des Kunden ID=${req.params.id}`, { message: err.message });
    res.status(500).json({ error: 'Fehler beim Laden des Kunden' });
  }
});

// GET jewelry pieces for a customer (ausgelagert)
router.get('/:id/schmuckstuecke', async (req, res) => {
  try {
    const builder = where();
    builder.ausgelagert(parseInt(req.params.id));

    const { rows } = await db.query(
      `SELECT * FROM "Schmuckstück" ${builder.build()} ORDER BY length("Artikelnummer"), "Artikelnummer"`,
      builder.getParams()
    );
    res.json(rows);
  } catch (err) {
    logger.error('KUNDEN', 'Fehler beim Laden der Schmuckstücke für Kunde', { id: req.params.id, message: err.message });
    res.status(500).json({ error: 'Fehler beim Laden der Schmuckstücke' });
  }
});

// POST create customer
router.post('/', async (req, res) => {
  try {
    const { Name, Strasse, Hausnummer, Ort, PLZ, Email, Telefonnummer, Provision, Aktiv } = req.body;
    const { rows } = await db.query(
      `INSERT INTO "Kunde" ("Name", "Strasse", "Hausnummer", "Ort", "PLZ", "Email", "Telefonnummer", "Provision", "Aktiv")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [Name, Strasse, Hausnummer, Ort, PLZ, Email, Telefonnummer, Provision || 0, Aktiv || false]
    );
    logger.info('KUNDEN', `Kunde erstellt: ${rows[0].Name} (ID=${rows[0].ID})`);
    res.status(201).json(rows[0]);
  } catch (err) {
    logger.error('KUNDEN', 'Fehler beim Erstellen des Kunden', { name: Name, message: err.message });
    res.status(500).json({ error: 'Fehler beim Erstellen des Kunden' });
  }
});

// PUT update customer
router.put('/:id', async (req, res) => {
  try {
    const { Name, Strasse, Hausnummer, Ort, PLZ, Email, Telefonnummer, Provision, Aktiv } = req.body;
    const { rows } = await db.query(
      `UPDATE "Kunde" SET "Name" = $1, "Strasse" = $2, "Hausnummer" = $3, "Ort" = $4,
       "PLZ" = $5, "Email" = $6, "Telefonnummer" = $7, "Provision" = $8,
       "Aktiv" = $9
       WHERE "ID" = $10 RETURNING *`,
      [Name, Strasse, Hausnummer, Ort, PLZ, Email, Telefonnummer, Provision, Aktiv, req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Kunde nicht gefunden' });
    }
    logger.info('KUNDEN', `Kunde aktualisiert: ID=${req.params.id}`);
    res.json(rows[0]);
  } catch (err) {
    logger.error('KUNDEN', `Fehler beim Aktualisieren des Kunden ID=${req.params.id}`, { message: err.message });
    res.status(500).json({ error: 'Fehler beim Aktualisieren des Kunden' });
  }
});

// PUT restock all items for a customer (set Ausgelagert = 0)
router.put('/:id/restock', async (req, res) => {
  try {
    const builder = where();
    builder.ausgelagert(parseInt(req.params.id));

    const { rowCount } = await db.query(
      `UPDATE "Schmuckstück" SET "Ausgelagert" = 0 ${builder.build()}`,
      builder.getParams()
    );
    logger.info('KUNDEN', `${rowCount} Artikel zurückgelagert für Kunde ID=${req.params.id}`);
    res.json({ message: `${rowCount} Artikel zurückgelagert` });
  } catch (err) {
    logger.error('KUNDEN', `Fehler beim Zurücklagern für Kunde ID=${req.params.id}`, { message: err.message });
    res.status(500).json({ error: 'Fehler beim Zurücklagern der Artikel' });
  }
});

// PUT restock specific items for a customer (set Ausgelagert = 0)
router.put('/:id/restock-selective', async (req, res) => {
  try {
    const { artikelnummern } = req.body;
    if (!Array.isArray(artikelnummern) || artikelnummern.length === 0) {
      return res.status(400).json({ error: 'Keine Artikelnummern angegeben' });
    }

    const builder = where();
    builder.artikelnummerIn(artikelnummern);
    builder.ausgelagert(parseInt(req.params.id));

    // Use parameterized query with ANY for IN clause
    const { rowCount } = await db.query(
      `UPDATE "Schmuckstück" SET "Ausgelagert" = 0 ${builder.build()}`,
      builder.getParams()
    );
    logger.info('KUNDEN', `${rowCount} Artikel selektiv zurückgelagert für Kunde ID=${req.params.id}`, { anzahl: artikelnummern.length });
    res.json({ message: `${rowCount} Artikel zurückgelagert` });
  } catch (err) {
    logger.error('KUNDEN', `Fehler beim selektiven Zurücklagern für Kunde ID=${req.params.id}`, { message: err.message });
    res.status(500).json({ error: 'Fehler beim Zurücklagern der Artikel' });
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
    logger.info('KUNDEN', `Kunde gelöscht: ID=${req.params.id}`);
    res.json({ message: 'Kunde gelöscht' });
  } catch (err) {
    logger.error('KUNDEN', `Fehler beim Löschen des Kunden ID=${req.params.id}`, { message: err.message });
    res.status(500).json({ error: 'Fehler beim Löschen des Kunden' });
  }
});

module.exports = router;
