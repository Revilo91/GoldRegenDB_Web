// @ts-check
const crypto = require('crypto');

// Nach so vielen aufeinanderfolgenden Fehlversuchen wird das Konto gesperrt.
// Das Rate-Limit allein reicht nicht: es greift pro IP, ein verteilter
// Angriff kann es umgehen.
const MAX_FEHLVERSUCHE = 5;
const SPERRDAUER_MINUTEN = 30;

// Gültigkeit eines Passwort-Reset-Tokens
const RESET_TOKEN_GUELTIGKEIT_MINUTEN = 30;

/** @typedef {import('../types').SperrbarerUser} SperrbarerUser */

/**
 * @param {Partial<SperrbarerUser> | null | undefined} user
 * @param {Date} [jetzt]
 * @returns {boolean}
 */
function istGesperrt(user, jetzt = new Date()) {
  return Boolean(user?.locked_until) && new Date(/** @type {Date} */ (user?.locked_until)) > jetzt;
}

/**
 * @param {Partial<SperrbarerUser> | null | undefined} user
 * @param {Date} [jetzt]
 * @returns {number}
 */
function verbleibendeSperrminuten(user, jetzt = new Date()) {
  if (!istGesperrt(user, jetzt)) return 0;
  return Math.ceil((new Date(/** @type {Date} */ (user?.locked_until)).getTime() - jetzt.getTime()) / 60000);
}

// Ergebnis eines Fehlversuchs: neuer Zähler und ggf. Sperrzeitpunkt.
/**
 * @param {Partial<SperrbarerUser> | null | undefined} user
 * @param {Date} [jetzt]
 * @returns {import('../types').FehlversuchErgebnis}
 */
function naechsterFehlversuch(user, jetzt = new Date()) {
  const versuche = (user?.failed_login_attempts || 0) + 1;
  const lockedUntil =
    versuche >= MAX_FEHLVERSUCHE
      ? new Date(jetzt.getTime() + SPERRDAUER_MINUTEN * 60000)
      : null;
  return { versuche, lockedUntil };
}

// Das Token geht an den Benutzer, gespeichert wird nur sein Hash – ein
// Datenbank-Leak erlaubt damit keine Passwort-Zurücksetzung.
/**
 * @param {Date} [jetzt]
 * @returns {import('../types').ResetTokenErgebnis}
 */
function erzeugeResetToken(jetzt = new Date()) {
  const token = crypto.randomBytes(32).toString('hex');
  return {
    token,
    tokenHash: hashResetToken(token),
    expiry: new Date(jetzt.getTime() + RESET_TOKEN_GUELTIGKEIT_MINUTEN * 60000),
  };
}

/** @param {string} token */
function hashResetToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

module.exports = {
  MAX_FEHLVERSUCHE,
  SPERRDAUER_MINUTEN,
  RESET_TOKEN_GUELTIGKEIT_MINUTEN,
  istGesperrt,
  verbleibendeSperrminuten,
  naechsterFehlversuch,
  erzeugeResetToken,
  hashResetToken,
};
