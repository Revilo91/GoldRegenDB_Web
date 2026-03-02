const express = require('express');
const router = express.Router();
const db = require('../config/db');

// Tables to export/import (in FK-safe order for import)
const EXPORT_TABLES = ['Kunde', 'Lieferschein', 'Rechnung', 'Schmuckstück'];

// GET /api/backup/export – Export all main tables as a JSON file
router.get('/export', async (req, res) => {
  try {
    const exportData = {
      version: '1.0',
      timestamp: new Date().toISOString(),
      tables: {},
    };

    for (const table of EXPORT_TABLES) {
      const result = await db.query(`SELECT * FROM "${table}"`);
      exportData.tables[table] = result.rows;
    }

    const formattedTimestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `goldregendb_backup_${formattedTimestamp}.json`;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(exportData);
  } catch (err) {
    console.error('Backup export error:', err);
    res.status(500).json({ error: 'Fehler beim Exportieren der Daten' });
  }
});

// POST /api/backup/import – Import data from a previously exported JSON backup
router.post('/import', async (req, res) => {
  const { tables, version } = req.body;

  if (!tables || !version) {
    return res.status(400).json({ error: 'Ungültiges Backup-Format' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Truncate in reverse FK order; RESTART IDENTITY resets sequences
    await client.query(
      `TRUNCATE TABLE "Schmuckstück", "Rechnung", "Lieferschein", "Kunde" RESTART IDENTITY CASCADE`
    );

    // Helper: bulk-insert rows for a table using a single multi-row INSERT
    const insertRows = async (tableName, rows) => {
      if (!rows || rows.length === 0) return;
      const cols = Object.keys(rows[0])
        .map((c) => `"${c}"`)
        .join(', ');
      const colCount = Object.keys(rows[0]).length;
      const placeholders = rows
        .map((_, rowIdx) =>
          `(${Array.from({ length: colCount }, (__, colIdx) => `$${rowIdx * colCount + colIdx + 1}`).join(', ')})`
        )
        .join(', ');
      const values = rows.flatMap((row) => Object.values(row));
      await client.query(
        `INSERT INTO "${tableName}" (${cols}) VALUES ${placeholders}`,
        values
      );
    };

    await insertRows('Kunde', tables['Kunde']);
    await insertRows('Lieferschein', tables['Lieferschein']);
    await insertRows('Rechnung', tables['Rechnung']);
    await insertRows('Schmuckstück', tables['Schmuckstück']);

    // Reset SERIAL sequences to avoid PK conflicts on future inserts
    const seqResets = [
      `SELECT setval(pg_get_serial_sequence('"Kunde"', 'ID'), COALESCE((SELECT MAX("ID") FROM "Kunde"), 0) + 1, false)`,
      `SELECT setval(pg_get_serial_sequence('"Lieferschein"', 'ID'), COALESCE((SELECT MAX("ID") FROM "Lieferschein"), 0) + 1, false)`,
      `SELECT setval(pg_get_serial_sequence('"Rechnung"', 'ID'), COALESCE((SELECT MAX("ID") FROM "Rechnung"), 0) + 1, false)`,
    ];
    for (const sql of seqResets) {
      await client.query(sql);
    }

    await client.query('COMMIT');

    const counts = {};
    for (const t of EXPORT_TABLES) {
      counts[t] = (tables[t] || []).length;
    }

    res.json({ success: true, message: 'Import erfolgreich', counts });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Backup import error:', err);
    res.status(500).json({ error: `Fehler beim Importieren: ${err.message}` });
  } finally {
    client.release();
  }
});

module.exports = router;
