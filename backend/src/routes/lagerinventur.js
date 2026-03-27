const express = require('express');
const router = express.Router();
const db = require('../config/db');

// Alle Entwürfe des aktuellen Users abrufen (status=entwurf)
router.get('/drafts', async (req, res) => {
  try {
    const userId = req.user.id;
    const { rows } = await db.query(
      'SELECT * FROM lagerinventur_entwurf WHERE user_id = $1 AND status = $2 ORDER BY updated_at DESC',
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
      'SELECT * FROM lagerinventur_entwurf WHERE id = $1 AND user_id = $2',
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
      'INSERT INTO lagerinventur_entwurf (user_id, data, kommentar) VALUES ($1, $2, $3) RETURNING *',
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
      'UPDATE lagerinventur_entwurf SET data = $1, kommentar = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 AND user_id = $4 AND status = $5 RETURNING *',
      [data, kommentar || null, id, userId, 'entwurf']
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Entwurf nicht gefunden oder nicht mehr bearbeitbar' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Aktualisieren des Entwurfs', details: err.message });
  }
});

// Entwurf abschließen
router.post('/drafts/:id/complete', async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { rows } = await db.query(
      'UPDATE lagerinventur_entwurf SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND user_id = $3 AND status = $4 RETURNING *',
      ['abgeschlossen', id, userId, 'entwurf']
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Entwurf nicht gefunden oder bereits abgeschlossen' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Fehler beim Abschließen des Entwurfs', details: err.message });
  }
});

module.exports = router;
