const express = require("express");
const router = express.Router();
const db = require("../config/db");
const logger = require("../utils/logger");
const { where } = require("../utils/whereClauseBuilder");
const { PRODUKTART } = require("../utils/constants");
const { validate } = require("../middleware/validate");
const { sumupImportSchema } = require("../schemas");

// POST /api/sumup/import - Import SumUp Verkaufsbericht
router.post("/import", validate(sumupImportSchema), async (req, res) => {
  try {
    // CSV-Daten aus Body (als String oder Array)
    const csvData = req.body.csvData;

    if (!csvData) {
      return res.status(400).json({ error: "Keine CSV-Daten gefunden" });
    }

    // Parse CSV-Daten
    let rows = [];
    if (typeof csvData === "string") {
      // CSV-String parsen mit ordnungsgemäßem Parser (behandelt Anführungszeichen und Kommas)
      const lines = parseCSVLines(csvData);
      if (lines.length < 2) {
        return res
          .status(400)
          .json({ error: "CSV-Datei ist leer oder ungültig" });
      }

      const headers = lines[0];

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i];
        const row = {};
        headers.forEach((header, idx) => {
          row[header] = values[idx] || "";
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

    // Relevante Spalten für Artikelnummern (explizit definierte Liste)

    logger.info('SUMUP', 'Import: CSV-Zeilen werden verarbeitet', {
      anzahl: rows.length,
      verfuegbareFelder: rows.length > 0 ? Object.keys(rows[0]) : [],
    });
    rows.forEach((row, idx) => {
      // Durchsuche zuerst die explizit definierten Felder
      logger.debug('SUMUP', 'CSV-Zeile', { idx, ...row });

      const value = row["Beschreibung"];
      if (value) {
        const extracted = extractArtikelnummer(value);
        if (extracted) {
          logger.debug('SUMUP', 'Artikelnummer gefunden', { idx, extracted, beschreibung: value });
          artikelnummern.add(extracted.toUpperCase());
        }
      }
    });

    // Falls nichts gefunden wurde, zeige Debug-Info
    if (artikelnummern.size === 0) {
      const availableFields = rows.length > 0 ? Object.keys(rows[0]) : [];
      const firstRowData = rows.length > 0 ? rows[0] : {};
      logger.warn('SUMUP', 'Import: Keine gültigen Artikelnummern gefunden', { verfuegbareSpalten: availableFields });

      return res.status(400).json({
        error: "Keine gültigen Artikelnummern gefunden",
        hinweis:
          "Die CSV-Datei muss eine der folgenden Spalten mit gültigen Artikelnummern enthalten: Beschreibung, SKU, Barcode, Artikelnummer oder Name. Gültige Artikelnummern folgen dem Muster: M/S + 2 Buchstaben + 3 Ziffern (z.B. MBH001 oder MBH001_2)",
        verfuegbareSpalten: availableFields,
        beispieldaten: firstRowData,
      });
    }

    const artikelnummernArray = Array.from(artikelnummern);

    // Prüfe, ob Artikelnummern in DB existieren
    // Nutze LIKE um auch Suffix-Varianten (z.B. SPA425_1, SPA425_2) zu finden
    const likePatterns = artikelnummernArray.map((num) => `${num}%`);
    const builder = where();
    builder.verfuegbar(); // Verfügbar = nicht verkauft, kein Ausschuss, im Lager
    builder.raw('"Artikelnummer" LIKE ANY($' + builder.getNextParamIdx() + '::text[])', likePatterns);

    const { rows: matchingItems } = await db.query(
      `SELECT "Artikelnummer", "Verkaufspreis"
       FROM "Schmuckstück"
       ${builder.build()}
       ORDER BY length("Artikelnummer"), "Artikelnummer"`,
      builder.getParams(),
    );

    // Pro angefragter Artikelnummer nur einen Treffer übernehmen
    // und insgesamt maximal so viele Artikel wie in artikelnummernArray vorhanden sind.
    const usedArtikelnummern = new Set();
    const existingItems = [];

    for (const requestedNum of artikelnummernArray) {
      const normalizedRequested = requestedNum.toUpperCase();
      const match = matchingItems.find(
        (item) =>
          !usedArtikelnummern.has(item.Artikelnummer) &&
          item.Artikelnummer.toUpperCase().startsWith(normalizedRequested),
      );

      if (match) {
        existingItems.push(match);
        usedArtikelnummern.add(match.Artikelnummer);
      }
    }

    logger.info('SUMUP', 'Import: Artikelnummern extrahiert', {
      extrahiert: artikelnummernArray.length,
      gefunden: existingItems.length,
    });

    if (existingItems.length === 0) {
      return res.status(400).json({
        error: "Keine der Artikelnummern wurde in der Datenbank gefunden",
        artikelnummern: artikelnummernArray,
      });
    }

    // Trenne Marina (M*) und Saskia (S*) Artikel
    const marinaArtikelnummern = existingItems.filter((i) =>
      i.Artikelnummer.startsWith("M"),
    );
    const saskiaArtikelnummern = existingItems.filter((i) =>
      i.Artikelnummer.startsWith("S"),
    );

    // Hole Kunde "Messe"
    const { rows: kundenResult } = await db.query(
      `SELECT "ID", "Name" FROM "Kunde" WHERE "Name" ILIKE '%messe%' LIMIT 1`,
    );

    let messeKunde;
    if (kundenResult.length === 0) {
      // Erstelle Messe-Kunde falls nicht vorhanden
      const { rows: newKunde } = await db.query(
        `INSERT INTO "Kunde" ("Name", "Strasse", "Hausnummer", "Ort", "PLZ", "Provision", "Aktiv")
         VALUES ('Messe', '', 0, '', 0, 0, true)
         RETURNING "ID", "Name"`,
      );
      messeKunde = newKunde[0];
    } else {
      messeKunde = kundenResult[0];
    }

    // Beginne Transaktion
    await db.query("BEGIN");

    try {
      // 1. Erstelle Lieferschein für alle Artikel
      const aktuellesJahr = new Date().getFullYear();
      const { rows: lieferscheinnummerResult } = await db.query(
        `SELECT COALESCE(MAX(CAST(SPLIT_PART("Nummer", '-', 2) AS INTEGER)), 0) AS max_num
         FROM "Lieferschein"
         WHERE "Nummer" ~ $1`,
        [`^${aktuellesJahr}-[0-9]+$`],
      );
      const lieferscheinNummer = `${aktuellesJahr}-${String(Number(lieferscheinnummerResult[0].max_num) + 1).padStart(3, "0")}`;

      const { rows: lieferscheinResult } = await db.query(
        `INSERT INTO "Lieferschein" ("Nummer", "Kundennummer", "Datum")
         VALUES ($1, $2, NOW())
         RETURNING "ID", "Nummer"`,
        [lieferscheinNummer, messeKunde.ID],
      );

      const lieferschein = lieferscheinResult[0];

      // Aktualisiere alle Artikel wurden-als ausgelagert und auf Lieferschein
      // Nutze WHERE IN für bessere Performance statt individualer Updates
      const artikelnummernArray = existingItems.map((i) => i.Artikelnummer);
      if (artikelnummernArray.length > 0) {
        const updateBuilder = where();
        updateBuilder.artikelnummerIn(artikelnummernArray);
        updateBuilder.nichtVerkauft();
        updateBuilder.keinAusschuss();

        // SET-Parameter zuerst, dann WHERE-Parameter
        const setParams = [messeKunde.ID, lieferschein.ID];
        const whereParams = updateBuilder.getParams();
        await db.query(
          `UPDATE "Schmuckstück"
           SET "Ausgelagert" = $1, "Lieferschein_ID" = $2
           ${updateBuilder.build().replace(/\$1/g, `$${setParams.length + 1}`)}
          `,
          [...setParams, ...whereParams],
        );
      }

      // Fortlaufende Rechnungsnummern im Format YYYY-XXX
      const { rows: rechnungsnummerResult } = await db.query(
        `SELECT COALESCE(MAX(CAST(SPLIT_PART("Nummer", '-', 2) AS INTEGER)), 0) AS max_num
         FROM "Rechnung"
         WHERE "Nummer" ~ $1`,
        [`^${aktuellesJahr}-[0-9]+$`],
      );
      let naechsteRechnungsnummer = Number(rechnungsnummerResult[0].max_num) + 1;
      const createRechnungsnummer = () =>
        `${aktuellesJahr}-${String(naechsteRechnungsnummer++).padStart(3, "0")}`;

      // 2. Erstelle Rechnung für Marina
      let rechnungMarina = null;
      if (marinaArtikelnummern.length > 0) {
        const rechnungNummerM = createRechnungsnummer();

        const { rows: rechnungMResult } = await db.query(
          `INSERT INTO "Rechnung" ("Nummer", "Kundennummer", "Datum")
           VALUES ($1, $2, NOW())
           RETURNING "ID", "Nummer"`,
          [rechnungNummerM, messeKunde.ID],
        );

        rechnungMarina = rechnungMResult[0];

        // Markiere Marina-Artikel als verkauft und auf Rechnung (Batch-Update)
        const marinaArtikelnummernArray = marinaArtikelnummern.map(
          (i) => i.Artikelnummer,
        );
        if (marinaArtikelnummernArray.length > 0) {
          await db.query(
            `UPDATE "Schmuckstück"
             SET "Verkauft" = 1, "Rechnung_ID" = $1
             WHERE "Artikelnummer" = ANY($2)`,
            [rechnungMarina.ID, marinaArtikelnummernArray],
          );
        }
      }

      // 3. Erstelle Rechnung für Saskia
      let rechnungSaskia = null;
      if (saskiaArtikelnummern.length > 0) {
        const rechnungNummerS = createRechnungsnummer();

        const { rows: rechnungSResult } = await db.query(
          `INSERT INTO "Rechnung" ("Nummer", "Kundennummer", "Datum")
           VALUES ($1, $2, NOW())
           RETURNING "ID", "Nummer"`,
          [rechnungNummerS, messeKunde.ID],
        );

        rechnungSaskia = rechnungSResult[0];

        // Markiere Saskia-Artikel als verkauft und auf Rechnung (Batch-Update)
        const saskiaArtikelnummernArray = saskiaArtikelnummern.map(
          (i) => i.Artikelnummer,
        );
        if (saskiaArtikelnummernArray.length > 0) {
          await db.query(
            `UPDATE "Schmuckstück"
             SET "Verkauft" = 1, "Rechnung_ID" = $1
             WHERE "Artikelnummer" = ANY($2)`,
            [rechnungSaskia.ID, saskiaArtikelnummernArray],
          );
        }
      }

      await db.query("COMMIT");

      res.json({
        success: true,
        lieferschein: lieferschein,
        rechnungen: {
          marina: rechnungMarina,
          saskia: rechnungSaskia,
        },
        artikel: {
          gesamt: existingItems.length,
          marina: marinaArtikelnummern.length,
          saskia: saskiaArtikelnummern.length,
        },
      });
    } catch (err) {
      await db.query("ROLLBACK");
      throw err;
    }
  } catch (err) {
    logger.error('SUMUP', 'Import-Fehler', { message: err.message });
    res.status(500).json({
      error: "Fehler beim Importieren der SumUp-Daten",
      details: err.message,
    });
  }
});

// GET Sumup CSV export (Ausgelagert=0, Ausschuss=0, Verkauft=0)
router.get("/export", async (req, res) => {
  try {
    const builder = where();
    builder.verfuegbar(); // Verfügbar = nicht verkauft, kein Ausschuss, im Lager

    // Alle verfügbaren Artikel laden
    const { rows } = await db.query(
      `SELECT "Artikelnummer", "Name", "Art", "Material", "Farbe", "Form", "Fassung",
              "Verkaufspreis", "Länge",
              "Inhalt_Zusatzmaterial", "Inhalt_Material", "Inhalt_Farbe", "Inhalt_Farbakzent",
              "Anhänger_Fassung", "Anhänger_Form", "Anhänger_Farbe", "Anhänger_Grösse",
              "Anhänger_Inhalt_Material", "Anhänger_Inhalt_Farbe", "Anhänger_Inhalt_Farbakzente",
              "Anhänger_Inhalt_Zusatzmaterial",
              "Anhänger", "Zwischenstück", "Grösse"
       FROM "Schmuckstück"
       ${builder.build()}
       ORDER BY length("Artikelnummer"), "Artikelnummer"`,
      builder.getParams()
    );

    // CSV-Escape-Funktion
    const escape = (val) => {
      if (val === null || val === undefined) return "";
      const str = String(val);
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };

    // Hilfsfunktion für Werte (filtert "0", 0 und leere Strings)
    const getVal = (val) => {
      if (
        val === null ||
        val === undefined ||
        val === "" ||
        val === "0" ||
        val === 0
      ) {
        return "-";
      }
      return val;
    };

    // Beschreibung generieren basierend auf Produktart (analog zur Python-Version)
    const getDescription = (s) => {
      const artCode = (s.Artikelnummer || "")[2];

      if (artCode === "O") {
        // Ohrring
        return `${getVal(s.Art)} ${getVal(s.Form)} ${getVal(s.Fassung)} ${getVal(s.Farbe)}, ${getVal(s.Inhalt_Zusatzmaterial)}`;
      } else if (artCode === "H") {
        // Halskette
        return `Fassung ${getVal(s.Anhänger_Fassung)} ${getVal(s.Anhänger_Form)}, ${getVal(s.Anhänger_Inhalt_Farbe)} ${getVal(s.Anhänger_Inhalt_Zusatzmaterial)}`;
      } else if (artCode === "A") {
        // Armband
        return `${getVal(s.Art)} ${getVal(s.Farbe)}, ${getVal(s.Anhänger)}, ${getVal(s.Zwischenstück)}`;
      } else if (artCode === "S") {
        // Schlüsselanhänger
        return `${getVal(s.Art)} ${getVal(s.Form)}`;
      }

      return `${getVal(s.Art)} ${getVal(s.Material)} ${getVal(s.Farbe)}`;
    };

    // Gruppierung nach Basis-Artikelnummer (ohne Suffix)
    const groupedItems = {};
    rows.forEach((item) => {
      const baseArtikelnummer = item.Artikelnummer.split("_")[0];
      if (!groupedItems[baseArtikelnummer]) {
        groupedItems[baseArtikelnummer] = [];
      }
      groupedItems[baseArtikelnummer].push(item);
    });

    // SumUp CSV-Header (vollständiges Format)
    const headers = [
      "Item name",
      "Variations",
      "Option set 1",
      "Option 1",
      "Option set 2 ",
      "Option 2",
      "Option set 3",
      "Option 3",
      "Option set 4",
      "Option 4",
      "Is variation visible? (Yes/No)",
      "Price",
      "On sale in Online Store?",
      "Regular price (before sale)",
      "Tax rate (%)",
      "Track inventory? (Yes/No)",
      "Quantity",
      "Low stock threshold",
      "SKU",
      "Barcode",
      "Description (Online Store and Invoices only)",
      "Category",
      "Display colour in POS checkout ",
      "Image 1",
      "Image 2",
      "Image 3",
      "Image 4",
      "Image 5",
      "Image 6",
      "Image 7",
      "Display item in Online Store? (Yes/No)",
      "SEO title (Online Store only)",
      "SEO description (Online Store only)",
      "Shipping weight [kg] (Online Store only)",
      "Item id (Do not change)",
      "Variant id (Do not change)",
    ];

    const lines = [headers.join(",")];

    // Sortierte Basis-Artikelnummern
    const sortedBaseIds = Object.keys(groupedItems).sort();

    sortedBaseIds.forEach((baseId) => {
      const items = groupedItems[baseId];
      const category = PRODUKTART[baseId[2]] || "";

      // Hauptzeile für die Gruppe (wenn mehrere Varianten)
      if (items.length > 1) {
        const groupRow = [
          escape(baseId), // Item name
          "", // Variations
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "", // Option sets
          "", // Is variation visible
          "", // Price (leer für Gruppe)
          "No", // On sale
          "", // Regular price
          "", // Tax rate
          "Yes", // Track inventory
          escape(items.length), // Quantity = Anzahl Varianten
          "1", // Low stock threshold
          "", // SKU (leer für Gruppe)
          "", // Barcode
          "", // Description
          escape(category), // Category
          ...Array(8).fill(""), // Display colour + Images
          "Yes", // Display in Online Store
          "",
          "",
          "", // SEO
          "",
          "", // Item/Variant ID
        ];
        lines.push(groupRow.join(","));
      }

      // Zeilen für jede Variante
      items.forEach((item) => {
        const price = Number(item.Verkaufspreis) || 0;
        const description = getDescription(item);

        const row = [
          escape(items.length > 1 ? item.Artikelnummer : baseId), // Item name
          "", // Variations
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "", // Option sets
          "Yes", // Is variation visible
          escape(price.toFixed(2)), // Price
          "No", // On sale
          escape(price.toFixed(2)), // Regular price
          "", // Tax rate
          "Yes", // Track inventory
          "1", // Quantity
          "1", // Low stock threshold
          escape(item.Artikelnummer), // SKU
          escape(item.Artikelnummer), // Barcode
          escape(description), // Description
          escape(category), // Category
          ...Array(8).fill(""), // Display colour + Images
          "Yes", // Display in Online Store
          "",
          "",
          "", // SEO
          "",
          "", // Item/Variant ID
        ];
        lines.push(row.join(","));
      });
    });

    const csv = lines.join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=Sumup_Export_${new Date().toISOString().slice(0, 10)}.csv`,
    );
    res.send("\uFEFF" + csv); // BOM for Excel compatibility
  } catch (err) {
    logger.error('SUMUP', 'Fehler beim Erstellen des Exports', { message: err.message });
    res.status(500).json({ error: "Fehler beim Erstellen des Sumup-Exports" });
  }
});

// CSV-Parser: RFC 4180-konform, hanhabt Anführungszeichen und Kommas in Daten
function parseCSVLines(csvText) {
  const records = [];
  let currentRecord = [];
  let currentField = "";
  let insideQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        // Escaped quote: "" wird zu "
        currentField += '"';
        i++;
      } else {
        // Quote toggle
        insideQuotes = !insideQuotes;
      }
    } else if (char === "," && !insideQuotes) {
      // Komma außerhalb von Anführungszeichen = Feldtrenner
      currentRecord.push(currentField.trim());
      currentField = "";
    } else if ((char === "\n" || char === "\r") && !insideQuotes) {
      // Newline außerhalb von Anführungszeichen = Zeilentrenner
      if (currentField || currentRecord.length > 0) {
        currentRecord.push(currentField.trim());
      }
      if (currentRecord.length > 0 && currentRecord.some((f) => f !== "")) {
        records.push(currentRecord);
      }
      currentRecord = [];
      currentField = "";
      // Skip \r\n combination
      if (char === "\r" && nextChar === "\n") {
        i++;
      }
    } else {
      currentField += char;
    }
  }

  // Letzte Zeile hinzufügen
  if (currentField || currentRecord.length > 0) {
    currentRecord.push(currentField.trim());
  }
  if (currentRecord.length > 0 && currentRecord.some((f) => f !== "")) {
    records.push(currentRecord);
  }

  return records;
}

// Hilfsfunktion: Artikelnummer aus Text extrahieren
function extractArtikelnummer(text) {
  if (!text) return null;

  // Suche nach Artikelnummer-Muster: M/S + Buchstabe + Buchstabe + Zahlen + optional _Zahl
  const match = text.match(/([MS][A-Z]{2}\d{3}(?:_\d+)?)/i);
  logger.debug('SUMUP', 'Artikelnummer-Extraktion', { text, treffer: match ? match[1] : null });
  return match ? match[1] : null;
}

module.exports = router;
module.exports.parseCSVLines = parseCSVLines;
module.exports.extractArtikelnummer = extractArtikelnummer;
