'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const logger = require('../utils/logger');
const { pgDumpInvocation, runExecFile, backupFailureMessage } = require('../config/migrate');

// Manuelle Sicherung per "Jetzt sichern" (Issue #289): pg_dump läuft im
// Hintergrund direkt in eine Datei – bei rund 1,6 GB Fotos wäre ein offener
// Request zu lang, und der Dump darf nicht in den Speicher.

const DEFAULT_SICHERUNG_DIR = '/backups/manual';
const BEHALTENE_SICHERUNGEN = 3;
const DUMP_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const ZEITSTEMPEL = '\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z';
const DATEI_PRAEFIX = 'goldregendb_manuell_';
// Strenges Muster: die Rotation löscht nur, was dieser Dienst selbst angelegt hat.
const SICHERUNG_DATEI_MUSTER = new RegExp(`^${DATEI_PRAEFIX}${ZEITSTEMPEL}\\.dump$`);
const SICHERUNG_TMP_MUSTER = new RegExp(`^${DATEI_PRAEFIX}${ZEITSTEMPEL}\\.dump\\.tmp$`);

const LEERER_STAND = {
  status: 'idle',
  gestartetAm: null,
  beendetAm: null,
  datei: null,
  groesse: null,
  fehler: null,
};

// Kein Roh-Fehlertext (Pfade, Verbindungsdaten) an den Client: Details stehen im Log.
function clientFehler(err) {
  if (err.zielordner) return 'Zielordner nicht beschreibbar (MANUAL_BACKUP_DIR prüfen)';
  if (err.code === 'ENOENT') return 'pg_dump nicht gefunden (postgresql-client installieren)';
  if (err.killed) return 'pg_dump wurde nach Zeitüberschreitung abgebrochen';
  if (err.keineDatenbank) return 'Keine Datenbank-URL konfiguriert';
  return 'pg_dump fehlgeschlagen (Details im Server-Log)';
}

async function listeDateien(dir, muster) {
  const namen = (await fs.promises.readdir(dir)).filter((name) => muster.test(name));
  return namen;
}

function erstelleSqlSicherung({
  connectionString,
  env = process.env,
  execFileImpl = execFile,
  jetzt = () => new Date(),
}) {
  let stand = { ...LEERER_STAND };

  const status = () => ({ ...stand });

  async function rotiere(dir) {
    try {
      const fertige = (await listeDateien(dir, SICHERUNG_DATEI_MUSTER)).sort().reverse();
      for (const name of fertige.slice(BEHALTENE_SICHERUNGEN)) {
        try {
          await fs.promises.unlink(path.join(dir, name));
        } catch (err) {
          logger.error('BACKUP', 'Rotation: alte Sicherung nicht gelöscht', { datei: name, message: err.message });
        }
      }
    } catch (err) {
      logger.error('BACKUP', 'Rotation der manuellen Sicherungen fehlgeschlagen', { message: err.message });
    }
  }

  async function bereiteZielvor(dir) {
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      // Reste eines Laufs, der mit dem Container starb. Es läuft nie mehr als
      // ein Lauf, also gehört jede passende .tmp-Datei zu einem toten.
      for (const name of await listeDateien(dir, SICHERUNG_TMP_MUSTER)) {
        await fs.promises.rm(path.join(dir, name), { force: true });
      }
    } catch (err) {
      err.zielordner = true;
      throw err;
    }
  }

  async function lauf(dir) {
    const name = `${DATEI_PRAEFIX}${jetzt().toISOString().replace(/[:.]/g, '-')}.dump`;
    const endgueltig = path.join(dir, name);
    const temporaer = `${endgueltig}.tmp`;
    try {
      if (!connectionString) {
        throw Object.assign(new Error('keine Datenbank-URL konfiguriert'), { keineDatenbank: true });
      }
      await bereiteZielvor(dir);
      const { args, env: dumpEnv } = pgDumpInvocation(connectionString, temporaer);
      await runExecFile(execFileImpl, 'pg_dump', args, {
        env: dumpEnv,
        maxBuffer: 10 * 1024 * 1024,
        timeout: DUMP_TIMEOUT_MS,
      });
      const { size } = await fs.promises.stat(temporaer);
      await fs.promises.rename(temporaer, endgueltig);
      // Erst rotieren, dann "completed" melden: sonst könnte ein neuer Lauf
      // starten, während die Rotation des alten noch löscht. rotiere() wirft nie.
      await rotiere(dir);
      stand = { ...stand, status: 'completed', beendetAm: jetzt().toISOString(), datei: name, groesse: size };
      logger.info('BACKUP', 'Manuelle Sicherung erstellt', { datei: name, groesse: size });
    } catch (err) {
      // Ein halb geschriebener Dump sähe wie ein gültiges Backup aus.
      await fs.promises.rm(temporaer, { force: true }).catch(() => {});
      logger.error('BACKUP', 'Manuelle Sicherung fehlgeschlagen', { message: backupFailureMessage(err) });
      stand = { ...stand, status: 'failed', beendetAm: jetzt().toISOString(), fehler: clientFehler(err) };
    }
  }

  function starte() {
    if (stand.status === 'running') return { gestartet: false, stand: status() };
    stand = { ...LEERER_STAND, status: 'running', gestartetAm: jetzt().toISOString() };
    lauf(env.MANUAL_BACKUP_DIR || DEFAULT_SICHERUNG_DIR);
    return { gestartet: true, stand: status() };
  }

  return { starte, status };
}

// Ein Dienst pro Prozess: der Zustand liegt im Speicher.
const sqlSicherung = (() => {
  let instanz;
  return () => {
    if (!instanz) {
      // Lazy, damit der Test-Mock von db.js (ohne connectionString) das Laden nicht stört.
      instanz = erstelleSqlSicherung({ connectionString: require('../config/db').connectionString });
    }
    return instanz;
  };
})();

module.exports = {
  erstelleSqlSicherung,
  sqlSicherung,
  BEHALTENE_SICHERUNGEN,
  SICHERUNG_DATEI_MUSTER,
  DEFAULT_SICHERUNG_DIR,
};
