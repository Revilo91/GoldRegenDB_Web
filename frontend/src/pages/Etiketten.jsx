import { useEffect, useState, useRef } from "react";
import { api } from "../api";
import DataTable from "../components/DataTable";

export default function Etiketten({ showHeader = true }) {
  const [options, setOptions] = useState([]);
  const [error, setError] = useState("");
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [items, setItems] = useState([]);
  const [presetHints] = useState([
    "Edelstahl",
    "Nickelfrei",
    "versilbert",
    "vergoldet",
  ]);
  const [selectedHints, setSelectedHints] = useState([]);
  const [customHint, setCustomHint] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeAction, setActiveAction] = useState("preview");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [rowQty, setRowQty] = useState({});
  const [adding, setAdding] = useState({});
  const [labelSize, setLabelSize] = useState("extra-small");
  const addingRef = useRef({});
  const csvInputRef = useRef(null);
  const totalSelected = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 250);
    return () => clearTimeout(timeoutId);
  }, [search]);

  useEffect(() => {
    fetchOptions({ q: debouncedSearch });
  }, [debouncedSearch]);

  async function fetchOptions(params = {}) {
    setLoadingOptions(true);
    setError("");
    try {
      const query = {
        q: (params.q ?? debouncedSearch) || "",
        limit: "200",
      };
      const json = await api.getEtikettenOptions(query);
      const unique = json || [];
      setOptions(unique);
      setRowQty((prev) => {
        const next = { ...prev };
        for (const u of unique) {
          if (next[u.artikelnummer] == null) {
            next[u.artikelnummer] = 1;
          }
        }
        return next;
      });
    } catch (err) {
      console.error(err);
      setError(err.message || "Fehler beim Laden der Artikel");
      setOptions([]);
    } finally {
      setLoadingOptions(false);
    }
  }

  function addItemFromList(artikelnummer, q) {
    const addQty = Math.max(1, parseInt(String(q || 0), 10) || 1);
    setItems((prev) => {
      const existingIdx = prev.findIndex(
        (i) => i.artikelnummer === artikelnummer,
      );
      if (existingIdx >= 0) {
        const cp = [...prev];
        const existingQty = Number(cp[existingIdx].qty) || 0;
        cp[existingIdx] = { ...cp[existingIdx], qty: existingQty + addQty };
        console.debug("[Etikett] merged item", {
          artikelnummer,
          existingQty,
          addQty,
          newQty: cp[existingIdx].qty,
        });
        return cp;
      }
      const entry = { artikelnummer, qty: addQty };
      console.debug("[Etikett] new item added", entry);
      return [...prev, entry];
    });
    // reset rowQty for this artikelnummer to 1 (outside setItems to avoid nested state updates)
    setRowQty((r) => ({ ...r, [artikelnummer]: 1 }));
  }

  function updateQty(idx, newQty) {
    setItems((prev) => {
      const cp = [...prev];
      cp[idx].qty = newQty;
      return cp;
    });
  }

  function toggleHint(h) {
    setSelectedHints((prev) => {
      if (prev.includes(h)) {
        return prev.filter((x) => x !== h);
      } else {
        if (prev.length >= 6) return prev; // Maximal 6 Hinweise
        return [...prev, h];
      }
    });
  }

  function addCustomHint() {
    const val = customHint ? customHint.trim() : "";
    if (!val) return;
    setSelectedHints((prev) => {
      if (prev.includes(val)) return prev;
      if (prev.length >= 6) return prev; // Maximal 6 Hinweise
      return [...prev, val];
    });
    setCustomHint("");
  }

  function removeIndex(idx) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function exportCsv() {
    if (items.length === 0) return alert("Keine Artikel ausgewählt");
    const lines = [
      "Anzahl;Artikelnummer",
      ...items.map((it) => `${it.qty};${it.artikelnummer}`),
    ];
    const blob = new Blob([lines.join("\r\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "etiketten.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function importCsvFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const lines = String(reader.result || "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      let imported = 0;
      for (const line of lines) {
        const [rawQty, rawArtikelnummer] = line.split(";").map((p) => p.trim());
        if (/^anzahl$/i.test(rawQty) && /^artikelnummer$/i.test(rawArtikelnummer)) {
          continue; // Kopfzeile überspringen
        }
        if (!rawArtikelnummer) continue;
        addItemFromList(rawArtikelnummer, parseInt(rawQty, 10) || 1);
        imported++;
      }
      if (imported === 0) {
        alert(
          "Keine gültigen Zeilen gefunden. Erwartetes Format: Anzahl;Artikelnummer",
        );
      }
    };
    reader.readAsText(file, "utf-8");
  }

  async function preview({ autoPrint = false } = {}) {
    if (items.length === 0) return alert("Keine Artikel ausgewählt");
    const previewWindow = window.open("", "_blank");
    if (!previewWindow) {
      alert("Popup blockiert. Bitte Popups für diese Seite erlauben.");
      return;
    }

    previewWindow.document.open();
    previewWindow.document.write(
      "<html><head><title>Etiketten</title></head><body style=\"font-family: Arial, sans-serif; padding: 16px;\">Lade Etiketten...</body></html>",
    );
    previewWindow.document.close();

    setActiveAction(autoPrint ? "print" : "preview");
    setLoading(true);
    try {
      const html = await api.getEtikettenPreview({
        items,
        materialHints: selectedHints,
        labelSize,
      });
      // The backend already returns a full HTML document (including <head> and
      // a link to /api/etiketten/styles.css). Write it verbatim into the new
      // window so the stylesheet and scripts from the backend are applied.
      if (autoPrint) {
        previewWindow.onload = () => {
          previewWindow.focus();
          setTimeout(() => {
            previewWindow.print();
          }, 120);
        };
      }

      previewWindow.document.open();
      previewWindow.document.write(html);
      previewWindow.document.close();
    } catch (err) {
      console.error(err);
      previewWindow.close();
      alert(
        autoPrint
          ? "Fehler beim Drucken (Popup eventuell blockiert)"
          : "Fehler beim Erstellen der Vorschau",
      );
    } finally {
      setLoading(false);
      setActiveAction("preview");
    }
  }

  const columns = [
    {
      key: "artikelnummer",
      label: "Artikelnummer",
      sortable: true,
      render: (r) => r.artikelnummer,
    },
    { key: "name", label: "Name", render: (r) => r.name || "" },
    {
      key: "action",
      label: "Aktion",
      render: (r) => (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            className="form-control"
            type="number"
            min="1"
            value={rowQty[r.artikelnummer] ?? 1}
            onChange={(e) =>
              setRowQty((prev) => ({
                ...prev,
                [r.artikelnummer]: Number(e.target.value),
              }))
            }
            style={{ width: 80 }}
          />
          <button
            className="btn btn-primary"
            disabled={adding[r.artikelnummer]}
            onClick={(e) => {
              e.stopPropagation();
              if (addingRef.current[r.artikelnummer]) return;
              // set ref synchronously so repeated event triggers are ignored
              addingRef.current[r.artikelnummer] = true;
              setAdding((p) => ({ ...p, [r.artikelnummer]: true }));
              try {
                const q = Number(rowQty[r.artikelnummer]) || 1;
                addItemFromList(r.artikelnummer, q);
              } finally {
                setTimeout(() => {
                  addingRef.current[r.artikelnummer] = false;
                  setAdding((p) => ({ ...p, [r.artikelnummer]: false }));
                }, 300);
              }
            }}>
            {adding[r.artikelnummer] ? "..." : "Auswählen"}
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      {showHeader && (
        <div className="page-header">
          <div>
            <h2>Etiketten erstellen</h2>
            <p>{options.length} Treffer (max. 200 pro Anfrage)</p>
          </div>
        </div>
      )}
      <div
        className="toolbar flex-row-center"
        style={{ marginBottom: 12 }}>
        <input
          className="form-control"
          placeholder="Suche Artikelnummer oder Name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 260 }}
        />
        <button className="btn" onClick={() => fetchOptions()}>
          Aktualisieren
        </button>

        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}>
          <div className="badge info">{items.length} Typen</div>
          <div className="badge gold">{totalSelected} Gesamt</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          {/* toolbar moved to top */}

          <div className="card">
            <div className="card-header">
              <h3>Verfügbare Artikel</h3>
            </div>
            <div className="card-body">
              <div style={{ maxHeight: 420, overflow: "auto" }}>
                {loadingOptions ? (
                  <div style={{ padding: 12 }}>Lade Artikel...</div>
                ) : error ? (
                  <div style={{ color: "var(--danger, #c53030)", padding: 12 }}>
                    {error}
                  </div>
                ) : (
                  <DataTable
                    columns={columns}
                    data={options}
                    getRowKey={(r) => r.artikelnummer}
                  />
                )}
              </div>
            </div>
          </div>
        </div>

        <div style={{ width: 500 }}>
          <div className="card">
            <div className="card-header">
              <h3>Ausgewählte Etiketten</h3>
              <div style={{ display: "flex", gap: 8 }}>
                <label
                  htmlFor="etiketten-csv-import"
                  className="btn btn-secondary btn-sm"
                  style={{ cursor: "pointer" }}>
                  CSV importieren
                </label>
                <input
                  id="etiketten-csv-import"
                  ref={csvInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  style={{ display: "none" }}
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
              </div>
            </div>
            <div className="card-body">
              {items.length === 0 ? (
                <p>Keine Artikel ausgewählt</p>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Artikelnummer</th>
                      <th style={{ width: 92 }}>Anzahl</th>
                      <th style={{ width: 140 }}>Aktion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, idx) => (
                      <tr key={it.artikelnummer + "-" + idx}>
                        <td>{it.artikelnummer}</td>
                        <td>
                          <input
                            className="form-control"
                            type="number"
                            min="1"
                            value={it.qty}
                            onChange={(e) =>
                              updateQty(idx, Number(e.target.value) || 1)
                            }
                            style={{ width: 92 }}
                          />
                        </td>
                        <td>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => removeIndex(idx)}>
                            Entfernen
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="card mt-12">
            <div className="card-header">
              <h3>Etikettengröße</h3>
            </div>
            <div className="card-body">
              <div
                className="flex-col-gap-10">
                <label
                  className="flex-row-center">
                  <input
                    type="radio"
                    name="labelSize"
                    value="extra-small"
                    checked={labelSize === "extra-small"}
                    onChange={(e) => setLabelSize(e.target.value)}
                  />
                  <span>Extra Klein (30 × 20 mm)</span>
                </label>
                <label
                  className="flex-row-center">
                  <input
                    type="radio"
                    name="labelSize"
                    value="small"
                    checked={labelSize === "small"}
                    onChange={(e) => setLabelSize(e.target.value)}
                  />
                  <span>Klein (48 × 30 mm)</span>
                </label>
                <label
                  className="flex-row-center">
                  <input
                    type="radio"
                    name="labelSize"
                    value="medium"
                    checked={labelSize === "medium"}
                    onChange={(e) => setLabelSize(e.target.value)}
                  />
                  <span>Mittel (60 × 36 mm)</span>
                </label>
                <label
                  className="flex-row-center">
                  <input
                    type="radio"
                    name="labelSize"
                    value="large"
                    checked={labelSize === "large"}
                    onChange={(e) => setLabelSize(e.target.value)}
                  />
                  <span>Groß (80 × 48 mm)</span>
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="hints-wrapper">
        <div className="card">
          <div className="card-header">
            <h5>Materialhinweise (wählbar)</h5>
          </div>
          <div className="card-body">
            <div
              className="preset-hints flex-wrap-gap-12">
              {presetHints.map((h) => (
                <label
                  key={h}
                  htmlFor={`hint-${h}`}
                  style={{ display: "flex", gap: 6, alignItems: "center", opacity: selectedHints.length >= 6 && !selectedHints.includes(h) ? 0.5 : 1 }}>
                  <input
                    id={`hint-${h}`}
                    type="checkbox"
                    aria-label={`Materialhinweis ${h}`}
                    checked={selectedHints.includes(h)}
                    disabled={!selectedHints.includes(h) && selectedHints.length >= 6}
                    onChange={() => toggleHint(h)}
                  />
                  <span>{h}</span>
                </label>
              ))}
            </div>

            <div className="custom-hint-row" style={{ marginTop: 8 }}>
              <input
                placeholder="Eigener Hinweis"
                value={customHint}
                onChange={(e) => setCustomHint(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustomHint();
                  }
                }}
                aria-label="Eigener Hinweis"
                style={{ flex: 1 }}
                disabled={selectedHints.length >= 6}
              />
              <button
                type="button"
                className="btn"
                onClick={addCustomHint}
                disabled={!customHint || customHint.trim() === "" || selectedHints.length >= 6}>
                Hinzufügen
              </button>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h5>Aktive Hinweise</h5>
          </div>
          <div className="card-body">
            {selectedHints.length === 0 ? (
              <p>Keine aktiven Hinweise</p>
            ) : (
              <div
                style={{
                  marginTop: 6,
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                }}>
                {selectedHints.map((h) => (
                  <span key={h} className="hint-chip">
                    <span>{h}</span>
                    <button
                      type="button"
                      className="chip-remove"
                      aria-label={`Hinweis ${h} entfernen`}
                      onClick={() =>
                        setSelectedHints((prev) => prev.filter((x) => x !== h))
                      }>
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          className="btn btn-primary"
          onClick={() => preview({ autoPrint: false })}
          disabled={loading}>
          {loading && activeAction === "preview"
            ? "Erzeuge..."
            : "Vorschau öffnen"}
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => preview({ autoPrint: true })}
          disabled={loading}>
          {loading && activeAction === "print"
            ? "Drucke..."
            : "Direkt drucken"}
        </button>
        <button
          className="btn"
          onClick={() => {
            setItems([]);
            setSelectedHints([]);
          }}>
          Zurücksetzen
        </button>
      </div>
    </div>
  );
}
