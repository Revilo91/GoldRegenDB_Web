const express = require('express');
const cors = require('cors');

const kundenRoutes = require('./routes/kunden');
const schmuckstueckeRoutes = require('./routes/schmuckstuecke');
const lieferscheineRoutes = require('./routes/lieferscheine');
const rechnungenRoutes = require('./routes/rechnungen');
const auditLogRoutes = require('./routes/auditLog');
const dashboardRoutes = require('./routes/dashboard');
const sumupRoutes = require('./routes/sumup');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/kunden', kundenRoutes);
app.use('/api/schmuckstuecke', schmuckstueckeRoutes);
app.use('/api/lieferscheine', lieferscheineRoutes);
app.use('/api/rechnungen', rechnungenRoutes);
app.use('/api/audit-log', auditLogRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/debug', require('./routes/debug'));
app.use('/api/sumup', sumupRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`GoldRegenDB Backend running on port ${PORT}`);
});
