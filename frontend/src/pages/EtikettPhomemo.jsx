import { useEffect, useState } from "react";
import { api } from "../api";
import DataTable from "../components/DataTable";

export default function EtikettPhomemo() {
  const [options, setOptions] = useState([]);
  const [error, setError] = useState("");
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [selected, setSelected] = useState("");
  const [qty, setQty] = useState(1);
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
  const [search, setSearch] = useState("");
  const [rowQty, setRowQty] = useState({});
  const [adding, setAdding] = useState({});
  const totalSelected = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);

  useEffect(() => {
    fetchOptions();
  }, []);

  async function fetchOptions() {
    setLoadingOptions(true);
    setError("");
    try {
      const json = await api.getEtikettenOptions();
      const list = json || [];
      const seen = {};
      const unique = [];
      for (const o of list) {
        const art = (o.artikelnummer || "").split("_")[0];
        if (!art) continue;
        if (!Object.prototype.hasOwnProperty.call(seen, art)) {
          seen[art] = true;
          // keep name/preis from first occurrence but normalize artikelnummer to base
          unique.push({ ...o, artikelnummer: art });
        }
      }
      setOptions(unique);
      if (unique.length > 0) {
        setSelected(unique[0].artikelnummer);
        // initialize rowQty for visible options to avoid undefined/NaN issues
        const initialRowQty = {};
        for (const u of unique) initialRowQty[u.artikelnummer] = 1;
        setRowQty(initialRowQty);
      }
    } catch (err) {
      console.error(err);
      setError(err.message || "Fehler beim Laden der Artikel");
      setOptions([]);
    } finally {
      setLoadingOptions(false);
    }
  }

  function addItem() {
    if (!selected) return;
    setItems((prev) => [
      ...prev,
      { artikelnummer: selected, qty: Number(qty) || 1 },
    ]);
  }

  function addItemFromList(artikelnummer, q) {
    setItems((prev) => {
      const existingIdx = prev.findIndex(
        (i) => i.artikelnummer === artikelnummer,
      );
      const addQty = Math.max(1, parseInt(String(q || 0), 10) || 1);
      console.debug("[Etikett] addItemFromList called", {
        artikelnummer,
        q,
        addQty,
        prev,
      });
      if (existingIdx >= 0) {
        const cp = [...prev];
        const existingQty = Number(cp[existingIdx].qty) || 0;
        cp[existingIdx].qty = existingQty + addQty;
        console.debug("[Etikett] merged item", {
          artikelnummer,
          existingQty,
          addQty,
          newQty: cp[existingIdx].qty,
        });
        // reset rowQty for this artikelnummer to 1
        setRowQty((r) => ({ ...r, [artikelnummer]: 1 }));
        return cp;
      }
      // new entry
      const entry = { artikelnummer, qty: addQty };
      console.debug("[Etikett] new item added", entry);
      // reset rowQty for this artikelnummer to 1
      setRowQty((r) => ({ ...r, [artikelnummer]: 1 }));
      return [...prev, entry];
    });
  }

  function updateQty(idx, newQty) {
    setItems((prev) => {
      const cp = [...prev];
      cp[idx].qty = newQty;
      return cp;
    });
  }

  function toggleHint(h) {
    setSelectedHints((prev) =>
      prev.includes(h) ? prev.filter((x) => x !== h) : [...prev, h],
    );
  }

  function addCustomHint() {
    const val = customHint ? customHint.trim() : "";
    if (!val) return;
    setSelectedHints((prev) => (prev.includes(val) ? prev : [...prev, val]));
    setCustomHint("");
  }

  function removeIndex(idx) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  async function preview() {
    if (items.length === 0) return alert("Keine Artikel ausgewählt");
    setLoading(true);
    try {
      const html = await api.getEtikettenPreview({
        items,
        materialHints: selectedHints,
      });
      const w = window.open("", "_blank");
      const wrapper = `<!doctype html><html><head><meta charset="utf-8"><title>Etiketten Vorschau</title><meta name="viewport" content="width=device-width,initial-scale=1"/><style>body{font-family:Arial,Helvetica,sans-serif;padding:12px;color:#111} .hint-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 8px;background:#f7f7f7;border-radius:16px;margin:4px;font-size:13px} .hint-chip button{border:none;background:transparent;cursor:pointer} table{border-collapse:collapse;width:100%} th,td{padding:6px 8px;border:1px solid #e6e6e6}</style></head><body>${html}</body></html>`;
      w.document.open();
      w.document.write(wrapper);
      w.document.close();
    } catch (err) {
      console.error(err);
      alert("Fehler beim Erstellen der Vorschau");
    } finally {
      setLoading(false);
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
              if (adding[r.artikelnummer]) return;
              const q = Number(rowQty[r.artikelnummer]) || 1;
              setAdding((p) => ({ ...p, [r.artikelnummer]: true }));
              try {
                addItemFromList(r.artikelnummer, q);
              } finally {
                setTimeout(
                  () => setAdding((p) => ({ ...p, [r.artikelnummer]: false })),
                  300,
                );
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
      <div className="page-header">
        <div>
          <h2>Etiketten erstellen</h2>
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        {loadingOptions ? (
          <div>Lade Artikel...</div>
        ) : error ? (
          <div style={{ color: "var(--danger, #c53030)" }}>{error}</div>
        ) : null}
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input
              className="form-control"
              placeholder="Suche Artikelnummer oder Name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button className="btn" onClick={() => fetchOptions()}>
              Aktualisieren
            </button>
          </div>

          <div className="card">
            <div className="card-header">
              <h3>Verfügbare Artikel</h3>
            </div>
            <div className="card-body">
              <div style={{ maxHeight: 420, overflow: "auto" }}>
                <DataTable
                  columns={columns}
                  data={options.filter((o) => {
                    if (!search) return true;
                    const s = search.toLowerCase();
                    const base = (o.artikelnummer || "").toLowerCase();
                    return (
                      base.includes(s) ||
                      (o.name && o.name.toLowerCase().includes(s))
                    );
                  })}
                  getRowKey={(r) => r.artikelnummer}
                />
              </div>
            </div>
          </div>
        </div>

        <div style={{ width: 500 }}>
          <div className="card">
            <div className="card-header">
              <h3>Ausgewählte Etiketten</h3>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div className="badge info">{items.length} Typen</div>
                <div className="badge gold">{totalSelected} Gesamt</div>
              </div>
            </div>
            <div className="card-body">
              <div style={{ maxHeight: 420, overflow: "auto", padding: 5 }}>
                {items.length === 0 ? (
                  <div>Keine Artikel ausgewählt</div>
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
          </div>
        </div>
      </div>

        <div className="hints-wrapper">
          <div className="card">
            <div className="card-body hints-card-body">
              <h4 style={{ padding: 10 }}>Materialhinweise (wählbar)</h4>
              <div className="preset-hints" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {presetHints.map((h) => (
                  <label
                    key={h}
                    htmlFor={`hint-${h}`}
                    style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      id={`hint-${h}`}
                      type="checkbox"
                      aria-label={`Materialhinweis ${h}`}
                      checked={selectedHints.includes(h)}
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
                />
                <button
                  type="button"
                  className="btn"
                  onClick={addCustomHint}
                  disabled={!customHint || customHint.trim() === ""}
                >
                  Hinzufügen
                </button>
              </div>
            </div>
          </div>

          <div className="card-body active-hints-panel">
            <h4>Aktive Hinweise</h4>
            {selectedHints.length === 0 ? (
              <div className="muted">Keine aktiven Hinweise</div>
            ) : (
              <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {selectedHints.map((h) => (
                  <span key={h} className="hint-chip">
                    <span>{h}</span>
                    <button
                      type="button"
                      className="chip-remove"
                      aria-label={`Hinweis ${h} entfernen`}
                      onClick={() => setSelectedHints((prev) => prev.filter((x) => x !== h))}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          className="btn btn-primary"
          onClick={preview}
          disabled={loading}>
          {loading ? "Erzeuge..." : "Vorschau öffnen"}
        </button>
        <button
          className="btn"
          onClick={() => {
            setItems([]);
          }}>
          Zurücksetzen
        </button>
      </div>
    </div>
  );
}
