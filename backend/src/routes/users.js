const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const db = require("../config/db");
const logger = require("../utils/logger");
const { validate } = require("../middleware/validate");
const {
  userCreateSchema,
  userUpdateSchema,
  resetPasswordSchema,
} = require("../schemas");

const VALID_ROLES = ["admin", "bearbeiter", "user"];

// A SHA-256 hash is always a 64-character lowercase hex string
const SHA256_REGEX = /^[0-9a-f]{64}$/;
function isValidSHA256(value) {
  return typeof value === "string" && SHA256_REGEX.test(value);
}

// GET all users (without password_hash)
router.get("/", async (req, res) => {
  try {
    const { rows } = await db.query(
      "SELECT id, username, email, role, active, must_change_password, created_at, last_login FROM app_users ORDER BY username",
    );
    logger.info("USERS", `${rows.length} Benutzer geladen`);
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
    logger.error(
      "USERS",
      `Fehler beim Laden des Benutzers ID=${req.params.id}`,
      { message: err.message },
    );
    res.status(500).json({ error: "Fehler beim Laden des Benutzers" });
  }
});

// POST create user
router.post("/", validate(userCreateSchema), async (req, res) => {
  try {
    const { username, password, email, role, active } = req.body;
    if (!username || !password) {
      return res
        .status(400)
        .json({ error: "Benutzername und Passwort sind erforderlich" });
    }
    if (!isValidSHA256(password)) {
      return res.status(400).json({ error: "Ungültiges Passwort-Format" });
    }
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: "Ungültige Rolle" });
    }
    const password_hash = await bcrypt.hash(password, 10);
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
    logger.info("USERS", `Benutzer erstellt: ${username} (Rolle: ${role})`);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      logger.warn(
        "USERS",
        `Benutzer-Erstellung fehlgeschlagen: ${req.body.username} – Name bereits vergeben`,
      );
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
    logger.info(
      "USERS",
      `Benutzer aktualisiert: ID=${req.params.id} (${username})`,
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      logger.warn(
        "USERS",
        `Benutzer-Update fehlgeschlagen: ID=${req.params.id} – Name bereits vergeben`,
      );
      return res.status(409).json({ error: "Benutzername bereits vergeben" });
    }
    logger.error(
      "USERS",
      `Fehler beim Aktualisieren des Benutzers ID=${req.params.id}`,
      { message: err.message },
    );
    res.status(500).json({ error: "Fehler beim Aktualisieren des Benutzers" });
  }
});

// POST reset password
router.post("/:id/reset-password", validate(resetPasswordSchema), async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || !isValidSHA256(newPassword)) {
      return res.status(400).json({ error: "Ungültiges Passwort-Format" });
    }
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const { rowCount } = await db.query(
      "UPDATE app_users SET password_hash = $1, must_change_password = TRUE WHERE id = $2",
      [hashedPassword, req.params.id],
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: "Benutzer nicht gefunden" });
    }
    logger.info(
      "USERS",
      `Passwort zurückgesetzt für Benutzer ID=${req.params.id}`,
    );
    res.json({ message: "Passwort erfolgreich zurückgesetzt" });
  } catch (err) {
    logger.error(
      "USERS",
      `Fehler beim Zurücksetzen des Passworts für ID=${req.params.id}`,
      { message: err.message },
    );
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
    logger.info("USERS", `Benutzer gelöscht: ID=${req.params.id}`);
    res.json({ message: "Benutzer gelöscht" });
  } catch (err) {
    logger.error(
      "USERS",
      `Fehler beim Löschen des Benutzers ID=${req.params.id}`,
      { message: err.message },
    );
    res.status(500).json({ error: "Fehler beim Löschen des Benutzers" });
  }
});

module.exports = router;
