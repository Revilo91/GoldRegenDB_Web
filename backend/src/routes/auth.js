const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const { authenticate, JWT_SECRET } = require("../middleware/auth");
const logger = require("../utils/logger");
const { validate } = require("../middleware/validate");
const {
  loginSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordWithTokenSchema,
} = require("../schemas");
const { hashPassword, verifyPassword } = require("../utils/passwordService");
const { setAuthCookie, clearAuthCookie } = require("../utils/authCookie");
const {
  MAX_FEHLVERSUCHE,
  SPERRDAUER_MINUTEN,
  RESET_TOKEN_GUELTIGKEIT_MINUTEN,
  istGesperrt,
  verbleibendeSperrminuten,
  naechsterFehlversuch,
  erzeugeResetToken,
  hashResetToken,
} = require("../utils/accountSecurity");

// POST /api/auth/login
router.post("/login", validate(loginSchema), async (req, res) => {
  const { username, password } = req.body;
  try {
    logger.info("AUTH", "Login-Versuch", { user: username, user_ip: req.ip });
    const { rows } = await db.query(
      `SELECT id, username, password_hash, role, active, must_change_password,
              failed_login_attempts, locked_until
         FROM app_users WHERE username = $1`,
      [username],
    );
    const user = rows[0];

    // Gesperrte Konten früh abweisen – ohne das Passwort überhaupt zu prüfen,
    // damit ein Angreifer die Sperre nicht durch Weiterraten verlängern kann.
    if (istGesperrt(user)) {
      const minuten = verbleibendeSperrminuten(user);
      logger.warn("AUTH", "Login abgewiesen – Konto gesperrt", {
        user: username,
        user_ip: req.ip,
        reason: "account_locked",
        minuten_bis_entsperrung: minuten,
      });
      return res.status(403).json({
        error: `Konto ist wegen zu vieler Fehlversuche gesperrt. Bitte in ${minuten} Minuten erneut versuchen.`,
      });
    }

    // verifyPassword läuft auch für unbekannte Benutzer gegen einen Dummy-Hash,
    // damit die Antwortzeit keine Benutzernamen preisgibt.
    const { valid, needsRehash } = await verifyPassword(
      password,
      user ? user.password_hash : null,
    );
    if (!user || !valid) {
      // Fehlversuche werden nur für existierende Konten gezählt – sonst könnte
      // ein Angreifer über die Sperrmeldung Benutzernamen ermitteln.
      if (user) {
        const { versuche, lockedUntil } = naechsterFehlversuch(user);
        await db.query(
          "UPDATE app_users SET failed_login_attempts = $1, locked_until = $2 WHERE id = $3",
          [versuche, lockedUntil, user.id],
        );
        if (lockedUntil) {
          logger.warn("AUTH", "Konto nach zu vielen Fehlversuchen gesperrt", {
            user: username,
            user_ip: req.ip,
            reason: "account_lockout_triggered",
            versuche,
            sperrdauer_minuten: SPERRDAUER_MINUTEN,
          });
        } else {
          logger.warn("AUTH", "Login fehlgeschlagen – ungültige Anmeldedaten", {
            user: username,
            user_ip: req.ip,
            reason: "invalid_credentials",
            versuche,
            max_versuche: MAX_FEHLVERSUCHE,
          });
        }
      } else {
        logger.warn("AUTH", "Login fehlgeschlagen – unbekannter Benutzer", {
          user: username,
          user_ip: req.ip,
          reason: "unknown_user",
        });
      }
      return res.status(401).json({ error: "Ungültige Anmeldedaten" });
    }
    if (!user.active) {
      logger.warn("AUTH", "Login fehlgeschlagen – Konto deaktiviert", {
        user: username,
        user_ip: req.ip,
        reason: "account_inactive",
      });
      return res.status(403).json({ error: "Benutzerkonto ist deaktiviert" });
    }
    // Altkonten tragen noch bcrypt(sha256(passwort)) aus der Zeit, als das
    // Frontend vorgehasht hat – beim ersten erfolgreichen Login umstellen.
    if (needsRehash) {
      const neuerHash = await hashPassword(password);
      await db.query("UPDATE app_users SET password_hash = $1 WHERE id = $2", [
        neuerHash,
        user.id,
      ]);
      logger.info("AUTH", "Passwort-Hash auf aktuelles Verfahren umgestellt", { user: username });
    }

    // Erfolgreicher Login setzt den Fehlversuchszähler zurück
    await db.query(
      `UPDATE app_users
          SET last_login = CURRENT_TIMESTAMP, failed_login_attempts = 0, locked_until = NULL
        WHERE id = $1`,
      [user.id],
    );
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: "8h" },
    );
    // Das JWT geht als httpOnly-Cookie raus – JavaScript im Browser kommt
    // nicht daran, ein XSS kann es also nicht auslesen und abtransportieren.
    setAuthCookie(res, token);

    logger.info("AUTH", "Login erfolgreich", { user: username, role: user.role, user_ip: req.ip });
    res.json({
      // Das Token bleibt zusätzlich in der Antwort, damit Skripte und E2E-Tests
      // ohne Cookie-Jar den Authorization-Header nutzen können. Das Frontend
      // ignoriert es und verlässt sich auf das Cookie.
      token,
      user: { id: user.id, username: user.username, role: user.role },
      mustChangePassword: !!user.must_change_password,
    });
  } catch (err) {
    logger.error("AUTH", "Login-Fehler", {
      user: username,
      message: err.message,
      code: err.code,
      stack: err.stack,
    });
    // Differentiate database connectivity errors from other errors
    // ECONNREFUSED = DB server unreachable, 57P03 = DB shutting down, 42P01 = table does not exist
    if (
      err.code === "ECONNREFUSED" ||
      err.code === "57P03" ||
      err.code === "42P01"
    ) {
      return res.status(503).json({
        error: "Datenbank nicht erreichbar – bitte später erneut versuchen",
      });
    }
    res.status(500).json({ error: "Anmeldefehler" });
  }
});

// POST /api/auth/logout – Auth-Cookie löschen
router.post("/logout", (req, res) => {
  clearAuthCookie(res);
  logger.info("AUTH", "Logout");
  res.json({ message: "Abgemeldet" });
});

// GET /api/auth/me – verify token and return current user
router.get("/me", authenticate, (req, res) => {
  logger.info("AUTH", "Token-Validierung erfolgreich", { user: req.user.username });
  res.json({ user: req.user });
});

// PUT /api/auth/change-password – change own password (authenticated)
router.put("/change-password", authenticate, validate(changePasswordSchema), async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user.id;
  const username = req.user.username;

  try {
    logger.info("AUTH", "Passwortänderung angefordert", { user: username });
    const { rows } = await db.query(
      "SELECT id, password_hash FROM app_users WHERE id = $1",
      [userId],
    );
    const user = rows[0];
    if (!user) {
      logger.warn("AUTH", "Passwortänderung fehlgeschlagen – Benutzer nicht gefunden", {
        user: username,
        reason: "user_not_found",
      });
      return res.status(404).json({ error: "Benutzer nicht gefunden" });
    }

    const { valid } = await verifyPassword(currentPassword, user.password_hash);

    if (!valid) {
      logger.warn("AUTH", "Passwortänderung fehlgeschlagen – falsches aktuelles Passwort", {
        user: username,
        reason: "current_password_invalid",
      });
      return res.status(401).json({ error: "Aktuelles Passwort ist falsch" });
    }

    const newHash = await hashPassword(newPassword);
    await db.query(
      "UPDATE app_users SET password_hash = $1, must_change_password = FALSE WHERE id = $2",
      [newHash, userId],
    );

    logger.info("AUTH", "Passwort erfolgreich geändert", { user: username });
    res.json({ message: "Passwort erfolgreich geändert" });
  } catch (err) {
    logger.error("AUTH", "Fehler bei Passwortänderung", {
      user: username,
      message: err.message,
      stack: err.stack,
    });
    res.status(500).json({ error: "Fehler bei der Passwortänderung" });
  }
});

// POST /api/auth/forgot-password – Reset-Token anfordern
//
// Es ist kein Mailversand konfiguriert. Der Reset-Link wird deshalb im
// Backend-Log ausgegeben; ein Administrator gibt ihn an den Benutzer weiter.
// Sobald SMTP verfügbar ist, muss nur diese Stelle auf Mailversand umgestellt
// werden – der Ablauf für den Benutzer bleibt gleich.
router.post("/forgot-password", validate(forgotPasswordSchema), async (req, res) => {
  const { username } = req.body;

  // Immer dieselbe Antwort, unabhängig davon, ob das Konto existiert –
  // sonst wird der Endpunkt zum Benutzernamen-Orakel.
  const antwort = {
    message:
      "Falls ein Konto existiert, wurde ein Reset-Link erzeugt. Bitte wenden Sie sich an einen Administrator.",
  };

  try {
    const { rows } = await db.query(
      "SELECT id, username, active FROM app_users WHERE username = $1",
      [username],
    );
    const user = rows[0];

    if (!user || !user.active) {
      logger.warn("AUTH", "Passwort-Reset für unbekanntes oder deaktiviertes Konto angefordert", {
        user: username,
        reason: "unknown_or_inactive_user",
      });
      return res.json(antwort);
    }

    const { token, tokenHash, expiry } = erzeugeResetToken();
    await db.query(
      "UPDATE app_users SET reset_token_hash = $1, reset_token_expiry = $2 WHERE id = $3",
      [tokenHash, expiry, user.id],
    );

    // Der Reset-Link landet bewusst in der lesbaren Message (nicht in meta): es ist
    // kein SMTP konfiguriert, ein Administrator muss ihn hier abholen und weiterreichen.
    logger.warn(
      "AUTH",
      `Passwort-Reset-Token für ${user.username} erzeugt (gültig ${RESET_TOKEN_GUELTIGKEIT_MINUTEN} Minuten). ` +
        `Reset-Link: /reset-password?token=${token}`,
      { user: user.username },
    );

    res.json(antwort);
  } catch (err) {
    logger.error("AUTH", "Fehler beim Anfordern eines Passwort-Resets", {
      user: username,
      message: err.message,
    });
    res.status(500).json({ error: "Fehler beim Anfordern des Passwort-Resets" });
  }
});

// POST /api/auth/reset-password – Passwort mit Reset-Token neu setzen
router.post("/reset-password", validate(resetPasswordWithTokenSchema), async (req, res) => {
  const { token, newPassword } = req.body;

  try {
    // Gesucht wird über den Hash – das Klartext-Token steht nie in der Datenbank.
    const { rows } = await db.query(
      `SELECT id, username FROM app_users
        WHERE reset_token_hash = $1 AND reset_token_expiry > CURRENT_TIMESTAMP`,
      [hashResetToken(token)],
    );
    const user = rows[0];
    if (!user) {
      logger.warn("AUTH", "Passwort-Reset mit ungültigem oder abgelaufenem Token", {
        reason: "reset_token_invalid_or_expired",
      });
      return res
        .status(400)
        .json({ error: "Token ist ungültig oder abgelaufen" });
    }

    const newHash = await hashPassword(newPassword);
    // Das Zurücksetzen hebt auch eine bestehende Sperre auf: der Benutzer hat
    // den Besitz des Reset-Tokens nachgewiesen.
    await db.query(
      `UPDATE app_users
          SET password_hash = $1,
              must_change_password = FALSE,
              reset_token_hash = NULL,
              reset_token_expiry = NULL,
              failed_login_attempts = 0,
              locked_until = NULL
        WHERE id = $2`,
      [newHash, user.id],
    );

    logger.info("AUTH", "Passwort per Reset-Token neu gesetzt", { user: user.username });
    res.json({ message: "Passwort erfolgreich geändert" });
  } catch (err) {
    logger.error("AUTH", "Fehler beim Zurücksetzen des Passworts", {
      message: err.message,
    });
    res.status(500).json({ error: "Fehler beim Zurücksetzen des Passworts" });
  }
});

module.exports = router;
