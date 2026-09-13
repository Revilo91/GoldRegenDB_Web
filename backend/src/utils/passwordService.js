const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const BCRYPT_ROUNDS = 10;

// Mindestlänge für neu gesetzte Passwörter. Vorher wurden Passwörter im Browser
// SHA-256-gehasht, sodass am Backend jede Eingabe als 64 Zeichen ankam und eine
// Längenprüfung wirkungslos war.
const MIN_PASSWORT_LAENGE = 8;
const MAX_PASSWORT_LAENGE = 200;

// Dummy-Hash für nicht existierende Benutzer, damit bcrypt.compare auch dann
// läuft und die Antwortzeit keine Benutzernamen preisgibt.
// Entspricht bcrypt('goldregen_dummy_password', 10) – trifft nie ein echtes Passwort.
const DUMMY_HASH = '$2b$10$R.TDJCrjRGLI2JqsouPWpegc/JtNCODKyAbCawKH/moXb.jOmDY1u';

function hashPassword(klartext) {
  return bcrypt.hash(klartext, BCRYPT_ROUNDS);
}

// Bis Issue #131 hashte das Frontend das Passwort mit SHA-256 und das Backend
// legte bcrypt(sha256(passwort)) ab. Bestehende Konten tragen diesen Hash noch,
// deshalb wird er beim Login zusätzlich geprüft.
function legacySha256(klartext) {
  return crypto.createHash('sha256').update(klartext, 'utf8').digest('hex');
}

/**
 * Prüft ein Klartext-Passwort gegen einen gespeicherten bcrypt-Hash.
 *
 * @returns {Promise<{valid: boolean, needsRehash: boolean}>}
 *   needsRehash ist true, wenn der Treffer nur über das alte
 *   bcrypt(sha256(...))-Schema zustande kam. Der Aufrufer sollte den Hash dann
 *   auf das neue Schema umstellen.
 */
async function verifyPassword(klartext, gespeicherterHash) {
  const hash = gespeicherterHash || DUMMY_HASH;

  try {
    if (await bcrypt.compare(klartext, hash)) {
      return { valid: true, needsRehash: false };
    }
    if (await bcrypt.compare(legacySha256(klartext), hash)) {
      return { valid: true, needsRehash: true };
    }
  } catch {
    return { valid: false, needsRehash: false };
  }

  return { valid: false, needsRehash: false };
}

module.exports = {
  hashPassword,
  verifyPassword,
  legacySha256,
  BCRYPT_ROUNDS,
  MIN_PASSWORT_LAENGE,
  MAX_PASSWORT_LAENGE,
};
