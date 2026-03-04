const express = require('express');
const router = express.Router();
const db = require('../config/db');
const logger = require('../utils/logger');

// Get all table names in the public schema
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

// Get all rows for a specific table
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
    logger.error('DEBUG', `Fehler beim Laden der Daten für Tabelle ${tableName}`, { message: err.message });
    res.status(500).json({ error: `Failed to fetch data for ${tableName}` });
  }
});

// Update a specific row in a table
router.put('/tables/:tableName', async (req, res) => {
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
    logger.error('DEBUG', `Fehler beim Aktualisieren der Daten für Tabelle ${tableName}`, { message: err.message, field });
    res.status(500).json({ error: `Failed to update data for ${tableName}` });
  }
});

module.exports = router;
