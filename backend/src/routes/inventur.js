const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { generateInventurExcel } = require('../utils/excelService');
const { where } = require('../utils/whereClauseBuilder');
const { preisNachAllenRabattenSql } = require('../utils/rabatt');
const { idParam } = require('../schemas/common');
const logger = require('../utils/logger');

// Die Statusbedingungen kommen aus dem whereClauseBuilder, nicht von Hand
// (Befund F5). Vorher stand in der Übersicht `s."Verkauft" = 1` ohne den
// Ausschuss-Ausschluss: ein Stück mit Verkauft=1 UND Ausschuss=1 zählte in
// beiden Spalten, und `gesamt` war ungleich aktiv + verkauft + ausschuss
// (Befund C19). Beide Endpunkte dieser Datei benutzen jetzt dieselben drei
// Bedingungen. Der Alias 's' ist der Tabellenalias in den Abfragen unten.
const mitAlias = () => where(1, { alias: 's' });
const aktivBedingung = mitAlias().nichtVerkauft().keinAusschuss().buildConditions();
const verkauftBedingung = mitAlias().verkauft().buildConditions();
const ausschussBedingung = mitAlias().ausschuss().buildConditions();

// Befund C18: wert_verkauft summierte rohe Preise, obwohl der Beleg Positions-
// und Gesamtrabatt abzieht -- die Zahl war bei jedem Rabatt zu hoch, und damit
// auch die Provisionsbasis des Kunden. Dieselbe Formel wie fuer Beleg und
// Dashboard, aus utils/rabatt.js.
const verkaufswert = preisNachAllenRabattenSql('s', 'r');

/**
 * @swagger
 * /inventur:
 *   get:
 *     summary: Inventurübersicht aller Kunden mit ausgelagerten Stücken
 *     description: 'Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Inventur]
 *     responses:
 *       200:
 *         description: Ein Eintrag je Kunde mit ausgelagerten Artikeln
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   ID: { type: integer }
 *                   Name: { type: string }
 *                   Ort: { type: string }
 *                   Provision: { type: integer }
 *                   Aktiv: { type: boolean }
 *                   gesamt: { type: integer }
 *                   aktiv: { type: integer }
 *                   verkauft: { type: integer }
 *                   ausschuss: { type: integer }
 *                   wert_aktiv: { type: string, description: 'NUMERIC, von pg als String geliefert' }
 *                   wert_verkauft: { type: string, description: 'nach Positions- und Gesamtrabatt' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT
         k."ID",
         k."Name",
         k."Ort",
         k."Provision",
         k."Aktiv",
         COUNT(s."Artikelnummer")::int AS "gesamt",
         SUM(CASE WHEN ${aktivBedingung}    THEN 1 ELSE 0 END)::int AS "aktiv",
         SUM(CASE WHEN ${verkauftBedingung} THEN 1 ELSE 0 END)::int AS "verkauft",
         SUM(CASE WHEN ${ausschussBedingung} THEN 1 ELSE 0 END)::int AS "ausschuss",
         SUM(CASE WHEN ${aktivBedingung}    THEN COALESCE(s."Verkaufspreis", 0) ELSE 0 END) AS "wert_aktiv",
         round(SUM(CASE WHEN ${verkauftBedingung} THEN ${verkaufswert} ELSE 0 END), 2) AS "wert_verkauft"
       FROM "Kunde" k
       JOIN "Schmuckstück" s ON s."Ausgelagert" = k."ID"
       LEFT JOIN "Rechnung" r ON r."ID" = s."Rechnung_ID"
       GROUP BY k."ID", k."Name", k."Ort", k."Provision", k."Aktiv"
       ORDER BY k."Name"`
    );
    logger.info('INVENTUR', 'Inventur-Übersicht geladen', { anzahl: rows.length });
    res.json(rows);
  } catch (err) {
    logger.error('INVENTUR', 'Fehler beim Laden der Inventur', { message: err.message });
    res.status(500).json({ error: 'Fehler beim Laden der Inventur' });
  }
});

/**
 * @swagger
 * /inventur/{kundeId}:
 *   get:
 *     summary: Inventurdetail für einen Kunden
 *     description: 'Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Inventur]
 *     parameters:
 *       - { name: kundeId, in: path, required: true, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: Kunde, ausgelagerte Artikel und Kennzahlen
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 kunde: { $ref: '#/components/schemas/Kunde' }
 *                 items: { type: array, items: { $ref: '#/components/schemas/Schmuckstueck' } }
 *                 stats:
 *                   type: object
 *                   properties:
 *                     gesamt: { type: integer }
 *                     aktiv: { type: integer }
 *                     verkauft: { type: integer }
 *                     ausschuss: { type: integer }
 *                     wert_aktiv: { type: string, description: 'NUMERIC, von pg als String geliefert' }
 *                     wert_verkauft: { type: string, description: 'nach Positions- und Gesamtrabatt' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:kundeId', async (req, res) => {
  try {
    const { kundeId } = req.params;

    // Befund C25: der Wert ging ungeprueft als $1 in "ID" = $1 und "Ausgelagert"
    // = $1. Ein nicht-numerischer Pfadteil erzeugte damit 22P02 und einen 500er,
    // obwohl es eine Eingabe des Aufrufers ist. Das vorhandene idParam-Schema
    // war da, wurde hier aber nicht benutzt.
    if (!idParam.safeParse(kundeId).success) {
      return res.status(400).json({ error: 'Kundennummer muss eine gültige ID sein' });
    }

    const kundeRes = await db.query(
      'SELECT * FROM "Kunde" WHERE "ID" = $1',
      [kundeId]
    );
    if (kundeRes.rows.length === 0) {
      return res.status(404).json({ error: 'Kunde nicht gefunden' });
    }

    const builder = where(1, { alias: 's' });
    builder.ausgelagert(kundeId);

    const { rows: items } = await db.query(
      `SELECT
         s.*,
         l."Datum" AS "Lieferschein_Datum",
         r."Datum" AS "Rechnung_Datum"
       FROM "Schmuckstück" s
       LEFT JOIN "Lieferschein" l ON l."ID" = s."Lieferschein_ID"
       LEFT JOIN "Rechnung" r ON r."ID" = s."Rechnung_ID"
      ${builder.build()}
       ORDER BY length(s."Artikelnummer"), s."Artikelnummer"`,
      builder.getParams()
    );

    // Die Kennzahlen kommen aus derselben Definition wie in der Übersicht oben
    // und werden in SQL gebildet. Vorher zählte `verkauft` hier
    // Number(i.Verkauft) === 1 ohne den Ausschuss-Ausschluss, also abweichend
    // von CLAUDE.md und von der Übersicht (Befund C19, F5).
    const statsBuilder = where(1, { alias: 's' });
    statsBuilder.ausgelagert(kundeId);
    const { rows: statsRows } = await db.query(
      `SELECT
         COUNT(*)::int AS "gesamt",
         SUM(CASE WHEN ${aktivBedingung}    THEN 1 ELSE 0 END)::int AS "aktiv",
         SUM(CASE WHEN ${verkauftBedingung} THEN 1 ELSE 0 END)::int AS "ausschuss_frei_verkauft",
         SUM(CASE WHEN ${ausschussBedingung} THEN 1 ELSE 0 END)::int AS "ausschuss",
         COALESCE(SUM(CASE WHEN ${aktivBedingung}
                    THEN COALESCE(s."Verkaufspreis", 0) ELSE 0 END), 0) AS "wert_aktiv",
         round(COALESCE(SUM(CASE WHEN ${verkauftBedingung}
                    THEN ${verkaufswert} ELSE 0 END), 0), 2) AS "wert_verkauft"
       FROM "Schmuckstück" s
       LEFT JOIN "Rechnung" r ON r."ID" = s."Rechnung_ID"
       ${statsBuilder.build()}`,
      statsBuilder.getParams()
    );
    const roh = statsRows[0];
    const stats = {
      gesamt: roh.gesamt,
      aktiv: roh.aktiv || 0,
      verkauft: roh.ausschuss_frei_verkauft || 0,
      ausschuss: roh.ausschuss || 0,
      wert_aktiv: roh.wert_aktiv,
      wert_verkauft: roh.wert_verkauft,
    };

    res.json({ kunde: kundeRes.rows[0], items, stats });
  } catch (err) {
    logger.error('INVENTUR', 'Fehler beim Laden der Inventur für Kunde', { id: req.params.kundeId, message: err.message });
    res.status(500).json({ error: 'Fehler beim Laden der Inventur' });
  }
});

/**
 * @swagger
 * /inventur/{kundeId}/excel:
 *   get:
 *     summary: Inventur eines Kunden als Excel-Datei herunterladen
 *     description: 'Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Inventur]
 *     parameters:
 *       - { name: kundeId, in: path, required: true, schema: { type: integer } }
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
router.get('/:kundeId/excel', async (req, res) => {
  try {
    const { kundeId } = req.params;

    // Befund C25: der Wert ging ungeprueft als $1 in "ID" = $1 und "Ausgelagert"
    // = $1. Ein nicht-numerischer Pfadteil erzeugte damit 22P02 und einen 500er,
    // obwohl es eine Eingabe des Aufrufers ist. Das vorhandene idParam-Schema
    // war da, wurde hier aber nicht benutzt.
    if (!idParam.safeParse(kundeId).success) {
      return res.status(400).json({ error: 'Kundennummer muss eine gültige ID sein' });
    }

    const kundeRes = await db.query(
      'SELECT * FROM "Kunde" WHERE "ID" = $1',
      [kundeId]
    );
    if (kundeRes.rows.length === 0) {
      return res.status(404).json({ error: 'Kunde nicht gefunden' });
    }

    const builder = where();
    builder.ausgelagert(kundeId);

    const { rows: items } = await db.query(
      `SELECT
         s.*,
         l."Datum" AS "Lieferschein_Datum",
         r."Datum" AS "Rechnung_Datum"
       FROM "Schmuckstück" s
       LEFT JOIN "Lieferschein" l ON l."ID" = s."Lieferschein_ID"
       LEFT JOIN "Rechnung" r ON r."ID" = s."Rechnung_ID"
      ${builder.build()}
       ORDER BY length(s."Artikelnummer"), s."Artikelnummer"`,
      builder.getParams()
    );

    const kunde = kundeRes.rows[0];

    const buffer = await generateInventurExcel(kunde, items);

    const safeName = String(kunde.Name || kundeId).replace(/[\\/:*?"<>|]+/g, '_');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Inventur_${safeName}.xlsx"`);
    logger.info('INVENTUR', 'Excel-Export erstellt', { id: kundeId, artikelAnzahl: items.length });
    res.send(buffer);
  } catch (err) {
    logger.error('INVENTUR', 'Fehler beim Excel-Export für Kunde', { id: req.params.kundeId, message: err.message });
    res.status(500).json({ error: 'Fehler beim Erstellen des Excel-Exports' });
  }
});

module.exports = router;
