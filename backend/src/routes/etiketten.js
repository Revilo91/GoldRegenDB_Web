const express = require("express");
const router = express.Router();
const db = require("../config/db");
const logger = require("../utils/logger");
const { where } = require("../utils/whereClauseBuilder");
const QRCode = require("qrcode");
const fs = require("fs").promises;
const path = require("path");

const FRONTEND_CSS_PATH = path.resolve(
  __dirname,
  "../../../frontend/src/index.css",
);
const WARN_SVG_PATH = path.resolve(__dirname, "../assets/warn_0-3.svg");
const BRAND_SVG_PATH = path.resolve(__dirname, "../assets/goldregen.svg");
const QR_TARGET_URL = "https://goldregenschmuckdesign.de";
const MAX_MATERIAL_HINTS = 6;

const LABEL_SIZE_DEFAULTS = {
  small: {
    w: "48mm",
    h: "30mm",
    brandH: "8mm",
    artSize: "8mm",
    hintSize: "3.5mm",
  },
  medium: {
    w: "60mm",
    h: "36mm",
    brandH: "10mm",
    artSize: "10mm",
    hintSize: "4mm",
  },
  large: {
    w: "80mm",
    h: "48mm",
    brandH: "14mm",
    artSize: "14mm",
    hintSize: "5mm",
  },
};

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

const readTextFileIfExists = async (filePath) => {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") {
      return null;
    }
    throw err;
  }
};

const toSvgDataUrl = (svgContent) => {
  return `data:image/svg+xml;base64,${Buffer.from(svgContent).toString("base64")}`;
};

const normalizeRequestedItems = (items) => {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => ({
      artikelnummer: String(item?.artikelnummer || "").trim(),
      qty: parseInt(item?.qty, 10) || 1,
    }))
    .filter((item) => item.artikelnummer);
};

const normalizeMaterialHints = (materialHints) => {
  if (!Array.isArray(materialHints)) {
    return [];
  }

  return [
    ...new Set(
      materialHints.map((hint) => String(hint).trim()).filter(Boolean),
    ),
  ].slice(0, MAX_MATERIAL_HINTS);
};

const fetchLabelDetail = async ({ artikelnummer, qty }) => {
  const { rows } = await db.query(
    `SELECT * FROM "Schmuckstück" WHERE "Artikelnummer" = $1 OR "Artikelnummer" LIKE $2 ORDER BY "Artikelnummer" LIMIT 1`,
    [artikelnummer, `${artikelnummer}\\_%`],
  );

  if (rows.length === 0) {
    return null;
  }

  return { row: rows[0], qty };
};

const fetchLabelDetails = async (items) => {
  const details = await Promise.all(items.map(fetchLabelDetail));
  return details.filter(Boolean);
};

const loadQrDataUrl = async () => {
  try {
    return await QRCode.toDataURL(QR_TARGET_URL, {
      errorCorrectionLevel: "Q",
      margin: 4,
      width: 1200,
      color: {
        dark: "#000000",
        light: "#FFFFFF",
      },
    });
  } catch (err) {
    logger.warn("ETIKETTEN", "QR-Code Fehler", {
      message: err.message,
    });
    return "";
  }
};

const loadSvgDataUrl = async (filePath, logMessage) => {
  try {
    const svgContent = await readTextFileIfExists(filePath);
    return svgContent ? toSvgDataUrl(svgContent) : "";
  } catch (err) {
    if (logMessage) {
      logger.warn("ETIKETTEN", logMessage, {
        message: err.message,
      });
    }
    return "";
  }
};

const loadPreviewAssets = async () => {
  const [qrDataUrl, warnDataUrl, brandDataUrl, cssContent] = await Promise.all([
    loadQrDataUrl(),
    loadSvgDataUrl(WARN_SVG_PATH),
    loadSvgDataUrl(BRAND_SVG_PATH, "Brand-Logo konnte nicht gelesen werden"),
    readTextFileIfExists(FRONTEND_CSS_PATH),
  ]);

  return {
    qrDataUrl,
    warnDataUrl,
    brandDataUrl,
    cssContent: cssContent || "",
  };
};

const getLabelSizes = (cssContent) => {
  return Object.fromEntries(
    Object.entries(LABEL_SIZE_DEFAULTS).map(([size, defaults]) => [
      size,
      {
        w: getCssVar(cssContent, `--label-${size}-w`, defaults.w),
        h: getCssVar(cssContent, `--label-${size}-h`, defaults.h),
        brandH: getCssVar(
          cssContent,
          `--label-${size}-brandH`,
          defaults.brandH,
        ),
        artSize: getCssVar(
          cssContent,
          `--label-${size}-artSize`,
          defaults.artSize,
        ),
        hintSize: getCssVar(
          cssContent,
          `--label-${size}-hintSize`,
          defaults.hintSize,
        ),
      },
    ]),
  );
};

const resolveLabelSize = (labelSize, cssContent) => {
  const sizes = getLabelSizes(cssContent);
  return sizes[String(labelSize || "small")] || sizes.small;
};

const buildBrandHtml = (brandDataUrl) => {
  return brandDataUrl
    ? `<img src="${brandDataUrl}" class="brand-logo" alt="GoldRegen" />`
    : '<div class="brand-text">GoldRegen Schmuckdesign</div>';
};

const buildHintsHtml = (materialHints) => {
  if (materialHints.length === 0) {
    return '<div class="empty-space"></div>';
  }

  const rows = [];
  for (let index = 0; index < 3; index++) {
    const left = materialHints[index]
      ? `<td>${escapeHtml(materialHints[index])}</td>`
      : "<td></td>";
    const right = materialHints[index + 3]
      ? `<td>${escapeHtml(materialHints[index + 3])}</td>`
      : "<td></td>";
    rows.push(`<tr>${left}${right}</tr>`);
  }

  return `
    <div class="hints-container">
      <p class="hints-title">Material Hinweise</p>
      <table class="hints-table">
        <tbody>
          ${rows.join("\n")}
        </tbody>
      </table>
    </div>
  `;
};

const buildWarnImgHtml = (warnDataUrl) => {
  return warnDataUrl
    ? `<img src="${warnDataUrl}" class="warn-symbol" alt="Warnung" />`
    : '<img src="/api/etiketten/warn.svg" class="warn-symbol" alt="Warnung" />';
};

const buildQrImgHtml = (qrDataUrl) => {
  return qrDataUrl ? `<img src="${qrDataUrl}" alt="QR" class="qr-img" />` : "";
};

const buildLabelMarkup = ({ row, qty }, templateData) => {
  const articleNumber = String(row.Artikelnummer || "").split("_")[0];
  const artNrClass = articleNumber.length > 7 ? "artnr compact" : "artnr";
  const labels = [];

  for (let index = 0; index < qty; index++) {
    labels.push(`
      <div class="label">
        <div class="rot">
          <div class="logo-container">${templateData.brandHtml}</div>
          <div class="dotted-line"></div>
          <div class="${artNrClass}">${escapeHtml(articleNumber)}</div>
          ${templateData.hintsHtml}
          <div class="bottom-row">
            ${templateData.warnImgHtml}
            ${templateData.qrImgHtml}
          </div>
        </div>
      </div>
    `);
  }

  return labels.join("\n");
};

const buildLabelsMarkup = (details, templateData) => {
  return details
    .map((detail) => buildLabelMarkup(detail, templateData))
    .join("\n");
};

const buildPrintCss = (sizeConfig) => {
  return `
    @page { size: ${sizeConfig.w} ${sizeConfig.h}; margin: 0mm; }
    html, body {
      width: ${sizeConfig.w};
      margin: 0;
      padding: 0;
      background: #fff;
      overflow: hidden;
    }
    body.etiketten-body {
      font-family: Arial, Helvetica, sans-serif;
      width: ${sizeConfig.w};
    }
    :root {
      --label-w: ${sizeConfig.w};
      --label-h: ${sizeConfig.h};
      --brand-h: ${sizeConfig.brandH};
      --art-size: ${sizeConfig.artSize};
      --hint-size: ${sizeConfig.hintSize};
      --qr-size: min(calc(var(--label-w) * 0.44), calc(var(--label-h) * 0.44));
    }
    .sheet {
      width: ${sizeConfig.w};
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 0;
      padding: 0;
      margin: 0;
    }

    .label {
      box-sizing: border-box;
      width: ${sizeConfig.w};
      height: ${sizeConfig.h};
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

    .label .rot {
      transform: rotate(90deg);
      transform-origin: center center;
      width: ${sizeConfig.h};
      height: ${sizeConfig.w};
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
      align-items: center;
      padding: 0.8mm 1.1mm;
      box-sizing: border-box;
      overflow: hidden;
    }

    .logo-container {
      width: 100%;
      margin: 0.5em 0;
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

    .dotted-line {
      width: 100%;
      border-bottom: 1px dotted #000;
      margin: 1mm;
      flex-shrink: 0;
    }

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

    .hints-container {
      width: 100%;
      flex: 1 1 auto;
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
      text-align: center;
      font-size: calc(var(--hint-size) * 0.68);
    }
    .hints-title {
      margin: 0.5mm 0 0.3mm;
      font-weight: 600;
      font-size: calc(var(--hint-size) * 0.68);
      line-height: 1;
    }
    .hints-table {
      margin: 0.4mm 0.2em 0.3mm;
      border-collapse: collapse;
    }
    .hints-table td {
      width: 50%;
      text-align: left;
      font-size: calc(var(--hint-size) * 0.68);
      line-height: 1.1;
      font-weight: 400;
      vertical-align: top;
      padding: 0.2mm 0;
    }
    .empty-space {
      flex: 1 1 auto;
    }

    .bottom-row {
      width: 100%;
      display: flex;
      align-items: center;
      margin-top: auto;
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
};

const buildPreviewHtml = ({ sizeConfig, labelsMarkup }) => {
  return `<!doctype html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Etiketten Vorschau</title>
      <style>${buildPrintCss(sizeConfig)}</style>
    </head>
    <body class="etiketten-body">
      <div class="sheet">
        ${labelsMarkup}
      </div>
      <script>window.onload = function(){ window.focus(); };</script>
    </body>
    </html>`;
};

const sendTextFile = async (res, filePath, contentType, notFoundResponse) => {
  try {
    const content = await readTextFileIfExists(filePath);
    if (content == null) {
      return res.status(404).send(notFoundResponse);
    }
    res.set("Content-Type", contentType);
    return res.send(content);
  } catch (err) {
    return res.status(500).send(notFoundResponse === "" ? "" : "/* error */");
  }
};

// --- GET OPTIONS ---
// Liefert Liste eindeutiger Basis-Artikelnummern für Dropdowns
router.get("/options", async (req, res) => {
  try {
    const q = String(req.query.q || "")
      .trim()
      .toUpperCase();
    const parsedLimit = Number.parseInt(String(req.query.limit || ""), 10);
    const limit = Number.isFinite(parsedLimit)
      ? Math.max(10, Math.min(parsedLimit, 500))
      : 200;

    const builder = where();
    builder.verfuegbar();
    if (q) {
      builder.conditions.push(
        `(split_part("Artikelnummer", '_', 1) ILIKE $${builder.paramIdx} OR COALESCE("Name", '') ILIKE $${builder.paramIdx + 1})`,
      );
      builder.params.push(`%${q}%`, `%${q}%`);
      builder.paramIdx += 2;
    }

    const limitParam = builder.paramIdx;

    const query = `
      SELECT split_part("Artikelnummer", '_', 1) AS artikel_base,
             MIN("Name") AS name
      FROM "Schmuckstück"
      ${builder.build()}
      GROUP BY artikel_base
      ORDER BY artikel_base
      LIMIT $${limitParam}
    `;

    const { rows } = await db.query(query, [...builder.getParams(), limit]);
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
    const items = normalizeRequestedItems(req.body.items);
    if (items.length === 0) {
      return res.status(400).json({ error: "Keine Artikel übergeben" });
    }

    const materialHints = normalizeMaterialHints(req.body.materialHints);
    const details = await fetchLabelDetails(items);
    const assets = await loadPreviewAssets();
    const sizeConfig = resolveLabelSize(req.body.labelSize, assets.cssContent);
    const labelsMarkup = buildLabelsMarkup(details, {
      brandHtml: buildBrandHtml(assets.brandDataUrl),
      hintsHtml: buildHintsHtml(materialHints),
      warnImgHtml: buildWarnImgHtml(assets.warnDataUrl),
      qrImgHtml: buildQrImgHtml(assets.qrDataUrl),
    });
    const html = buildPreviewHtml({ sizeConfig, labelsMarkup });

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
  return sendTextFile(
    res,
    FRONTEND_CSS_PATH,
    "text/css; charset=utf-8",
    "/* not found */",
  );
});

// --- GET WARN SVG ---
router.get("/warn.svg", async (req, res) => {
  return sendTextFile(res, WARN_SVG_PATH, "image/svg+xml; charset=utf-8", "");
});

module.exports = router;
