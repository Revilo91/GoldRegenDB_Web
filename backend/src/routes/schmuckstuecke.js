const express = require("express");
const router = express.Router();
const db = require("../config/db");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const logger = require("../utils/logger");
const { validate } = require("../middleware/validate");
const {
  schmuckstueckCreateSchema,
  schmuckstueckUpdateSchema,
  schmuckstueckBulkSchema,
} = require("../schemas");
const { requireBearbeiter } = require("../middleware/auth");
const { where } = require("../utils/whereClauseBuilder");
const { GRUNDMATERIAL } = require("../utils/constants");
const {
  uploadsDir,
  resolvePhotoFile,
  invalidate: invalidatePhotoIndex,
} = require("../utils/photoIndex");

// Multer-Konfiguration für Foto-Upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    // Extract base article number (without suffix like _1, _2)
    let artikelnummer = req.query.artikelnummer || "unknown";
    const baseArtikelnummer = artikelnummer.split("_")[0];
    cb(null, `${baseArtikelnummer}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ["image/jpeg", "image/png", "image/gif"];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Nur JPG, PNG und GIF Dateien sind erlaubt"));
    }
  },
});


const SEARCHABLE_FIELDS = [
  "Artikelnummer",
  "Name",
  "Foto",
  "Art",
  "Form",
  "Länge",
  "Fassung",
  "Farbe",
  "Inhalt_Material",
  "Inhalt_Farbe",
  "Inhalt_Farbakzent",
  "Inhalt_Zusatzmaterial",
  "Anhänger_Fassung",
  "Anhänger_Form",
  "Anhänger_Farbe",
  "Anhänger_Grösse",
  "Anhänger_Inhalt_Material",
  "Anhänger_Inhalt_Farbe",
  "Anhänger_Inhalt_Farbakzente",
  "Anhänger_Inhalt_Zusatzmaterial",
  "Material",
  "Grösse",
  "Anhänger",
  "Zwischenstück",
  "Herstellungskosten",
  "Verkaufspreis",
  "Ausgelagert",
  "Verkauft",
  "Ausschuss",
  "Ausschuss_Grund",
  "Lieferschein_ID",
  "Rechnung_ID",
  "Erstelldatum",
  "Letzte_Änderung",
];

const PRODUKTART = {
  A: "Armband",
  H: "Halskette",
  O: "Ohrring",
  S: "Schlüsselanhänger",
};

const AUSSCHUSS_GRUND_CONSTRAINT = "schmuckstueck_ausschuss_grund_required_chk";

function resolveAusschussGrund(ausschuss, ausschussGrund) {
  const ausschussValue = Number(ausschuss) === 1 ? 1 : 0;
  const normalizedGrund =
    typeof ausschussGrund === "string" ? ausschussGrund.trim() : "";

  if (ausschussValue === 1) {
    return normalizedGrund || "Defekt";
  }
  return normalizedGrund || null;
}

function normalizeBulkArtikelnummern(input) {
  if (Array.isArray(input)) {
    return input.map((value) => String(value || "").trim().toUpperCase());
  }

  if (typeof input === "string") {
    return input
      .split(/[\n,;]+/)
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean);
  }

  return [];
}

function parseBulkItemsFromPayload(payload) {
  if (Array.isArray(payload?.items)) {
    return payload.items
      .map((item) => ({ ...(item || {}) }))
      .filter((item) => Object.keys(item).length > 0)
      .map((item) => ({
        ...item,
        Artikelnummer: String(item.Artikelnummer || "")
          .trim()
          .toUpperCase(),
      }));
  }

  const template = payload?.template || {};
  const artikelnummern = normalizeBulkArtikelnummern(payload?.artikelnummern);
  return artikelnummern.map((artikelnummer) => ({
    ...template,
    Artikelnummer: artikelnummer,
  }));
}

// ========== SPECIAL ROUTES (MUST BE BEFORE /:artikelnummer) ==========

// POST upload photo
router.post("/upload", upload.single("foto"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Keine Datei hochgeladen" });
    }

    const fileName = req.file.filename;
    invalidatePhotoIndex();

    res.json({
      success: true,
      fileName: fileName,
      path: fileName,
      originalName: req.file.originalname,
    });
  } catch (err) {
    logger.error("SCHMUCK", "Fehler beim Upload des Fotos", {
      message: err.message,
    });
    if (err.message.includes("Nur") || err.message.includes("erlaubt")) {
      res.status(400).json({ error: err.message });
    } else {
      res.status(500).json({ error: "Fehler beim Upload des Fotos" });
    }
  }
});

// GET photo by filename
router.get("/foto/:fileName", (req, res) => {
  try {
    const lookup = resolvePhotoFile(req.params.fileName);

    if (lookup.error) {
      return res.status(lookup.error === "Ungültiger Dateiname" ? 400 : 404).json({
        error: lookup.error,
        requestedFileName: lookup.requestedFileName,
        baseName: lookup.baseName,
        matchingFiles: lookup.matchingFiles,
      });
    }

    // Ohne Cache-Header lädt jede Tabellenseite dieselben Fotos erneut.
    // max-age=60 hält die Anzeige nach einem Neu-Upload trotzdem aktuell,
    // danach beantwortet der ETag-Abgleich die meisten Anfragen mit 304.
    res.set("Cache-Control", "private, max-age=60");

    res.sendFile(lookup.filePath, { lastModified: true }, (err) => {
      if (!err) return;

      logger.error("SCHMUCK", `Fehler beim Abrufen des Fotos: ${req.params.fileName}`, {
        message: err.message,
        code: err.code,
        resolvedFileName: lookup.resolvedFileName,
        resolvedBy: lookup.resolvedBy,
      });

      if (!res.headersSent) {
        res.status(err.code === "ENOENT" ? 404 : 500).json({
          error: err.code === "ENOENT" ? "Foto nicht gefunden" : "Fehler beim Abrufen des Fotos",
          requestedFileName: path.basename(String(req.params.fileName || "").trim()),
          resolvedFileName: lookup.resolvedFileName,
          resolvedBy: lookup.resolvedBy,
          details: err.message,
        });
      }
    });
  } catch (err) {
    logger.error(
      "SCHMUCK",
      `Fehler beim Abrufen des Fotos: ${req.params.fileName}`,
      { message: err.message, stack: err.stack },
    );
    res.status(500).json({
      error: "Fehler beim Abrufen des Fotos",
      details: err.message,
    });
  }
});

// DELETE photo endpoint
router.delete("/foto/:fileName", requireBearbeiter, async (req, res) => {
  try {
    const fileName = req.params.fileName;
    const filePath = path.join(uploadsDir, fileName);

    // Sicherheitsprüfung
    if (!filePath.startsWith(uploadsDir)) {
      return res.status(403).json({ error: "Zugriff verweigert" });
    }

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      invalidatePhotoIndex();
      res.json({ message: "Foto gelöscht" });
    } else {
      res.status(404).json({ error: "Foto nicht gefunden" });
    }
  } catch (err) {
    logger.error(
      "SCHMUCK",
      `Fehler beim Löschen des Fotos: ${req.params.fileName}`,
      { message: err.message },
    );
    res.status(500).json({ error: "Fehler beim Löschen des Fotos" });
  }
});

// ========== FILTER-OPTIONS ROUTES ==========

// GET next artikelnummer preview by prefix (e.g. MBO -> MBO127)
router.get("/next-artikelnummer", async (req, res) => {
  try {
    const rawPrefix = String(req.query.prefix || "").toUpperCase().trim();

    if (!/^[A-Z]{3}$/.test(rawPrefix)) {
      return res.status(400).json({
        error: "Ungültiger Präfix. Erwartet werden genau 3 Buchstaben.",
      });
    }

    const [herstellerCode, grundmaterialCode, produktartCode] = rawPrefix;
    if (
      !["M", "S"].includes(herstellerCode) ||
      !GRUNDMATERIAL[grundmaterialCode] ||
      !PRODUKTART[produktartCode]
    ) {
      return res.status(400).json({
        error: "Ungültige Präfix-Kombination für Hersteller, Material oder Produktart.",
      });
    }

    const { rows } = await db.query(
      `SELECT MAX(CAST(SUBSTRING("Artikelnummer", 4, 3) AS INTEGER)) as max_num
       FROM "Schmuckstück"
       WHERE "Artikelnummer" LIKE $1`,
      [`${rawPrefix}%`],
    );

    const nextNum = (rows[0]?.max_num || 0) + 1;
    const artikelnummer = `${rawPrefix}${nextNum.toString().padStart(3, "0")}`;

    res.json({
      prefix: rawPrefix,
      nextNum,
      artikelnummer,
    });
  } catch (err) {
    logger.error("SCHMUCK", "Fehler beim Ermitteln der nächsten Artikelnummer", {
      message: err.message,
    });
    res.status(500).json({
      error: "Fehler beim Ermitteln der nächsten Artikelnummer",
    });
  }
});

// POST bulk-create missing pieces by explicit article numbers
router.post("/bulk", requireBearbeiter, validate(schmuckstueckBulkSchema), async (req, res) => {
  let client;
  try {
    client = await db.connect();
  } catch (err) {
    logger.error("SCHMUCK", "Fehler beim Herstellen der DB-Verbindung", {
      message: err.message,
    });
    return res
      .status(500)
      .json({ error: "Fehler beim Herstellen der Datenbankverbindung" });
  }

  try {
    const payload = req.body || {};
    const items = parseBulkItemsFromPayload(payload);

    if (items.length === 0) {
      return res.status(400).json({
        error: "Bitte mindestens einen Tabellen-Eintrag angeben.",
      });
    }

    if (items.length > 200) {
      return res.status(400).json({
        error: "Es koennen maximal 200 Artikelnummern pro Mehrfach-Erfassung verarbeitet werden.",
      });
    }

    const artikelnummern = items.map((item) => item.Artikelnummer);

    if (artikelnummern.some((value) => !value)) {
      return res.status(400).json({
        error: "Jede Tabellen-Zeile muss eine Artikelnummer enthalten.",
      });
    }

    const invalidArtikelnummern = artikelnummern.filter(
      (value) => !/^[A-Z]{3}\d{3}_\d+$/.test(value),
    );
    if (invalidArtikelnummern.length > 0) {
      return res.status(400).json({
        error:
          "Ungueltige Artikelnummern gefunden. Erlaubtes Format: ABC123_1 (Praefix + 3 Ziffern + Suffix).",
        invalidArtikelnummern,
      });
    }

    const seen = new Set();
    const duplicateInRequest = [];
    for (const artikelnummer of artikelnummern) {
      if (seen.has(artikelnummer)) {
        duplicateInRequest.push(artikelnummer);
      }
      seen.add(artikelnummer);
    }
    if (duplicateInRequest.length > 0) {
      return res.status(400).json({
        error: "Mindestens eine Artikelnummer ist in der Tabelle doppelt enthalten.",
        duplicateArtikelnummern: [...new Set(duplicateInRequest)],
      });
    }

    await client.query("BEGIN");

    const { rows: existingRows } = await client.query(
      'SELECT "Artikelnummer" FROM "Schmuckstück" WHERE "Artikelnummer" = ANY($1::text[])',
      [artikelnummern],
    );
    const existingArtikelnummern = existingRows.map((row) => row.Artikelnummer);

    if (existingArtikelnummern.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error:
          "Mindestens eine Artikelnummer existiert bereits. Es wurden keine Daten gespeichert.",
        existingArtikelnummern,
      });
    }

    const createdItems = [];
    for (const item of items) {
      const ausschussGrundValue = resolveAusschussGrund(
        item.Ausschuss,
        item.Ausschuss_Grund,
      );
      const { rows } = await client.query(
        `INSERT INTO "Schmuckstück" (
            "Artikelnummer", "Name", "Foto", "Art", "Form", "Länge", "Fassung", "Farbe",
            "Inhalt_Material", "Inhalt_Farbe", "Inhalt_Farbakzent", "Inhalt_Zusatzmaterial",
            "Anhänger_Fassung", "Anhänger_Form", "Anhänger_Farbe", "Anhänger_Grösse",
            "Anhänger_Inhalt_Material", "Anhänger_Inhalt_Farbe", "Anhänger_Inhalt_Farbakzente",
            "Anhänger_Inhalt_Zusatzmaterial", "Material", "Grösse", "Anhänger", "Zwischenstück",
            "Herstellungskosten", "Verkaufspreis", "Ausgelagert", "Verkauft", "Ausschuss", "Ausschuss_Grund"
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30
          ) RETURNING *`,
        [
          item.Artikelnummer,
          item.Name || "",
          item.Foto || "",
          item.Art || "",
          item.Form || "",
          item.Länge || 0,
          item.Fassung || "",
          item.Farbe || "",
          item.Inhalt_Material || "",
          item.Inhalt_Farbe || "",
          item.Inhalt_Farbakzent || "",
          item.Inhalt_Zusatzmaterial || "",
          item.Anhänger_Fassung || "",
          item.Anhänger_Form || "",
          item.Anhänger_Farbe || "",
          item.Anhänger_Grösse || 0,
          item.Anhänger_Inhalt_Material || "",
          item.Anhänger_Inhalt_Farbe || "",
          item.Anhänger_Inhalt_Farbakzente || "",
          item.Anhänger_Inhalt_Zusatzmaterial || "",
          item.Material || "",
          item.Grösse || 0,
          item.Anhänger || "",
          item.Zwischenstück || "",
          item.Herstellungskosten || 0,
          item.Verkaufspreis || 0,
          0,
          0,
          0,
          ausschussGrundValue,
        ],
      );

      createdItems.push(rows[0]);
      await client.query(
        `INSERT INTO audit_log (table_name, artikelnummer_id, column_name, old_value, new_value, action_type, changed_by)
           VALUES ('Schmuckstück', $1, 'Erstellung Mehrfach', NULL, $2, 'INSERT', COALESCE(current_setting('app.current_user', true), current_user))`,
        [item.Artikelnummer, JSON.stringify(rows[0])],
      );
    }

    await client.query("COMMIT");
    res.status(201).json({
      createdCount: createdItems.length,
      createdArtikelnummern: createdItems.map((item) => item.Artikelnummer),
      items: createdItems,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23514" && err.constraint === AUSSCHUSS_GRUND_CONSTRAINT) {
      return res.status(400).json({
        error:
          "Wenn ein Schmuckstueck als Ausschuss markiert ist, muss ein Ausschuss Grund angegeben werden.",
      });
    }

    logger.error("SCHMUCK", "Fehler bei der Mehrfach-Erfassung von Schmuckstücken", {
      message: err.message,
    });
    res.status(500).json({
      error: "Fehler bei der Mehrfach-Erfassung von Schmuckstuecken: " + err.message,
    });
  } finally {
    client.release();
  }
});

// GET with pagination, search and filters
router.get("/", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit);
    if (isNaN(limit)) limit = 50;
    const offset = (page - 1) * limit;
    const search = req.query.search || "";
    const verkauft = req.query.verkauft;
    const ausgelagert = req.query.ausgelagert;
    const ausschuss = req.query.ausschuss;
    const artikelnummer_art = req.query.artikelnummer_art;

    // Initialisiere WHERE-Builder
    const builder = where();

    if (search) {
      // Überprüfe ob das Suchfeld ein Material-NAME ist (z.B. "Perle") oder ein Code (z.B. "P")
      const searchUpper = search.toUpperCase();
      let materialCode = null;

      // Versuch 1: Direct lookup (z.B. "P" -> Perle)
      if (GRUNDMATERIAL[searchUpper]) {
        materialCode = searchUpper;
      } else {
        // Versuch 2: Nach Material-Name suchen (z.B. "Perle" -> P)
        for (const [code, name] of Object.entries(GRUNDMATERIAL)) {
          if (name.toUpperCase() === searchUpper) {
            materialCode = code;
            break;
          }
        }
      }

      if (materialCode) {
        // Wenn das Suchfeld einem Material entspricht, suche nach dem Code
        builder.grundmaterial(materialCode);
      } else {
        // Textsuche über alle Schmuckstück-Felder
        const paramIdx = builder.getNextParamIdx();
        const searchClause = SEARCHABLE_FIELDS.map(
          (field) => `COALESCE("${field}"::text, '') ILIKE $${paramIdx}`,
        ).join(" OR ");
        builder.raw(
          `(${searchClause})`,
          `%${search}%`,
        );
      }
    }

    if (req.query.grundmaterial) {
      builder.grundmaterial(req.query.grundmaterial);
    }

    if (artikelnummer_art) {
      builder.produktart(artikelnummer_art);
    }

    if (verkauft !== undefined) {
      builder.equals("Verkauft", parseInt(verkauft));
    }

    if (ausgelagert !== undefined) {
      builder.equals("Ausgelagert", parseInt(ausgelagert));
    }

    if (ausschuss !== undefined) {
      builder.equals("Ausschuss", parseInt(ausschuss));
    }

    const whereClause = builder.build();
    const params = builder.getParams();
    const nextParamIdx = builder.getNextParamIdx();

    // Gesamtzahl per Fensterfunktion statt separater COUNT-Abfrage: ein
    // Tabellendurchlauf weniger pro Seitenaufruf. Alle Requests teilen sich
    // denselben request-gebundenen DB-Client, laufen also ohnehin nacheinander.
    const ORDER_BY = 'ORDER BY length("Artikelnummer"), "Artikelnummer"';
    const sql =
      limit === -1
        ? `SELECT *, COUNT(*) OVER() AS "__total" FROM "Schmuckstück" ${whereClause} ${ORDER_BY}`
        : `SELECT *, COUNT(*) OVER() AS "__total" FROM "Schmuckstück" ${whereClause} ${ORDER_BY} LIMIT $${nextParamIdx} OFFSET $${nextParamIdx + 1}`;
    const sqlParams = limit === -1 ? params : [...params, limit, offset];

    const { rows } = await db.query(sql, sqlParams);

    let total = rows.length > 0 ? parseInt(rows[0].__total) : 0;
    if (rows.length === 0 && offset > 0) {
      // Leere Seite hinter dem Ende: Gesamtzahl separat ermitteln, damit die
      // Blätter-Navigation im Frontend korrekt bleibt.
      const countResult = await db.query(
        `SELECT COUNT(*) FROM "Schmuckstück" ${whereClause}`,
        params,
      );
      total = parseInt(countResult.rows[0].count);
    }

    const processedRows = rows.map(({ __total, ...row }) => {
      // Wenn kein Foto in der DB gespeichert ist, prüfe ob eine Datei existiert
      if (!row.Foto || row.Foto.trim() === "") {
        const photoResult = resolvePhotoFile(row.Artikelnummer);
        if (photoResult && !photoResult.error) {
          row.Foto = photoResult.resolvedFileName;
        }
      }
      return {
        ...row,
        Grundmaterial: row.Artikelnummer
          ? GRUNDMATERIAL[row.Artikelnummer[1]?.toUpperCase()] || "Unbekannt"
          : "Keine Nummer",
      };
    });

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
    logger.error("SCHMUCK", "Fehler beim Laden der Schmuckstücke", {
      message: err.message,
    });
    res.status(500).json({ error: "Fehler beim Laden der Schmuckstücke" });
  }
});

// Sortierung wie zuvor die 27 ORDER-BY-Klauseln: Zahlen numerisch,
// Text nach deutscher Kollation.
function vergleicheFilterwerte(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "de");
}

// GET filter-options (must come before /:artikelnummer!)
// Früher: 27 einzelne SELECT DISTINCT – also 27 Full-Table-Scans pro Aufruf.
// Jetzt ein einziger Scan, der alle Spalten gleichzeitig aggregiert.
const FILTER_OPTION_FIELDS = [
  "arten",
  "farben",
  "materialien",
  "formen",
  "anhaenger_fassungen",
  "anhaenger_formen",
  "anhaenger_farben",
  "anhaenger_groessen",
  "anhaenger_inhalt_materialien",
  "anhaenger_inhalt_farben",
  "anhaenger_inhalt_farbakzente",
  "anhaenger_inhalt_zusatzmaterialien",
  "inhalt_materialien",
  "inhalt_farben",
  "inhalt_farbakzente",
  "inhalt_zusatzmaterialien",
  "zwischenstuecke",
  "fassungen",
  "laengen",
  "groessen",
  "fotos",
  "namen",
  "verkaufspreise",
  "herstellungskosten",
  "ausschuesse",
  "anhaenger",
  "ausschussgruende",
];

router.get("/filter-options", async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT
         array_agg(DISTINCT "Art") FILTER (WHERE "Art" IS NOT NULL AND "Art" <> '') AS arten,
         array_agg(DISTINCT "Farbe") FILTER (WHERE "Farbe" IS NOT NULL AND "Farbe" <> '') AS farben,
         array_agg(DISTINCT "Material") FILTER (WHERE "Material" IS NOT NULL AND "Material" <> '') AS materialien,
         array_agg(DISTINCT "Form") FILTER (WHERE "Form" IS NOT NULL AND "Form" <> '') AS formen,
         array_agg(DISTINCT "Anhänger_Fassung") FILTER (WHERE "Anhänger_Fassung" IS NOT NULL AND "Anhänger_Fassung" <> '') AS anhaenger_fassungen,
         array_agg(DISTINCT "Anhänger_Form") FILTER (WHERE "Anhänger_Form" IS NOT NULL AND "Anhänger_Form" <> '') AS anhaenger_formen,
         array_agg(DISTINCT "Anhänger_Farbe") FILTER (WHERE "Anhänger_Farbe" IS NOT NULL AND "Anhänger_Farbe" <> '') AS anhaenger_farben,
         array_agg(DISTINCT "Anhänger_Grösse") FILTER (WHERE "Anhänger_Grösse" IS NOT NULL) AS anhaenger_groessen,
         array_agg(DISTINCT "Anhänger_Inhalt_Material") FILTER (WHERE "Anhänger_Inhalt_Material" IS NOT NULL AND "Anhänger_Inhalt_Material" <> '') AS anhaenger_inhalt_materialien,
         array_agg(DISTINCT "Anhänger_Inhalt_Farbe") FILTER (WHERE "Anhänger_Inhalt_Farbe" IS NOT NULL AND "Anhänger_Inhalt_Farbe" <> '') AS anhaenger_inhalt_farben,
         array_agg(DISTINCT "Anhänger_Inhalt_Farbakzente") FILTER (WHERE "Anhänger_Inhalt_Farbakzente" IS NOT NULL AND "Anhänger_Inhalt_Farbakzente" <> '') AS anhaenger_inhalt_farbakzente,
         array_agg(DISTINCT "Anhänger_Inhalt_Zusatzmaterial") FILTER (WHERE "Anhänger_Inhalt_Zusatzmaterial" IS NOT NULL AND "Anhänger_Inhalt_Zusatzmaterial" <> '') AS anhaenger_inhalt_zusatzmaterialien,
         array_agg(DISTINCT "Inhalt_Material") FILTER (WHERE "Inhalt_Material" IS NOT NULL AND "Inhalt_Material" <> '') AS inhalt_materialien,
         array_agg(DISTINCT "Inhalt_Farbe") FILTER (WHERE "Inhalt_Farbe" IS NOT NULL AND "Inhalt_Farbe" <> '') AS inhalt_farben,
         array_agg(DISTINCT "Inhalt_Farbakzent") FILTER (WHERE "Inhalt_Farbakzent" IS NOT NULL AND "Inhalt_Farbakzent" <> '') AS inhalt_farbakzente,
         array_agg(DISTINCT "Inhalt_Zusatzmaterial") FILTER (WHERE "Inhalt_Zusatzmaterial" IS NOT NULL AND "Inhalt_Zusatzmaterial" <> '') AS inhalt_zusatzmaterialien,
         array_agg(DISTINCT "Zwischenstück") FILTER (WHERE "Zwischenstück" IS NOT NULL AND "Zwischenstück" <> '') AS zwischenstuecke,
         array_agg(DISTINCT "Fassung") FILTER (WHERE "Fassung" IS NOT NULL AND "Fassung" <> '') AS fassungen,
         array_agg(DISTINCT "Länge") FILTER (WHERE "Länge" IS NOT NULL) AS laengen,
         array_agg(DISTINCT "Grösse") FILTER (WHERE "Grösse" IS NOT NULL) AS groessen,
         array_agg(DISTINCT "Foto") FILTER (WHERE "Foto" IS NOT NULL AND "Foto" <> '') AS fotos,
         array_agg(DISTINCT "Name") FILTER (WHERE "Name" IS NOT NULL AND "Name" <> '') AS namen,
         array_agg(DISTINCT "Verkaufspreis") FILTER (WHERE "Verkaufspreis" IS NOT NULL) AS verkaufspreise,
         array_agg(DISTINCT "Herstellungskosten") FILTER (WHERE "Herstellungskosten" IS NOT NULL) AS herstellungskosten,
         array_agg(DISTINCT "Ausschuss") FILTER (WHERE "Ausschuss" IS NOT NULL) AS ausschuesse,
         array_agg(DISTINCT "Anhänger") FILTER (WHERE "Anhänger" IS NOT NULL AND "Anhänger" <> '') AS anhaenger,
         array_agg(DISTINCT "Ausschuss_Grund") FILTER (WHERE "Ausschuss_Grund" IS NOT NULL AND "Ausschuss_Grund" <> '') AS ausschussgruende
       FROM "Schmuckstück"`,
    );

    const row = rows[0] || {};
    const options = {};
    for (const key of FILTER_OPTION_FIELDS) {
      // array_agg liefert NULL, wenn die Tabelle leer ist
      options[key] = (row[key] || []).sort(vergleicheFilterwerte);
    }

    res.json(options);
  } catch (err) {
    logger.error("SCHMUCK", "Fehler beim Laden der Filter-Optionen", {
      message: err.message,
    });
    res.status(500).json({ error: "Fehler beim Laden der Filter-Optionen" });
  }
});

// GET unique base artikelnummern (without _suffix)
router.get("/unique-artikelnummern", async (req, res) => {
  try {
    const verkauft = req.query.verkauft;
    const ausgelagert = req.query.ausgelagert;
    const ausschuss = req.query.ausschuss;
    const artikelnummer_art = req.query.artikelnummer_art;
    console.log(req.query);
    // Initialisiere WHERE-Builder
    const builder = where();

    if (verkauft !== undefined) {
      builder.equals("Verkauft", parseInt(verkauft));
    }
    if (ausgelagert !== undefined) {
      builder.equals("Ausgelagert", parseInt(ausgelagert));
    }
    if (ausschuss !== undefined) {
      builder.equals("Ausschuss", parseInt(ausschuss));
    }
    if (artikelnummer_art) {
      builder.produktart(artikelnummer_art);
    }
    if (req.query.grundmaterial) {
      builder.grundmaterial(req.query.grundmaterial);
    }

    const whereClauseBuilderResult = builder.build();
    let whereClause = whereClauseBuilderResult;

    const params = builder.getParams();
    console.log(whereClause);
    console.log(params);
    const { rows } = await db.query(
      `SELECT base_nr FROM (
         SELECT DISTINCT split_part("Artikelnummer", '_', 1) as "base_nr"
         FROM "Schmuckstück"
         ${whereClause}
       ) ORDER BY length("base_nr"), "base_nr"`,
      params,
    );
    res.json(rows.map((r) => r.base_nr));
  } catch (err) {
    logger.error(
      "SCHMUCK",
      "Fehler beim Laden der einzigartigen Artikelnummern",
      { message: err.message },
    );
    res.status(500).json({
      // error: "Fehler beim Laden der einzigartigen Artikelnummern",
      error: String(err),
    });
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
    const result = rows[0];

    // Wenn kein Foto in der DB gespeichert ist, prüfe ob eine Datei existiert
    if (!result.Foto || result.Foto.trim() === "") {
      const photoResult = resolvePhotoFile(req.params.artikelnummer);
      if (photoResult && !photoResult.error) {
        result.Foto = photoResult.resolvedFileName;
      }
    }

    res.json(result);
  } catch (err) {
    logger.error(
      "SCHMUCK",
      `Fehler beim Laden des Schmuckstücks: ${req.params.artikelnummer}`,
      { message: err.message },
    );
    res.status(500).json({ error: "Fehler beim Laden des Schmuckstücks" });
  }
});

// POST create piece
router.post("/", validate(schmuckstueckCreateSchema), async (req, res) => {
  let client;
  try {
    client = await db.connect();
  } catch (err) {
    logger.error("SCHMUCK", "Fehler beim Herstellen der DB-Verbindung", {
      message: err.message,
    });
    return res
      .status(500)
      .json({ error: "Fehler beim Herstellen der Datenbankverbindung" });
  }
  try {
    const b = req.body;
    const ausschussGrundValue = resolveAusschussGrund(
      b.Ausschuss,
      b.Ausschuss_Grund,
    );
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
        b.Ausschuss = 0;
        b.Ausschuss_Grund = rows[0].Ausschuss_Grund;
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
            "Herstellungskosten", "Verkaufspreis", "Ausgelagert", "Verkauft", "Ausschuss", "Ausschuss_Grund"
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
          b.Ausgelagert || 0,
          b.Verkauft || 0,
          b.Ausschuss || 0,
          ausschussGrundValue,
        ],
      );
      createdItems.push(rows[0]);
      await client.query(
        `INSERT INTO audit_log (table_name, artikelnummer_id, column_name, old_value, new_value, action_type, changed_by)
           VALUES ('Schmuckstück', $1, 'Erstellung', NULL, $2, 'INSERT', COALESCE(current_setting('app.current_user', true), current_user))`,
        [fullArtNr, JSON.stringify(rows[0])],
      );
    }

    await client.query("COMMIT");
    res.status(201).json(quantity === 1 ? createdItems[0] : createdItems);
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23514" && err.constraint === AUSSCHUSS_GRUND_CONSTRAINT) {
      return res.status(400).json({
        error:
          "Wenn ein Schmuckstueck als Ausschuss markiert ist, muss ein Ausschuss Grund angegeben werden.",
      });
    }
    logger.error("SCHMUCK", "Fehler beim Erstellen des Schmuckstücks", {
      message: err.message,
    });
    res.status(500).json({
      error: "Fehler beim Erstellen des Schmuckstücks: " + err.message,
    });
  } finally {
    client.release();
  }
});

// PUT update piece
router.put("/:artikelnummer", requireBearbeiter, validate(schmuckstueckUpdateSchema), async (req, res) => {
  try {
    const b = req.body;
    const ausschussGrundValue = resolveAusschussGrund(
      b.Ausschuss,
      b.Ausschuss_Grund,
    );

    // Foto-Handling: Wenn ein neues Foto hochgeladen wurde, speichere nur den Dateinamen
    // Ansonsten: Prüfe ob eine Datei existiert
    let fotoValue = b.Foto || "";
    if (!fotoValue || fotoValue.trim() === "") {
      const photoResult = resolvePhotoFile(req.params.artikelnummer);
      if (photoResult && !photoResult.error) {
        fotoValue = photoResult.resolvedFileName;
      }
    }

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
        "Verkaufspreis" = $25, "Ausgelagert" = $26,
        "Verkauft" = $27, "Ausschuss" = $28, "Ausschuss_Grund" = $29, "Lieferschein_ID" = $30, "Rechnung_ID" = $31
             WHERE "Artikelnummer" = $32 RETURNING *`,
      [
        b.Name,
        fotoValue,
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
        b.Ausgelagert,
        b.Verkauft,
        b.Ausschuss,
        ausschussGrundValue,
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
    if (err.code === "23514" && err.constraint === AUSSCHUSS_GRUND_CONSTRAINT) {
      return res.status(400).json({
        error:
          "Wenn ein Schmuckstueck als Ausschuss markiert ist, muss ein Ausschuss Grund angegeben werden.",
      });
    }
    logger.error(
      "SCHMUCK",
      `Fehler beim Aktualisieren des Schmuckstücks: ${req.params.artikelnummer}`,
      { message: err.message },
    );
    res
      .status(500)
      .json({ error: "Fehler beim Aktualisieren des Schmuckstücks" });
  }
});

// DELETE piece
router.delete("/:artikelnummer", requireBearbeiter, async (req, res) => {
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
    logger.error(
      "SCHMUCK",
      `Fehler beim Löschen des Schmuckstücks: ${req.params.artikelnummer}`,
      { message: err.message },
    );
    res.status(500).json({ error: "Fehler beim Löschen des Schmuckstücks" });
  }
});

module.exports = router;
module.exports.resolveAusschussGrund = resolveAusschussGrund;
module.exports.GRUNDMATERIAL = GRUNDMATERIAL;
module.exports.PRODUKTART = PRODUKTART;
