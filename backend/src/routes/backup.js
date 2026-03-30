const express = require("express");
const router = express.Router();
const db = require("../config/db");
const logger = require("../utils/logger");

// Zentrale Tabellenliste für Export/Import (Reihenfolge: FK-sicher für Import und Truncate)
const ALL_TABLES = [
  "Schmuckstück",
  "lagerinventur",
  "Rechnung",
  "Lieferschein",
  "Kunde",
  "audit_log",
  "app_users",
];

// Alias für Export (alle Tabellen)
const EXPORT_TABLES = ALL_TABLES;

// GET /api/backup/export – Export selected (or all) tables as a JSON file
// Optional query param: ?tables=Kunde,Lieferschein,... (comma-separated)
router.get("/export", async (req, res) => {
  try {
    // Determine which tables to export
    let tablesToExport;
    if (req.query.tables) {
      const requested = req.query.tables
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      // Only allow tables that are in the known EXPORT_TABLES list
      tablesToExport = EXPORT_TABLES.filter((t) => requested.includes(t));
    } else {
      tablesToExport = EXPORT_TABLES;
    }

    const exportData = {
      version: "1.0",
      timestamp: new Date().toISOString(),
      tables: {},
    };

    for (const table of tablesToExport) {
      const result = await db.query(`SELECT * FROM "${table}"`);
      exportData.tables[table] = result.rows;
    }

    const formattedTimestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);
    const filename = `goldregendb_backup_${formattedTimestamp}.json`;

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.json(exportData);
  } catch (err) {
    logger.error("BACKUP", "Fehler beim Exportieren der Daten", {
      message: err.message,
    });
    res.status(500).json({ error: "Fehler beim Exportieren der Daten" });
  }
});

// Helper function to normalize different backup formats
function normalizeBackupData(data) {
  // Format 1: Standard backup format { version, timestamp, tables: { Kunde: [...], ... } }
  if (data.tables && typeof data.tables === "object" && data.version) {
    return { version: data.version, tables: data.tables };
  }

  // Format 2: SQL Export format [{ type: "header" }, { type: "table", name: "...", data: [...] }, ...]
  if (Array.isArray(data)) {
    const normalized = {
      version: "1.0",
      tables: {},
    };

    // Extract version from header if present
    const header = data.find((item) => item.type === "header");
    if (header && header.version) {
      normalized.version = header.version;
    }

    // Extract table data from items with type: "table"
    const tableItems = data.filter((item) => item.type === "table");
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
// Optional body param: selectedTables (array) – if provided, only those tables are truncated and reimported
router.post("/import", async (req, res) => {
  let rawData;
  let selectedTables;

  const body = req.body;

  if (
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    "backupData" in body
  ) {
    // New wrapper format sent by the updated frontend:
    // { backupData: <backup payload>, selectedTables: [...] | null }
    rawData = body.backupData;
    selectedTables = Array.isArray(body.selectedTables)
      ? body.selectedTables
      : null;
  } else {
    // Legacy direct format (backward compat for direct API calls)
    rawData = body;
    selectedTables = null;
  }

  // Try to normalize the incoming data (supports multiple formats)
  const normalized = normalizeBackupData(rawData);

  if (!normalized || !normalized.tables || !normalized.version) {
    return res.status(400).json({
      error:
        "Ungültiges Backup-Format. Unterstützte Formate: Standard-Backup oder SQL-Export-Array.",
    });
  }

  const { tables, version } = normalized;

  // Bestimme, welche Tabellen importiert werden sollen (FK-sichere Reihenfolge)
  let tablesToImport;
  if (Array.isArray(selectedTables) && selectedTables.length > 0) {
    // Nur bekannte Tabellen; Reihenfolge wie in ALL_TABLES
    const selectedSet = new Set(selectedTables);
    tablesToImport = ALL_TABLES.filter(
      (t) =>
        selectedSet.has(t) && Object.prototype.hasOwnProperty.call(tables, t),
    );
  } else {
    // Standard: alle Tabellen aus Backup, Reihenfolge wie in ALL_TABLES
    tablesToImport = ALL_TABLES.filter((t) =>
      Object.prototype.hasOwnProperty.call(tables, t),
    );
  }

  logger.info("BACKUP", `Import gestartet (Version: ${version})`, {
    tabellen: tablesToImport,
  });

  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");

    // Truncate only the selected tables; table names are validated against FK_SAFE_ORDER whitelist above.
    // CASCADE satisfies any remaining FK constraints (e.g. when a parent table is truncated).
    if (tablesToImport.length > 0) {
      const truncateList = tablesToImport.map((t) => `"${t}"`).join(", ");
      await client.query(
        `TRUNCATE TABLE ${truncateList} RESTART IDENTITY CASCADE`,
      );
    }

    // Helper: Get actual column names from database schema
    const getTableColumns = async (tableName) => {
      const result = await client.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_name = $1
         ORDER BY ordinal_position`,
        [tableName],
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
        const columnsToInsert = backupColumns.filter((col) =>
          validColumns.includes(col),
        );

        if (columnsToInsert.length === 0) {
          logger.warn(
            "BACKUP",
            `Keine passenden Spalten gefunden für Tabelle ${tableName}`,
          );
          continue;
        }

        const cols = columnsToInsert.map((c) => `"${c}"`).join(", ");
        const colCount = columnsToInsert.length;
        const placeholders = batch
          .map(
            (_, rowIdx) =>
              `(${Array.from({ length: colCount }, (__, colIdx) => `$${rowIdx * colCount + colIdx + 1}`).join(", ")})`,
          )
          .join(", ");

        // Extract only the values for columns that will be inserted
        const values = batch.flatMap((row) =>
          columnsToInsert.map((col) => row[col]),
        );

        await client.query(
          `INSERT INTO "${tableName}" (${cols}) VALUES ${placeholders}`,
          values,
        );
      }
    };

    // Insert rows in FK-sicherer Reihenfolge: Eltern zuerst (umgekehrte ALL_TABLES)
    const INSERT_ORDER = [...ALL_TABLES].reverse();
    for (const tableName of INSERT_ORDER) {
      if (tablesToImport.includes(tableName)) {
        await insertRows(tableName, tables[tableName]);
      }
    }

    // Reset SERIAL sequences to avoid PK conflicts on future inserts
    const allSeqResets = {
      app_users: `SELECT setval(pg_get_serial_sequence('"app_users"', 'id'), COALESCE((SELECT MAX("id") FROM "app_users"), 0) + 1, false)`,
      audit_log: `SELECT setval(pg_get_serial_sequence('"audit_log"', 'id'), COALESCE((SELECT MAX("id") FROM "audit_log"), 0) + 1, false)`,
      Kunde: `SELECT setval(pg_get_serial_sequence('"Kunde"', 'ID'), COALESCE((SELECT MAX("ID") FROM "Kunde"), 0) + 1, false)`,
      Lieferschein: `SELECT setval(pg_get_serial_sequence('"Lieferschein"', 'ID'), COALESCE((SELECT MAX("ID") FROM "Lieferschein"), 0) + 1, false)`,
      Rechnung: `SELECT setval(pg_get_serial_sequence('"Rechnung"', 'ID'), COALESCE((SELECT MAX("ID") FROM "Rechnung"), 0) + 1, false)`,
    };
    for (const tableName of tablesToImport) {
      if (allSeqResets[tableName]) {
        await client.query(allSeqResets[tableName]);
      }
    }

    await client.query("COMMIT");

    const counts = {};
    for (const t of tablesToImport) {
      counts[t] = (tables[t] || []).length;
    }

    res.json({ success: true, message: "Import erfolgreich", counts });
    logger.info("BACKUP", "Import erfolgreich abgeschlossen", counts);
  } catch (err) {
    if (client) await client.query("ROLLBACK");
    logger.error("BACKUP", "Fehler beim Importieren", { message: err.message });
    res.status(500).json({ error: `Fehler beim Importieren: ${err.message}` });
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
