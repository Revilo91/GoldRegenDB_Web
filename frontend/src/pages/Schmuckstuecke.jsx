import { useState, useEffect, useMemo } from "react";
import { api } from "../api";

export default function Schmuckstuecke() {
  const [data, setData] = useState({ data: [], pagination: {} });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({});
  const [filterOptions, setFilterOptions] = useState({});
  const [selected, setSelected] = useState(null);
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
      load();
    } catch (err) {
      alert(err.message);
    }
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
          aValue = getKundenName(a.Ausgelagert).toLowerCase();
          bValue = getKundenName(b.Ausgelagert).toLowerCase();
          if (a.Ausgelagert === 0) aValue = "";
          if (b.Ausgelagert === 0) bValue = "";
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
        }}
      >
        <div>
          <h2>Schmuckstücke</h2>
          <p>{p.total || 0} Stücke insgesamt</p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => alert("Funktion zum Erstellen in Arbeit (Issue #3)")}
        >
          + Neues Schmuckstück
        </button>
      </div>

      <div className="toolbar">
        <input
          className="form-control search-input"
          placeholder="🔍 Suche nach Artikelnummer, Name, Art, Material..."
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
          }}
        >
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
          }}
        >
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
          }}
        >
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
                    style={{ cursor: "pointer" }}
                  >
                    Artikelnr. {getSortIcon("Artikelnummer")}
                  </th>
                  <th
                    onClick={() => requestSort("Art")}
                    style={{ cursor: "pointer" }}
                  >
                    Art {getSortIcon("Art")}
                  </th>
                  <th
                    onClick={() => requestSort("Material")}
                    style={{ cursor: "pointer" }}
                  >
                    Material {getSortIcon("Material")}
                  </th>
                  <th
                    onClick={() => requestSort("Farbe")}
                    style={{ cursor: "pointer" }}
                  >
                    Farbe {getSortIcon("Farbe")}
                  </th>
                  <th
                    onClick={() => requestSort("Verkaufspreis")}
                    style={{ cursor: "pointer" }}
                  >
                    Preis {getSortIcon("Verkaufspreis")}
                  </th>
                  <th
                    onClick={() => requestSort("Verkauft")}
                    style={{ cursor: "pointer" }}
                  >
                    Status {getSortIcon("Verkauft")}
                  </th>
                  <th
                    onClick={() => requestSort("Ausgelagert")}
                    style={{ cursor: "pointer" }}
                  >
                    Ausgelagert {getSortIcon("Ausgelagert")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedData.map((s) => (
                  <tr
                    key={s.Artikelnummer}
                    onClick={() => setSelected(s)}
                    style={{ cursor: "pointer" }}
                  >
                    <td>
                      <strong>{s.Artikelnummer}</strong>
                    </td>
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
              onClick={() => setPage(page + 1)}
            >
              Weiter →
            </button>
          </div>
        )}
      </div>

      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>💍 {selected.Artikelnummer}</h3>
              <div style={{ marginLeft: "auto", marginRight: 16 }}>
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ marginRight: 8 }}
                  onClick={() =>
                    alert("Funktion zum Bearbeiten in Arbeit (Issue #3)")
                  }
                >
                  ✏️ Bearbeiten
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => handleDelete(selected.Artikelnummer)}
                >
                  🗑️ Löschen
                </button>
              </div>
              <button className="modal-close" onClick={() => setSelected(null)}>
                ×
              </button>
            </div>
            <div className="detail-grid">
              {[
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
    </div>
  );
}
