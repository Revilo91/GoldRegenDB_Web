const express = require("express");
const router = express.Router();
const db = require("../config/db");

// POST /api/sumup/import - Import SumUp Verkaufsbericht
router.post("/import", async (req, res) => {
  try {
    // CSV-Daten aus Body (als String oder Array)
    const csvData = req.body.csvData;

    if (!csvData) {
      return res.status(400).json({ error: "Keine CSV-Daten gefunden" });
    }

    // Parse CSV-Daten
    let rows = [];
    if (typeof csvData === 'string') {
      // CSV-String parsen mit ordnungsgemäßem Parser (behandelt Anführungszeichen und Kommas)
      const lines = parseCSVLines(csvData);
      if (lines.length < 2) {
        return res.status(400).json({ error: "CSV-Datei ist leer oder ungültig" });
      }

      const headers = lines[0];

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i];
        const row = {};
        headers.forEach((header, idx) => {
          row[header] = values[idx] || '';
        });
        rows.push(row);
      }
    } else if (Array.isArray(csvData)) {
      rows = csvData;
    } else {
      return res.status(400).json({ error: "Ungültiges CSV-Format" });
    }

    // Artikelnummern aus verschiedenen Spalten extrahieren
    const artikelnummern = new Set();
    const beschreibungFields = [
      'Beschreibung', 'Description',
      'SKU', 'Barcode',
      'Product ID', 'Produkt-ID', 'Produktnummer',
      'Artikel-Nr', 'Artikelnummer', 'Article Number',
      'Name', 'Produktname', 'Product Name'
    ];

    rows.forEach(row => {
      for (const field of beschreibungFields) {
        const value = row[field];
        if (value) {
          const extracted = extractArtikelnummer(value);
          if (extracted) {
            artikelnummern.add(extracted.toUpperCase());
          }
        }
      }
    });

    if (artikelnummern.size === 0) {
      return res.status(400).json({ error: "Keine gültigen Artikelnummern gefunden" });
    }

    const artikelnummernArray = Array.from(artikelnummern);

    // Prüfe, ob Artikelnummern in DB existieren
    const { rows: existingItems } = await db.query(
      `SELECT "Artikelnummer", "Verkaufspreis"
       FROM "Schmuckstück"
       WHERE "Artikelnummer" = ANY($1)`,
      [artikelnummernArray]
    );

    if (existingItems.length === 0) {
      return res.status(400).json({
        error: "Keine der Artikelnummern wurde in der Datenbank gefunden",
        artikelnummern: artikelnummernArray
      });
    }

    // Trenne Marina (M*) und Saskia (S*) Artikel
    const marinaArtikelnummern = existingItems.filter(i => i.Artikelnummer.startsWith('M'));
    const saskiaArtikelnummern = existingItems.filter(i => i.Artikelnummer.startsWith('S'));

    // Hole Kunde "SumUp" (ID 7 laut Python-Code)
    const { rows: kundenResult } = await db.query(
      `SELECT "ID", "Name" FROM "Kunde" WHERE "Name" ILIKE '%sumup%' OR "ID" = 7 LIMIT 1`
    );

    let sumupKunde;
    if (kundenResult.length === 0) {
      // Erstelle SumUp-Kunde falls nicht vorhanden
      const { rows: newKunde } = await db.query(
        `INSERT INTO "Kunde" ("Name", "Strasse", "Ort", "Aktiv")
         VALUES ('SumUp', '', '', true)
         RETURNING "ID", "Name"`
      );
      sumupKunde = newKunde[0];
    } else {
      sumupKunde = kundenResult[0];
    }

    // Beginne Transaktion
    await db.query('BEGIN');

    try {
      // 1. Erstelle Lieferschein für alle Artikel
      const lieferscheinNummer = `LS-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now().toString().slice(-4)}`;

      const { rows: lieferscheinResult } = await db.query(
        `INSERT INTO "Lieferschein" ("Nummer", "Kundennummer", "Datum")
         VALUES ($1, $2, NOW())
         RETURNING "ID", "Nummer"`,
        [lieferscheinNummer, sumupKunde.ID]
      );

      const lieferschein = lieferscheinResult[0];

      // Setze alle Artikel als ausgelagert und auf Lieferschein
      for (const item of existingItems) {
        await db.query(
          `UPDATE "Schmuckstück"
           SET "Ausgelagert" = $1, "Lieferschein_ID" = $2
           WHERE "Artikelnummer" = $3 AND "Verkauft" = 0 AND "Ausschuss" = 0`,
          [sumupKunde.ID, lieferschein.ID, item.Artikelnummer]
        );
      }

      // 2. Erstelle Rechnung für Marina
      let rechnungMarina = null;
      if (marinaArtikelnummern.length > 0) {
        const rechnungNummerM = `RE-M-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now().toString().slice(-4)}`;

        const { rows: rechnungMResult } = await db.query(
          `INSERT INTO "Rechnung" ("Nummer", "Kundennummer", "Datum")
           VALUES ($1, $2, NOW())
           RETURNING "ID", "Nummer"`,
          [rechnungNummerM, sumupKunde.ID]
        );

        rechnungMarina = rechnungMResult[0];

        // Markiere Marina-Artikel als verkauft und auf Rechnung
        for (const item of marinaArtikelnummern) {
          await db.query(
            `UPDATE "Schmuckstück"
             SET "Verkauft" = 1, "Rechnung_ID" = $1
             WHERE "Artikelnummer" = $2`,
            [rechnungMarina.ID, item.Artikelnummer]
          );
        }
      }

      // 3. Erstelle Rechnung für Saskia
      let rechnungSaskia = null;
      if (saskiaArtikelnummern.length > 0) {
        const rechnungNummerS = `RE-S-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now().toString().slice(-4)}`;

        const { rows: rechnungSResult } = await db.query(
          `INSERT INTO "Rechnung" ("Nummer", "Kundennummer", "Datum")
           VALUES ($1, $2, NOW())
           RETURNING "ID", "Nummer"`,
          [rechnungNummerS, sumupKunde.ID]
        );

        rechnungSaskia = rechnungSResult[0];

        // Markiere Saskia-Artikel als verkauft und auf Rechnung
        for (const item of saskiaArtikelnummern) {
          await db.query(
            `UPDATE "Schmuckstück"
             SET "Verkauft" = 1, "Rechnung_ID" = $1
             WHERE "Artikelnummer" = $2`,
            [rechnungSaskia.ID, item.Artikelnummer]
          );
        }
      }

      await db.query('COMMIT');

      res.json({
        success: true,
        lieferschein: lieferschein,
        rechnungen: {
          marina: rechnungMarina,
          saskia: rechnungSaskia
        },
        artikel: {
          gesamt: existingItems.length,
          marina: marinaArtikelnummern.length,
          saskia: saskiaArtikelnummern.length
        }
      });

    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    }

  } catch (err) {
    console.error('SumUp Import Error:', err);
    res.status(500).json({ error: "Fehler beim Importieren der SumUp-Daten", details: err.message });
  }
});

// CSV-Parser: ordnungsgemäß mit Anführungszeichen und Kommas in Daten
function parseCSVLines(text) {
  const lines = [];
  let currentLine = '';
  let inQuotes = false;

  // Zeilenweise parsen (berücksichtigt Anführungszeichen)
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentLine += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (currentLine.trim()) lines.push(currentLine);
      currentLine = '';
      if (char === '\r' && nextChar === '\n') i++; // \r\n
    } else {
      currentLine += char;
    }
  }
  if (currentLine.trim()) lines.push(currentLine);

  // Jede Zeile in Felder aufteilen
  return lines.map(line => {
    const fields = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        fields.push(field.trim().replace(/^"|"$/g, ''));
        field = '';
      } else {
        field += char;
      }
    }
    fields.push(field.trim().replace(/^"|"$/g, ''));
    return fields;
  });
}

// Hilfsfunktion: Artikelnummer aus Text extrahieren
function extractArtikelnummer(text) {
  if (!text) return null;

  // Suche nach Artikelnummer-Muster: M/S + Buchstabe + Buchstabe + Zahlen + optional _Zahl
  const match = text.match(/([MS][A-Z]{2}\d{3}(?:_\d+)?)/i);

  return match ? match[1] : null;
}

module.exports = router;
