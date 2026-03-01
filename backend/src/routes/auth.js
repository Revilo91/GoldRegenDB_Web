const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { authenticate, JWT_SECRET } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Benutzername und Passwort erforderlich' });
  }
  try {
    const { rows } = await db.query(
      'SELECT id, username, password_hash, role, active FROM app_users WHERE username = $1',
      [username]
    );
    const user = rows[0];
    // Always compare to prevent timing attacks that reveal whether a username exists
    const dummyHash = '$2b$10$invalidhashvaluethatisusedfordummycomparison000000000';
    const hashToCheck = user ? user.password_hash : dummyHash;
    const valid = await bcrypt.compare(password, hashToCheck);
    if (!user || !valid) {
      return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
    }
    if (!user.active) {
      return res.status(403).json({ error: 'Benutzerkonto ist deaktiviert' });
    }
    // Update last login timestamp
    await db.query('UPDATE app_users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Anmeldefehler' });
  }
});

// GET /api/auth/me – verify token and return current user
router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
