'use strict';

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));
jest.mock('bcryptjs', () => ({ hash: jest.fn() }));

const fs = require('fs');
const os = require('os');
const path = require('path');
const logger = require('../src/utils/logger');
const {
  erstelleSqlSicherung,
  BEHALTENE_SICHERUNGEN,
  AUFBEWAHRUNG_TAGE,
  MINDEST_FREI_BYTES,
  RESERVE_BYTES,
  SICHERUNG_DATEI_MUSTER,
} = require('../src/services/sqlSicherung');

const DB_URL = 'postgresql://goldregen:geh%40eim@db:5432/goldregendb';

let zielDir;

const dateiName = (n) => `goldregendb_manuell_2026-10-0${n}T10-00-00-000Z.dump`;

// pg_dump-Attrappe: schreibt wie das echte Programm in die --file-Datei.
function execMitDatei(inhalt = 'PGDMP-Daten') {
  const fn = jest.fn((cmd, args, opts, cb) => {
    const ziel = args.find((a) => a.startsWith('--file=')).slice('--file='.length);
    fs.writeFileSync(ziel, inhalt);
    cb(null, '', '');
  });
  return fn;
}

// Hält pg_dump an, bis der Test es freigibt (Lauf im Hintergrund).
function execOffen() {
  const steuerung = { frei: null };
  const fn = jest.fn((cmd, args, opts, cb) => {
    const ziel = args.find((a) => a.startsWith('--file=')).slice('--file='.length);
    fs.writeFileSync(ziel, 'teil');
    steuerung.frei = (err) => cb(err || null, '', err ? err.stderr : '');
  });
  fn.steuerung = steuerung;
  return fn;
}

const dienst = (optionen = {}) =>
  erstelleSqlSicherung({
    connectionString: DB_URL,
    env: { MANUAL_BACKUP_DIR: zielDir },
    execFileImpl: execMitDatei(),
    statfsImpl: async () => ({ bavail: Number.MAX_SAFE_INTEGER / 4096, bsize: 4096 }),
    ...optionen,
  });

const warteAufEnde = async (d) => {
  for (let i = 0; i < 200 && d.status().status === 'running'; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return d.status();
};

beforeEach(() => {
  jest.clearAllMocks();
  zielDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sqlsicherung-')), 'manual');
});

afterEach(() => {
  fs.rmSync(path.dirname(zielDir), { recursive: true, force: true });
});

describe('Dateinamen-Muster', () => {
  it('erkennt nur eigene fertige Dumps', () => {
    expect(SICHERUNG_DATEI_MUSTER.test(dateiName(1))).toBe(true);
    expect(SICHERUNG_DATEI_MUSTER.test(`${dateiName(1)}.tmp`)).toBe(false);
    expect(SICHERUNG_DATEI_MUSTER.test('vor_migration_0002_x.dump')).toBe(false);
    expect(SICHERUNG_DATEI_MUSTER.test('../goldregendb_manuell_2026-10-01T10-00-00-000Z.dump')).toBe(false);
    expect(SICHERUNG_DATEI_MUSTER.test('notizen.txt')).toBe(false);
  });
});

describe('status vor dem ersten Lauf', () => {
  it('ist idle ohne Zeiten, Datei und Fehler', () => {
    expect(dienst().status()).toEqual({
      status: 'idle',
      gestartetAm: null,
      beendetAm: null,
      datei: null,
      groesse: null,
      fehler: null,
    });
  });
});

describe('starte – Erfolgspfad', () => {
  it('schreibt pg_dump per --file in eine .tmp-Datei, benennt sie um und meldet Größe', async () => {
    const execFileImpl = execMitDatei('0123456789');
    const d = dienst({ execFileImpl });

    const start = d.starte();
    expect(start.gestartet).toBe(true);
    expect(start.stand.status).toBe('running');
    expect(start.stand.gestartetAm).toEqual(expect.any(String));

    const stand = await warteAufEnde(d);

    expect(stand.status).toBe('completed');
    expect(stand.fehler).toBeNull();
    expect(stand.beendetAm).toEqual(expect.any(String));
    expect(stand.groesse).toBe(10);
    expect(stand.datei).toMatch(SICHERUNG_DATEI_MUSTER);
    expect(fs.readdirSync(zielDir)).toEqual([stand.datei]);

    const [cmd, args] = execFileImpl.mock.calls[0];
    expect(cmd).toBe('pg_dump');
    expect(args).toContain(`--file=${path.join(zielDir, stand.datei)}.tmp`);
    expect(args).toContain('--format=custom');
  });

  it('übergibt das Passwort nur per Umgebung, nie in Argumenten, Status oder Log', async () => {
    const execFileImpl = execMitDatei();
    const d = dienst({ execFileImpl });

    d.starte();
    const stand = await warteAufEnde(d);

    const [, args, opts] = execFileImpl.mock.calls[0];
    expect(opts.env.PGPASSWORD).toBe('geh@eim');
    expect(args.join(' ')).not.toContain('geh');
    expect(JSON.stringify(stand)).not.toContain('geh');
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('geh');
  });

  it('legt das Zielverzeichnis an, falls es fehlt', async () => {
    const d = dienst();
    d.starte();
    await warteAufEnde(d);
    expect(fs.statSync(zielDir).isDirectory()).toBe(true);
  });
});

describe('starte – paralleler Lauf', () => {
  it('lehnt einen zweiten Start ab, solange pg_dump läuft, und erlaubt danach wieder einen', async () => {
    const execFileImpl = execOffen();
    const d = dienst({ execFileImpl });

    expect(d.starte().gestartet).toBe(true);
    const zweiter = d.starte();
    expect(zweiter.gestartet).toBe(false);
    expect(zweiter.stand.status).toBe('running');

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(execFileImpl).toHaveBeenCalledTimes(1);
    execFileImpl.steuerung.frei();
    await warteAufEnde(d);

    expect(d.starte().gestartet).toBe(true);
  });
});

describe('starte – Fehlerpfade', () => {
  it('entfernt die .tmp-Datei und meldet einen Fehler ohne Pfade und Details', async () => {
    const execFileImpl = jest.fn((cmd, args, opts, cb) => {
      const ziel = args.find((a) => a.startsWith('--file=')).slice('--file='.length);
      fs.writeFileSync(ziel, 'halb');
      const err = new Error('Command failed');
      err.stderr = `pg_dump: error: connection to server at "db" failed (${ziel})\n`;
      cb(err, '', err.stderr);
    });
    const d = dienst({ execFileImpl });

    d.starte();
    const stand = await warteAufEnde(d);

    expect(stand.status).toBe('failed');
    expect(stand.datei).toBeNull();
    expect(stand.beendetAm).toEqual(expect.any(String));
    expect(stand.fehler).toMatch(/pg_dump fehlgeschlagen/);
    expect(stand.fehler).not.toContain(zielDir);
    expect(stand.fehler).not.toContain('connection to server');
    expect(fs.readdirSync(zielDir)).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      'BACKUP',
      expect.any(String),
      expect.objectContaining({ message: expect.stringContaining('connection to server') }),
    );
  });

  it('meldet fehlendes pg_dump verständlich', async () => {
    const execFileImpl = jest.fn((cmd, args, opts, cb) => {
      const err = new Error('spawn pg_dump ENOENT');
      err.code = 'ENOENT';
      cb(err, '', '');
    });
    const d = dienst({ execFileImpl });

    d.starte();
    const stand = await warteAufEnde(d);

    expect(stand.status).toBe('failed');
    expect(stand.fehler).toMatch(/pg_dump nicht gefunden/);
  });

  it('meldet ein nicht beschreibbares Zielverzeichnis ohne Pfad', async () => {
    const datei = path.join(path.dirname(zielDir), 'ist-eine-datei');
    fs.writeFileSync(datei, 'x');
    const execFileImpl = execMitDatei();
    const d = dienst({ env: { MANUAL_BACKUP_DIR: path.join(datei, 'manual') }, execFileImpl });

    d.starte();
    const stand = await warteAufEnde(d);

    expect(stand.status).toBe('failed');
    expect(stand.fehler).toMatch(/Zielordner/);
    expect(stand.fehler).not.toContain(datei);
    expect(execFileImpl).not.toHaveBeenCalled();
  });

  it('meldet fehlende Datenbank-URL', async () => {
    const d = dienst({ connectionString: undefined });
    d.starte();
    const stand = await warteAufEnde(d);
    expect(stand.status).toBe('failed');
    expect(stand.fehler).toMatch(/Datenbank/);
  });

  it('meldet Zeitüberschreitung', async () => {
    const execFileImpl = jest.fn((cmd, args, opts, cb) => {
      const err = new Error('Command failed');
      err.killed = true;
      err.signal = 'SIGTERM';
      cb(err, '', '');
    });
    const d = dienst({ execFileImpl });
    d.starte();
    const stand = await warteAufEnde(d);
    expect(stand.fehler).toMatch(/Zeit/);
  });

  it('erlaubt nach einem Fehler einen neuen Lauf', async () => {
    const kaputt = jest.fn((cmd, args, opts, cb) => cb(new Error('x'), '', 'boom'));
    const d = dienst({ execFileImpl: kaputt });
    d.starte();
    await warteAufEnde(d);
    expect(d.starte().gestartet).toBe(true);
    await warteAufEnde(d);
  });
});

describe('verwaiste .tmp-Dateien', () => {
  it('räumt eigene .tmp-Reste vom abgebrochenen Lauf beim nächsten Start weg, fremde nicht', async () => {
    fs.mkdirSync(zielDir, { recursive: true });
    const rest = `${dateiName(1)}.tmp`;
    fs.writeFileSync(path.join(zielDir, rest), 'halb');
    fs.writeFileSync(path.join(zielDir, 'fremd.tmp'), 'bleibt');
    fs.writeFileSync(path.join(zielDir, 'notizen.txt'), 'bleibt');

    const d = dienst();
    d.starte();
    const stand = await warteAufEnde(d);

    const dateien = fs.readdirSync(zielDir).sort();
    expect(dateien).toEqual(['fremd.tmp', 'notizen.txt', stand.datei].sort());
  });
});

describe('Rotation', () => {
  it('behält die letzten drei fertigen Dumps und löscht nur Dateien mit dem eigenen Namensmuster', async () => {
    expect(BEHALTENE_SICHERUNGEN).toBe(3);
    fs.mkdirSync(zielDir, { recursive: true });
    for (const n of [1, 2, 3, 4]) fs.writeFileSync(path.join(zielDir, dateiName(n)), 'alt');
    for (const fremd of ['vor_migration_0002_x.dump', 'notizen.txt', 'goldregendb_manuell_x.dump']) {
      fs.writeFileSync(path.join(zielDir, fremd), 'fremd');
    }

    const d = dienst();
    d.starte();
    const stand = await warteAufEnde(d);

    expect(stand.status).toBe('completed');
    expect(fs.readdirSync(zielDir).sort()).toEqual(
      [
        dateiName(3),
        dateiName(4),
        stand.datei,
        'vor_migration_0002_x.dump',
        'notizen.txt',
        'goldregendb_manuell_x.dump',
      ].sort(),
    );
  });

  it('lässt das Backup gültig, wenn die Rotation scheitert, und loggt den Fehler', async () => {
    fs.mkdirSync(zielDir, { recursive: true });
    for (const n of [1, 2, 3, 4]) fs.writeFileSync(path.join(zielDir, dateiName(n)), 'alt');
    const unlinkSpy = jest.spyOn(fs.promises, 'unlink').mockRejectedValue(new Error('EPERM'));

    try {
      const d = dienst();
      d.starte();
      const stand = await warteAufEnde(d);

      expect(stand.status).toBe('completed');
      expect(stand.fehler).toBeNull();
      expect(fs.existsSync(path.join(zielDir, stand.datei))).toBe(true);
      expect(logger.error).toHaveBeenCalledWith(
        'BACKUP',
        expect.stringMatching(/Rotation/),
        expect.objectContaining({ message: 'EPERM' }),
      );
    } finally {
      unlinkSpy.mockRestore();
    }
  });
});

describe('Dateirechte (Dumps enthalten Kundendaten)', () => {
  const modus = (pfad) => fs.statSync(pfad).mode & 0o777;

  it('legt Ordner mit 0700 und Dump mit 0600 an', async () => {
    const d = dienst();
    d.starte();
    const stand = await warteAufEnde(d);

    expect(stand.status).toBe('completed');
    expect(modus(zielDir)).toBe(0o700);
    expect(modus(path.join(zielDir, stand.datei))).toBe(0o600);
  });

  it('schützt die .tmp-Datei schon, bevor pg_dump startet', async () => {
    let modusBeimStart = null;
    const execFileImpl = jest.fn((cmd, args, opts, cb) => {
      const ziel = args.find((a) => a.startsWith('--file=')).slice('--file='.length);
      modusBeimStart = modus(ziel);
      fs.writeFileSync(ziel, 'PGDMP-Daten');
      cb(null, '', '');
    });
    const d = dienst({ execFileImpl });
    d.starte();
    await warteAufEnde(d);

    expect(modusBeimStart).toBe(0o600);
  });

  it('korrigiert die Rechte eines vorhandenen Ordners', async () => {
    fs.mkdirSync(zielDir, { mode: 0o755 });
    fs.chmodSync(zielDir, 0o755);
    const d = dienst();
    d.starte();
    await warteAufEnde(d);

    expect(modus(zielDir)).toBe(0o700);
  });

  it('folgt keinem untergeschobenen Symlink auf die .tmp-Datei', async () => {
    fs.mkdirSync(zielDir, { recursive: true });
    const opfer = path.join(path.dirname(zielDir), 'opfer');
    fs.writeFileSync(opfer, 'unverändert');
    const zeit = new Date('2026-10-01T10:00:00.000Z');
    const tmpName = `goldregendb_manuell_${zeit.toISOString().replace(/[:.]/g, '-')}.dump.tmp`;
    const execFileImpl = execMitDatei('ueberschrieben');
    // Nach dem Aufräumen untergeschoben: open() wird als erste Aktion danach gerufen.
    const echtesOpen = fs.promises.open;
    const spion = jest.spyOn(fs.promises, 'open').mockImplementation((pfad, ...rest) => {
      if (String(pfad).endsWith('.dump.tmp')) fs.symlinkSync(opfer, path.join(zielDir, tmpName));
      return echtesOpen(pfad, ...rest);
    });
    try {
      const d = dienst({ execFileImpl, jetzt: () => zeit });
      d.starte();
      const stand = await warteAufEnde(d);

      expect(stand.status).toBe('failed');
      expect(execFileImpl).not.toHaveBeenCalled();
      expect(fs.readFileSync(opfer, 'utf8')).toBe('unverändert');
    } finally {
      spion.mockRestore();
    }
  });
});

describe('Altersgrenze', () => {
  const JETZT = new Date('2026-11-01T12:00:00.000Z');
  const TAG_MS = 24 * 60 * 60 * 1000;

  const legeAn = (name, alterTage) => {
    fs.mkdirSync(zielDir, { recursive: true });
    const pfad = path.join(zielDir, name);
    fs.writeFileSync(pfad, 'alt');
    const zeit = new Date(JETZT.getTime() - alterTage * TAG_MS);
    fs.utimesSync(pfad, zeit, zeit);
  };

  it('löscht Dumps über der Frist auch ohne neuen Lauf, jüngere bleiben', async () => {
    legeAn(dateiName(1), AUFBEWAHRUNG_TAGE + 1);
    legeAn(dateiName(2), AUFBEWAHRUNG_TAGE - 1);

    await dienst({ jetzt: () => JETZT }).raeumeAuf();

    expect(fs.readdirSync(zielDir)).toEqual([dateiName(2)]);
  });

  it('löscht bei einem Lauf auch abgelaufene Dumps innerhalb der letzten 3', async () => {
    legeAn(dateiName(1), AUFBEWAHRUNG_TAGE + 1);
    const d = dienst({ jetzt: () => JETZT });
    d.starte();
    const stand = await warteAufEnde(d);

    expect(fs.readdirSync(zielDir)).toEqual([stand.datei]);
  });

  it('lässt fremde Dateien über der Frist liegen', async () => {
    legeAn('fremd.dump', AUFBEWAHRUNG_TAGE + 1);

    await dienst({ jetzt: () => JETZT }).raeumeAuf();

    expect(fs.readdirSync(zielDir)).toEqual(['fremd.dump']);
  });

  it('meldet keinen Fehler, solange der Ordner nicht existiert', async () => {
    await dienst().raeumeAuf();

    expect(logger.error).not.toHaveBeenCalled();
  });

  it('räumt beim Start sofort und danach täglich auf', async () => {
    legeAn(dateiName(1), AUFBEWAHRUNG_TAGE + 1);
    const unref = jest.fn();
    const setIntervalImpl = jest.fn(() => ({ unref }));

    await dienst({ jetzt: () => JETZT }).starteAufraeumen(setIntervalImpl);

    expect(fs.readdirSync(zielDir)).toEqual([]);
    expect(setIntervalImpl).toHaveBeenCalledWith(expect.any(Function), TAG_MS);
    expect(unref).toHaveBeenCalled();
  });
});

describe('Platz-Check', () => {
  const GIB = 1024 ** 3;
  const freierPlatz = (bytes) => jest.fn().mockResolvedValue({ bavail: bytes / 4096, bsize: 4096 });

  it('startet pg_dump nicht unter der Untergrenze und meldet es verständlich', async () => {
    const execFileImpl = execMitDatei();
    const d = dienst({ execFileImpl, statfsImpl: freierPlatz(MINDEST_FREI_BYTES - 4096) });
    d.starte();
    const stand = await warteAufEnde(d);

    expect(stand.status).toBe('failed');
    expect(stand.fehler).toMatch(/Speicherplatz/);
    expect(stand.fehler).not.toContain(zielDir);
    expect(execFileImpl).not.toHaveBeenCalled();
    expect(fs.readdirSync(zielDir)).toEqual([]);
  });

  it('läuft mit genug Platz', async () => {
    const d = dienst({ statfsImpl: freierPlatz(MINDEST_FREI_BYTES) });
    d.starte();

    expect((await warteAufEnde(d)).status).toBe('completed');
  });

  it('rechnet mit der Größe des größten vorhandenen Dumps plus Reserve', async () => {
    fs.mkdirSync(zielDir, { recursive: true });
    const vorhanden = path.join(zielDir, dateiName(1));
    fs.writeFileSync(vorhanden, 'x');
    fs.truncateSync(vorhanden, 5 * GIB); // Datei mit Loch, belegt keinen Platz
    const execFileImpl = execMitDatei();
    const d = dienst({ execFileImpl, statfsImpl: freierPlatz(5 * GIB + RESERVE_BYTES - 4096) });
    d.starte();
    const stand = await warteAufEnde(d);

    expect(stand.status).toBe('failed');
    expect(execFileImpl).not.toHaveBeenCalled();
    expect(fs.existsSync(vorhanden)).toBe(true);
  });

  it('bricht ab, wenn der freie Platz nicht ermittelbar ist', async () => {
    const execFileImpl = execMitDatei();
    const statfsImpl = jest.fn().mockRejectedValue(new Error('ENOSYS'));
    const d = dienst({ execFileImpl, statfsImpl });
    d.starte();

    expect((await warteAufEnde(d)).status).toBe('failed');
    expect(execFileImpl).not.toHaveBeenCalled();
  });
});
