const express = require('express');
const router = express.Router();
const db = require('../config/db');
const logger = require('../utils/logger');

// GET audit log with pagination
router.get('/', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const search = req.query.search || '';
  try {
    const limit = parseInt(req.query.limit) || 100;
    const offset = (page - 1) * limit;

    let where = [];
    let params = [];
    let paramIdx = 1;

    if (search) {
      where.push(`(artikelnummer_id ILIKE $${paramIdx} OR changed_by ILIKE $${paramIdx} OR old_value ILIKE $${paramIdx} OR new_value ILIKE $${paramIdx} OR column_name ILIKE $${paramIdx} OR action_type ILIKE $${paramIdx})`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

    const countResult = await db.query(`SELECT COUNT(*) FROM audit_log ${whereClause}`, params);
    const total = parseInt(countResult.rows[0].count);

    const { rows } = await db.query(
      `SELECT * FROM audit_log ${whereClause} ORDER BY change_timestamp DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
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
    logger.error('AUDIT-LOG', 'Fehler beim Laden des Audit-Logs (paginiert)', { message: err.message, page, search });
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
    logger.error('AUDIT-LOG', 'Fehler beim Laden des Audit-Logs', { message: err.message });
    res.status(500).json({ error: 'Fehler beim Laden des Audit-Logs' });
  }
});

module.exports = router;
