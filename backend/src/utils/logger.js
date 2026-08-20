const os = require('os');

const HOSTNAME = os.hostname();
const REDACTED = '[REDACTED]';

// Feldnamen, die nie im Klartext in strukturierten Logs landen dürfen (ELK/DataDog/
// CloudWatch etc.). Exakter Vergleich nach Normalisierung (lowercase, Trennzeichen
// entfernt) – bewusst kein Substring-Match, sonst würden harmlose Felder wie
// `hatCookie`/`hatHeader` (Booleans in middleware/csrf.js) fälschlich zensiert.
const SENSITIVE_META_KEYS = new Set([
  'password', 'passwort', 'newpassword', 'currentpassword',
  'passwordhash', 'password_hash', 'hash',
  'token', 'jwt', 'resettoken', 'accesstoken', 'refreshtoken', 'sessiontoken',
  'cookie', 'authorization', 'secret', 'apikey',
]);

function normalizeKey(key) {
  return key.toLowerCase().replace(/[_-]/g, '');
}

function redactMeta(meta, depth = 0) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta) || depth > 2) return meta;
  const clean = {};
  for (const [key, value] of Object.entries(meta)) {
    if (SENSITIVE_META_KEYS.has(normalizeKey(key))) {
      clean[key] = REDACTED;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      clean[key] = redactMeta(value, depth + 1);
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

function resolveFormat() {
  const configured = (process.env.LOG_FORMAT || '').toLowerCase();
  if (configured === 'json' || configured === 'pretty') return configured;
  return process.env.NODE_ENV === 'production' ? 'json' : 'pretty';
}

function buildEntry(level, component, message, meta) {
  return {
    timestamp: new Date().toISOString(),
    level,
    component,
    message,
    ...redactMeta(meta),
    pid: process.pid,
    hostname: HOSTNAME,
  };
}

function formatPretty(entry) {
  const { timestamp, level, component, message, pid: _pid, hostname: _hostname, ...meta } = entry;
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${timestamp} [${level}] [${component}] ${message}${metaStr}`;
}

function write(level, consoleMethod, component, message, meta) {
  const entry = buildEntry(level, component, message, meta);
  consoleMethod(resolveFormat() === 'json' ? JSON.stringify(entry) : formatPretty(entry));
}

const logger = {
  info(component, message, meta = {}) {
    write('INFO', console.log, component, message, meta);
  },
  warn(component, message, meta = {}) {
    write('WARN', console.warn, component, message, meta);
  },
  error(component, message, meta = {}) {
    write('ERROR', console.error, component, message, meta);
  },
  debug(component, message, meta = {}) {
    if (process.env.LOG_LEVEL === 'debug') {
      write('DEBUG', console.log, component, message, meta);
    }
  },
};

module.exports = logger;
