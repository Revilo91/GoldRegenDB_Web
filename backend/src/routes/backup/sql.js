const router = require("express").Router();
const db = require("../../config/db");
const logger = require("../../utils/logger");
const {
  AUDIT_HASH_TRIGGER,
  ermittleSchemaInfo,
  ermittleNichtValidierteChecks,
  checkWiederAnlegen,
  orderByPk,
} = require("../../services/backupService");

// COPY-Textformat: NULL als \N, Backslash, Tab und Zeilenumbrüche maskiert.
const copyFeld = (wert) =>
  wert === null
    ? "\\N"
    : wert.replace(/[\\\t\n\r]/g, (z) =>
        ({ "\\": "\\\\", "\t": "\\t", "\n": "\\n", "\r": "\\r" })[z],
      );

const quote = (name) => `"${name.replace(/"/g, '""')}"`;
const literal = (text) => `'${text.replace(/'/g, "''")}'`;

/**
 * @swagger
 * /backup/export-sql:
 *   get:
 *     summary: Alle (oder ausgewählte) Tabellen als SQL-Dump exportieren (nur Daten)
 *     description: 'COPY-Blöcke wie bei pg_dump, eingerahmt von TRUNCATE, Trigger-/Constraint-Behandlung
 *       und setval in einer Transaktion. Einspielen über die Datensicherung oder per
 *       psql in eine Datenbank mit aktuellem Schema. Fotos sind nicht enthalten. Erfordert Rolle: admin.'
 *     tags: [Backup]
 *     parameters:
 *       - name: tables
 *         in: query
 *         description: Kommaseparierte Liste zu exportierender Tabellen, Standard sind alle
 *         schema: { type: string, example: 'Kunde,Lieferschein' }
 *     responses:
 *       200:
 *         description: SQL-Datei
 *         content:
 *           application/sql:
 *             schema: { type: string }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get("/export-sql", async (req, res) => {
  let client;
  try {
    client = await db.connect();
    // Ein Snapshot für alle Tabellen, sonst passen die FKs im Dump nicht zusammen.
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const { reihenfolge, primaerschluessel, spalten, sequenzspalten } =
      await ermittleSchemaInfo(client);

    const angefragt = req.query.tables
      ? req.query.tables.split(",").map((t) => t.trim()).filter(Boolean)
      : null;
    const tabellen = angefragt
      ? reihenfolge.filter((t) => angefragt.includes(t))
      : reihenfolge;

    const hashTrigger =
      tabellen.includes("audit_log") &&
      (
        await client.query(
          `SELECT 1 FROM pg_trigger
            WHERE tgrelid = 'audit_log'::regclass AND tgname = $1`,
          [AUDIT_HASH_TRIGGER],
        )
      ).rowCount > 0;
    const checks = await ermittleNichtValidierteChecks(client, tabellen);

    const zeitstempel = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    res.setHeader("Content-Type", "application/sql; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="goldregendb_dump_${zeitstempel}.sql"`,
    );

    res.write(
      `-- GoldRegenDB SQL-Dump (nur Daten), erstellt ${new Date().toISOString()}\n` +
        "-- Einspielen: Datensicherung → Daten importieren, oder\n" +
        "--   psql -v ON_ERROR_STOP=1 -d <datenbank> -f <datei>  (Schema muss existieren)\n" +
        "-- Fotos sind nicht enthalten, sie werden als Foto-ZIP gesichert.\n\n" +
        "SET client_encoding = 'UTF8';\nSET standard_conforming_strings = on;\n\nBEGIN;\n\n",
    );
    if (tabellen.length > 0) {
      res.write(
        `TRUNCATE TABLE ${tabellen.map(quote).join(", ")} RESTART IDENTITY CASCADE;\n`,
      );
    }
    if (hashTrigger) {
      res.write(`ALTER TABLE audit_log DISABLE TRIGGER ${AUDIT_HASH_TRIGGER};\n`);
    }
    for (const { tabelle, name } of checks) {
      res.write(`ALTER TABLE ${tabelle} DROP CONSTRAINT ${quote(name)};\n`);
    }

    // Alle Spalten als ::text: das ist genau die Darstellung, die COPY erwartet
    // (Zeitstempel mit Mikrosekunden, bytea als \x…, Booleans als t/f).
    for (const tabelle of tabellen) {
      const namen = (spalten.get(tabelle) || []).map((s) => s.name);
      const { rows } = await client.query({
        text:
          `SELECT ${namen.map((n) => `${quote(n)}::text`).join(", ")} FROM ${quote(tabelle)}` +
          orderByPk(tabelle, primaerschluessel),
        rowMode: "array",
      });
      res.write(
        `\nCOPY ${quote(tabelle)} (${namen.map(quote).join(", ")}) FROM stdin;\n`,
      );
      for (const zeile of rows) {
        res.write(`${zeile.map(copyFeld).join("\t")}\n`);
      }
      res.write("\\.\n");
    }

    res.write("\n");
    if (hashTrigger) {
      res.write(`ALTER TABLE audit_log ENABLE TRIGGER ${AUDIT_HASH_TRIGGER};\n`);
    }
    for (const check of checks) res.write(`${checkWiederAnlegen(check)};\n`);
    for (const { tabelle, spalte } of sequenzspalten) {
      if (!tabellen.includes(tabelle)) continue;
      res.write(
        `SELECT setval(pg_get_serial_sequence(${literal(quote(tabelle))}, ${literal(spalte)}), ` +
          `COALESCE((SELECT MAX(${quote(spalte)}) FROM ${quote(tabelle)}), 0) + 1, false);\n`,
      );
    }
    res.end("\nCOMMIT;\n");
    logger.info("BACKUP", "SQL-Dump exportiert", { tabellen });
  } catch (err) {
    logger.error("BACKUP", "Fehler beim SQL-Export", { message: err.message });
    if (!res.headersSent) {
      res.status(500).json({ error: "Fehler beim SQL-Export" });
    } else {
      res.destroy();
    }
  } finally {
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

module.exports = router;
