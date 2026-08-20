const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const bestellungFotosDir = path.join(__dirname, '../assets/uploads/bestellungen');

if (!fs.existsSync(bestellungFotosDir)) {
  fs.mkdirSync(bestellungFotosDir, { recursive: true });
}

const MAX_FOTO_BYTES = 5 * 1024 * 1024;
const ERLAUBTE_MIMES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif' };
const DATA_URL_REGEX = /^data:(image\/(?:jpeg|png|gif));base64,([A-Za-z0-9+/=]+)$/;

// Speichert ein als Data-URL übermitteltes Referenzfoto unter zufälligem Dateinamen
// (nie der clientseitige Dateiname – sonst Path-Traversal-Risiko) und gibt ihn zurück.
function speichereBestellungFoto(dataUrl) {
  const match = DATA_URL_REGEX.exec(dataUrl || '');
  if (!match) {
    throw new Error('Foto muss als JPG-, PNG- oder GIF-Bild übermittelt werden');
  }
  const [, mime, base64] = match;
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length > MAX_FOTO_BYTES) {
    throw new Error('Foto ist zu groß (max. 5 MB)');
  }
  const fileName = `${crypto.randomBytes(16).toString('hex')}${ERLAUBTE_MIMES[mime]}`;
  fs.writeFileSync(path.join(bestellungFotosDir, fileName), buffer);
  return fileName;
}

// Löst einen in der DB gespeicherten Dateinamen zu einem sicheren, absoluten Pfad auf.
function bestellungFotoPfad(fileName) {
  const cleanFileName = path.basename(String(fileName || '').trim());
  if (!cleanFileName) return null;
  return path.join(bestellungFotosDir, cleanFileName);
}

module.exports = { bestellungFotosDir, speichereBestellungFoto, bestellungFotoPfad };
