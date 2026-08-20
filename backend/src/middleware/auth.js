// @ts-check
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const db = require('../config/db');
const { AUTH_COOKIE_NAME } = require('../utils/authCookie');
const { getSecret } = require('../config/secrets');

/** @typedef {import('express').Request} Request */
/** @typedef {import('express').Response} Response */
/** @typedef {import('express').NextFunction} NextFunction */

const JWT_SECRET = getSecret('JWT_SECRET');
if (!JWT_SECRET) {
  logger.error('AUTH', 'FATAL: JWT_SECRET ist nicht gesetzt (weder als Env-Var noch über JWT_SECRET_FILE)');
  process.exit(1);
}
// Graceful Rollover (Issue #140): während einer Secret-Rotation verifizieren
// wir zusätzlich mit dem alten Secret, damit bereits ausgestellte Tokens bis
// zu ihrem Ablauf gültig bleiben. Signiert wird immer nur mit JWT_SECRET.
const JWT_SECRET_OLD = getSecret('JWT_SECRET_OLD');
logger.info('AUTH', `JWT-Authentifizierung initialisiert${JWT_SECRET_OLD ? ' (Rollover aktiv: JWT_SECRET_OLD gesetzt)' : ''}`);

// Das JWT kommt primär aus dem httpOnly-Cookie (Issue #132). Der
// Authorization-Header bleibt als Fallback bestehen, damit Skripte, E2E-Tests
// und andere API-Clients ohne Cookie-Jar weiterhin funktionieren.
/**
 * @param {Request} req
 * @returns {string|null}
 */
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

/**
 * @param {Request} req
 * @param {Response} res
 * @param {NextFunction} next
 */
function authenticate(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    logger.warn('AUTH', 'Nicht authentifiziert – kein Token (Cookie oder Bearer)', {
      method: req.method,
      path: req.originalUrl,
    });
    return res.status(401).json({ error: 'Nicht authentifiziert' });
  }
  try {
    // JWT_SECRET/JWT_SECRET_OLD sind an dieser Stelle garantiert gesetzt (siehe
    // Guard oben bzw. die Rollover-Prüfung) – die Casts machen das für tsc explizit.
    // jwt.verify liefert bei string-Secrets ohne komplexe Optionen ein
    // JwtPayload-Objekt zurück (nie einen reinen String) – das Payload-Format
    // wird beim Signieren in routes/auth.js festgelegt: { id, username, role }.
    /** @type {import('../types/express').AuthenticatedUser} */
    let payload;
    try {
      payload = /** @type {import('../types/express').AuthenticatedUser} */ (
        jwt.verify(token, /** @type {string} */ (JWT_SECRET))
      );
    } catch (err) {
      if (!JWT_SECRET_OLD) {
        throw err;
      }
      payload = /** @type {import('../types/express').AuthenticatedUser} */ (
        jwt.verify(token, /** @type {string} */ (JWT_SECRET_OLD))
      );
      logger.info('AUTH', `Token mit JWT_SECRET_OLD verifiziert (Rollover): ${req.method} ${req.originalUrl}`);
    }
    req.user = payload;
    db.setCurrentDbUsername(payload.username);
    next();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('AUTH', 'Ungültiges Token', { method: req.method, path: req.originalUrl, error: message });
    return res.status(401).json({ error: 'Ungültiges oder abgelaufenes Token' });
  }
}

/**
 * @param {Request} req
 * @param {Response} res
 * @param {NextFunction} next
 */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    logger.warn('AUTH', 'Admin-Zugriff verweigert', {
      method: req.method,
      path: req.originalUrl,
      user: req.user?.username,
      role: req.user?.role,
    });
    return res.status(403).json({ error: 'Zugriff verweigert – Admin erforderlich' });
  }
  next();
}

/**
 * @param {Request} req
 * @param {Response} res
 * @param {NextFunction} next
 */
function requireBearbeiter(req, res, next) {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'bearbeiter')) {
    logger.warn('AUTH', 'Bearbeiter-Zugriff verweigert', {
      method: req.method,
      path: req.originalUrl,
      user: req.user?.username,
      role: req.user?.role,
    });
    return res.status(403).json({ error: 'Zugriff verweigert – Bearbeiter-Berechtigung erforderlich' });
  }
  next();
}

module.exports = { authenticate, requireAdmin, requireBearbeiter, extractToken, JWT_SECRET };
