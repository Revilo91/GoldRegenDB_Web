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

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Anmelden
 *     description: Setzt bei Erfolg das httpOnly-JWT-Cookie `jwt` und gibt das Token zusätzlich im Body zurück
 *       (für Skripte/E2E-Tests ohne Cookie-Jar). Öffentlich, aber per IP auf 20 fehlgeschlagene Versuche/15 Min
 *       begrenzt; zusätzlich Konto-Sperre nach 5 Fehlversuchen (30 Minuten).
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password]
 *             properties:
 *               username: { type: string, example: admin }
 *               password: { type: string, format: password }
 *     responses:
 *       200:
 *         description: Login erfolgreich
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token: { type: string, description: 'JWT, zusätzlich zum httpOnly-Cookie' }
 *                 user:
 *                   type: object
 *                   properties:
 *                     id: { type: integer }
 *                     username: { type: string }
 *                     role: { type: string, enum: [admin, bearbeiter, user] }
 *                 mustChangePassword: { type: boolean }
 *       401:
 *         description: Ungültige Anmeldedaten
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 *       403:
 *         description: Konto gesperrt oder deaktiviert
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 *       429:
 *         description: Zu viele Anmeldeversuche von dieser IP
 */
router.post("/login", validate(loginSchema), async (req, res) => {
  const { username, password } = req.body;
  try {
    logger.info("AUTH", `Login-Versuch für Benutzer: ${username}`);
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
      logger.warn(
        "AUTH",
        `Login abgewiesen – Konto gesperrt: ${username} (noch ${minuten} Minuten)`,
      );
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
          logger.warn(
            "AUTH",
            `Konto nach ${versuche} Fehlversuchen für ${SPERRDAUER_MINUTEN} Minuten gesperrt: ${username}`,
          );
        } else {
          logger.warn(
            "AUTH",
            `Login fehlgeschlagen für Benutzer: ${username} – Ungültige Anmeldedaten (Versuch ${versuche}/${MAX_FEHLVERSUCHE})`,
          );
        }
      } else {
        logger.warn(
          "AUTH",
          `Login fehlgeschlagen für unbekannten Benutzer: ${username}`,
        );
      }
      return res.status(401).json({ error: "Ungültige Anmeldedaten" });
    }
    if (!user.active) {
      logger.warn(
        "AUTH",
        `Login fehlgeschlagen für Benutzer: ${username} – Konto deaktiviert`,
      );
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
      logger.info(
        "AUTH",
        `Passwort-Hash auf aktuelles Verfahren umgestellt: ${username}`,
      );
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

    logger.info("AUTH", `Login erfolgreich: ${username} (Rolle: ${user.role})`);
    res.json({
      // Das Token bleibt zusätzlich in der Antwort, damit Skripte und E2E-Tests
      // ohne Cookie-Jar den Authorization-Header nutzen können. Das Frontend
      // ignoriert es und verlässt sich auf das Cookie.
      token,
      user: { id: user.id, username: user.username, role: user.role },
      mustChangePassword: !!user.must_change_password,
    });
  } catch (err) {
    logger.error("AUTH", `Login-Fehler für Benutzer: ${username}`, {
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

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Abmelden
 *     description: Löscht das JWT-Cookie. Erfordert selbst kein gültiges Cookie, da löschen keine Seiteneffekte
 *       auf fremde Konten hat.
 *     tags: [Auth]
 *     security: []
 *     responses:
 *       200:
 *         description: Abgemeldet
 */
router.post("/logout", (req, res) => {
  clearAuthCookie(res);
  logger.info("AUTH", "Logout");
  res.json({ message: "Abgemeldet" });
});

/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: Eigene Benutzerdaten aus dem Token
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Aktueller Benutzer
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   type: object
 *                   properties:
 *                     id: { type: integer }
 *                     username: { type: string }
 *                     role: { type: string, enum: [admin, bearbeiter, user] }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get("/me", authenticate, (req, res) => {
  logger.info("AUTH", `Token-Validierung erfolgreich: ${req.user.username}`);
  res.json({ user: req.user });
});

/**
 * @swagger
 * /auth/change-password:
 *   put:
 *     summary: Eigenes Passwort ändern
 *     tags: [Auth]
 *     security:
 *       - cookieAuth: []
 *         csrfHeader: []
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword]
 *             properties:
 *               currentPassword: { type: string, format: password }
 *               newPassword: { type: string, format: password, minLength: 8 }
 *     responses:
 *       200:
 *         description: Passwort geändert
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401:
 *         description: Aktuelles Passwort falsch, oder kein/ungültiges JWT
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.put("/change-password", authenticate, validate(changePasswordSchema), async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user.id;
  const username = req.user.username;

  try {
    logger.info(
      "AUTH",
      `Passwortänderung angefordert von Benutzer: ${username}`,
    );
    const { rows } = await db.query(
      "SELECT id, password_hash FROM app_users WHERE id = $1",
      [userId],
    );
    const user = rows[0];
    if (!user) {
      logger.warn(
        "AUTH",
        `Passwortänderung fehlgeschlagen – Benutzer nicht gefunden: ${username}`,
      );
      return res.status(404).json({ error: "Benutzer nicht gefunden" });
    }

    const { valid } = await verifyPassword(currentPassword, user.password_hash);

    if (!valid) {
      logger.warn(
        "AUTH",
        `Passwortänderung fehlgeschlagen – falsches aktuelles Passwort: ${username}`,
      );
      return res.status(401).json({ error: "Aktuelles Passwort ist falsch" });
    }

    const newHash = await hashPassword(newPassword);
    await db.query(
      "UPDATE app_users SET password_hash = $1, must_change_password = FALSE WHERE id = $2",
      [newHash, userId],
    );

    logger.info(
      "AUTH",
      `Passwort erfolgreich geändert für Benutzer: ${username}`,
    );
    res.json({ message: "Passwort erfolgreich geändert" });
  } catch (err) {
    logger.error("AUTH", `Fehler bei Passwortänderung für: ${username}`, {
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
/**
 * @swagger
 * /auth/forgot-password:
 *   post:
 *     summary: Passwort-Reset-Token anfordern
 *     description: Antwort ist immer identisch, unabhängig davon, ob das Konto existiert (kein
 *       Benutzernamen-Orakel). Kein SMTP konfiguriert – der Reset-Link landet im Backend-Log, ein
 *       Administrator gibt ihn weiter. Läuft unter dem strengen Login-Rate-Limiter (20/15 Min pro IP).
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username]
 *             properties:
 *               username: { type: string }
 *     responses:
 *       200:
 *         description: Immer erfolgreich, unabhängig davon ob das Konto existiert
 *       429:
 *         description: Zu viele Anfragen von dieser IP
 */
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
      logger.warn(
        "AUTH",
        `Passwort-Reset für unbekanntes oder deaktiviertes Konto angefordert: ${username}`,
      );
      return res.json(antwort);
    }

    const { token, tokenHash, expiry } = erzeugeResetToken();
    await db.query(
      "UPDATE app_users SET reset_token_hash = $1, reset_token_expiry = $2 WHERE id = $3",
      [tokenHash, expiry, user.id],
    );

    logger.warn(
      "AUTH",
      `Passwort-Reset-Token für ${user.username} erzeugt (gültig ${RESET_TOKEN_GUELTIGKEIT_MINUTEN} Minuten). ` +
        `Reset-Link: /reset-password?token=${token}`,
    );

    res.json(antwort);
  } catch (err) {
    logger.error("AUTH", `Fehler beim Anfordern eines Passwort-Resets für: ${username}`, {
      message: err.message,
    });
    res.status(500).json({ error: "Fehler beim Anfordern des Passwort-Resets" });
  }
});

/**
 * @swagger
 * /auth/reset-password:
 *   post:
 *     summary: Passwort mit Reset-Token neu setzen
 *     description: Setzt zusätzlich eine bestehende Konto-Sperre und den Fehlversuchszähler zurück.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, newPassword]
 *             properties:
 *               token: { type: string, description: '64-stelliges Hex-Token aus dem Reset-Link' }
 *               newPassword: { type: string, format: password, minLength: 8 }
 *     responses:
 *       200:
 *         description: Passwort geändert
 *       400:
 *         description: Token ungültig/abgelaufen, oder Validierungsfehler
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 *       429:
 *         description: Zu viele Anfragen von dieser IP
 */
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
      logger.warn("AUTH", "Passwort-Reset mit ungültigem oder abgelaufenem Token");
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

    logger.info("AUTH", `Passwort per Reset-Token neu gesetzt: ${user.username}`);
    res.json({ message: "Passwort erfolgreich geändert" });
  } catch (err) {
    logger.error("AUTH", "Fehler beim Zurücksetzen des Passworts", {
      message: err.message,
    });
    res.status(500).json({ error: "Fehler beim Zurücksetzen des Passworts" });
  }
});

module.exports = router;
