const express = require("express");
const router = express.Router();
const db = require("../config/db");

const GRUNDMATERIAL = {
  A: "Alkoholtinte",
  B: "Beton",
  C: "Cucio",
  E: "Edelstahl",
  F: "Fimo",
  H: "Harz",
  I: "Phiole",
  J: "Papier",
  K: "Kordel",
  L: "Leder",
  M: "Makramee",
  N: "Naturstein",
  P: "Perle",
  S: "Schrumpffolie",
  W: "Holz",
  X: "3D-Druck",
  Y: "Cabochon",
};

// GET with pagination, search and filters
router.get("/", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const search = req.query.search || "";
    const art = req.query.art || "";
    const verkauft = req.query.verkauft;
    const ausgelagert = req.query.ausgelagert;
    const online = req.query.online;
    const artikelnummer_art = req.query.artikelnummer_art;
    const ohne_lieferschein = req.query.ohne_lieferschein;
    const ohne_rechnung = req.query.ohne_rechnung;

    let where = [];
    let params = [];
    let paramIdx = 1;

    if (search) {
      where.push(
        `("Artikelnummer" ILIKE $${paramIdx} OR "Name" ILIKE $${paramIdx} OR "Art" ILIKE $${paramIdx} OR "Material" ILIKE $${paramIdx})`,
      );
      params.push(`%${search}%`);
      paramIdx++;
    }
    if (art) {
      where.push(`"Art" = $${paramIdx}`);
      params.push(art);
      paramIdx++;
    }
    if (artikelnummer_art) {
      where.push(`SUBSTRING("Artikelnummer", 3, 1) = $${paramIdx}`);
      params.push(artikelnummer_art);
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
    if (ohne_lieferschein === "1") {
      where.push('"Lieferschein_ID" IS NULL');
    }
    if (ohne_rechnung === "1") {
      where.push('"Rechnung_ID" IS NULL');
    }

    const whereClause = where.length > 0 ? "WHERE " + where.join(" AND ") : "";

    // Count total
    const countResult = await db.query(
      `SELECT COUNT(*) FROM "Schmuckstück" ${whereClause}`,
      params,
    );
    const total = parseInt(countResult.rows[0].count);

    // Get page
    const { rows } = await db.query(
      `SELECT * FROM "Schmuckstück" ${whereClause} ORDER BY length("Artikelnummer"), "Artikelnummer" LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset],
    );
    const processedRows = rows.map((row) => ({
      ...row,
      Grundmaterial: row.Artikelnummer
        ? GRUNDMATERIAL[row.Artikelnummer[1]?.toUpperCase()] || "Unbekannt"
        : "Keine Nummer",
    }));

    res.json({
      data: processedRows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Fehler beim Laden der Schmuckstücke" });
  }
});

// GET distinct values for filters
router.get("/filter-options", async (req, res) => {
  try {
    const [arten, farben, materialien, formen] = await Promise.all([
      db.query(
        'SELECT DISTINCT "Art" FROM "Schmuckstück" WHERE "Art" IS NOT NULL AND "Art" != \'\' ORDER BY "Art"',
      ),
      db.query(
        'SELECT DISTINCT "Farbe" FROM "Schmuckstück" WHERE "Farbe" IS NOT NULL AND "Farbe" != \'\' ORDER BY "Farbe"',
      ),
      db.query(
        'SELECT DISTINCT "Material" FROM "Schmuckstück" WHERE "Material" IS NOT NULL AND "Material" != \'\' ORDER BY "Material"',
      ),
      db.query(
        'SELECT DISTINCT "Form" FROM "Schmuckstück" WHERE "Form" IS NOT NULL AND "Form" != \'\' ORDER BY "Form"',
      ),
    ]);
    res.json({
      arten: arten.rows.map((r) => r.Art),
      farben: farben.rows.map((r) => r.Farbe),
      materialien: materialien.rows.map((r) => r.Material),
      formen: formen.rows.map((r) => r.Form),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Fehler beim Laden der Filter-Optionen" });
  }
});

// GET single piece
router.get("/:artikelnummer", async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM "Schmuckstück" WHERE "Artikelnummer" = $1',
      [req.params.artikelnummer],
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Schmuckstück nicht gefunden" });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Fehler beim Laden des Schmuckstücks" });
  }
});

// POST create piece
router.post("/", async (req, res) => {
  const client = await db.pool.connect();
  try {
    const b = req.body;
    const quantity = parseInt(b.Anzahl) || 1;
    let baseArtikelnummer = b.Artikelnummer.trim();
    let startSuffix = 1;

    await client.query("BEGIN");

    // Case 1: Prefix only (3 chars, e.g. "MHO")
    if (baseArtikelnummer.length === 3) {
      const prefix = baseArtikelnummer.toUpperCase();
      const { rows } = await client.query(
        `SELECT MAX(CAST(SUBSTRING("Artikelnummer", 4, 3) AS INTEGER)) as max_num 
         FROM "Schmuckstück" 
         WHERE "Artikelnummer" LIKE $1`,
        [`${prefix}%`],
      );
      const nextNum = (rows[0].max_num || 0) + 1;
      baseArtikelnummer = prefix + nextNum.toString().padStart(3, "0");
    }
    // Case 2: Base Artikelnummer (e.g. "MHO112")
    else if (/^[A-Z]{3}\d{3}$/.test(baseArtikelnummer.toUpperCase())) {
      baseArtikelnummer = baseArtikelnummer.toUpperCase();
      const { rows } = await client.query(
        `SELECT MAX(CAST(SUBSTRING("Artikelnummer", 8) AS INTEGER)) as max_suffix 
         FROM "Schmuckstück" 
         WHERE "Artikelnummer" LIKE $1`,
        [`${baseArtikelnummer}_%`],
      );
      startSuffix = (rows[0].max_suffix || 0) + 1;
    } else if (baseArtikelnummer.includes("_")) {
      // If they provided a full number with suffix, just use it as is (quantity will still work but might collide)
      const parts = baseArtikelnummer.split("_");
      baseArtikelnummer = parts[0].toUpperCase();
      startSuffix = parseInt(parts[1]) || 1;
    }

    // Daten von Produkt holen, sobald das form nicht ausgefüllt ist
    if (b.Artikelnummer) {
      const { rows } = await client.query(
        `SELECT * FROM "Schmuckstück" WHERE "Artikelnummer" = $1 || '_' || $2`,
        [baseArtikelnummer, startSuffix - 1],
      );
      if (rows.length > 0) {
        b.Name = rows[0].Name;
        b.Foto = rows[0].Foto;
        b.Art = rows[0].Art;
        b.Material = rows[0].Material;
        b.Farbe = rows[0].Farbe;
        b.Verkaufspreis = rows[0].Verkaufspreis;
        b.Herstellungskosten = rows[0].Herstellungskosten;
        b.Ausgelagert = 0;
        b.Verkauft = 0;
        b.Online = 0;
        b.Ausschuss = 0;
        b.Länge = rows[0].Länge;
        b.Fassung = rows[0].Fassung;
        b.Farbe = rows[0].Farbe;
        b.Inhalt_Material = rows[0].Inhalt_Material;
        b.Inhalt_Farbe = rows[0].Inhalt_Farbe;
        b.Inhalt_Farbakzent = rows[0].Inhalt_Farbakzent;
        b.Inhalt_Zusatzmaterial = rows[0].Inhalt_Zusatzmaterial;
        b.Anhänger_Fassung = rows[0].Anhänger_Fassung;
        b.Anhänger_Form = rows[0].Anhänger_Form;
        b.Anhänger_Farbe = rows[0].Anhänger_Farbe;
        b.Anhänger_Grösse = rows[0].Anhänger_Grösse;
        b.Anhänger_Inhalt_Material = rows[0].Anhänger_Inhalt_Material;
        b.Anhänger_Inhalt_Farbe = rows[0].Anhänger_Inhalt_Farbe;
        b.Anhänger_Inhalt_Farbakzente = rows[0].Anhänger_Inhalt_Farbakzente;
        b.Anhänger_Inhalt_Zusatzmaterial =
          rows[0].Anhänger_Inhalt_Zusatzmaterial;
        b.Material = rows[0].Material;
        b.Grösse = rows[0].Grösse;
        b.Anhänger = rows[0].Anhänger;
        b.Zwischenstück = rows[0].Zwischenstück;
      }
    }
    const createdItems = [];
    for (let i = 0; i < quantity; i++) {
      const fullArtNr = `${baseArtikelnummer}_${startSuffix + i}`;
      const { rows } = await client.query(
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
          fullArtNr,
          b.Name,
          b.Foto,
          b.Art,
          b.Form,
          b.Länge || 0,
          b.Fassung,
          b.Farbe,
          b.Inhalt_Material,
          b.Inhalt_Farbe,
          b.Inhalt_Farbakzent,
          b.Inhalt_Zusatzmaterial,
          b.Anhänger_Fassung,
          b.Anhänger_Form,
          b.Anhänger_Farbe,
          b.Anhänger_Grösse || 0,
          b.Anhänger_Inhalt_Material,
          b.Anhänger_Inhalt_Farbe,
          b.Anhänger_Inhalt_Farbakzente,
          b.Anhänger_Inhalt_Zusatzmaterial,
          b.Material,
          b.Grösse || 0,
          b.Anhänger,
          b.Zwischenstück,
          b.Herstellungskosten || 0,
          b.Verkaufspreis || 0,
          b.Online || 0,
          b.Ausgelagert || 0,
          b.Verkauft || 0,
          b.Ausschuss || 0,
        ],
      );
      createdItems.push(rows[0]);
      await client.query(
        `INSERT INTO audit_log (table_name, artikelnummer_id, column_name, old_value, new_value, action_type, changed_by)
           VALUES ('Schmuckstück', $1, 'Erstellung', NULL, $2, 'INSERT', current_user)`,
        [fullArtNr, JSON.stringify(rows[0])],
      );
    }

    await client.query("COMMIT");
    res.status(201).json(quantity === 1 ? createdItems[0] : createdItems);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({
      error: "Fehler beim Erstellen des Schmuckstücks: " + err.message,
    });
  } finally {
    client.release();
  }
});

// PUT update piece
router.put("/:artikelnummer", async (req, res) => {
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
        b.Name,
        b.Foto,
        b.Art,
        b.Form,
        b.Länge,
        b.Fassung,
        b.Farbe,
        b.Inhalt_Material,
        b.Inhalt_Farbe,
        b.Inhalt_Farbakzent,
        b.Inhalt_Zusatzmaterial,
        b.Anhänger_Fassung,
        b.Anhänger_Form,
        b.Anhänger_Farbe,
        b.Anhänger_Grösse,
        b.Anhänger_Inhalt_Material,
        b.Anhänger_Inhalt_Farbe,
        b.Anhänger_Inhalt_Farbakzente,
        b.Anhänger_Inhalt_Zusatzmaterial,
        b.Material,
        b.Grösse,
        b.Anhänger,
        b.Zwischenstück,
        b.Herstellungskosten,
        b.Verkaufspreis,
        b.Online,
        b.Ausgelagert,
        b.Verkauft,
        b.Ausschuss,
        b.Lieferschein_ID,
        b.Rechnung_ID,
        req.params.artikelnummer,
      ],
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Schmuckstück nicht gefunden" });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ error: "Fehler beim Aktualisieren des Schmuckstücks" });
  }
});

// DELETE piece
router.delete("/:artikelnummer", async (req, res) => {
  try {
    const { rowCount } = await db.query(
      'DELETE FROM "Schmuckstück" WHERE "Artikelnummer" = $1',
      [req.params.artikelnummer],
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: "Schmuckstück nicht gefunden" });
    }
    res.json({ message: "Schmuckstück gelöscht" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Fehler beim Löschen des Schmuckstücks" });
  }
});

module.exports = router;
