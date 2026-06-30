const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");
const sizeOf = require("image-size");
const { GRUNDMATERIAL } = require("./constants");

const DEFAULT_LOGO_PATH = path.join(
  __dirname,
  "../assets/Logo trasparent weißer Kreis.png",
);

const CONTACTS = {
  GOLDREGEN: {
    company: "Goldregen Schmuckdesign",
    name: "Marina Südholt",
    mobile: "0152 22731186",
    email: "goldregen.schmuckdesign@gmail.com",
    website: "www.goldregenschmuckdesign.de",
    bank: "UniCredit Bank AG\nDE51 7502 0073 0029 2620 20\nHYVEDEMM447",
  },
  TCS: {
    company: "TechCraft Südholt",
    name: "Oliver Südholt",
    mobile: "0151 21832342",
    email: "techcraftsuedholt@gmail.com",
    website: "",
    bank: "UniCredit Bank AG\nDE51 7502 0073 0029 2620 20\nHYVEDEMM447",
  },
};

const BUSINESS_ADDRESS = "Herzogin-Ludmilla-Ring 5 • 84085 Langquaid";

const INVENTUR_COLUMNS = [
  { header: "Artikelnummer", key: "Artikelnummer", width: 18 },
  { header: "Name", key: "Name", width: 25 },
  { header: "Art", key: "Art", width: 16 },
  { header: "Farbe", key: "Farbe", width: 16 },
  { header: "Material", key: "Material", width: 16 },
  { header: "Verkaufspreis", key: "Verkaufspreis", width: 16 },
  { header: "Erstelldatum", key: "Erstelldatum", width: 16 },
];

const THIN_BORDER = {
  top: { style: "thin", color: { argb: "FFBCBCBC" } },
  left: { style: "thin", color: { argb: "FFBCBCBC" } },
  bottom: { style: "thin", color: { argb: "FFBCBCBC" } },
  right: { style: "thin", color: { argb: "FFBCBCBC" } },
};

function formatCell(cell, options = {}) {
  cell.font = {
    name: options.fontName || "Calibri",
    size: options.fontSize || 10,
    bold: !!options.bold,
    color: options.fontColor ? { argb: options.fontColor } : undefined,
  };

  if (options.border !== false) {
    cell.border = options.border || THIN_BORDER;
  }

  if (options.fillColor) {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: options.fillColor },
    };
  }

  if (options.alignment) {
    cell.alignment = options.alignment;
  }

  if (options.numFmt) {
    cell.numFmt = options.numFmt;
  }
}

function addInventurSheet(
  workbook,
  sheetName,
  sheetItems,
  accentArgb,
  kunde,
  today,
) {
  const ws = workbook.addWorksheet(sheetName);
  ws.pageSetup.paperSize = 9;
  ws.pageSetup.orientation = "landscape";
  ws.pageSetup.fitToPage = true;
  ws.pageSetup.fitToWidth = 1;
  ws.pageSetup.fitToHeight = 0;

  // Title rows
  ws.mergeCells("A1:G1");
  const titleCell = ws.getCell("A1");
  titleCell.value = `Inventur – ${kunde.Name}`;
  titleCell.font = { name: "Calibri", bold: true, size: 14 };
  titleCell.alignment = { horizontal: "left" };

  ws.mergeCells("A2:G2");
  const subCell = ws.getCell("A2");
  subCell.value = `${sheetName}  •  Stand: ${today}  •  ${sheetItems.length} Artikel`;
  subCell.font = { name: "Calibri", size: 10, color: { argb: "FF6B7280" } };

  ws.addRow([]); // spacer

  // Column headers
  ws.columns = INVENTUR_COLUMNS;
  const headerRow = ws.addRow(INVENTUR_COLUMNS.map((c) => c.header));
  headerRow.eachCell((cell) => {
    formatCell(cell, {
      bold: true,
      fillColor: accentArgb,
      alignment: { horizontal: "center", vertical: "middle" },
    });
  });

  // Data rows
  let totalValue = 0;
  sheetItems.forEach((item) => {
    const price = Number(item.Verkaufspreis) || 0;
    totalValue += price;
    const row = ws.addRow([
      item.Artikelnummer,
      item.Name || "",
      item.Art || "",
      item.Farbe || "",
      item.Material || "",
      price,
      item.Erstelldatum
        ? new Date(item.Erstelldatum).toLocaleDateString("de-DE")
        : "",
    ]);
    row.getCell(6).numFmt = "#,##0.00 €";
    row.eachCell((cell) => {
      formatCell(cell);
    });
  });

  // Totals row
  ws.addRow([]);
  const totalRow = ws.addRow(["", "", "", "", "Gesamtwert:", totalValue, ""]);
  formatCell(totalRow.getCell(5), { bold: true });
  formatCell(totalRow.getCell(6), { bold: true, numFmt: "#,##0.00 €" });

  // Re-apply column widths
  autoFitColumns(ws);
}

/**
 * Auto-fit columns based on content with support for merged cells
 * Scans all cells and sets optimal width between min and max values
 */
function autoFitColumns(worksheet) {
  const columnWidths = {};

  // Process all rows to calculate required widths
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      if (!cell.value) return;

      const cellValue = cell.value.toString();
      const length = cellValue.length;

      // Check if this is a master cell (start of a merge)
      if (cell.isMerged && cell.master) {
        // This cell is part of a merge, check if it's the master
        if (cell.master.address === cell.address) {
          // This is the master cell - calculate the merge range
          const masterRow = cell.master.row;
          const masterCol = cell.master.col;

          // Find how many columns this merge spans
          let mergeWidth = 1;
          for (let col = masterCol + 1; col <= worksheet.columnCount; col++) {
            const nextCell = worksheet.getCell(masterRow, col);
            if (
              nextCell.isMerged &&
              nextCell.master &&
              nextCell.master.address === cell.address
            ) {
              mergeWidth++;
            } else {
              break;
            }
          }

          // Distribute width across merged columns
          const widthPerColumn = length / mergeWidth;
          for (let col = masterCol; col < masterCol + mergeWidth; col++) {
            columnWidths[col] = Math.max(
              columnWidths[col] || 0,
              widthPerColumn,
            );
          }
        }
        // Skip non-master merged cells
      } else {
        // Regular cell (not merged)
        columnWidths[colNumber] = Math.max(
          columnWidths[colNumber] || 0,
          length,
        );
      }
    });
  });

  // Apply calculated widths with minimal padding for tight columns
  worksheet.columns.forEach((column, index) => {
    const colNumber = index + 1;
    // Respect explicit widths already set on the column (e.g., from cm-based config)
    if (column && column.width) {
      return;
    }

    if (columnWidths[colNumber]) {
      // Minimal padding (1) and limit between 5 and 50 for tight fit
      column.width = Math.min(Math.max(columnWidths[colNumber] + 1, 5), 50);
    } else {
      // Minimal default width if no content found
      column.width = 5;
    }
  });
}

async function generateExcel(type, data, logoPath) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(type);

  // Set default font
  workbook.defaultFont = { name: "Calibri", size: 10 };
  worksheet.font = { name: "Calibri", size: 10 };

  const contact = CONTACTS.GOLDREGEN; // Default to Marina/GoldRegen

  // Helper: convert centimeters to Excel column width (approx.)
  // Calibration: adjust if Excel shows different cm than expected
  // If your exported sheet shows wider columns than requested, reduce this (e.g. 0.9)
  const CM_WIDTH_CALIBRATION = 0.9;

  const cmToExcelWidth = (cm) => {
    // 1 cm ≈ 37.7952755906 pixels at 96 DPI
    const pixelsPerCm = 37.7952755906;
    // Apply calibration to account for Excel rendering differences
    const pixels = cm * pixelsPerCm * CM_WIDTH_CALIBRATION;
    // Excel column width (approx): width = (pixels - 5) / 7
    const width = (pixels - 5) / 7;
    return Math.max(width, 1);
  };
  // Setup column widths optimized for table structure
  // Columns C-F are merged for "Bezeichnung", so they share space
  // Specify desired column widths in centimeters here (adjust as needed)
  const colWidthsCm = [
    2.05, // A - Artikelnr. (cm)
    2.08, // B - Kategorie (cm)
    2.26, // C - Bezeichnung (merged C:F) (cm)
    2.26, // D - Bezeichnung (merged C:F) (cm)
    2.26, // E - Bezeichnung (merged C:F) (cm)
    2.26, // F - Bezeichnung (merged C:F) (cm)
    2.46, // G - Menge (cm)
    2.21, // H - Einzelpreis (cm)
    2.54, // I - Gesamtpreis (cm)
  ];

  worksheet.columns = colWidthsCm.map((cm) => ({ width: cmToExcelWidth(cm) }));

  // Page setup for A4 print layout
  worksheet.pageSetup.paperSize = 9; // A4
  worksheet.pageSetup.orientation = "portrait";
  worksheet.pageSetup.fitToPage = true;
  worksheet.pageSetup.fitToHeight = 0;
  worksheet.pageSetup.fitToWidth = 1;
  worksheet.pageSetup.margins = {
    left: 0.7,
    right: 0.7,
    top: 0.75,
    bottom: 1.2, // Erhöht von 0.75 für mehr Platz für die Fußzeile
    header: 0.3,
    footer: 0.3,
  };

  // Add logo
  const resolvedLogoPath =
    logoPath && fs.existsSync(logoPath) ? logoPath : DEFAULT_LOGO_PATH;

  if (resolvedLogoPath && fs.existsSync(resolvedLogoPath)) {
    try {
      const dimensions = sizeOf(resolvedLogoPath);
      const scaleFactor = 0.1;

      const imageId = workbook.addImage({
        filename: resolvedLogoPath,
        extension: "png",
      });

      worksheet.addImage(imageId, {
        tl: { col: 5, row: 0 },
        ext: {
          width: dimensions.width * scaleFactor,
          height: dimensions.height * scaleFactor,
        },
        editAs: "oneCell",
      });
    } catch (err) {
      console.error("Fehler beim Laden des Logos:", err.message);
    }
  }

  // 1. Header with Address Line
  const headerRow = 9; // Line 8 in Python (0-indexed here)
  worksheet.mergeCells(`A${headerRow}:E${headerRow}`);
  const headerCell = worksheet.getCell(`A${headerRow}`);
  headerCell.value = `${contact.name} • ${BUSINESS_ADDRESS}`;
  headerCell.font = { name: "Calibri", size: 8 };
  headerCell.alignment = { horizontal: "left", vertical: "bottom" };
  headerCell.border = { bottom: { style: "thin" } };

  // 2. Customer Address Block
  let currentRow = 11;
  const address = [
    data.kunde.Name,
    `${data.kunde.Strasse} ${data.kunde.Hausnummer || ""}`,
    `${data.kunde.PLZ || ""} ${data.kunde.Ort || ""}`,
  ];
  address.forEach((line) => {
    if (line && line.trim()) {
      worksheet.mergeCells(`A${currentRow}:F${currentRow}`);
      worksheet.getCell(`A${currentRow}`).value = line;
      worksheet.getCell(`A${currentRow}`).font = { name: "Calibri", size: 10 };
      currentRow++;
    }
  });

  // 3. Info Block
  currentRow += 2;
  const titleRow = currentRow;
  worksheet.mergeCells(`A${titleRow}:C${titleRow}`);
  const titleCell = worksheet.getCell(`A${titleRow}`);
  titleCell.value = type;
  titleCell.font = { name: "Calibri", bold: true, size: 20 };

  currentRow += 2;
  const infoLabelRow = currentRow;
  worksheet.mergeCells(`A${infoLabelRow}:B${infoLabelRow}`);
  worksheet.getCell(`A${infoLabelRow}`).value = `${type} Nr.`;
  worksheet.getCell(`A${infoLabelRow}`).font = { name: "Calibri", size: 10 };

  if (type === "Lieferschein") {
    worksheet.mergeCells(`D${infoLabelRow}:E${infoLabelRow}`);
    worksheet.getCell(`D${infoLabelRow}`).value = "Lieferdatum";
    worksheet.getCell(`D${infoLabelRow}`).font = { name: "Calibri", size: 10 };
  }

  worksheet.mergeCells(`G${infoLabelRow}:H${infoLabelRow}`);
  worksheet.getCell(`G${infoLabelRow}`).value = "Datum";
  worksheet.getCell(`G${infoLabelRow}`).font = { name: "Calibri", size: 10 };

  currentRow++;
  const infoValueRow = currentRow;
  worksheet.mergeCells(`A${infoValueRow}:B${infoValueRow}`);
  worksheet.getCell(`A${infoValueRow}`).value = data.Nummer;
  worksheet.getCell(`A${infoValueRow}`).font = { name: "Calibri", size: 10 };

  const datum = new Date(data.Datum).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  worksheet.mergeCells(`D${infoValueRow}:E${infoValueRow}`);
  if (type === "Lieferschein") {
    worksheet.getCell(`D${infoValueRow}`).value = datum;
    worksheet.getCell(`D${infoValueRow}`).font = { name: "Calibri", size: 10 };
  }

  worksheet.mergeCells(`G${infoValueRow}:H${infoValueRow}`);
  worksheet.getCell(`G${infoValueRow}`).value = datum;
  worksheet.getCell(`G${infoValueRow}`).font = { name: "Calibri", size: 10 };

  currentRow++;
  const separatorRow = currentRow;
  worksheet.mergeCells(`A${separatorRow}:I${separatorRow}`);
  worksheet.getCell(`A${separatorRow}`).border = {
    top: { style: "thin", color: { argb: "FFBCBCBC" } },
  };

  currentRow++;
  const textRow = currentRow;
  worksheet.mergeCells(`A${textRow}:I${textRow}`);
  if (type === "Lieferschein") {
    worksheet.getCell(`A${textRow}`).value =
      "Wir liefern Ihnen, wie vereinbart folgende Artikel:";
  } else {
    const rechnungsZeitraum = data.rechungsZeitraum || "xx.xx.xxxx";
    worksheet.getCell(`A${textRow}`).value =
      `Für die verkauften Artikel im Zeitraum vom ${rechnungsZeitraum} stellen wir Ihnen folgende Positionen in Rechnung:`;
  }
  worksheet.getCell(`A${textRow}`).font = { name: "Calibri", size: 10 };

  // 4. Article Block
  currentRow += 1;
  const tableHeaderStartRow = currentRow;

  // Function to write table headers
  const writeTableHeaders = (headerRow) => {
    const headers = [
      "Artikelnr.",
      "Kategorie",
      "Bezeichnung",
      "",
      "",
      "",
      "Menge",
      "Einzelpreis",
      "Gesamtpreis",
    ];

    // Formatiere ALLE 9 Spalten mit Border
    for (let i = 1; i <= 9; i++) {
      const cell = worksheet.getRow(headerRow).getCell(i);
      const headerText = headers[i - 1];

      if (headerText) {
        cell.value = headerText;
      }
      formatCell(cell, {
        bold: true,
        fillColor: "FFF2F2F2",
        alignment: headerText
          ? { horizontal: "center", vertical: "center" }
          : undefined,
      });
    }

    // Merge Cells für "Bezeichnung" (C-F)
    worksheet.mergeCells(`C${headerRow}:F${headerRow}`);
  };

  // Write first header
  writeTableHeaders(tableHeaderStartRow);
  currentRow++;

  // Set print titles so header repeats on each page
  worksheet.pageSetup.printTitlesRow = `${tableHeaderStartRow}:${tableHeaderStartRow}`;

  // Article loop
  const articleCounts = {};
  data.schmuckstuecke.forEach((s) => {
    const artikelnummerBasis = (s.Artikelnummer || "").split("_")[0];
    articleCounts[artikelnummerBasis] =
      (articleCounts[artikelnummerBasis] || 0) + 1;
  });

  const processedArticles = new Set();
  data.schmuckstuecke.forEach((s) => {
    const artikelnummerBasis = (s.Artikelnummer || "").split("_")[0];
    if (processedArticles.has(artikelnummerBasis)) {
      return;
    }
    processedArticles.add(artikelnummerBasis);

    const row = worksheet.getRow(currentRow);
    row.getCell(1).value = artikelnummerBasis;
    const materialCode = artikelnummerBasis[1];
    row.getCell(2).value = GRUNDMATERIAL[materialCode] || s.Art || "";

    worksheet.mergeCells(`C${currentRow}:F${currentRow}`);

    // Detailed description logic (ported from Python)
    let bezeichnung = "";
    const getVal = (val) => (val && val !== "0" && val !== 0 ? val : "-");

    const artCode = artikelnummerBasis[2];
    const artikelTyp =
      artCode === "H"
        ? "Halskette"
        : artCode === "O"
          ? "Ohrring"
          : artCode === "A"
            ? "Armband"
            : artCode === "S"
              ? "Schlüsselanhänger"
              : "";
    if (s.Name && s.Name.trim()) {
      bezeichnung = `${artikelTyp}: ${s.Name}`;
    } else if (artikelTyp === "Ohrring") {
      bezeichnung = `${artikelTyp}: ${getVal(s.Art)} ${getVal(s.Form)} ${getVal(s.Fassung)} ${getVal(s.Farbe)}, ${getVal(s.Inhalt_Zusatzmaterial)}`;
    } else if (artikelTyp === "Halskette") {
      bezeichnung = `${artikelTyp}: Fassung ${getVal(s.Anhänger_Fassung)} ${getVal(s.Anhänger_Form)}, ${getVal(s.Anhänger_Inhalt_Farbe)} ${getVal(s.Anhänger_Inhalt_Zusatzmaterial)}`;
    } else if (artikelTyp === "Armband") {
      bezeichnung = `${artikelTyp}: ${getVal(s.Art)} ${getVal(s.Farbe)}, ${getVal(s.Anhänger)}, ${getVal(s.Zwischenstück)}`;
    } else if (artikelTyp === "Schlüsselanhänger") {
      bezeichnung = `${artikelTyp}: ${getVal(s.Art)} ${getVal(s.Form)}`;
    } else {
      bezeichnung = `${s.Art || ""}: ${s.Material || ""} ${s.Farbe || ""}`;
    }

    row.getCell(3).value = bezeichnung;

    const menge = articleCounts[artikelnummerBasis] || 1;
    const einzelpreisOriginal = Number(s.Verkaufspreis) || 0;
    const itemRabattPercent = Number(
      data.rabatt_positionen?.[artikelnummerBasis] || 0,
    );
    const einzelpreis =
      itemRabattPercent > 0
        ? einzelpreisOriginal * (1 - itemRabattPercent / 100)
        : einzelpreisOriginal;

    if (itemRabattPercent > 0) {
      row.getCell(3).value = `${bezeichnung} (Rabatt: ${itemRabattPercent}%)`;
    }

    row.getCell(7).value = menge;
    row.getCell(8).value = einzelpreis;
    row.getCell(8).numFmt = "#,##0.00 \u20ac";
    row.getCell(9).value = einzelpreis * menge;
    row.getCell(9).numFmt = "#,##0.00 \u20ac";

    for (let i = 1; i <= 9; i++) {
      formatCell(row.getCell(i));
    }

    currentRow++;
  });

  // 5. Total Block (for Invoice)
  if (type === "Rechnung") {
    currentRow++;
    // Gesamtwert = Summe aller (ggf. mit Einzelrabatt reduzierten) Preise
    const total = data.schmuckstuecke.reduce((sum, s) => {
      const basis = (s.Artikelnummer || "").split("_")[0];
      const rabatt = Number(data.rabatt_positionen?.[basis] || 0);
      return sum + (Number(s.Verkaufspreis) || 0) * (1 - rabatt / 100);
    }, 0);

    const totalLabelCell = worksheet.getCell(`G${currentRow}`);
    totalLabelCell.value = "Gesamtwert";
    totalLabelCell.font = { name: "Calibri", bold: true, size: 11 };
    worksheet.mergeCells(`G${currentRow}:H${currentRow}`);

    const totalValueCell = worksheet.getCell(`I${currentRow}`);
    totalValueCell.value = total;
    totalValueCell.numFmt = "#,##0.00 \u20ac";
    totalValueCell.font = { name: "Calibri", size: 10 };

    // Gesamtrabatt (optional)
    const gesamtRabattPercent = Number(data.rabatt_gesamt || 0);
    let totalNachRabatt = total;
    if (gesamtRabattPercent > 0) {
      currentRow++;
      const gesamtRabattValue = total * (gesamtRabattPercent / 100);
      totalNachRabatt = total - gesamtRabattValue;

      const gesamtRabattLabelCell = worksheet.getCell(`G${currentRow}`);
      gesamtRabattLabelCell.value = "- Gesamtrabatt";
      gesamtRabattLabelCell.font = { name: "Calibri", size: 11, bold: true };
      gesamtRabattLabelCell.alignment = { horizontal: "right" };

      const gesamtRabattPercentCell = worksheet.getCell(`H${currentRow}`);
      gesamtRabattPercentCell.value = `${gesamtRabattPercent} %`;
      gesamtRabattPercentCell.font = { name: "Calibri", size: 11, bold: true };
      gesamtRabattPercentCell.alignment = { horizontal: "left" };

      const gesamtRabattValueCell = worksheet.getCell(`I${currentRow}`);
      gesamtRabattValueCell.value = -gesamtRabattValue;
      gesamtRabattValueCell.numFmt = "#,##0.00 \u20ac";
      gesamtRabattValueCell.font = { name: "Calibri", size: 10 };
      gesamtRabattValueCell.alignment = { horizontal: "right" };
    }

    // Provision
    currentRow++;
    const provisionPercent = data.kunde.Provision || 0;
    const provisionValue = totalNachRabatt * (provisionPercent / 100);

    const provLabelCell = worksheet.getCell(`G${currentRow}`);
    provLabelCell.value = "- Provision";
    provLabelCell.font = { name: "Calibri", size: 11, bold: true };
    provLabelCell.alignment = { horizontal: "right" };

    const provPercentCell = worksheet.getCell(`H${currentRow}`);
    provPercentCell.value = `${provisionPercent} %`;
    provPercentCell.font = { name: "Calibri", size: 11, bold: true };
    provPercentCell.alignment = { horizontal: "left" };

    const provValueCell = worksheet.getCell(`I${currentRow}`);
    provValueCell.value = provisionValue;
    provValueCell.numFmt = "#,##0.00 \u20ac";
    provValueCell.font = { name: "Calibri", size: 10 };
    provValueCell.alignment = { horizontal: "right" };

    // Final Total
    currentRow++;
    const finalTotal = totalNachRabatt - provisionValue;

    const finalLabelCell = worksheet.getCell(`G${currentRow}`);
    finalLabelCell.value = "Überweisungsbetrag";
    finalLabelCell.font = {
      name: "Calibri",
      bold: true,
      background: {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFBCBCBC" },
      },
    };
    finalLabelCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFBCBCBC" },
    };
    finalLabelCell.alignment = { horizontal: "left" };
    worksheet.mergeCells(`G${currentRow}:H${currentRow}`);

    const finalValueCell = worksheet.getCell(`I${currentRow}`);
    finalValueCell.value = finalTotal;
    finalValueCell.numFmt = "#,##0.00 €";
    finalValueCell.font = { name: "Calibri", size: 10 };
    finalValueCell.alignment = { horizontal: "right" };
    finalValueCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFBCBCBC" },
    };
    finalValueCell.border = {
      bottom: { style: "double", color: { argb: "FF000000" } },
    };

    currentRow += 2;
    currentRow++;
    worksheet.mergeCells(`A${currentRow}:I${currentRow}`);
    worksheet.getCell(`A${currentRow}`).value =
      "Gemäß § 19 Abs. 1 UStG wird keine Umsatzsteuer ausgewiesen.";
    worksheet.getCell(`A${currentRow}`).font = { name: "Calibri", size: 10 };

    currentRow++;
    worksheet.mergeCells(`A${currentRow}:I${currentRow}`);
    worksheet.getCell(`A${currentRow}`).value =
      "Bitte überweisen Sie den Rechnungsbetrag an u.g. Bankverbindung.";
    worksheet.getCell(`A${currentRow}`).font = { name: "Calibri", size: 10 };

    currentRow++;
    worksheet.mergeCells(`A${currentRow}:I${currentRow}`);
    worksheet.getCell(`A${currentRow}`).value =
      "Die Rechnung ist sofort bei Erhalt fällig.";
    worksheet.getCell(`A${currentRow}`).font = { name: "Calibri", size: 10 };

    currentRow++;
    worksheet.mergeCells(`A${currentRow}:I${currentRow}`);
    worksheet.getCell(`A${currentRow}`).value = "Vielen Dank";
    worksheet.getCell(`A${currentRow}`).font = { name: "Calibri", size: 10 };
  }

  if (type === "Lieferschein") {
    currentRow++;
    worksheet.mergeCells(`A${currentRow}:I${currentRow}`);
    worksheet.getCell(`A${currentRow}`).value =
      "Lieferung: Die Lieferung erfolgt frei Haus.";

    currentRow += 2;
    worksheet.mergeCells(`A${currentRow}:I${currentRow}`);
    worksheet.getCell(`A${currentRow}`).value =
      `Bei Rückfragen stehen wir Ihnen gerne zu Verfügung unter ${contact.email}`;
  }

  currentRow += 2;
  worksheet.mergeCells(`A${currentRow}:I${currentRow}`);
  const greetingCell = worksheet.getCell(`A${currentRow}`);
  greetingCell.value = "Mit freundlichen Grüßen";
  greetingCell.font = { name: "Calibri", size: 10 };

  currentRow += 4;
  worksheet.mergeCells(`A${currentRow}:D${currentRow}`);
  const signatureCell = worksheet.getCell(`A${currentRow}`);
  signatureCell.value = contact.name;
  signatureCell.font = { name: "Calibri", size: 10 };
  signatureCell.border = {
    top: { style: "thin", color: { argb: "FFBCBCBC" } },
  };

  // Footer
  const f = '&"Calibri,Regular"&8 ';

  const left = `&L${f}${contact.company}\n${f}${contact.name}\n${f}${BUSINESS_ADDRESS}`;
  const center = `&C${f}${contact.mobile}\n${f}${contact.email}\n${f}${contact.website}`;
  const right = `&R${f}${contact.bank}`;

  const footerText = `${left}${center}${right}`;

  worksheet.headerFooter.oddFooter = footerText;
  worksheet.headerFooter.evenFooter = footerText;

  // Auto-fit column widths based on content
  autoFitColumns(worksheet);

  return await workbook.xlsx.writeBuffer();
}

/**
 * Generate an inventory (Inventur) Excel workbook for a single customer.
 * Groups items into three sheets: Aktiv (nicht verkauft), Verkauft, Ausschuss.
 */
async function generateInventurExcel(kunde, items) {
  const workbook = new ExcelJS.Workbook();
  workbook.defaultFont = { name: "Calibri", size: 10 };

  const today = new Date().toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  const aktiv = items.filter(
    (i) => Number(i.Verkauft) === 0 && Number(i.Ausschuss) === 0,
  );
  const verkauft = items.filter((i) => Number(i.Verkauft) === 1);
  const ausschuss = items.filter((i) => Number(i.Ausschuss) === 1);

  addInventurSheet(workbook, "Nicht verkauft", aktiv, "FFD4EDDA", kunde, today); // light green
  addInventurSheet(workbook, "Verkauft", verkauft, "FFCCE5FF", kunde, today); // light blue
  addInventurSheet(workbook, "Ausschuss", ausschuss, "FFFFEEBA", kunde, today); // light yellow

  // Summary sheet
  const ws = workbook.addWorksheet("Übersicht");
  ws.pageSetup.paperSize = 9;
  ws.pageSetup.orientation = "portrait";

  ws.mergeCells("A1:C1");
  const titleCell = ws.getCell("A1");
  titleCell.value = `Inventur – ${kunde.Name}`;
  titleCell.font = { name: "Calibri", bold: true, size: 14 };

  ws.mergeCells("A2:C2");
  ws.getCell("A2").value = `Stand: ${today}`;
  ws.getCell("A2").font = {
    name: "Calibri",
    size: 10,
    color: { argb: "FF6B7280" },
  };

  ws.addRow([]);

  const summaryHeaders = ws.addRow(["Status", "Anzahl", "Gesamtwert"]);
  summaryHeaders.eachCell((cell) => {
    formatCell(cell, {
      bold: true,
      fillColor: "FFF2F2F2",
      alignment: { horizontal: "center" },
    });
  });

  const addSummaryRow = (label, arr, argb) => {
    const total = arr.reduce((s, i) => s + (Number(i.Verkaufspreis) || 0), 0);
    const row = ws.addRow([label, arr.length, total]);
    row.getCell(3).numFmt = "#,##0.00 €";
    row.eachCell((cell) => {
      formatCell(cell, { fillColor: argb });
    });
  };

  addSummaryRow("Nicht verkauft", aktiv, "FFD4EDDA");
  addSummaryRow("Verkauft", verkauft, "FFCCE5FF");
  addSummaryRow("Ausschuss", ausschuss, "FFFFEEBA");

  // Total row
  const allTotal = items.reduce(
    (s, i) => s + (Number(i.Verkaufspreis) || 0),
    0,
  );
  const totalRow = ws.addRow(["Gesamt", items.length, allTotal]);
  totalRow.getCell(3).numFmt = "#,##0.00 €";
  totalRow.eachCell((cell) => {
    formatCell(cell, { bold: true });
  });

  ws.columns = [{ width: 20 }, { width: 10 }, { width: 16 }];

  return await workbook.xlsx.writeBuffer();
}

module.exports = { generateExcel, generateInventurExcel };
