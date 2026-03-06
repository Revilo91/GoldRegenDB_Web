const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  logger.error('AUTH', 'FATAL: JWT_SECRET Umgebungsvariable ist nicht gesetzt');
  process.exit(1);
}
logger.info('AUTH', 'JWT-Authentifizierung initialisiert');

function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn('AUTH', `Nicht authentifiziert: ${req.method} ${req.originalUrl} – Kein Bearer-Token`);
    return res.status(401).json({ error: 'Nicht authentifiziert' });
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
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

module.exports = { authenticate, requireAdmin, JWT_SECRET };
