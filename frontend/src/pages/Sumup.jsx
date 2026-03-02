import { useState, useRef } from "react";
import { api } from "../api";

export default function Sumup() {
  const [sumupImporting, setSumupImporting] = useState(false);
  const [sumupResult, setSumupResult] = useState(null);
  const [sumupError, setSumupError] = useState(null);

  const sumupFileInputRef = useRef(null);

  const handleSumupFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const confirmed = window.confirm(
      `SumUp Verkaufsbericht importieren?\n\nDatei: ${file.name}\n\nEs wird automatisch ein Lieferschein erstellt und die verkauften Artikel werden als "verkauft" markiert.\n\nFortfahren?`,
    );

    // Reset file input
    if (sumupFileInputRef.current) sumupFileInputRef.current.value = "";
    if (!confirmed) return;

    setSumupImporting(true);
    setSumupResult(null);
    setSumupError(null);

    try {
      const text = await file.text();

      // Parse CSV mit ordnungsgemäßem Parser
      const lines = parseCSVLines(text);
      if (lines.length < 2) {
        throw new Error("CSV-Datei ist leer oder ungültig");
      }

      const headers = lines[0];
      const csvData = [];

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i];
        const row = {};
        headers.forEach((header, idx) => {
          row[header] = values[idx] || "";
        });
        csvData.push(row);
      }

      const result = await api.importSumupCsv(csvData);
      setSumupResult(result);
    } catch (err) {
      setSumupError(err.message);
    } finally {
      setSumupImporting(false);
    }
  };

  // CSV-Parser: ordnungsgemäß mit Anführungszeichen und Kommas in Daten
  function parseCSVLines(text) {
    const lines = [];
    let currentLine = "";
    let inQuotes = false;

    // Zeilenweise parsen (berücksichtigt Anführungszeichen)
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          currentLine += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if ((char === "\n" || char === "\r") && !inQuotes) {
        if (currentLine.trim()) lines.push(currentLine);
        currentLine = "";
        if (char === "\r" && nextChar === "\n") i++; // \r\n
      } else {
        currentLine += char;
      }
    }
    if (currentLine.trim()) lines.push(currentLine);

    // Jede Zeile in Felder aufteilen
    return lines.map((line) => {
      const fields = [];
      let field = "";
      let inQuotes = false;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];

        if (char === '"') {
          if (inQuotes && nextChar === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === "," && !inQuotes) {
          fields.push(field.trim().replace(/^"|"$/g, ""));
          field = "";
        } else {
          field += char;
        }
      }
      fields.push(field.trim().replace(/^"|"$/g, ""));
      return fields;
    });
  }

  return (
    <div>
      <div className="page-header">
        <h2>💳 SumUp Verwaltung</h2>
        <p
          style={{ marginBottom: "32px", fontSize: "1rem", lineHeight: "1.5" }}>
          Exportieren Sie verfügbare Artikel für SumUp oder importieren Sie
          Verkaufsberichte.
        </p>
      </div>

      {/* Export Section */}
      <div className="card" style={{ marginBottom: "32px" }}>
        <div className="card-header" style={{ padding: "20px 24px" }}>
          <h3>📤 SumUp Export (CSV)</h3>
        </div>
        <div className="card-body" style={{ padding: "24px" }}>
          <p style={{ marginBottom: "20px", lineHeight: "1.6" }}>
            Exportiert alle verfügbaren Schmuckstücke (nicht verkauft, nicht
            ausgelagert, kein Ausschuss) als CSV-Datei im SumUp-Format. Die
            Datei kann direkt in das SumUp-Kassensystem importiert werden.
          </p>
          <ul style={{ marginBottom: "20px", lineHeight: "1.8" }}>
            <li>
              ✅ Gruppierung nach Basis-Artikelnummer (z.B. MBH028 mit Varianten
              _1 bis _5)
            </li>
            <li>
              ✅ Produktspezifische Beschreibungen (Ohrring, Halskette, Armband,
              Schlüsselanhänger)
            </li>
            <li>✅ Vollständiges SumUp CSV-Format (35 Spalten)</li>
            <li>✅ SKU und Barcode für Inventar-Tracking</li>
          </ul>
          <a className="btn btn-primary" href={api.getSumupExport()} download>
            ⬇️ CSV für SumUp herunterladen
          </a>
        </div>
      </div>

      {/* Import Section */}
      <div className="card">
        <div className="card-header" style={{ padding: "20px 24px" }}>
          <h3>📥 SumUp Verkaufsbericht importieren</h3>
        </div>
        <div className="card-body" style={{ padding: "24px" }}>
          <p style={{ marginBottom: "20px", lineHeight: "1.6" }}>
            Importieren Sie einen SumUp Verkaufsbericht (CSV-Datei). Das System
            erstellt automatisch:
          </p>
          <ul style={{ marginBottom: "20px", lineHeight: "1.8" }}>
            <li>
              ✅ Einen Lieferschein für alle verkauften Artikel (zu SumUp
              ausgelagert)
            </li>
            <li>✅ Separate Rechnungen für Marina- und Saskia-Artikel</li>
            <li>✅ Markierung der Artikel als "verkauft"</li>
          </ul>

          {sumupResult && (
            <div
              className="badge success"
              style={{
                marginBottom: "20px",
                padding: "16px 20px",
                display: "block",
                whiteSpace: "pre-line",
              }}>
              <strong>✅ Import erfolgreich!</strong>
              <br />
              <br />
              📦 <strong>Lieferschein:</strong>{" "}
              {sumupResult.lieferschein.Nummer}
              <br />
              📊 <strong>Artikel:</strong> {sumupResult.artikel.gesamt} gesamt (
              {sumupResult.artikel.marina} Marina, {sumupResult.artikel.saskia}{" "}
              Saskia)
              <br />
              {sumupResult.rechnungen.marina && (
                <>
                  💰 <strong>Rechnung Marina:</strong>{" "}
                  {sumupResult.rechnungen.marina.Nummer}
                  <br />
                </>
              )}
              {sumupResult.rechnungen.saskia && (
                <>
                  💰 <strong>Rechnung Saskia:</strong>{" "}
                  {sumupResult.rechnungen.saskia.Nummer}
                </>
              )}
            </div>
          )}
          {sumupError && (
            <div
              className="badge danger"
              style={{
                marginBottom: "20px",
                padding: "16px 20px",
                display: "block",
              }}>
              <strong>❌ Fehler:</strong> {sumupError}
            </div>
          )}

          <label
            htmlFor="sumup-import-file"
            className={`btn btn-primary${sumupImporting ? " disabled" : ""}`}
            style={{ cursor: sumupImporting ? "not-allowed" : "pointer" }}>
            {sumupImporting ? "⏳ Importiere…" : "📂 SumUp CSV-Datei wählen"}
          </label>
          <input
            id="sumup-import-file"
            ref={sumupFileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleSumupFileChange}
            disabled={sumupImporting}
            style={{ display: "none" }}
          />
          {/* Warning Card */}
          <div className="alert-card info" style={{ marginTop: "24px" }}>
            <div className="alert-card-body">
              <div className="alert-card-title">
                <span>ℹ️</span>
                <span>CSV-Format:</span>
              </div>
              <div className="alert-card-content">
                <p>
                  Die CSV-Datei sollte eine Spalte mit Artikelnummern enthalten.{" "}
                  <br></br>
                  Unterstützte Spaltennamen:
                </p>
                <code>SKU</code>, <code>Barcode</code>, <code>Produktnummer</code>, <code>Artikelnummer</code>, <code>Product ID</code>, <code>Name</code>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
