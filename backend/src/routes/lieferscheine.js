const express = require('express');
const router = express.Router();
const db = require('../config/db');
const logger = require('../utils/logger');
const { validate } = require('../middleware/validate');
const { lieferscheinSchema } = require('../schemas');

function formatJahresNummer(jahr, laufnummer) {
  return `${jahr}-${String(laufnummer).padStart(3, '0')}`;
}

async function getNextLieferscheinnummer(queryable) {
  const aktuellesJahr = new Date().getFullYear();
  const { rows: nummerRows } = await queryable.query(
    `SELECT COALESCE(MAX(CAST(SPLIT_PART("Nummer", '-', 2) AS INTEGER)), 0) AS max_num
     FROM "Lieferschein"
     WHERE "Nummer" ~ $1`,
    [`^${aktuellesJahr}-[0-9]+$`]
  );

  return formatJahresNummer(aktuellesJahr, Number(nummerRows[0].max_num) + 1);
}

/**
 * @swagger
 * /lieferscheine:
 *   get:
 *     summary: Lieferscheine abrufen
 *     description: 'Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Lieferscheine]
 *     parameters:
 *       - { name: status, in: query, description: Optionaler Filter, schema: { type: string, enum: [entwurf, final] } }
 *     responses:
 *       200:
 *         description: Lieferscheinliste (inkl. KundenName)
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 allOf:
 *                   - $ref: '#/components/schemas/Lieferschein'
 *                   - type: object
 *                     properties: { KundenName: { type: string, nullable: true } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/', async (req, res) => {
  try {
    const { status } = req.query; // Optional filter: ?status=entwurf or ?status=final
    let query = `SELECT l.*, k."Name" as "KundenName"
       FROM "Lieferschein" l
       LEFT JOIN "Kunde" k ON l."Kundennummer" = k."ID"`;
    const params = [];

    if (status) {
      query += ` WHERE l.status = $1`;
      params.push(status);
    }

    query += ` ORDER BY l."Datum" DESC`;

    const { rows } = await db.query(query, params);
    logger.info('LIEFERSCHEINE', 'Lieferscheine geladen', { anzahl: rows.length, status: status || undefined });
    res.json(rows);
  } catch (err) {
    logger.error('LIEFERSCHEINE', 'Fehler beim Laden der Lieferscheine', { message: err.message });
    res.status(500).json({ error: 'Fehler beim Laden der Lieferscheine' });
  }
});

/**
 * @swagger
 * /lieferscheine/next-number:
 *   get:
 *     summary: Nächste Lieferscheinnummer ermitteln
 *     description: 'Format JJJJ-NNN. Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Lieferscheine]
 *     responses:
 *       200:
 *         description: Nächste Nummer
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties: { Nummer: { type: string, example: '2026-001' } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/next-number', async (_req, res) => {
  try {
    const nextNummer = await getNextLieferscheinnummer(db);
    res.json({ Nummer: nextNummer });
  } catch (err) {
    logger.error('LIEFERSCHEINE', 'Fehler beim Ermitteln der nächsten Lieferscheinnummer', { message: err.message });
    res.status(500).json({ error: 'Fehler beim Ermitteln der nächsten Lieferscheinnummer' });
  }
});

/**
 * @swagger
 * /lieferscheine/{id}:
 *   get:
 *     summary: Lieferschein-Detail inkl. zugeordneter Schmuckstücke
 *     description: 'Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Lieferscheine]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: Lieferschein mit Artikeln
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/Lieferschein'
 *                 - type: object
 *                   properties:
 *                     KundenName: { type: string, nullable: true }
 *                     Provision: { type: integer, nullable: true }
 *                     schmuckstuecke: { type: array, items: { $ref: '#/components/schemas/Schmuckstueck' } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT l.*, k."Name" as "KundenName", k."Provision"
       FROM "Lieferschein" l
       LEFT JOIN "Kunde" k ON l."Kundennummer" = k."ID"
       WHERE l."ID" = $1`,
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Lieferschein nicht gefunden' });
    }

    // Get associated jewelry pieces
    const pieces = await db.query(
      'SELECT * FROM "Schmuckstück" WHERE "Lieferschein_ID" = $1 ORDER BY length("Artikelnummer"), "Artikelnummer"',
      [req.params.id]
    );

    res.json({ ...rows[0], schmuckstuecke: pieces.rows });
  } catch (err) {
    logger.error('LIEFERSCHEINE', 'Fehler beim Laden des Lieferscheins', { id: req.params.id, message: err.message });
    res.status(500).json({ error: 'Fehler beim Laden des Lieferscheins' });
  }
});

/**
 * @swagger
 * /lieferscheine/{id}/excel:
 *   get:
 *     summary: Lieferschein als Excel-Datei herunterladen
 *     description: 'Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Lieferscheine]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: XLSX-Datei
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema: { type: string, format: binary }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
const { generateExcel } = require('../utils/excelService');
router.get('/:id/excel', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT l.*, k.*
       FROM "Lieferschein" l
       LEFT JOIN "Kunde" k ON l."Kundennummer" = k."ID"
       WHERE l."ID" = $1`,
      [req.params.id]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Lieferschein nicht gefunden' });

    const pieces = await db.query(
      'SELECT * FROM "Schmuckstück" WHERE "Lieferschein_ID" = $1 ORDER BY length("Artikelnummer"), "Artikelnummer"',
      [req.params.id]
    );

    const buffer = await generateExcel('Lieferschein', {
      ...rows[0],
      kunde: rows[0], // rows[0] contains both l and k fields
      schmuckstuecke: pieces.rows.sort((a, b) => a.Artikelnummer.localeCompare(b.Artikelnummer, undefined, { numeric: true }))
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Lieferschein_${rows[0].Nummer}.xlsx`);
    res.send(buffer);
  } catch (err) {
    logger.error('LIEFERSCHEINE', 'Excel-Generierung fehlgeschlagen', { id: req.params.id, message: err.message });
    res.status(500).json({ error: 'Excel-Generierung fehlgeschlagen' });
  }
});

/**
 * @swagger
 * /lieferscheine:
 *   post:
 *     summary: Lieferschein anlegen
 *     description: 'Ohne Nummer wird automatisch die nächste JJJJ-NNN-Nummer vergeben. Bei status=final
 *       werden die enthaltenen Artikel als beim Kunden ausgelagert markiert (Ausgelagert=Kundennummer),
 *       bei status=entwurf nur mit Lieferschein_ID verknüpft. Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Lieferscheine]
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
 *             required: [Kundennummer]
 *             properties:
 *               Nummer: { type: string, maxLength: 20, description: 'Optional, wird sonst automatisch vergeben' }
 *               Kundennummer: { type: integer, minimum: 1 }
 *               Artikelnummern:
 *                 type: array
 *                 items: { type: string, example: MHO123_1 }
 *                 maxItems: 1000
 *               status: { type: string, enum: [entwurf, final], default: entwurf }
 *     responses:
 *       201:
 *         description: Lieferschein erstellt
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Lieferschein' } } }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       409:
 *         description: Lieferscheinnummer existiert bereits
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 */
router.post('/', validate(lieferscheinSchema), async (req, res) => {
  let client;
  try {
    const { Nummer, Artikelnummern, Kundennummer, status = 'entwurf' } = req.body;
    client = await db.connect();
    await client.query('BEGIN');
    await client.query('LOCK TABLE "Lieferschein" IN SHARE ROW EXCLUSIVE MODE');

    let lieferscheinNummer = String(Nummer || '').trim();
    if (!lieferscheinNummer) {
      lieferscheinNummer = await getNextLieferscheinnummer(client);
    }

    const { rows } = await client.query(
      `INSERT INTO "Lieferschein" ("Nummer", "Kundennummer", status)
       VALUES ($1, $2, $3) RETURNING *`,
      [lieferscheinNummer, Kundennummer, status]
    );

    const lieferscheinId = rows[0].ID;

    // Always assign Lieferschein_ID to track which pieces belong to this document
    // But only set Ausgelagert flag if status is 'final'
    if (Artikelnummern && Artikelnummern.length > 0) {
      if (status === 'final') {
        await client.query(
          `UPDATE "Schmuckstück" SET "Lieferschein_ID" = $1, "Ausgelagert" = $2 WHERE "Artikelnummer" = ANY($3::text[])`,
          [lieferscheinId, parseInt(Kundennummer), Artikelnummern]
        );
      } else {
        // Draft: only set Lieferschein_ID, don't change Ausgelagert
        await client.query(
          `UPDATE "Schmuckstück" SET "Lieferschein_ID" = $1 WHERE "Artikelnummer" = ANY($2::text[])`,
          [lieferscheinId, Artikelnummern]
        );
      }
    }

    await client.query('COMMIT');

    logger.info('LIEFERSCHEINE', 'Lieferschein erstellt', {
      id: lieferscheinId,
      nummer: rows[0].Nummer,
      status,
      artikelAnzahl: Artikelnummern?.length || 0,
    });
    res.status(201).json(rows[0]);
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        logger.error('LIEFERSCHEINE', 'Rollback fehlgeschlagen bei Lieferscheinerstellung', { message: rollbackErr.message });
      }
    }
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Lieferscheinnummer existiert bereits' });
    }
    logger.error('LIEFERSCHEINE', 'Fehler beim Erstellen des Lieferscheins', { message: err.message });
    res.status(500).json({ error: 'Fehler beim Erstellen des Lieferscheins' });
  } finally {
    if (client) {
      client.release();
    }
  }
});

/**
 * @swagger
 * /lieferscheine/{id}:
 *   put:
 *     summary: Lieferschein aktualisieren
 *     description: 'Setzt zuerst alle bisherigen Artikel-Zuordnungen zurück und danach neu (siehe
 *       POST /lieferscheine für die Ausgelagert-Logik nach status). Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Lieferscheine]
 *     security:
 *       - cookieAuth: []
 *         csrfHeader: []
 *       - bearerAuth: []
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [Kundennummer]
 *             properties:
 *               Nummer: { type: string, maxLength: 20 }
 *               Kundennummer: { type: integer, minimum: 1 }
 *               Artikelnummern: { type: array, items: { type: string } }
 *               status: { type: string, enum: [entwurf, final] }
 *     responses:
 *       200:
 *         description: Lieferschein aktualisiert
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Lieferschein' } } }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
// Zurücksetzen und Neusetzen der Positionen sind ein Vorgang: scheitert der
// zweite Schritt ohne Transaktion, stehen alle Stücke auf Ausgelagert = 0,
// obwohl sie beim Kunden liegen (Befund C1).
router.put('/:id', validate(lieferscheinSchema), async (req, res) => {
  let client;
  try {
    const { Nummer, Artikelnummern, Kundennummer, status } = req.body;

    // Build update query
    let updateQuery = `UPDATE "Lieferschein" SET "Nummer" = $1, "Kundennummer" = $2`;
    const params = [Nummer, Kundennummer];

    if (status !== undefined) {
      updateQuery += `, status = $${params.length + 1}`;
      params.push(status);
    }

    updateQuery += ` WHERE "ID" = $${params.length + 1} RETURNING *`;
    params.push(req.params.id);

    client = await db.connect();
    await client.query('BEGIN');

    const { rows } = await client.query(updateQuery, params);
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Lieferschein nicht gefunden' });
    }

    const currentStatus = rows[0].status;

    // Always reset old associations first (both Lieferschein_ID and Ausgelagert)
    await client.query(
      `UPDATE "Schmuckstück" SET "Lieferschein_ID" = 0, "Ausgelagert" = 0 WHERE "Lieferschein_ID" = $1`,
      [req.params.id]
    );

    // Set new associations
    if (Artikelnummern && Artikelnummern.length > 0) {
      if (currentStatus === 'final') {
        // Final: set both Lieferschein_ID and Ausgelagert
        await client.query(
          `UPDATE "Schmuckstück" SET "Lieferschein_ID" = $1, "Ausgelagert" = $2 WHERE "Artikelnummer" = ANY($3::text[])`,
          [req.params.id, parseInt(Kundennummer), Artikelnummern]
        );
      } else {
        // Draft: only set Lieferschein_ID, don't change Ausgelagert
        await client.query(
          `UPDATE "Schmuckstück" SET "Lieferschein_ID" = $1 WHERE "Artikelnummer" = ANY($2::text[])`,
          [req.params.id, Artikelnummern]
        );
      }
    }

    await client.query('COMMIT');

    logger.info('LIEFERSCHEINE', 'Lieferschein aktualisiert', { id: req.params.id, status: currentStatus });
    res.json(rows[0]);
  } catch (err) {
    if (client) {
      // Eigenes try: scheitert das ROLLBACK (typisch bei Verbindungsverlust,
      // also genau im Fehlerfall), ginge die eigentliche Meldung sonst
      // verloren (Befund C29).
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        logger.error('LIEFERSCHEINE', 'Rollback fehlgeschlagen beim Aktualisieren des Lieferscheins',
          { id: req.params.id, message: rollbackErr.message });
      }
    }
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Lieferscheinnummer existiert bereits' });
    }
    logger.error('LIEFERSCHEINE', 'Fehler beim Aktualisieren des Lieferscheins', { id: req.params.id, message: err.message });
    res.status(500).json({ error: 'Fehler beim Aktualisieren des Lieferscheins' });
  } finally {
    if (client) {
      client.release();
    }
  }
});

/**
 * @swagger
 * /lieferscheine/{id}:
 *   delete:
 *     summary: Lieferschein löschen
 *     description: 'Setzt Lieferschein_ID und Ausgelagert der zugeordneten Artikel vor dem Löschen zurück.
 *       Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Lieferscheine]
 *     security:
 *       - cookieAuth: []
 *         csrfHeader: []
 *       - bearerAuth: []
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: Lieferschein gelöscht
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.delete('/:id', async (req, res) => {
  let client;
  try {
    client = await db.connect();
    await client.query('BEGIN');

    // Existenz zuerst prüfen (Befund C3): vorher wurden die Positionen auch
    // dann zurückgesetzt, wenn danach 404 geliefert wurde. FOR UPDATE sperrt
    // die Zeile gegen ein parallel laufendes DELETE.
    const { rowCount: vorhanden } = await client.query(
      'SELECT "ID" FROM "Lieferschein" WHERE "ID" = $1 FOR UPDATE',
      [req.params.id]
    );
    if (vorhanden === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Lieferschein nicht gefunden' });
    }

    // Reset associations before deleting
    await client.query(
      `UPDATE "Schmuckstück" SET "Lieferschein_ID" = 0, "Ausgelagert" = 0 WHERE "Lieferschein_ID" = $1`,
      [req.params.id]
    );
    await client.query(
      'DELETE FROM "Lieferschein" WHERE "ID" = $1',
      [req.params.id]
    );

    await client.query('COMMIT');

    logger.info('LIEFERSCHEINE', 'Lieferschein gelöscht', { id: req.params.id });
    res.json({ message: 'Lieferschein gelöscht' });
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        logger.error('LIEFERSCHEINE', 'Rollback fehlgeschlagen beim Löschen des Lieferscheins',
          { id: req.params.id, message: rollbackErr.message });
      }
    }
    if (err.code === '23503') {
      return res.status(409).json({ error: 'Lieferschein ist noch verknüpft und kann nicht gelöscht werden' });
    }
    logger.error('LIEFERSCHEINE', 'Fehler beim Löschen des Lieferscheins', { id: req.params.id, message: err.message });
    res.status(500).json({ error: 'Fehler beim Löschen des Lieferscheins' });
  } finally {
    if (client) {
      client.release();
    }
  }
});

module.exports = router;
