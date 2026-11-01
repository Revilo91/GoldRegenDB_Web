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
// Dumps enthalten auch Daten später anonymisierter Kunden, deshalb zusätzlich eine Frist.
const AUFBEWAHRUNG_TAGE = 30;
const TAG_MS = 24 * 60 * 60 * 1000;
// Dumps liegen auf derselben Platte wie die Datenbank; läuft sie voll, kann
// PostgreSQL abstürzen. Ohne vorhandenen Dump gilt die Untergrenze (Fotos ca. 1,6 GB).
const GIB = 1024 ** 3;
const RESERVE_BYTES = 2 * GIB;
const MINDEST_FREI_BYTES = 4 * GIB;
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
  if (err.zuWenigPlatz) return 'Zu wenig freier Speicherplatz für die Sicherung';
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
  statfsImpl = fs.promises.statfs,
}) {
  let stand = { ...LEERER_STAND };

  const status = () => ({ ...stand });

  async function rotiere(dir) {
    try {
      const fertige = (await listeDateien(dir, SICHERUNG_DATEI_MUSTER)).sort().reverse();
      // Auch Reste abgebrochener Läufe enthalten Kundendaten. Ein laufender Dump
      // ist nie betroffen, er bricht nach DUMP_TIMEOUT_MS ab.
      const reste = await listeDateien(dir, SICHERUNG_TMP_MUSTER);
      const grenze = jetzt().getTime() - AUFBEWAHRUNG_TAGE * TAG_MS;
      for (const [index, name] of [...fertige, ...reste].entries()) {
        try {
          const pfad = path.join(dir, name);
          const { mtimeMs } = await fs.promises.stat(pfad);
          const ueberzaehlig = index >= BEHALTENE_SICHERUNGEN && index < fertige.length;
          if (ueberzaehlig || mtimeMs < grenze) {
            await fs.promises.unlink(pfad);
          }
        } catch (err) {
          // Der tägliche Lauf und eine Rotation können dieselbe Datei erwischen.
          if (err.code === 'ENOENT') continue;
          logger.error('BACKUP', 'Rotation: alte Sicherung nicht gelöscht', { datei: name, message: err.message });
        }
      }
    } catch (err) {
      // Vor der ersten Sicherung gibt es den Ordner noch nicht.
      if (err.code === 'ENOENT') return;
      logger.error('BACKUP', 'Rotation der manuellen Sicherungen fehlgeschlagen', { message: err.message });
    }
  }

  async function pruefePlatz(dir) {
    let groesster = 0;
    for (const name of await listeDateien(dir, SICHERUNG_DATEI_MUSTER)) {
      const { size } = await fs.promises.stat(path.join(dir, name));
      groesster = Math.max(groesster, size);
    }
    const noetig = Math.max(MINDEST_FREI_BYTES, groesster + RESERVE_BYTES);
    const { bavail, bsize } = await statfsImpl(dir);
    const frei = bavail * bsize;
    if (frei < noetig) {
      throw Object.assign(new Error(`Zu wenig Platz: ${frei} Bytes frei, ${noetig} nötig`), { zuWenigPlatz: true });
    }
  }

  async function bereiteZielvor(dir, temporaer) {
    try {
      // Dumps enthalten Kundendaten. chmod zusätzlich, weil mode bei einem
      // vorhandenen Ordner nicht greift.
      await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
      await fs.promises.chmod(dir, 0o700);
      // Reste eines Laufs, der mit dem Container starb. Es läuft nie mehr als
      // ein Lauf, also gehört jede passende .tmp-Datei zu einem toten.
      for (const name of await listeDateien(dir, SICHERUNG_TMP_MUSTER)) {
        await fs.promises.rm(path.join(dir, name), { force: true });
      }
      await pruefePlatz(dir);
      // pg_dump übernimmt beim Überschreiben den Modus; 'wx' folgt keinem Symlink.
      const datei = await fs.promises.open(temporaer, 'wx', 0o600);
      await datei.close();
    } catch (err) {
      if (!err.zuWenigPlatz) err.zielordner = true;
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
      await bereiteZielvor(dir, temporaer);
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
    lauf(zielordner());
    return { gestartet: true, stand: status() };
  }

  const zielordner = () => env.MANUAL_BACKUP_DIR || DEFAULT_SICHERUNG_DIR;

  // Die Frist muss auch greifen, wenn nie wieder jemand "Jetzt sichern" klickt.
  const raeumeAuf = () => rotiere(zielordner());

  async function starteAufraeumen(setIntervalImpl = setInterval) {
    setIntervalImpl(raeumeAuf, TAG_MS).unref();
    await raeumeAuf();
  }

  return { starte, status, raeumeAuf, starteAufraeumen };
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
  AUFBEWAHRUNG_TAGE,
  MINDEST_FREI_BYTES,
  RESERVE_BYTES,
  SICHERUNG_DATEI_MUSTER,
  DEFAULT_SICHERUNG_DIR,
};
