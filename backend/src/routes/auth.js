const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { authenticate, JWT_SECRET } = require('../middleware/auth');
const logger = require('../utils/logger');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    logger.warn('AUTH', 'Login-Versuch ohne Benutzername oder Passwort');
    return res.status(400).json({ error: 'Benutzername und Passwort erforderlich' });
  }
  try {
    logger.info('AUTH', `Login-Versuch für Benutzer: ${username}`);
    const { rows } = await db.query(
      'SELECT id, username, password_hash, role, active FROM app_users WHERE username = $1',
      [username]
    );
    const user = rows[0];
    // Always compare to prevent timing attacks that reveal whether a username exists
    const dummyHash = '$2b$10$invalidhashvaluethatisusedfordummycomparison000000000';
    const hashToCheck = user && user.password_hash ? user.password_hash : dummyHash;
    let valid = false;
    try {
      valid = await bcrypt.compare(password, hashToCheck);
    } catch (bcryptErr) {
      logger.error('AUTH', `bcrypt.compare Fehler für Benutzer: ${username}`, { message: bcryptErr.message });
    }
    if (!user || !valid) {
      logger.warn('AUTH', `Login fehlgeschlagen für Benutzer: ${username} – Ungültige Anmeldedaten`);
      return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
    }
    if (!user.active) {
      logger.warn('AUTH', `Login fehlgeschlagen für Benutzer: ${username} – Konto deaktiviert`);
      return res.status(403).json({ error: 'Benutzerkonto ist deaktiviert' });
    }
    // Update last login timestamp
    await db.query('UPDATE app_users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '8h' }
    );
    logger.info('AUTH', `Login erfolgreich: ${username} (Rolle: ${user.role})`);
    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    logger.error('AUTH', `Login-Fehler für Benutzer: ${username}`, { message: err.message, code: err.code, stack: err.stack });
    // Differentiate database connectivity errors from other errors
    // ECONNREFUSED = DB server unreachable, 57P03 = DB shutting down, 42P01 = table does not exist
    if (err.code === 'ECONNREFUSED' || err.code === '57P03' || err.code === '42P01') {
      return res.status(503).json({ error: 'Datenbank nicht erreichbar – bitte später erneut versuchen' });
    }
    res.status(500).json({ error: 'Anmeldefehler' });
  }
});

// GET /api/auth/me – verify token and return current user
router.get('/me', authenticate, (req, res) => {
  logger.info('AUTH', `Token-Validierung erfolgreich: ${req.user.username}`);
  res.json({ user: req.user });
});

module.exports = router;
