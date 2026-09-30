const router = require("express").Router();
const fs = require("fs/promises");
const os = require("os");
const { pipeline } = require("stream/promises");
const { randomUUID } = require("crypto");
const multer = require("multer");
const db = require("../../config/db");
const logger = require("../../utils/logger");
const { erstelleFotoZip, importiereFotoZip } = require("../../utils/fotoZip");

const JOB_TTL_MS = 30 * 60 * 1000;
// Das Foto-ZIP geht auf die Platte, nicht in den Speicher: rund 1,6 GB.
const fotoZipUpload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 10 * 1024 * 1024 * 1024 },
});
const fotoImportJobs = new Map();

/**
 * @swagger
 * /backup/export-fotos:
 *   get:
 *     summary: Alle Fotos aus der Datenbank als ZIP herunterladen (gestreamt)
 *     description: 'Einträge schmuckstueck/<Artikelnummer>.<endung> und bestellung/<datei_name>.<endung>,
 *       unkomprimiert. Die JSON-Sicherung enthält die Foto-Tabellen nicht. Erfordert Rolle: admin.'
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
router.get("/export-fotos", async (req, res) => {
  const abbruch = new AbortController();
  let client;
  try {
    client = await db.connect();
    // Liste und Bilddaten aus einem Snapshot: sonst passt die angekündigte
    // Größe eines während des Downloads geänderten Fotos nicht mehr.
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const { stream, anzahl, groesse } = await erstelleFotoZip(client, abbruch.signal);

    const zeitstempel = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="goldregendb_fotos_${zeitstempel}.zip"`,
    );
    res.setHeader("Content-Length", groesse);
    await pipeline(stream, res);
    logger.info("BACKUP", "Foto-ZIP exportiert", { anzahl, groesse });
  } catch (err) {
    if (err.code === "ERR_STREAM_PREMATURE_CLOSE") {
      logger.warn("BACKUP", "Foto-ZIP-Download vom Client abgebrochen");
    } else {
      logger.error("BACKUP", "Fehler beim Exportieren der Fotos", { message: err.message });
    }
    if (!res.headersSent) {
      res.status(500).json({ error: "Fehler beim Exportieren der Fotos" });
    } else {
      res.destroy();
    }
  } finally {
    abbruch.abort();
    if (client) {
      try {
        await client.query("COMMIT");
        client.release();
      } catch (commitErr) {
        client.release(commitErr);
      }
    }
  }
});

/**
 * @swagger
 * /backup/import-fotos-zip:
 *   post:
 *     summary: Fotos aus einem Foto-ZIP in die Datenbank übernehmen (asynchroner Job)
 *     description: 'Erwartet das Format aus GET /backup/export-fotos. Vorhandene Fotos mit gleichem
 *       Schlüssel werden überschrieben, andere bleiben erhalten. Die Antwort kommt nach dem Upload;
 *       den Fortschritt liefert GET /backup/import-fotos-jobs/{jobId}. Erfordert Rolle: admin.'
 *     tags: [Backup]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               fotosZip: { type: string, format: binary }
 *     responses:
 *       202:
 *         description: Import gestartet
 *       400:
 *         description: Keine ZIP-Datei hochgeladen
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post("/import-fotos-zip", fotoZipUpload.single("fotosZip"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Keine ZIP-Datei hochgeladen. Feldname: fotosZip" });
  }

  const job = {
    id: randomUUID(),
    status: "running",
    gesamt: 0,
    verarbeitet: 0,
    gespeichert: { schmuckstueck: 0, bestellung: 0 },
    uebersprungen: 0,
    uebersprungenDetails: [],
    fehler: null,
  };
  fotoImportJobs.set(job.id, job);

  importiereFotoZip(req.file.path, db, (stand) => Object.assign(job, stand))
    .then(() => {
      job.status = "completed";
      logger.info("BACKUP", "Foto-ZIP importiert", {
        gespeichert: job.gespeichert,
        uebersprungen: job.uebersprungen,
      });
      if (job.uebersprungen > 0) {
        logger.warn("BACKUP", "Fotos beim Import übersprungen", {
          details: job.uebersprungenDetails,
        });
      }
    })
    .catch((err) => {
      job.status = "failed";
      job.fehler = err.message;
      logger.error("BACKUP", "Fehler beim Importieren der Fotos", { message: err.message });
    })
    .finally(() => {
      fs.rm(req.file.path, { force: true }).catch(() => {});
      setTimeout(() => fotoImportJobs.delete(job.id), JOB_TTL_MS).unref();
    });

  res.status(202).json({ job });
});

/**
 * @swagger
 * /backup/import-fotos-jobs/{jobId}:
 *   get:
 *     summary: Fortschritt eines Foto-Imports
 *     description: 'status ist running, completed oder failed. Erfordert Rolle: admin.'
 *     tags: [Backup]
 *     parameters:
 *       - { name: jobId, in: path, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Job-Stand
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get("/import-fotos-jobs/:jobId", (req, res) => {
  const job = fotoImportJobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: "Import-Job nicht gefunden" });
  }
  res.json({ job });
});

module.exports = router;
