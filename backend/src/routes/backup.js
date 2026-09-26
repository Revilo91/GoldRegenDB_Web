const express = require("express");
const router = express.Router();
const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const multer = require("multer");
const AdmZip = require("adm-zip");
const db = require("../config/db");
const logger = require("../utils/logger");
const { validate } = require("../middleware/validate");
const { backupImportSchema } = require("../schemas");

const UPLOADS_DIR = process.env.BACKUP_UPLOADS_DIR
  ? path.resolve(process.env.BACKUP_UPLOADS_DIR)
  : path.resolve(__dirname, "../assets/uploads");
const uploadZip = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});
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

async function importUploadsFromZipBuffer(zipBuffer) {
  if (!zipBuffer || zipBuffer.length === 0) {
    return { restored: 0, skipped: 0 };
  }

  await fs.mkdir(UPLOADS_DIR, { recursive: true });

  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();
  let restored = 0;
  let skipped = 0;

  for (const entry of entries) {
    if (entry.isDirectory) continue;

    const safeName = sanitizeUploadFileName(path.basename(entry.entryName));
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

  return { restored, skipped };
}

// ── Tabellen und Schlüssel aus dem Systemkatalog (Befunde B18, B17, B19) ────
//
// Vorher stand hier eine handgepflegte Liste von sieben Tabellennamen. Sie ließ
// `bestellung`, `bestellung_kunde` und `bestellung_consent` aus – also die
// komplette Bestellübersicht samt der DSGVO-Consent-Nachweise. Ein Export
// "aller Tabellen" war damit unvollständig, und nach einem Import (der mit
// TRUNCATE ... CASCADE beginnt) waren die Nachweise weg, ohne dass es irgendwo
// auffiel. Jede handgeschriebene Liste vergisst irgendwann einen Eintrag;
// deshalb wird sie hier aus `pg_class` abgeleitet und über die echten
// FK-Beziehungen aus `pg_constraint` topologisch sortiert.
const AUDIT_HASH_TRIGGER = "trg_audit_log_hash_chain";

// Kahn: Eltern zuerst. Bei gleicher Bereitschaft alphabetisch, damit die
// Reihenfolge – und damit ein Export – reproduzierbar ist.
function topologischSortieren(tabellen, kanten, aufZyklus) {
  const offen = new Set(tabellen);
  const elternVon = new Map(tabellen.map((t) => [t, new Set()]));
  for (const { kind, eltern } of kanten) {
    if (offen.has(kind) && offen.has(eltern)) elternVon.get(kind).add(eltern);
  }

  const sortiert = [];
  while (offen.size > 0) {
    const bereit = [...offen]
      .filter((t) => [...elternVon.get(t)].every((e) => !offen.has(e)))
      .sort();
    if (bereit.length === 0) {
      // FK-Zyklus: nicht auflösbar, Rest alphabetisch anhängen und melden.
      const rest = [...offen].sort();
      if (aufZyklus) aufZyklus(rest);
      sortiert.push(...rest);
      break;
    }
    for (const t of bereit) {
      sortiert.push(t);
      offen.delete(t);
    }
  }
  return sortiert;
}

// Alles, was Export und Import über das Schema wissen müssen – in einem Aufruf.
async function ermittleSchemaInfo(queryable) {
  const { rows: tabellenZeilen } = await queryable.query(
    `SELECT c.relname AS name
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname`,
  );
  const tabellen = tabellenZeilen.map((r) => r.name);

  const { rows: kanten } = await queryable.query(
    `SELECT src.relname AS kind, ziel.relname AS eltern
       FROM pg_constraint k
       JOIN pg_class src  ON src.oid  = k.conrelid
       JOIN pg_class ziel ON ziel.oid = k.confrelid
       JOIN pg_namespace n ON n.oid = src.relnamespace
      WHERE k.contype = 'f' AND n.nspname = 'public' AND src.oid <> ziel.oid`,
  );

  const { rows: pkZeilen } = await queryable.query(
    `SELECT tc.table_name AS tabelle, kcu.column_name AS spalte
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name
        AND kcu.table_schema    = tc.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema    = 'public'
      ORDER BY tc.table_name, kcu.ordinal_position`,
  );
  const primaerschluessel = new Map();
  for (const { tabelle, spalte } of pkZeilen) {
    if (!primaerschluessel.has(tabelle)) primaerschluessel.set(tabelle, []);
    primaerschluessel.get(tabelle).push(spalte);
  }

  const { rows: spaltenZeilen } = await queryable.query(
    `SELECT table_name  AS tabelle,
            column_name AS spalte,
            data_type   AS typ,
            column_default LIKE 'nextval%' AS hat_sequenz
       FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position`,
  );

  const spalten = new Map();
  for (const zeile of spaltenZeilen) {
    if (!spalten.has(zeile.tabelle)) spalten.set(zeile.tabelle, []);
    spalten.get(zeile.tabelle).push({ name: zeile.spalte, typ: zeile.typ });
  }

  // Befund B17: die setval-Handliste kannte lagerinventur nicht – der nächste
  // Inventur-Entwurf lief nach einem Import so lange in "duplicate key", bis
  // die Sequence aufgeholt hatte.
  const sequenzspalten = spaltenZeilen
    .filter((z) => z.hat_sequenz)
    .map((z) => ({ tabelle: z.tabelle, spalte: z.spalte }));

  const reihenfolge = topologischSortieren(tabellen, kanten, (rest) =>
    logger.warn("BACKUP", "FK-Zyklus im Schema, Reihenfolge unbestimmt", {
      tabellen: rest,
    }),
  );

  return { reihenfolge, kanten, primaerschluessel, sequenzspalten, spalten };
}

// Welche Tabellen räumt `TRUNCATE ... CASCADE` zusätzlich leer, weil sie auf
// eine der ausgewählten zeigen? Ohne diese Warnung ist ein selektiver Import
// von z. B. nur "Kunde" ein stiller Totalverlust der Bestellungen.
function ermittleKaskade(kanten, ausgewaehlt) {
  const betroffen = new Set(ausgewaehlt);
  let gewachsen = true;
  while (gewachsen) {
    gewachsen = false;
    for (const { kind, eltern } of kanten) {
      if (betroffen.has(eltern) && !betroffen.has(kind)) {
        betroffen.add(kind);
        gewachsen = true;
      }
    }
  }
  return [...betroffen].filter((t) => !ausgewaehlt.includes(t)).sort();
}

// `bytea` kommt aus pg als Buffer. Buffer.toJSON() ergibt
// {"type":"Buffer","data":[...]} – eine Zahl samt Komma je Byte, für die Fotos
// in "Foto"/bestellung_foto (Issue #208) rund das Vierfache der Bildgröße.
// Der Export schreibt deshalb {"type":"Buffer","base64":"..."}.
function dbWertZuJson(wert) {
  return Buffer.isBuffer(wert)
    ? { type: "Buffer", base64: wert.toString("base64") }
    : wert;
}

// Beim Import ist ein Buffer ein Objekt, kein Puffer – die verschlüsselten
// Bestellkunden-Felder (name_enc, telefonnummer_enc, …) und Fotos kämen als
// JSON-Text in der Spalte an. Hier zurück in einen Buffer; ältere Backups
// enthalten noch die data-Form.
function jsonWertZuDb(wert) {
  if (wert && typeof wert === "object" && wert.type === "Buffer") {
    if (typeof wert.base64 === "string") return Buffer.from(wert.base64, "base64");
    if (Array.isArray(wert.data)) return Buffer.from(wert.data);
  }
  return wert;
}

// Constraints, die die Datenbank selbst als NOT VALID führt, sind von den
// vorhandenen Zeilen nachweislich nicht erfüllt (hier:
// schmuckstueck_ausschuss_grund_required_chk, 240 Ausschuss-Stücke ohne Grund,
// Befund D7). Ein Import ist ein Wiederherstellen genau dieser Zeilen – als
// INSERT werden sie aber geprüft, und der komplette Import scheitert. Deshalb
// wird ein NOT-VALID-Constraint für die Dauer des Imports entfernt und danach
// wieder als NOT VALID angelegt: dieselbe Reihenfolge, die pg_dump benutzt
// (Daten vor Constraints). Validierte Constraints bleiben in Kraft – Daten, die
// gegen sie verstoßen, können in der Quelle nicht existiert haben.
async function loeseNichtValidierteChecks(client, tabellen) {
  if (tabellen.length === 0) return [];
  const { rows } = await client.query(
    `SELECT c.conrelid::regclass::text AS tabelle,
            c.conname                  AS name,
            pg_get_constraintdef(c.oid) AS definition
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE c.contype = 'c' AND NOT c.convalidated
        AND n.nspname = 'public' AND t.relname = ANY($1::text[])`,
    [tabellen],
  );
  for (const { tabelle, name } of rows) {
    await client.query(`ALTER TABLE ${tabelle} DROP CONSTRAINT "${name}"`);
  }
  if (rows.length > 0) {
    logger.info("BACKUP", "NOT-VALID-Checks für den Import gelöst", {
      constraints: rows.map((r) => r.name),
    });
  }
  return rows;
}

async function stelleChecksWiederHer(client, geloest) {
  for (const { tabelle, name, definition } of geloest) {
    // pg_get_constraintdef liefert die Definition inklusive "NOT VALID".
    const mitNotValid = /NOT VALID\s*$/.test(definition)
      ? definition
      : `${definition} NOT VALID`;
    await client.query(
      `ALTER TABLE ${tabelle} ADD CONSTRAINT "${name}" ${mitNotValid}`,
    );
  }
}

// node-postgres liefert timestamp/date als JS-Date – und ein Date kennt nur
// Millisekunden. Der Export verlor damit die Mikrosekunden jeder Zeile, die die
// laufende Anwendung geschrieben hat (CURRENT_TIMESTAMP liefert sechs Stellen).
// Für audit_log ist das fatal: `change_timestamp::text` geht in den SHA-256 der
// Hash-Kette ein, also meldete `verify_audit_chain()` nach jedem Import
// `hash_mismatch` für genau diese Zeilen – gemessen 29 von 4368, nämlich alle,
// die nicht aus dem Seed stammten. Als ::text exportiert bleibt der Wert exakt,
// und Postgres parst ihn beim Import unverändert zurück.
const ZEITTYPEN = new Set([
  "timestamp without time zone",
  "timestamp with time zone",
  "date",
  "time without time zone",
  "time with time zone",
]);

function selectListe(tabelle, spalten) {
  const liste = spalten.get(tabelle);
  if (!liste || liste.length === 0) return "*";
  return liste
    .map(({ name, typ }) =>
      ZEITTYPEN.has(typ) ? `"${name}"::text AS "${name}"` : `"${name}"`,
    )
    .join(", ");
}

function orderByPk(tabelle, primaerschluessel) {
  const spalten = primaerschluessel.get(tabelle);
  if (!spalten || spalten.length === 0) return "";
  return ` ORDER BY ${spalten.map((c) => `"${c}"`).join(", ")}`;
}

/**
 * @swagger
 * /backup/tables:
 *   get:
 *     summary: Exportierbare Tabellen (aus dem Systemkatalog abgeleitet)
 *     description: 'Liefert die Tabellen in FK-sicherer Reihenfolge samt Zeilenzahl.
 *       Das Frontend baut daraus seine Auswahl, damit keine zweite Handliste gepflegt
 *       werden muss. Erfordert Rolle: admin.'
 *     tags: [Backup]
 *     responses:
 *       200:
 *         description: Tabellenliste
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 tables:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name: { type: string }
 *                       rows: { type: integer }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get("/tables", async (_req, res) => {
  try {
    const { reihenfolge } = await ermittleSchemaInfo(db);
    const tables = [];
    for (const name of reihenfolge) {
      const { rows } = await db.query(`SELECT count(*)::int AS n FROM "${name}"`);
      tables.push({ name, rows: rows[0].n });
    }
    res.json({ tables });
  } catch (err) {
    logger.error("BACKUP", "Fehler beim Ermitteln der Tabellen", {
      message: err.message,
    });
    res.status(500).json({ error: "Fehler beim Ermitteln der Tabellen" });
  }
});

/**
 * @swagger
 * /backup/export:
 *   get:
 *     summary: Alle (oder ausgewählte) Tabellen als JSON exportieren
 *     description: 'Erfordert Rolle: admin.'
 *     tags: [Backup]
 *     parameters:
 *       - name: tables
 *         in: query
 *         description: Kommaseparierte Liste zu exportierender Tabellen, Standard sind alle
 *         schema: { type: string, example: 'Kunde,Lieferschein' }
 *     responses:
 *       200:
 *         description: Backup-JSON-Datei
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 version: { type: string }
 *                 timestamp: { type: string, format: date-time }
 *                 tables: { type: object, additionalProperties: { type: array, items: { type: object } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get("/export", async (req, res) => {
  try {
    // Tabellenliste aus dem Katalog; die Schnittmenge bleibt gleichzeitig die
    // Allowlist, die den Tabellennamen im SELECT unten absichert.
    const { reihenfolge, primaerschluessel, spalten } =
      await ermittleSchemaInfo(db);

    let tablesToExport;
    if (req.query.tables) {
      const requested = req.query.tables
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      tablesToExport = reihenfolge.filter((t) => requested.includes(t));
    } else {
      tablesToExport = reihenfolge;
    }

    const exportData = {
      version: "1.0",
      timestamp: new Date().toISOString(),
      tables: {},
    };

    // Befund B19: ohne ORDER BY liefert der Export Heap-Reihenfolge. Beim
    // Import rechnet der Hash-Trigger `previous_hash`/`hash` anhand der
    // EINFÜGE-Reihenfolge neu, `verify_audit_chain()` prüft aber nach `id` –
    // nach einem VACUUM FULL oder einem Parallel-Seq-Scan meldete die
    // Prüfung dann tausende `chain_broken` für eine Datenbank, an der niemand
    // manipuliert hatte. Sortiert sind Backups außerdem diffbar.
    for (const table of tablesToExport) {
      const result = await db.query(
        `SELECT ${selectListe(table, spalten)} FROM "${table}"` +
          orderByPk(table, primaerschluessel),
      );
      exportData.tables[table] = result.rows.map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([k, v]) => [k, dbWertZuJson(v)]),
        ),
      );
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

/**
 * @swagger
 * /backup/export-uploads:
 *   get:
 *     summary: Foto-Uploads (backend/src/assets/uploads) synchron als ZIP herunterladen
 *     description: 'Für kleine Upload-Verzeichnisse; bei vielen Dateien siehe den asynchronen Job-Flow
 *       über POST /backup/export-uploads-jobs. Erfordert Rolle: admin.'
 *     tags: [Backup]
 *     responses:
 *       200:
 *         description: ZIP-Datei
 *         content:
 *           application/zip:
 *             schema: { type: string, format: binary }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
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
      fileName: err.fileName,
      filePath: err.filePath,
      cause: err.cause?.message,
    });
  }
});

/**
 * @swagger
 * /backup/export-uploads-jobs:
 *   post:
 *     summary: Asynchronen Export-Job für die Foto-Uploads starten
 *     description: 'Fortschritt über GET /backup/export-uploads-jobs/{jobId}, Download nach Abschluss über
 *       GET /backup/export-uploads-jobs/{jobId}/download. Erfordert Rolle: admin.'
 *     tags: [Backup]
 *     security:
 *       - cookieAuth: []
 *         csrfHeader: []
 *       - bearerAuth: []
 *     responses:
 *       202:
 *         description: Job gestartet
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties: { job: { $ref: '#/components/schemas/ExportUploadsJob' } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post("/export-uploads-jobs", async (_req, res) => {
  const job = createExportUploadsJob();
  res.status(202).json({ job: serializeExportJob(job) });
});

/**
 * @swagger
 * /backup/export-uploads-jobs/{jobId}:
 *   get:
 *     summary: Status eines Upload-Export-Jobs abfragen
 *     description: 'Erfordert Rolle: admin.'
 *     tags: [Backup]
 *     parameters:
 *       - { name: jobId, in: path, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Job-Status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties: { job: { $ref: '#/components/schemas/ExportUploadsJob' } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get("/export-uploads-jobs/:jobId", async (req, res) => {
  const job = exportUploadJobs.get(req.params.jobId);

  if (!job) {
    return res.status(404).json({ error: "Export-Job nicht gefunden" });
  }

  res.json({ job: serializeExportJob(job) });
});

/**
 * @swagger
 * /backup/export-uploads-jobs/{jobId}/download:
 *   get:
 *     summary: Fertiges ZIP eines Upload-Export-Jobs herunterladen
 *     description: 'Erfordert Rolle: admin.'
 *     tags: [Backup]
 *     parameters:
 *       - { name: jobId, in: path, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: ZIP-Datei
 *         content:
 *           application/zip:
 *             schema: { type: string, format: binary }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409:
 *         description: Job noch nicht abgeschlossen
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *                 job: { $ref: '#/components/schemas/ExportUploadsJob' }
 */
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

/**
 * @swagger
 * /backup/import-uploads-zip:
 *   post:
 *     summary: Foto-Uploads aus einer ZIP-Datei importieren
 *     description: 'Erfordert Rolle: admin.'
 *     tags: [Backup]
 *     security:
 *       - cookieAuth: []
 *         csrfHeader: []
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [uploadsZip]
 *             properties:
 *               uploadsZip: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: Import abgeschlossen
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 uploads: { type: object }
 *       400:
 *         description: Keine ZIP-Datei hochgeladen
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post(
  "/import-uploads-zip",
  uploadZip.single("uploadsZip"),
  async (req, res) => {
    try {
      if (!req.file || !req.file.buffer) {
        return res.status(400).json({
          error: "Keine ZIP-Datei hochgeladen. Feldname: uploadsZip",
        });
      }

      const result = await importUploadsFromZipBuffer(req.file.buffer);
      res.json({ success: true, uploads: result });
    } catch (err) {
      logger.error("BACKUP", "Fehler beim Importieren der Upload-Bilder", {
        message: err.message,
      });
      res
        .status(500)
        .json({ error: `Fehler beim Importieren der Upload-Bilder: ${err.message}` });
    }
  },
);

/**
 * @swagger
 * /backup/import:
 *   post:
 *     summary: Datenbank aus einem zuvor exportierten JSON-Backup importieren
 *     description: 'Erwartet das Standard-Backup-Format aus GET /backup/export ({ version, tables }).
 *       Ignoriert Spalten, die nicht im aktuellen Schema existieren. Truncatet die betroffenen
 *       Tabellen (RESTART IDENTITY CASCADE) vor dem Neuladen – transaktional, bei Fehler Rollback.
 *       Erfordert Rolle: admin.'
 *     tags: [Backup]
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
 *             properties:
 *               backupData:
 *                 type: object
 *                 description: Backup-JSON im Standard-Format ({ version, timestamp, tables })
 *               selectedTables:
 *                 type: array
 *                 nullable: true
 *                 items: { type: string }
 *                 description: Ohne Angabe werden alle im Backup enthaltenen Tabellen importiert
 *     responses:
 *       200:
 *         description: Import abgeschlossen
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string }
 *                 counts: { type: object, additionalProperties: { type: integer } }
 *                 auditKette:
 *                   type: object
 *                   nullable: true
 *                   description: Ergebnis von verify_audit_chain() nach dem Import
 *                   properties:
 *                     gueltig: { type: boolean }
 *                     kaputteEintraege: { type: array, items: { type: object } }
 *                 kaskadierteTabellen:
 *                   type: array
 *                   items: { type: string }
 *                   description: Tabellen, die TRUNCATE CASCADE zusätzlich geleert hat (nicht Teil der Auswahl)
 *                 ignorierteTabellen:
 *                   type: array
 *                   items: { type: string }
 *                   description: Tabellen aus dem Backup, die es im aktuellen Schema nicht gibt
 *       400:
 *         description: Ungültiges Backup-Format
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post("/import", validate(backupImportSchema), async (req, res) => {
  const { backupData, selectedTables: auswahl } = req.body;

  if (!backupData.version || !backupData.tables || typeof backupData.tables !== "object") {
    return res.status(400).json({
      error:
        "Ungültiges Backup-Format. Erwartet wird ein Backup aus dem Export mit version und tables.",
    });
  }

  const selectedTables = Array.isArray(auswahl) ? auswahl : null;
  const { tables, version } = backupData;

  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");

    // Reihenfolge und Schlüssel aus dem Katalog, nicht aus einer Handliste.
    const { reihenfolge, kanten, sequenzspalten } =
      await ermittleSchemaInfo(client);

    // Was im Backup steht, die Datenbank aber nicht (mehr) kennt, wird nicht
    // still verschluckt, sondern in der Antwort benannt.
    const imBackup = Object.keys(tables);
    const selectedSet =
      Array.isArray(selectedTables) && selectedTables.length > 0
        ? new Set(selectedTables)
        : null;
    const tablesToImport = reihenfolge.filter(
      (t) =>
        Object.prototype.hasOwnProperty.call(tables, t) &&
        (selectedSet === null || selectedSet.has(t)),
    );
    const ignorierteTabellen = imBackup
      .filter((t) => !reihenfolge.includes(t))
      .sort();
    if (ignorierteTabellen.length > 0) {
      logger.warn("BACKUP", "Tabellen im Backup existieren nicht im Schema", {
        tabellen: ignorierteTabellen,
      });
    }

    logger.info("BACKUP", `Import gestartet (Version: ${version})`, {
      tabellen: tablesToImport,
    });

    // Die Tabellennamen stammen aus `reihenfolge`, also aus dem Katalog – sie
    // sind damit gegen eine Allowlist geprüft, bevor sie interpoliert werden.
    // CASCADE leert zusätzlich alles, was auf eine ausgewählte Tabelle zeigt;
    // bei einer Teilauswahl ist das ein Datenverlust, der benannt werden muss.
    const kaskadierteTabellen = ermittleKaskade(kanten, tablesToImport);
    if (kaskadierteTabellen.length > 0) {
      logger.warn("BACKUP", "TRUNCATE CASCADE leert zusätzliche Tabellen", {
        tabellen: kaskadierteTabellen,
      });
    }
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

      // Altbackups aus der Zeit vor schmuck_status_chk enthalten Stücke mit
      // Verkauft UND Ausschuss. Ausschuss gewinnt, wie in statusVon() im Frontend.
      if (tableName === "Schmuckstück") {
        const istWahr = (v) => v === true || v === 1 || v === "1" || v === "t";
        let korrigiert = 0;
        rows = rows.map((row) => {
          if (istWahr(row.Verkauft) && istWahr(row.Ausschuss)) {
            korrigiert++;
            return { ...row, Verkauft: false };
          }
          return row;
        });
        if (korrigiert > 0) {
          logger.warn("BACKUP", "Widersprüchlichen Status beim Import korrigiert", {
            anzahl: korrigiert,
          });
        }
      }

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
          columnsToInsert.map((col) => jsonWertZuDb(row[col])),
        );

        await client.query(
          `INSERT INTO "${tableName}" (${cols}) VALUES ${placeholders}`,
          values,
        );
      }
    };

    // Befund B19: der Hash-Trigger rechnet `previous_hash`/`hash` bei jedem
    // INSERT neu und überschreibt damit die Werte aus dem Backup. Für die
    // Dauer des Imports wird er abgeschaltet, sodass die Original-Hashes
    // erhalten bleiben und `verify_audit_chain()` danach eine Aussage über die
    // gesicherten Daten trifft statt über die Einfügereihenfolge.
    const hashTriggerAktiv =
      tablesToImport.includes("audit_log") &&
      (
        await client.query(
          `SELECT 1 FROM pg_trigger
            WHERE tgrelid = 'audit_log'::regclass AND tgname = $1`,
          [AUDIT_HASH_TRIGGER],
        )
      ).rowCount > 0;
    if (hashTriggerAktiv) {
      await client.query(
        `ALTER TABLE audit_log DISABLE TRIGGER ${AUDIT_HASH_TRIGGER}`,
      );
    }

    const geloesteChecks = await loeseNichtValidierteChecks(
      client,
      tablesToImport,
    );

    // `reihenfolge` ist topologisch sortiert (Eltern zuerst). Das ersetzt das
    // frühere `[...ALL_TABLES].reverse()`, das die FK-Reihenfolge geraten hat.
    //
    // Nicht verwendet: `SET CONSTRAINTS ALL DEFERRED`. Das wirkt in Postgres
    // ausschließlich auf DEFERRABLE deklarierte Constraints – in diesem Schema
    // ist keiner der sechs Fremdschlüssel deferrable (`pg_constraint.
    // condeferrable` ist überall false), die Anweisung wäre also ein No-op mit
    // trügerischer Wirkung. Die echte Sortierung trägt weiter.
    for (const tableName of reihenfolge) {
      if (tablesToImport.includes(tableName)) {
        await insertRows(tableName, tables[tableName]);
      }
    }

    if (hashTriggerAktiv) {
      await client.query(
        `ALTER TABLE audit_log ENABLE TRIGGER ${AUDIT_HASH_TRIGGER}`,
      );
    }

    await stelleChecksWiederHer(client, geloesteChecks);

    // Sequences nachziehen – generisch aus dem Katalog (Befund B17). Tabelle
    // und Spalte sind Parameter, nicht interpoliert; nur der MAX()-Ausdruck
    // braucht den gequoteten Namen, und der stammt aus dem Katalog.
    for (const { tabelle, spalte } of sequenzspalten) {
      if (!tablesToImport.includes(tabelle)) continue;
      await client.query(
        `SELECT setval(
           pg_get_serial_sequence($1, $2),
           COALESCE((SELECT MAX("${spalte}") FROM "${tabelle}"), 0) + 1,
           false)`,
        [`"${tabelle}"`, spalte],
      );
    }

    // Aussage über die importierte Kette, solange die Transaktion offen ist.
    let auditKette = null;
    if (tablesToImport.includes("audit_log")) {
      const { rowCount: pruefungVorhanden } = await client.query(
        `SELECT 1 FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = 'verify_audit_chain'`,
      );
      if (pruefungVorhanden > 0) {
        const { rows: kaputt } = await client.query(
          "SELECT * FROM verify_audit_chain()",
        );
        auditKette = { gueltig: kaputt.length === 0, kaputteEintraege: kaputt };
        if (kaputt.length > 0) {
          logger.warn("BACKUP", "Audit-Kette im Backup ist nicht intakt", {
            anzahl: kaputt.length,
          });
        }
      }
    }

    await client.query("COMMIT");

    const counts = {};
    for (const t of tablesToImport) {
      counts[t] = (tables[t] || []).length;
    }

    res.json({
      success: true,
      message: "Import erfolgreich",
      counts,
      auditKette,
      kaskadierteTabellen,
      ignorierteTabellen,
      geloesteChecks: geloesteChecks.map((c) => c.name),
    });
    logger.info("BACKUP", "Import erfolgreich abgeschlossen", counts);
  } catch (err) {
    if (client) {
      // Befund C29: scheitert das ROLLBACK – typisch bei Verbindungsverlust,
      // also genau im Fehlerfall –, ginge sonst die eigentliche Meldung
      // verloren und der Client wanderte mit offener Transaktion zurück.
      try {
        await client.query("ROLLBACK");
      } catch (rollbackErr) {
        logger.error("BACKUP", "ROLLBACK nach Importfehler fehlgeschlagen", {
          message: rollbackErr.message,
        });
      }
    }
    logger.error("BACKUP", "Fehler beim Importieren", { message: err.message });
    res.status(500).json({ error: `Fehler beim Importieren: ${err.message}` });
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
