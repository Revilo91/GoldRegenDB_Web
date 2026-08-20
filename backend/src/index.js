const path = require('path');
const { existsSync } = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const express = require('express');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const logger = require('./utils/logger');
const db = require('./config/db');

const securityHeaders = require('./middleware/securityHeaders');
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
const bestelluebersichtRoutes = require('./routes/bestelluebersicht');
const bestellungPublicRoutes = require('./routes/bestellungPublic');

const app = express();
const PORT = process.env.PORT || 3001;

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
logger.info('SERVER', `DATABASE_URL: ${process.env.DATABASE_URL ? '(gesetzt)' : '(NICHT GESETZT)'}`);
logger.info('SERVER', `JWT_SECRET: ${process.env.JWT_SECRET ? '(gesetzt)' : '(NICHT GESETZT)'}`);
logger.info('SERVER', `ALLOWED_ORIGINS: ${process.env.ALLOWED_ORIGINS || '(nicht gesetzt – Standard-Dev-Origins)'}`);
logger.info('SERVER', `COOKIE_SECURE: ${process.env.COOKIE_SECURE === 'true' ? 'true (Cookie nur über HTTPS)' : 'false (auch über HTTP)'}`);
logger.info('SERVER', `TRUST_PROXY: ${trustProxySetting === false ? 'false (kein Reverse Proxy)' : String(trustProxySetting)}`);

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
    const duration = Date.now() - start;
    const status = res.statusCode;
    const user = req.user ? req.user.username : 'anonym';
    const logLine = `${method} ${originalUrl} → ${status} (${duration}ms) [User: ${user}]`;

    if (status >= 500) {
      logger.error('HTTP', logLine);
    } else if (status >= 400) {
      logger.warn('HTTP', logLine);
    } else {
      logger.info('HTTP', logLine);
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

// Health check (public) – includes database connectivity test
app.get('/api/health', async (req, res) => {
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

app.listen(PORT, '0.0.0.0', () => {
  logger.info('SERVER', `GoldRegenDB Backend läuft auf Port ${PORT}`);
  logger.info('SERVER', '=== Backend bereit ===');
});
