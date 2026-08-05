const helmet = require('helmet');

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
      // Das Deployment läuft derzeit ohne TLS (Issue #138) – ein automatisches
      // Upgrade auf https würde die Anwendung unerreichbar machen.
      upgradeInsecureRequests: null,
    },
  },
  // Fotos/Excel-Downloads müssen vom Vite-Dev-Server (anderer Port) abrufbar sein
  crossOriginResourcePolicy: { policy: 'cross-origin' },
});

module.exports = securityHeaders;
