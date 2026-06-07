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
const PRINT_CSS_TEMPLATE_PATH = path.resolve(
  __dirname,
  "../assets/etiketten-print.css",
);
const QR_TARGET_URL = "https://goldregenschmuckdesign.de";
const MAX_MATERIAL_HINTS = 6;
let printCssTemplateCache = null;

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

const getPrintCssTemplate = async () => {
  if (printCssTemplateCache != null) {
    return printCssTemplateCache;
  }

  const template = await readTextFileIfExists(PRINT_CSS_TEMPLATE_PATH);
  if (!template) {
    throw new Error("Etiketten CSS-Template nicht gefunden");
  }

  printCssTemplateCache = template;
  return printCssTemplateCache;
};

const replaceTemplateVars = (template, replacements) => {
  let css = template;
  for (const [key, value] of Object.entries(replacements)) {
    css = css.replaceAll(`{{${key}}}`, value);
  }
  return css;
};

const buildPrintCss = async (sizeConfig) => {
  const template = await getPrintCssTemplate();
  return replaceTemplateVars(template, {
    LABEL_W: sizeConfig.w,
    LABEL_H: sizeConfig.h,
    BRAND_H: sizeConfig.brandH,
    ART_SIZE: sizeConfig.artSize,
    HINT_SIZE: sizeConfig.hintSize,
  });
};

const buildPreviewHtml = async ({ sizeConfig, labelsMarkup }) => {
  const printCss = await buildPrintCss(sizeConfig);
  return `<!doctype html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Etiketten Vorschau</title>
      <style>${printCss}</style>
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
    const html = await buildPreviewHtml({ sizeConfig, labelsMarkup });

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
