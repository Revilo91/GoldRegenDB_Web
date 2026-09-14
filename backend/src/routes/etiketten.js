const express = require("express");
const router = express.Router();
const db = require("../config/db");
const logger = require("../utils/logger");
const { where } = require("../utils/whereClauseBuilder");
const QRCode = require("qrcode");
const fs = require("fs").promises;
const path = require("path");

const WARN_SVG_PATH = path.resolve(__dirname, "../assets/warn_0-3.svg");
const BRAND_SVG_PATH = path.resolve(__dirname, "../assets/goldregen.svg");
const PRINT_CSS_PATH = path.resolve(__dirname, "../assets/etiketten-print.css");
const QR_TARGET_URL = "https://goldregenschmuckdesign.de";
const MAX_MATERIAL_HINTS = 6;
const SAMPLE_ARTIKELNUMMER = "GR12345";

/**
 * Einzige Quelle für Etikettengrößen – das Frontend lädt sie über GET /sizes,
 * damit eine neue Größe nur hier eingetragen werden muss.
 *
 * w/h      physische Etikettmaße in mm (Querformat, wie im Drucker eingelegt)
 * rotate   Inhalt wird 90° gedreht gedruckt (Hängeetikett an der Schmuckkarte)
 * showQr   QR-Code nur, wenn das Etikett groß genug zum Scannen ist
 * brandH   Höhe des Logobereichs, artSize/hintSize Schriftgrößen – alles in mm
 */
const LABEL_SIZES = {
  small: {
    id: "small",
    name: "Klein",
    w: 30,
    h: 20,
    rotate: false,
    showQr: false,
    brandH: 4,
    artSize: 5,
    hintSize: 2.2,
  },
  large: {
    id: "large",
    name: "Groß",
    w: 40,
    h: 30,
    rotate: true,
    showQr: true,
    brandH: 8,
    artSize: 8,
    hintSize: 3.5,
  },
};
const DEFAULT_LABEL_SIZE = "small";

// Logo, Warnsymbol, QR-Code und CSS-Template ändern sich zur Laufzeit nicht
let printCssTemplateCache = null;
let previewAssetsCache = null;

const escapeHtml = (str) => {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

const readTextFileIfExists = async (filePath) => {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
};

const toSvgDataUrl = (svgContent) =>
  `data:image/svg+xml;base64,${Buffer.from(svgContent).toString("base64")}`;

const resolveLabelSize = (labelSize) =>
  LABEL_SIZES[String(labelSize || "").trim()] || LABEL_SIZES[DEFAULT_LABEL_SIZE];

const normalizeRequestedItems = (items) => {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      artikelnummer: String(item?.artikelnummer || "").trim(),
      qty: Math.max(1, parseInt(item?.qty, 10) || 1),
    }))
    .filter((item) => item.artikelnummer);
};

const normalizeMaterialHints = (materialHints) => {
  if (!Array.isArray(materialHints)) return [];
  return [
    ...new Set(materialHints.map((hint) => String(hint).trim()).filter(Boolean)),
  ].slice(0, MAX_MATERIAL_HINTS);
};

const fetchLabelDetail = async ({ artikelnummer, qty }) => {
  const { rows } = await db.query(
    `SELECT * FROM "Schmuckstück" WHERE "Artikelnummer" = $1 OR "Artikelnummer" LIKE $2 ORDER BY "Artikelnummer" LIMIT 1`,
    [artikelnummer, `${artikelnummer}\\_%`],
  );
  return rows.length === 0 ? null : { row: rows[0], qty };
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
      color: { dark: "#000000", light: "#FFFFFF" },
    });
  } catch (err) {
    logger.warn("ETIKETTEN", "QR-Code Fehler", { message: err.message });
    return "";
  }
};

const loadSvgDataUrl = async (filePath, logMessage) => {
  try {
    const svgContent = await readTextFileIfExists(filePath);
    return svgContent ? toSvgDataUrl(svgContent) : "";
  } catch (err) {
    if (logMessage) {
      logger.warn("ETIKETTEN", logMessage, { message: err.message });
    }
    return "";
  }
};

const loadPreviewAssets = async () => {
  if (previewAssetsCache) return previewAssetsCache;

  const [qrDataUrl, warnDataUrl, brandDataUrl] = await Promise.all([
    loadQrDataUrl(),
    loadSvgDataUrl(WARN_SVG_PATH),
    loadSvgDataUrl(BRAND_SVG_PATH, "Brand-Logo konnte nicht gelesen werden"),
  ]);

  previewAssetsCache = { qrDataUrl, warnDataUrl, brandDataUrl };
  return previewAssetsCache;
};

const buildBrandHtml = (brandDataUrl) =>
  brandDataUrl
    ? `<img src="${brandDataUrl}" class="brand-logo" alt="GoldRegen" />`
    : '<div class="brand-text">GoldRegen Schmuckdesign</div>';

const buildHintsHtml = (materialHints) => {
  if (materialHints.length === 0) return '<div class="empty-space"></div>';

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

  return `<div class="hints-container">
      <p class="hints-title">Material Hinweise</p>
      <table class="hints-table"><tbody>${rows.join("")}</tbody></table>
    </div>`;
};

const buildWarnImgHtml = (warnDataUrl) =>
  warnDataUrl
    ? `<img src="${warnDataUrl}" class="warn-symbol" alt="Warnung" />`
    : '<img src="/api/etiketten/warn.svg" class="warn-symbol" alt="Warnung" />';

const buildQrImgHtml = (qrDataUrl) =>
  qrDataUrl ? `<img src="${qrDataUrl}" alt="QR" class="qr-img" />` : "";

const buildLabelMarkup = (artikelnummer, sizeConfig, parts) => {
  const artNrClass = artikelnummer.length > 7 ? "artnr compact" : "artnr";
  const labelClass = sizeConfig.rotate ? "label label--rotated" : "label";
  const bottomRowClass = parts.qrImgHtml
    ? "bottom-row"
    : "bottom-row bottom-row--no-qr";

  return `<div class="${labelClass}">
      <div class="label-content">
        <div class="logo-container">${parts.brandHtml}</div>
        <div class="dotted-line"></div>
        <div class="${artNrClass}">${escapeHtml(artikelnummer)}</div>
        ${parts.hintsHtml}
        <div class="${bottomRowClass}">${parts.warnImgHtml}${parts.qrImgHtml}</div>
      </div>
    </div>`;
};

// Basis-Artikelnummer: "GR12345_3" -> "GR12345"
const baseArtikelnummer = (value) => String(value || "").split("_")[0];

const buildLabelsMarkup = (details, sizeConfig, parts) =>
  details
    .flatMap(({ row, qty }) =>
      Array.from({ length: qty }, () =>
        buildLabelMarkup(baseArtikelnummer(row.Artikelnummer), sizeConfig, parts),
      ),
    )
    .join("");

const getPrintCssTemplate = async () => {
  if (printCssTemplateCache != null) return printCssTemplateCache;

  const template = await readTextFileIfExists(PRINT_CSS_PATH);
  if (!template) throw new Error("Etiketten CSS-Template nicht gefunden");

  printCssTemplateCache = template;
  return printCssTemplateCache;
};

const buildPrintCss = async (sizeConfig) => {
  const template = await getPrintCssTemplate();
  // Gedrehte Etiketten werden in einer um 90° getauschten Inhaltsbox gesetzt
  const replacements = {
    LABEL_W: sizeConfig.w,
    LABEL_H: sizeConfig.h,
    CONTENT_W: sizeConfig.rotate ? sizeConfig.h : sizeConfig.w,
    CONTENT_H: sizeConfig.rotate ? sizeConfig.w : sizeConfig.h,
    BRAND_H: sizeConfig.brandH,
    ART_SIZE: sizeConfig.artSize,
    HINT_SIZE: sizeConfig.hintSize,
  };

  return Object.entries(replacements).reduce(
    (css, [key, value]) => css.replaceAll(`{{${key}}}`, value),
    template,
  );
};

// Skaliert das Etikett in der Vorschau auf die Fläche des iframes und schaltet
// per postMessage auf Originalgröße (1:1) um.
const PREVIEW_SCRIPT = `
(function () {
  var label = document.querySelector('.label');
  if (!label) return;
  var actualSize = false;
  function apply() {
    var scale = 1;
    if (!actualSize) {
      var available = Math.min(
        (window.innerWidth - 24) / label.offsetWidth,
        (window.innerHeight - 24) / label.offsetHeight,
      );
      scale = Math.max(0.4, Math.min(available, 8));
    }
    document.documentElement.style.setProperty('--preview-scale', scale);
    parent.postMessage({ type: 'etikett-scale', scale: scale }, '*');
  }
  window.addEventListener('resize', apply);
  window.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'etikett-size-mode') {
      actualSize = event.data.mode === 'actual';
      apply();
    }
  });
  apply();
})();`;

const buildDocument = ({ printCss, labelsMarkup, mode }) => {
  const bodyScript =
    mode === "single"
      ? `<script>${PREVIEW_SCRIPT}</script>`
      : "<script>window.onload = function(){ window.focus(); };</script>";

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>Etiketten</title>
<style>${printCss}</style>
</head>
<body class="etiketten-body mode-${mode}">
${labelsMarkup}
${bodyScript}
</body>
</html>`;
};

// --- GET SIZES ---
// Etikettengrößen für die Auswahl im Frontend
router.get("/sizes", (req, res) => {
  res.json({
    defaultSize: DEFAULT_LABEL_SIZE,
    sizes: Object.values(LABEL_SIZES).map(({ id, name, w, h, rotate, showQr }) => ({
      id,
      name,
      w,
      h,
      rotate,
      showQr,
    })),
  });
});

// --- GET OPTIONS ---
// Liefert Liste eindeutiger Basis-Artikelnummern für die Artikelauswahl
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
    res.json(rows.map((r) => ({ artikelnummer: r.artikel_base, name: r.name })));
  } catch (err) {
    logger.error("ETIKETTEN", "Fehler beim Laden der Etiketten-Optionen", {
      message: err.message,
    });
    res.status(500).json({ error: "Fehler beim Laden der Etiketten-Optionen" });
  }
});

// --- POST PREVIEW ---
// mode "print"  -> alle Etiketten, je eines pro Druckseite
// mode "single" -> genau ein Etikett für die maßstabsgetreue Vorschau im iframe
router.post("/preview", async (req, res) => {
  try {
    const mode = req.body.mode === "single" ? "single" : "print";
    const requested = normalizeRequestedItems(req.body.items);

    if (mode === "print" && requested.length === 0) {
      return res.status(400).json({ error: "Keine Artikel übergeben" });
    }

    // Die Vorschau zeigt genau ein Etikett, unabhängig von der Stückzahl
    const items =
      mode === "single"
        ? requested.slice(0, 1).map((item) => ({ ...item, qty: 1 }))
        : requested;
    const materialHints = normalizeMaterialHints(req.body.materialHints);
    const sizeConfig = resolveLabelSize(req.body.labelSize);
    const assets = await loadPreviewAssets();
    const parts = {
      brandHtml: buildBrandHtml(assets.brandDataUrl),
      hintsHtml: buildHintsHtml(materialHints),
      warnImgHtml: buildWarnImgHtml(assets.warnDataUrl),
      qrImgHtml: sizeConfig.showQr ? buildQrImgHtml(assets.qrDataUrl) : "",
    };

    const details = await fetchLabelDetails(items);
    let labelsMarkup = buildLabelsMarkup(details, sizeConfig, parts);

    // Ohne Auswahl zeigt die Vorschau ein Musteretikett, damit Größe und
    // Materialhinweise vorab beurteilt werden können.
    if (!labelsMarkup && mode === "single") {
      labelsMarkup = buildLabelMarkup(SAMPLE_ARTIKELNUMMER, sizeConfig, parts);
    }

    if (!labelsMarkup) {
      return res
        .status(404)
        .json({ error: "Keine der angegebenen Artikelnummern gefunden" });
    }

    const printCss = await buildPrintCss(sizeConfig);

    res.set("Content-Type", "text/html; charset=utf-8");
    res.send(buildDocument({ printCss, labelsMarkup, mode }));
  } catch (err) {
    logger.error("ETIKETTEN", "Fehler beim Erzeugen der Vorschau", {
      message: err.message,
    });
    res.status(500).json({ error: "Fehler beim Erzeugen der Etiketten-Vorschau" });
  }
});

// --- GET WARN SVG ---
router.get("/warn.svg", async (req, res) => {
  try {
    const content = await readTextFileIfExists(WARN_SVG_PATH);
    if (content == null) return res.status(404).send("");
    res.set("Content-Type", "image/svg+xml; charset=utf-8");
    return res.send(content);
  } catch (err) {
    logger.error("ETIKETTEN", "Warnsymbol konnte nicht gelesen werden", {
      message: err.message,
    });
    return res.status(500).send("");
  }
});

module.exports = router;
