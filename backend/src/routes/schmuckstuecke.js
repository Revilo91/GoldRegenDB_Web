const express = require('express');
const router = express.Router();
const db = require('../config/db');

// GET with pagination, search and filters
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    const art = req.query.art || '';
    const verkauft = req.query.verkauft;
    const ausgelagert = req.query.ausgelagert;
    const online = req.query.online;

    let where = [];
    let params = [];
    let paramIdx = 1;

    if (search) {
      where.push(`("Artikelnummer" ILIKE $${paramIdx} OR "Name" ILIKE $${paramIdx} OR "Art" ILIKE $${paramIdx} OR "Material" ILIKE $${paramIdx})`);
      params.push(`%${search}%`);
      paramIdx++;
    }
    if (art) {
      where.push(`"Art" = $${paramIdx}`);
      params.push(art);
      paramIdx++;
    }
    if (verkauft !== undefined) {
      where.push(`"Verkauft" = $${paramIdx}`);
      params.push(parseInt(verkauft));
      paramIdx++;
    }
    if (ausgelagert !== undefined) {
      where.push(`"Ausgelagert" = $${paramIdx}`);
      params.push(parseInt(ausgelagert));
      paramIdx++;
    }
    if (online !== undefined) {
      where.push(`"Online" = $${paramIdx}`);
      params.push(parseInt(online));
      paramIdx++;
    }

    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

    // Count total
    const countResult = await db.query(
      `SELECT COUNT(*) FROM "Schmuckstück" ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    // Get page
    const { rows } = await db.query(
      `SELECT * FROM "Schmuckstück" ${whereClause} ORDER BY "Artikelnummer" LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
    );

    res.json({
      data: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fehler beim Laden der Schmuckstücke' });
  }
});

// GET distinct values for filters
router.get('/filter-options', async (req, res) => {
  try {
    const [arten, farben, materialien, formen] = await Promise.all([
      db.query('SELECT DISTINCT "Art" FROM "Schmuckstück" WHERE "Art" IS NOT NULL AND "Art" != \'\' ORDER BY "Art"'),
      db.query('SELECT DISTINCT "Farbe" FROM "Schmuckstück" WHERE "Farbe" IS NOT NULL AND "Farbe" != \'\' ORDER BY "Farbe"'),
      db.query('SELECT DISTINCT "Material" FROM "Schmuckstück" WHERE "Material" IS NOT NULL AND "Material" != \'\' ORDER BY "Material"'),
      db.query('SELECT DISTINCT "Form" FROM "Schmuckstück" WHERE "Form" IS NOT NULL AND "Form" != \'\' ORDER BY "Form"'),
    ]);
    res.json({
      arten: arten.rows.map(r => r.Art),
      farben: farben.rows.map(r => r.Farbe),
      materialien: materialien.rows.map(r => r.Material),
      formen: formen.rows.map(r => r.Form),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fehler beim Laden der Filter-Optionen' });
  }
});

// GET single piece
router.get('/:artikelnummer', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM "Schmuckstück" WHERE "Artikelnummer" = $1',
      [req.params.artikelnummer]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Schmuckstück nicht gefunden' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fehler beim Laden des Schmuckstücks' });
  }
});

// POST create piece
router.post('/', async (req, res) => {
  try {
    const b = req.body;
    const { rows } = await db.query(
      `INSERT INTO "Schmuckstück" (
        "Artikelnummer", "Name", "Foto", "Art", "Form", "Länge", "Fassung", "Farbe",
        "Inhalt_Material", "Inhalt_Farbe", "Inhalt_Farbakzent", "Inhalt_Zusatzmaterial",
        "Anhänger_Fassung", "Anhänger_Form", "Anhänger_Farbe", "Anhänger_Grösse",
        "Anhänger_Inhalt_Material", "Anhänger_Inhalt_Farbe", "Anhänger_Inhalt_Farbakzente",
        "Anhänger_Inhalt_Zusatzmaterial", "Material", "Grösse", "Anhänger", "Zwischenstück",
        "Herstellungskosten", "Verkaufspreis", "Online", "Ausgelagert", "Verkauft", "Ausschuss"
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30
      ) RETURNING *`,
      [
        b.Artikelnummer, b.Name, b.Foto, b.Art, b.Form, b.Länge || 0, b.Fassung, b.Farbe,
        b.Inhalt_Material, b.Inhalt_Farbe, b.Inhalt_Farbakzent, b.Inhalt_Zusatzmaterial,
        b.Anhänger_Fassung, b.Anhänger_Form, b.Anhänger_Farbe, b.Anhänger_Grösse || 0,
        b.Anhänger_Inhalt_Material, b.Anhänger_Inhalt_Farbe, b.Anhänger_Inhalt_Farbakzente,
        b.Anhänger_Inhalt_Zusatzmaterial, b.Material, b.Grösse || 0, b.Anhänger, b.Zwischenstück,
        b.Herstellungskosten || 0, b.Verkaufspreis || 0, b.Online || 0, b.Ausgelagert || 0, b.Verkauft || 0, b.Ausschuss || 0,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fehler beim Erstellen des Schmuckstücks' });
  }
});

// PUT update piece
router.put('/:artikelnummer', async (req, res) => {
  try {
    const b = req.body;
    const { rows } = await db.query(
      `UPDATE "Schmuckstück" SET
        "Name" = $1, "Foto" = $2, "Art" = $3, "Form" = $4, "Länge" = $5,
        "Fassung" = $6, "Farbe" = $7, "Inhalt_Material" = $8, "Inhalt_Farbe" = $9,
        "Inhalt_Farbakzent" = $10, "Inhalt_Zusatzmaterial" = $11,
        "Anhänger_Fassung" = $12, "Anhänger_Form" = $13, "Anhänger_Farbe" = $14,
        "Anhänger_Grösse" = $15, "Anhänger_Inhalt_Material" = $16,
        "Anhänger_Inhalt_Farbe" = $17, "Anhänger_Inhalt_Farbakzente" = $18,
        "Anhänger_Inhalt_Zusatzmaterial" = $19, "Material" = $20, "Grösse" = $21,
        "Anhänger" = $22, "Zwischenstück" = $23, "Herstellungskosten" = $24,
        "Verkaufspreis" = $25, "Online" = $26, "Ausgelagert" = $27,
        "Verkauft" = $28, "Ausschuss" = $29, "Lieferschein_ID" = $30, "Rechnung_ID" = $31
       WHERE "Artikelnummer" = $32 RETURNING *`,
      [
        b.Name, b.Foto, b.Art, b.Form, b.Länge,
        b.Fassung, b.Farbe, b.Inhalt_Material, b.Inhalt_Farbe,
        b.Inhalt_Farbakzent, b.Inhalt_Zusatzmaterial,
        b.Anhänger_Fassung, b.Anhänger_Form, b.Anhänger_Farbe,
        b.Anhänger_Grösse, b.Anhänger_Inhalt_Material,
        b.Anhänger_Inhalt_Farbe, b.Anhänger_Inhalt_Farbakzente,
        b.Anhänger_Inhalt_Zusatzmaterial, b.Material, b.Grösse,
        b.Anhänger, b.Zwischenstück, b.Herstellungskosten,
        b.Verkaufspreis, b.Online, b.Ausgelagert,
        b.Verkauft, b.Ausschuss, b.Lieferschein_ID, b.Rechnung_ID,
        req.params.artikelnummer,
      ]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Schmuckstück nicht gefunden' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fehler beim Aktualisieren des Schmuckstücks' });
  }
});

// DELETE piece
router.delete('/:artikelnummer', async (req, res) => {
  try {
    const { rowCount } = await db.query(
      'DELETE FROM "Schmuckstück" WHERE "Artikelnummer" = $1',
      [req.params.artikelnummer]
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Schmuckstück nicht gefunden' });
    }
    res.json({ message: 'Schmuckstück gelöscht' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fehler beim Löschen des Schmuckstücks' });
  }
});

module.exports = router;
