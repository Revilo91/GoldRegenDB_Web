// @ts-check
'use strict';

const fs = require('fs');
const path = require('path');

const STANDARD_MAX_ALTER_STUNDEN = 26;
const STUNDE_MS = 60 * 60 * 1000;
const STATUS_DATEINAME = 'backup-status.json';

/** @typedef {'ok' | 'veraltet' | 'fehler' | 'unbekannt'} BackupStatus */

/** @param {unknown} wert @returns {number} */
function maxAlterStunden(wert) {
  const zahl = Number(wert);
  return wert !== undefined && wert !== '' && Number.isFinite(zahl) && zahl > 0 ? zahl : STANDARD_MAX_ALTER_STUNDEN;
}

// Nur das Status-Wort verlässt diese Funktion: /api/health ist öffentlich.
/**
 * @param {{ datei?: string, jetzt?: Date, maxAlterStunden?: unknown }} [optionen]
 * @returns {BackupStatus}
 */
function ermittleBackupStatus(optionen = {}) {
  const datei = optionen.datei
    || process.env.BACKUP_STATUS_DATEI
    || path.join(process.env.BACKUP_DIR || '/backups', STATUS_DATEINAME);
  const jetzt = optionen.jetzt || new Date();
  const grenzeMs = maxAlterStunden(optionen.maxAlterStunden ?? process.env.BACKUP_MAX_ALTER_STUNDEN) * STUNDE_MS;

  try {
    const status = JSON.parse(fs.readFileSync(datei, 'utf8'));
    if (status === null || typeof status !== 'object' || Array.isArray(status)) return 'unbekannt';
    const zeitpunkt = typeof status.zeitpunkt === 'string' ? Date.parse(status.zeitpunkt) : NaN;
    if (Number.isNaN(zeitpunkt)) return 'unbekannt';
    if (status.ergebnis === 'fehler') return 'fehler';
    if (status.ergebnis !== 'ok') return 'unbekannt';
    return jetzt.getTime() - zeitpunkt <= grenzeMs ? 'ok' : 'veraltet';
  } catch {
    // Fehlende oder kaputte Datei darf /api/health nie stören.
    return 'unbekannt';
  }
}

module.exports = { ermittleBackupStatus, STANDARD_MAX_ALTER_STUNDEN };
