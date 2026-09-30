const router = require("express").Router();
const multer = require("multer");
const db = require("../../config/db");
const logger = require("../../utils/logger");
const { requireBearbeiter } = require("../../middleware/auth");
const {
  MAX_FOTO_BYTES,
  FotoFehler,
  basisArtikelnummer,
  speichereFoto,
  loescheFoto,
  sendeFoto,
} = require("../../utils/fotoService");

// Der fileFilter weist offensichtlich falsche Typen früh ab; verbindlich ist
// die Magic-Byte-Prüfung in fotoService.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FOTO_BYTES,
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


/**
 * @swagger
 * /schmuckstuecke/upload:
 *   post:
 *     summary: Foto hochladen
 *     description: 'Max. 5 MB, nur jpg/png/gif (per Magic Bytes geprüft). Das Foto wird in der Tabelle
 *       "Foto" unter der Basis-Artikelnummer (Query-Parameter artikelnummer, ohne _Suffix) gespeichert
 *       und ersetzt ein vorhandenes. Erfordert eine gültige Anmeldung (jede Rolle: user, bearbeiter oder admin).'
 *     tags: [Schmuckstücke]
 *     security:
 *       - cookieAuth: []
 *         csrfHeader: []
 *       - bearerAuth: []
 *     parameters:
 *       - name: artikelnummer
 *         in: query
 *         required: true
 *         description: Artikelnummer; gespeichert wird unter der Basis-Artikelnummer
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
 *                 fileName: { type: string, description: Basis-Artikelnummer }
 *                 path: { type: string }
 *                 originalName: { type: string }
 *       400:
 *         description: Keine Datei, keine Artikelnummer, zu groß oder falscher Dateityp
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
  const basis = basisArtikelnummer(req.query.artikelnummer);
  if (!basis) {
    return res.status(400).json({ error: "Artikelnummer fehlt oder ist ungültig" });
  }

  try {
    await speichereFoto(db, "schmuckstueck", basis, req.file.buffer);
  } catch (err) {
    if (err instanceof FotoFehler) {
      return res.status(400).json({ error: err.message });
    }
    logger.error("SCHMUCK", "Fehler beim Speichern des Fotos", {
      artikelnummer: basis,
      message: err.message,
    });
    return res.status(500).json({ error: "Fehler beim Upload des Fotos" });
  }

  res.json({
    success: true,
    fileName: basis,
    path: basis,
    originalName: req.file.originalname,
  });
});

/**
 * @swagger
 * /schmuckstuecke/foto/{fileName}:
 *   get:
 *     summary: Foto abrufen
 *     description: 'Liefert das Foto der Basis-Artikelnummer (MHO123_1 und MHO123.jpg → MHO123) aus der
 *       Tabelle "Foto", mit ETag; bei passendem If-None-Match 304. Erfordert eine gültige Anmeldung (jede Rolle).'
 *     tags: [Schmuckstücke]
 *     parameters:
 *       - { name: fileName, in: path, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Bilddaten
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
router.get("/foto/:fileName", async (req, res) => {
  try {
    const basis = basisArtikelnummer(req.params.fileName);
    if (!basis) {
      return res.status(400).json({ error: "Ungültiger Dateiname" });
    }
    if (await sendeFoto(req, res, db, "schmuckstueck", basis)) return;
    res.status(404).json({ error: "Foto nicht gefunden" });
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
    const basis = basisArtikelnummer(req.params.fileName);
    if (!basis) {
      return res.status(400).json({ error: "Ungültiger Dateiname" });
    }
    if (await loescheFoto(db, "schmuckstueck", basis)) {
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

module.exports = router;
