'use strict';

// Leitet HTTP auf HTTPS um, wenn ein vorgeschalteter Reverse Proxy TLS terminiert
// und das per X-Forwarded-Proto meldet. Fehlt der Header (z. B. ein Docker-Healthcheck
// direkt gegen den Container statt über den Proxy), wird nicht umgeleitet – sonst
// entstünde eine Redirect-Schleife. Nur eingehängt, wenn FORCE_HTTPS=true (index.js).
function httpsRedirect(req, res, next) {
  const proto = req.headers['x-forwarded-proto'];
  if (proto && proto !== 'https') {
    return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
  }
  return next();
}

module.exports = httpsRedirect;
