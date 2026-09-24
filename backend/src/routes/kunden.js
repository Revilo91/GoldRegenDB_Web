const express = require('express');
const router = express.Router();
const db = require('../config/db');
const logger = require('../utils/logger');
const { where } = require('../utils/whereClauseBuilder');
const { validate } = require('../middleware/validate');
const { kundeSchema, restockSelectiveSchema } = require('../schemas');

/**
 * @swagger
 * /kunden:
 *   get:
 *     summary: Alle Kunden abrufen
 *     description: 'Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Kunden]
 *     responses:
 *       200:
 *         description: Kundenliste
 *         content:
 *           application/json:
 *             schema: { type: array, items: { $ref: '#/components/schemas/Kunde' } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM "Kunde" ORDER BY "Name"'
    );
    logger.info('KUNDEN', 'Kunden geladen', { anzahl: rows.length });
    res.json(rows);
  } catch (err) {
    logger.error('KUNDEN', 'Fehler beim Laden der Kunden', { message: err.message });
    res.status(500).json({ error: 'Fehler beim Laden der Kunden' });
  }
});

/**
 * @swagger
 * /kunden/{id}:
 *   get:
 *     summary: Einzelnen Kunden abrufen
 *     description: 'Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Kunden]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: Kunde
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Kunde' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM "Kunde" WHERE "ID" = $1',
      [req.params.id]
    );
    if (rows.length === 0) {
      logger.warn('KUNDEN', 'Kunde nicht gefunden', { id: req.params.id });
      return res.status(404).json({ error: 'Kunde nicht gefunden' });
    }
    res.json(rows[0]);
  } catch (err) {
    logger.error('KUNDEN', 'Fehler beim Laden des Kunden', { id: req.params.id, message: err.message });
    res.status(500).json({ error: 'Fehler beim Laden des Kunden' });
  }
});

/**
 * @swagger
 * /kunden/{id}/schmuckstuecke:
 *   get:
 *     summary: Beim Kunden ausgelagerte Schmuckstücke
 *     description: 'Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Kunden]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: Schmuckstückliste
 *         content:
 *           application/json:
 *             schema: { type: array, items: { $ref: '#/components/schemas/Schmuckstueck' } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
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

/**
 * @swagger
 * /kunden:
 *   post:
 *     summary: Kunden anlegen
 *     description: 'Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Kunden]
 *     security:
 *       - cookieAuth: []
 *         csrfHeader: []
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [Name, Strasse, Hausnummer, Ort, PLZ]
 *             properties:
 *               Name: { type: string, maxLength: 100 }
 *               Strasse: { type: string, maxLength: 200 }
 *               Hausnummer: { type: integer, minimum: 0, maximum: 99999 }
 *               Ort: { type: string, maxLength: 100 }
 *               PLZ: { type: integer, minimum: 0, maximum: 99999 }
 *               Email: { type: string, nullable: true }
 *               Telefonnummer: { type: string, nullable: true }
 *               Provision: { type: integer, minimum: 0, maximum: 100 }
 *               Aktiv: { type: boolean }
 *               Land: { type: string, pattern: '^[A-Z]{2}$', default: DE, description: 'ISO 3166-1 (E-Rechnung BT-55)' }
 *               UStIdNr: { type: string, nullable: true, description: 'E-Rechnung BT-48' }
 *               Leitweg_ID: { type: string, nullable: true, maxLength: 50, description: 'E-Rechnung BT-10 (Käuferreferenz)' }
 *     responses:
 *       201:
 *         description: Kunde erstellt
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Kunde' } } }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post('/', validate(kundeSchema), async (req, res) => {
  try {
    const { Name, Strasse, Hausnummer, Ort, PLZ, Email, Telefonnummer, Provision, Aktiv, Land, UStIdNr, Leitweg_ID } = req.body;
    const { rows } = await db.query(
      `INSERT INTO "Kunde" ("Name", "Strasse", "Hausnummer", "Ort", "PLZ", "Email", "Telefonnummer", "Provision", "Aktiv",
         "Land", "UStIdNr", "Leitweg_ID")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [Name, Strasse, Hausnummer, Ort, PLZ, Email, Telefonnummer, Provision || 0, Aktiv || false,
        Land || 'DE', UStIdNr || null, Leitweg_ID || null]
    );
    logger.info('KUNDEN', `Kunde erstellt: ID=${rows[0].ID}`);
    res.status(201).json(rows[0]);
  } catch (err) {
    logger.error('KUNDEN', 'Fehler beim Erstellen des Kunden', { message: err.message });
    res.status(500).json({ error: 'Fehler beim Erstellen des Kunden' });
  }
});

/**
 * @swagger
 * /kunden/{id}:
 *   put:
 *     summary: Kunden aktualisieren
 *     description: 'Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Kunden]
 *     security:
 *       - cookieAuth: []
 *         csrfHeader: []
 *       - bearerAuth: []
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/Kunde' }
 *     responses:
 *       200:
 *         description: Kunde aktualisiert
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Kunde' } } }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.put('/:id', validate(kundeSchema), async (req, res) => {
  try {
    const { Name, Strasse, Hausnummer, Ort, PLZ, Email, Telefonnummer, Provision, Aktiv, Land, UStIdNr, Leitweg_ID } = req.body;
    const { rows } = await db.query(
      `UPDATE "Kunde" SET "Name" = $1, "Strasse" = $2, "Hausnummer" = $3, "Ort" = $4,
       "PLZ" = $5, "Email" = $6, "Telefonnummer" = $7, "Provision" = $8,
       "Aktiv" = $9, "Land" = $10, "UStIdNr" = $11, "Leitweg_ID" = $12
       WHERE "ID" = $13 RETURNING *`,
      [Name, Strasse, Hausnummer, Ort, PLZ, Email, Telefonnummer, Provision, Aktiv,
        Land || 'DE', UStIdNr || null, Leitweg_ID || null, req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Kunde nicht gefunden' });
    }
    logger.info('KUNDEN', 'Kunde aktualisiert', { id: req.params.id });
    res.json(rows[0]);
  } catch (err) {
    logger.error('KUNDEN', 'Fehler beim Aktualisieren des Kunden', { id: req.params.id, message: err.message });
    res.status(500).json({ error: 'Fehler beim Aktualisieren des Kunden' });
  }
});

/**
 * @swagger
 * /kunden/{id}/restock:
 *   put:
 *     summary: Alle beim Kunden ausgelagerten Artikel zurücklagern
 *     description: 'Setzt Ausgelagert = 0 für alle Artikel dieses Kunden. Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Kunden]
 *     security:
 *       - cookieAuth: []
 *         csrfHeader: []
 *       - bearerAuth: []
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: Anzahl zurückgelagerter Artikel
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { message: { type: string } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.put('/:id/restock', async (req, res) => {
  try {
    const builder = where();
    builder.ausgelagert(parseInt(req.params.id));

    const { rowCount } = await db.query(
      `UPDATE "Schmuckstück" SET "Ausgelagert" = 0 ${builder.build()}`,
      builder.getParams()
    );
    logger.info('KUNDEN', 'Artikel zurückgelagert', { id: req.params.id, anzahl: rowCount });
    res.json({ message: `${rowCount} Artikel zurückgelagert` });
  } catch (err) {
    logger.error('KUNDEN', 'Fehler beim Zurücklagern für Kunde', { id: req.params.id, message: err.message });
    res.status(500).json({ error: 'Fehler beim Zurücklagern der Artikel' });
  }
});

/**
 * @swagger
 * /kunden/{id}/restock-selective:
 *   put:
 *     summary: Ausgewählte Artikel eines Kunden zurücklagern
 *     description: 'Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Kunden]
 *     security:
 *       - cookieAuth: []
 *         csrfHeader: []
 *       - bearerAuth: []
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [artikelnummern]
 *             properties:
 *               artikelnummern:
 *                 type: array
 *                 items: { type: string, example: MHO123_1 }
 *                 minItems: 1
 *                 maxItems: 1000
 *     responses:
 *       200:
 *         description: Anzahl zurückgelagerter Artikel
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { message: { type: string } } }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.put('/:id/restock-selective', validate(restockSelectiveSchema), async (req, res) => {
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
    logger.info('KUNDEN', 'Artikel selektiv zurückgelagert', {
      id: req.params.id,
      angefragt: artikelnummern.length,
      zurueckgelagert: rowCount,
    });
    res.json({ message: `${rowCount} Artikel zurückgelagert` });
  } catch (err) {
    logger.error('KUNDEN', 'Fehler beim selektiven Zurücklagern für Kunde', { id: req.params.id, message: err.message });
    res.status(500).json({ error: 'Fehler beim Zurücklagern der Artikel' });
  }
});

/**
 * @swagger
 * /kunden/{id}:
 *   delete:
 *     summary: Kunden löschen
 *     description: 'Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Kunden]
 *     security:
 *       - cookieAuth: []
 *         csrfHeader: []
 *       - bearerAuth: []
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: Kunde gelöscht
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await db.query(
      'DELETE FROM "Kunde" WHERE "ID" = $1',
      [req.params.id]
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Kunde nicht gefunden' });
    }
    logger.info('KUNDEN', 'Kunde gelöscht', { id: req.params.id });
    res.json({ message: 'Kunde gelöscht' });
  } catch (err) {
    logger.error('KUNDEN', 'Fehler beim Löschen des Kunden', { id: req.params.id, message: err.message });
    res.status(500).json({ error: 'Fehler beim Löschen des Kunden' });
  }
});

module.exports = router;
