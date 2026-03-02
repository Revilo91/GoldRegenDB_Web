require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

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

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

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

// Admin-only routes
app.use('/api/audit-log', apiLimiter, authenticate, requireAdmin, auditLogRoutes);
app.use('/api/debug', apiLimiter, authenticate, requireAdmin, require('./routes/debug'));
app.use('/api/backup', apiLimiter, authenticate, requireAdmin, require('./routes/backup'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`GoldRegenDB Backend running on port ${PORT}`);
});
