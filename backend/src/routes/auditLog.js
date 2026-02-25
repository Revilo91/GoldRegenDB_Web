const express = require('express');
const router = express.Router();
const db = require('../config/db');

// GET audit log with pagination
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100;
    const offset = (page - 1) * limit;

    const countResult = await db.query('SELECT COUNT(*) FROM audit_log');
    const total = parseInt(countResult.rows[0].count);

    const { rows } = await db.query(
      'SELECT * FROM audit_log ORDER BY change_timestamp DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );

    res.json({
      data: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fehler beim Laden des Audit-Logs' });
  }
});

// GET audit log for a specific piece
router.get('/artikel/:artikelnummer', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM audit_log WHERE artikelnummer_id = $1 ORDER BY change_timestamp DESC',
      [req.params.artikelnummer]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fehler beim Laden des Audit-Logs' });
  }
});

module.exports = router;
