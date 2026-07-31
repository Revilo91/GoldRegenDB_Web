const crypto = require('crypto');
const logger = require('./logger');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

const KEY_HEX = process.env.BESTELLUNG_ENCRYPTION_KEY;
if (!KEY_HEX) {
  logger.error('ENCRYPTION', 'FATAL: BESTELLUNG_ENCRYPTION_KEY Umgebungsvariable ist nicht gesetzt');
  process.exit(1);
}

const KEY = Buffer.from(KEY_HEX, 'hex');
if (KEY.length !== 32) {
  logger.error('ENCRYPTION', 'FATAL: BESTELLUNG_ENCRYPTION_KEY muss 32 Byte (64 Hex-Zeichen) lang sein, z.B. via: openssl rand -hex 32');
  process.exit(1);
}

// Verschlüsselt ein einzelnes Feld für die Speicherung als BYTEA.
// Layout: IV(12B) || AuthTag(16B) || Ciphertext – jeder Wert mit eigenem, zufälligem IV.
function encryptField(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === '') return null;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

// Entschlüsselt ein mit encryptField() erzeugtes BYTEA-Feld.
function decryptField(value) {
  if (!value) return null;
  const raw = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// SHA-256-Hash für Nachweiszwecke (z.B. Consent-IP) – niemals Klartext speichern.
function hashValue(value) {
  if (!value) return null;
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

module.exports = { encryptField, decryptField, hashValue };
