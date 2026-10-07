'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { REPO, ASSET_SOURCES } = require('./helpers/installerStub');

const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const compose = read('deploy/docker-compose.yml');
const envExample = read('deploy/.env.example');
const releaseWorkflow = read('.github/workflows/release.yml');
const activeLines = (text) => text.split('\n').filter((l) => !/^\s*#/.test(l));

describe('Deploy-Standard: deploy/docker-compose.yml', () => {
  it('hat Projektnamen, Container-Namen und die Services app und db', () => {
    expect(compose).toMatch(/^name: goldregendb$/m);
    expect(compose).toMatch(/^ {4}container_name: goldregendb-app$/m);
    expect(compose).toMatch(/^ {4}container_name: goldregendb-db$/m);
    expect(compose).toMatch(/^ {2}app:$/m);
    expect(compose).toMatch(/^ {2}db:$/m);
  });

  it('nutzt das GHCR-Image mit Pflicht-Variable APP_VERSION', () => {
    expect(compose).toMatch(/^ {4}image: ghcr\.io\/revilo91\/goldregendb:\$\{APP_VERSION:\?[^}]+\}$/m);
  });

  it('bindet Daten nur relativ ein, keine Named Volumes, kein DATA_DIR', () => {
    const body = activeLines(compose).join('\n');
    expect(body).not.toMatch(/^volumes:/m);
    expect(body).not.toMatch(/DATA_DIR|IMAGE_TAG|APP_HOST_PORT/);
    const mounts = [...body.matchAll(/^ {6}- (\S+?):(\/\S+)$/gm)].map((m) => m[1]);
    expect(mounts).toEqual(expect.arrayContaining(['./data/postgres', './backups']));
    mounts.forEach((source) => expect(source).toMatch(/^\.\//));
    expect(body).toContain('./data/postgres:/var/lib/postgresql/data');
    expect(body).toContain('./backups:/backups');
  });

  it('veröffentlicht den Host-Port über APP_PORT und hat einen DB-Healthcheck', () => {
    expect(compose).toContain('"${APP_PORT:-3000}:${PORT}"');
    expect(compose).toMatch(/healthcheck:[\s\S]*?test: \["CMD-SHELL", "pg_isready/);
  });

  it('der db-Service setzt POSTGRES_DB/USER/PASSWORD (der Installer sichert damit)', () => {
    const db = compose.slice(compose.indexOf('  db:'), compose.indexOf('  app:'));
    ['POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD'].forEach((key) => expect(db).toContain(`${key}:`));
  });
});

describe('Deploy-Standard: deploy/.env.example', () => {
  it('Secrets sind leer, APP_VERSION ist vorhanden', () => {
    ['DB_PASSWORD', 'JWT_SECRET', 'BESTELLUNG_ENCRYPTION_KEY', 'APP_VERSION'].forEach((key) => {
      expect(envExample).toMatch(new RegExp(`^${key}=$`, 'm'));
    });
  });

  it('enthält keine Platzhalter, kein DATA_DIR/IMAGE_TAG und keine Inline-Kommentare', () => {
    const lines = activeLines(envExample).filter((l) => l.trim());
    lines.forEach((line) => {
      expect(line).toMatch(/^[A-Z][A-Z0-9_]*=[^\s#]*$/);
      expect(line).not.toMatch(/change-this|changeme/i);
    });
    expect(envExample).not.toMatch(/^#?\s*(DATA_DIR|IMAGE_TAG|APP_HOST_PORT)=/m);
    expect(envExample).toMatch(/^APP_PORT=3000$/m);
  });

  it('jede ${VAR} ohne Default aus dem Compose steht in der .env.example', () => {
    const vars = [...new Set([...activeLines(compose).join('\n').matchAll(/\$\{([A-Z][A-Z0-9_]*)(:?\?[^}]*)?\}/g)].map((m) => m[1]))];
    expect(vars.length).toBeGreaterThan(5);
    vars.forEach((name) => expect(envExample).toMatch(new RegExp(`^${name}=`, 'm')));
  });
});

describe('Deploy-Standard: Release-Workflow', () => {
  it('hängt die Standard-Assets an und nennt den Installer-Aufruf', () => {
    ['docker-compose.yml', '.env.example', 'install.sh', 'init.sql', 'backup.sh', 'restore.sh'].forEach((asset) => {
      expect(releaseWorkflow).toContain(`assets/${asset}`);
    });
    expect(releaseWorkflow).toContain('curl -fsSL https://github.com/Revilo91/GoldRegenDB_Web/releases/latest/download/install.sh | sudo bash');
    expect(releaseWorkflow).not.toMatch(/goldregendb-synology|\.zip/);
    expect(releaseWorkflow).toContain('include-hidden-files: true');
  });

  it('behält die Reihenfolge tests -> build -> smoke -> push -> release', () => {
    expect(releaseWorkflow).toMatch(/smoke-test:[\s\S]*?needs: \[build, package\]/);
    expect(releaseWorkflow).toMatch(/push:[\s\S]*?needs: \[build, smoke-test\]/);
    expect(releaseWorkflow).toMatch(/create-release:[\s\S]*?needs: \[build, push\]/);
  });
});

describe('Deploy-Skripte', () => {
  it.each(['deploy/install.sh', 'scripts/build-release-package.sh', 'scripts/release-smoke-test.sh'])('%s: gültige bash-Syntax', (rel) => {
    const r = spawnSync('bash', ['-n', path.join(REPO, rel)], { encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  it('install.sh ist ausführbar und hat die Projekt-Konfiguration', () => {
    expect(fs.statSync(path.join(REPO, 'deploy/install.sh')).mode & 0o111).not.toBe(0);
    const script = read('deploy/install.sh');
    expect(script).not.toMatch(/@@/);
    expect(script).toContain('PROJEKT="goldregendb"');
    expect(script).toContain('IMAGE_REPO="ghcr.io/revilo91/goldregendb"');
    expect(script).toContain('EXTRA_ASSETS=(init.sql:db/init.sql backup.sh:db/backup.sh restore.sh:db/restore.sh)');
  });

  it('build-release-package.sh stellt alle Release-Assets flach zusammen', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'release-assets-'));
    try {
      const r = spawnSync('bash', [path.join(REPO, 'scripts/build-release-package.sh'), path.join(out, 'assets')], { encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(fs.readdirSync(path.join(out, 'assets')).sort()).toEqual(Object.keys(ASSET_SOURCES).sort());
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  it('das alte Update-Skript und das ZIP-Paket sind entfernt', () => {
    expect(fs.existsSync(path.join(REPO, 'scripts/synology-update.sh'))).toBe(false);
    expect(fs.existsSync(path.join(REPO, 'docker-compose.synology.yml'))).toBe(false);
  });
});
