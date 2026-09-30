const router = require("express").Router();
const db = require("../../config/db");
const logger = require("../../utils/logger");
const {
  ermittleSchemaInfo,
  dbWertZuJson,
  selectListe,
  orderByPk,
} = require("../../services/backupService");

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

module.exports = router;
