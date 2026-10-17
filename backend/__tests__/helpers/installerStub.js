'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..', '..');
const INSTALLER = path.join(REPO, 'deploy', 'install.sh');
const IMAGE = 'ghcr.io/revilo91/goldregendb';

// Release-Assets wie auf GitHub: flache Dateinamen, aus den echten Quellen im Repo.
const ASSET_SOURCES = {
  'docker-compose.yml': 'deploy/docker-compose.yml',
  '.env.example': 'deploy/.env.example',
  'install.sh': 'deploy/install.sh',
  'init.sql': 'db/init.sql',
  'backup.sh': 'db/backup.sh',
  'restore.sh': 'db/restore.sh',
};

const DOCKER_STUB = `#!/usr/bin/env bash
echo "docker $*" >> "$STUB_STATE/docker.log"
cmd="$1"; shift || true
case "$cmd" in
  compose)
    sub="$1"; shift || true
    case "$sub" in
      version) exit 0 ;;
      ps)
        if [[ "$*" == *"--services"* ]]; then cat "$STUB_STATE/running_services" 2>/dev/null || true
        elif [[ "$*" == *"app"* ]]; then [[ -f "$STUB_STATE/app_running" ]] && echo appid || true
        else echo dbid; fi ;;
      down) rm -f "$STUB_STATE/app_running" "$STUB_STATE/running_services" ;;
      up)
        if [[ "$*" == *"--remove-orphans"* ]]; then touch "$STUB_STATE/app_running"; printf 'app\\ndb\\n' > "$STUB_STATE/running_services"
        else printf 'db\\n' > "$STUB_STATE/running_services"; fi ;;
      exec)
        # Wie der echte Client: stdin wird an den Container weitergereicht (und damit verbraucht).
        n=$(ls "$STUB_STATE" | grep -c '^exec_' || true)
        cat > "$STUB_STATE/exec_$n.stdin"
        echo "$*" > "$STUB_STATE/exec_$n.cmd"
        if [[ "$*" == *pg_dump* ]]; then printf 'DUMPDATA'; fi ;;
      *) ;;
    esac ;;
  inspect)
    if [[ "$*" == *Health* ]]; then
      if [[ -n "\${STUB_BAD_VERSION:-}" ]] && grep -q "^APP_VERSION=$STUB_BAD_VERSION\\$" .env; then echo unhealthy; else echo healthy; fi
    else echo sha256:old; fi ;;
  image)
    if [[ "$1" == inspect ]]; then [[ -f "$STUB_STATE/has_previous" ]]; fi ;;
  tag) touch "$STUB_STATE/has_previous" ;;
  pull) exit "\${STUB_PULL_RC:-0}" ;;
  images) cat "$STUB_STATE/images" 2>/dev/null || true ;;
  rmi|*) ;;
esac
`;

const CURL_STUB = `#!/usr/bin/env bash
url=""; out=""
while [[ $# -gt 0 ]]; do
  case "$1" in -o) out="$2"; shift ;; -*) ;; *) url="$1" ;; esac
  shift
done
echo "curl $url" >> "$STUB_STATE/curl.log"
case "$url" in
  */releases/latest) printf '{"tag_name": "%s"}\\n' "$STUB_LATEST_TAG" ;;
  */releases/download/*/*) f="$STUB_ASSETS/\${url##*/}"; [[ -f "$f" ]] || exit 22; cp "$f" "$out" ;;
  *) exit 22 ;;
esac
`;

// Erzeugt je Aufruf andere, gültige Hex-Zeichenketten der Länge 2*N.
const OPENSSL_STUB = `#!/usr/bin/env bash
c=$(cat "$STUB_STATE/openssl_counter" 2>/dev/null || echo 0); c=$((c + 1)); echo "$c" > "$STUB_STATE/openssl_counter"
printf '%0*d\\n' $(( $3 * 2 )) "$c"
`;

const ID_STUB = '#!/usr/bin/env bash\necho 0\n';

function writeExecutable(file, content) {
  fs.writeFileSync(file, content, { mode: 0o755 });
}

function createSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'installer-'));
  const bin = path.join(root, 'bin');
  const state = path.join(root, 'state');
  const assets = path.join(root, 'assets');
  const installDir = path.join(root, 'install');
  [bin, state, assets].forEach((d) => fs.mkdirSync(d));
  writeExecutable(path.join(bin, 'docker'), DOCKER_STUB);
  writeExecutable(path.join(bin, 'curl'), CURL_STUB);
  writeExecutable(path.join(bin, 'openssl'), OPENSSL_STUB);
  writeExecutable(path.join(bin, 'id'), ID_STUB);
  Object.entries(ASSET_SOURCES).forEach(([name, source]) => {
    fs.copyFileSync(path.join(REPO, source), path.join(assets, name));
    fs.chmodSync(path.join(assets, name), 0o644);
  });

  const sandbox = {
    root,
    installDir,
    state,
    file: (...parts) => path.join(installDir, ...parts),
    stateFile: (name) => path.join(state, name),
    dockerLog: () => (fs.existsSync(path.join(state, 'docker.log')) ? fs.readFileSync(path.join(state, 'docker.log'), 'utf8') : ''),
    readEnv: (file = '.env') => Object.fromEntries(
      fs.readFileSync(path.join(installDir, file), 'utf8').split('\n')
        .filter((l) => /^[A-Z][A-Z0-9_]*=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
    ),
    // Bestehende Installation: Compose, .env, laufender Stack, Image-Tags.
    seedInstallation({ env, dataFiles = true, running = true, images = [], previous = false }) {
      fs.mkdirSync(installDir, { recursive: true });
      fs.writeFileSync(path.join(installDir, 'docker-compose.yml'), 'services: {}\n');
      fs.writeFileSync(path.join(installDir, '.env'), Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
      if (dataFiles) {
        fs.mkdirSync(path.join(installDir, 'data', 'postgres'), { recursive: true });
        fs.writeFileSync(path.join(installDir, 'data', 'postgres', 'PG_VERSION'), '16\n');
      }
      if (running) {
        fs.writeFileSync(path.join(state, 'running_services'), 'app\ndb\n');
        fs.writeFileSync(path.join(state, 'app_running'), '');
      }
      if (previous) fs.writeFileSync(path.join(state, 'has_previous'), '');
      fs.writeFileSync(path.join(state, 'images'), images.map((t) => `${IMAGE}:${t}\n`).join(''));
    },
    run(args = [], { env = {}, viaStdin = false } = {}) {
      const fullEnv = {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        INSTALL_DIR: installDir,
        GITHUB_API: 'http://stub-api',
        GITHUB_DL: 'http://stub-dl',
        STUB_STATE: state,
        STUB_ASSETS: assets,
        STUB_LATEST_TAG: 'v9.9.9',
        HEALTH_TIMEOUT_S: '1',
        HEALTH_POLL_S: '1',
        ...env,
      };
      const options = { env: fullEnv, encoding: 'utf8' };
      const result = viaStdin
        ? spawnSync('bash', ['-s', '--', ...args], { ...options, input: fs.readFileSync(INSTALLER, 'utf8') })
        : spawnSync('bash', [INSTALLER, ...args], options);
      return { status: result.status, out: result.stdout, err: result.stderr };
    },
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
  return sandbox;
}

module.exports = { createSandbox, REPO, INSTALLER, IMAGE, ASSET_SOURCES };
