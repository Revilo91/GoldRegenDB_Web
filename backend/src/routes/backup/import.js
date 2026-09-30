const router = require("express").Router();
const db = require("../../config/db");
const logger = require("../../utils/logger");
const { validate } = require("../../middleware/validate");
const { backupImportSchema } = require("../../schemas");
const {
  AUDIT_HASH_TRIGGER,
  ermittleSchemaInfo,
  ermittleKaskade,
  jsonWertZuDb,
  loeseNichtValidierteChecks,
  stelleChecksWiederHer,
} = require("../../services/backupService");

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
