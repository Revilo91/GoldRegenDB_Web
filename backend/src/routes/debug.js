const express = require('express');
const router = express.Router();
const db = require('../config/db');
const logger = require('../utils/logger');
const { validate } = require('../middleware/validate');
const { debugUpdateSchema } = require('../schemas');

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;
const MAX_LOGGED_VALUE_LENGTH = 200;
const TABLE_NAME_REGEX = /^[\p{L}\p{N}_]+$/u;
const BLOCKED_TABLES = new Set(['app_users', 'audit_log', 'schema_migrations']);
const BLOCKED_TABLE_PREFIX = 'bestellung';

const isBlockedTable = (name) => {
  const lower = name.toLowerCase();
  return BLOCKED_TABLES.has(lower) || lower.startsWith(BLOCKED_TABLE_PREFIX);
};

const quoteIdent = (name) => `"${name.replace(/"/g, '""')}"`;

const truncateForLog = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.length > MAX_LOGGED_VALUE_LENGTH ? `${text.slice(0, MAX_LOGGED_VALUE_LENGTH)}…` : text;
};

// Ohne Flag existiert die Route nicht (404) – Default aus, siehe .env.example
router.use((req, res, next) => {
  if (process.env.DEBUG_ROUTE_ENABLED !== 'true') {
    return res.status(404).json({ error: 'Not found' });
  }
  next();
});

router.param('tableName', (req, res, next, tableName) => {
  if (!TABLE_NAME_REGEX.test(tableName)) {
    return res.status(400).json({ error: 'Invalid table name' });
  }
  if (isBlockedTable(tableName)) {
    return res.status(403).json({ error: 'Table is blocked in debug view' });
  }
  next();
});

const parsePagination = (query) => {
  const parse = (raw, fallback, min) => {
    if (raw === undefined) return fallback;
    if (typeof raw !== 'string' || !/^\d{1,9}$/.test(raw)) return null;
    const n = Number(raw);
    return n >= min ? n : null;
  };
  const limit = parse(query.limit, DEFAULT_PAGE_SIZE, 1);
  const offset = parse(query.offset, 0, 0);
  if (limit === null || offset === null) return null;
  return { limit: Math.min(limit, MAX_PAGE_SIZE), offset };
};

// Spalten (ohne BYTEA) und Primärschlüssel; null = Tabelle existiert nicht
async function loadTableMeta(tableName) {
  const columnsInfo = await db.query(
    `SELECT column_name, data_type, character_maximum_length,
            column_default, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [tableName]
  );
  if (columnsInfo.rows.length === 0) return null;
  const pkInfo = await db.query(
    `SELECT a.attname AS column_name
     FROM   pg_index i
     JOIN   pg_attribute a ON a.attrelid = i.indrelid
                          AND a.attnum = ANY(i.indkey)
     WHERE  i.indrelid = $1::regclass
     AND    i.indisprimary`,
    [`public.${quoteIdent(tableName)}`]
  );
  return {
    columns: columnsInfo.rows.filter((c) => c.data_type !== 'bytea'),
    primaryKeys: pkInfo.rows.map((r) => r.column_name),
  };
}

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
    res.json(result.rows.map(row => row.table_name).filter((name) => !isBlockedTable(name)));
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
 *       - { name: limit, in: query, schema: { type: integer, minimum: 1, maximum: 500, default: 100 } }
 *       - { name: offset, in: query, schema: { type: integer, minimum: 0, default: 0 } }
 *     responses:
 *       200:
 *         description: Tabelleninhalt (ohne BYTEA-Spalten, paginiert)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data: { type: array, items: { type: object } }
 *                 columns: { type: array, items: { type: object } }
 *                 primaryKeys: { type: array, items: { type: string } }
 *                 total: { type: integer }
 *                 limit: { type: integer }
 *                 offset: { type: integer }
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
  const paging = parsePagination(req.query);
  if (!paging) {
    return res.status(400).json({ error: `limit muss 1-${MAX_PAGE_SIZE}, offset >= 0 sein` });
  }
  try {
    const meta = await loadTableMeta(tableName);
    if (!meta) {
      return res.status(404).json({ error: 'Table not found' });
    }
    const { columns, primaryKeys } = meta;
    const selectList = columns.map((c) => quoteIdent(c.column_name)).join(', ');
    const orderBy = primaryKeys.length > 0 ? `ORDER BY ${primaryKeys.map(quoteIdent).join(', ')}` : '';

    const totalResult = await db.query(`SELECT COUNT(*)::int AS total FROM ${quoteIdent(tableName)}`);
    const result = await db.query(
      `SELECT ${selectList} FROM ${quoteIdent(tableName)} ${orderBy} LIMIT $1 OFFSET $2`,
      [paging.limit, paging.offset]
    );

    res.json({
      data: result.rows,
      columns,
      primaryKeys,
      total: totalResult.rows[0].total,
      limit: paging.limit,
      offset: paging.offset,
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
 *     description: 'Roher Direktzugriff auf die Datenbank ohne Business-Validierung – nur zum Debuggen. Nur mit
 *       DEBUG_ROUTE_ENABLED=true (sonst 404); app_users, audit_log, bestellung* und schema_migrations
 *       sind gesperrt (403). Änderungen werden geloggt. Erfordert Rolle: admin.'
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

  let client;
  try {
    const meta = await loadTableMeta(tableName);
    if (!meta) {
      return res.status(404).json({ error: 'Table not found' });
    }
    const { columns, primaryKeys } = meta;
    if (primaryKeys.length !== 1) {
      return res.status(400).json({ error: 'Table has no single-column primary key' });
    }
    if (primaryKey !== primaryKeys[0]) {
      return res.status(400).json({ error: 'primaryKey does not match the table primary key' });
    }
    if (field === primaryKey) {
      return res.status(400).json({ error: 'Primary key column cannot be updated' });
    }
    if (!columns.some((c) => c.column_name === field)) {
      return res.status(400).json({ error: 'Unknown or non-editable column' });
    }

    const newValue = value === '' ? null : value;
    const table = quoteIdent(tableName);
    const returning = columns.map((c) => quoteIdent(c.column_name)).join(', ');

    client = await db.connect();
    await client.query('BEGIN');
    const old = await client.query(
      `SELECT ${quoteIdent(field)} AS value FROM ${table} WHERE ${quoteIdent(primaryKey)} = $1 FOR UPDATE`,
      [id]
    );
    if (old.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Row not found' });
    }
    const result = await client.query(
      `UPDATE ${table} SET ${quoteIdent(field)} = $1 WHERE ${quoteIdent(primaryKey)} = $2 RETURNING ${returning}`,
      [newValue, id]
    );
    await client.query('COMMIT');

    logger.info('DEBUG', 'Debug-Update', {
      benutzer: req.user?.username,
      tabelle: tableName,
      feld: field,
      pkWert: truncateForLog(id),
      alterWert: truncateForLog(old.rows[0].value),
      neuerWert: truncateForLog(newValue),
    });

    res.json(result.rows[0]);
  } catch (err) {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
    }
    logger.error('DEBUG', 'Fehler beim Aktualisieren der Daten für Tabelle', { tabelle: tableName, field, message: err.message });
    res.status(500).json({ error: `Failed to update data for ${tableName}` });
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
