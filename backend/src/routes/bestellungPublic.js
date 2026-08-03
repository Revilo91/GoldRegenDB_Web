const express = require('express');
const router = express.Router();
const db = require('../config/db');
const logger = require('../utils/logger');
const { validateDatenminimierung, insertBestellung } = require('../utils/bestellungService');

const MAX_BESCHREIBUNG_LAENGE = 2000;
const MAX_FELD_LAENGE = 200;

function pruefeFeldLaengen(kunde, beschreibung) {
  if (beschreibung.length > MAX_BESCHREIBUNG_LAENGE) {
    return `Auftragsbeschreibung darf maximal ${MAX_BESCHREIBUNG_LAENGE} Zeichen lang sein`;
  }
  for (const feld of ['name', 'email', 'telefonnummer', 'strasse', 'hausnummer', 'plz', 'ort']) {
    if (kunde?.[feld] && kunde[feld].toString().length > MAX_FELD_LAENGE) {
      return `Feld "${feld}" ist zu lang`;
    }
  }
  return null;
}

// Öffentliches Bestellformular (ohne Login) – z. B. eingebettet unter goldregen.de/Bestellung.
// Erlaubt ausschließlich das Anlegen neuer Bestellungen; Ansicht, Bearbeitung und Anonymisierung
// bleiben dem internen, authentifizierten Bereich vorbehalten.
router.post('/', async (req, res) => {
  let client;
  try {
    const { versandart, wunschdatum, beschreibung, kunde, consent, webseite } = req.body;

    // Honeypot-Feld: für Menschen unsichtbar, wird nur von Bots automatisch ausgefüllt.
    if (webseite) {
      logger.warn('BESTELLUNG_PUBLIC', 'Anfrage mit ausgefülltem Honeypot-Feld verworfen', { ip: req.ip });
      return res.status(400).json({ error: 'Ungültige Anfrage' });
    }

    if (!beschreibung?.trim()) {
      return res.status(400).json({ error: 'Auftragsbeschreibung ist erforderlich' });
    }
    const laengenFehler = pruefeFeldLaengen(kunde || {}, beschreibung.trim());
    if (laengenFehler) {
      return res.status(400).json({ error: laengenFehler });
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

    const { bestellungRow } = await insertBestellung(client, {
      versandart,
      wunschdatum,
      beschreibung,
      kunde,
      ip: req.ip,
      erstelltVon: 'Online-Formular',
    });

    await client.query('COMMIT');

    logger.info('BESTELLUNG_PUBLIC', `Öffentliche Bestellung erstellt: ${bestellungRow.bestellnummer}`);
    // Bewusst minimale Antwort: keine Kunden-ID, kein Pseudonym, keine PII an den anonymen Aufrufer.
    res.status(201).json({ bestellnummer: bestellungRow.bestellnummer });
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        logger.error('BESTELLUNG_PUBLIC', 'Rollback fehlgeschlagen bei öffentlicher Bestellerstellung', { message: rollbackErr.message });
      }
    }
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Bitte erneut versuchen' });
    }
    logger.error('BESTELLUNG_PUBLIC', 'Fehler beim Erstellen der öffentlichen Bestellung', { message: err.message });
    res.status(500).json({ error: err.message?.includes('erfordert') ? err.message : 'Fehler beim Absenden der Bestellung' });
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
