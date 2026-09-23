const express = require('express');
const router = express.Router();
const db = require('../config/db');
const logger = require('../utils/logger');
const { validate } = require('../middleware/validate');
const { rechnungSchema } = require('../schemas');
const { rechnungsSummen } = require('../utils/rabatt');

function formatJahresNummer(jahr, laufnummer) {
  return `${jahr}-${String(laufnummer).padStart(3, '0')}`;
}

async function getNextRechnungsnummer(queryable) {
  const aktuellesJahr = new Date().getFullYear();
  const { rows: nummerRows } = await queryable.query(
    `SELECT COALESCE(MAX(CAST(SPLIT_PART("Nummer", '-', 2) AS INTEGER)), 0) AS max_num
     FROM "Rechnung"
     WHERE "Nummer" ~ $1`,
    [`^${aktuellesJahr}-[0-9]+$`]
  );

  return formatJahresNummer(aktuellesJahr, Number(nummerRows[0].max_num) + 1);
}

/**
 * @swagger
 * /rechnungen:
 *   get:
 *     summary: Rechnungen abrufen
 *     description: 'Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Rechnungen]
 *     parameters:
 *       - { name: status, in: query, description: Optionaler Filter, schema: { type: string, enum: [entwurf, final] } }
 *     responses:
 *       200:
 *         description: Rechnungsliste (inkl. KundenName)
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 allOf:
 *                   - $ref: '#/components/schemas/Rechnung'
 *                   - type: object
 *                     properties: { KundenName: { type: string, nullable: true } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/', async (req, res) => {
  try {
    const { status } = req.query; // Optional filter: ?status=entwurf or ?status=final
    let query = `SELECT r.*, k."Name" as "KundenName"
       FROM "Rechnung" r
       LEFT JOIN "Kunde" k ON r."Kundennummer" = k."ID"`;
    const params = [];

    if (status) {
      query += ` WHERE r.status = $1`;
      params.push(status);
    }

    query += ` ORDER BY r."Datum" DESC`;

    const { rows } = await db.query(query, params);
    logger.info('RECHNUNGEN', 'Rechnungen geladen', { anzahl: rows.length, status: status || undefined });
    res.json(rows);
  } catch (err) {
    logger.error('RECHNUNGEN', 'Fehler beim Laden der Rechnungen', { message: err.message });
    res.status(500).json({ error: 'Fehler beim Laden der Rechnungen' });
  }
});

/**
 * @swagger
 * /rechnungen/next-number:
 *   get:
 *     summary: Nächste Rechnungsnummer ermitteln
 *     description: 'Format JJJJ-NNN. Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Rechnungen]
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
    const nextNummer = await getNextRechnungsnummer(db);
    res.json({ Nummer: nextNummer });
  } catch (err) {
    logger.error('RECHNUNGEN', 'Fehler beim Ermitteln der nächsten Rechnungsnummer', { message: err.message });
    res.status(500).json({ error: 'Fehler beim Ermitteln der nächsten Rechnungsnummer' });
  }
});

/**
 * @swagger
 * /rechnungen/{id}:
 *   get:
 *     summary: Rechnungs-Detail inkl. zugeordneter Schmuckstücke
 *     description: 'Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Rechnungen]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: Rechnung mit Artikeln
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/Rechnung'
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
      `SELECT r.*, k."Name" as "KundenName", k."Provision"
       FROM "Rechnung" r
       LEFT JOIN "Kunde" k ON r."Kundennummer" = k."ID"
       WHERE r."ID" = $1`,
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Rechnung nicht gefunden' });
    }

    const pieces = await db.query(
      'SELECT * FROM "Schmuckstück" WHERE "Rechnung_ID" = $1 ORDER BY length("Artikelnummer"), "Artikelnummer"',
      [req.params.id]
    );

    // Befund G7: die Auszahlungsaufteilung je Herstellerin wurde im Frontend
    // aus rohen Preisen summiert, ohne Positions- und Gesamtrabatt -- bei 20 %
    // Rabatt zeigte das Modal einen um 20 % zu hohen Betrag. Das ist die Zahl,
    // nach der abgerechnet wird, deshalb kommt sie jetzt aus SQL, in derselben
    // Reihenfolge wie auf dem Beleg.
    const summen = await rechnungsSummen(db, req.params.id);

    res.json({ ...rows[0], schmuckstuecke: pieces.rows, summen });
  } catch (err) {
    logger.error('RECHNUNGEN', 'Fehler beim Laden der Rechnung', { id: req.params.id, message: err.message });
    res.status(500).json({ error: 'Fehler beim Laden der Rechnung' });
  }
});

/**
 * @swagger
 * /rechnungen/{id}/excel:
 *   get:
 *     summary: Rechnung als Excel-Datei herunterladen
 *     description: 'Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Rechnungen]
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
      `SELECT r.*, k.*
       FROM "Rechnung" r
       LEFT JOIN "Kunde" k ON r."Kundennummer" = k."ID"
       WHERE r."ID" = $1`,
      [req.params.id]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Rechnung nicht gefunden' });

    const pieces = await db.query(
      'SELECT * FROM "Schmuckstück" WHERE "Rechnung_ID" = $1 ORDER BY length("Artikelnummer"), "Artikelnummer"',
      [req.params.id]
    );

    // Compute invoice period from Lieferschein dates of the pieces
    const lieferscheinIds = [...new Set(pieces.rows.map(p => p.Lieferschein_ID).filter(id => id > 0))];
    let rechungsZeitraum = null;
    if (lieferscheinIds.length > 0) {
      const lsResult = await db.query(
        `SELECT MIN("Datum") as min_datum, MAX("Datum") as max_datum FROM "Lieferschein" WHERE "ID" = ANY($1::int[])`,
        [lieferscheinIds]
      );
      if (lsResult.rows[0] && lsResult.rows[0].min_datum) {
        const minDate = new Date(lsResult.rows[0].min_datum).toLocaleDateString('de-DE', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        });
        const maxDate = new Date(lsResult.rows[0].max_datum).toLocaleDateString('de-DE', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        });
        rechungsZeitraum = minDate === maxDate ? minDate : `${minDate} bis ${maxDate}`;
      }
    }

    const summen = await rechnungsSummen(db, req.params.id);

    const buffer = await generateExcel('Rechnung', {
      ...rows[0],
      kunde: rows[0],
      rechungsZeitraum,
      summen,
      schmuckstuecke: pieces.rows.sort((a, b) => a.Artikelnummer.localeCompare(b.Artikelnummer, undefined, { numeric: true }))
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Rechnung_${rows[0].Nummer}.xlsx`);
    res.send(buffer);
  } catch (err) {
    logger.error('RECHNUNGEN', 'Excel-Generierung fehlgeschlagen', { id: req.params.id, message: err.message });
    res.status(500).json({ error: 'Excel-Generierung fehlgeschlagen' });
  }
});

/**
 * @swagger
 * /rechnungen:
 *   post:
 *     summary: Rechnung anlegen
 *     description: 'Ohne Nummer wird automatisch die nächste JJJJ-NNN-Nummer vergeben. Bei status=final
 *       werden die enthaltenen Artikel als verkauft markiert (Verkauft=1), bei status=entwurf nur mit
 *       Rechnung_ID verknüpft. Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Rechnungen]
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
 *               rabatt_gesamt: { type: number, minimum: 0, maximum: 100 }
 *               rabatt_positionen:
 *                 type: object
 *                 description: Rabatt je Artikelnummer in Prozent
 *                 additionalProperties: { type: number, minimum: 0, maximum: 100 }
 *                 example: { MHO123_1: 10 }
 *     responses:
 *       201:
 *         description: Rechnung erstellt
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Rechnung' } } }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       409:
 *         description: Rechnungsnummer existiert bereits
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 */
router.post('/', validate(rechnungSchema), async (req, res) => {
  let client;
  try {
    const { Nummer, Artikelnummern, Kundennummer, status = 'entwurf', rabatt_gesamt = 0, rabatt_positionen = {} } = req.body;
    client = await db.connect();
    await client.query('BEGIN');
    await client.query('LOCK TABLE "Rechnung" IN SHARE ROW EXCLUSIVE MODE');

    let rechnungsNummer = String(Nummer || '').trim();
    if (!rechnungsNummer) {
      rechnungsNummer = await getNextRechnungsnummer(client);
    }

    const rabattGesamt = Math.min(100, Math.max(0, Number(rabatt_gesamt) || 0));
    const rabattPositionen = rabatt_positionen && typeof rabatt_positionen === 'object' ? rabatt_positionen : {};

    const { rows } = await client.query(
      `INSERT INTO "Rechnung" ("Nummer", "Kundennummer", status, rabatt_gesamt, rabatt_positionen)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [rechnungsNummer, Kundennummer, status, rabattGesamt, JSON.stringify(rabattPositionen)]
    );

    const rechnungId = rows[0].ID;

    // Always assign Rechnung_ID to track which pieces belong to this document
    // But only set Verkauft flag if status is 'final'
    if (Artikelnummern && Artikelnummern.length > 0) {
      if (status === 'final') {
        await client.query(
          `UPDATE "Schmuckstück" SET "Rechnung_ID" = $1, "Verkauft" = TRUE WHERE "Artikelnummer" = ANY($2::text[])`,
          [rechnungId, Artikelnummern]
        );
      } else {
        // Draft: only set Rechnung_ID, don't change Verkauft
        await client.query(
          `UPDATE "Schmuckstück" SET "Rechnung_ID" = $1 WHERE "Artikelnummer" = ANY($2::text[])`,
          [rechnungId, Artikelnummern]
        );
      }
    }

    await client.query('COMMIT');

    logger.info('RECHNUNGEN', 'Rechnung erstellt', {
      id: rechnungId,
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
        logger.error('RECHNUNGEN', 'Rollback fehlgeschlagen bei Rechnungserstellung', { message: rollbackErr.message });
      }
    }
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Rechnungsnummer existiert bereits' });
    }
    logger.error('RECHNUNGEN', 'Fehler beim Erstellen der Rechnung', { message: err.message });
    res.status(500).json({ error: 'Fehler beim Erstellen der Rechnung' });
  } finally {
    if (client) {
      client.release();
    }
  }
});

/**
 * @swagger
 * /rechnungen/{id}:
 *   put:
 *     summary: Rechnung aktualisieren
 *     description: 'Setzt zuerst alle bisherigen Artikel-Zuordnungen zurück und danach neu (siehe
 *       POST /rechnungen für die Verkauft-Logik nach status). Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Rechnungen]
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
 *               rabatt_gesamt: { type: number, minimum: 0, maximum: 100 }
 *               rabatt_positionen:
 *                 type: object
 *                 additionalProperties: { type: number, minimum: 0, maximum: 100 }
 *     responses:
 *       200:
 *         description: Rechnung aktualisiert
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Rechnung' } } }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
// Wie beim Lieferschein sind Zurücksetzen und Neusetzen ein Vorgang: ohne
// Transaktion stehen nach einem Teilfehler alle Positionen einer finalen
// Rechnung auf Verkauft = 0 und können doppelt verkauft werden (Befund C2).
router.put('/:id', validate(rechnungSchema), async (req, res) => {
  let client;
  try {
    const { Nummer, Artikelnummern, Kundennummer, status, rabatt_gesamt, rabatt_positionen } = req.body;

    // Build update query
    let updateQuery = `UPDATE "Rechnung" SET "Nummer" = $1, "Kundennummer" = $2`;
    const params = [Nummer, Kundennummer];

    if (status !== undefined) {
      updateQuery += `, status = $${params.length + 1}`;
      params.push(status);
    }
    if (rabatt_gesamt !== undefined) {
      updateQuery += `, rabatt_gesamt = $${params.length + 1}`;
      params.push(Math.min(100, Math.max(0, Number(rabatt_gesamt) || 0)));
    }
    if (rabatt_positionen !== undefined) {
      updateQuery += `, rabatt_positionen = $${params.length + 1}`;
      params.push(JSON.stringify(rabatt_positionen && typeof rabatt_positionen === 'object' ? rabatt_positionen : {}));
    }

    updateQuery += ` WHERE "ID" = $${params.length + 1} RETURNING *`;
    params.push(req.params.id);

    client = await db.connect();
    await client.query('BEGIN');

    const { rows } = await client.query(updateQuery, params);
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Rechnung nicht gefunden' });
    }

    const currentStatus = rows[0].status;

    // Always reset old associations first (both Rechnung_ID and Verkauft)
    await client.query(
      `UPDATE "Schmuckstück" SET "Rechnung_ID" = 0, "Verkauft" = FALSE WHERE "Rechnung_ID" = $1`,
      [req.params.id]
    );

    // Set new associations
    if (Artikelnummern && Artikelnummern.length > 0) {
      if (currentStatus === 'final') {
        // Final: set both Rechnung_ID and Verkauft
        await client.query(
          `UPDATE "Schmuckstück" SET "Rechnung_ID" = $1, "Verkauft" = TRUE WHERE "Artikelnummer" = ANY($2::text[])`,
          [req.params.id, Artikelnummern]
        );
      } else {
        // Draft: only set Rechnung_ID, don't change Verkauft
        await client.query(
          `UPDATE "Schmuckstück" SET "Rechnung_ID" = $1 WHERE "Artikelnummer" = ANY($2::text[])`,
          [req.params.id, Artikelnummern]
        );
      }
    }

    await client.query('COMMIT');

    logger.info('RECHNUNGEN', 'Rechnung aktualisiert', { id: req.params.id, status: currentStatus });
    res.json(rows[0]);
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        logger.error('RECHNUNGEN', 'Rollback fehlgeschlagen beim Aktualisieren der Rechnung',
          { id: req.params.id, message: rollbackErr.message });
      }
    }
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Rechnungsnummer existiert bereits' });
    }
    logger.error('RECHNUNGEN', 'Fehler beim Aktualisieren der Rechnung', { id: req.params.id, message: err.message });
    res.status(500).json({ error: 'Fehler beim Aktualisieren der Rechnung' });
  } finally {
    if (client) {
      client.release();
    }
  }
});

/**
 * @swagger
 * /rechnungen/{id}:
 *   delete:
 *     summary: Rechnung löschen
 *     description: 'Setzt Rechnung_ID und Verkauft der zugeordneten Artikel vor dem Löschen zurück.
 *       Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Rechnungen]
 *     security:
 *       - cookieAuth: []
 *         csrfHeader: []
 *       - bearerAuth: []
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: Rechnung gelöscht
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
    // dann auf Verkauft = 0 zurückgesetzt, wenn danach 404 geliefert wurde.
    const { rowCount: vorhanden } = await client.query(
      'SELECT "ID" FROM "Rechnung" WHERE "ID" = $1 FOR UPDATE',
      [req.params.id]
    );
    if (vorhanden === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Rechnung nicht gefunden' });
    }

    // Reset associations before deleting
    await client.query(
      `UPDATE "Schmuckstück" SET "Rechnung_ID" = 0, "Verkauft" = FALSE WHERE "Rechnung_ID" = $1`,
      [req.params.id]
    );
    await client.query(
      'DELETE FROM "Rechnung" WHERE "ID" = $1',
      [req.params.id]
    );

    await client.query('COMMIT');

    logger.info('RECHNUNGEN', 'Rechnung gelöscht', { id: req.params.id });
    res.json({ message: 'Rechnung gelöscht' });
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        logger.error('RECHNUNGEN', 'Rollback fehlgeschlagen beim Löschen der Rechnung',
          { id: req.params.id, message: rollbackErr.message });
      }
    }
    // bestellung.rechnung_nummer verweist mit NO ACTION auf "Rechnung"; ohne
    // diese Abfrage wäre eine noch verknüpfte Rechnung ein generischer 500,
    // dessen Grund der Nutzer nie erfährt (Befund C3).
    if (err.code === '23503') {
      return res.status(409).json({
        error: 'Rechnung ist noch mit einer Bestellung verknüpft und kann nicht gelöscht werden',
      });
    }
    logger.error('RECHNUNGEN', 'Fehler beim Löschen der Rechnung', { id: req.params.id, message: err.message });
    res.status(500).json({ error: 'Fehler beim Löschen der Rechnung' });
  } finally {
    if (client) {
      client.release();
    }
  }
});

module.exports = router;
