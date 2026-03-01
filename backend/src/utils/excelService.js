const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");
const sizeOf = require("image-size");

const CONTACTS = {
  GOLDREGEN: {
    name: "Marina Südholt",
    mobile: "0152 22731186",
    email: "goldregen.schmuckdesign@gmail.com",
    website: "www.goldregenschmuckdesign.de",
    bank: "UniCredit Bank AG\nDE51 7502 0073 0029 2620 20\nHYVEDEMM447",
  },
  TCS: {
    name: "Oliver Südholt",
    mobile: "0151 21832342",
    email: "techcraftsuedholt@gmail.com",
    website: "",
    bank: "UniCredit Bank AG\nDE51 7502 0073 0029 2620 20\nHYVEDEMM447",
  },
};

const BUSINESS_ADDRESS = "Herzogin-Ludmilla-Ring 5 • 84085 Langquaid";

const DEFAULT_LOGO_PATH = path.join(__dirname, "../assets/Logo trasparent weißer Kreis.png");

const GRUNDMATERIAL = {
  A: "Alkoholtinte",
  B: "Beton",
  C: "Cucio",
  E: "Edelstahl",
  F: "Fimo",
  H: "Harz",
  I: "Phiole",
  J: "Papier",
  K: "Kordel",
  L: "Leder",
  M: "Makramee",
  N: "Naturstein",
  P: "Perle",
  S: "Schrumpffolie",
  W: "Holz",
  X: "3D-Druck",
  Y: "Cabochon",
};

async function generateExcel(type, data, logoPath) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(type);

  // Set default font
  workbook.defaultFont = { name: "Calibri", size: 10 };
  worksheet.font = { name: "Calibri", size: 10 };

  const contact = CONTACTS.GOLDREGEN; // Default to Marina/GoldRegen

  // Setup column widths
  worksheet.columns = [
    { width: 15 }, // A
    { width: 15 }, // B
    { width: 15 }, // C
    { width: 15 }, // D
    { width: 15 }, // E
    { width: 15 }, // F
    { width: 10 }, // G
    { width: 12 }, // H
    { width: 14 }, // I
  ];

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
    bottom: 0.75,
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
          height: dimensions.height * scaleFactor
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

  const datum = new Date(data.Datum).toLocaleDateString("de-DE");
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
        cell.alignment = { horizontal: "center", vertical: "center" };
      }

      cell.font = { name: "Calibri", size: 10, bold: true };
      cell.border = {
        top: { style: "thin", color: { argb: "FFBCBCBC" } },
        left: { style: "thin", color: { argb: "FFBCBCBC" } },
        bottom: { style: "thin", color: { argb: "FFBCBCBC" } },
        right: { style: "thin", color: { argb: "FFBCBCBC" } },
      };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF2F2F2" },
      };
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
    const einzelpreis = Number(s.Verkaufspreis) || 0;

    row.getCell(7).value = menge;
    row.getCell(8).value = einzelpreis;
    row.getCell(8).numFmt = "#,##0.00 €";
    row.getCell(9).value = einzelpreis * menge;
    row.getCell(9).numFmt = "#,##0.00 €";

    for (let i = 1; i <= 9; i++) {
      row.getCell(i).font = { name: "Calibri", size: 10 };
      row.getCell(i).border = {
        top: { style: "thin", color: { argb: "FFBCBCBC" } },
        left: { style: "thin", color: { argb: "FFBCBCBC" } },
        bottom: { style: "thin", color: { argb: "FFBCBCBC" } },
        right: { style: "thin", color: { argb: "FFBCBCBC" } },
      };
    }

    currentRow++;
  });

  // 5. Total Block (for Invoice)
  if (type === "Rechnung") {
    currentRow++;
    const total = data.schmuckstuecke.reduce(
      (sum, s) => sum + (Number(s.Verkaufspreis) || 0),
      0,
    );

    const totalLabelCell = worksheet.getCell(`G${currentRow}`);
    totalLabelCell.value = "Gesamtwert";
    totalLabelCell.font = { name: "Calibri", bold: true, size: 11 };
    worksheet.mergeCells(`G${currentRow}:H${currentRow}`);

    const totalValueCell = worksheet.getCell(`I${currentRow}`);
    totalValueCell.value = total;
    totalValueCell.numFmt = "#,##0.00 €";
    totalValueCell.font = { name: "Calibri", size: 10 };

    // Provision
    currentRow++;
    const provisionPercent = data.kunde.Provision || 0;
    const provisionValue = total * (provisionPercent / 100);

    const provLabelCell = worksheet.getCell(`G${currentRow}`);
    provLabelCell.value = "- Provision";
    provLabelCell.font = { name: "Calibri", size: 11, bold: true };
    provLabelCell.alignment = { horizontal: "right" };

    const provPercentCell = worksheet.getCell(`H${currentRow}`);
    provPercentCell.value = `${provisionPercent} %`;
    provPercentCell.font = { name: "Calibri", size: 10, bold: true };
    provPercentCell.alignment = { horizontal: "left" };

    const provValueCell = worksheet.getCell(`I${currentRow}`);
    provValueCell.value = provisionValue;
    provValueCell.numFmt = "#,##0.00 €";
    provValueCell.font = { name: "Calibri", size: 10};
    provValueCell.alignment = { horizontal: "right" };

    // Final Total
    currentRow++;
    const finalTotal = total - provisionValue;

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
  const footerText = `&L${contact.name}\n${BUSINESS_ADDRESS}&C${contact.mobile}\n${contact.email}\n${contact.website}&R${contact.bank}`;
  worksheet.headerFooter.oddFooter = footerText;
  worksheet.headerFooter.evenFooter = footerText;

  return await workbook.xlsx.writeBuffer();
}

module.exports = { generateExcel };
