import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import DataTable from "../components/DataTable";

const PRESET_HINTS = ["Edelstahl", "Nickelfrei", "versilbert", "vergoldet"];
const MAX_HINTS = 6;

export default function Etiketten({ showHeader = true }) {
  // Artikelauswahl
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [options, setOptions] = useState([]);
  const [loadedSearch, setLoadedSearch] = useState(null);
  const [rowQty, setRowQty] = useState({});

  // Druckliste
  const [items, setItems] = useState([]);

  // Gestaltung
  const [sizes, setSizes] = useState([]);
  const [labelSize, setLabelSize] = useState("small");
  const [selectedHints, setSelectedHints] = useState([]);
  const [customHint, setCustomHint] = useState("");

  // Vorschau
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewIdx, setPreviewIdx] = useState(0);
  const [loadedPayload, setLoadedPayload] = useState(null);
  const [previewScale, setPreviewScale] = useState(1);
  const [sizeMode, setSizeMode] = useState("fit");
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState("");

  const previewFrameRef = useRef(null);

  const totalLabels = items.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
  const totalTypes = items.length;
  const activeSize = sizes.find((s) => s.id === labelSize) || null;
  const hintsKey = selectedHints.join("|");
  const hintLimitReached = selectedHints.length >= MAX_HINTS;

  // Beim Entfernen von Artikeln darf der Vorschau-Index nicht ins Leere zeigen
  const activeIdx = Math.min(previewIdx, Math.max(items.length - 1, 0));
  const previewItem = items[activeIdx];
  const previewArtikelnummer = previewItem?.artikelnummer || "";

  // Stabile Referenz: identischer Payload => kein neuer Request, kein Flackern
  const previewPayload = useMemo(
    () => ({
      items: previewArtikelnummer
        ? [{ artikelnummer: previewArtikelnummer, qty: 1 }]
        : [],
      materialHints: hintsKey ? hintsKey.split("|") : [],
      labelSize,
      mode: "single",
    }),
    [previewArtikelnummer, hintsKey, labelSize],
  );

  const loadingOptions = loadedSearch !== debouncedSearch;
  const previewLoading = loadedPayload !== previewPayload;

  useEffect(() => {
    api
      .getEtikettenSizes()
      .then((res) => {
        setSizes(res.sizes || []);
        setLabelSize((current) =>
          (res.sizes || []).some((s) => s.id === current)
            ? current
            : res.defaultSize || "small",
        );
      })
      .catch(() => setError("Etikettengrößen konnten nicht geladen werden"));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    api
      .getEtikettenOptions({ q: debouncedSearch, limit: "200" })
      .then((json) => {
        if (cancelled) return;
        setOptions(json || []);
        setError("");
      })
      .catch((err) => {
        if (cancelled) return;
        setOptions([]);
        setError(err.message || "Fehler beim Laden der Artikel");
      })
      .finally(() => !cancelled && setLoadedSearch(debouncedSearch));
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch]);

  // Live-Vorschau: genau ein Etikett, so wie es der Drucker ausgibt
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .getEtikettenPreview(previewPayload)
        .then((html) => !cancelled && setPreviewHtml(html))
        .catch(() => !cancelled && setPreviewHtml(""))
        .finally(() => !cancelled && setLoadedPayload(previewPayload));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [previewPayload]);

  // Das Vorschaudokument meldet seinen berechneten Maßstab zurück
  useEffect(() => {
    const onMessage = (event) => {
      if (event.data?.type === "etikett-scale") {
        setPreviewScale(event.data.scale || 1);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    previewFrameRef.current?.contentWindow?.postMessage(
      { type: "etikett-size-mode", mode: sizeMode },
      "*",
    );
  }, [sizeMode, previewHtml]);

  function addItem(artikelnummer, qty) {
    const addQty = Math.max(1, parseInt(String(qty), 10) || 1);
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.artikelnummer === artikelnummer);
      if (idx < 0) return [...prev, { artikelnummer, qty: addQty }];
      const next = [...prev];
      next[idx] = { ...next[idx], qty: (Number(next[idx].qty) || 0) + addQty };
      return next;
    });
    setRowQty((prev) => ({ ...prev, [artikelnummer]: 1 }));
  }

  function updateQty(idx, qty) {
    setItems((prev) =>
      prev.map((it, i) =>
        i === idx ? { ...it, qty: Math.max(1, Number(qty) || 1) } : it,
      ),
    );
  }

  function removeItem(idx) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function toggleHint(hint) {
    setSelectedHints((prev) => {
      if (prev.includes(hint)) return prev.filter((h) => h !== hint);
      return prev.length >= MAX_HINTS ? prev : [...prev, hint];
    });
  }

  function addCustomHint() {
    const value = customHint.trim();
    if (!value) return;
    setSelectedHints((prev) =>
      prev.includes(value) || prev.length >= MAX_HINTS ? prev : [...prev, value],
    );
    setCustomHint("");
  }

  function exportCsv() {
    const lines = [
      "Anzahl;Artikelnummer",
      ...items.map((it) => `${it.qty};${it.artikelnummer}`),
    ];
    const blob = new Blob([lines.join("\r\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "etiketten.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function importCsvFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const rows = String(reader.result || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      let imported = 0;
      for (const row of rows) {
        const [rawQty, rawArtikelnummer] = row.split(";").map((p) => p.trim());
        if (!rawArtikelnummer) continue;
        if (/^anzahl$/i.test(rawQty) && /^artikelnummer$/i.test(rawArtikelnummer)) {
          continue;
        }
        addItem(rawArtikelnummer, parseInt(rawQty, 10) || 1);
        imported++;
      }
      setError(
        imported === 0
          ? "Keine gültigen Zeilen gefunden. Erwartetes Format: Anzahl;Artikelnummer"
          : "",
      );
    };
    reader.readAsText(file, "utf-8");
  }

  async function fetchPrintHtml() {
    return api.getEtikettenPreview({
      items,
      materialHints: selectedHints,
      labelSize,
      mode: "print",
    });
  }

  // Druck über ein verstecktes iframe – kein Popup, das geblockt werden kann
  async function printLabels() {
    if (items.length === 0) return;
    setPrinting(true);
    setError("");
    try {
      const html = await fetchPrintHtml();
      const frame = document.createElement("iframe");
      frame.className = "etikett-print-frame";
      frame.srcdoc = html;
      frame.onload = () => {
        const win = frame.contentWindow;
        win.addEventListener("afterprint", () => frame.remove());
        win.focus();
        win.print();
      };
      document.body.appendChild(frame);
    } catch (err) {
      setError(err.message || "Fehler beim Drucken der Etiketten");
    } finally {
      setPrinting(false);
    }
  }

  async function openPrintTab() {
    if (items.length === 0) return;
    // Fenster synchron öffnen, sonst greift der Popup-Blocker nach dem await
    const win = window.open("", "_blank");
    if (!win) {
      setError("Popup blockiert. Bitte Popups für diese Seite erlauben.");
      return;
    }
    setError("");
    try {
      const html = await fetchPrintHtml();
      win.document.open();
      win.document.write(html);
      win.document.close();
    } catch (err) {
      win.close();
      setError(err.message || "Fehler beim Erstellen der Druckansicht");
    }
  }

  function clearList() {
    setItems([]);
    setPreviewIdx(0);
  }

  const optionColumns = [
    { key: "artikelnummer", label: "Artikelnummer", sortable: true },
    { key: "name", label: "Name", sortable: true, render: (r) => r.name || "—" },
    {
      key: "action",
      label: "",
      className: "etikett-col-action",
      render: (r) => (
        <div className="etikett-row-action">
          <input
            className="form-control etikett-qty"
            type="number"
            min="1"
            aria-label={`Anzahl für ${r.artikelnummer}`}
            value={rowQty[r.artikelnummer] ?? 1}
            onChange={(e) =>
              setRowQty((prev) => ({
                ...prev,
                [r.artikelnummer]: e.target.value,
              }))
            }
          />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={(e) => {
              e.stopPropagation();
              addItem(r.artikelnummer, rowQty[r.artikelnummer] ?? 1);
            }}>
            Übernehmen
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="etiketten-page">
      {showHeader && (
        <div className="page-header">
          <div>
            <h2>Etiketten</h2>
            <p>Artikel wählen, Etikett gestalten, drucken</p>
          </div>
        </div>
      )}

      {error && (
        <div className="etikett-alert" role="alert">
          <span>{error}</span>
          <button
            type="button"
            className="etikett-alert-close"
            aria-label="Meldung schließen"
            onClick={() => setError("")}>
            ✕
          </button>
        </div>
      )}

      <div className="etiketten-grid">
        <div className="etiketten-workflow">
          <section className="card">
            <div className="card-header">
              <h3>
                <span className="etikett-step">1</span> Artikel auswählen
              </h3>
              <span className="badge info">{options.length} Treffer</span>
            </div>
            <div className="card-body">
              <input
                className="form-control etikett-search"
                placeholder="Suche nach Artikelnummer oder Name"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="etikett-options">
                {loadingOptions ? (
                  <p className="etikett-hint-text">Lade Artikel …</p>
                ) : options.length === 0 ? (
                  <p className="etikett-hint-text">Keine Artikel gefunden</p>
                ) : (
                  <DataTable
                    columns={optionColumns}
                    data={options}
                    getRowKey={(r) => r.artikelnummer}
                  />
                )}
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <div className="etikett-card-title">
                <h3>
                  <span className="etikett-step">2</span> Druckliste
                </h3>
                <span className="badge info">
                  {totalLabels} Etiketten · {totalTypes} Typen
                </span>
              </div>
              <div className="btn-group">
                <label htmlFor="etiketten-csv-import" className="btn btn-secondary btn-sm">
                  CSV importieren
                </label>
                <input
                  id="etiketten-csv-import"
                  type="file"
                  accept=".csv,text/csv"
                  className="etikett-file-input"
                  onChange={(e) => {
                    importCsvFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={exportCsv}
                  disabled={items.length === 0}>
                  CSV exportieren
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={clearList}
                  disabled={items.length === 0}>
                  Liste leeren
                </button>
              </div>
            </div>
            <div className="card-body">
              {items.length === 0 ? (
                <p className="etikett-hint-text">
                  Noch keine Artikel in der Druckliste.
                </p>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Artikelnummer</th>
                      <th className="etikett-col-qty">Anzahl</th>
                      <th className="etikett-col-action"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, idx) => (
                      <tr
                        key={it.artikelnummer}
                        className={idx === activeIdx ? "etikett-row-active" : ""}>
                        <td>
                          <button
                            type="button"
                            className="etikett-link"
                            onClick={() => setPreviewIdx(idx)}>
                            {it.artikelnummer}
                          </button>
                        </td>
                        <td>
                          <input
                            className="form-control etikett-qty"
                            type="number"
                            min="1"
                            aria-label={`Anzahl für ${it.artikelnummer}`}
                            value={it.qty}
                            onChange={(e) => updateQty(idx, e.target.value)}
                          />
                        </td>
                        <td className="etikett-col-action">
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={() => removeItem(idx)}>
                            Entfernen
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>{totalTypes} Typen</td>
                      <td colSpan={2}>{totalLabels} Etiketten gesamt</td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <h3>
                <span className="etikett-step">3</span> Etikett gestalten
              </h3>
            </div>
            <div className="card-body etikett-design">
              <fieldset className="etikett-fieldset">
                <legend>Etikettengröße</legend>
                <div className="etikett-size-grid">
                  {sizes.map((size) => (
                    <label
                      key={size.id}
                      className={`etikett-size-option${
                        labelSize === size.id ? " is-active" : ""
                      }`}>
                      <input
                        type="radio"
                        name="labelSize"
                        value={size.id}
                        checked={labelSize === size.id}
                        onChange={() => setLabelSize(size.id)}
                      />
                      <span className="etikett-size-name">{size.name}</span>
                      <span className="etikett-size-dim">
                        {size.w} × {size.h} mm
                      </span>
                      <span className="etikett-size-meta">
                        {size.showQr ? "mit QR-Code" : "ohne QR-Code"}
                        {size.rotate ? " · gedreht" : ""}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset className="etikett-fieldset">
                <legend>
                  Materialhinweise ({selectedHints.length}/{MAX_HINTS})
                </legend>
                <div className="etikett-chips">
                  {PRESET_HINTS.map((hint) => (
                    <button
                      key={hint}
                      type="button"
                      aria-pressed={selectedHints.includes(hint)}
                      className={`etikett-chip${
                        selectedHints.includes(hint) ? " is-active" : ""
                      }`}
                      disabled={hintLimitReached && !selectedHints.includes(hint)}
                      onClick={() => toggleHint(hint)}>
                      {hint}
                    </button>
                  ))}
                  {selectedHints
                    .filter((hint) => !PRESET_HINTS.includes(hint))
                    .map((hint) => (
                      <button
                        key={hint}
                        type="button"
                        aria-pressed="true"
                        className="etikett-chip is-active"
                        aria-label={`Hinweis ${hint} entfernen`}
                        onClick={() => toggleHint(hint)}>
                        {hint} ✕
                      </button>
                    ))}
                </div>
                <div className="etikett-custom-hint">
                  <input
                    className="form-control"
                    placeholder="Eigener Hinweis"
                    aria-label="Eigener Hinweis"
                    value={customHint}
                    disabled={hintLimitReached}
                    onChange={(e) => setCustomHint(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      addCustomHint();
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={addCustomHint}
                    disabled={!customHint.trim() || hintLimitReached}>
                    Hinweis hinzufügen
                  </button>
                </div>
              </fieldset>
            </div>
          </section>
        </div>

        <aside className="etiketten-preview">
          <section className="card">
            <div className="card-header">
              <h3>Druckvorschau</h3>
              {activeSize && (
                <span className="badge gold">
                  {activeSize.w} × {activeSize.h} mm
                </span>
              )}
            </div>
            <div className="card-body">
              <div className="etikett-stage">
                {previewHtml ? (
                  <iframe
                    ref={previewFrameRef}
                    className="etikett-stage-frame"
                    title="Etikettenvorschau"
                    srcDoc={previewHtml}
                    onLoad={() =>
                      previewFrameRef.current?.contentWindow?.postMessage(
                        { type: "etikett-size-mode", mode: sizeMode },
                        "*",
                      )
                    }
                  />
                ) : (
                  <p className="etikett-hint-text">Vorschau wird erstellt …</p>
                )}
                {previewLoading && previewHtml && (
                  <span className="etikett-stage-busy">aktualisiere …</span>
                )}
              </div>

              <div className="etikett-stage-bar">
                <div className="btn-group">
                  <button
                    type="button"
                    className={`btn btn-sm ${sizeMode === "fit" ? "btn-primary" : "btn-secondary"}`}
                    onClick={() => setSizeMode("fit")}>
                    Einpassen
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm ${sizeMode === "actual" ? "btn-primary" : "btn-secondary"}`}
                    onClick={() => setSizeMode("actual")}>
                    Originalgröße
                  </button>
                </div>
                <span className="etikett-scale">
                  Maßstab {previewScale.toFixed(1).replace(".", ",")}:1
                </span>
              </div>

              {items.length > 0 && (
                <div className="etikett-nav">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    aria-label="Vorheriges Etikett"
                    disabled={activeIdx <= 0}
                    onClick={() => setPreviewIdx(Math.max(0, activeIdx - 1))}>
                    ◀
                  </button>
                  <span className="etikett-nav-label">
                    {previewArtikelnummer} · {activeIdx + 1} von {totalTypes}
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    aria-label="Nächstes Etikett"
                    disabled={activeIdx >= items.length - 1}
                    onClick={() =>
                      setPreviewIdx(Math.min(items.length - 1, activeIdx + 1))
                    }>
                    ▶
                  </button>
                </div>
              )}

              {items.length === 0 && (
                <p className="etikett-hint-text">
                  Musteretikett – Größe und Hinweise lassen sich vorab prüfen.
                </p>
              )}

              <div className="etikett-summary">
                <span className="etikett-summary-item">
                  <span className="etikett-summary-value">{totalLabels}</span>
                  <span className="etikett-summary-label">
                    Etikett{totalLabels === 1 ? "" : "en"} im Druck
                  </span>
                </span>
                <span className="etikett-summary-item">
                  <span className="etikett-summary-value">{totalTypes}</span>
                  <span className="etikett-summary-label">
                    {totalTypes === 1 ? "Artikeltyp" : "Artikeltypen"}
                  </span>
                </span>
              </div>

              <div className="etikett-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  onClick={printLabels}
                  disabled={items.length === 0 || printing}>
                  {printing
                    ? "Drucke …"
                    : `${totalLabels} Etikett${totalLabels === 1 ? "" : "en"} drucken`}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-block"
                  onClick={openPrintTab}
                  disabled={items.length === 0}>
                  Druckansicht im neuen Tab
                </button>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
