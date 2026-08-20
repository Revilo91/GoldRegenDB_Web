const express = require('express');
const router = express.Router();
const db = require('../config/db');
const logger = require('../utils/logger');

/**
 * @swagger
 * /audit-log:
 *   get:
 *     summary: Änderungsprotokoll (paginiert, durchsuchbar)
 *     description: 'Erfordert Rolle: admin.'
 *     tags: [Audit Log]
 *     parameters:
 *       - { name: page, in: query, schema: { type: integer, default: 1 } }
 *       - { name: limit, in: query, schema: { type: integer, default: 100 } }
 *       - name: search
 *         in: query
 *         description: Freitextsuche über Artikelnummer, Spalte, alten/neuen Wert, Aktion und Benutzer
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Seite des Audit-Logs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data: { type: array, items: { $ref: '#/components/schemas/AuditLogEintrag' } }
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     page: { type: integer }
 *                     limit: { type: integer }
 *                     total: { type: integer }
 *                     totalPages: { type: integer }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
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

/**
 * @swagger
 * /audit-log/verify:
 *   get:
 *     summary: Hash-Ketten-Integrität des Audit-Logs prüfen
 *     description: 'Tamper-Schutz (Issue #139): ruft die DB-Funktion verify_audit_chain() auf.
 *       Erfordert Rolle: admin.'
 *     tags: [Audit Log]
 *     responses:
 *       200:
 *         description: Prüfergebnis
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 valid: { type: boolean }
 *                 brokenEntries:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: integer }
 *                       problem: { type: string }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/verify', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT id, problem FROM verify_audit_chain()');
    res.json({ valid: rows.length === 0, brokenEntries: rows });
  } catch (err) {
    logger.error('AUDIT-LOG', 'Fehler beim Verifizieren der Hash-Kette', { message: err.message });
    res.status(500).json({ error: 'Fehler beim Verifizieren der Hash-Kette' });
  }
});

/**
 * @swagger
 * /audit-log/artikel/{artikelnummer}:
 *   get:
 *     summary: Audit-Log für ein bestimmtes Schmuckstück
 *     description: 'Erfordert Rolle: admin.'
 *     tags: [Audit Log]
 *     parameters:
 *       - { name: artikelnummer, in: path, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Änderungen für diese Artikelnummer
 *         content:
 *           application/json:
 *             schema: { type: array, items: { $ref: '#/components/schemas/AuditLogEintrag' } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
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
