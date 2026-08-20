const helmet = require('helmet');

// FORCE_HTTPS zeigt an, dass ein vorgeschalteter Reverse Proxy TLS terminiert
// (siehe index.js). Nur dann ergeben HSTS und ein Upgrade auf https Sinn –
// ohne TLS würde ein Redirect/HSTS die Anwendung unerreichbar machen (#138).
const forceHttps = process.env.FORCE_HTTPS === 'true';
const hstsMaxAge = Number(process.env.HSTS_MAX_AGE) || 15552000; // 180 Tage (helmet-Standard)

// Security-Header. Die CSP gilt für das im Produktions-Image mitausgelieferte
// Frontend (siehe express.static in index.js) – in der Entwicklung liefert Vite
// das Dokument aus, dort greift diese Policy nicht.
const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      // Die React-Komponenten nutzen style-Props, index.css importiert Google Fonts
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      // Fotos werden als data:-URL bzw. Blob in die Seite geladen (api.js)
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: forceHttps ? [] : null,
    },
  },
  hsts: forceHttps ? { maxAge: hstsMaxAge, includeSubDomains: true, preload: false } : false,
  // Fotos/Excel-Downloads müssen vom Vite-Dev-Server (anderer Port) abrufbar sein
  crossOriginResourcePolicy: { policy: 'cross-origin' },
});

module.exports = securityHeaders;
