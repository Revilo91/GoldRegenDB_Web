const express = require('express');
const router = express.Router();
const db = require('../config/db');
const logger = require('../utils/logger');

// Tables to export/import (in FK-safe order for import)
const EXPORT_TABLES = ['app_users', 'audit_log', 'Kunde', 'Lieferschein', 'Rechnung', 'Schmuckstück'];

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
    logger.error('BACKUP', 'Fehler beim Exportieren der Daten', { message: err.message });
    res.status(500).json({ error: 'Fehler beim Exportieren der Daten' });
  }
});

// Helper function to normalize different backup formats
function normalizeBackupData(data) {
  // Format 1: Standard backup format { version, timestamp, tables: { Kunde: [...], ... } }
  if (data.tables && typeof data.tables === 'object' && data.version) {
    return { version: data.version, tables: data.tables };
  }

  // Format 2: SQL Export format [{ type: "header" }, { type: "table", name: "...", data: [...] }, ...]
  if (Array.isArray(data)) {
    const normalized = {
      version: '1.0',
      tables: {},
    };

    // Extract version from header if present
    const header = data.find((item) => item.type === 'header');
    if (header && header.version) {
      normalized.version = header.version;
    }

    // Extract table data from items with type: "table"
    const tableItems = data.filter((item) => item.type === 'table');
    for (const item of tableItems) {
      if (item.name && Array.isArray(item.data)) {
        normalized.tables[item.name] = item.data;
      }
    }

    return normalized;
  }

  return null;
}

// POST /api/backup/import – Import data from a previously exported JSON backup
router.post('/import', async (req, res) => {
  // Try to normalize the incoming data (supports multiple formats)
  const normalized = normalizeBackupData(req.body);

  if (!normalized || !normalized.tables || !normalized.version) {
    return res.status(400).json({
      error: 'Ungültiges Backup-Format. Unterstützte Formate: Standard-Backup oder SQL-Export-Array.'
    });
  }

  const { tables, version } = normalized;
  logger.info('BACKUP', `Import gestartet (Version: ${version})`, { tabellen: Object.keys(tables) });

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Truncate in reverse FK order; RESTART IDENTITY resets sequences
    await client.query(
      `TRUNCATE TABLE "Schmuckstück", "Rechnung", "Lieferschein", "Kunde", "audit_log", "app_users" RESTART IDENTITY CASCADE`
    );

    // Helper: Get actual column names from database schema
    const getTableColumns = async (tableName) => {
      const result = await client.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_name = $1
         ORDER BY ordinal_position`,
        [tableName]
      );
      return result.rows.map((row) => row.column_name);
    };

    // Helper: bulk-insert rows for a table in batches to avoid PostgreSQL param limit (65535)
    // Only inserts columns that exist in the current database schema
    const insertRows = async (tableName, rows) => {
      if (!rows || rows.length === 0) return;

      // Get valid columns from database schema
      const validColumns = await getTableColumns(tableName);

      const BATCH_SIZE = 100; // Process 100 rows at a time (safe for tables with ~34 columns)

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);

        // Filter to only include columns that exist in both backup data AND current schema
        const backupColumns = Object.keys(batch[0]);
        const columnsToInsert = backupColumns.filter((col) => validColumns.includes(col));

        if (columnsToInsert.length === 0) {
          logger.warn('BACKUP', `Keine passenden Spalten gefunden für Tabelle ${tableName}`);
          continue;
        }

        const cols = columnsToInsert.map((c) => `"${c}"`).join(', ');
        const colCount = columnsToInsert.length;
        const placeholders = batch
          .map((_, rowIdx) =>
            `(${Array.from({ length: colCount }, (__, colIdx) => `$${rowIdx * colCount + colIdx + 1}`).join(', ')})`
          )
          .join(', ');

        // Extract only the values for columns that will be inserted
        const values = batch.flatMap((row) =>
          columnsToInsert.map((col) => row[col])
        );

        await client.query(
          `INSERT INTO "${tableName}" (${cols}) VALUES ${placeholders}`,
          values
        );
      }
    };

    await insertRows('app_users', tables['app_users']);
    await insertRows('audit_log', tables['audit_log']);
    await insertRows('Kunde', tables['Kunde']);
    await insertRows('Lieferschein', tables['Lieferschein']);
    await insertRows('Rechnung', tables['Rechnung']);
    await insertRows('Schmuckstück', tables['Schmuckstück']);

    // Reset SERIAL sequences to avoid PK conflicts on future inserts
    const seqResets = [
      `SELECT setval(pg_get_serial_sequence('"app_users"', 'id'), COALESCE((SELECT MAX("id") FROM "app_users"), 0) + 1, false)`,
      `SELECT setval(pg_get_serial_sequence('"audit_log"', 'id'), COALESCE((SELECT MAX("id") FROM "audit_log"), 0) + 1, false)`,
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
    logger.info('BACKUP', 'Import erfolgreich abgeschlossen', counts);
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('BACKUP', 'Fehler beim Importieren', { message: err.message });
    res.status(500).json({ error: `Fehler beim Importieren: ${err.message}` });
  } finally {
    client.release();
  }
});

module.exports = router;
