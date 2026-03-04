require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const logger = require('./utils/logger');

const { authenticate, requireAdmin } = require('./middleware/auth');
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
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.' },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Anfragen. Bitte kurz warten.' },
});

// Public routes
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth', apiLimiter, authRoutes);

// Health check (public)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Protected routes – all authenticated users
app.use('/api/dashboard', apiLimiter, authenticate, dashboardRoutes);
app.use('/api/kunden', apiLimiter, authenticate, kundenRoutes);
app.use('/api/schmuckstuecke', apiLimiter, authenticate, schmuckstueckeRoutes);
app.use('/api/lieferscheine', apiLimiter, authenticate, lieferscheineRoutes);
app.use('/api/rechnungen', apiLimiter, authenticate, rechnungenRoutes);
app.use('/api/users', apiLimiter, authenticate, requireAdmin, usersRoutes);

// SumUp routes (authentifiziert)
app.use('/api/sumup', apiLimiter, authenticate, sumupRoutes);

// Inventur route (authentifiziert)
app.use('/api/inventur', apiLimiter, authenticate, inventurRoutes);

// Admin-only routes
app.use('/api/audit-log', apiLimiter, authenticate, requireAdmin, auditLogRoutes);
app.use('/api/debug', apiLimiter, authenticate, requireAdmin, require('./routes/debug'));
app.use('/api/backup', apiLimiter, authenticate, requireAdmin, require('./routes/backup'));

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
