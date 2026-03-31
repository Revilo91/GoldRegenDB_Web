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
    let materialHints = Array.isArray(req.body.materialHints)
      ? req.body.materialHints
      : [];
    // Maximal 6 Hinweise zulassen
    materialHints = materialHints.slice(0, 6);

    // QR Code für Homepage
    const qrUrl = "https://goldregenschmuckdesign.de";
    let qrDataUrl = "";
    // try {
    //   // SVG bleibt beim Druck deutlich schaerfer als PNG bei kleinen Labels.
    //   const qrSvg = await QRCode.toString(qrUrl, {
    //     type: "svg",
    //     errorCorrectionLevel: "Q",
    //     margin: 4,
    //     color: {
    //       dark: "#000000",
    //       light: "#FFFFFF",
    //     },
    //   });
    //   qrDataUrl = `data:image/svg+xml;base64,${Buffer.from(qrSvg).toString("base64")}`;
    // } catch (e) {
    //   logger.warn("ETIKETTEN", "QR-SVG Fehler, fallback auf PNG", {
    //     message: e.message,
    //   });
    try {
      qrDataUrl = await QRCode.toDataURL(qrUrl, {
        errorCorrectionLevel: "Q",
        margin: 4,
        width: 1200,
        color: {
          dark: "#000000",
          light: "#FFFFFF",
        },
      });
    } catch (fallbackErr) {
      logger.warn("ETIKETTEN", "QR-Code Fehler", {
        message: fallbackErr.message,
      });
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
      },
      medium: {
        w: getCssVar(cssContent, "--label-medium-w", "60mm"),
        h: getCssVar(cssContent, "--label-medium-h", "36mm"),
        brandH: getCssVar(cssContent, "--label-medium-brandH", "10mm"),
        artSize: getCssVar(cssContent, "--label-medium-artSize", "10mm"),
        hintSize: getCssVar(cssContent, "--label-medium-hintSize", "4mm"),
      },
      large: {
        w: getCssVar(cssContent, "--label-large-w", "80mm"),
        h: getCssVar(cssContent, "--label-large-h", "48mm"),
        brandH: getCssVar(cssContent, "--label-large-brandH", "14mm"),
        artSize: getCssVar(cssContent, "--label-large-artSize", "14mm"),
        hintSize: getCssVar(cssContent, "--label-large-hintSize", "5mm"),
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
        const uniqueHints = [
          ...new Set(
            materialHints.map((h) => String(h).trim()).filter(Boolean),
          ),
        ].slice(0, 6); // Maximal 6 eindeutige Hinweise
        const artNrClass = num.length > 7 ? "artnr compact" : "artnr";

        // Brand-Logo: Soll in voller Breite gerendert werden
        const brandHtml = brandDataUrl
          ? `<img src="${brandDataUrl}" class="brand-logo" alt="GoldRegen" />`
          : `<div class="brand-text">GoldRegen Schmuckdesign</div>`;

        // Hinweise als zweispaltige Tabelle
        let hintsHtml = `<div class="empty-space"></div>`;
        if (uniqueHints.length > 0) {
          // Tabelle mit 2 Spalten, von oben links nach unten rechts auffüllen
          const rows = [];
          for (let i = 0; i < 3; i++) {
            const left = uniqueHints[i] ? `<td>${escapeHtml(uniqueHints[i])}</td>` : '<td></td>';
            const right = uniqueHints[i + 3] ? `<td>${escapeHtml(uniqueHints[i + 3])}</td>` : '<td></td>';
            rows.push(`<tr>${left}${right}</tr>`);
          }
          hintsHtml = `
            <div class="hints-container">
              <p style="font-weight: bold;">Material Hinweise</p>
              <table class="hints-table">
                <tbody>
                  ${rows.join("\n")}
                </tbody>
              </table>
            </div>
          `;
        }

        // Strukturiertes Layout nach Vorgabe
        // Wrapper: .label bleibt die page-box, .rot dreht den inneren Inhalt 90deg
        labelHtmlParts.push(`
          <div class="label">
            <div class="rot">
              <div class="logo-container">${brandHtml}</div>
              <div class="dotted-line"></div>
              <div class="${artNrClass}">${escapeHtml(num)}</div>
              ${hintsHtml}
              <div class="bottom-row">
                ${warnImgHtml}
                ${qrImgHtml}
              </div>
            </div>
          </div>
        `);
      }
    }

    // 5. Minimales Print-CSS
    const printCss = `
      @page { size: ${s.w} ${s.h}; margin: 0mm; }
      html, body {
        width: ${s.w};
        margin: 0;
        padding: 0;
        background: #fff;
        overflow: hidden;
      }
      body.etiketten-body {
        font-family: Arial, Helvetica, sans-serif;
        width: ${s.w};
      }
      /* Sheet auf Seitenhöhe bringen und Label vertikal zentrieren */
      :root {
        --label-w: ${s.w};
        --label-h: ${s.h};
        --brand-h: ${s.brandH};
        --art-size: ${s.artSize};
        --hint-size: ${s.hintSize};
        /* QR nur einmal zentral aus dem kleineren Etikettenmass ableiten */
        --qr-size: min(calc(var(--label-w) * 0.44), calc(var(--label-h) * 0.44));
      }
      .sheet {
        width: ${s.w};
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 0;
        padding: 0;
        margin: 0;
      }

      .label {
        box-sizing: border-box;
        width: ${s.w};
        height: ${s.h};
        display: flex;
        justify-content: center;
        align-items: center;
        border: none;
        box-shadow: none;
        margin: 0;
        page-break-after: always;
        break-after: page;
        overflow: hidden;
      }
      .label:last-child {
        page-break-after: auto;
        break-after: auto;
      }

      /* Innencontainer, der um 90° gedreht wird */
      .label .rot {
        transform: rotate(90deg);
        transform-origin: center center;
        width: ${s.h};
        height: ${s.w};
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        align-items: center;
        padding: 0.8mm 1.1mm;
        box-sizing: border-box;
        overflow: hidden;
      }

      /* 1. Logo: feste Höhe nach CSS-Variable, Inhalt skaliert sauber */
      .logo-container {
        width: 100%;
        flex: 0 0 calc(var(--brand-h) * 1);
        display: flex;
        justify-content: center;
        align-items: center;
        overflow: hidden;
      }
      .brand-logo {
        width: 100%;
        height: 100%;
        object-fit: contain;
        object-position: center;
        display: block;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .brand-text {
        text-align: center;
        font-weight: bold;
        font-size: calc(var(--brand-h) * 0.95);
        width: 100%;
        line-height: 1;
      }

      /* 2. Linie */
      .dotted-line {
        width: 100%;
        border-bottom: 1px dotted #000;
        margin: 1mm;
        flex-shrink: 0;
      }

      /* 3. Artikelnummer */
      .artnr {
        text-align: center;
        font-weight: bold;
        font-size: min(calc(var(--art-size) * 0.74), calc(var(--label-h) * 0.2));
        line-height: 1;
        letter-spacing: 0.1mm;
      }
      .artnr.compact {
        font-size: min(calc(var(--art-size) * 0.64), calc(var(--label-h) * 0.17));
        letter-spacing: 0.02mm;
      }

      /* 4. Zusatzinfos / Leerraum */
      .hints-container {
        width: 100%;
        text-align: center;
        font-size: calc(var(--hint-size) * 0.68);
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        justify-content: center;
        overflow: hidden;
        min-height: calc(var(--hint-size) * 2.6);
      }
      .hints-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }
      .hints-table td {
        width: 50%;
        text-align: left;
        padding: 0.2mm 0.5mm;
        font-weight: bold;
        font-size: calc(var(--hint-size) * 0.9);
        line-height: 1.1;
        word-break: break-word;
        vertical-align: top;
      }
      .empty-space {
        flex: 1 1 auto;
      }

      /* 5. GANZ UNTEN: QR Code und Warnhinweis */
      .bottom-row {
        width: 100%;
        display: flex;
        align-items: center;
        padding-top: 0.6mm;
      }
      .warn-symbol {
        height: auto;
        max-height: calc(var(--qr-size) * 1.0);
        width: auto;
        object-fit: contain;
        flex-shrink: 0;
      }
      .qr-img {
        width: calc(var(--qr-size) * 1.2);
        height: calc(var(--qr-size) * 1.2);
        object-fit: contain;
        flex-shrink: 0;
        box-sizing: border-box;
        image-rendering: auto;
        image-rendering: crisp-edges;
      }

      @media print {
        html, body {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
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
