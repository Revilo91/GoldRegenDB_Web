const cors = require('cors');
const logger = require('../utils/logger');

// Entwicklungs-Origins: nativer Vite-Dev-Server (5173) und Docker-Dev-Setup (3000).
// In Produktion liefert Express das Frontend selbst aus – diese Requests sind
// same-origin und lösen gar keine CORS-Prüfung aus.
const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

const configured = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const allowedOrigins = configured.length > 0 ? configured : DEFAULT_ORIGINS;

logger.info('CORS', `Erlaubte Origins: ${allowedOrigins.join(', ')}${configured.length ? '' : ' (Standard – ALLOWED_ORIGINS nicht gesetzt)'}`);

const corsMiddleware = cors({
  origin(origin, callback) {
    // Kein Origin-Header: same-origin-Request, curl, Health-Check des Containers
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    logger.warn('CORS', `Request von nicht erlaubter Origin abgelehnt: ${origin}`);
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Disposition', 'X-Upload-File-Count'],
  maxAge: 3600,
});

module.exports = corsMiddleware;
module.exports.allowedOrigins = allowedOrigins;
