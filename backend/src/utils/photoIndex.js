const fs = require('fs');
const path = require('path');

const uploadsDir = path.join(__dirname, '../assets/uploads');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Verzeichnis-Index statt readdirSync pro Datensatz: Die Listenansicht löst
// resolvePhotoFile für jede Zeile ohne Foto-Spalte aus – bei 50 Zeilen waren das
// 50 synchrone Verzeichnis-Scans, die den Event-Loop blockierten.
let cache = { names: new Set(), byBaseName: new Map(), mtimeMs: -1, checkedAt: 0 };

// Erneutes stat() höchstens einmal pro Sekunde; Uploads/Löschungen rufen
// zusätzlich invalidate() auf, sodass Änderungen sofort sichtbar sind.
const STAT_INTERVAL_MS = 1000;

function getIndex() {
  const now = Date.now();
  if (now - cache.checkedAt < STAT_INTERVAL_MS) return cache;
  cache.checkedAt = now;

  let mtimeMs;
  try {
    mtimeMs = fs.statSync(uploadsDir).mtimeMs;
  } catch {
    return cache;
  }
  if (mtimeMs === cache.mtimeMs) return cache;

  const files = fs.readdirSync(uploadsDir);
  const byBaseName = new Map();
  for (const file of files) {
    const base = path.parse(file).name;
    if (!byBaseName.has(base)) byBaseName.set(base, file);
  }
  cache = { names: new Set(files), byBaseName, mtimeMs, checkedAt: now };
  return cache;
}

function invalidate() {
  cache = { names: new Set(), byBaseName: new Map(), mtimeMs: -1, checkedAt: 0 };
}

// Löst Artikelnummer oder Dateiname zu einer existierenden Fotodatei auf
function resolvePhotoFile(identifier) {
  const requestedFileName = path.basename(String(identifier || '').trim());

  if (!requestedFileName) {
    return { error: 'Ungültiger Dateiname', requestedFileName };
  }

  const index = getIndex();

  // 1. Direkter Match falls vorhanden (z.B. "MXO002.jpg")
  if (index.names.has(requestedFileName)) {
    return {
      filePath: path.join(uploadsDir, requestedFileName),
      resolvedFileName: requestedFileName,
      resolvedBy: 'exact',
    };
  }

  // 2. Suche nach Basis-Artikelnummer (ohne Suffix _1, _2 oder Dateiendung)
  const baseName = path.parse(requestedFileName.split('_')[0]).name;
  const match = index.byBaseName.get(baseName);

  if (match) {
    return {
      filePath: path.join(uploadsDir, match),
      resolvedFileName: match,
      resolvedBy: match === requestedFileName ? 'exact' : 'basename',
    };
  }

  return {
    error: 'Foto nicht gefunden',
    requestedFileName,
    baseName,
    matchingFiles: [],
    availableFiles: index.names.size,
  };
}

module.exports = { uploadsDir, resolvePhotoFile, invalidate };
