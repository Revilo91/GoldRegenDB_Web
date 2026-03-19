const express = require('express');
const router = express.Router();
const db = require('../config/db');
const logger = require('../utils/logger');

// GET options: list of base article numbers (without suffix) + name
router.get('/options', async (req, res) => {
  try {
    // Return deduplicated base article numbers (split on '_') to avoid showing suffixes
    const { rows } = await db.query(
      `SELECT DISTINCT split_part("Artikelnummer", '_', 1) as artikel_base, MIN("Name") as name, MIN("Verkaufspreis") as preis
       FROM "Schmuckstück"
       GROUP BY artikel_base
       ORDER BY artikel_base
       LIMIT 1000`
    );
    res.json(rows.map(r => ({ artikelnummer: r.artikel_base, name: r.name, preis: r.preis })));
  } catch (err) {
    logger.error('ETIKETTEN', 'Fehler beim Laden der Etiketten-Optionen', { message: err.message });
    res.status(500).json({ error: 'Fehler beim Laden der Etiketten-Optionen' });
  }
});

// POST preview: generate simple HTML for labels
router.post('/preview', async (req, res) => {
  try {
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (items.length === 0) return res.status(400).json({ error: 'Keine Artikel übergeben' });

    // Collect data for each requested artikelnummer
    const details = [];
    for (const it of items) {
      // accept base artikelnummer (without suffix) and find a matching record
      const artikelnummer = it.artikelnummer;
      const qty = parseInt(it.qty) || 1;
      const { rows } = await db.query(
        `SELECT * FROM "Schmuckstück" WHERE "Artikelnummer" = $1 OR "Artikelnummer" LIKE $2 ORDER BY "Artikelnummer" LIMIT 1`,
        [artikelnummer, artikelnummer + '\_%']
      );
      if (rows.length === 0) {
        // skip missing
        continue;
      }
      details.push({ row: rows[0], qty });
    }

    // Build minimal HTML optimized for small labels (Phomemo M220). User can print from the browser.
    const materialHints = Array.isArray(req.body.materialHints) ? req.body.materialHints : [];
    const labelHtmlParts = [];
    for (const d of details) {
      for (let i = 0; i < d.qty; i++) {
        const art = d.row;
        const name = art.Name || '';
        const num = (art.Artikelnummer || '').split('_')[0];
        const price = art.Verkaufspreis ? ('' + art.Verkaufspreis.toFixed ? art.Verkaufspreis.toFixed(2) : art.Verkaufspreis) : '';
        // build material hint html
        const hintsHtml = materialHints.length > 0 ? (`<div class="material-title">Material Hinweise</div><ul class="hints">${materialHints.map(h => `<li>${escapeHtml(h)}</li>`).join('')}</ul>`) : '';
        labelHtmlParts.push(`
          <div class="label">
            <div class="brand">GoldRegen<br/>Schmuckdesign</div>
            <div class="dotted">............................................</div>
            <div class="artnr"><span class="label-key">Art.Nr.</span> <span class="label-value">${escapeHtml(num)}</span></div>
            ${hintsHtml}
            <div class="qr">${/* optional: could embed a QR here */ ''}</div>
          </div>
        `);
      }
    }

    const html = `<!doctype html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Etiketten Vorschau</title>
        <style>
          @page { size: 48mm 25mm; margin: 2mm; }
          body { margin: 0; padding: 4mm; font-family: Arial, Helvetica, sans-serif; }
          .sheet { display: flex; flex-wrap: wrap; gap: 4mm; }
          .label { width: 48mm; height: 25mm; box-sizing: border-box; border-radius: 6px; background: #fff; padding: 6px; display: flex; flex-direction: column; justify-content: flex-start; align-items: flex-start; }
          .brand { font-size: 12px; font-weight: 700; text-align: center; width:100%; }
          .dotted { width:100%; color:#666; text-align:center; font-size:10px; margin:2px 0 4px 0 }
          .artnr { width:100%; display:flex; gap:6px; align-items:baseline; }
          .label-key { font-size:10px; color:#444 }
          .label-value { font-size:16px; font-weight:700; letter-spacing:1px }
          .material-title { margin-top:4px; font-weight:700; font-size:10px }
          .hints { margin:4px 0 0 14px; padding:0; list-style:disc; font-size:10px }
          .hints li { margin-bottom:2px }
          @media print { .label { border: none; } }
        </style>
      </head>
      <body>
        <div class="sheet">
          ${labelHtmlParts.join('\n')}
        </div>
        <script>window.onload = function(){ window.focus(); /* user prints manually */ };</script>
      </body>
      </html>`;

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    logger.error('ETIKETTEN', 'Fehler beim Erzeugen der Etiketten-Vorschau', { message: err.message });
    res.status(500).json({ error: 'Fehler beim Erzeugen der Etiketten-Vorschau' });
  }
});

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = router;
