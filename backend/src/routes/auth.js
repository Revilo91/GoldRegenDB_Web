const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { authenticate, JWT_SECRET } = require('../middleware/auth');
const logger = require('../utils/logger');

// A SHA-256 hash is always a 64-character lowercase hex string
const SHA256_REGEX = /^[0-9a-f]{64}$/;
function isValidSHA256(value) {
  return typeof value === 'string' && SHA256_REGEX.test(value);
}

// Constant-time string comparison to prevent timing attacks.
// Both arguments must be the same length (validated before calling).
function safeCompare(a, b) {
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
}

// Realistic dummy hash used when a user is not found, to prevent username-enumeration
// via timing differences. Value = SHA-256("goldregen_dummy").
const DUMMY_HASH = 'd0cc7cb66f1906854afc654abd8453c00b676b91712a5615432e0d99a6818fb5';

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    logger.warn('AUTH', 'Login-Versuch ohne Benutzername oder Passwort');
    return res.status(400).json({ error: 'Benutzername und Passwort erforderlich' });
  }
  if (!isValidSHA256(password)) {
    logger.warn('AUTH', `Login-Versuch mit ungültigem Passwort-Format für Benutzer: ${username}`);
    return res.status(400).json({ error: 'Ungültiges Passwort-Format' });
  }
  try {
    logger.info('AUTH', `Login-Versuch für Benutzer: ${username}`);
    const { rows } = await db.query(
      'SELECT id, username, password_hash, role, active FROM app_users WHERE username = $1',
      [username]
    );
    const user = rows[0];
    // Always compare to prevent timing attacks that reveal whether a username exists
    const hashToCheck = user && isValidSHA256(user.password_hash) ? user.password_hash : DUMMY_HASH;
    const valid = safeCompare(password, hashToCheck);
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

// PUT /api/auth/change-password – change own password (authenticated)
router.put('/change-password', authenticate, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user.id;
  const username = req.user.username;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Aktuelles und neues Passwort erforderlich' });
  }
  if (!isValidSHA256(currentPassword) || !isValidSHA256(newPassword)) {
    return res.status(400).json({ error: 'Ungültiges Passwort-Format' });
  }

  try {
    logger.info('AUTH', `Passwortänderung angefordert von Benutzer: ${username}`);
    const { rows } = await db.query(
      'SELECT id, password_hash FROM app_users WHERE id = $1',
      [userId]
    );
    const user = rows[0];
    if (!user) {
      logger.warn('AUTH', `Passwortänderung fehlgeschlagen – Benutzer nicht gefunden: ${username}`);
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }

    const valid = safeCompare(currentPassword, user.password_hash || '');

    if (!valid) {
      logger.warn('AUTH', `Passwortänderung fehlgeschlagen – falsches aktuelles Passwort: ${username}`);
      return res.status(401).json({ error: 'Aktuelles Passwort ist falsch' });
    }

    await db.query('UPDATE app_users SET password_hash = $1 WHERE id = $2', [newPassword, userId]);

    logger.info('AUTH', `Passwort erfolgreich geändert für Benutzer: ${username}`);
    res.json({ message: 'Passwort erfolgreich geändert' });
  } catch (err) {
    logger.error('AUTH', `Fehler bei Passwortänderung für: ${username}`, { message: err.message, stack: err.stack });
    res.status(500).json({ error: 'Fehler bei der Passwortänderung' });
  }
});

module.exports = router;
