const express = require('express');
const router = express.Router();
const db = require('../config/db');
const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 10;
const VALID_ROLES = ['admin', 'user'];
const MIN_PASSWORD_LENGTH = 8;

// GET all users (without password_hash)
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, username, email, role, active, created_at, last_login FROM app_users ORDER BY username'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fehler beim Laden der Benutzer' });
  }
});

// GET single user
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, username, email, role, active, created_at, last_login FROM app_users WHERE id = $1',
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fehler beim Laden des Benutzers' });
  }
});

// POST create user
router.post('/', async (req, res) => {
  try {
    const { username, password, email, role, active } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Benutzername und Passwort sind erforderlich' });
    }
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Ungültige Rolle' });
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen haben` });
    }
    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
    const { rows } = await db.query(
      `INSERT INTO app_users (username, password_hash, email, role, active)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, username, email, role, active, created_at`,
      [username, password_hash, email || null, role || 'user', active !== false]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Benutzername bereits vergeben' });
    }
    res.status(500).json({ error: 'Fehler beim Erstellen des Benutzers' });
  }
});

// PUT update user (without password)
router.put('/:id', async (req, res) => {
  try {
    const { username, email, role, active } = req.body;
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Ungültige Rolle' });
    }
    const { rows } = await db.query(
      `UPDATE app_users SET username = $1, email = $2, role = $3, active = $4
       WHERE id = $5 RETURNING id, username, email, role, active, created_at, last_login`,
      [username, email || null, role, active, req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Benutzername bereits vergeben' });
    }
    res.status(500).json({ error: 'Fehler beim Aktualisieren des Benutzers' });
  }
});

// POST reset password
router.post('/:id/reset-password', async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen haben` });
    }
    const password_hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    const { rowCount } = await db.query(
      'UPDATE app_users SET password_hash = $1 WHERE id = $2',
      [password_hash, req.params.id]
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }
    res.json({ message: 'Passwort erfolgreich zurückgesetzt' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fehler beim Zurücksetzen des Passworts' });
  }
});

// DELETE user
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await db.query(
      'DELETE FROM app_users WHERE id = $1',
      [req.params.id]
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }
    res.json({ message: 'Benutzer gelöscht' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fehler beim Löschen des Benutzers' });
  }
});

module.exports = router;
