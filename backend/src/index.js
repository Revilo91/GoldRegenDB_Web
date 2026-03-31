require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const logger = require('./utils/logger');
const db = require('./config/db');

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

const app = express();
const PORT = process.env.PORT || 3001;

// Startup logging
logger.info('SERVER', '=== GoldRegenDB Backend startet ===');
logger.info('SERVER', `Umgebung: ${process.env.NODE_ENV || 'development'}`);
logger.info('SERVER', `Port: ${PORT}`);
logger.info('SERVER', `DATABASE_URL: ${process.env.DATABASE_URL ? '(gesetzt)' : '(NICHT GESETZT)'}`);
logger.info('SERVER', `JWT_SECRET: ${process.env.JWT_SECRET ? '(gesetzt)' : '(NICHT GESETZT)'}`);

app.use(cors());
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

// Rate limiters
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 Minuten
  max: 10000, // praktisch kein Limit
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.' },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 Minute
  max: 10000, // praktisch kein Limit
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Anfragen. Bitte kurz warten.' },
});

// Public routes
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth', apiLimiter, authRoutes);

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
app.use('/api/dashboard', apiLimiter, authenticate, requireBearbeiter, dashboardRoutes);
app.use('/api/kunden', apiLimiter, authenticate, requireBearbeiter, kundenRoutes);
app.use('/api/schmuckstuecke', apiLimiter, authenticate, schmuckstueckeRoutes);
app.use('/api/lieferscheine', apiLimiter, authenticate, requireBearbeiter, lieferscheineRoutes);
app.use('/api/rechnungen', apiLimiter, authenticate, requireBearbeiter, rechnungenRoutes);
app.use('/api/users', apiLimiter, authenticate, requireAdmin, usersRoutes);

// SumUp routes (Bearbeiter und Admin)
app.use('/api/sumup', apiLimiter, authenticate, requireBearbeiter, sumupRoutes);

// Inventur route (Bearbeiter und Admin)
app.use('/api/inventur', apiLimiter, authenticate, requireBearbeiter, inventurRoutes);
// Lager-Inventur-Entwürfe (Bearbeiter und Admin)
app.use('/api/lagerinventur', apiLimiter, authenticate, requireBearbeiter, lagerinventurRoutes);

// Admin-only routes
app.use('/api/audit-log', apiLimiter, authenticate, requireAdmin, auditLogRoutes);
app.use('/api/debug', apiLimiter, authenticate, requireAdmin, require('./routes/debug'));
app.use('/api/backup', apiLimiter, authenticate, requireAdmin, require('./routes/backup'));

// Public assets for etiketten preview (no auth) — styles + warn SVG
const fs = require('fs');
const path = require('path');
app.get('/api/etiketten/styles.css', async (req, res) => {
  try {
    const cssPath = path.resolve(__dirname, '../../frontend/src/index.css');
    const css = await fs.promises.readFile(cssPath, 'utf8');
    res.set('Content-Type', 'text/css; charset=utf-8');
    res.send(css);
  } catch (err) {
    logger.warn('SERVER', 'Etiketten styles not found', { message: err.message });
    res.status(404).send('');
  }
});

app.get('/api/etiketten/warn.svg', async (req, res) => {
  try {
    const imgPath = path.resolve(__dirname, '../../frontend/public/warn_0-3.svg');
    const svg = await fs.promises.readFile(imgPath, 'utf8');
    res.set('Content-Type', 'image/svg+xml; charset=utf-8');
    res.send(svg);
  } catch (err) {
    logger.warn('SERVER', 'Etiketten warn.svg not found', { message: err.message });
    res.status(404).send('');
  }
});

// Etiketten (Bearbeiter)
app.use('/api/etiketten', apiLimiter, authenticate, requireBearbeiter, etikettenRoutes);

logger.info('SERVER', 'Alle Routen registriert');

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
