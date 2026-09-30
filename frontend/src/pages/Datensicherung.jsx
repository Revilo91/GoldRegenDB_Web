import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faExclamationTriangle,
  faInfoCircle,
  faFileExport,
  faFileImport,
  faCheckCircle,
  faDownload,
  faFolderOpen,
  faImages,
  faDatabase,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../api";
import { useToast } from "../components/Toast";
import { parseSqlDump } from "../utils/sqlDump";

// Nur die deutschen Beschriftungen stehen hier – welche Tabellen es gibt,
// liefert GET /api/backup/tables aus dem Systemkatalog (Befund B18). Die
// frühere Handliste hier filterte Export UND Import: eine Tabelle, die sie
// nicht kannte, wurde stillschweigend übersprungen, auch wenn das Backend sie
// exportiert hätte. Ein unbekannter Name erscheint jetzt unter seinem
// Rohnamen statt zu verschwinden.
const TABLE_LABELS = {
  Kunde: "Kunden",
  Lieferschein: "Lieferscheine",
  Rechnung: "Rechnungen",
  Schmuckstück: "Schmuckstücke",
  audit_log: "Audit-Log",
  app_users: "Benutzer",
  lagerinventur: "Lagerinventur",
  bestellung: "Bestellungen",
  bestellung_kunde: "Bestellkunden",
  bestellung_consent: "Einwilligungen (DSGVO)",
};

const beschriftung = (name) => TABLE_LABELS[name] ?? name;

// Fällt /backup/tables aus, bleibt die Seite bedienbar: diese Reihenfolge ist
// FK-sicher und deckt den Stand bei Auslieferung ab.
const TABELLEN_FALLBACK = Object.keys(TABLE_LABELS);

const alsAuswahl = (namen) =>
  namen.map((name) => ({ key: name, label: beschriftung(name) }));

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
    <div className="datensicherung-mb-16">
      <label
        className={`datensicherung-flex-ai-center-gap-8-mb-8-fw-600 ${disabled ? "datensicherung-cursor-not-allowed" : "cursor-pointer"}`}>
        <input
          type="checkbox"
          className="form-checkbox"
          checked={allChecked}
          onChange={toggleAll}
          disabled={disabled}
        />
        Alle auswählen
      </label>
      <div className="datensicherung-flex-wrap-wrap-gap-8-24">
        {tables.map(({ key, label }) => (
          <label
            key={key}
            className={`datensicherung-flex-ai-center-gap-6 ${disabled ? "datensicherung-cursor-not-allowed" : "cursor-pointer"}`}>
            <input
              type="checkbox"
              className="form-checkbox"
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

function FotoImportStand({ job }) {
  const { gesamt, verarbeitet, gespeichert, uebersprungen, uebersprungenDetails } = job;
  const titel = {
    running: "Fotos werden importiert…",
    completed: "Foto-Import abgeschlossen",
    failed: "Foto-Import abgebrochen",
  }[job.status];
  return (
    <div className="datensicherung-fortschritt" role="status">
      <strong>{titel}</strong>
      <progress value={verarbeitet} max={gesamt || 1} />
      <div>
        {verarbeitet} von {gesamt} Dateien verarbeitet ·{" "}
        {gespeichert.schmuckstueck} Schmuckstück-Fotos,{" "}
        {gespeichert.bestellung} Bestellfotos gespeichert
        {uebersprungen > 0 && ` · ${uebersprungen} übersprungen`}
      </div>
      {job.fehler && <div>Ursache: {job.fehler}</div>}
      {uebersprungenDetails.length > 0 && (
        <details>
          <summary>
            Übersprungene Dateien
            {uebersprungen > uebersprungenDetails.length &&
              ` (die ersten ${uebersprungenDetails.length}, alle im Server-Log)`}
          </summary>
          <ul>
            {uebersprungenDetails.map(({ datei, grund }, i) => (
              <li key={`${i}-${datei}`}>
                <code>{datei}</code>: {grund}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export default function Datensicherung() {
  const toast = useToast();

  // --- Export state ---
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);
  const [tabellen, setTabellen] = useState(TABELLEN_FALLBACK);
  const [exportSelected, setExportSelected] = useState(TABELLEN_FALLBACK);

  // --- Import state ---
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState(null);
  // Parsed backup waiting for user confirmation
  const [pendingImport, setPendingImport] = useState(null); // { data, fileName, availableTables }
  const [importSelected, setImportSelected] = useState([]);

  // --- Foto-ZIP ---
  const [fotoZipDatei, setFotoZipDatei] = useState(null);
  const [fotoImportLaeuft, setFotoImportLaeuft] = useState(false);
  const [fotoImportJob, setFotoImportJob] = useState(null);

  const fileInputRef = useRef(null);
  const fotoZipInputRef = useRef(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    // StrictMode baut die Komponente in der Entwicklung zweimal auf – ohne das
    // Zurücksetzen bliebe die Ref nach dem ersten Abbau dauerhaft false.
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Tabellen aus dem Katalog holen. Schlägt das fehl, bleibt der Fallback
  // stehen – die Seite ist dann weiter bedienbar, nur ohne neue Tabellen.
  useEffect(() => {
    let verworfen = false;
    api
      .getBackupTables()
      .then((antwort) => {
        const namen = (antwort?.tables || [])
          .map((t) => t.name)
          .filter(Boolean);
        if (verworfen || namen.length === 0) return;
        setTabellen(namen);
        setExportSelected(namen);
      })
      .catch(() => {
        /* Fallback-Liste bleibt; der Export funktioniert weiterhin. */
      });
    return () => {
      verworfen = true;
    };
  }, []);

  const triggerDownload = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // --- Export ---
  const handleExport = async (format) => {
    if (exportSelected.length === 0) {
      setExportError("Bitte mindestens eine Tabelle auswählen.");
      return;
    }
    setExporting(true);
    setExportError(null);
    try {
      const formattedDate = new Date().toISOString().slice(0, 10);
      if (format === "sql") {
        const blob = await api.exportBackupSql(exportSelected);
        triggerDownload(blob, `goldregendb_dump_${formattedDate}.sql`);
        return;
      }
      const blob = await api.exportBackup(exportSelected);
      triggerDownload(blob, `goldregendb_backup_${formattedDate}.json`);
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
    if (/\.sql$/i.test(file.name)) {
      try {
        data = parseSqlDump(await file.text());
      } catch (err) {
        setImportError(`SQL-Dump nicht lesbar: ${err.message}`);
        return;
      }
    } else {
      try {
        data = JSON.parse(await file.text());
      } catch {
        setImportError("Datei ist kein gültiges JSON");
        return;
      }
    }

    // Detect which tables are present in the backup
    let tableKeys = [];
    if (
      data &&
      typeof data === "object" &&
      !Array.isArray(data) &&
      data.tables
    ) {
      tableKeys = Object.keys(data.tables);
    } else if (Array.isArray(data)) {
      tableKeys = data
        .filter((i) => i.type === "table" && i.name)
        .map((i) => i.name);
    }

    // Alles anbieten, was in der Datei steht – in der Reihenfolge des Schemas,
    // Unbekanntes hinten. Das Backend prüft die Namen ohnehin gegen den
    // Katalog und benennt in `ignorierteTabellen`, was es nicht kennt.
    const bekannt = tabellen.filter((t) => tableKeys.includes(t));
    const unbekannt = tableKeys.filter((t) => !tabellen.includes(t)).sort();
    const availableTables = alsAuswahl([...bekannt, ...unbekannt]);
    if (availableTables.length === 0) {
      setImportError("Keine Tabellen in der Backup-Datei gefunden.");
      return;
    }

    setPendingImport({
      data,
      fileName: file.name,
      availableTables,
    });
    setImportSelected(availableTables.map((t) => t.key));
  };

  const handleFotoZipChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (fotoZipInputRef.current) fotoZipInputRef.current.value = "";
    setFotoZipDatei(file);
    setFotoImportJob(null);
  };

  // Der Server antwortet nach dem Upload sofort mit einem Job und importiert im
  // Hintergrund – ein Request über den ganzen Import liefe in Proxy-Timeouts.
  const handleFotoImport = async () => {
    if (!fotoZipDatei) return;
    setFotoImportLaeuft(true);
    setFotoImportJob(null);
    try {
      let { job } = await api.importBackupFotosZip(fotoZipDatei);
      while (job.status === "running") {
        if (!isMountedRef.current) return;
        setFotoImportJob(job);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        ({ job } = await api.getBackupFotosImportJob(job.id));
      }
      if (!isMountedRef.current) return;
      setFotoImportJob(job);
      if (job.status === "failed") {
        toast.fehler(`Foto-Import abgebrochen: ${job.fehler}`);
      } else {
        setFotoZipDatei(null);
        toast.erfolg("Foto-Import abgeschlossen");
      }
    } catch (err) {
      if (isMountedRef.current) {
        toast.fehler(err.message || "Fehler beim Foto-Import");
      }
    } finally {
      if (isMountedRef.current) setFotoImportLaeuft(false);
    }
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
      // Das ganze Ergebnis übernehmen: kaskadierteTabellen, ignorierteTabellen
      // und auditKette gingen vorher beim Umkopieren verloren.
      setImportResult(await api.importBackup(pendingImport.data, importSelected));
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
      <p className="datensicherung-mb-32-fs-1rem-lh-1_5">
        Exportieren Sie ausgewählte Tabellen als JSON-Backup oder stellen Sie
        einen früheren Stand aus einer Backup-Datei wieder her. Die Fotos
        stehen nicht im JSON, sie werden als eigenes ZIP gesichert.
      </p>

      {/* Warning Card */}
      <div className="alert-card warning">
        <div className="alert-card-body">
          <div className="alert-card-title">
            <span>
              <FontAwesomeIcon icon={faExclamationTriangle} />
            </span>
            <span>Wichtiger Hinweis</span>
          </div>
          <div className="alert-card-content">
            <p>
              Beim Import werden die{" "}
              <strong>
                vorhandenen Datensätze der ausgewählten Tabellen gelöscht
              </strong>{" "}
              und durch den Inhalt der Backup-Datei ersetzt. Dieser Vorgang kann
              nicht rückgängig gemacht werden.
            </p>
          </div>
        </div>
      </div>

      {/* Info Card */}
      <div className="alert-card info">
        <div className="alert-card-body">
          <div className="alert-card-title">
            <span>
              <FontAwesomeIcon icon={faInfoCircle} />
            </span>
            <span>Datenpersistenz bei Docker-Neustart</span>
          </div>
          <div className="alert-card-content">
            <p>
              Die Datenbankdaten werden im Docker-Volume <code>pgdata</code>{" "}
              gespeichert und bleiben bei einem normalen{" "}
              <code>docker compose restart</code> oder{" "}
              <code>docker compose down &amp;&amp; docker compose up</code>{" "}
              erhalten. Verwenden Sie niemals{" "}
              <code>docker compose down -v</code>, da dieser Befehl alle Volumes
              und damit alle Daten unwiderruflich löscht. Erstellen Sie vor
              riskanten Aktionen stets ein Backup über die Export-Funktion
              unten.
            </p>
          </div>
        </div>
      </div>

      {/* Export Section */}
      <div className="card datensicherung-mb-32">
        <div className="card-header datensicherung-p-20-24">
          <h3>
            <FontAwesomeIcon icon={faFileExport} /> Daten exportieren
          </h3>
        </div>
        <div className="card-body datensicherung-p-24">
          <p className="datensicherung-mb-16-lh-1_6">
            Wählen Sie die Tabellen aus, die in die Backup-Datei aufgenommen
            werden sollen. Die Datei kann später für einen Import verwendet
            werden.
          </p>
          <TableCheckboxList
            tables={alsAuswahl(tabellen)}
            selected={exportSelected}
            onChange={setExportSelected}
            disabled={exporting}
          />
          {exportError && (
            <div className="badge danger datensicherung-mb-20">
              {exportError}
            </div>
          )}
          <div className="datensicherung-knoepfe">
            <button
              className="btn btn-primary"
              onClick={() => handleExport("json")}
              disabled={exporting || exportSelected.length === 0}>
              {exporting ? (
                "Exportiere…"
              ) : (
                <>
                  <FontAwesomeIcon icon={faDownload} /> Backup herunterladen
                </>
              )}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => handleExport("sql")}
              disabled={exporting || exportSelected.length === 0}>
              <FontAwesomeIcon icon={faDatabase} /> Als SQL-Dump herunterladen
            </button>
          </div>

          <div className="datensicherung-abschnitt">
            <p>
              Alle Fotos (Schmuckstücke und Bestellungen) als ZIP. Der Browser
              lädt die Datei direkt herunter, den Fortschritt zeigt seine
              Download-Anzeige.
            </p>
            {/* Nativer Download statt fetch: das ZIP kann über 1 GB groß sein
                und landet so direkt auf der Platte statt als Blob im Speicher. */}
            <a className="btn btn-secondary" href={api.fotoBackupUrl} download>
              <FontAwesomeIcon icon={faImages} /> Fotos als ZIP herunterladen
            </a>
          </div>
        </div>
      </div>

      {/* Import Section */}
      <div className="card">
        <div className="card-header datensicherung-p-20-24">
          <h3>
            <FontAwesomeIcon icon={faFileImport} /> Daten importieren
          </h3>
        </div>
        <div className="card-body datensicherung-p-24">
          {!pendingImport ? (
            <>
              <p className="datensicherung-mb-20-lh-1_6">
                Wählen Sie eine Backup-Datei aus (JSON-Backup oder SQL-Dump
                aus <code>pg_dump</code>/<code>pg_dumpall</code>). Sie können
                danach auswählen, welche Tabellen wiederhergestellt werden
                sollen. Aus einem SQL-Dump werden nur die Daten übernommen,
                keine Schema-Anweisungen.
              </p>

              {importResult && (
                <div
                  className="badge success datensicherung-mb-20-p-12-16">
                  <FontAwesomeIcon icon={faCheckCircle} /> Import erfolgreich!
                  Importiert:{" "}
                  {Object.entries(importResult.counts || {})
                    .map(([t, n]) => `${n} ${beschriftung(t)}`)
                    .join(", ")}
                </div>
              )}
              {importResult?.kaskadierteTabellen?.length > 0 && (
                <div className="badge warning datensicherung-meldung">
                  <FontAwesomeIcon icon={faExclamationTriangle} /> Zusätzlich
                  geleert (Fremdschlüssel zeigen auf die importierten
                  Tabellen):{" "}
                  {importResult.kaskadierteTabellen
                    .map((t) => beschriftung(t))
                    .join(", ")}
                </div>
              )}
              {importResult?.ignorierteTabellen?.length > 0 && (
                <div className="badge warning datensicherung-meldung">
                  <FontAwesomeIcon icon={faExclamationTriangle} /> Im Backup
                  enthalten, im aktuellen Schema unbekannt – nicht importiert:{" "}
                  {importResult.ignorierteTabellen.join(", ")}
                </div>
              )}
              {importResult?.auditKette &&
                !importResult.auditKette.gueltig && (
                  <div className="badge warning datensicherung-meldung">
                    <FontAwesomeIcon icon={faExclamationTriangle} /> Die
                    Hash-Kette des importierten Audit-Logs ist nicht
                    durchgehend (
                    {importResult.auditKette.kaputteEintraege.length} Einträge).
                    Bei einem Teil-Import des Audit-Logs ist das zu erwarten.
                  </div>
                )}
              {importError && (
                <div
                  className="badge danger datensicherung-mb-20-p-12-16">
                  {importError}
                </div>
              )}

              <label
                htmlFor="import-file"
                className="btn btn-secondary cursor-pointer">
                <FontAwesomeIcon icon={faFolderOpen} /> Backup-Datei oder
                SQL-Dump wählen
              </label>
              <input
                id="import-file"
                ref={fileInputRef}
                type="file"
                accept=".json,application/json,.sql,application/sql"
                onChange={handleFileChange} className="visually-hidden-input"
              />

              <div className="datensicherung-abschnitt">
                <p>
                  Fotos aus einem Foto-ZIP wiederherstellen. Fotos im ZIP
                  ersetzen vorhandene mit gleicher Nummer, alle anderen bleiben
                  erhalten.
                </p>
                <label
                  htmlFor="foto-zip-file"
                  className="btn btn-secondary"
                  aria-disabled={fotoImportLaeuft}>
                  <FontAwesomeIcon icon={faFolderOpen} /> Foto-ZIP wählen
                </label>
                <input
                  id="foto-zip-file"
                  ref={fotoZipInputRef}
                  type="file"
                  accept=".zip,application/zip"
                  onChange={handleFotoZipChange}
                  className="visually-hidden-input"
                  disabled={fotoImportLaeuft}
                />
                {fotoZipDatei && (
                  <p className="datensicherung-datei">
                    Gewählte ZIP: <strong>{fotoZipDatei.name}</strong>
                  </p>
                )}
                {fotoZipDatei && !fotoImportJob && (
                  <button
                    className="btn btn-primary"
                    onClick={handleFotoImport}
                    disabled={fotoImportLaeuft}>
                    {fotoImportLaeuft
                      ? "ZIP wird hochgeladen…"
                      : "Fotos jetzt importieren"}
                  </button>
                )}
                {fotoImportJob && <FotoImportStand job={fotoImportJob} />}
              </div>
            </>
          ) : (
            <>
              <p className="datensicherung-mb-12-lh-1_6">
                <strong>Datei:</strong> {pendingImport.fileName}
              </p>
              <p className="datensicherung-mb-16-lh-1_6">
                <strong>
                  <FontAwesomeIcon icon={faExclamationTriangle} /> Achtung:
                </strong>{" "}
                Die Daten der ausgewählten Tabellen werden{" "}
                <strong>unwiderruflich überschrieben</strong>. Bitte wählen Sie
                die wiederherzustellenden Tabellen aus:
              </p>
              <TableCheckboxList
                tables={pendingImport.availableTables}
                selected={importSelected}
                onChange={setImportSelected}
                disabled={importing}
              />
              {importError && (
                <div
                  className="badge danger datensicherung-mb-16-p-12-16">
                  {importError}
                </div>
              )}
              <div className="datensicherung-flex-gap-12-wrap-wrap">
                <button
                  className="btn btn-primary"
                  onClick={handleImportConfirm}
                  disabled={importing || importSelected.length === 0}>
                  {importing ? (
                    "Importiere…"
                  ) : (
                    <>
                      <FontAwesomeIcon icon={faFileImport} /> Jetzt importieren
                    </>
                  )}
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={handleImportCancel}
                  disabled={importing}>
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
