const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const db = require('../config/db');
const { AUTH_COOKIE_NAME } = require('../utils/authCookie');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  logger.error('AUTH', 'FATAL: JWT_SECRET Umgebungsvariable ist nicht gesetzt');
  process.exit(1);
}
logger.info('AUTH', 'JWT-Authentifizierung initialisiert');

// Das JWT kommt primär aus dem httpOnly-Cookie (Issue #132). Der
// Authorization-Header bleibt als Fallback bestehen, damit Skripte, E2E-Tests
// und andere API-Clients ohne Cookie-Jar weiterhin funktionieren.
function extractToken(req) {
  const cookieToken = req.cookies?.[AUTH_COOKIE_NAME];
  if (cookieToken) {
    return cookieToken;
  }
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return null;
}

function authenticate(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    logger.warn('AUTH', `Nicht authentifiziert: ${req.method} ${req.originalUrl} – Kein Token (Cookie oder Bearer)`);
    return res.status(401).json({ error: 'Nicht authentifiziert' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    db.setCurrentDbUsername(payload.username);
    next();
  } catch (err) {
    logger.warn('AUTH', `Ungültiges Token: ${req.method} ${req.originalUrl}`, { error: err.message });
    return res.status(401).json({ error: 'Ungültiges oder abgelaufenes Token' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    logger.warn('AUTH', `Admin-Zugriff verweigert: ${req.method} ${req.originalUrl}`, { user: req.user?.username, role: req.user?.role });
    return res.status(403).json({ error: 'Zugriff verweigert – Admin erforderlich' });
  }
  next();
}

function requireBearbeiter(req, res, next) {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'bearbeiter')) {
    logger.warn('AUTH', `Bearbeiter-Zugriff verweigert: ${req.method} ${req.originalUrl}`, { user: req.user?.username, role: req.user?.role });
    return res.status(403).json({ error: 'Zugriff verweigert – Bearbeiter-Berechtigung erforderlich' });
  }
  next();
}

module.exports = { authenticate, requireAdmin, requireBearbeiter, extractToken, JWT_SECRET };
