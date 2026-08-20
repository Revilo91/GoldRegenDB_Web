const express = require("express");
const router = express.Router();
const db = require("../config/db");
const logger = require("../utils/logger");
const { validate } = require("../middleware/validate");
const {
  userCreateSchema,
  userUpdateSchema,
  resetPasswordSchema,
} = require("../schemas");
const { hashPassword } = require("../utils/passwordService");

const VALID_ROLES = ["admin", "bearbeiter", "user"];

// GET all users (without password_hash)
router.get("/", async (req, res) => {
  try {
    const { rows } = await db.query(
      "SELECT id, username, email, role, active, must_change_password, created_at, last_login FROM app_users ORDER BY username",
    );
    logger.info("USERS", "Benutzer geladen", { anzahl: rows.length });
    res.json(rows);
  } catch (err) {
    logger.error("USERS", "Fehler beim Laden der Benutzer", {
      message: err.message,
    });
    res.status(500).json({ error: "Fehler beim Laden der Benutzer" });
  }
});

// GET single user
router.get("/:id", async (req, res) => {
  try {
    const { rows } = await db.query(
      "SELECT id, username, email, role, active, must_change_password, created_at, last_login FROM app_users WHERE id = $1",
      [req.params.id],
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Benutzer nicht gefunden" });
    }
    res.json(rows[0]);
  } catch (err) {
    logger.error("USERS", "Fehler beim Laden des Benutzers", {
      id: req.params.id,
      message: err.message,
    });
    res.status(500).json({ error: "Fehler beim Laden des Benutzers" });
  }
});

// POST create user
router.post("/", validate(userCreateSchema), async (req, res) => {
  try {
    const { username, password, email, role, active } = req.body;
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: "Ungültige Rolle" });
    }
    const password_hash = await hashPassword(password);
    const { rows } = await db.query(
      `INSERT INTO app_users (username, password_hash, email, role, active, must_change_password)
       VALUES ($1, $2, $3, $4, $5, TRUE) RETURNING id, username, email, role, active, must_change_password, created_at`,
      [
        username,
        password_hash,
        email || null,
        role || "user",
        active !== false,
      ],
    );
    logger.info("USERS", "Benutzer erstellt", { user: username, role });
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      logger.warn("USERS", "Benutzer-Erstellung fehlgeschlagen – Name bereits vergeben", {
        user: req.body.username,
        reason: "username_taken",
      });
      return res.status(409).json({ error: "Benutzername bereits vergeben" });
    }
    logger.error("USERS", "Fehler beim Erstellen des Benutzers", {
      message: err.message,
    });
    res.status(500).json({ error: "Fehler beim Erstellen des Benutzers" });
  }
});

// PUT update user (without password)
router.put("/:id", validate(userUpdateSchema), async (req, res) => {
  try {
    const { username, email, role, active } = req.body;
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: "Ungültige Rolle" });
    }
    const { rows } = await db.query(
      `UPDATE app_users SET username = $1, email = $2, role = $3, active = $4
       WHERE id = $5 RETURNING id, username, email, role, active, created_at, last_login`,
      [username, email || null, role, active, req.params.id],
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Benutzer nicht gefunden" });
    }
    logger.info("USERS", "Benutzer aktualisiert", { id: req.params.id, user: username });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      logger.warn("USERS", "Benutzer-Update fehlgeschlagen – Name bereits vergeben", {
        id: req.params.id,
        reason: "username_taken",
      });
      return res.status(409).json({ error: "Benutzername bereits vergeben" });
    }
    logger.error("USERS", "Fehler beim Aktualisieren des Benutzers", {
      id: req.params.id,
      message: err.message,
    });
    res.status(500).json({ error: "Fehler beim Aktualisieren des Benutzers" });
  }
});

// POST reset password
router.post("/:id/reset-password", validate(resetPasswordSchema), async (req, res) => {
  try {
    const { newPassword } = req.body;
    const hashedPassword = await hashPassword(newPassword);
    // Ein Admin-Reset hebt auch eine Sperre und offene Reset-Token auf
    const { rowCount } = await db.query(
      `UPDATE app_users
          SET password_hash = $1,
              must_change_password = TRUE,
              failed_login_attempts = 0,
              locked_until = NULL,
              reset_token_hash = NULL,
              reset_token_expiry = NULL
        WHERE id = $2`,
      [hashedPassword, req.params.id],
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: "Benutzer nicht gefunden" });
    }
    logger.info("USERS", "Passwort zurückgesetzt", { id: req.params.id });
    res.json({ message: "Passwort erfolgreich zurückgesetzt" });
  } catch (err) {
    logger.error("USERS", "Fehler beim Zurücksetzen des Passworts", {
      id: req.params.id,
      message: err.message,
    });
    res.status(500).json({ error: "Fehler beim Zurücksetzen des Passworts" });
  }
});

// DELETE user
router.delete("/:id", async (req, res) => {
  try {
    const { rowCount } = await db.query("DELETE FROM app_users WHERE id = $1", [
      req.params.id,
    ]);
    if (rowCount === 0) {
      return res.status(404).json({ error: "Benutzer nicht gefunden" });
    }
    logger.info("USERS", "Benutzer gelöscht", { id: req.params.id });
    res.json({ message: "Benutzer gelöscht" });
  } catch (err) {
    logger.error("USERS", "Fehler beim Löschen des Benutzers", {
      id: req.params.id,
      message: err.message,
    });
    res.status(500).json({ error: "Fehler beim Löschen des Benutzers" });
  }
});

module.exports = router;
