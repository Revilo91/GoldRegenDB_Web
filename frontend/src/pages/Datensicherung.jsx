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

// All known tables in display order
const ALL_TABLES = [
  { key: "Kunde", label: "Kunden" },
  { key: "Lieferschein", label: "Lieferscheine" },
  { key: "Rechnung", label: "Rechnungen" },
  { key: "Schmuckstück", label: "Schmuckstücke" },
  { key: "audit_log", label: "Audit-Log" },
  { key: "app_users", label: "Benutzer" },
  { key: "lagerinventur", label: "Lagerinventur" },
];

const TABLE_LABELS = Object.fromEntries(ALL_TABLES.map(({ key, label }) => [key, label]));

function TableCheckboxList({ tables, selected, onChange, disabled }) {
  const allChecked = tables.every((t) => selected.includes(t.key));
  const toggleAll = () => {
    if (allChecked) {
      onChange([]);
    } else {
      onChange(tables.map((t) => t.key));
    }
  };
  const toggle = (key) => {
    if (selected.includes(key)) {
      onChange(selected.filter((k) => k !== key));
    } else {
      onChange([...selected, key]);
    }
  };
  return (
    <div style={{ marginBottom: "16px" }}>
      <label style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px", fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer" }}>
        <input
          type="checkbox"
          checked={allChecked}
          onChange={toggleAll}
          disabled={disabled}
        />
        Alle auswählen
      </label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 24px" }}>
        {tables.map(({ key, label }) => (
          <label key={key} style={{ display: "flex", alignItems: "center", gap: "6px", cursor: disabled ? "not-allowed" : "pointer" }}>
            <input
              type="checkbox"
              checked={selected.includes(key)}
              onChange={() => toggle(key)}
              disabled={disabled}
            />
            {label}
          </label>
        ))}
      </div>
    </div>
  );
}

export default function Datensicherung() {
  // --- Export state ---
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);
  const [exportSelected, setExportSelected] = useState(ALL_TABLES.map((t) => t.key));

  // --- Import state ---
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState(null);
  // Parsed backup waiting for user confirmation
  const [pendingImport, setPendingImport] = useState(null); // { data, fileName, availableTables }
  const [importSelected, setImportSelected] = useState([]);

  const fileInputRef = useRef(null);

  // --- Export ---
  const handleExport = async () => {
    if (exportSelected.length === 0) {
      setExportError("Bitte mindestens eine Tabelle auswählen.");
      return;
    }
    setExporting(true);
    setExportError(null);
    try {
      const blob = await api.exportBackup(exportSelected);
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

  // --- Import: step 1 – parse file and show table selection ---
  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    // Reset the file input so the same file can be re-selected later
    if (fileInputRef.current) fileInputRef.current.value = "";

    setImportResult(null);
    setImportError(null);

    let data;
    try {
      const text = await file.text();
      data = JSON.parse(text);
    } catch {
      setImportError("Datei ist kein gültiges JSON");
      return;
    }

    // Detect which tables are present in the backup
    let tableKeys = [];
    if (data && typeof data === "object" && !Array.isArray(data) && data.tables) {
      tableKeys = Object.keys(data.tables);
    } else if (Array.isArray(data)) {
      tableKeys = data.filter((i) => i.type === "table" && i.name).map((i) => i.name);
    }

    // Keep only known tables in display order
    const availableTables = ALL_TABLES.filter((t) => tableKeys.includes(t.key));
    if (availableTables.length === 0) {
      setImportError("Keine bekannten Tabellen in der Backup-Datei gefunden.");
      return;
    }

    setPendingImport({ data, fileName: file.name, availableTables });
    setImportSelected(availableTables.map((t) => t.key));
  };

  // --- Import: step 2 – confirm and run ---
  const handleImportConfirm = async () => {
    if (!pendingImport) return;
    if (importSelected.length === 0) {
      setImportError("Bitte mindestens eine Tabelle auswählen.");
      return;
    }

    setImporting(true);
    setImportResult(null);
    setImportError(null);

    try {
      const result = await api.importBackup(pendingImport.data, importSelected);
      setImportResult(result);
      setPendingImport(null);
    } catch (err) {
      setImportError(err.message);
    } finally {
      setImporting(false);
    }
  };

  const handleImportCancel = () => {
    setPendingImport(null);
    setImportSelected([]);
    setImportError(null);
  };

  return (
    <div className="page-header">
      <h2>Datensicherung</h2>
      <p style={{ marginBottom: "32px", fontSize: "1rem", lineHeight: "1.5" }}>
        Exportieren Sie ausgewählte Tabellen als JSON-Backup oder stellen Sie
        einen früheren Stand aus einer Backup-Datei wieder her.
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
              Beim Import werden die <strong>vorhandenen Datensätze der ausgewählten Tabellen gelöscht</strong> und
              durch den Inhalt der Backup-Datei ersetzt. Dieser Vorgang kann nicht rückgängig gemacht werden.
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
          <p style={{ marginBottom: "16px", lineHeight: "1.6" }}>
            Wählen Sie die Tabellen aus, die in die Backup-Datei aufgenommen werden sollen.
            Die Datei kann später für einen Import verwendet werden.
          </p>
          <TableCheckboxList
            tables={ALL_TABLES}
            selected={exportSelected}
            onChange={setExportSelected}
            disabled={exporting}
          />
          {exportError && (
            <div className="badge danger" style={{ marginBottom: "20px" }}>
              {exportError}
            </div>
          )}
          <button
            className="btn btn-primary"
            onClick={handleExport}
            disabled={exporting || exportSelected.length === 0}
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
          {!pendingImport ? (
            <>
              <p style={{ marginBottom: "20px", lineHeight: "1.6" }}>
                Wählen Sie eine Backup-Datei aus. Sie können danach auswählen, welche Tabellen
                wiederhergestellt werden sollen.
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
                className="btn btn-secondary"
                style={{ cursor: "pointer" }}
              >
                <FontAwesomeIcon icon={faFolderOpen} /> Backup-Datei wählen
              </label>
              <input
                id="import-file"
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleFileChange}
                style={{ display: "none" }}
              />
            </>
          ) : (
            <>
              <p style={{ marginBottom: "12px", lineHeight: "1.6" }}>
                <strong>Datei:</strong> {pendingImport.fileName}
              </p>
              <p style={{ marginBottom: "16px", lineHeight: "1.6" }}>
                <strong><FontAwesomeIcon icon={faExclamationTriangle} /> Achtung:</strong> Die Daten der ausgewählten Tabellen
                werden <strong>unwiderruflich überschrieben</strong>. Bitte wählen Sie die
                wiederherzustellenden Tabellen aus:
              </p>
              <TableCheckboxList
                tables={pendingImport.availableTables}
                selected={importSelected}
                onChange={setImportSelected}
                disabled={importing}
              />
              {importError && (
                <div className="badge danger" style={{ marginBottom: "16px", padding: "12px 16px" }}>
                  {importError}
                </div>
              )}
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                <button
                  className="btn btn-primary"
                  onClick={handleImportConfirm}
                  disabled={importing || importSelected.length === 0}
                >
                  {importing ? "Importiere…" : <><FontAwesomeIcon icon={faFileImport} /> Jetzt importieren</>}
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={handleImportCancel}
                  disabled={importing}
                >
                  Abbrechen
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
