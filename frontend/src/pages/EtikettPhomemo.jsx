import { useEffect, useState } from "react";
import { api } from "../api";

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
    "versilbert / vergoldet",
    "Handgemacht",
  ]);
  const [selectedHints, setSelectedHints] = useState([]);
  const [customHint, setCustomHint] = useState("");
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

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
      if (unique.length > 0) setSelected(unique[0].artikelnummer);
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
      if (existingIdx >= 0) {
        const cp = [...prev];
        cp[existingIdx].qty =
          (Number(cp[existingIdx].qty) || 0) + Number(q || 1);
        return cp;
      }
      return [...prev, { artikelnummer, qty: Number(q || 1) }];
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
    if (!customHint || customHint.trim() === "") return;
    setSelectedHints((prev) => [...prev, customHint.trim()]);
    setCustomHint("");
  }

  function removeIndex(idx) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  async function preview() {
    if (items.length === 0) return alert("Keine Artikel ausgewählt");
    setLoading(true);
    try {
      const html = await api.getEtikettenPreview({ items, materialHints: selectedHints });
      const w = window.open("", "_blank");
      w.document.open();
      w.document.write(html);
      w.document.close();
    } catch (err) {
      console.error(err);
      alert("Fehler beim Erstellen der Vorschau");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <h2>Etiketten: Phomemo M220</h2>
      <div style={{ marginBottom: 12 }}>
        {loadingOptions ? (
          <div>Lade Artikel...</div>
        ) : error ? (
          <div style={{ color: "var(--danger, #c53030)" }}>{error}</div>
        ) : null}
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        {/* left: available items */}
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input
              placeholder="Suche Artikelnummer oder Name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ flex: 1 }}
            />
            <button className="btn" onClick={() => fetchOptions()}>
              Aktualisieren
            </button>
          </div>
          <div
            style={{
              maxHeight: 420,
              overflow: "auto",
              border: "1px solid #eee",
              borderRadius: 6,
            }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: 8 }}>
                    Artikelnummer
                  </th>
                  <th style={{ textAlign: "left", padding: 8 }}>Name</th>
                  <th style={{ width: 160, padding: 8 }}>Aktion</th>
                </tr>
              </thead>
              <tbody>
                {options
                  .filter((o) => {
                    if (!search) return true;
                    const s = search.toLowerCase();
                    // compare against base artikelnummer and name
                    const base = (o.artikelnummer || '').toLowerCase();
                    return base.includes(s) || (o.name && o.name.toLowerCase().includes(s));
                  })
                  .map((o) => {
                    const base = o.artikelnummer.split('_')[0];
                    return (
                      <tr key={base} style={{ borderTop: '1px solid #f5f5f5' }}>
                        <td style={{ padding: 8 }}>{base}</td>
                        <td style={{ padding: 8 }}>{o.name}</td>
                        <td style={{ padding: 8 }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <input type="number" min="1" defaultValue={1} id={`qty-${base}`} style={{ width: 80 }} />
                            <button className="btn btn-primary" onClick={() => {
                              const el = document.getElementById(`qty-${base}`);
                              const q = el ? Number(el.value) || 1 : 1;
                              addItemFromList(base, q);
                            }}>Auswählen</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>

        {/* right: selected items */}
        <div style={{ width: 420 }}>
          <h4>Ausgewählte Etiketten</h4>
          <div
            style={{
              border: "1px solid #eee",
              borderRadius: 6,
              padding: 8,
              maxHeight: 420,
              overflow: "auto",
            }}>
            {items.length === 0 ? (
              <div>Keine Artikel ausgewählt</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: 6 }}>
                      Artikelnummer
                    </th>
                    <th style={{ width: 80, padding: 6 }}>Anzahl</th>
                    <th style={{ width: 80, padding: 6 }}>Aktion</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => (
                    <tr
                      key={it.artikelnummer + "-" + idx}
                      style={{ borderTop: "1px solid #f5f5f5" }}>
                      <td style={{ padding: 6 }}>{it.artikelnummer}</td>
                      <td style={{ padding: 6 }}>
                        <input
                          type="number"
                          min="1"
                          value={it.qty}
                          onChange={(e) =>
                            updateQty(idx, Number(e.target.value) || 1)
                          }
                          style={{ width: 72 }}
                        />
                      </td>
                      <td style={{ padding: 6 }}>
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

      <div style={{ marginBottom: 12 }}>
        <h4>Materialhinweise (wählbar)</h4>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {presetHints.map((h) => (
            <label
              key={h}
              style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={selectedHints.includes(h)}
                onChange={() => toggleHint(h)}
              />{" "}
              {h}
            </label>
          ))}
        </div>
        <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
          <input
            placeholder="Eigener Hinweis"
            value={customHint}
            onChange={(e) => setCustomHint(e.target.value)}
          />
          <button className="btn" onClick={addCustomHint}>
            Hinzufügen
          </button>
        </div>
        {selectedHints.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <strong>Aktive Hinweise:</strong> {selectedHints.join(", ")}
          </div>
        )}
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
