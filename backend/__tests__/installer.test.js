'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSandbox, IMAGE } = require('./helpers/installerStub');
const { validateProductionSecrets } = require('../src/config/secrets');

const EXISTING_ENV = {
  APP_VERSION: '1.0.0',
  APP_HOST_PORT: '8080',
  POSTGRES_PASSWORD: 'dbpass-keep-0123456789',
  JWT_SECRET: 'jwt-keep-0123456789-0123456789-0123456789',
  BESTELLUNG_ENCRYPTION_KEY: 'k'.repeat(64),
  POSTGRES_DB: 'goldregendb',
  POSTGRES_USER: 'goldregen',
  PORT: '3001',
  COOKIE_SECURE: 'true',
};

describe('deploy/install.sh', () => {
  let sb;
  beforeEach(() => { sb = createSandbox(); });
  afterEach(() => sb.cleanup());

  describe('Erstinstallation', () => {
    it('erzeugt .env mit Secrets und APP_VERSION, legt Ordner und db-Dateien an', () => {
      const r = sb.run(['v1.2.3']);
      expect(r.status).toBe(0);

      const env = sb.readEnv();
      expect(env.APP_VERSION).toBe('1.2.3');
      expect(env.APP_PORT).toBe('3000');
      ['POSTGRES_PASSWORD', 'JWT_SECRET', 'BESTELLUNG_ENCRYPTION_KEY'].forEach((key) => expect(env[key]).toMatch(/^[0-9a-f]{64}$/));
      expect(new Set([env.POSTGRES_PASSWORD, env.JWT_SECRET, env.BESTELLUNG_ENCRYPTION_KEY]).size).toBe(3);

      ['data/postgres', 'backups', 'db'].forEach((dir) => expect(fs.statSync(sb.file(dir)).isDirectory()).toBe(true));
      ['init.sql', 'backup.sh', 'restore.sh'].forEach((f) => expect(fs.existsSync(sb.file('db', f))).toBe(true));
      // Downloads sind nicht ausführbar, backup.sh läuft im Container aber direkt.
      expect(fs.statSync(sb.file('db', 'backup.sh')).mode & 0o111).not.toBe(0);
      expect(fs.statSync(sb.file('db', 'restore.sh')).mode & 0o111).not.toBe(0);
      expect(fs.existsSync(sb.file('docker-compose.yml'))).toBe(true);
      expect(fs.readdirSync(sb.file('backups')).filter((f) => f.startsWith('pre-update'))).toEqual([]);
      expect(sb.dockerLog()).toContain(`pull ${IMAGE}:1.2.3`);
      expect(sb.dockerLog()).toContain('compose up -d --remove-orphans');
    });

    it('erzeugte Secrets erfüllen die Produktions-Prüfung des Backends', () => {
      sb.run(['v1.2.3']);
      const env = sb.readEnv();
      const previous = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        expect(validateProductionSecrets([
          { name: 'JWT_SECRET', value: env.JWT_SECRET, minLength: 32 },
          { name: 'POSTGRES_PASSWORD', value: env.POSTGRES_PASSWORD, minLength: 12 },
          { name: 'BESTELLUNG_ENCRYPTION_KEY', value: env.BESTELLUNG_ENCRYPTION_KEY, minLength: 64 },
        ])).toEqual([]);
      } finally {
        process.env.NODE_ENV = previous;
      }
    });

    it('ermittelt ohne Argument das neueste Release', () => {
      const r = sb.run([], { env: { STUB_LATEST_TAG: 'v2.0.0' } });
      expect(r.status).toBe(0);
      expect(sb.readEnv().APP_VERSION).toBe('2.0.0');
    });

  });

  describe('Update mit laufender Datenbank', () => {
    beforeEach(() => {
      sb.seedInstallation({
        env: EXISTING_ENV,
        images: ['1.0.0', '0.9.0', 'previous', '1.1.0'],
      });
    });

    it('sichert die DB, merkt :previous und löscht alte Images (nicht neuen Tag/:previous)', () => {
      const r = sb.run(['v1.1.0']);
      expect(r.status).toBe(0);

      const dumps = fs.readdirSync(sb.file('backups')).filter((f) => /^pre-update_.*\.sql\.gz$/.test(f));
      expect(dumps).toHaveLength(1);
      const content = require('zlib').gunzipSync(fs.readFileSync(sb.file('backups', dumps[0]))).toString();
      expect(content).toBe('DUMPDATA');

      const log = sb.dockerLog();
      expect(log).toContain(`tag sha256:old ${IMAGE}:previous`);
      expect(log).toContain(`rmi ${IMAGE}:1.0.0`);
      expect(log).toContain(`rmi ${IMAGE}:0.9.0`);
      expect(log).not.toContain(`rmi ${IMAGE}:1.1.0`);
      expect(log).not.toContain(`rmi ${IMAGE}:previous`);
      expect(log.indexOf('compose down')).toBeLessThan(log.indexOf('compose up'));
      expect(sb.readEnv().APP_VERSION).toBe('1.1.0');
      // Daten im selben Ordner: keine Migration per Dump.
      expect(log).not.toContain('DROP DATABASE');
      expect(fs.readdirSync(sb.state).filter((f) => f.endsWith('.cmd') && fs.readFileSync(sb.stateFile(f), 'utf8').includes('DROP DATABASE'))).toEqual([]);
    });

    // exec -T reicht stdin an den Container durch und würde bei `curl | bash` den Rest des Skripts verschlucken.
    it('läuft auch als `curl | bash` (stdin = Skript) bis zum Ende durch', () => {
      const r = sb.run(['v1.1.0'], { viaStdin: true });
      expect(r.status).toBe(0);
      expect(r.out).toContain('Fertig: goldregendb läuft');
      expect(sb.readEnv().APP_VERSION).toBe('1.1.0');
    });

    it('rollt zurück, wenn die neue Version nicht gesund wird', () => {
      const r = sb.run(['v1.1.0'], { env: { STUB_BAD_VERSION: '1.1.0' } });
      expect(r.status).toBe(1);
      expect(r.err).toContain('die alte Version läuft wieder');
      expect(sb.readEnv().APP_VERSION).toBe('previous');
    });

    it('bricht ohne Veränderung ab, wenn das Image nicht gezogen werden kann', () => {
      const r = sb.run(['v1.1.0'], { env: { STUB_PULL_RC: '1' } });
      expect(r.status).toBe(1);
      expect(sb.dockerLog()).not.toContain('compose down');
      expect(sb.readEnv().APP_VERSION).toBe('1.0.0');
    });
  });

  describe('bestehende .env', () => {
    it('behält Werte, übernimmt umbenannte Variablen und ergänzt neue', () => {
      sb.seedInstallation({ env: EXISTING_ENV, images: ['1.0.0'] });
      const r = sb.run(['v1.1.0']);
      expect(r.status).toBe(0);

      const env = sb.readEnv();
      expect(env.JWT_SECRET).toBe(EXISTING_ENV.JWT_SECRET);
      expect(env.POSTGRES_PASSWORD).toBe(EXISTING_ENV.POSTGRES_PASSWORD);
      expect(env.BESTELLUNG_ENCRYPTION_KEY).toBe(EXISTING_ENV.BESTELLUNG_ENCRYPTION_KEY);
      expect(env.COOKIE_SECURE).toBe('true');
      expect(env.APP_PORT).toBe('8080');
      expect(env.PRIVACY_POLICY_VERSION).toBe('2026-01-v1');
      expect(sb.readEnv('.env.bak').APP_VERSION).toBe('1.0.0');
      expect(fs.statSync(sb.file('.env')).mode & 0o077).toBe(0);
    });

    it('erzeugt fehlende Secrets, ohne vorhandene zu ändern', () => {
      const { BESTELLUNG_ENCRYPTION_KEY: _entfernt, ...ohneKey } = EXISTING_ENV;
      sb.seedInstallation({ env: ohneKey, running: false });
      expect(sb.run(['v1.1.0']).status).toBe(0);
      const env = sb.readEnv();
      expect(env.BESTELLUNG_ENCRYPTION_KEY).toMatch(/^[0-9a-f]{64}$/);
      expect(env.JWT_SECRET).toBe(EXISTING_ENV.JWT_SECRET);
    });

    it('bricht bei abweichendem DATA_DIR ab, bevor etwas verändert wird', () => {
      sb.seedInstallation({ env: { ...EXISTING_ENV, DATA_DIR: '/volume2/anderswo' } });
      const before = fs.readFileSync(sb.file('.env'), 'utf8');
      const r = sb.run(['v1.1.0']);
      expect(r.status).toBe(1);
      expect(r.err).toContain('DATA_DIR=/volume2/anderswo');
      expect(fs.readFileSync(sb.file('.env'), 'utf8')).toBe(before);
      expect(sb.dockerLog()).not.toContain('compose down');
    });
  });

  describe('Migration einer Altinstallation (DB lag nicht in ./data/postgres)', () => {
    it('spielt die Sicherung per psql in die neue, leere DB ein', () => {
      sb.seedInstallation({ env: EXISTING_ENV, dataFiles: false, images: ['1.0.0'] });
      const r = sb.run(['v1.1.0']);
      expect(r.status).toBe(0);
      expect(r.out).toContain('übernehme Sicherung');

      const execs = fs.readdirSync(sb.state).filter((f) => /^exec_\d+\.cmd$/.test(f)).sort()
        .map((f) => ({ cmd: fs.readFileSync(sb.stateFile(f), 'utf8'), stdin: fs.readFileSync(sb.stateFile(f.replace('.cmd', '.stdin')), 'utf8') }));
      const drop = execs.find((e) => e.cmd.includes('DROP DATABASE'));
      const restore = execs.find((e) => e.cmd.includes('psql') && e.stdin === 'DUMPDATA');
      expect(drop).toBeDefined();
      expect(restore).toBeDefined();
      expect(execs.indexOf(restore)).toBeGreaterThan(execs.indexOf(drop));

      const log = sb.dockerLog();
      expect(log.indexOf('compose up -d db')).toBeLessThan(log.indexOf('DROP DATABASE') === -1 ? log.indexOf('compose exec') : log.indexOf('DROP DATABASE'));
      expect(log.lastIndexOf('compose up -d --remove-orphans')).toBeGreaterThan(log.indexOf('compose up -d db'));
      expect(fs.statSync(sb.file('data', 'postgres')).isDirectory()).toBe(true);
    });
  });

  describe('--rollback', () => {
    it('startet mit APP_VERSION=previous', () => {
      sb.seedInstallation({ env: EXISTING_ENV, previous: true });
      const r = sb.run(['--rollback']);
      expect(r.status).toBe(0);
      expect(sb.readEnv().APP_VERSION).toBe('previous');
      expect(sb.dockerLog()).toContain('compose up -d --remove-orphans');
      expect(sb.dockerLog()).not.toContain('pull');
    });

    it('bricht ohne :previous-Image ab', () => {
      sb.seedInstallation({ env: EXISTING_ENV });
      const r = sb.run(['--rollback']);
      expect(r.status).toBe(1);
      expect(r.err).toContain(':previous');
      expect(sb.readEnv().APP_VERSION).toBe('1.0.0');
    });
  });

  describe('Versionsangabe', () => {
    it.each(['abc', '1.2', 'v1.2.3; rm -rf /', '../etc'])('lehnt %j ab, ohne etwas zu laden', (tag) => {
      const r = sb.run([tag]);
      expect(r.status).toBe(1);
      expect(r.err).toContain('keine Versionsnummer');
      expect(sb.dockerLog()).toBe('');
      expect(fs.existsSync(sb.installDir)).toBe(false);
    });

    it.each(['v1.2.3', '1.2.3', 'v1.2.3-rc.1'])('akzeptiert %j', (tag) => {
      expect(sb.run([tag]).status).toBe(0);
    });

    it('bricht ab, wenn ein Release-Asset fehlt (nichts verändert)', () => {
      fs.rmSync(`${sb.root}/assets/init.sql`);
      const r = sb.run(['v1.2.3']);
      expect(r.status).toBe(1);
      expect(r.err).toContain('init.sql');
      expect(fs.existsSync(sb.installDir)).toBe(false);
    });
  });

  describe('Hintergrundlauf', () => {
    const BACKGROUND = { INSTALL_FOREGROUND: '' };
    const waitFor = async (condition, timeoutMs = 15000) => {
      const start = Date.now();
      while (!condition()) {
        if (Date.now() - start > timeoutMs) throw new Error('Zeitüberschreitung beim Warten');
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    };

    it('läuft im Hintergrund, zeigt das Log und liefert den Exit-Code', () => {
      const r = sb.run(['v1.2.3'], { env: BACKGROUND });
      expect(r.status).toBe(0);
      expect(r.out).toContain('Installer läuft im Hintergrund');
      expect(r.out).toContain('Fertig: goldregendb läuft');
      expect(fs.readFileSync(sb.file('install.log'), 'utf8')).toContain('Fertig: goldregendb läuft');
      expect(fs.readFileSync(sb.file('install.exit'), 'utf8').trim()).toBe('0');
      expect(fs.existsSync(sb.file('install.pid'))).toBe(false);
    });

    it('gibt den Fehlercode des Hintergrundlaufs weiter', () => {
      const r = sb.run(['v1.2.3'], { env: { ...BACKGROUND, STUB_PULL_RC: '1' } });
      expect(r.status).toBe(1);
      expect(r.out).toContain('FEHLER: Image-Download fehlgeschlagen');
      expect(fs.readFileSync(sb.file('install.exit'), 'utf8').trim()).toBe('1');
    });

    it('läuft auch als `curl | bash` im Hintergrund und räumt die Skriptkopie weg', () => {
      const r = sb.run(['v1.2.3'], { env: BACKGROUND, viaStdin: true });
      expect(r.status).toBe(0);
      expect(r.out).toContain('Fertig: goldregendb läuft');
      expect(fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('tmp.') && fs.statSync(path.join(os.tmpdir(), f)).isFile()
        && fs.readFileSync(path.join(os.tmpdir(), f), 'utf8').includes('INSTALL_SELF_TMP'))).toEqual([]);
    });

    it('der Rollback-Modus läuft ebenfalls im Hintergrund', () => {
      sb.seedInstallation({ env: EXISTING_ENV, previous: true, running: false });
      const r = sb.run(['--rollback'], { env: BACKGROUND });
      expect(r.status).toBe(0);
      expect(r.out).toContain('Rollback auf');
      expect(fs.readFileSync(sb.file('install.exit'), 'utf8').trim()).toBe('0');
    });

    it('--help und ungültige Versionen bleiben im Vordergrund (kein Log)', () => {
      expect(sb.run(['--help'], { env: BACKGROUND }).status).toBe(0);
      expect(sb.run(['kaputt'], { env: BACKGROUND }).status).toBe(1);
      expect(fs.existsSync(sb.installDir)).toBe(false);
    });

    it('verweigert einen zweiten Start, solange ein Installer läuft', () => {
      fs.mkdirSync(sb.installDir, { recursive: true });
      fs.writeFileSync(sb.file('install.pid'), `${process.pid}\n`);
      const r = sb.run(['v1.2.3'], { env: BACKGROUND });
      expect(r.status).toBe(1);
      expect(r.err).toContain('läuft bereits');
      expect(sb.dockerLog()).not.toContain('pull');
    });

    it('ignoriert eine veraltete PID-Datei', () => {
      fs.mkdirSync(sb.installDir, { recursive: true });
      fs.writeFileSync(sb.file('install.pid'), '2147483646\n');
      expect(sb.run(['v1.2.3'], { env: BACKGROUND }).status).toBe(0);
    });

    it('läuft weiter, wenn die Anzeige (SSH-Sitzung) abbricht', async () => {
      const parent = sb.start(['v1.2.3'], { env: { ...BACKGROUND, STUB_PULL_SLEEP: '3' } });
      await waitFor(() => fs.existsSync(sb.file('install.pid')));
      process.kill(-parent.pid, 'SIGKILL'); // wie ein abgestürztes Terminal: Eltern samt Prozessgruppe
      await waitFor(() => fs.existsSync(sb.file('install.exit')));
      expect(fs.readFileSync(sb.file('install.exit'), 'utf8').trim()).toBe('0');
      expect(sb.readEnv().APP_VERSION).toBe('1.2.3');
      expect(fs.readFileSync(sb.file('install.log'), 'utf8')).toContain('Fertig: goldregendb läuft');
    });
  });
});
