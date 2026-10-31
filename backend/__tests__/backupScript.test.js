'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SKRIPT = path.join(__dirname, '..', '..', 'db', 'backup.sh');
const PG_DUMP_OK = [
  '#!/bin/sh',
  'for t in Schmuckstück Kunde Rechnung Lieferschein audit_log app_users; do echo "CREATE TABLE public.\\"$t\\" ();"; done',
].join('\n');
const PG_DUMP_FEHLER = '#!/bin/sh\necho "pg_dump: connection refused" >&2\nexit 1\n';
const WERKZEUGE = ['bash', 'sh', 'date', 'mkdir', 'rm', 'mv', 'find', 'gzip', 'gunzip', 'grep', 'wc', 'du', 'cut', 'tr', 'sed', 'basename', 'env', 'cat'];

const findeProgramm = (name) => {
  const r = spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' });
  return r.stdout.trim();
};

describe('db/backup.sh (Status-Datei und Webhook, mit Attrappen)', () => {
  let wurzel;
  let bin;
  let backups;
  let aufrufe;

  const stub = (name, inhalt) => {
    const ziel = path.join(bin, name);
    fs.writeFileSync(ziel, inhalt, { mode: 0o755 });
  };
  const curlAttrappe = (exitCode = 0) => stub('curl', `#!/bin/sh\necho "$@" >> "${aufrufe}"\nexit ${exitCode}\n`);
  const wgetAttrappe = (exitCode = 0) => stub('wget', `#!/bin/sh\necho "$@" >> "${aufrufe}"\nexit ${exitCode}\n`);

  const lauf = (env = {}) => spawnSync('bash', [SKRIPT], {
    encoding: 'utf8',
    env: { PATH: bin, BACKUP_DIR: backups, MIN_BACKUP_BYTES: '20', ...env },
  });
  const status = () => JSON.parse(fs.readFileSync(path.join(backups, 'backup-status.json'), 'utf8'));
  const webhookAufrufe = () => (fs.existsSync(aufrufe) ? fs.readFileSync(aufrufe, 'utf8') : '');

  beforeEach(() => {
    wurzel = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-sh-'));
    bin = path.join(wurzel, 'bin');
    backups = path.join(wurzel, 'backups');
    aufrufe = path.join(wurzel, 'aufrufe.txt');
    fs.mkdirSync(bin);
    // Nur die vom Skript benötigten Werkzeuge: so lässt sich curl/wget gezielt weglassen.
    WERKZEUGE.forEach((w) => fs.symlinkSync(findeProgramm(w), path.join(bin, w)));
    stub('pg_dump', PG_DUMP_OK);
  });
  afterEach(() => fs.rmSync(wurzel, { recursive: true, force: true }));

  it('schreibt bei Erfolg Status "ok" mit Datei, Größe und Dauer, ohne Webhook-Aufruf', () => {
    curlAttrappe();
    const r = lauf({ BACKUP_WEBHOOK_URL: 'https://example.invalid/hook' });
    expect(r.status).toBe(0);
    const s = status();
    expect(s.ergebnis).toBe('ok');
    expect(s.datei).toMatch(/^goldregendb_\d{8}_\d{6}\.sql\.gz$|^goldregendb_weekly_/);
    expect(['daily', 'weekly']).toContain(s.art);
    expect(s.groesse_bytes).toBeGreaterThan(0);
    expect(Number.isInteger(s.dauer_sekunden)).toBe(true);
    expect(Date.parse(s.zeitpunkt)).not.toBeNaN();
    expect(s.zeitpunkt).toMatch(/Z$/);
    expect(s).not.toHaveProperty('fehler');
    expect(webhookAufrufe()).toBe('');
    expect(fs.readdirSync(backups).filter((f) => f.includes('.tmp.'))).toEqual([]);
  });

  it('schreibt bei pg_dump-Fehler Status "fehler", behält den Exit-Code und ruft den Webhook per POST', () => {
    stub('pg_dump', PG_DUMP_FEHLER);
    curlAttrappe();
    const r = lauf({ BACKUP_WEBHOOK_URL: 'https://example.invalid/hook' });
    expect(r.status).not.toBe(0);
    const s = status();
    expect(s.ergebnis).toBe('fehler');
    expect(s.datei).toBe('');
    expect(s.groesse_bytes).toBe(0);
    expect(s.fehler).toMatch(/pg_dump/);
    const aufruf = webhookAufrufe();
    expect(aufruf).toContain('--data-binary');
    expect(aufruf).toContain('GoldRegenDB-Backup FEHLGESCHLAGEN');
    expect(aufruf).toContain('https://example.invalid/hook');
    expect(r.stderr).not.toContain('example.invalid');
  });

  it('meldet auch einen verworfenen Dump (zu klein) als Fehler', () => {
    const r = lauf({ MIN_BACKUP_BYTES: '100000' });
    expect(r.status).not.toBe(0);
    expect(status().ergebnis).toBe('fehler');
    expect(status().fehler).toMatch(/zu klein/);
    expect(fs.readdirSync(path.join(backups, 'daily'))).toEqual([]);
  });

  it('lässt ein fehlgeschlagenes Webhook das Ergebnis nicht verändern', () => {
    stub('pg_dump', PG_DUMP_FEHLER);
    curlAttrappe(7);
    const ohneWebhook = lauf();
    const mitKaputtemWebhook = lauf({ BACKUP_WEBHOOK_URL: 'https://example.invalid/hook' });
    expect(mitKaputtemWebhook.status).toBe(ohneWebhook.status);
    expect(mitKaputtemWebhook.stderr).toContain('WARNUNG: Fehlermeldung per Webhook');
    expect(status().ergebnis).toBe('fehler');
  });

  it('ruft ohne BACKUP_WEBHOOK_URL nichts auf', () => {
    stub('pg_dump', PG_DUMP_FEHLER);
    curlAttrappe();
    lauf();
    expect(webhookAufrufe()).toBe('');
  });

  it('nutzt wget, wenn curl fehlt', () => {
    stub('pg_dump', PG_DUMP_FEHLER);
    wgetAttrappe();
    lauf({ BACKUP_WEBHOOK_URL: 'https://example.invalid/hook' });
    expect(webhookAufrufe()).toContain('--post-data=GoldRegenDB-Backup FEHLGESCHLAGEN');
  });

  it('warnt, wenn weder curl noch wget vorhanden sind, und endet mit dem Fehler-Exit-Code', () => {
    stub('pg_dump', PG_DUMP_FEHLER);
    const r = lauf({ BACKUP_WEBHOOK_URL: 'https://example.invalid/hook' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('weder curl noch wget');
    expect(status().ergebnis).toBe('fehler');
  });

  it('schreibt den Fehler-Status auch bei Abbruch durch SIGTERM', () => {
    // bash führt den Trap erst aus, wenn der laufende Kindprozess endet.
    stub('pg_dump', '#!/bin/sh\nsleep 2\n');
    const r = spawnSync('bash', ['-c', `"${SKRIPT}" & pid=$!; sleep 1; kill -TERM $pid; wait $pid; echo "rc=$?"`], {
      encoding: 'utf8',
      env: { PATH: `${bin}:${path.dirname(findeProgramm('sleep'))}`, BACKUP_DIR: backups, MIN_BACKUP_BYTES: '20' },
    });
    expect(r.stdout).toContain('rc=143');
    expect(status().ergebnis).toBe('fehler');
  });

  it('behält die Rotation bei: alte Dumps verschwinden, neue bleiben', () => {
    fs.mkdirSync(path.join(backups, 'daily'), { recursive: true });
    const alt = path.join(backups, 'daily', 'goldregendb_alt.sql.gz');
    const neu = path.join(backups, 'daily', 'goldregendb_neu.sql.gz');
    fs.writeFileSync(alt, 'x');
    fs.writeFileSync(neu, 'x');
    const vorDreissigTagen = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    fs.utimesSync(alt, vorDreissigTagen, vorDreissigTagen);
    expect(lauf().status).toBe(0);
    expect(fs.existsSync(alt)).toBe(false);
    expect(fs.existsSync(neu)).toBe(true);
  });
});
