const express = require("express");
const router = express.Router();
const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const multer = require("multer");
const AdmZip = require("adm-zip");
const db = require("../config/db");
const logger = require("../utils/logger");

const UPLOADS_DIR = process.env.BACKUP_UPLOADS_DIR
  ? path.resolve(process.env.BACKUP_UPLOADS_DIR)
  : path.resolve(__dirname, "../assets/uploads");
// Muss reale Upload-Ordner abdecken (Export erzeugt ZIPs in vergleichbarer Größe, siehe exportUploadsZipBuffer)
const MAX_UPLOADS_ZIP_SIZE_MB = Number(process.env.BACKUP_UPLOADS_ZIP_MAX_MB) || 4096;
const uploadZip = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOADS_ZIP_SIZE_MB * 1024 * 1024 },
});

function uploadZipMiddleware(req, res, next) {
  uploadZip.single("uploadsZip")(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        error: `Datei zu groß. Maximale Größe: ${MAX_UPLOADS_ZIP_SIZE_MB} MB`,
      });
    }

    logger.error("BACKUP", "Fehler beim Upload der Upload-ZIP", { message: err.message });
    return res.status(400).json({ error: `Fehler beim Datei-Upload: ${err.message}` });
  });
}
const exportUploadJobs = new Map();
const EXPORT_JOB_TTL_MS = 30 * 60 * 1000;

function sanitizeUploadFileName(fileName) {
  const base = path.basename(String(fileName || "").trim());
  if (!base) return null;
  return base.replace(/[^A-Za-z0-9._-]/g, "_");
}

async function listUploadFiles() {
  let entries = [];
  try {
    entries = await fs.readdir(UPLOADS_DIR, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") {
      return [];
    }
    throw err;
  }

  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;

    const safeName = sanitizeUploadFileName(entry.name);
    if (!safeName) continue;

    files.push({
      name: safeName,
      originalName: entry.name,
      filePath: path.join(UPLOADS_DIR, entry.name),
    });
  }

  return files;
}

function cleanupExportJob(jobId) {
  exportUploadJobs.delete(jobId);
}

function scheduleExportJobCleanup(jobId, ttlMs = EXPORT_JOB_TTL_MS) {
  setTimeout(() => cleanupExportJob(jobId), ttlMs).unref();
}

// Generischer Cleanup für die weiteren Job-Maps unten (Tabellen-Export/-Import, Bild-ZIP-Import)
function scheduleJobCleanup(jobsMap, jobId, ttlMs = EXPORT_JOB_TTL_MS) {
  setTimeout(() => jobsMap.delete(jobId), ttlMs).unref();
}

function computeProgressPercent(processed, total, status) {
  if (total === 0) return status === "completed" ? 100 : 0;
  return Math.round((processed / total) * 100);
}

function serializeExportJob(job) {
  return {
    id: job.id,
    status: job.status,
    totalFiles: job.totalFiles,
    processedFiles: job.processedFiles,
    currentFileName: job.currentFileName,
    fileName: job.fileName,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    progressPercent:
      job.totalFiles === 0
        ? job.status === "completed"
          ? 100
          : 0
        : Math.round((job.processedFiles / job.totalFiles) * 100),
  };
}

async function exportUploadsZipBuffer(onProgress) {
  const files = await listUploadFiles();
  const zip = new AdmZip();

  if (onProgress) {
    await onProgress({
      totalFiles: files.length,
      processedFiles: 0,
      currentFileName: null,
    });
  }

  for (const file of files) {
    try {
      if (onProgress) {
        await onProgress({
          totalFiles: files.length,
          processedFiles: zip.getEntries().length,
          currentFileName: file.originalName || file.name,
        });
      }

      const content = await fs.readFile(file.filePath);
      zip.addFile(file.name, content);
      // Fotos (jpg/png/gif) sind bereits komprimiert – ungespeichert (STORED statt
      // DEFLATED) vermeidet, dass zip.toBuffer() das Event-Loop minutenlang mit
      // wirkungslosem Deflate blockiert (bei ~1000 Bildern sonst 60+ Sekunden Blockade,
      // die Fortschritts-Polling zum Stillstand bringt und Proxy-Timeouts auslöst).
      const entry = zip.getEntry(file.name);
      if (entry) entry.header.method = 0; // 0 = STORED (siehe adm-zip util/constants.js)

      if (onProgress) {
        await onProgress({
          totalFiles: files.length,
          processedFiles: zip.getEntries().length,
          currentFileName: file.originalName || file.name,
        });
      }
    } catch (err) {
      const wrappedError = new Error(
        `Bild konnte nicht gelesen werden: ${file.originalName || file.name}`,
      );
      wrappedError.cause = err;
      wrappedError.fileName = file.originalName || file.name;
      wrappedError.filePath = file.filePath;
      throw wrappedError;
    }
  }

  return {
    zipBuffer: zip.toBuffer(),
    fileCount: files.length,
  };
}

function createExportUploadsJob() {
  const jobId = randomUUID();
  const formattedTimestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);

  const job = {
    id: jobId,
    status: "pending",
    totalFiles: 0,
    processedFiles: 0,
    currentFileName: null,
    fileName: `goldregendb_uploads_${formattedTimestamp}.zip`,
    error: null,
    zipBuffer: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  exportUploadJobs.set(jobId, job);
  scheduleExportJobCleanup(jobId);

  (async () => {
    try {
      job.status = "running";
      job.updatedAt = new Date().toISOString();

      const { zipBuffer, fileCount } = await exportUploadsZipBuffer(
        async ({ totalFiles, processedFiles, currentFileName }) => {
          job.totalFiles = totalFiles;
          job.processedFiles = processedFiles;
          job.currentFileName = currentFileName;
          job.updatedAt = new Date().toISOString();
        },
      );

      job.zipBuffer = zipBuffer;
      job.totalFiles = fileCount;
      job.processedFiles = fileCount;
      job.currentFileName = null;
      job.status = "completed";
      job.updatedAt = new Date().toISOString();
    } catch (err) {
      job.status = "failed";
      job.error = {
        message: err.message,
        fileName: err.fileName,
        filePath: err.filePath,
        cause: err.cause?.message,
      };
      job.updatedAt = new Date().toISOString();
      logger.error("BACKUP", "Fehler beim Erstellen des Upload-Export-Jobs", {
        jobId,
        message: err.message,
        fileName: err.fileName,
        filePath: err.filePath,
        cause: err.cause?.message,
      });
    }
  })();

  return job;
}

async function importUploads(uploads, onFileProgress) {
  if (!uploads || !Array.isArray(uploads.files)) {
    return { restored: 0, skipped: 0 };
  }

  await fs.mkdir(UPLOADS_DIR, { recursive: true });

  let restored = 0;
  let skipped = 0;

  for (const item of uploads.files) {
    const safeName = sanitizeUploadFileName(item?.name);
    const base64Data = item?.dataBase64;
    if (!safeName || typeof base64Data !== "string" || base64Data.length === 0) {
      skipped += 1;
      if (onFileProgress) onFileProgress();
      continue;
    }

    try {
      const filePath = path.join(UPLOADS_DIR, safeName);
      const fileBuffer = Buffer.from(base64Data, "base64");
      await fs.writeFile(filePath, fileBuffer);
      restored += 1;
    } catch (_err) {
      skipped += 1;
    }
    if (onFileProgress) onFileProgress();
  }

  return { restored, skipped };
}

async function importUploadsFromZipBuffer(zipBuffer, onProgress) {
  if (!zipBuffer || zipBuffer.length === 0) {
    return { restored: 0, skipped: 0 };
  }

  await fs.mkdir(UPLOADS_DIR, { recursive: true });

  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
  let restored = 0;
  let skipped = 0;

  if (onProgress) {
    await onProgress({ totalFiles: entries.length, processedFiles: 0, currentFileName: null });
  }

  for (const entry of entries) {
    const safeName = sanitizeUploadFileName(path.basename(entry.entryName));

    if (onProgress) {
      await onProgress({
        totalFiles: entries.length,
        processedFiles: restored + skipped,
        currentFileName: entry.entryName,
      });
    }

    if (!safeName) {
      skipped += 1;
      continue;
    }

    try {
      const outPath = path.join(UPLOADS_DIR, safeName);
      const data = entry.getData();
      await fs.writeFile(outPath, data);
      restored += 1;
    } catch (_err) {
      skipped += 1;
    }
  }

  if (onProgress) {
    await onProgress({ totalFiles: entries.length, processedFiles: restored + skipped, currentFileName: null });
  }

  return { restored, skipped };
}

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

const exportTablesJobs = new Map();

function serializeExportTablesJob(job) {
  return {
    id: job.id,
    status: job.status,
    totalTables: job.totalTables,
    processedTables: job.processedTables,
    currentTable: job.currentTable,
    fileName: job.fileName,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    progressPercent: computeProgressPercent(job.processedTables, job.totalTables, job.status),
  };
}

function createExportTablesJob(tablesToExport) {
  const jobId = randomUUID();
  const formattedTimestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);

  const job = {
    id: jobId,
    status: "pending",
    totalTables: tablesToExport.length,
    processedTables: 0,
    currentTable: null,
    fileName: `goldregendb_backup_${formattedTimestamp}.json`,
    error: null,
    exportData: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  exportTablesJobs.set(jobId, job);
  scheduleJobCleanup(exportTablesJobs, jobId);

  (async () => {
    try {
      job.status = "running";
      job.updatedAt = new Date().toISOString();

      const exportData = {
        version: "1.0",
        timestamp: new Date().toISOString(),
        tables: {},
      };

      for (const table of tablesToExport) {
        job.currentTable = table;
        job.updatedAt = new Date().toISOString();

        const result = await db.query(`SELECT * FROM "${table}"`);
        exportData.tables[table] = result.rows;

        job.processedTables += 1;
        job.updatedAt = new Date().toISOString();
      }

      job.exportData = exportData;
      job.currentTable = null;
      job.status = "completed";
      job.updatedAt = new Date().toISOString();
    } catch (err) {
      job.status = "failed";
      job.error = { message: err.message };
      job.updatedAt = new Date().toISOString();
      logger.error("BACKUP", "Fehler beim Erstellen des Tabellen-Export-Jobs", {
        jobId,
        message: err.message,
      });
    }
  })();

  return job;
}

// POST /api/backup/export-jobs – Start a table export job (JSON), optionally ?tables=Kunde,Lieferschein,...
router.post("/export-jobs", async (req, res) => {
  let tablesToExport;
  if (req.query.tables) {
    const requested = req.query.tables
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    tablesToExport = EXPORT_TABLES.filter((t) => requested.includes(t));
  } else {
    tablesToExport = EXPORT_TABLES;
  }

  const job = createExportTablesJob(tablesToExport);
  res.status(202).json({ job: serializeExportTablesJob(job) });
});

router.get("/export-jobs/:jobId", async (req, res) => {
  const job = exportTablesJobs.get(req.params.jobId);

  if (!job) {
    return res.status(404).json({ error: "Export-Job nicht gefunden" });
  }

  res.json({ job: serializeExportTablesJob(job) });
});

router.get("/export-jobs/:jobId/download", async (req, res) => {
  const job = exportTablesJobs.get(req.params.jobId);

  if (!job) {
    return res.status(404).json({ error: "Export-Job nicht gefunden" });
  }

  if (job.status !== "completed" || !job.exportData) {
    return res.status(409).json({
      error: "Export-Job ist noch nicht abgeschlossen",
      job: serializeExportTablesJob(job),
    });
  }

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="${job.fileName}"`);
  res.json(job.exportData);

  setTimeout(() => exportTablesJobs.delete(job.id), 60 * 1000).unref();
});

// GET /api/backup/export-uploads – Export backend/src/assets/uploads as ZIP
router.get("/export-uploads", async (_req, res) => {
  try {
    const { zipBuffer, fileCount } = await exportUploadsZipBuffer();
    const formattedTimestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);
    const filename = `goldregendb_uploads_${formattedTimestamp}.zip`;

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", String(zipBuffer.length));
    res.setHeader("X-Upload-File-Count", String(fileCount));
    res.send(zipBuffer);
  } catch (err) {
    logger.error("BACKUP", "Fehler beim Exportieren der Upload-Bilder", {
      message: err.message,
      fileName: err.fileName,
      filePath: err.filePath,
      cause: err.cause?.message,
    });
    res.status(500).json({
      error: "Fehler beim Exportieren der Upload-Bilder",
      details: err.message,
      fileName: err.fileName,
      filePath: err.filePath,
      cause: err.cause?.message,
    });
  }
});

router.post("/export-uploads-jobs", async (_req, res) => {
  const job = createExportUploadsJob();
  res.status(202).json({ job: serializeExportJob(job) });
});

router.get("/export-uploads-jobs/:jobId", async (req, res) => {
  const job = exportUploadJobs.get(req.params.jobId);

  if (!job) {
    return res.status(404).json({ error: "Export-Job nicht gefunden" });
  }

  res.json({ job: serializeExportJob(job) });
});

router.get("/export-uploads-jobs/:jobId/download", async (req, res) => {
  const job = exportUploadJobs.get(req.params.jobId);

  if (!job) {
    return res.status(404).json({ error: "Export-Job nicht gefunden" });
  }

  if (job.status !== "completed" || !job.zipBuffer) {
    return res.status(409).json({
      error: "Export-Job ist noch nicht abgeschlossen",
      job: serializeExportJob(job),
    });
  }

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${job.fileName}"`);
  res.setHeader("Content-Length", String(job.zipBuffer.length));
  res.setHeader("X-Upload-File-Count", String(job.totalFiles));
  res.send(job.zipBuffer);

  setTimeout(() => cleanupExportJob(job.id), 60 * 1000).unref();
});

const importUploadsZipJobs = new Map();

function serializeImportUploadsZipJob(job) {
  return {
    id: job.id,
    status: job.status,
    totalFiles: job.totalFiles,
    processedFiles: job.processedFiles,
    currentFileName: job.currentFileName,
    error: job.error,
    uploads: job.uploads,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    progressPercent: computeProgressPercent(job.processedFiles, job.totalFiles, job.status),
  };
}

function createImportUploadsZipJob(zipBuffer) {
  const jobId = randomUUID();

  const job = {
    id: jobId,
    status: "pending",
    totalFiles: 0,
    processedFiles: 0,
    currentFileName: null,
    error: null,
    uploads: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  importUploadsZipJobs.set(jobId, job);
  scheduleJobCleanup(importUploadsZipJobs, jobId);

  (async () => {
    try {
      job.status = "running";
      job.updatedAt = new Date().toISOString();

      const result = await importUploadsFromZipBuffer(
        zipBuffer,
        async ({ totalFiles, processedFiles, currentFileName }) => {
          job.totalFiles = totalFiles;
          job.processedFiles = processedFiles;
          job.currentFileName = currentFileName;
          job.updatedAt = new Date().toISOString();
        },
      );

      job.uploads = result;
      job.currentFileName = null;
      job.status = "completed";
      job.updatedAt = new Date().toISOString();
    } catch (err) {
      job.status = "failed";
      job.error = { message: err.message };
      job.updatedAt = new Date().toISOString();
      logger.error("BACKUP", "Fehler beim Importieren der Upload-Bilder", {
        jobId,
        message: err.message,
      });
    }
  })();

  return job;
}

// POST /api/backup/import-uploads-zip-jobs – Start a job that imports upload images from a ZIP file
router.post(
  "/import-uploads-zip-jobs",
  uploadZipMiddleware,
  async (req, res) => {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        error: "Keine ZIP-Datei hochgeladen. Feldname: uploadsZip",
      });
    }

    const job = createImportUploadsZipJob(req.file.buffer);
    res.status(202).json({ job: serializeImportUploadsZipJob(job) });
  },
);

router.get("/import-uploads-zip-jobs/:jobId", async (req, res) => {
  const job = importUploadsZipJobs.get(req.params.jobId);

  if (!job) {
    return res.status(404).json({ error: "Import-Job nicht gefunden" });
  }

  res.json({ job: serializeImportUploadsZipJob(job) });
});

// Helper function to normalize different backup formats
function normalizeBackupData(data) {
  // Format 1: Standard backup format { version, timestamp, tables: { Kunde: [...], ... } }
  if (data.tables && typeof data.tables === "object" && data.version) {
    return {
      version: data.version,
      tables: data.tables,
      uploads: data.uploads,
    };
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

const importTablesJobs = new Map();

function serializeImportTablesJob(job) {
  return {
    id: job.id,
    status: job.status,
    totalUnits: job.totalUnits,
    processedUnits: job.processedUnits,
    currentTable: job.currentTable,
    error: job.error,
    counts: job.counts,
    uploads: job.uploads,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    progressPercent: computeProgressPercent(job.processedUnits, job.totalUnits, job.status),
  };
}

// Reihenfolge FK-sicher für Import: Eltern zuerst (umgekehrte ALL_TABLES)
const IMPORT_INSERT_ORDER = [...ALL_TABLES].reverse();

// SERIAL-Sequenzen nach dem Import neu setzen, um PK-Konflikte bei künftigen Inserts zu vermeiden
const SEQUENCE_RESETS = {
  app_users: `SELECT setval(pg_get_serial_sequence('"app_users"', 'id'), COALESCE((SELECT MAX("id") FROM "app_users"), 0) + 1, false)`,
  audit_log: `SELECT setval(pg_get_serial_sequence('"audit_log"', 'id'), COALESCE((SELECT MAX("id") FROM "audit_log"), 0) + 1, false)`,
  Kunde: `SELECT setval(pg_get_serial_sequence('"Kunde"', 'ID'), COALESCE((SELECT MAX("ID") FROM "Kunde"), 0) + 1, false)`,
  Lieferschein: `SELECT setval(pg_get_serial_sequence('"Lieferschein"', 'ID'), COALESCE((SELECT MAX("ID") FROM "Lieferschein"), 0) + 1, false)`,
  Rechnung: `SELECT setval(pg_get_serial_sequence('"Rechnung"', 'ID'), COALESCE((SELECT MAX("ID") FROM "Rechnung"), 0) + 1, false)`,
};

function createImportTablesJob(tables, tablesToImport, uploads, restoreUploads) {
  const jobId = randomUUID();

  let totalRows = 0;
  for (const t of tablesToImport) totalRows += (tables[t] || []).length;
  const totalUploadFiles =
    restoreUploads && uploads && Array.isArray(uploads.files) ? uploads.files.length : 0;

  const job = {
    id: jobId,
    status: "pending",
    totalUnits: totalRows + totalUploadFiles,
    processedUnits: 0,
    currentTable: null,
    error: null,
    counts: null,
    uploads: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  importTablesJobs.set(jobId, job);
  scheduleJobCleanup(importTablesJobs, jobId);

  (async () => {
    let client;
    try {
      job.status = "running";
      job.updatedAt = new Date().toISOString();

      client = await db.connect();
      await client.query("BEGIN");

      // Truncate only the selected tables; table names are validated against ALL_TABLES whitelist above.
      // CASCADE satisfies any remaining FK constraints (e.g. when a parent table is truncated).
      if (tablesToImport.length > 0) {
        const truncateList = tablesToImport.map((t) => `"${t}"`).join(", ");
        await client.query(`TRUNCATE TABLE ${truncateList} RESTART IDENTITY CASCADE`);
      }

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

      // Bulk-insert rows for a table in batches to avoid PostgreSQL param limit (65535);
      // only inserts columns that exist in the current database schema
      const insertRows = async (tableName, rows) => {
        if (!rows || rows.length === 0) return;

        const validColumns = await getTableColumns(tableName);
        const BATCH_SIZE = 100; // safe for tables with ~34 columns

        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
          const batch = rows.slice(i, i + BATCH_SIZE);

          const backupColumns = Object.keys(batch[0]);
          const columnsToInsert = backupColumns.filter((col) => validColumns.includes(col));

          if (columnsToInsert.length === 0) {
            logger.warn("BACKUP", `Keine passenden Spalten gefunden für Tabelle ${tableName}`);
            job.processedUnits += batch.length;
            job.updatedAt = new Date().toISOString();
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

          const values = batch.flatMap((row) => columnsToInsert.map((col) => row[col]));

          await client.query(
            `INSERT INTO "${tableName}" (${cols}) VALUES ${placeholders}`,
            values,
          );

          job.processedUnits += batch.length;
          job.updatedAt = new Date().toISOString();
        }
      };

      for (const tableName of IMPORT_INSERT_ORDER) {
        if (tablesToImport.includes(tableName)) {
          job.currentTable = tableName;
          job.updatedAt = new Date().toISOString();
          await insertRows(tableName, tables[tableName]);
        }
      }
      job.currentTable = null;

      for (const tableName of tablesToImport) {
        if (SEQUENCE_RESETS[tableName]) {
          await client.query(SEQUENCE_RESETS[tableName]);
        }
      }

      await client.query("COMMIT");

      const counts = {};
      for (const t of tablesToImport) {
        counts[t] = (tables[t] || []).length;
      }

      let uploadImportResult = null;
      if (restoreUploads && uploads) {
        uploadImportResult = await importUploads(uploads, () => {
          job.processedUnits += 1;
          job.updatedAt = new Date().toISOString();
        });
      }

      job.counts = counts;
      job.uploads = uploadImportResult;
      job.processedUnits = job.totalUnits;
      job.status = "completed";
      job.updatedAt = new Date().toISOString();
      logger.info("BACKUP", "Import erfolgreich abgeschlossen", counts);
    } catch (err) {
      if (client) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackErr) {
          logger.error("BACKUP", "Fehler beim Rollback des Imports", {
            jobId,
            message: rollbackErr.message,
          });
        }
      }
      job.status = "failed";
      job.error = { message: err.message };
      job.updatedAt = new Date().toISOString();
      logger.error("BACKUP", "Fehler beim Importieren", { jobId, message: err.message });
    } finally {
      if (client) client.release();
    }
  })();

  return job;
}

// POST /api/backup/import-jobs – Start a job that imports data from a previously exported JSON backup
// Body: { backupData, selectedTables: [...] | null, restoreUploads: boolean }
router.post("/import-jobs", async (req, res) => {
  let rawData;
  let selectedTables;
  let restoreUploads = false;

  const body = req.body;

  if (body && typeof body === "object" && !Array.isArray(body) && "backupData" in body) {
    // New wrapper format sent by the frontend:
    // { backupData: <backup payload>, selectedTables: [...] | null, restoreUploads: boolean }
    rawData = body.backupData;
    selectedTables = Array.isArray(body.selectedTables) ? body.selectedTables : null;
    restoreUploads = Boolean(body.restoreUploads);
  } else {
    // Legacy direct format (backward compat for direct API calls)
    rawData = body;
    selectedTables = null;
    restoreUploads = false;
  }

  const normalized = normalizeBackupData(rawData);

  if (!normalized || !normalized.tables || !normalized.version) {
    return res.status(400).json({
      error:
        "Ungültiges Backup-Format. Unterstützte Formate: Standard-Backup oder SQL-Export-Array.",
    });
  }

  const { tables, version, uploads } = normalized;

  // Bestimme, welche Tabellen importiert werden sollen (FK-sichere Reihenfolge)
  let tablesToImport;
  if (Array.isArray(selectedTables) && selectedTables.length > 0) {
    const selectedSet = new Set(selectedTables);
    tablesToImport = ALL_TABLES.filter(
      (t) => selectedSet.has(t) && Object.prototype.hasOwnProperty.call(tables, t),
    );
  } else {
    tablesToImport = ALL_TABLES.filter((t) => Object.prototype.hasOwnProperty.call(tables, t));
  }

  logger.info("BACKUP", `Import gestartet (Version: ${version})`, {
    tabellen: tablesToImport,
  });

  const job = createImportTablesJob(tables, tablesToImport, uploads, restoreUploads);
  res.status(202).json({ job: serializeImportTablesJob(job) });
});

router.get("/import-jobs/:jobId", async (req, res) => {
  const job = importTablesJobs.get(req.params.jobId);

  if (!job) {
    return res.status(404).json({ error: "Import-Job nicht gefunden" });
  }

  res.json({ job: serializeImportTablesJob(job) });
});

module.exports = router;
