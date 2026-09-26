const express = require('express');
const path = require('path');
const router = express.Router();
const db = require('../config/db');
const logger = require('../utils/logger');
const { requireAdmin } = require('../middleware/auth');
const {
  getNextBestellnummer,
  toBestellungResponse,
  validateDatenminimierung,
  insertBestellung,
} = require('../utils/bestellungService');
const {
  leseDataUrl,
  neuerBestellungFotoName,
  speichereFoto,
  loescheFoto,
  sendeFoto,
} = require('../utils/fotoService');

// Übergang bis zum Bilderimport (Issue #209): Referenzfotos aus der Zeit vor
// Issue #208 liegen noch als Datei hier.
const LEGACY_FOTO_DIR = path.join(__dirname, '../assets/uploads/bestellungen');
const { encryptField } = require('../utils/encryptionService');
const { validate } = require('../middleware/validate');
const { bestellungBasisSchema, bestellungUpdateSchema } = require('../schemas');

/**
 * @swagger
 * /bestelluebersicht:
 *   get:
 *     summary: Alle Bestellungen abrufen
 *     description: 'Personenbezogene Kundenfelder werden entschlüsselt zurückgegeben (außer bei
 *       anonymisierten Bestellungen). Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Bestellübersicht]
 *     responses:
 *       200:
 *         description: Bestellliste
 *         content:
 *           application/json:
 *             schema: { type: array, items: { $ref: '#/components/schemas/Bestellung' } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT b.*, k.kunde_pseudonym, k.anonymisiert, k.anonymisiert_am, k.name_enc, k.email_enc,
              k.telefonnummer_enc, k.strasse_enc, k.hausnummer_enc, k.plz_enc, k.ort_enc
       FROM bestellung b
       JOIN bestellung_kunde k ON k.id = b.kunde_id
       ORDER BY b.erfassungsdatum DESC`
    );
    res.json(rows.map(toBestellungResponse));
  } catch (err) {
    logger.error('BESTELLUEBERSICHT', 'Fehler beim Laden der Bestellungen', { message: err.message });
    res.status(500).json({ error: 'Fehler beim Laden der Bestellungen' });
  }
});

/**
 * @swagger
 * /bestelluebersicht/next-number:
 *   get:
 *     summary: Nächste Bestellnummer ermitteln (für das Anlage-Formular)
 *     description: 'Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Bestellübersicht]
 *     responses:
 *       200:
 *         description: Nächste Bestellnummer
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties: { bestellnummer: { type: string, example: B-2026-0002 } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/next-number', async (_req, res) => {
  try {
    const nextNummer = await getNextBestellnummer(db);
    res.json({ bestellnummer: nextNummer });
  } catch (err) {
    logger.error('BESTELLUEBERSICHT', 'Fehler beim Ermitteln der nächsten Bestellnummer', { message: err.message });
    res.status(500).json({ error: 'Fehler beim Ermitteln der nächsten Bestellnummer' });
  }
});

/**
 * @swagger
 * /bestelluebersicht/foto/{fileName}:
 *   get:
 *     summary: Vom Kunden übermitteltes Referenzfoto abrufen
 *     description: 'Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Bestellübersicht]
 *     parameters:
 *       - { name: fileName, in: path, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Bilddatei
 *         content: { image/*: { schema: { type: string, format: binary } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/foto/:fileName', async (req, res) => {
  const fileName = path.basename(String(req.params.fileName || '').trim());
  if (!fileName) {
    return res.status(400).json({ error: 'Ungültiger Dateiname' });
  }
  try {
    if (await sendeFoto(req, res, db, 'bestellung', fileName)) return;
  } catch (err) {
    logger.error('BESTELLUEBERSICHT', 'Fehler beim Abrufen des Referenzfotos', { fileName, message: err.message });
    return res.status(500).json({ error: 'Fehler beim Abrufen des Fotos' });
  }
  res.sendFile(path.join(LEGACY_FOTO_DIR, fileName), { lastModified: true }, (err) => {
    if (!err || res.headersSent) return;
    if (err.code !== 'ENOENT') {
      logger.error('BESTELLUEBERSICHT', 'Fehler beim Abrufen des Referenzfotos', { fileName: req.params.fileName, message: err.message });
    }
    res.status(err.code === 'ENOENT' ? 404 : 500).json({ error: err.code === 'ENOENT' ? 'Foto nicht gefunden' : 'Fehler beim Abrufen des Fotos' });
  });
});

/**
 * @swagger
 * /bestelluebersicht/{id}:
 *   get:
 *     summary: Einzelne Bestellung abrufen
 *     description: 'Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Bestellübersicht]
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: Bestellung
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Bestellung' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT b.*, k.kunde_pseudonym, k.anonymisiert, k.anonymisiert_am, k.name_enc, k.email_enc,
              k.telefonnummer_enc, k.strasse_enc, k.hausnummer_enc, k.plz_enc, k.ort_enc
       FROM bestellung b
       JOIN bestellung_kunde k ON k.id = b.kunde_id
       WHERE b.id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Bestellung nicht gefunden' });
    }
    res.json(toBestellungResponse(rows[0]));
  } catch (err) {
    logger.error('BESTELLUEBERSICHT', `Fehler beim Laden der Bestellung ID=${req.params.id}`, { message: err.message });
    res.status(500).json({ error: 'Fehler beim Laden der Bestellung' });
  }
});

/**
 * @swagger
 * /bestelluebersicht:
 *   post:
 *     summary: Bestellung anlegen (interner, authentifizierter Bereich)
 *     description: 'DSGVO-Datenminimierung: bei Abholung sind Adressfelder nicht erforderlich, bei
 *       Lieferung schon (siehe utils/bestellungService.js validateDatenminimierung). Einwilligung
 *       (consent.erteilt) ist Pflicht. Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Bestellübersicht]
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
 *             required: [versandart, beschreibung]
 *             properties:
 *               versandart: { type: string, enum: [abholung, lieferung] }
 *               wunschdatum: { type: string, format: date, nullable: true }
 *               beschreibung: { type: string, maxLength: 2000 }
 *               kunde:
 *                 type: object
 *                 nullable: true
 *                 properties:
 *                   name: { type: string, maxLength: 200 }
 *                   email: { type: string, maxLength: 200, nullable: true }
 *                   telefonnummer: { type: string, maxLength: 200, nullable: true }
 *                   strasse: { type: string, maxLength: 200, nullable: true }
 *                   hausnummer: { type: string, maxLength: 200, nullable: true }
 *                   plz: { type: string, maxLength: 200, nullable: true }
 *                   ort: { type: string, maxLength: 200, nullable: true }
 *               consent:
 *                 type: object
 *                 nullable: true
 *                 properties:
 *                   erteilt: { type: boolean }
 *                   version: { type: string, example: '2026-01-v1' }
 *               foto:
 *                 type: string
 *                 nullable: true
 *                 description: Referenzfoto als Data-URL (JPG/PNG/GIF, base64), max. 5 MB dekodiert
 *     responses:
 *       201:
 *         description: Bestellung erstellt
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Bestellung' } } }
 *       400:
 *         description: Validierungsfehler, fehlende Einwilligung oder DSGVO-Datenminimierung verletzt
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       409:
 *         description: Bestellnummer-Kollision, bitte erneut versuchen
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 */
router.post('/', validate(bestellungBasisSchema), async (req, res) => {
  let client;
  try {
    const { versandart, wunschdatum, beschreibung, kunde, consent, foto } = req.body;

    if (!beschreibung?.trim()) {
      return res.status(400).json({ error: 'Auftragsbeschreibung ist erforderlich' });
    }
    const minimierungsFehler = validateDatenminimierung(versandart, kunde);
    if (minimierungsFehler) {
      return res.status(400).json({ error: minimierungsFehler });
    }
    if (consent?.erteilt !== true) {
      return res.status(400).json({ error: 'Einwilligung zur Datenverarbeitung ist erforderlich' });
    }

    let fotoDaten = null;
    if (foto) {
      try {
        fotoDaten = leseDataUrl(foto);
      } catch (fotoErr) {
        return res.status(400).json({ error: fotoErr.message });
      }
    }

    client = await db.connect();
    await client.query('BEGIN');
    await client.query('LOCK TABLE bestellung IN SHARE ROW EXCLUSIVE MODE');

    // In derselben Transaktion wie die Bestellung: ein Rollback hinterlässt kein verwaistes Foto.
    const fotoPfad = fotoDaten ? neuerBestellungFotoName() : null;
    if (fotoDaten) await speichereFoto(client, 'bestellung', fotoPfad, fotoDaten.buffer);

    const { bestellungRow, kundeId, kundePseudonym } = await insertBestellung(client, {
      versandart,
      wunschdatum,
      beschreibung,
      kunde,
      fotoPfad,
      ip: req.ip,
      erstelltVon: req.user?.username || 'unbekannt',
    });

    await client.query('COMMIT');

    logger.info('BESTELLUEBERSICHT', `Bestellung erstellt: ${bestellungRow.bestellnummer} (kunde=${kundeId})`);
    res.status(201).json({
      ...bestellungRow,
      kunde: {
        kundeId,
        kundePseudonym,
        anonymisiert: false,
        anonymisiertAm: null,
        name: kunde.name,
        email: kunde.email || null,
        telefonnummer: kunde.telefonnummer || null,
        strasse: kunde.strasse || null,
        hausnummer: kunde.hausnummer || null,
        plz: kunde.plz || null,
        ort: kunde.ort || null,
      },
    });
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        logger.error('BESTELLUEBERSICHT', 'Rollback fehlgeschlagen bei Bestellerstellung', { message: rollbackErr.message });
      }
    }
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Bestellnummer existiert bereits, bitte erneut versuchen' });
    }
    logger.error('BESTELLUEBERSICHT', 'Fehler beim Erstellen der Bestellung', { message: err.message });
    res.status(500).json({ error: err.message?.includes('DSGVO') || err.message?.includes('erfordert') ? err.message : 'Fehler beim Erstellen der Bestellung' });
  } finally {
    if (client) client.release();
  }
});

/**
 * @swagger
 * /bestelluebersicht/{id}:
 *   put:
 *     summary: Bestellung aktualisieren
 *     description: 'Bei bereits anonymisierten Bestellungen werden Kundendaten nicht mehr angefasst.
 *       Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Bestellübersicht]
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
 *             required: [versandart, beschreibung]
 *             properties:
 *               versandart: { type: string, enum: [abholung, lieferung] }
 *               wunschdatum: { type: string, format: date, nullable: true }
 *               beschreibung: { type: string, maxLength: 2000 }
 *               status: { type: string, enum: [offen, in_bearbeitung, abgeschlossen, storniert] }
 *               kunde:
 *                 type: object
 *                 nullable: true
 *                 properties:
 *                   name: { type: string }
 *                   email: { type: string, nullable: true }
 *                   telefonnummer: { type: string, nullable: true }
 *                   strasse: { type: string, nullable: true }
 *                   hausnummer: { type: string, nullable: true }
 *                   plz: { type: string, nullable: true }
 *                   ort: { type: string, nullable: true }
 *               foto:
 *                 type: string
 *                 nullable: true
 *                 description: Referenzfoto als Data-URL (JPG/PNG/GIF, base64), max. 5 MB dekodiert. Ohne Angabe bleibt ein vorhandenes Foto unverändert.
 *     responses:
 *       200:
 *         description: Bestellung aktualisiert
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Bestellung' } } }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.put('/:id', validate(bestellungUpdateSchema), async (req, res) => {
  let client;
  try {
    const { versandart, wunschdatum, beschreibung, status, kunde, foto } = req.body;

    if (!beschreibung?.trim()) {
      return res.status(400).json({ error: 'Auftragsbeschreibung ist erforderlich' });
    }

    const { rows: existingRows } = await db.query(
      `SELECT b.kunde_id, b.foto_pfad, k.anonymisiert FROM bestellung b
       JOIN bestellung_kunde k ON k.id = b.kunde_id WHERE b.id = $1`,
      [req.params.id]
    );
    if (existingRows.length === 0) {
      return res.status(404).json({ error: 'Bestellung nicht gefunden' });
    }
    const { kunde_id: kundeId, foto_pfad: alterFotoPfad, anonymisiert } = existingRows[0];

    if (!anonymisiert) {
      const minimierungsFehler = validateDatenminimierung(versandart, kunde);
      if (minimierungsFehler) {
        return res.status(400).json({ error: minimierungsFehler });
      }
    }

    let fotoDaten = null;
    if (foto) {
      try {
        fotoDaten = leseDataUrl(foto);
      } catch (fotoErr) {
        return res.status(400).json({ error: fotoErr.message });
      }
    }

    client = await db.connect();
    await client.query('BEGIN');

    // Ein neues Foto ersetzt das alte; beides in der Transaktion der Bestellung.
    const fotoPfad = fotoDaten ? neuerBestellungFotoName() : null;
    if (fotoDaten) {
      await speichereFoto(client, 'bestellung', fotoPfad, fotoDaten.buffer);
      if (alterFotoPfad) await loescheFoto(client, 'bestellung', alterFotoPfad);
    }

    if (!anonymisiert && kunde) {
      await client.query(
        `UPDATE bestellung_kunde SET
           name_enc = $1, email_enc = $2, telefonnummer_enc = $3,
           strasse_enc = $4, hausnummer_enc = $5, plz_enc = $6, ort_enc = $7
         WHERE id = $8`,
        [
          encryptField(kunde.name), encryptField(kunde.email), encryptField(kunde.telefonnummer),
          encryptField(kunde.strasse), encryptField(kunde.hausnummer), encryptField(kunde.plz), encryptField(kunde.ort),
          kundeId,
        ]
      );
    }

    if (fotoPfad) {
      await client.query(
        `UPDATE bestellung SET versandart = $1, wunschdatum = $2, beschreibung = $3, status = $4, foto_pfad = $5
         WHERE id = $6 RETURNING *`,
        [versandart, wunschdatum || null, beschreibung.trim(), status || 'offen', fotoPfad, req.params.id]
      );
    } else {
      await client.query(
        `UPDATE bestellung SET versandart = $1, wunschdatum = $2, beschreibung = $3, status = $4
         WHERE id = $5 RETURNING *`,
        [versandart, wunschdatum || null, beschreibung.trim(), status || 'offen', req.params.id]
      );
    }

    await client.query('COMMIT');

    const { rows: fullRows } = await db.query(
      `SELECT b.*, k.kunde_pseudonym, k.anonymisiert, k.anonymisiert_am, k.name_enc, k.email_enc,
              k.telefonnummer_enc, k.strasse_enc, k.hausnummer_enc, k.plz_enc, k.ort_enc
       FROM bestellung b JOIN bestellung_kunde k ON k.id = b.kunde_id WHERE b.id = $1`,
      [req.params.id]
    );

    logger.info('BESTELLUEBERSICHT', `Bestellung aktualisiert: ID=${req.params.id}`);
    res.json(toBestellungResponse(fullRows[0]));
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        logger.error('BESTELLUEBERSICHT', 'Rollback fehlgeschlagen bei Bestellaktualisierung', { message: rollbackErr.message });
      }
    }
    logger.error('BESTELLUEBERSICHT', `Fehler beim Aktualisieren der Bestellung ID=${req.params.id}`, { message: err.message });
    res.status(500).json({ error: err.message?.includes('erfordert') ? err.message : 'Fehler beim Aktualisieren der Bestellung' });
  } finally {
    if (client) client.release();
  }
});

/**
 * @swagger
 * /bestelluebersicht/{id}/anonymisieren:
 *   post:
 *     summary: Kundendaten einer Bestellung anonymisieren (Recht auf Vergessenwerden, Art. 17 DSGVO)
 *     description: 'Ruft die DB-Funktion anonymisiere_bestellung_kunde() auf. Erfordert Rolle: admin
 *       (zusätzlich zu bearbeiter/admin für den restlichen Router).'
 *     tags: [Bestellübersicht]
 *     security:
 *       - cookieAuth: []
 *         csrfHeader: []
 *       - bearerAuth: []
 *     parameters:
 *       - { name: id, in: path, required: true, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: Kundendaten anonymisiert
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post('/:id/anonymisieren', requireAdmin, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT kunde_id FROM bestellung WHERE id = $1', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Bestellung nicht gefunden' });
    }
    await db.query('SELECT anonymisiere_bestellung_kunde($1)', [rows[0].kunde_id]);
    logger.info('BESTELLUEBERSICHT', `Kundendaten anonymisiert für Bestellung ID=${req.params.id} (Kunde=${rows[0].kunde_id})`, { admin: req.user?.username });
    res.json({ message: 'Kundendaten wurden anonymisiert' });
  } catch (err) {
    logger.error('BESTELLUEBERSICHT', `Fehler bei Anonymisierung für Bestellung ID=${req.params.id}`, { message: err.message });
    res.status(500).json({ error: 'Fehler bei der Anonymisierung' });
  }
});

module.exports = router;
