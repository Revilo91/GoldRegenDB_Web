/**
 * Structured logger for GoldRegenDB Backend.
 * Provides consistent log formatting with timestamps and component prefixes.
 */

function timestamp() {
  return new Date().toISOString();
}

function formatMessage(level, component, message, meta) {
  const ts = timestamp();
  const metaStr = meta !== undefined ? ` | ${JSON.stringify(meta)}` : '';
  return `${ts} [${level}] [${component}] ${message}${metaStr}`;
}

const logger = {
  info(component, message, meta) {
    console.log(formatMessage('INFO', component, message, meta));
  },
  warn(component, message, meta) {
    console.warn(formatMessage('WARN', component, message, meta));
  },
  error(component, message, meta) {
    console.error(formatMessage('ERROR', component, message, meta));
  },
  debug(component, message, meta) {
    if (process.env.LOG_LEVEL === 'debug') {
      console.log(formatMessage('DEBUG', component, message, meta));
    }
  },
};

module.exports = logger;
