import { useState, useRef } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faExclamationTriangle,
  faInfoCircle,
  faFileExport,
  faFileImport,
  faCheckCircle,
  faDownload,
  faFolderOpen,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../api";

export default function Datensicherung() {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);

  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState(null);

  const fileInputRef = useRef(null);

  const handleExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const blob = await api.exportBackup();
      const formattedDate = new Date().toISOString().slice(0, 10);
      const filename = `goldregendb_backup_${formattedDate}.json`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err.message);
    } finally {
      setExporting(false);
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const confirmed = window.confirm(
      `ACHTUNG: Alle vorhandenen Daten (Kunden, Lieferscheine, Rechnungen, Schmuckstücke) werden gelöscht und durch die Backup-Datei ersetzt!\n\nDatei: ${file.name}\n\nFortfahren?`
    );
    // Always reset the file input so the same file can be re-selected later
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!confirmed) return;

    setImporting(true);
    setImportResult(null);
    setImportError(null);

    try {
      const text = await file.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error("Datei ist kein gültiges JSON");
      }
      const result = await api.importBackup(data);
      setImportResult(result);
    } catch (err) {
      setImportError(err.message);
    } finally {
      setImporting(false);
    }
  };

  const TABLE_LABELS = {
    Kunde: "Kunden",
    Lieferschein: "Lieferscheine",
    Rechnung: "Rechnungen",
    "Schmuckstück": "Schmuckstücke",
  };

  return (
    <div className="page-header">
      <h2>Datensicherung</h2>
      <p style={{ marginBottom: "32px", fontSize: "1rem", lineHeight: "1.5" }}>
        Exportieren Sie alle Daten als JSON-Backup oder stellen Sie einen
        früheren Stand aus einer Backup-Datei wieder her.
      </p>

      {/* Warning Card */}
      <div className="alert-card warning">
        <div className="alert-card-body">
          <div className="alert-card-title">
            <span><FontAwesomeIcon icon={faExclamationTriangle} /></span>
            <span>Wichtiger Hinweis</span>
          </div>
          <div className="alert-card-content">
            <p>
              Beim Import werden <strong>alle vorhandenen Datensätze gelöscht</strong> und durch den
              Inhalt der Backup-Datei ersetzt. Dieser Vorgang kann nicht rückgängig gemacht werden.
            </p>
          </div>
        </div>
      </div>

      {/* Info Card */}
      <div className="alert-card info">
        <div className="alert-card-body">
          <div className="alert-card-title">
            <span><FontAwesomeIcon icon={faInfoCircle} /></span>
            <span>Datenpersistenz bei Docker-Neustart</span>
          </div>
          <div className="alert-card-content">
            <p>
              Die Datenbankdaten werden im Docker-Volume{" "}
              <code>pgdata</code> gespeichert und bleiben bei einem normalen{" "}
              <code>docker compose restart</code> oder{" "}
              <code>docker compose down &amp;&amp; docker compose up</code>{" "}
              erhalten. Verwenden Sie niemals{" "}
              <code>docker compose down -v</code>, da dieser Befehl alle Volumes
              und damit alle Daten unwiderruflich löscht. Erstellen Sie vor
              riskanten Aktionen stets ein Backup über die Export-Funktion unten.
            </p>
          </div>
        </div>
      </div>

      {/* Export Section */}
      <div className="card" style={{ marginBottom: "32px" }}>
        <div className="card-header" style={{ padding: "20px 24px" }}>
          <h3><FontAwesomeIcon icon={faFileExport} /> Daten exportieren</h3>
        </div>
        <div className="card-body" style={{ padding: "24px" }}>
          <p style={{ marginBottom: "20px", lineHeight: "1.6" }}>
            Lädt alle Kunden, Lieferscheine, Rechnungen und Schmuckstücke als
            JSON-Datei herunter. Diese Datei kann später für einen Import
            verwendet werden.
          </p>
          {exportError && (
            <div className="badge danger" style={{ marginBottom: "20px" }}>
              {exportError}
            </div>
          )}
          <button
            className="btn btn-primary"
            onClick={handleExport}
            disabled={exporting}
          >
            {exporting ? "Exportiere…" : <><FontAwesomeIcon icon={faDownload} /> Backup herunterladen</>}
          </button>
        </div>
      </div>

      {/* Import Section */}
      <div className="card">
        <div className="card-header" style={{ padding: "20px 24px" }}>
          <h3><FontAwesomeIcon icon={faFileImport} /> Daten importieren</h3>
        </div>
        <div className="card-body" style={{ padding: "24px" }}>
          <p style={{ marginBottom: "20px", lineHeight: "1.6" }}>
            <strong><FontAwesomeIcon icon={faExclamationTriangle} /> Achtung:</strong> Beim Import werden{" "}
            <strong>alle vorhandenen Datensätze gelöscht</strong> und durch den
            Inhalt der Backup-Datei ersetzt. Dieser Vorgang kann nicht rückgängig
            gemacht werden.
          </p>

          {importResult && (
            <div className="badge success" style={{ marginBottom: "20px", padding: "12px 16px" }}>
              <FontAwesomeIcon icon={faCheckCircle} /> Import erfolgreich! Importiert:{" "}
              {Object.entries(importResult.counts)
                .map(([t, n]) => `${n} ${TABLE_LABELS[t] ?? t}`)
                .join(", ")}
            </div>
          )}
          {importError && (
            <div className="badge danger" style={{ marginBottom: "20px", padding: "12px 16px" }}>
              {importError}
            </div>
          )}

          <label
            htmlFor="import-file"
            className={`btn btn-secondary${importing ? " disabled" : ""}`}
            style={{ cursor: importing ? "not-allowed" : "pointer" }}
          >
            {importing ? "Importiere…" : <><FontAwesomeIcon icon={faFolderOpen} /> Backup-Datei wählen & importieren</>}
          </label>
          <input
            id="import-file"
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFileChange}
            disabled={importing}
            style={{ display: "none" }}
          />
        </div>
      </div>
    </div>
  );
}
