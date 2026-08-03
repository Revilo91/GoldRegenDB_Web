const express = require('express');
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
const { encryptField } = require('../utils/encryptionService');

// GET all orders
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

// GET next order number (for the create form)
router.get('/next-number', async (_req, res) => {
  try {
    const nextNummer = await getNextBestellnummer(db);
    res.json({ bestellnummer: nextNummer });
  } catch (err) {
    logger.error('BESTELLUEBERSICHT', 'Fehler beim Ermitteln der nächsten Bestellnummer', { message: err.message });
    res.status(500).json({ error: 'Fehler beim Ermitteln der nächsten Bestellnummer' });
  }
});

// GET single order
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

// POST create order
router.post('/', async (req, res) => {
  let client;
  try {
    const { versandart, wunschdatum, beschreibung, kunde, consent } = req.body;

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

    client = await db.connect();
    await client.query('BEGIN');
    await client.query('LOCK TABLE bestellung IN SHARE ROW EXCLUSIVE MODE');

    const { bestellungRow, kundeId, kundePseudonym } = await insertBestellung(client, {
      versandart,
      wunschdatum,
      beschreibung,
      kunde,
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

// PUT update order
router.put('/:id', async (req, res) => {
  let client;
  try {
    const { versandart, wunschdatum, beschreibung, status, kunde } = req.body;

    if (!beschreibung?.trim()) {
      return res.status(400).json({ error: 'Auftragsbeschreibung ist erforderlich' });
    }

    const { rows: existingRows } = await db.query(
      `SELECT b.kunde_id, k.anonymisiert FROM bestellung b
       JOIN bestellung_kunde k ON k.id = b.kunde_id WHERE b.id = $1`,
      [req.params.id]
    );
    if (existingRows.length === 0) {
      return res.status(404).json({ error: 'Bestellung nicht gefunden' });
    }
    const { kunde_id: kundeId, anonymisiert } = existingRows[0];

    if (!anonymisiert) {
      const minimierungsFehler = validateDatenminimierung(versandart, kunde);
      if (minimierungsFehler) {
        return res.status(400).json({ error: minimierungsFehler });
      }
    }

    client = await db.connect();
    await client.query('BEGIN');

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

    const { rows } = await client.query(
      `UPDATE bestellung SET versandart = $1, wunschdatum = $2, beschreibung = $3, status = $4
       WHERE id = $5 RETURNING *`,
      [versandart, wunschdatum || null, beschreibung.trim(), status || 'offen', req.params.id]
    );

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

// POST anonymize customer data (Recht auf Vergessenwerden, Art. 17 DSGVO) – Admin only
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
