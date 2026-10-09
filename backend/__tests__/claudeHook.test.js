'use strict';

// Prüft den PreToolUse-Hook .claude/hooks/validate-bash.sh (Grenzen aus .claude/rules/arbeitsweise.md)
// und dass er in .claude/settings.json eingetragen ist. Ohne Eintrag läuft das Skript nie.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const HOOK = path.join(ROOT, '.claude', 'hooks', 'validate-bash.sh');
const SETTINGS = path.join(ROOT, '.claude', 'settings.json');

// [Erwartung, Branch des Arbeitsverzeichnisses, Befehl]
const FAELLE = [
  ['erlaubt', 'feature', 'npm test'],
  ['erlaubt', 'feature', 'git push -u origin feat/x'],
  ['erlaubt', 'feature', 'git push'],
  ['erlaubt', 'feature', 'rm -r build'],
  ['erlaubt', 'feature', 'rm -f datei.txt'],
  ['erlaubt', 'feature', 'git commit -m "kein rm -rf und kein git push --force origin main"'],
  ['erlaubt', 'feature', 'git push origin main:feat/x'],
  ['erlaubt', 'main', 'git push origin v1.2.3'],
  ['erlaubt', 'main', 'git push --tags'],
  ['erlaubt', 'feature', 'docker compose down'],
  ['rückfrage', 'feature', 'rm -rf dist'],
  ['rückfrage', 'feature', 'rm -r -f dist'],
  ['rückfrage', 'feature', 'sudo rm --recursive --force /x'],
  ['rückfrage', 'feature', 'cd backend && git reset --hard HEAD~1'],
  ['rückfrage', 'feature', 'git clean -fd'],
  ['rückfrage', 'feature', 'git push --force origin feat/x'],
  ['rückfrage', 'feature', 'git push --force-with-lease'],
  ['rückfrage', 'feature', 'docker compose -f docker-compose.dev.yml down -v'],
  ['rückfrage', 'feature', 'npm test; rm -rf node_modules'],
  ['blockiert', 'feature', 'git push origin main'],
  ['blockiert', 'feature', 'git push -u origin HEAD:main'],
  ['blockiert', 'feature', 'git push origin refs/heads/master'],
  ['blockiert', 'feature', 'git push --force origin main'],
  ['blockiert', 'feature', 'npm test && git push origin main'],
  ['blockiert', 'main', 'git push'],
  ['blockiert', 'feature', 'git push origin --delete main'],
];

function gitRepo(branch) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-hook-'));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['symbolic-ref', 'HEAD', `refs/heads/${branch}`], { cwd: dir });
  return dir;
}

function entscheidung(command, cwd) {
  const eingabe = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } });
  const res = spawnSync('bash', [HOOK], { cwd, input: eingabe, encoding: 'utf8' });
  if (res.status === 2) return 'blockiert';
  if (res.status !== 0) return `unerwartet (Exit ${res.status}: ${res.stderr})`;
  if (res.stdout === '') return 'erlaubt';
  return JSON.parse(res.stdout).hookSpecificOutput.permissionDecision === 'ask' ? 'rückfrage' : 'unerwartet';
}

describe('.claude/hooks/validate-bash.sh', () => {
  const repos = {};

  beforeAll(() => {
    repos.feature = gitRepo('feat/x');
    repos.main = gitRepo('main');
  });

  afterAll(() => {
    for (const dir of Object.values(repos)) fs.rmSync(dir, { recursive: true, force: true });
  });

  test.each(FAELLE)('%s (Branch %s): %s', (erwartung, branch, befehl) => {
    expect(entscheidung(befehl, repos[branch])).toBe(erwartung);
  });

  test('nennt beim Blockieren den Grund auf stderr', () => {
    const eingabe = JSON.stringify({ tool_input: { command: 'git push origin main' } });
    const res = spawnSync('bash', [HOOK], { cwd: repos.feature, input: eingabe, encoding: 'utf8' });
    expect(res.stderr).toMatch(/Blockiert: Push auf 'main'/);
  });

  test('lässt Eingaben ohne Befehl und ungültiges JSON nicht als Block durch', () => {
    const leer = spawnSync('bash', [HOOK], { cwd: repos.feature, input: '{"tool_input":{}}', encoding: 'utf8' });
    expect(leer.status).toBe(0);
    const kaputt = spawnSync('bash', [HOOK], { cwd: repos.feature, input: 'kein json', encoding: 'utf8' });
    expect(kaputt.status).toBe(1);
  });

  test('ist in .claude/settings.json als PreToolUse-Hook für Bash eingetragen', () => {
    const settings = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
    const bashHooks = settings.hooks.PreToolUse.filter((eintrag) => eintrag.matcher === 'Bash')
      .flatMap((eintrag) => eintrag.hooks);
    const istHook = (h) => h.type === 'command' && h.command.includes('.claude/hooks/validate-bash.sh');
    expect(bashHooks.some(istHook)).toBe(true);
  });
});
