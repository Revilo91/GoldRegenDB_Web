import { useState, useEffect, useMemo } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faStar as faRegularStar } from "@fortawesome/free-regular-svg-icons";
import {
  faGem,
  faPen,
  faTrash,
  faPlus,
  faBoxOpen,
  faMagnifyingGlass,
  faEuroSign,
  faPaperclip
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../api";

export default function Schmuckstuecke() {
  const [data, setData] = useState({ data: [], pagination: {} });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({});
  const [filterOptions, setFilterOptions] = useState({});
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [kunden, setKunden] = useState([]);
  const [sortConfig, setSortConfig] = useState({
    key: "Artikelnummer",
    direction: "asc",
  });

  const load = () => {
    setLoading(true);
    api
      .getSchmuckstuecke({ page, limit: 50, search, ...filters })
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  const handleDelete = async (nr) => {
    if (!confirm(`Schmuckstück ${nr} wirklich löschen?`)) return;
    try {
      await api.deleteSchmuckstueck(nr);
      setSelected(null);
      setEditing(null);
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleSave = async () => {
    try {
      if (editing === "new") {
        await api.createSchmuckstueck(form);
      } else {
        await api.updateSchmuckstueck(editing, form);
      }
      setEditing(null);
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  const openNew = () => {
    setForm({
      Artikelnummer: "",
      Anzahl: 1,
      Name: "",
      Art: "",
      Material: "",
      Farbe: "",
      Verkaufspreis: 0,
      Herstellungskosten: 0,
      Ausgelagert: 0,
      Verkauft: 0,
      Online: 0,
      Ausschuss: 0,
    });
    setEditing("new");
  };

  const openEdit = (s) => {
    setForm({ ...s });
    setEditing(s.Artikelnummer);
  };

  useEffect(() => {
    api.getFilterOptions().then(setFilterOptions).catch(console.error);
    api.getKunden().then(setKunden).catch(console.error);
  }, []);

  useEffect(() => {
    load();
  }, [page, search, filters]);

  const getKundenName = (id) => {
    const kunde = kunden.find((k) => k.ID === id);
    return kunde ? kunde.Name : `Kundennummer ${id}`;
  };

  const p = data.pagination;

  const sortedData = useMemo(() => {
    let sortableData = [...data.data];
    if (sortConfig.key !== null) {
      sortableData.sort((a, b) => {
        let aValue = a[sortConfig.key];
        let bValue = b[sortConfig.key];

        if (sortConfig.key === "Ausgelagert") {
          aValue = getKundenName(a.Ausgelagert).toUpperCase();
          bValue = getKundenName(b.Ausgelagert).toUpperCase();
          if (a.Ausgelagert === 0) aValue = "";
          if (b.Ausgelagert === 0) bValue = "";
        }

        if (sortConfig.key === "Artikelnummer") {
          return sortConfig.direction === "asc"
            ? aValue.localeCompare(bValue, undefined, { numeric: true })
            : bValue.localeCompare(aValue, undefined, { numeric: true });
        }

        if (aValue < bValue) return sortConfig.direction === "asc" ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === "asc" ? 1 : -1;
        return 0;
      });
    }
    return sortableData;
  }, [data.data, sortConfig, kunden]);

  const requestSort = (key) => {
    let direction = "asc";
    if (sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    }
    setSortConfig({ key, direction });
  };

  const getSortIcon = (key) => {
    if (sortConfig.key !== key) return "↕️";
    return sortConfig.direction === "asc" ? "🔼" : "🔽";
  };

  return (
    <div>
      <div
        className="page-header"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}>
        <div>
          <h2>Schmuckstücke</h2>
          <p>{p.total || 0} Stücke insgesamt</p>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button className="btn btn-primary" onClick={openNew}>
            + Neues Schmuckstück
          </button>
        </div>
      </div>

      <div className="toolbar">
        <input
          className="form-control search-input"
          placeholder="Suche nach Artikelnummer, Name, Art, Material..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select
          className="form-control"
          style={{ width: "auto", minWidth: 150 }}
          value={filters.artikelnummer_art ?? ""}
          onChange={(e) => {
            const { artikelnummer_art, ...rest } = filters;
            setFilters(
              e.target.value !== ""
                ? { ...rest, artikelnummer_art: e.target.value }
                : rest,
            );
            setPage(1);
          }}>
          <option value="">Alle Arten</option>
          <option value="H">Halskette</option>
          <option value="O">Ohrring</option>
          <option value="A">Armband</option>
        </select>
        <select
          className="form-control"
          style={{ width: "auto", minWidth: 130 }}
          value={filters.ausgelagert ?? ""}
          onChange={(e) => {
            const { ausgelagert, ...rest } = filters;
            setFilters(
              e.target.value !== ""
                ? { ...rest, ausgelagert: e.target.value }
                : rest,
            );
            setPage(1);
          }}>
          <option value="">Alle Standorte</option>
          <option value="0">Lager</option>
          {kunden.map((k) => (
            <option key={k.ID} value={k.ID}>
              {k.Name}
            </option>
          ))}
        </select>
        <select
          className="form-control"
          style={{ width: "auto", minWidth: 130 }}
          value={filters.verkauft ?? ""}
          onChange={(e) => {
            const { verkauft, ...rest } = filters;
            setFilters(
              e.target.value !== ""
                ? { ...rest, verkauft: e.target.value }
                : rest,
            );
            setPage(1);
          }}>
          <option value="">Status</option>
          <option value="0">Nicht verkauft</option>
          <option value="1">Verkauft</option>
        </select>
      </div>

      <div className="card">
        <div className="card-body">
          {loading ? (
            <div className="loading">
              <div className="spinner"></div>Lade...
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th
                    onClick={() => requestSort("Artikelnummer")}
                    style={{ cursor: "pointer" }}>
                    Artikelnr. {getSortIcon("Artikelnummer")}
                  </th>
                  <th
                    onClick={() => requestSort("Grundmaterial")}
                    style={{ cursor: "pointer" }}>
                    Grundmaterial {getSortIcon("Grundmaterial")}
                  </th>
                  <th
                    onClick={() => requestSort("Art")}
                    style={{ cursor: "pointer" }}>
                    Art {getSortIcon("Art")}
                  </th>
                  <th
                    onClick={() => requestSort("Material")}
                    style={{ cursor: "pointer" }}>
                    Material {getSortIcon("Material")}
                  </th>
                  <th
                    onClick={() => requestSort("Farbe")}
                    style={{ cursor: "pointer" }}>
                    Farbe {getSortIcon("Farbe")}
                  </th>
                  <th
                    onClick={() => requestSort("Verkaufspreis")}
                    style={{ cursor: "pointer" }}>
                    Preis {getSortIcon("Verkaufspreis")}
                  </th>
                  <th
                    onClick={() => requestSort("Verkauft")}
                    style={{ cursor: "pointer" }}>
                    Status {getSortIcon("Verkauft")}
                  </th>
                  <th
                    onClick={() => requestSort("Ausgelagert")}
                    style={{ cursor: "pointer" }}>
                    Ausgelagert {getSortIcon("Ausgelagert")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedData.map((s) => (
                  <tr
                    key={s.Artikelnummer}
                    onClick={() => setSelected(s)}
                    style={{ cursor: "pointer" }}>
                    <td>
                      <strong>{s.Artikelnummer.split("_")[0]}</strong>
                      {s.Artikelnummer.split("_")[1] > 0 && (
                        <span className="badge warning">
                          {s.Artikelnummer.split("_")[1]}
                        </span>
                      )}
                    </td>
                    <td>{s.Grundmaterial}</td>
                    <td>{s.Art}</td>
                    <td>{s.Material}</td>
                    <td>{s.Farbe}</td>
                    <td>{s.Verkaufspreis > 0 ? `${s.Verkaufspreis}€` : "-"}</td>
                    <td>
                      {s.Verkauft === 1 && (
                        <span className="badge success">Verkauft</span>
                      )}
                      {s.Ausschuss === 1 && (
                        <span className="badge danger">Ausschuss</span>
                      )}
                      {s.Online === 1 && (
                        <span className="badge info">Online</span>
                      )}
                      {s.Verkauft === 0 &&
                        s.Ausschuss === 0 &&
                        s.Online === 0 &&
                        s.Ausgelagert === 0 && (
                          <span className="badge gold">Lager</span>
                        )}
                    </td>
                    <td>
                      {s.Ausgelagert > 0 ? (
                        <span className="badge warning">
                          {getKundenName(s.Ausgelagert)}
                        </span>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {p.totalPages > 1 && (
          <div className="pagination">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
              ← Zurück
            </button>
            <span className="page-info">
              Seite {page} von {p.totalPages}
            </span>
            <button
              disabled={page >= p.totalPages}
              onClick={() => setPage(page + 1)}>
              Weiter →
            </button>
          </div>
        )}
      </div>

      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                <FontAwesomeIcon icon={faGem} /> {selected.Artikelnummer}{" "}
                {selected.Verkauft === 1 ? (
                  <span className="badge success">Verkauft</span>
                ) : selected.Ausschuss === 1 ? (
                  <span className="badge danger">Ausschuss</span>
                ) : selected.Ausgelagert > 0 ? (
                  <span className="badge gold">
                    Ausgelagert: {getKundenName(selected.Ausgelagert)}
                  </span>
                ) : (
                  <span className="badge warning">Lager</span>
                )}
              </h3>
              <div style={{ marginLeft: "auto", marginRight: 16 }}>
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ marginRight: 8 }}
                  onClick={() => openEdit(selected)}>
                  <FontAwesomeIcon icon={faPen} /> Bearbeiten
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => handleDelete(selected.Artikelnummer)}>
                  <FontAwesomeIcon icon={faTrash} /> Löschen
                </button>
              </div>
              <button className="modal-close" onClick={() => setSelected(null)}>
                ×
              </button>
            </div>
            <div className="detail-grid">
              {[
                ["Grundmaterial", selected.Grundmaterial],
                ["Art", selected.Art],
                ["Form", selected.Form],
                ["Länge", selected["Länge"] ? `${selected["Länge"]} cm` : "–"],
                ["Fassung", selected.Fassung],
                ["Farbe", selected.Farbe],
                ["Material", selected.Material],
                ["Größe", selected["Grösse"]],
                ["Inhalt Material", selected.Inhalt_Material],
                ["Inhalt Farbe", selected.Inhalt_Farbe],
                ["Inhalt Farbakzent", selected.Inhalt_Farbakzent],
                ["Inhalt Zusatzmaterial", selected.Inhalt_Zusatzmaterial],
                ["Anhänger Fassung", selected["Anhänger_Fassung"]],
                ["Anhänger Form", selected["Anhänger_Form"]],
                ["Anhänger Farbe", selected["Anhänger_Farbe"]],
                ["Anhänger Größe", selected["Anhänger_Grösse"]],
                [
                  "Anhänger Inhalt Material",
                  selected["Anhänger_Inhalt_Material"],
                ],
                ["Anhänger Inhalt Farbe", selected["Anhänger_Inhalt_Farbe"]],
                ["Zwischenstück", selected["Zwischenstück"]],
                [
                  "Herstellungskosten",
                  selected.Herstellungskosten
                    ? `${selected.Herstellungskosten}€`
                    : "–",
                ],
                [
                  "Verkaufspreis",
                  selected.Verkaufspreis ? `${selected.Verkaufspreis}€` : "–",
                ],
                [
                  "Erstellt",
                  selected.Erstelldatum
                    ? new Date(selected.Erstelldatum).toLocaleDateString(
                        "de-DE",
                        { day: "2-digit", month: "2-digit", year: "numeric" },
                      )
                    : "–",
                ],
                [
                  "Letzte Änderung",
                  selected["Letzte_Änderung"]
                    ? new Date(selected["Letzte_Änderung"]).toLocaleString(
                        "de-DE",
                      )
                    : "–",
                ],
              ]
                .filter(([, v]) => v && v !== "–" && v !== 0 && v !== "0")
                .map(([label, value]) => (
                  <div className="detail-item" key={label}>
                    <label>{label}</label>
                    <div className="detail-value">{value}</div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {editing !== null && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div
            className="modal modal-lg"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "900px" }}>
            <div className="modal-header">
              <h3>
                {editing === "new"
                  ? <><FontAwesomeIcon icon={faPlus} /> Neues Schmuckstück</>
                  : <><FontAwesomeIcon icon={faPen} /> {editing} bearbeiten</>}
              </h3>
              <button className="modal-close" onClick={() => setEditing(null)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="form-section">
                <h4><FontAwesomeIcon icon={faBoxOpen} /> Basis-Informationen</h4>
                <div className="form-row">
                  <div className="form-group">
                    <label>Artikelnummer*</label>
                    <input
                      className="form-control"
                      disabled={editing !== "new"}
                      value={form.Artikelnummer || ""}
                      onChange={(e) =>
                        setForm({ ...form, Artikelnummer: e.target.value })
                      }
                      placeholder="z.B. MHO oder MHO112"
                    />
                  </div>
                  {editing === "new" && (
                    <div className="form-group" style={{ maxWidth: "100px" }}>
                      <label>Anzahl</label>
                      <input
                        className="form-control"
                        type="number"
                        min="1"
                        value={form.Anzahl || 1}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            Anzahl: parseInt(e.target.value) || 1,
                          })
                        }
                      />
                    </div>
                  )}
                  <div className="form-group">
                    <label>Name</label>
                    <input
                      className="form-control"
                      value={form.Name || ""}
                      onChange={(e) =>
                        setForm({ ...form, Name: e.target.value })
                      }
                    />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Art</label>
                    <input
                      list="arten-list"
                      className="form-control"
                      value={form.Art || ""}
                      onChange={(e) =>
                        setForm({ ...form, Art: e.target.value })
                      }
                    />
                    <datalist id="arten-list">
                      {filterOptions.arten?.map((a) => (
                        <option key={a} value={a} />
                      ))}
                    </datalist>
                  </div>
                  <div className="form-group">
                    <label>Material</label>
                    <input
                      list="material-list"
                      className="form-control"
                      value={form.Material || ""}
                      onChange={(e) =>
                        setForm({ ...form, Material: e.target.value })
                      }
                    />
                    <datalist id="material-list">
                      {filterOptions.materialien?.map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                  </div>
                  <div className="form-group">
                    <label>Farbe</label>
                    <input
                      list="farben-list"
                      className="form-control"
                      value={form.Farbe || ""}
                      onChange={(e) =>
                        setForm({ ...form, Farbe: e.target.value })
                      }
                    />
                    <datalist id="farben-list">
                      {filterOptions.farben?.map((f) => (
                        <option key={f} value={f} />
                      ))}
                    </datalist>
                  </div>
                </div>
              </div>

              <div className="form-section">
                <h4><FontAwesomeIcon icon={faMagnifyingGlass} /> Details (Hauptstück)</h4>
                <div className="form-row">
                  <div className="form-group">
                    <label>Form</label>
                    <input
                      list="formen-list"
                      className="form-control"
                      value={form.Form || ""}
                      onChange={(e) =>
                        setForm({ ...form, Form: e.target.value })
                      }
                    />
                    <datalist id="formen-list">
                      {filterOptions.formen?.map((f) => (
                        <option key={f} value={f} />
                      ))}
                    </datalist>
                  </div>
                  <div className="form-group">
                    <label>Größe</label>
                    <input
                      className="form-control"
                      type="number"
                      step="0.1"
                      value={form.Grösse || 0}
                      onChange={(e) =>
                        setForm({ ...form, Grösse: parseFloat(e.target.value) })
                      }
                    />
                  </div>
                  <div className="form-group">
                    <label>Länge (cm)</label>
                    <input
                      className="form-control"
                      type="number"
                      step="0.1"
                      value={form.Länge || 0}
                      onChange={(e) =>
                        setForm({ ...form, Länge: parseFloat(e.target.value) })
                      }
                    />
                  </div>
                  <div className="form-group">
                    <label>Fassung</label>
                    <input
                      list="fassungen-list"
                      className="form-control"
                      value={form.Fassung || ""}
                      onChange={(e) =>
                        setForm({ ...form, Fassung: e.target.value })
                      }
                    />
                    <datalist id="fassungen-list">
                      {filterOptions.fassungen?.map((f) => (
                        <option key={f} value={f} />
                      ))}
                    </datalist>
                  </div>
                </div>
              </div>

              <div className="form-section">
                <h4><FontAwesomeIcon icon={faRegularStar} /> Inhalt</h4>
                <div className="form-row">
                  <div className="form-group">
                    <label>Inhalt Material</label>
                    <input
                      list="inhalt-material-list"
                      className="form-control"
                      value={form.Inhalt_Material || ""}
                      onChange={(e) =>
                        setForm({ ...form, Inhalt_Material: e.target.value })
                      }
                    />
                    <datalist id="inhalt-material-list">
                      {filterOptions.inhalt_materialien?.map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                  </div>
                  <div className="form-group">
                    <label>Inhalt Farbe</label>
                    <input
                      list="inhalt-farbe-list"
                      className="form-control"
                      value={form.Inhalt_Farbe || ""}
                      onChange={(e) =>
                        setForm({ ...form, Inhalt_Farbe: e.target.value })
                      }
                    />
                    <datalist id="inhalt-farbe-list">
                      {filterOptions.inhalt_farben?.map((f) => (
                        <option key={f} value={f} />
                      ))}
                    </datalist>
                  </div>
                  <div className="form-group">
                    <label>Inhalt Farbakzent</label>
                    <input
                      list="inhalt-farbakzent-list"
                      className="form-control"
                      value={form.Inhalt_Farbakzent || ""}
                      onChange={(e) =>
                        setForm({ ...form, Inhalt_Farbakzent: e.target.value })
                      }
                    />
                    <datalist id="inhalt-farbakzent-list">
                      {filterOptions.inhalt_farbakzente?.map((a) => (
                        <option key={a} value={a} />
                      ))}
                    </datalist>
                  </div>
                  <div className="form-group">
                    <label>Inhalt Zusatzmaterial</label>
                    <input
                      list="inhalt-zusatzmaterial-list"
                      className="form-control"
                      value={form.Inhalt_Zusatzmaterial || ""}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          Inhalt_Zusatzmaterial: e.target.value,
                        })
                      }
                    />
                    <datalist id="inhalt-zusatzmaterial-list">
                      {filterOptions.inhalt_zusatzmaterialien?.map((z) => (
                        <option key={z} value={z} />
                      ))}
                    </datalist>
                  </div>
                </div>
              </div>

              <div className="form-section">
                <h4><FontAwesomeIcon icon={faPaperclip} /> Anhänger / Attachment</h4>
                <div className="form-row">
                  <div className="form-group">
                    <label>Anhänger Fassung</label>
                    <input
                      list="anhaenger-fassung-list"
                      className="form-control"
                      value={form.Anhänger_Fassung || ""}
                      onChange={(e) =>
                        setForm({ ...form, Anhänger_Fassung: e.target.value })
                      }
                    />
                    <datalist id="anhaenger-fassung-list">
                      {filterOptions.anhaenger_fassungen?.map((f) => (
                        <option key={f} value={f} />
                      ))}
                    </datalist>
                  </div>
                  <div className="form-group">
                    <label>Anhänger Form</label>
                    <input
                      list="anhaenger-form-list"
                      className="form-control"
                      value={form.Anhänger_Form || ""}
                      onChange={(e) =>
                        setForm({ ...form, Anhänger_Form: e.target.value })
                      }
                    />
                    <datalist id="anhaenger-form-list">
                      {filterOptions.anhaenger_formen?.map((f) => (
                        <option key={f} value={f} />
                      ))}
                    </datalist>
                  </div>
                  <div className="form-group">
                    <label>Anhänger Farbe</label>
                    <input
                      list="anhaenger-farbe-list"
                      className="form-control"
                      value={form.Anhänger_Farbe || ""}
                      onChange={(e) =>
                        setForm({ ...form, Anhänger_Farbe: e.target.value })
                      }
                    />
                    <datalist id="anhaenger-farbe-list">
                      {filterOptions.anhaenger_farben?.map((f) => (
                        <option key={f} value={f} />
                      ))}
                    </datalist>
                  </div>
                  <div className="form-group">
                    <label>Anhänger Größe</label>
                    <input
                      className="form-control"
                      type="number"
                      step="0.1"
                      value={form.Anhänger_Grösse || 0}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          Anhänger_Grösse: parseFloat(e.target.value),
                        })
                      }
                    />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Anh. Inhalt Material</label>
                    <input
                      list="anhaenger-inhalt-material-list"
                      className="form-control"
                      value={form.Anhänger_Inhalt_Material || ""}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          Anhänger_Inhalt_Material: e.target.value,
                        })
                      }
                    />
                    <datalist id="anhaenger-inhalt-material-list">
                      {filterOptions.anhaenger_inhalt_materialien?.map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                  </div>
                  <div className="form-group">
                    <label>Anh. Inhalt Farbe</label>
                    <input
                      list="anhaenger-inhalt-farbe-list"
                      className="form-control"
                      value={form.Anhänger_Inhalt_Farbe || ""}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          Anhänger_Inhalt_Farbe: e.target.value,
                        })
                      }
                    />
                    <datalist id="anhaenger-inhalt-farbe-list">
                      {filterOptions.anhaenger_inhalt_farben?.map((f) => (
                        <option key={f} value={f} />
                      ))}
                    </datalist>
                  </div>
                  <div className="form-group">
                    <label>Anh. Inhalt Farbakzent</label>
                    <input
                      list="anhaenger-inhalt-farbakzent-list"
                      className="form-control"
                      value={form.Anhänger_Inhalt_Farbakzente || ""}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          Anhänger_Inhalt_Farbakzente: e.target.value,
                        })
                      }
                    />
                    <datalist id="anhaenger-inhalt-farbakzent-list">
                      {filterOptions.anhaenger_inhalt_farbakzente?.map((a) => (
                        <option key={a} value={a} />
                      ))}
                    </datalist>
                  </div>
                  <div className="form-group">
                    <label>Anh. Inhalt Zusatzmaterial</label>
                    <input
                      list="anhaenger-inhalt-zusatzmaterial-list"
                      className="form-control"
                      value={form.Anhänger_Inhalt_Zusatzmaterial || ""}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          Anhänger_Inhalt_Zusatzmaterial: e.target.value,
                        })
                      }
                    />
                    <datalist id="anhaenger-inhalt-zusatzmaterial-list">
                      {filterOptions.anhaenger_inhalt_zusatzmaterialien?.map(
                        (z) => (
                          <option key={z} value={z} />
                        ),
                      )}
                    </datalist>
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Zwischenstück</label>
                    <input
                      list="zwischenstuecke-list"
                      className="form-control"
                      value={form.Zwischenstück || ""}
                      onChange={(e) =>
                        setForm({ ...form, Zwischenstück: e.target.value })
                      }
                    />
                    <datalist id="zwischenstuecke-list">
                      {filterOptions.zwischenstuecke?.map((z) => (
                        <option key={z} value={z} />
                      ))}
                    </datalist>
                  </div>
                  <div className="form-group">
                    <label>Fassung</label>
                    <input
                      list="fassungen-list"
                      className="form-control"
                      value={form.Fassung || ""}
                      onChange={(e) =>
                        setForm({ ...form, Fassung: e.target.value })
                      }
                    />
                    <datalist id="fassungen-list">
                      {filterOptions.fassungen?.map((f) => (
                        <option key={f} value={f} />
                      ))}
                    </datalist>
                  </div>
                  <div className="form-group">
                    <label>Anhänger (Allg.)</label>
                    <input
                      list="anhaenger-list"
                      className="form-control"
                      value={form.Anhänger || ""}
                      onChange={(e) =>
                        setForm({ ...form, Anhänger: e.target.value })
                      }
                    />
                    <datalist id="anhaenger-list">
                      {filterOptions.anhaenger?.map((a) => (
                        <option key={a} value={a} />
                      ))}
                    </datalist>
                  </div>
                </div>
              </div>

              <div className="form-section">
                <h4><FontAwesomeIcon icon={faEuroSign} /> Inventar & Preise</h4>
                <div className="form-row">
                  <div className="form-group">
                    <label>Verkaufspreis (€)</label>
                    <input
                      className="form-control"
                      type="number"
                      step="0.01"
                      value={form.Verkaufspreis || 0}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          Verkaufspreis: parseFloat(e.target.value),
                        })
                      }
                    />
                  </div>
                  <div className="form-group">
                    <label>Herstellungskosten (€)</label>
                    <input
                      className="form-control"
                      type="number"
                      step="0.01"
                      value={form.Herstellungskosten || 0}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          Herstellungskosten: parseFloat(e.target.value),
                        })
                      }
                    />
                  </div>
                  <div className="form-group">
                    <label>Standort / Ausgelagert</label>
                    <select
                      className="form-control"
                      value={form.Ausgelagert || 0}
                      disabled={editing === "new"}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          Ausgelagert: parseInt(e.target.value),
                        })
                      }>
                      <option value="0">Lager</option>
                      {kunden.map((k) => (
                        <option key={k.ID} value={k.ID}>
                          {k.Name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="form-row" style={{ marginTop: "16px" }}>
                  <div
                    className="form-group"
                    style={{ display: "flex", alignItems: "center" }}>
                    <input
                      type="checkbox"
                      id="form-verkauft"
                      checked={form.Verkauft === 1}
                      disabled
                      onChange={(e) =>
                        setForm({ ...form, Verkauft: e.target.checked ? 1 : 0 })
                      }
                      style={{ marginRight: "8px" }}
                    />
                    <label htmlFor="form-verkauft" style={{ marginBottom: 0 }}>
                      Verkauft
                    </label>
                  </div>
                  <div
                    className="form-group"
                    style={{ display: "flex", alignItems: "center" }}>
                    <input
                      type="checkbox"
                      id="form-online"
                      checked={form.Online === 1}
                      disabled={editing === "new"}
                      onChange={(e) =>
                        setForm({ ...form, Online: e.target.checked ? 1 : 0 })
                      }
                      style={{ marginRight: "8px" }}
                    />
                    <label htmlFor="form-online" style={{ marginBottom: 0 }}>
                      Online
                    </label>
                  </div>
                  <div
                    className="form-group"
                    style={{ display: "flex", alignItems: "center" }}>
                    <input
                      type="checkbox"
                      id="form-ausschuss"
                      checked={form.Ausschuss === 1}
                      disabled={editing === "new"}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          Ausschuss: e.target.checked ? 1 : 0,
                        })
                      }
                      style={{ marginRight: "8px" }}
                    />
                    <label htmlFor="form-ausschuss" style={{ marginBottom: 0 }}>
                      Ausschuss
                    </label>
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => setEditing(null)}>
                Abbrechen
              </button>
              <button className="btn btn-primary" onClick={handleSave}>
                Speichern
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
