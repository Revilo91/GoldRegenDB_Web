const express = require('express');
const router = express.Router();

const SUMUP_API_URL = 'https://api.sumup.com/v0.1';

// POST /api/sumup/checkout - Create a SumUp checkout for an invoice
router.post('/checkout', async (req, res) => {
  const apiKey = process.env.SUMUP_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'SumUp API-Schlüssel nicht konfiguriert' });
  }

  try {
    const { rechnungNummer, amount, currency = 'EUR', description } = req.body;

    if (!rechnungNummer || !amount) {
      return res.status(400).json({ error: 'rechnungNummer und amount sind erforderlich' });
    }

    const sanitizedRef = String(rechnungNummer).replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 64);
    if (!sanitizedRef) {
      return res.status(400).json({ error: 'Ungültige Rechnungsnummer' });
    }

    const parsedAmount = parseFloat(amount);
    if (!isFinite(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'Betrag muss größer als 0 sein' });
    }

    const payload = {
      checkout_reference: `RECHNUNG-${sanitizedRef}`,
      amount: parsedAmount,
      currency,
      description: description || `GoldRegen Rechnung ${rechnungNummer}`,
    };

    const response = await fetch(`${SUMUP_API_URL}/checkouts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.message || 'SumUp API Fehler',
        details: data,
      });
    }

    res.json(data);
  } catch (err) {
    console.error('SumUp Fehler:', err);
    res.status(500).json({ error: 'Fehler beim Erstellen des SumUp-Checkouts' });
  }
});

// GET /api/sumup/checkout/:id - Get checkout status
router.get('/checkout/:id', async (req, res) => {
  const apiKey = process.env.SUMUP_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'SumUp API-Schlüssel nicht konfiguriert' });
  }

  try {
    const response = await fetch(`${SUMUP_API_URL}/checkouts/${req.params.id}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.message || 'SumUp API Fehler',
        details: data,
      });
    }

    res.json(data);
  } catch (err) {
    console.error('SumUp Fehler:', err);
    res.status(500).json({ error: 'Fehler beim Abrufen des SumUp-Checkouts' });
  }
});

module.exports = router;
