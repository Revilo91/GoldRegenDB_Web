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
const { GRUNDMATERIAL, PRODUKTART } = require("../utils/constants");
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

const AUSSCHUSS_GRUND_CONSTRAINT = "schmuckstueck_ausschuss_grund_required_chk";

// Statusfilter aus den Query-Parametern. Die Bedeutung von "verkauft" steht im
// whereClauseBuilder, nicht in dieser Route (Befund F5): vorher hiess es hier
// builder.equals("Verkauft", parseInt(verkauft)), also woertlich "Verkauft = 1"
// -- damit lieferte das Dropdown "Verkauft" auch Ausschussstuecke, obwohl
// CLAUDE.md Verkauft als "Verkauft=1 AND Ausschuss=0" definiert.
// parseInt("abc") ergab ausserdem NaN als Query-Parameter und damit HTTP 500
// statt 400 (Befund C25).
const FLAG_WERTE = { 1: true, 0: false, true: true, false: false };

// Leerstrings bedeuten wie ueberall im Projekt "kein Wert", nicht "= 0"
// (siehe leerZuNull in schemas/common.js).
const istLeer = (wert) => wert === undefined || String(wert).trim() === "";

/**
 * Haengt verkauft/ausschuss/ausgelagert an den Builder.
 * @returns {string|null} Fehlermeldung fuer HTTP 400, oder null
 */
function statusFilterAnwenden(builder, query) {
  if (!istLeer(query.verkauft)) {
    const flag = FLAG_WERTE[String(query.verkauft)];
    if (flag === undefined) return "verkauft muss 0 oder 1 sein";
    if (flag) builder.verkauft();
    else builder.nichtVerkauft();
  }

  if (!istLeer(query.ausschuss)) {
    const flag = FLAG_WERTE[String(query.ausschuss)];
    if (flag === undefined) return "ausschuss muss 0 oder 1 sein";
    if (flag) builder.ausschuss();
    else builder.keinAusschuss();
  }

  if (!istLeer(query.ausgelagert)) {
    const kundeId = Number(query.ausgelagert);
    if (!Number.isInteger(kundeId) || kundeId < 0) {
      return "ausgelagert muss eine Kundennummer oder 0 sein";
    }
    if (kundeId === 0) builder.imLager();
    else builder.ausgelagert(kundeId);
  }

  return null;
}

// ausschuss kommt aus zod als boolean (Befund B6); aeltere Aufrufer und Tests
// schicken 0/1 oder "1" -- beides bleibt gueltig.
function resolveAusschussGrund(ausschuss, ausschussGrund) {
  const istAusschuss = ausschuss === true || ausschuss === 1 || ausschuss === "1";
  const normalizedGrund =
    typeof ausschussGrund === "string" ? ausschussGrund.trim() : "";

  if (istAusschuss) {
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

/**
 * @swagger
 * /schmuckstuecke/upload:
 *   post:
 *     summary: Foto hochladen
 *     description: 'Max. 5 MB, nur jpg/png/gif (multer). Der Dateiname wird aus der Basis-Artikelnummer
 *       (Query-Parameter artikelnummer, ohne _Suffix) gebildet. Erfordert eine gültige Anmeldung
 *       (jede Rolle: user, bearbeiter oder admin).'
 *     tags: [Schmuckstücke]
 *     security:
 *       - cookieAuth: []
 *         csrfHeader: []
 *       - bearerAuth: []
 *     parameters:
 *       - name: artikelnummer
 *         in: query
 *         description: Basis-Artikelnummer, bestimmt den gespeicherten Dateinamen
 *         schema: { type: string, example: MHO123 }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [foto]
 *             properties:
 *               foto: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: Foto gespeichert
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 fileName: { type: string }
 *                 path: { type: string }
 *                 originalName: { type: string }
 *       400:
 *         description: Keine Datei hochgeladen, oder falscher Dateityp
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post("/upload", (req, res, next) => {
  upload.single("foto")(req, res, (err) => {
    if (!err) {
      return next();
    }
    logger.error("SCHMUCK", "Fehler beim Upload des Fotos", {
      message: err.message,
    });
    if (
      err.code === "LIMIT_FILE_SIZE" ||
      err.message.includes("Nur") ||
      err.message.includes("erlaubt")
    ) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: "Fehler beim Upload des Fotos" });
  });
}, async (req, res) => {
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
});

/**
 * @swagger
 * /schmuckstuecke/foto/{fileName}:
 *   get:
 *     summary: Foto abrufen
 *     description: 'Erfordert eine gültige Anmeldung (jede Rolle).'
 *     tags: [Schmuckstücke]
 *     parameters:
 *       - { name: fileName, in: path, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Bilddatei
 *         content:
 *           image/*:
 *             schema: { type: string, format: binary }
 *       400:
 *         description: Ungültiger Dateiname
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404:
 *         description: Foto nicht gefunden
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 */
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

      logger.error("SCHMUCK", "Fehler beim Abrufen des Fotos", {
        fileName: req.params.fileName,
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
        });
      }
    });
  } catch (err) {
    logger.error(
      "SCHMUCK",
      "Fehler beim Abrufen des Fotos",
      { fileName: req.params.fileName, message: err.message, stack: err.stack },
    );
    res.status(500).json({
      error: "Fehler beim Abrufen des Fotos",
    });
  }
});

/**
 * @swagger
 * /schmuckstuecke/foto/{fileName}:
 *   delete:
 *     summary: Foto löschen
 *     description: 'Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Schmuckstücke]
 *     security:
 *       - cookieAuth: []
 *         csrfHeader: []
 *       - bearerAuth: []
 *     parameters:
 *       - { name: fileName, in: path, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Foto gelöscht
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404:
 *         description: Foto nicht gefunden
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 */
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
      "Fehler beim Löschen des Fotos",
      { fileName: req.params.fileName, message: err.message },
    );
    res.status(500).json({ error: "Fehler beim Löschen des Fotos" });
  }
});

// ========== FILTER-OPTIONS ROUTES ==========

/**
 * @swagger
 * /schmuckstuecke/next-artikelnummer:
 *   get:
 *     summary: Nächste Artikelnummer für ein Präfix ermitteln
 *     description: 'Präfix = Hersteller + Grundmaterial + Produktart (z. B. MHO -> MHO127).
 *       Erfordert eine gültige Anmeldung (jede Rolle).'
 *     tags: [Schmuckstücke]
 *     parameters:
 *       - name: prefix
 *         in: query
 *         required: true
 *         schema: { type: string, pattern: '^[A-Z]{3}$', example: MHO }
 *     responses:
 *       200:
 *         description: Nächste Artikelnummer
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 prefix: { type: string }
 *                 nextNum: { type: integer }
 *                 artikelnummer: { type: string, example: MHO127 }
 *       400:
 *         description: Ungültiger oder unbekannter Präfix
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
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

/**
 * @swagger
 * /schmuckstuecke/bulk:
 *   post:
 *     summary: Mehrere Schmuckstücke per expliziten Artikelnummern anlegen
 *     description: 'Zwei Eingabeformen: entweder eine items-Liste (je Eintrag eine vollständige
 *       Artikelnummer inkl. Suffix, z. B. MHO123_1) oder template + artikelnummern (Vorlage wird auf
 *       jede Artikelnummer angewendet). Maximal 200 Einträge, alle Artikelnummern müssen neu sein.
 *       Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Schmuckstücke]
 *     security:
 *       - cookieAuth: []
 *         csrfHeader: []
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               items:
 *                 type: array
 *                 maxItems: 200
 *                 items:
 *                   type: object
 *                   required: [Artikelnummer]
 *                   properties: { Artikelnummer: { type: string, example: MHO123_1 } }
 *               template: { type: object, description: 'Freitext-/Zahlenfelder, auf alle artikelnummern angewendet' }
 *               artikelnummern:
 *                 description: Liste oder durch Zeilenumbruch/Komma/Semikolon getrennter Text
 *                 oneOf: [{ type: array, items: { type: string }, maxItems: 200 }, { type: string, maxLength: 5000 }]
 *     responses:
 *       201:
 *         description: Schmuckstücke erstellt
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 createdCount: { type: integer }
 *                 createdArtikelnummern: { type: array, items: { type: string } }
 *                 items: { type: array, items: { $ref: '#/components/schemas/Schmuckstueck' } }
 *       400:
 *         description: Validierungsfehler, ungültiges/dupliziertes Format
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       409:
 *         description: Mindestens eine Artikelnummer existiert bereits
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *                 existingArtikelnummern: { type: array, items: { type: string } }
 */
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
          0,      // Ausgelagert
          false,  // Verkauft
          false,  // Ausschuss (item.Ausschuss wird verworfen, Befund C12)
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

/**
 * @swagger
 * /schmuckstuecke:
 *   get:
 *     summary: Schmuckstücke abrufen (paginiert, durchsuchbar, filterbar)
 *     description: 'Filter kombinieren sich per AND, umgesetzt über den whereClauseBuilder (siehe
 *       CLAUDE.md). Erfordert eine gültige Anmeldung (jede Rolle).'
 *     tags: [Schmuckstücke]
 *     parameters:
 *       - { name: page, in: query, schema: { type: integer, default: 1 } }
 *       - name: limit
 *         in: query
 *         description: '-1 lädt alle Treffer ohne Limit'
 *         schema: { type: integer, default: 50 }
 *       - name: search
 *         in: query
 *         description: Freitextsuche über alle Felder, oder ein Grundmaterial-Code/-Name (z. B. "Perle")
 *         schema: { type: string }
 *       - { name: grundmaterial, in: query, schema: { type: string, example: P } }
 *       - { name: artikelnummer_art, in: query, description: Produktart-Code, schema: { type: string, example: A } }
 *       - { name: verkauft, in: query, schema: { type: integer, enum: [0, 1] } }
 *       - { name: ausgelagert, in: query, description: '0 oder eine Kunde.ID', schema: { type: integer } }
 *       - { name: ausschuss, in: query, schema: { type: integer, enum: [0, 1] } }
 *     responses:
 *       200:
 *         description: Seite mit Schmuckstücken
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     allOf:
 *                       - $ref: '#/components/schemas/Schmuckstueck'
 *                       - type: object
 *                         properties:
 *                           Grundmaterial: { type: string, description: 'Klartext-Name, aus Artikelnummer[1]' }
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     page: { type: integer }
 *                     limit: { type: integer }
 *                     total: { type: integer }
 *                     totalPages: { type: integer }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get("/", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit);
    if (isNaN(limit)) limit = 50;
    const offset = (page - 1) * limit;
    const search = req.query.search || "";
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

    const filterFehler = statusFilterAnwenden(builder, req.query);
    if (filterFehler) {
      return res.status(400).json({ error: filterFehler });
    }

    const whereClause = builder.build();
    const params = builder.getParams();
    const nextParamIdx = builder.getNextParamIdx();
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

/**
 * @swagger
 * /schmuckstuecke/filter-options:
 *   get:
 *     summary: Verfügbare Filter-Optionen (Art, Farbe, Material usw.)
 *     description: 'Ein aggregierter Scan statt 27 einzelner SELECT DISTINCT. Erfordert eine gültige
 *       Anmeldung (jede Rolle).'
 *     tags: [Schmuckstücke]
 *     responses:
 *       200:
 *         description: Distinct-Werte je Feld, sortiert (Zahlen numerisch, Text nach deutscher Kollation)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: { type: array, items: {} }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
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
         -- ::int, damit die Filter-Optionen weiter 0/1 liefern und das
         -- Dropdown im Frontend unberuehrt bleibt
         array_agg(DISTINCT "Ausschuss"::int) FILTER (WHERE "Ausschuss" IS NOT NULL) AS ausschuesse,
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

    // GRUNDMATERIAL und PRODUKTART lagen vierfach im Projekt: utils/constants.js,
    // dieser Route (als eigene Kopie), Schmuckstuecke.jsx und nochmals
    // hartcodiert im Produktart-Dropdown (Befund G22). utils/constants.js ist
    // jetzt die einzige Quelle und reist über diese Antwort ins Frontend -- das
    // holt sie ohnehin schon beim Mount, ein zweiter Endpunkt wäre unnötig.
    options.grundmaterialien = Object.entries(GRUNDMATERIAL).map(([code, label]) => ({ code, label }));
    options.produktarten = Object.entries(PRODUKTART).map(([code, label]) => ({ code, label }));

    res.json(options);
  } catch (err) {
    logger.error("SCHMUCK", "Fehler beim Laden der Filter-Optionen", {
      message: err.message,
    });
    res.status(500).json({ error: "Fehler beim Laden der Filter-Optionen" });
  }
});

/**
 * @swagger
 * /schmuckstuecke/unique-artikelnummern:
 *   get:
 *     summary: Eindeutige Basis-Artikelnummern (ohne Suffix)
 *     description: 'Für die Lager-Inventur-Zählung. Unterstützt dieselben Filter wie GET /schmuckstuecke
 *       (verkauft, ausgelagert, ausschuss, artikelnummer_art, grundmaterial). Erfordert eine gültige
 *       Anmeldung (jede Rolle).'
 *     tags: [Schmuckstücke]
 *     parameters:
 *       - { name: verkauft, in: query, schema: { type: integer, enum: [0, 1] } }
 *       - { name: ausgelagert, in: query, schema: { type: integer } }
 *       - { name: ausschuss, in: query, schema: { type: integer, enum: [0, 1] } }
 *       - { name: artikelnummer_art, in: query, schema: { type: string } }
 *       - { name: grundmaterial, in: query, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Basis-Artikelnummern
 *         content:
 *           application/json:
 *             schema: { type: array, items: { type: string, example: MHO123 } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get("/unique-artikelnummern", async (req, res) => {
  try {
    const artikelnummer_art = req.query.artikelnummer_art;
    // Initialisiere WHERE-Builder
    const builder = where();

    const filterFehler = statusFilterAnwenden(builder, req.query);
    if (filterFehler) {
      return res.status(400).json({ error: filterFehler });
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
      error: "Fehler beim Laden der einzigartigen Artikelnummern",
    });
  }
});

/**
 * @swagger
 * /schmuckstuecke/{artikelnummer}:
 *   get:
 *     summary: Schmuckstück-Detail
 *     description: 'Erfordert eine gültige Anmeldung (jede Rolle).'
 *     tags: [Schmuckstücke]
 *     parameters:
 *       - { name: artikelnummer, in: path, required: true, schema: { type: string, example: MHO123_1 } }
 *     responses:
 *       200:
 *         description: Schmuckstück
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Schmuckstueck' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
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
      "Fehler beim Laden des Schmuckstücks",
      { artikelnummer: req.params.artikelnummer, message: err.message },
    );
    res.status(500).json({ error: "Fehler beim Laden des Schmuckstücks" });
  }
});

/**
 * @swagger
 * /schmuckstuecke:
 *   post:
 *     summary: Schmuckstück(e) anlegen
 *     description: 'Artikelnummer akzeptiert drei Kurzformen: nur Präfix (z. B. MHO -> nächste freie
 *       Nummer wird vergeben), Präfix+Nummer ohne Suffix (z. B. MHO123 -> nächster freier Suffix), oder
 *       eine vollständige Nummer mit Suffix. Bei Anzahl > 1 werden mehrere Exemplare mit fortlaufendem
 *       Suffix angelegt und Attribute vom letzten existierenden Exemplar übernommen, sofern eines
 *       existiert. Erfordert eine gültige Anmeldung (jede Rolle, auch user – siehe CLAUDE.md Rollen).'
 *     tags: [Schmuckstücke]
 *     security:
 *       - cookieAuth: []
 *         csrfHeader: []
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [Artikelnummer]
 *             properties:
 *               Artikelnummer:
 *                 type: string
 *                 example: MHO
 *                 description: 'Präfix, Präfix+Nummer, oder vollständige Nummer'
 *               Anzahl: { type: integer, minimum: 1, maximum: 200, default: 1 }
 *               Name: { type: string, nullable: true }
 *               Art: { type: string, nullable: true }
 *               Form: { type: string, nullable: true }
 *               Material: { type: string, nullable: true }
 *               Farbe: { type: string, nullable: true }
 *               Länge: { type: number, nullable: true }
 *               Grösse: { type: number, nullable: true }
 *               Herstellungskosten: { type: number, nullable: true }
 *               Verkaufspreis: { type: number, nullable: true }
 *               Ausschuss: { type: boolean }
 *               Ausschuss_Grund: { type: string, nullable: true }
 *     responses:
 *       201:
 *         description: Erstelltes Schmuckstück (Anzahl=1) oder Liste (Anzahl>1)
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - $ref: '#/components/schemas/Schmuckstueck'
 *                 - { type: array, items: { $ref: '#/components/schemas/Schmuckstueck' } }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
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

    // Befund C11: der Kommentar hier sagte "Daten von Produkt holen, sobald das
    // form nicht ausgefüllt ist" -- geprüft wurde das nie. Die Bedingung war
    // `if (b.Artikelnummer)`, und Artikelnummer ist Pflichtfeld, also IMMER
    // wahr. Wer ein weiteres Exemplar mit korrigiertem Preis oder Namen anlegte,
    // bekam stillschweigend die Werte des Vorgängers -- die Eingabe war weg,
    // ohne Meldung.
    //
    // Jetzt gilt, was der Kommentar behauptete: übernommen wird nur, was der
    // Client NICHT geschickt hat. Wer nichts vorgeben will, bekommt wie bisher
    // die Werte des Vorgängers; wer etwas eingibt, behält es.
    const UEBERNEHMBARE_FELDER = [
      'Name', 'Foto', 'Art', 'Material', 'Farbe', 'Verkaufspreis',
      'Herstellungskosten', 'Länge', 'Fassung', 'Inhalt_Material',
      'Inhalt_Farbe', 'Inhalt_Farbakzent', 'Inhalt_Zusatzmaterial',
      'Anhänger_Fassung', 'Anhänger_Form', 'Anhänger_Farbe', 'Anhänger_Grösse',
      'Anhänger_Inhalt_Material', 'Anhänger_Inhalt_Farbe',
      'Anhänger_Inhalt_Farbakzente', 'Anhänger_Inhalt_Zusatzmaterial',
      'Grösse', 'Anhänger', 'Zwischenstück',
      // "Ausschuss_Grund" steht hier bewusst NICHT: er wurde vom Vorgänger
      // kopiert, während b.Ausschuss auf false erzwungen wird -- das ergab
      // Datensätze mit Ausschussgrund, die kein Ausschuss sind.
    ];

    if (b.Artikelnummer) {
      const { rows } = await client.query(
        `SELECT * FROM "Schmuckstück" WHERE "Artikelnummer" = $1 || '_' || $2`,
        [baseArtikelnummer, startSuffix - 1],
      );
      if (rows.length > 0) {
        const vorgaenger = rows[0];
        for (const feld of UEBERNEHMBARE_FELDER) {
          const eingabe = b[feld];
          const leer = eingabe === undefined || eingabe === null || eingabe === '';
          if (leer) {
            b[feld] = vorgaenger[feld];
          }
        }
        // Ein Duplikat startet immer im Lager, unabhängig vom Vorgänger.
        b.Ausgelagert = 0;
        b.Verkauft = false;
        b.Ausschuss = false;
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
          b.Verkauft ?? false,
          b.Ausschuss ?? false,
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

/**
 * @swagger
 * /schmuckstuecke/{artikelnummer}:
 *   put:
 *     summary: Schmuckstück aktualisieren
 *     description: 'Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Schmuckstücke]
 *     security:
 *       - cookieAuth: []
 *         csrfHeader: []
 *       - bearerAuth: []
 *     parameters:
 *       - { name: artikelnummer, in: path, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               Name: { type: string, nullable: true }
 *               Art: { type: string, nullable: true }
 *               Form: { type: string, nullable: true }
 *               Material: { type: string, nullable: true }
 *               Farbe: { type: string, nullable: true }
 *               Länge: { type: number, nullable: true }
 *               Grösse: { type: number, nullable: true }
 *               Herstellungskosten: { type: number, nullable: true }
 *               Verkaufspreis: { type: number, nullable: true }
 *               Ausgelagert: { type: integer, description: '0 oder Kunde.ID' }
 *               Verkauft: { type: boolean }
 *               Ausschuss: { type: boolean }
 *               Ausschuss_Grund: { type: string, nullable: true }
 *               Lieferschein_ID: { type: integer }
 *               Rechnung_ID: { type: integer }
 *     responses:
 *       200:
 *         description: Aktualisiertes Schmuckstück
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Schmuckstueck' } } }
 *       400:
 *         description: Validierungsfehler, oder Ausschuss=1 ohne Ausschuss_Grund
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
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
        "Anhänger" = $22, "Zwischenstück" = $23,
        -- Auch die Geldspalten sind NOT NULL (Befund B1). Ohne COALESCE
        -- schrieb ein PUT ohne Preis frueher still NULL -- der Preis war weg,
        -- und der Audit-Trigger protokolliert Preisaenderungen nicht, die
        -- Spur fehlte also auch. Seit NOT NULL waere es stattdessen ein 500.
        "Herstellungskosten" = COALESCE($24, "Herstellungskosten"),
        "Verkaufspreis" = COALESCE($25, "Verkaufspreis"),
        -- COALESCE fuer die fuenf Statusfelder (Befund C8): sie stehen im
        -- Schema als .nullish(), ein PUT ohne diese Felder schrieb also NULL.
        -- Danach passte das Stueck auf keine Statusbedingung mehr -- weder
        -- verfuegbar (= 0) noch aktivAusgelagert (> 0) -- und fiel aus Liste,
        -- Dashboard, Inventur und SumUp-Export heraus.
        "Ausgelagert" = COALESCE($26, "Ausgelagert"),
        "Verkauft" = COALESCE($27, "Verkauft"),
        "Ausschuss" = COALESCE($28, "Ausschuss"),
        "Ausschuss_Grund" = $29,
        "Lieferschein_ID" = COALESCE($30, "Lieferschein_ID"),
        "Rechnung_ID" = COALESCE($31, "Rechnung_ID")
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
      "Fehler beim Aktualisieren des Schmuckstücks",
      { artikelnummer: req.params.artikelnummer, message: err.message },
    );
    res
      .status(500)
      .json({ error: "Fehler beim Aktualisieren des Schmuckstücks" });
  }
});

/**
 * @swagger
 * /schmuckstuecke/{artikelnummer}:
 *   delete:
 *     summary: Schmuckstück löschen
 *     description: 'Erfordert Rolle: bearbeiter oder admin.'
 *     tags: [Schmuckstücke]
 *     security:
 *       - cookieAuth: []
 *         csrfHeader: []
 *       - bearerAuth: []
 *     parameters:
 *       - { name: artikelnummer, in: path, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Schmuckstück gelöscht
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
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
      "Fehler beim Löschen des Schmuckstücks",
      { artikelnummer: req.params.artikelnummer, message: err.message },
    );
    res.status(500).json({ error: "Fehler beim Löschen des Schmuckstücks" });
  }
});

module.exports = router;
module.exports.resolveAusschussGrund = resolveAusschussGrund;
module.exports.GRUNDMATERIAL = GRUNDMATERIAL;
module.exports.PRODUKTART = PRODUKTART;
