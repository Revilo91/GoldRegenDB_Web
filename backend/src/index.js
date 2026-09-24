const path = require('path');
const { existsSync } = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const logger = require('./utils/logger');
const { getSecret, validateProductionSecrets, extractDatabaseUrlPassword } = require('./config/secrets');

// Bricht den Start ab, wenn in Produktion noch Platzhalter aus .env.example
// oder zu kurze Secrets gesetzt sind (Issue #140). Im Dev-Betrieb ein No-Op.
const secretProbleme = validateProductionSecrets([
  { name: 'JWT_SECRET', value: getSecret('JWT_SECRET'), minLength: 32 },
  {
    name: 'DB_PASSWORD',
    value: getSecret('DB_PASSWORD') || extractDatabaseUrlPassword(getSecret('DATABASE_URL')),
    minLength: 12,
  },
  { name: 'BESTELLUNG_ENCRYPTION_KEY', value: getSecret('BESTELLUNG_ENCRYPTION_KEY'), minLength: 64 },
]);
if (secretProbleme.length > 0) {
  secretProbleme.forEach((problem) => logger.error('SECRETS', problem));
  logger.error('SECRETS', 'FATAL: Unsichere Secrets in Produktion (NODE_ENV=production) – Start abgebrochen. Siehe .env.example bzw. Rotations-Anleitung in der Doku.');
  process.exit(1);
}

const express = require('express');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const db = require('./config/db');

const securityHeaders = require('./middleware/securityHeaders');
const httpsRedirect = require('./middleware/httpsRedirect');
const cors = require('./middleware/cors');
const { csrfProtection, csrfTokenHandler } = require('./middleware/csrf');
const { authenticate, requireAdmin, requireBearbeiter } = require('./middleware/auth');
const kundenRoutes = require('./routes/kunden');
const schmuckstueckeRoutes = require('./routes/schmuckstuecke');
const lieferscheineRoutes = require('./routes/lieferscheine');
const rechnungenRoutes = require('./routes/rechnungen');
const auditLogRoutes = require('./routes/auditLog');
const dashboardRoutes = require('./routes/dashboard');
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const sumupRoutes = require('./routes/sumup');
const inventurRoutes = require('./routes/inventur');
const lagerinventurRoutes = require('./routes/lagerinventur');
const etikettenRoutes = require('./routes/etiketten');
const bestelluebersichtRoutes = require('./routes/bestelluebersicht');
const bestellungPublicRoutes = require('./routes/bestellungPublic');

const app = express();
const PORT = process.env.PORT || 3001;
const forceHttps = process.env.FORCE_HTTPS === 'true';

// Hinter einem Reverse Proxy (Synology, Traefik, nginx …) sieht Express sonst
// nur die Proxy-IP – alle Benutzer teilen sich dann eine einzige Rate-Limit-
// Quote und req.ip ist im Log wertlos. TRUST_PROXY nimmt die Anzahl der
// vorgelagerten Proxys ("1"), "loopback"/eine IP-Liste oder "true" entgegen.
// Standard ist "false": ohne Proxy darf X-Forwarded-For nicht vertraut werden.
const trustProxySetting = (() => {
  const raw = (process.env.TRUST_PROXY || '').trim();
  if (!raw || raw === 'false') return false;
  if (raw === 'true') return true;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
})();
app.set('trust proxy', trustProxySetting);

// Startup logging
logger.info('SERVER', '=== GoldRegenDB Backend startet ===');
logger.info('SERVER', `Umgebung: ${process.env.NODE_ENV || 'development'}`);
logger.info('SERVER', `Port: ${PORT}`);
logger.info('SERVER', `DATABASE_URL: ${db.connectionString ? '(gesetzt)' : '(NICHT GESETZT)'}`);
logger.info('SERVER', `JWT_SECRET: ${getSecret('JWT_SECRET') ? '(gesetzt)' : '(NICHT GESETZT)'}${getSecret('JWT_SECRET_OLD') ? ' + JWT_SECRET_OLD (Rollover aktiv)' : ''}`);
logger.info('SERVER', `ALLOWED_ORIGINS: ${process.env.ALLOWED_ORIGINS || '(nicht gesetzt – Standard-Dev-Origins)'}`);
logger.info('SERVER', `COOKIE_SECURE: ${process.env.COOKIE_SECURE === 'true' ? 'true (Cookie nur über HTTPS)' : 'false (auch über HTTP)'}`);
logger.info('SERVER', `TRUST_PROXY: ${trustProxySetting === false ? 'false (kein Reverse Proxy)' : String(trustProxySetting)}`);
logger.info('SERVER', `FORCE_HTTPS: ${forceHttps ? 'true (HTTP wird auf HTTPS umgeleitet, HSTS aktiv)' : 'false'}`);

// Läuft in Produktion ohne TLS-Terminierung (kein FORCE_HTTPS/COOKIE_SECURE) – Cookies
// und Zugangsdaten gingen dann unverschlüsselt über das Netz (siehe Issue #138).
if (process.env.NODE_ENV === 'production' && !forceHttps && process.env.COOKIE_SECURE !== 'true') {
  logger.warn('SERVER', 'Produktions-Deployment ohne TLS: Weder FORCE_HTTPS noch COOKIE_SECURE ist gesetzt. '
    + 'Ein vorgeschalteter Reverse Proxy sollte TLS terminieren, siehe README.md (Abschnitt Synology NAS / HTTPS).');
}

if (forceHttps) {
  app.use(httpsRedirect);
}

app.use(securityHeaders);
app.use(cors);
app.use(cookieParser());
// Muss nach cookieParser laufen und vor allen Routen, die Daten verändern
app.use(csrfProtection);
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(db.requestContextMiddleware);

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const { method, originalUrl } = req;

  res.on('finish', () => {
    const meta = {
      method,
      path: originalUrl,
      status_code: res.statusCode,
      duration_ms: Date.now() - start,
      user: req.user ? req.user.username : 'anonym',
      user_ip: req.ip,
    };
    const message = `${method} ${originalUrl} → ${meta.status_code} (${meta.duration_ms}ms)`;

    if (meta.status_code >= 500) {
      logger.error('HTTP', message, meta);
    } else if (meta.status_code >= 400) {
      logger.warn('HTTP', message, meta);
    } else {
      logger.info('HTTP', message, meta);
    }
  });

  next();
});

// Rate limiter nur noch dort, wo unauthentifizierte Requests missbraucht werden
// können. Die angemeldete Anwendung läuft bewusst ohne Limit: eine einzige
// Tabellenseite löst je Zeile einen Foto-Request aus, sodass jedes Limit im
// normalen Arbeitsablauf (erst recht mit zwei Tabs) sofort zuschlug.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  // Erfolgreiche Anmeldungen zählen nicht mit – sonst sperrt ein gemeinsamer
  // Firmen-/NAS-Ausgang alle Benutzer gemeinsam aus. Der eigentliche
  // Brute-Force-Schutz ist die Kontosperre in utils/accountSecurity.js.
  skipSuccessfulRequests: true,
  message: { error: 'Zu viele Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.' },
});

// Strenger Limiter für das öffentliche, unauthentifizierte Bestellformular (Spam-/Abuse-Schutz)
const publicOrderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Bestellungen von dieser Adresse. Bitte später erneut versuchen.' },
});

// Public routes
// Die Passwort-Endpunkte sind unauthentifiziert und brute-force-tauglich –
// sie laufen unter dem strengen Login-Limiter, nicht dem allgemeinen.
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/forgot-password', loginLimiter);
app.use('/api/auth/reset-password', loginLimiter);
app.use('/api/auth', authRoutes);

// Öffentliches Bestellformular (kein Login erforderlich) – nur Erstellung neuer Bestellungen möglich
app.use('/api/public/bestellung', publicOrderLimiter, bestellungPublicRoutes);

// CSRF-Token für das Frontend (public – das Token selbst ist kein Geheimnis,
// entscheidend ist, dass fremde Seiten es nicht auslesen können)
app.get('/api/csrf-token', csrfTokenHandler);

// Health check (public) – prüft Datenbankverbindung UND Schemastand.
// Ohne die Schema-Prüfung meldet der Endpunkt "ok", während die Migrationen noch
// laufen oder gescheitert sind (Befund A3) – Orchestrierer und Compose-
// Healthchecks hielten ein kaputtes Backend dann für gesund.
app.get('/api/health', async (req, res) => {
  if (!db.isSchemaReady()) {
    return res.status(503).json({
      status: 'starting',
      database: 'schema_not_ready',
      timestamp: new Date().toISOString(),
    });
  }
  try {
    await db.query('SELECT 1 AS ok');
    res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error('SERVER', 'Health-Check: Datenbankverbindung fehlgeschlagen', { message: err.message });
    res.status(503).json({ status: 'error', database: 'disconnected', timestamp: new Date().toISOString() });
  }
});

// Protected routes – bearbeiter and admin (all non-admin authenticated users with full access)
app.use('/api/dashboard', authenticate, requireBearbeiter, dashboardRoutes);
app.use('/api/kunden', authenticate, requireBearbeiter, kundenRoutes);
app.use('/api/schmuckstuecke', authenticate, schmuckstueckeRoutes);
app.use('/api/lieferscheine', authenticate, requireBearbeiter, lieferscheineRoutes);
app.use('/api/rechnungen', authenticate, requireBearbeiter, rechnungenRoutes);
app.use('/api/bestelluebersicht', authenticate, requireBearbeiter, bestelluebersichtRoutes);
app.use('/api/users', authenticate, requireAdmin, usersRoutes);

// SumUp routes (Bearbeiter und Admin)
app.use('/api/sumup', authenticate, requireBearbeiter, sumupRoutes);

// Inventur route (Bearbeiter und Admin)
app.use('/api/inventur', authenticate, requireBearbeiter, inventurRoutes);
// Lager-Inventur-Entwürfe (Bearbeiter und Admin)
app.use('/api/lagerinventur', authenticate, requireBearbeiter, lagerinventurRoutes);

// Admin-only routes
app.use('/api/audit-log', authenticate, requireAdmin, auditLogRoutes);
app.use('/api/debug', authenticate, requireAdmin, require('./routes/debug'));
app.use('/api/backup', authenticate, requireAdmin, require('./routes/backup'));

// API-Dokumentation (Swagger UI, Issue #143): legt die komplette Routenstruktur
// offen, daher weder in Produktion noch anonym erreichbar. shouldEnableApiDocs()
// mountet standardmäßig nur außerhalb von Produktion; ENABLE_API_DOCS erlaubt
// eine explizite Übersteuerung (z. B. Staging mit NODE_ENV=production).
// Zusätzlich unabhängig davon immer hinter authenticate + requireAdmin, damit
// eine versehentlich aktivierte Doku nie anonym erreichbar ist. Die Standard-CSP
// (style-src 'unsafe-inline', sonst same-origin) reicht für Swagger UI aus –
// geprüft, keine Lockerung nötig, siehe Issue #143.
const swaggerSpec = require('./config/swagger');
if (swaggerSpec.shouldEnableApiDocs()) {
  const swaggerUi = require('swagger-ui-express');
  app.use('/api-docs', authenticate, requireAdmin, swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  logger.info('SERVER', 'API-Dokumentation verfügbar unter /api-docs (nur für admin)');
} else {
  logger.info('SERVER', 'API-Dokumentation deaktiviert (ENABLE_API_DOCS=false)');
}

// Etiketten (Bearbeiter)
app.use('/api/etiketten', authenticate, requireBearbeiter, etikettenRoutes);

logger.info('SERVER', 'Alle Routen registriert');

// Frontend-Build ausliefern (Single-Container-Docker-Image, siehe Root-Dockerfile).
// In nativer Entwicklung existiert ./public nicht – Vite läuft dann separat.
const publicDir = path.join(__dirname, 'public');
if (existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

// Global error handler
app.use((err, req, res, _next) => {
  logger.error('SERVER', `Unbehandelter Fehler: ${req.method} ${req.originalUrl}`, {
    message: err.message,
    stack: err.stack,
  });
  res.status(500).json({ error: 'Interner Serverfehler' });
});

// Erst migrieren, dann lauschen. Vorher lief die Migrationskette als frei
// laufendes Promise und app.listen() startete sofort – die ersten Requests
// trafen dann ein Schema, dem noch Spalten fehlten (Befund A1). Scheitert das
// Schema, ist das ein Startfehler und kein Logeintrag (Befund A2).
db.initializeDatabase()
  .then(() => {
    const server = app.listen(PORT, '0.0.0.0', () => {
      logger.info('SERVER', `GoldRegenDB Backend läuft auf Port ${PORT}`);
      logger.info('SERVER', '=== Backend bereit ===');
    });

    // Ohne Signal-Handler reisst `docker stop` laufende Requests ab und der
    // Pool wird nie geschlossen (Befund A6).
    const shutdown = (signal) => {
      logger.info('SERVER', `${signal} empfangen – Backend wird beendet`);
      server.close(async () => {
        try {
          await db.pool.end();
          logger.info('SERVER', 'Datenbank-Pool geschlossen');
        } catch (err) {
          logger.error('SERVER', 'Fehler beim Schließen des Pools', { message: err.message });
        }
        process.exit(0);
      });
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  })
  .catch((err) => {
    logger.error('SERVER', 'FATAL: Datenbankschema konnte nicht hergestellt werden – Start abgebrochen.', {
      message: err.message,
      code: err.code,
    });
    process.exit(1);
  });
