const ExcelJS = require('exceljs');

const CONTACTS = {
  GOLDREGEN: {
    name: "Marina Südholt",
    mobile: "0152 22731186",
    email: "goldregen.schmuckdesign@gmail.com",
    website: "www.goldregenschmuckdesign.de",
    bank: "UniCredit Bank AG\nDE51 7502 0073 0029 2620 20\nHYVEDEMM447"
  },
  TCS: {
    name: "Oliver Südholt",
    mobile: "0151 21832342",
    email: "techcraftsuedholt@gmail.com",
    website: "",
    bank: "UniCredit Bank AG\nDE51 7502 0073 0029 2620 20\nHYVEDEMM447"
  }
};

const BUSINESS_ADDRESS = "Herzogin-Ludmilla-Ring 5 • 84085 Langquaid";

const GRUNDMATERIAL = {
  'A': "Alkoholtinte",
  'B': "Beton",
  'C': "Cucio",
  'E': "Edelstahl",
  'F': "Fimo",
  'H': "Harz",
  'I': "Phiole",
  'J': "Papier",
  'K': "Kordel",
  'L': "Leder",
  'M': "Makramee",
  'N': "Naturstein",
  'P': "Perle",
  'S': "Schrumpffolie",
  'W': "Holz",
  'X': "3D-Druck",
  'Y': "Cabochon"
};

async function generateExcel(type, data) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(type);
  
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
    { width: 14 }  // I
  ];

  // 1. Header with Address Line
  const headerRow = 9; // Line 8 in Python (0-indexed here)
  worksheet.mergeCells(`A${headerRow}:E${headerRow}`);
  const headerCell = worksheet.getCell(`A${headerRow}`);
  headerCell.value = `${contact.name} • ${BUSINESS_ADDRESS}`;
  headerCell.font = { size: 8 };
  headerCell.border = { bottom: { style: 'thin' } };

  // 2. Customer Address Block
  let currentRow = 11;
  const address = [
    data.kunde.Name,
    `${data.kunde.Strasse} ${data.kunde.Hausnummer || ''}`,
    `${data.kunde.PLZ || ''} ${data.kunde.Ort || ''}`
  ];
  address.forEach(line => {
    if (line && line.trim()) {
      worksheet.mergeCells(`A${currentRow}:F${currentRow}`);
      worksheet.getCell(`A${currentRow}`).value = line;
      currentRow++;
    }
  });

  // 3. Info Block
  currentRow += 2;
  const titleRow = currentRow;
  worksheet.mergeCells(`A${titleRow}:C${titleRow}`);
  const titleCell = worksheet.getCell(`A${titleRow}`);
  titleCell.value = type;
  titleCell.font = { bold: true, size: 20 };

  currentRow += 2;
  const infoLabelRow = currentRow;
  worksheet.mergeCells(`A${infoLabelRow}:B${infoLabelRow}`);
  worksheet.getCell(`A${infoLabelRow}`).value = `${type} Nr.`;
  
  if (type === 'Lieferschein') {
    worksheet.mergeCells(`D${infoLabelRow}:E${infoLabelRow}`);
    worksheet.getCell(`D${infoLabelRow}`).value = 'Lieferdatum';
  }
  
  worksheet.mergeCells(`G${infoLabelRow}:H${infoLabelRow}`);
  worksheet.getCell(`G${infoLabelRow}`).value = 'Datum';

  currentRow++;
  const infoValueRow = currentRow;
  worksheet.mergeCells(`A${infoValueRow}:B${infoValueRow}`);
  worksheet.getCell(`A${infoValueRow}`).value = data.Nummer;
  
  worksheet.mergeCells(`D${infoValueRow}:E${infoValueRow}`);
  // Lieferschein date usually empty or specific
  
  const datum = new Date(data.Datum).toLocaleDateString('de-DE');
  worksheet.mergeCells(`G${infoValueRow}:H${infoValueRow}`);
  worksheet.getCell(`G${infoValueRow}`).value = datum;

  currentRow++;
  const separatorRow = currentRow;
  worksheet.mergeCells(`A${separatorRow}:I${separatorRow}`);
  worksheet.getCell(`A${separatorRow}`).border = { top: { style: 'thin', color: { argb: 'FFBCBCBC' } } };

  currentRow++;
  const textRow = currentRow;
  worksheet.mergeCells(`A${textRow}:I${textRow}`);
  if (type === 'Lieferschein') {
    worksheet.getCell(`A${textRow}`).value = "Wir liefern Ihnen, wie vereinbart folgende Artikel:";
  } else {
    const rechnungsZeitraum = data.rechungsZeitraum || 'xx.xx.xxxx';
    worksheet.getCell(`A${textRow}`).value = `Für die verkauften Artikel im Zeitraum vom ${rechnungsZeitraum} stellen wir Ihnen folgende Positionen in Rechnung:`;
  }

  // 4. Article Block
  currentRow += 2;
  const tableHeaderRow = currentRow;
  const headers = ['Artikelnr.', 'Kategorie', 'Bezeichnung', '', '', '', 'Menge', 'Einzelpreis', 'Gesamtpreis'];
  headers.forEach((h, i) => {
    if (h) {
      const cell = worksheet.getRow(tableHeaderRow).getCell(i + 1);
      cell.value = h;
      cell.font = { bold: true };
      cell.alignment = { horizontal: 'center' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFBCBCBC' } },
        left: { style: 'thin', color: { argb: 'FFBCBCBC' } },
        bottom: { style: 'thin', color: { argb: 'FFBCBCBC' } },
        right: { style: 'thin', color: { argb: 'FFBCBCBC' } }
      };
    }
  });
  worksheet.mergeCells(`C${tableHeaderRow}:F${tableHeaderRow}`);

  currentRow++;
  data.schmuckstuecke.forEach(s => {
    const row = worksheet.getRow(currentRow);
    row.getCell(1).value = s.Artikelnummer.split('_')[0];
    const materialCode = s.Artikelnummer[1];
    row.getCell(2).value = GRUNDMATERIAL[materialCode] || s.Art || '';
    
    worksheet.mergeCells(`C${currentRow}:F${currentRow}`);
    
    // Detailed description logic (ported from Python)
    let bezeichnung = '';
    const getVal = (val) => (val && val !== '0' && val !== 0 ? val : '-');
    
    const artCode = s.Artikelnummer[2];
    const artikelTyp = artCode === 'H' ? 'Halskette' : artCode === 'O' ? 'Ohrring' : artCode === 'A' ? 'Armband' : artCode === 'S' ? 'Schlüsselanhänger' : '';
    if (s.Name && s.Name.trim()) {
      bezeichnung = `${artikelTyp}: ${s.Name}`;
    } else if (artikelTyp === 'Ohrring') {
      bezeichnung = `${artikelTyp}: ${getVal(s.Art)} ${getVal(s.Form)} ${getVal(s.Fassung)} ${getVal(s.Farbe)}, ${getVal(s.Inhalt_Zusatzmaterial)}`;
    } else if (artikelTyp === 'Halskette') {
      bezeichnung = `${artikelTyp}: Fassung ${getVal(s.Anhänger_Fassung)} ${getVal(s.Anhänger_Form)}, ${getVal(s.Anhänger_Inhalt_Farbe)} ${getVal(s.Anhänger_Inhalt_Zusatzmaterial)}`;
    } else if (artikelTyp === 'Armband') {
      bezeichnung = `${artikelTyp}: ${getVal(s.Art)} ${getVal(s.Farbe)}, ${getVal(s.Anhänger)}, ${getVal(s.Zwischenstück)}`;
    } else if (artikelTyp === 'Schlüsselanhänger') {
      bezeichnung = `${artikelTyp}: ${getVal(s.Art)} ${getVal(s.Form)}`;
    } else {
      bezeichnung = `${s.Art || ''}: ${s.Material || ''} ${s.Farbe || ''}`;
    }
    
    row.getCell(3).value = bezeichnung;
    
    row.getCell(7).value = 1;
    row.getCell(8).value = Number(s.Verkaufspreis);
    row.getCell(8).numFormat = '#,##0.00 €';
    row.getCell(9).value = Number(s.Verkaufspreis);
    row.getCell(9).numFormat = '#,##0.00 €';

    for (let i = 1; i <= 9; i++) {
      row.getCell(i).border = {
        top: { style: 'thin', color: { argb: 'FFBCBCBC' } },
        left: { style: 'thin', color: { argb: 'FFBCBCBC' } },
        bottom: { style: 'thin', color: { argb: 'FFBCBCBC' } },
        right: { style: 'thin', color: { argb: 'FFBCBCBC' } }
      };
    }
    currentRow++;
  });

  // Marina / Saskia Split
  currentRow += 1;
  const marinaItems = data.schmuckstuecke.filter(s => s.Artikelnummer?.toUpperCase().startsWith('M'));
  const saskiaItems = data.schmuckstuecke.filter(s => s.Artikelnummer?.toUpperCase().startsWith('S'));
  
  const marinaTotal = marinaItems.reduce((sum, s) => sum + (Number(s.Verkaufspreis) || 0), 0);
  const saskiaTotal = saskiaItems.reduce((sum, s) => sum + (Number(s.Verkaufspreis) || 0), 0);

  if (marinaItems.length > 0) {
    worksheet.getRow(currentRow).getCell(7).value = "Marina:";
    worksheet.getRow(currentRow).getCell(9).value = marinaTotal;
    worksheet.getRow(currentRow).getCell(9).numFormat = '#,##0.00 €';
    currentRow++;
  }
  
  if (saskiaItems.length > 0) {
    worksheet.getRow(currentRow).getCell(7).value = "Saskia:";
    worksheet.getRow(currentRow).getCell(9).value = saskiaTotal;
    worksheet.getRow(currentRow).getCell(9).numFormat = '#,##0.00 €';
    currentRow++;
  }

  // 5. Total Block (for Invoice)
  if (type === 'Rechnung') {
    currentRow++;
    const total = data.schmuckstuecke.reduce((sum, s) => sum + (Number(s.Verkaufspreis) || 0), 0);
    
    const totalLabelCell = worksheet.getCell(`G${currentRow}`);
    totalLabelCell.value = "Gesamtwert";
    totalLabelCell.font = { bold: true };
    worksheet.mergeCells(`G${currentRow}:H${currentRow}`);
    
    const totalValueCell = worksheet.getCell(`I${currentRow}`);
    totalValueCell.value = total;
    totalValueCell.numFormat = '#,##0.00 €';

    // Provision
    currentRow++;
    const provisionPercent = data.kunde.Provision || 0;
    const provisionValue = total * (provisionPercent / 100);
    
    const provLabelCell = worksheet.getCell(`G${currentRow}`);
    provLabelCell.value = "- Provision";
    worksheet.getCell(`H${currentRow}`).value = `${provisionPercent} %`;
    
    const provValueCell = worksheet.getCell(`I${currentRow}`);
    provValueCell.value = provisionValue;
    provValueCell.numFormat = '#,##0.00 €';

    // Final Total
    currentRow++;
    const finalTotal = total - provisionValue;
    
    const finalLabelRow = worksheet.getRow(currentRow);
    finalLabelRow.getCell(7).value = "Überweisungsbetrag";
    finalLabelRow.getCell(7).font = { bold: true };
    worksheet.mergeCells(`G${currentRow}:H${currentRow}`);
    
    const finalValueCell = worksheet.getCell(`I${currentRow}`);
    finalValueCell.value = finalTotal;
    finalValueCell.numFormat = '#,##0.00 €';
    finalValueCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFBCBCBC' }
    };
    
    currentRow += 2;
    currentRow++;
    worksheet.mergeCells(`A${currentRow}:I${currentRow}`);
    worksheet.getCell(`A${currentRow}`).value = "Gemäß § 19 Abs. 1 UStG wird keine Umsatzsteuer ausgewiesen.";
    
    currentRow++;
    worksheet.mergeCells(`A${currentRow}:I${currentRow}`);
    worksheet.getCell(`A${currentRow}`).value = "Bitte überweisen Sie den Rechnungsbetrag an u.g. Bankverbindung.";
    
    currentRow++;
    worksheet.mergeCells(`A${currentRow}:I${currentRow}`);
    worksheet.getCell(`A${currentRow}`).value = "Die Rechnung ist sofort bei Erhalt fällig.";

    currentRow++;
    worksheet.mergeCells(`A${currentRow}:I${currentRow}`);
    worksheet.getCell(`A${currentRow}`).value = "Vielen Dank";
  }

  if (type === 'Lieferschein') {
    currentRow++;
    worksheet.mergeCells(`A${currentRow}:I${currentRow}`);
    worksheet.getCell(`A${currentRow}`).value = "Lieferung: Die Lieferung erfolgt frei Haus.";
    
    currentRow += 2;
    worksheet.mergeCells(`A${currentRow}:I${currentRow}`);
    worksheet.getCell(`A${currentRow}`).value = `Bei Rückfragen stehen wir Ihnen gerne zu Verfügung unter ${contact.email}`;
  }

  currentRow += 2;
  worksheet.mergeCells(`A${currentRow}:I${currentRow}`);
  worksheet.getCell(`A${currentRow}`).value = "Mit freundlichen Grüßen";
  
  currentRow += 4;
  worksheet.mergeCells(`A${currentRow}:D${currentRow}`);
  worksheet.getCell(`A${currentRow}`).value = contact.name;
  worksheet.getCell(`A${currentRow}`).border = { top: { style: 'thin', color: { argb: 'FFBCBCBC' } } };

  // Footer
  worksheet.headerFooter.oddFooter = `&L${contact.name}\n${BUSINESS_ADDRESS}&C${contact.mobile}\n${contact.email}\n${contact.website}&R${contact.bank}`;
  
  return await workbook.xlsx.writeBuffer();
}

module.exports = { generateExcel };
