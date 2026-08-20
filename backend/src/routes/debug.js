const express = require('express');
const router = express.Router();
const db = require('../config/db');
const logger = require('../utils/logger');
const { validate } = require('../middleware/validate');
const { debugUpdateSchema } = require('../schemas');

/**
 * @swagger
 * /debug/tables:
 *   get:
 *     summary: Alle Datenbanktabellen auflisten
 *     description: 'Erfordert Rolle: admin.'
 *     tags: [Debug]
 *     responses:
 *       200:
 *         description: Tabellennamen
 *         content:
 *           application/json:
 *             schema: { type: array, items: { type: string } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/tables', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT table_name 
       FROM information_schema.tables 
       WHERE table_schema = 'public' 
       AND table_type = 'BASE TABLE'
       ORDER BY table_name`
    );
    res.json(result.rows.map(row => row.table_name));
  } catch (err) {
    logger.error('DEBUG', 'Fehler beim Laden der Tabellen', { message: err.message });
    res.status(500).json({ error: 'Failed to fetch tables' });
  }
});

/**
 * @swagger
 * /debug/tables/{tableName}:
 *   get:
 *     summary: Inhalt einer Tabelle anzeigen (inkl. Spalten- und Primärschlüssel-Info)
 *     description: 'Erfordert Rolle: admin.'
 *     tags: [Debug]
 *     parameters:
 *       - { name: tableName, in: path, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Tabelleninhalt
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data: { type: array, items: { type: object } }
 *                 columns: { type: array, items: { type: object } }
 *                 primaryKeys: { type: array, items: { type: string } }
 *       400:
 *         description: Ungültiger Tabellenname
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404:
 *         description: Tabelle nicht gefunden
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 */
router.get('/tables/:tableName', async (req, res) => {
  const { tableName } = req.params;
  try {
    // Validate table name to prevent SQL injection (basic check allowing unicode letters)
    if (!/^[\p{L}\p{N}_]+$/u.test(tableName)) {
      return res.status(400).json({ error: 'Invalid table name' });
    }
    
    // Check if table exists
    const tableExists = await db.query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = $1
      )`,
      [tableName]
    );

    if (!tableExists.rows[0].exists) {
        return res.status(404).json({ error: 'Table not found' });
    }

    const result = await db.query(`SELECT * FROM "${tableName}"`);
    
    // Also fetch column information to know primary keys
    const columnsInfo = await db.query(
      `SELECT column_name, data_type, character_maximum_length, 
              column_default, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
       [tableName]
    );
       
    // Fetch primary key constraints
    const pkInfo = await db.query(`
      SELECT a.attname AS column_name
      FROM   pg_index i
      JOIN   pg_attribute a ON a.attrelid = i.indrelid
                           AND a.attnum = ANY(i.indkey)
      WHERE  i.indrelid = $1::regclass
      AND    i.indisprimary;
    `, [`public."${tableName}"`]);
    
    const primaryKeys = pkInfo.rows.map(r => r.column_name);

    res.json({
        data: result.rows,
        columns: columnsInfo.rows,
        primaryKeys: primaryKeys
    });
  } catch (err) {
    logger.error('DEBUG', 'Fehler beim Laden der Daten für Tabelle', { tabelle: tableName, message: err.message });
    res.status(500).json({ error: `Failed to fetch data for ${tableName}` });
  }
});

/**
 * @swagger
 * /debug/tables/{tableName}:
 *   put:
 *     summary: Einzelnen Datensatz direkt bearbeiten
 *     description: 'Roher Direktzugriff auf die Datenbank ohne Business-Validierung (WHERE Clause Builder,
 *       Zod-Schemas etc.) – nur zum Debuggen. Erfordert Rolle: admin.'
 *     tags: [Debug]
 *     security:
 *       - cookieAuth: []
 *         csrfHeader: []
 *       - bearerAuth: []
 *     parameters:
 *       - { name: tableName, in: path, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [primaryKey, id, field]
 *             properties:
 *               primaryKey: { type: string, description: 'Name der Primärschlüssel-Spalte' }
 *               id:
 *                 description: Wert des Primärschlüssels der zu ändernden Zeile
 *                 oneOf: [{ type: string }, { type: number }]
 *               field: { type: string, description: 'Name der zu ändernden Spalte' }
 *               value:
 *                 nullable: true
 *                 oneOf: [{ type: string }, { type: number }, { type: boolean }]
 *     responses:
 *       200:
 *         description: Aktualisierte Zeile
 *         content: { application/json: { schema: { type: object } } }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404:
 *         description: Zeile nicht gefunden
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 */
router.put('/tables/:tableName', validate(debugUpdateSchema), async (req, res) => {
  const { tableName } = req.params;
  const { primaryKey, id, field, value } = req.body;

  if (!primaryKey || id === undefined || !field) {
    return res.status(400).json({ error: 'Missing required update identifiers or field' });
  }

  try {
    // Validate table and field names allowing unicode letters
    if (!/^[\p{L}\p{N}_]+$/u.test(tableName) || !/^[\p{L}\p{N}_]+$/u.test(field) || !/^[\p{L}\p{N}_]+$/u.test(primaryKey)) {
        return res.status(400).json({ error: 'Invalid identifiers' });
    }

    const query = `UPDATE "${tableName}" SET "${field}" = $1 WHERE "${primaryKey}" = $2 RETURNING *`;
    const result = await db.query(query, [value === '' ? null : value, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Row not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    logger.error('DEBUG', 'Fehler beim Aktualisieren der Daten für Tabelle', { tabelle: tableName, field, message: err.message });
    res.status(500).json({ error: `Failed to update data for ${tableName}` });
  }
});

module.exports = router;
