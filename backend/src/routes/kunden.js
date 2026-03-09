const express = require('express');
const router = express.Router();
const db = require('../config/db');
const logger = require('../utils/logger');

// GET all customers
router.get('/', async (req, res) => {
  const tenantId = req.user.tenant_id ?? 1;
  try {
    const { rows } = await db.query(
      'SELECT * FROM "Kunde" WHERE "tenant_id" = $1 ORDER BY "Name"',
      [tenantId]
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
  const tenantId = req.user.tenant_id ?? 1;
  try {
    const { rows } = await db.query(
      'SELECT * FROM "Kunde" WHERE "ID" = $1 AND "tenant_id" = $2',
      [req.params.id, tenantId]
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
  const tenantId = req.user.tenant_id ?? 1;
  try {
    const { rows } = await db.query(
      'SELECT * FROM "Schmuckstück" WHERE "Ausgelagert" = $1 AND "tenant_id" = $2 ORDER BY length("Artikelnummer"), "Artikelnummer"',
      [req.params.id, tenantId]
    );
    res.json(rows);
  } catch (err) {
    logger.error('KUNDEN', 'Fehler beim Laden der Schmuckstücke für Kunde', { id: req.params.id, message: err.message });
    res.status(500).json({ error: 'Fehler beim Laden der Schmuckstücke' });
  }
});

// POST create customer
router.post('/', async (req, res) => {
  const tenantId = req.user.tenant_id ?? 1;
  try {
    const { Name, Strasse, Hausnummer, Ort, PLZ, Email, Telefonnummer, Provision, Aktiv } = req.body;
    const { rows } = await db.query(
      `INSERT INTO "Kunde" ("Name", "Strasse", "Hausnummer", "Ort", "PLZ", "Email", "Telefonnummer", "Provision", "Aktiv", "tenant_id")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [Name, Strasse, Hausnummer, Ort, PLZ, Email, Telefonnummer, Provision || 0, Aktiv || false, tenantId]
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
  const tenantId = req.user.tenant_id ?? 1;
  try {
    const { Name, Strasse, Hausnummer, Ort, PLZ, Email, Telefonnummer, Provision, Aktiv } = req.body;
    const { rows } = await db.query(
      `UPDATE "Kunde" SET "Name" = $1, "Strasse" = $2, "Hausnummer" = $3, "Ort" = $4,
       "PLZ" = $5, "Email" = $6, "Telefonnummer" = $7, "Provision" = $8,
       "Aktiv" = $9
       WHERE "ID" = $10 AND "tenant_id" = $11 RETURNING *`,
      [Name, Strasse, Hausnummer, Ort, PLZ, Email, Telefonnummer, Provision, Aktiv, req.params.id, tenantId]
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
  const tenantId = req.user.tenant_id ?? 1;
  try {
    const { rowCount } = await db.query(
      'UPDATE "Schmuckstück" SET "Ausgelagert" = 0 WHERE "Ausgelagert" = $1 AND "tenant_id" = $2',
      [req.params.id, tenantId]
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
  const tenantId = req.user.tenant_id ?? 1;
  try {
    const { artikelnummern } = req.body;
    if (!Array.isArray(artikelnummern) || artikelnummern.length === 0) {
      return res.status(400).json({ error: 'Keine Artikelnummern angegeben' });
    }

    // Use parameterized query with ANY for IN clause
    const { rowCount } = await db.query(
      'UPDATE "Schmuckstück" SET "Ausgelagert" = 0 WHERE "Artikelnummer" = ANY($1) AND "Ausgelagert" = $2 AND "tenant_id" = $3',
      [artikelnummern, req.params.id, tenantId]
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
  const tenantId = req.user.tenant_id ?? 1;
  try {
    const { rowCount } = await db.query(
      'DELETE FROM "Kunde" WHERE "ID" = $1 AND "tenant_id" = $2',
      [req.params.id, tenantId]
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
