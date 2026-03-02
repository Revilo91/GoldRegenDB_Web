import { useState, useRef } from "react";
import { api } from "../api";

export default function Sumup() {
  const [sumupImporting, setSumupImporting] = useState(false);
  const [sumupResult, setSumupResult] = useState(null);
  const [sumupError, setSumupError] = useState(null);
  const [sumupExport, setSumupExport] = useState(false);

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

      // Sende Raw CSV-Text an Backend (Backend macht das Parsing)
      console.log('CSV Debug: Dateiinhalt gesendet zum Backend');

      const result = await api.importSumupCsv(text);
      setSumupResult(result);
    } catch (err) {
      setSumupError(err.message);
    } finally {
      setSumupImporting(false);
    }
  };

  const handleSumupExport = async () => {
    try {
      setSumupExport(true);
      const blob = await api.exportSumupCsv();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Sumup_Export_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error('Export Error:', err);
      alert(`❌ Fehler beim Export: ${err.message}`);
    } finally {
      setSumupExport(false);
    }
  };

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
          <button
            className="btn btn-primary"
            onClick={handleSumupExport}
            disabled={sumupExport}
          >
            {sumupExport ? '⏳ Wird heruntergeladen...' : '⬇️ CSV für SumUp herunterladen'}
          </button>
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
              {sumupError.includes("Spalten") && (
                <>
                  <br />
                  <br />
                  <details style={{ cursor: "pointer", marginTop: "12px" }}>
                    <summary style={{ fontWeight: "bold" }}>
                      👉 Klicken für Hilfe zur Fehlersuche
                    </summary>
                    <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid currentColor" }}>
                      <p><strong>Tipps:</strong></p>
                      <ul style={{ marginLeft: "20px" }}>
                        <li>Die CSV-Datei sollte eine Spalte mit Artikelnummern haben</li>
                        <li>Unterstützte Spaltennamen: <code>Beschreibung</code>, <code>SKU</code>, <code>Barcode</code>, <code>Artikelnummer</code>, <code>Name</code></li>
                        <li>Artikel-Nummern müssen folgendes Format haben: M/S + 2 Buchstaben + 3 Ziffern (z.B. <code>MBH001</code> oder <code>MBH001_2</code>)</li>
                        <li>Öffnen Sie die Browser-Konsole (F12 → Console) um weitere Debug-Informationen zu sehen</li>
                      </ul>
                    </div>
                  </details>
                </>
              )}
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

        </div>
      </div>
    </div>
  );
}
