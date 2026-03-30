const express = require('express');
const router = express.Router();
const db = require('../config/db');

// Alle Entwürfe des aktuellen Users abrufen (status=entwurf)
router.get('/drafts', async (req, res) => {
  try {
    const userId = req.user.id;
    const { rows } = await db.query(
      'SELECT * FROM lagerinventur WHERE user_id = $1 AND status = $2 ORDER BY updated_at DESC',
      [userId, 'entwurf']
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Abrufen der Entwürfe', details: err.message });
  }
});

// Einzelnen Entwurf abrufen
router.get('/drafts/:id', async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { rows } = await db.query(
      'SELECT * FROM lagerinventur WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Entwurf nicht gefunden' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Abrufen des Entwurfs', details: err.message });
  }
});

// Neuen Entwurf anlegen
router.post('/drafts', async (req, res) => {
  try {
    const userId = req.user.id;
    const { data, kommentar } = req.body;
    const { rows } = await db.query(
      'INSERT INTO lagerinventur (user_id, data, kommentar) VALUES ($1, $2, $3) RETURNING *',
      [userId, data, kommentar || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Anlegen des Entwurfs', details: err.message });
  }
});

// Entwurf aktualisieren (nur solange status=entwurf)
router.put('/drafts/:id', async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { data, kommentar } = req.body;
    const { rows } = await db.query(
      'UPDATE lagerinventur SET data = $1, kommentar = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 AND user_id = $4 AND status = $5 RETURNING *',
      [data, kommentar || null, id, userId, 'entwurf']
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Entwurf nicht gefunden oder nicht mehr bearbeitbar' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Aktualisieren des Entwurfs', details: err.message });
  }
});

// Inventur-Diff: Soll vs. Ist vergleichen
router.get('/drafts/:id/diff', async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // Entwurf laden
    const { rows: draftRows } = await db.query(
      'SELECT * FROM lagerinventur WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    if (draftRows.length === 0) return res.status(404).json({ error: 'Entwurf nicht gefunden' });

    const draft = draftRows[0];
    const scanned = draft.data || {}; // { "MXO001_1": 1, "MXO001_2": 2, ... }

    // Soll-Bestand: alle Artikel im Lager (nicht ausgelagert, nicht verkauft, kein Ausschuss)
    const { rows: lagerRows } = await db.query(
      `SELECT "Artikelnummer", "Name", "Verkaufspreis", "Art", "Material"
       FROM "Schmuckstück"
       WHERE "Ausgelagert" = 0 AND "Verkauft" = 0 AND "Ausschuss" = 0
       ORDER BY length("Artikelnummer"), "Artikelnummer"`
    );

    // Soll aggregieren
    const sollStats = {};
    for (const row of lagerRows) {
      const baseNr = row.Artikelnummer.split('_')[0];
      if (!sollStats[baseNr]) {
        sollStats[baseNr] = {
          BaseNr: baseNr,
          Name: row.Name,
          Art: row.Art,
          Verkaufspreis: row.Verkaufspreis,
          Soll: 0
        };
      }
      sollStats[baseNr].Soll += 1;
    }

    // Ist aggregieren
    const istStats = {};
    for (const [nr, count] of Object.entries(scanned)) {
      const baseNr = nr.split('_')[0];
      istStats[baseNr] = (istStats[baseNr] || 0) + count;
    }

    const fehlend = [];
    const gefunden = [];
    const unbekannt = [];

    const allBaseNrs = new Set([...Object.keys(sollStats), ...Object.keys(istStats)]);

    let statsFehlend = 0;
    let statsUnbekannt = 0;
    let statsGefunden = 0;

    for (const baseNr of allBaseNrs) {
      const sollObj = sollStats[baseNr] || { BaseNr: baseNr, Name: "–", Art: "–", Verkaufspreis: 0, Soll: 0 };
      const ist = istStats[baseNr] || 0;
      const soll = sollObj.Soll;

      const item = {
        Artikelnummer: baseNr,
        Name: sollObj.Name,
        Art: sollObj.Art,
        Verkaufspreis: sollObj.Verkaufspreis,
        Soll: soll,
        Ist: ist
      };

      if (ist === 0) {
        // Komplett fehlend
        item.Fehlt = soll;
        fehlend.push(item);
        statsFehlend += soll;
      } else if (soll === 0) {
        // Komplett unbekannt
        item.Zuviel = ist;
        unbekannt.push(item);
        statsUnbekannt += ist;
      } else {
        // Soll > 0 und Ist > 0
        if (ist < soll) {
          // es fehlen welche
          item.Fehlt = soll - ist;
          fehlend.push(item);
          statsFehlend += item.Fehlt;

          const gefItem = { ...item, Gefunden: ist };
          gefunden.push(gefItem);
          statsGefunden += ist;
        } else if (ist > soll) {
          // zu viele!
          item.Zuviel = ist - soll;
          unbekannt.push(item);
          statsUnbekannt += item.Zuviel;

          const gefItem = { ...item, Gefunden: soll };
          gefunden.push(gefItem);
          statsGefunden += soll;
        } else {
          // genau richtig
          const gefItem = { ...item, Gefunden: soll };
          gefunden.push(gefItem);
          statsGefunden += soll;
        }
      }
    }

    res.json({
      fehlend,
      gefunden,
      unbekannt,
      stats: {
        soll: lagerRows.length,
        gescannt: Object.values(scanned).reduce((s, c) => s + c, 0),
        fehlend: statsFehlend,
        gefunden: statsGefunden,
        unbekannt: statsUnbekannt,
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Vergleichen', details: err.message });
  }
});

// Entwurf abschließen
router.post('/drafts/:id/complete', async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { rows } = await db.query(
      'UPDATE lagerinventur SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND user_id = $3 AND status = $4 RETURNING *',
      ['abgeschlossen', id, userId, 'entwurf']
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Entwurf nicht gefunden oder bereits abgeschlossen' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Abschließen des Entwurfs', details: err.message });
  }
});

module.exports = router;
