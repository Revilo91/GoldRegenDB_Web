const crypto = require('crypto');
const logger = require('../utils/logger');
const { AUTH_COOKIE_NAME } = require('../utils/authCookie');

// Double-Submit-Cookie-Pattern: der Server legt ein Zufallstoken in einem
// (bewusst nicht httpOnly) Cookie ab. Eigenes JavaScript kann es lesen und als
// Header mitschicken, fremde Websites können das wegen der Same-Origin-Policy
// nicht – sie können den Cookie zwar mitsenden lassen, aber nicht auslesen.
//
// Bewusst nicht `csurf`: das Paket ist seit 2022 deprecated und archiviert.
const CSRF_COOKIE_NAME = 'csrfToken';
const CSRF_HEADER_NAME = 'x-csrf-token';

// Nur zustandsändernde Methoden brauchen Schutz; GET/HEAD/OPTIONS sollen
// per Definition keine Seiteneffekte haben.
const GESCHUETZTE_METHODEN = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function erzeugeToken() {
  return crypto.randomBytes(32).toString('hex');
}

function csrfCookieOptions() {
  return {
    // Muss lesbar sein – genau darauf beruht das Double-Submit-Verfahren
    httpOnly: false,
    secure: process.env.COOKIE_SECURE === 'true',
    sameSite: 'lax',
    path: '/',
  };
}

function setCsrfCookie(res, token) {
  res.cookie(CSRF_COOKIE_NAME, token, csrfCookieOptions());
}

// Vergleich in konstanter Zeit, damit sich das Token nicht Zeichen für Zeichen
// erraten lässt.
function tokenGleich(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// GET /api/csrf-token – Token ausstellen (und im Cookie hinterlegen)
function csrfTokenHandler(req, res) {
  const token = req.cookies?.[CSRF_COOKIE_NAME] || erzeugeToken();
  setCsrfCookie(res, token);
  res.json({ csrfToken: token });
}

function csrfProtection(req, res, next) {
  if (!GESCHUETZTE_METHODEN.has(req.method)) {
    return next();
  }

  // Der Schutz greift nur, wenn der Request seine Berechtigung aus dem
  // Auth-Cookie zieht – nur dann kann eine fremde Seite sie unbemerkt
  // mitbenutzen. Requests mit Authorization-Header (Skripte, E2E-Tests) und
  // unauthentifizierte Endpunkte (Login, öffentliches Bestellformular)
  // brauchen keinen Token: dort gibt es keine Ambient Authority zu missbrauchen.
  if (!req.cookies?.[AUTH_COOKIE_NAME]) {
    return next();
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = req.headers[CSRF_HEADER_NAME];

  if (!cookieToken || !headerToken || !tokenGleich(cookieToken, headerToken)) {
    logger.warn('CSRF', 'Request ohne gültiges CSRF-Token abgelehnt', {
      method: req.method,
      path: req.originalUrl,
      hatCookie: Boolean(cookieToken),
      hatHeader: Boolean(headerToken),
    });
    return res.status(403).json({
      error: 'CSRF-Token fehlt oder ist ungültig',
      code: 'CSRF_TOKEN_INVALID',
    });
  }

  return next();
}

module.exports = {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  csrfProtection,
  csrfTokenHandler,
  setCsrfCookie,
  erzeugeToken,
};
