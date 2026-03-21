const express = require("express");
const router = express.Router();
const db = require("../config/db");
const logger = require("../utils/logger");
const QRCode = require("qrcode");
const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");

// Hilfsfunktion: HTML Escaping
const escapeHtml = (str) => {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

// Hilfsfunktion: Lese CSS Variablen aus der index.css
const getCssVar = (cssContent, name, fallback) => {
  if (!cssContent) return fallback;
  const re = new RegExp(
    name.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&") + "\\s*:\\s*([^;]+);",
    "i",
  );
  const m = cssContent.match(re);
  return m ? m[1].trim() : fallback;
};

// --- GET OPTIONS ---
// Liefert Liste eindeutiger Basis-Artikelnummern für Dropdowns
router.get("/options", async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT DISTINCT split_part("Artikelnummer", '_', 1) as artikel_base, MIN("Name") as name
      FROM "Schmuckstück"
      GROUP BY artikel_base
      ORDER BY artikel_base
    `);
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

// --- POST PREVIEW ---
// Generiert die HTML-Vorschau und das Drucklayout der Etiketten
router.post("/preview", async (req, res) => {
  try {
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (items.length === 0)
      return res.status(400).json({ error: "Keine Artikel übergeben" });

    // 1. Artikeldaten aus der DB sammeln
    const details = [];
    for (const it of items) {
      const artikelnummer = it.artikelnummer;
      const qty = parseInt(it.qty) || 1;
      const { rows } = await db.query(
        `SELECT * FROM "Schmuckstück" WHERE "Artikelnummer" = $1 OR "Artikelnummer" LIKE $2 ORDER BY "Artikelnummer" LIMIT 1`,
        [artikelnummer, artikelnummer + "\\_%"],
      );
      if (rows.length > 0) details.push({ row: rows[0], qty });
    }

    // 2. Assets (QR, Logos, Warnhinweis) vorbereiten
    const materialHints = Array.isArray(req.body.materialHints)
      ? req.body.materialHints
      : [];

    // QR Code für Homepage
    const qrUrl = "https://www.goldregenschmuckdesign.de/";
    let qrDataUrl = "";
    try {
      qrDataUrl = await QRCode.toDataURL(qrUrl);
    } catch (e) {
      logger.warn("ETIKETTEN", "QR-Code Fehler", { message: e.message });
    }

    // Warn-SVG einlesen
    let warnDataUrl = "";
    try {
      const warnSvgPath = path.resolve(__dirname, "../assets/warn_0-3.svg");
      if (fsSync.existsSync(warnSvgPath)) {
        const svgContent = await fs.readFile(warnSvgPath, "utf8");
        warnDataUrl = `data:image/svg+xml;base64,${Buffer.from(svgContent).toString("base64")}`;
      }
    } catch (e) {}

    // Neues Logo (goldregen.svg) einlesen
    let brandDataUrl = "";
    try {
      const brandSvgPath = path.resolve(__dirname, "../assets/goldregen.svg");
      if (fsSync.existsSync(brandSvgPath)) {
        const brandContent = await fs.readFile(brandSvgPath, "utf8");
        brandDataUrl = `data:image/svg+xml;base64,${Buffer.from(brandContent).toString("base64")}`;
      }
    } catch (e) {
      logger.warn("ETIKETTEN", "Brand-Logo konnte nicht gelesen werden", {
        message: e.message,
      });
    }

    // 3. Label Größen aus CSS laden
    let cssContent = "";
    try {
      const cssPath = path.resolve(__dirname, "../../frontend/src/index.css");
      if (fsSync.existsSync(cssPath))
        cssContent = await fs.readFile(cssPath, "utf8");
    } catch (e) {}

    const labelSize = (req.body.labelSize || "small").toString();
    const sizes = {
      small: {
        w: getCssVar(cssContent, "--label-small-w", "48mm"),
        h: getCssVar(cssContent, "--label-small-h", "30mm"),
        brandH: getCssVar(cssContent, "--label-small-brandH", "8mm"),
        artSize: getCssVar(cssContent, "--label-small-artSize", "8mm"),
        hintSize: getCssVar(cssContent, "--label-small-hintSize", "3.5mm"),
        qr: getCssVar(cssContent, "--label-small-qr", "14mm"),
      },
      medium: {
        w: getCssVar(cssContent, "--label-medium-w", "60mm"),
        h: getCssVar(cssContent, "--label-medium-h", "36mm"),
        brandH: getCssVar(cssContent, "--label-medium-brandH", "10mm"),
        artSize: getCssVar(cssContent, "--label-medium-artSize", "10mm"),
        hintSize: getCssVar(cssContent, "--label-medium-hintSize", "4mm"),
        qr: getCssVar(cssContent, "--label-medium-qr", "16mm"),
      },
      large: {
        w: getCssVar(cssContent, "--label-large-w", "80mm"),
        h: getCssVar(cssContent, "--label-large-h", "48mm"),
        brandH: getCssVar(cssContent, "--label-large-brandH", "14mm"),
        artSize: getCssVar(cssContent, "--label-large-artSize", "14mm"),
        hintSize: getCssVar(cssContent, "--label-large-hintSize", "5mm"),
        qr: getCssVar(cssContent, "--label-large-qr", "20mm"),
      },
    };
    const s = sizes[labelSize] || sizes.small;

    // 4. HTML für jedes Label aufbauen
    const labelHtmlParts = [];

    // Fallback-Warnhinweis, falls das Inline scheitert
    const warnImgHtml = warnDataUrl
      ? `<img src="${warnDataUrl}" class="warn-symbol" alt="Warnung" />`
      : `<img src="/api/etiketten/warn.svg" class="warn-symbol" alt="Warnung" />`;
    const qrImgHtml = qrDataUrl
      ? `<img src="${qrDataUrl}" alt="QR" class="qr-img" />`
      : "";

    for (const d of details) {
      for (let i = 0; i < d.qty; i++) {
        const num = (d.row.Artikelnummer || "").split("_")[0];

        // Brand-Logo: Soll in voller Breite gerendert werden
        const brandHtml = brandDataUrl
          ? `<img src="${brandDataUrl}" class="brand-logo" alt="GoldRegen" />`
          : `<div class="brand-text">GoldRegen Schmuckdesign</div>`;

        // Zusatzinfos (optional). Wenn leer, wird Platzhalter für Leerraum gesetzt
        const hintsHtml = materialHints.length > 0
            ? `<div class="hints-container">
               <ul class="hints">${materialHints.map((h) => `<li>${escapeHtml(h)}</li>`).join("")}</ul>
             </div>`
            : `<div class="empty-space"></div>`;

        // Strukturiertes Layout nach Vorgabe
        labelHtmlParts.push(`
          <div class="label">
            <div class="logo-container">${brandHtml}</div>
            <div class="dotted-line"></div>
            <div class="artnr">${escapeHtml(num)}</div>
            ${hintsHtml}
            <div class="bottom-row">
              ${warnImgHtml}
              ${qrImgHtml}
            </div>
          </div>
        `);
      }
    }

    // 5. Minimales Print-CSS
    const printCss = `
      @page { size: ${s.w} ${s.h}; margin: 0mm; }
      html, body { width: 100%; height: 100%; margin: 0; padding: 0; background: #fff; }
      body.etiketten-body { font-family: Inter, -apple-system, BlinkMacSystemFont, sans-serif; }
      .sheet { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 0; padding: 0; margin: 0; }
      
      .label {
        box-sizing: border-box;
        width: ${s.w};
        height: ${s.h};
        padding: 2mm 3mm;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        align-items: center;
        border: 0.2mm solid transparent;
        margin: 0;
        page-break-after: always;
        overflow: hidden;
      }

      /* 1. Logo */
      .logo-container {
        width: 100%;
        flex: 0 1 35%; /* Bis zu 35% der Hoehe */
        display: flex;
        justify-content: center;
        align-items: center;
      }
      .brand-logo {
        width: 100%;
        max-height: 100%;
        object-fit: contain;
      }
      .brand-text {
        text-align: center;
        font-weight: 700;
        font-size: 8mm;
        width: 100%;
      }

      /* 2. Linie */
      .dotted-line {
        width: 100%;
        border-bottom: 1px dotted #000;
        margin: 1mm 0;
        flex-shrink: 0;
      }

      /* 3. Artikelnummer */
      .artnr {
        width: 100%;
        text-align: center;
        font-weight: 700;
        font-size: ${s.artSize}; /* z.B. 8mm */
        line-height: 1;
        flex: 0 0 auto;
      }

      /* 4. Zusatzinfos / Leerraum */
      .hints-container {
        width: 100%;
        text-align: center;
        font-size: ${s.hintSize};
        flex: 1 1 auto; /* Nimmt restlichen Platz ein */
        display: flex;
        flex-direction: column;
        justify-content: center;
        overflow: hidden;
        min-height: 2mm;
      }
      .hints {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .hints li {
        margin: 0.5mm 0;
      }
      .empty-space {
        flex: 1 1 auto;
      }

      /* 5. GANZ UNTEN: QR Code und Warnhinweis */
      .bottom-row {
        width: 100%;
        flex: 0 1 30%; /* Maximal 30% der Hoehe */
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
      }
      .warn-symbol {
        height: 100%;
        max-height: 10mm;
        width: auto;
        object-fit: contain;
        flex-shrink: 0;
      }
      .qr-img {
        height: 100%;
        max-height: 14mm;
        width: auto;
        object-fit: contain;
        flex-shrink: 0;
      }
    `;

    // 6. Finales HTML ausgeben
    const html = `<!doctype html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Etiketten Vorschau</title>
        <style>${printCss}</style>
      </head>
      <body class="etiketten-body">
        <div class="sheet">
          ${labelHtmlParts.join("\n")}
        </div>
        <script>window.onload = function(){ window.focus(); };</script>
      </body>
      </html>`;

    res.set("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err) {
    logger.error("ETIKETTEN", "Fehler beim Erzeugen der Vorschau", {
      message: err.message,
    });
    res
      .status(500)
      .json({ error: "Fehler beim Erzeugen der Etiketten-Vorschau" });
  }
});

// --- GET CSS FOREGROUND (für Vorschau) ---
router.get("/styles.css", async (req, res) => {
  try {
    const cssPath = path.resolve(__dirname, "../../frontend/src/index.css");
    if (!fsSync.existsSync(cssPath))
      return res.status(404).send("/* not found */");
    const css = await fs.readFile(cssPath, "utf8");
    res.set("Content-Type", "text/css; charset=utf-8");
    res.send(css);
  } catch (err) {
    res.status(500).send("/* error */");
  }
});

// --- GET WARN SVG ---
router.get("/warn.svg", async (req, res) => {
  try {
    const imgPath = path.resolve(__dirname, "../assets/warn_0-3.svg");
    if (!fsSync.existsSync(imgPath)) return res.status(404).send("");
    const svg = await fs.readFile(imgPath, "utf8");
    res.set("Content-Type", "image/svg+xml; charset=utf-8");
    res.send(svg);
  } catch (err) {
    res.status(500).send("");
  }
});

module.exports = router;
