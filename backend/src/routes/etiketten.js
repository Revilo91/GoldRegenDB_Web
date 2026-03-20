const express = require("express");
const router = express.Router();
const db = require("../config/db");
const logger = require("../utils/logger");
const QRCode = require("qrcode");
const fs = require("fs");
const path = require("path");

// GET options: list of base article numbers (without suffix) + name
router.get("/options", async (req, res) => {
  try {
    // Return deduplicated base article numbers (split on '_') to avoid showing suffixes
    const { rows } = await db.query(
      `SELECT DISTINCT split_part("Artikelnummer", '_', 1) as artikel_base, MIN("Name") as name
       FROM "Schmuckstück"
       GROUP BY artikel_base
       ORDER BY artikel_base
       `,
    );
    res.json(
      rows.map((r) => ({ artikelnummer: r.artikel_base, name: r.name })),
    );
  } catch (err) {
    logger.error("ETIKETTEN", "Fehler beim Laden der Etiketten-Optionen", {
      message: err.message,
    });
    res.status(500).json({ error: "Fehler beim Laden der Etiketten-Optionen" });
  }
});

// POST preview: generate simple HTML for labels
router.post("/preview", async (req, res) => {
  try {
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (items.length === 0)
      return res.status(400).json({ error: "Keine Artikel übergeben" });

    // Collect data for each requested artikelnummer
    const details = [];
    for (const it of items) {
      // accept base artikelnummer (without suffix) and find a matching record
      const artikelnummer = it.artikelnummer;
      const qty = parseInt(it.qty) || 1;
      const { rows } = await db.query(
        `SELECT * FROM "Schmuckstück" WHERE "Artikelnummer" = $1 OR "Artikelnummer" LIKE $2 ORDER BY "Artikelnummer" LIMIT 1`,
        [artikelnummer, artikelnummer + "\_%"],
      );
      if (rows.length === 0) {
        // skip missing
        continue;
      }
      details.push({ row: rows[0], qty });
    }

    // Build minimal HTML optimized for small labels (Phomemo M220). User can print from the browser.
    const materialHints = Array.isArray(req.body.materialHints)
      ? req.body.materialHints
      : [];
    // generate QR code (data URL) for company homepage
    const qrUrl = "https://www.goldregenschmuckdesign.de/";
    let qrDataUrl = "";
    try {
      qrDataUrl = await QRCode.toDataURL(qrUrl);
    } catch (e) {
      logger.warn("ETIKETTEN", "QR-Code konnte nicht generiert werden", {
        message: e.message,
      });
      qrDataUrl = "";
    }
    // try to inline warn SVG as data URL to avoid separate requests
    let warnDataUrl = "";
    try {
      const warnSvgPath = path.resolve(__dirname, "../assets/warn_0-3.svg");
      if (fs.existsSync(warnSvgPath)) {
        const svgContent = await fs.promises.readFile(warnSvgPath, "utf8");
        const svgBase64 = Buffer.from(svgContent).toString("base64");
        warnDataUrl = `data:image/svg+xml;base64,${svgBase64}`;
      }
    } catch (e) {
      logger.warn("ETIKETTEN", "Warn-SVG konnte nicht gelesen werden", { message: e.message });
    }
    const labelHtmlParts = [];
    for (const d of details) {
      for (let i = 0; i < d.qty; i++) {
        const art = d.row;
        const num = (art.Artikelnummer || "").split("_")[0];
        // build material hint html
        const hintsHtml =
          materialHints.length > 0
            ? `<div class="material-title">Material Hinweise</div><ul class="hints">${materialHints.map((h) => `<li>${escapeHtml(h)}</li>`).join("")}</ul>`
            : "";
        const hasHints = materialHints.length > 0;
        // Use mm units so printed size scales properly for physical labels (portrait)
        const qrSizeMm = hasHints ? 12 : 16; // mm
        const qrImgHtml = qrDataUrl
          ? `<img src="${qrDataUrl}" alt="QR" class="qr-img" style="width:${qrSizeMm}mm;height:${qrSizeMm}mm;object-fit:contain" />`
          : "";

        // Use inlined warn SVG (data URL) when available, otherwise fall back to endpoint
        const warnImgHtml = warnDataUrl
          ? `<img src="${warnDataUrl}" class="warn-symbol" alt="Nicht für Kinder unter 3 Jahren" style="width:10mm;height:10mm;flex-shrink:0" />`
          : `<img src="/api/etiketten/warn.svg" class="warn-symbol" alt="Nicht für Kinder unter 3 Jahren" style="width:10mm;height:10mm;flex-shrink:0" />`;
        const leftMeta = `<div class="left-meta">${hintsHtml}</div>`;

        labelHtmlParts.push(`
          <div class="label">
            <div class="brand">GoldRegen<br/>Schmuckdesign</div>
            <div class="dotted">............................................</div>
            <div class="artnr">${escapeHtml(num)}</div>
            <div class="meta-row">
              ${leftMeta}
              <div class="right-block" style="display:flex;flex-direction:row;align-items:center;gap:6px">
                <div style="display:flex;align-items:center">${warnImgHtml}</div>
                ${qrImgHtml ? `<div class="qr" style="display:flex;align-items:center">${qrImgHtml}</div>` : ""}
              </div>
            </div>
          </div>
        `);
      }
    }

    const html = `<!doctype html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Etiketten Vorschau</title>
            <link rel="stylesheet" href="/api/etiketten/styles.css">
      </head>
          <body class="etiketten-body">
        <div class="sheet">
          ${labelHtmlParts.join("\n")}
        </div>
        <script>window.onload = function(){ window.focus(); /* user prints manually */ };</script>
      </body>
      </html>`;

    res.set("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err) {
    logger.error("ETIKETTEN", "Fehler beim Erzeugen der Etiketten-Vorschau", {
      message: err.message,
    });
    res
      .status(500)
      .json({ error: "Fehler beim Erzeugen der Etiketten-Vorschau" });
  }
});

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

module.exports = router;

// Serve frontend index.css so preview can reuse the same styles
router.get("/styles.css", async (req, res) => {
  try {
    const cssPath = path.resolve(__dirname, "../../frontend/src/index.css");
    if (!fs.existsSync(cssPath)) return res.status(404).send("/* not found */");
    const css = await fs.promises.readFile(cssPath, "utf8");
    res.set("Content-Type", "text/css; charset=utf-8");
    res.send(css);
  } catch (err) {
    logger.warn("ETIKETTEN", "Fehler beim Lesen der CSS-Datei", { message: err.message });
    res.status(500).send("/* error */");
  }
});

// Serve warn SVG from frontend public folder
router.get("/warn.svg", async (req, res) => {
  try {
    const imgPath = path.resolve(__dirname, "../assets/warn_0-3.svg");
    if (!fs.existsSync(imgPath)) return res.status(404).send("");
    const svg = await fs.promises.readFile(imgPath, "utf8");
    res.set("Content-Type", "image/svg+xml; charset=utf-8");
    res.send(svg);
  } catch (err) {
    logger.warn("ETIKETTEN", "Fehler beim Lesen der Warn-SVG", { message: err.message });
    res.status(500).send("");
  }
});
