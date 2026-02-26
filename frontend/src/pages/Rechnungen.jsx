import { useState, useEffect, useMemo } from "react";
import { api } from "../api";

export default function Rechnungen() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [kunden, setKunden] = useState([]);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({});
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    Nummer: "",
    Kundennummer: "",
    Artikelnummern: [],
  });
  const [availablePieces, setAvailablePieces] = useState([]);
  const [pieceSearch, setPieceSearch] = useState("");
  const [sortConfig, setSortConfig] = useState({
    key: "Datum",
    direction: "desc",
  });

  const load = () => {
    setLoading(true);
    api
      .getRechnungen()
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    api.getKunden().then(setKunden).catch(console.error);
  }, []);

  const openDetail = async (id) => {
    try {
      const d = await api.getRechnung(id);
      setDetail(d);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Rechnung wirklich löschen?")) return;
    try {
      await api.deleteRechnung(id);
      setDetail(null);
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  const openNew = async () => {
    setForm({ Nummer: "", Kundennummer: "", Artikelnummern: [] });
    setEditing("new");
    try {
      const resp = await api.getSchmuckstuecke({
        ohne_rechnung: "1",
        limit: 1000,
      });
      setAvailablePieces(resp.data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSave = async () => {
    if (!form.Nummer || !form.Kundennummer) {
      alert("Bitte Nummer und Kunde angeben.");
      return;
    }
    try {
      await api.createRechnung(form);
      setEditing(null);
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  const togglePiece = (nr) => {
    const nrs = [...form.Artikelnummern];
    if (nrs.includes(nr)) {
      setForm({ ...form, Artikelnummern: nrs.filter((n) => n !== nr) });
    } else {
      setForm({ ...form, Artikelnummern: [...nrs, nr] });
    }
  };

  const years = useMemo(() => {
    const y = new Set();
    data.forEach((r) => {
      if (r.Datum) y.add(new Date(r.Datum).getFullYear());
    });
    return Array.from(y).sort((a, b) => b - a);
  }, [data]);

  const filteredData = useMemo(() => {
    return data.filter((r) => {
      // Search filter
      if (search) {
        const s = search.toLowerCase();
        const match =
          r.Nummer?.toLowerCase().includes(s) ||
          r.KundenName?.toLowerCase().includes(s) ||
          String(r.ID).includes(s);
        if (!match) return false;
      }

      // Customer filter
      if (filters.kundennummer) {
        if (r.Kundennummer !== parseInt(filters.kundennummer)) return false;
      }

      // Year filter
      if (filters.jahr) {
        if (new Date(r.Datum).getFullYear() !== parseInt(filters.jahr))
          return false;
      }

      return true;
    });
  }, [data, search, filters]);

  const sortedData = useMemo(() => {
    let sortableData = [...filteredData];
    if (sortConfig.key !== null) {
      sortableData.sort((a, b) => {
        let aValue = a[sortConfig.key];
        let bValue = b[sortConfig.key];

        if (sortConfig.key === "KundenName") {
          aValue = (a.KundenName || `Kunde ${a.Kundennummer}`).toLowerCase();
          bValue = (b.KundenName || `Kunde ${b.Kundennummer}`).toLowerCase();
        }

        if (aValue < bValue) return sortConfig.direction === "asc" ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === "asc" ? 1 : -1;
        return 0;
      });
    }
    return sortableData;
  }, [filteredData, sortConfig]);

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
          <h2>Rechnungen</h2>
          <p>{data.length} Rechnungen</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>
          + Neue Rechnung
        </button>
      </div>

      <div className="toolbar">
        <input
          className="form-control search-input"
          placeholder="🔍 Suche nach Nummer, Kunde, ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="form-control"
          style={{ width: "auto", minWidth: 150 }}
          value={filters.kundennummer ?? ""}
          onChange={(e) => {
            const { kundennummer, ...rest } = filters;
            setFilters(
              e.target.value !== ""
                ? { ...rest, kundennummer: e.target.value }
                : rest,
            );
          }}
        >
          <option value="">Alle Kunden</option>
          {kunden.map((k) => (
            <option key={k.ID} value={k.ID}>
              {k.Name}
            </option>
          ))}
        </select>
        <select
          className="form-control"
          style={{ width: "auto" }}
          value={filters.jahr ?? ""}
          onChange={(e) => {
            const { jahr, ...rest } = filters;
            setFilters(
              e.target.value !== "" ? { ...rest, jahr: e.target.value } : rest,
            );
          }}
        >
          <option value="">Alle Jahre</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
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
                    onClick={() => requestSort("ID")}
                    style={{ cursor: "pointer" }}
                  >
                    ID {getSortIcon("ID")}
                  </th>
                  <th
                    onClick={() => requestSort("Nummer")}
                    style={{ cursor: "pointer" }}
                  >
                    Nummer {getSortIcon("Nummer")}
                  </th>
                  <th
                    onClick={() => requestSort("KundenName")}
                    style={{ cursor: "pointer" }}
                  >
                    Kunde {getSortIcon("KundenName")}
                  </th>
                  <th
                    onClick={() => requestSort("Datum")}
                    style={{ cursor: "pointer" }}
                  >
                    Datum {getSortIcon("Datum")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedData.map((r) => (
                  <tr
                    key={r.ID}
                    onClick={() => openDetail(r.ID)}
                    style={{ cursor: "pointer" }}
                  >
                    <td>{r.ID}</td>
                    <td>
                      <strong>{r.Nummer}</strong>
                    </td>
                    <td>{r.KundenName || `Kunde ${r.Kundennummer}`}</td>
                    <td>{new Date(r.Datum).toLocaleDateString("de-DE")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {detail && (
        <div className="modal-overlay" onClick={() => setDetail(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>🧾 Rechnung {detail.Nummer}</h3>
              <button
                className="btn btn-primary btn-sm"
                style={{ marginLeft: "auto", marginRight: 8 }}
                onClick={() =>
                  window.open(api.getRechnungExcel(detail.ID), "_blank")
                }
              >
                Rechnung erstellen
              </button>
              <button
                className="btn btn-danger btn-sm"
                style={{ marginRight: 16 }}
                onClick={() => handleDelete(detail.ID)}
              >
                🗑️ Löschen
              </button>
              <button className="modal-close" onClick={() => setDetail(null)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="detail-grid">
                <div className="detail-item">
                  <label>Nummer</label>
                  <div className="detail-value">{detail.Nummer}</div>
                </div>
                <div className="detail-item">
                  <label>Kunde</label>
                  <div className="detail-value">{detail.KundenName}</div>
                </div>
                <div className="detail-item">
                  <label>Datum</label>
                  <div className="detail-value">
                    {new Date(detail.Datum).toLocaleDateString("de-DE")}
                  </div>
                </div>
                <div className="detail-item">
                  <label>Gesamtwert</label>
                  <div className="detail-value">
                    <strong>
                      {detail.schmuckstuecke
                        .reduce(
                          (sum, s) => sum + (Number(s.Verkaufspreis) || 0),
                          0,
                        )
                        .toFixed(2)}
                      €
                    </strong>
                    <div
                      style={{
                        fontSize: "0.85em",
                        color: "#666",
                        marginTop: 4,
                      }}
                    >
                      Marina:{" "}
                      {detail.schmuckstuecke
                        .filter((s) =>
                          s.Artikelnummer?.toUpperCase().startsWith("M"),
                        )
                        .reduce(
                          (sum, s) => sum + (Number(s.Verkaufspreis) || 0),
                          0,
                        )
                        .toFixed(2)}
                      €<br />
                      Saskia:{" "}
                      {detail.schmuckstuecke
                        .filter((s) =>
                          s.Artikelnummer?.toUpperCase().startsWith("S"),
                        )
                        .reduce(
                          (sum, s) => sum + (Number(s.Verkaufspreis) || 0),
                          0,
                        )
                        .toFixed(2)}
                      €
                    </div>
                  </div>
                </div>
              </div>
              {detail.schmuckstuecke?.length > 0 && (
                <>
                  <h4 style={{ padding: "16px 24px 8px", fontSize: 15 }}>
                    Zugehörige Schmuckstücke ({detail.schmuckstuecke.length})
                  </h4>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Artikelnr.</th>
                        <th>Art</th>
                        <th>Preis</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.schmuckstuecke.map((s) => (
                        <tr key={s.Artikelnummer}>
                          <td>
                            <span className="badge gold">
                              {s.Artikelnummer}
                            </span>
                          </td>
                          <td>{s.Art}</td>
                          <td>{Number(s.Verkaufspreis).toFixed(2)}€</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {editing === "new" && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div
            className="modal modal-lg"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "800px" }}
          >
            <div className="modal-header">
              <h3>🆕 Neue Rechnung</h3>
              <button className="modal-close" onClick={() => setEditing(null)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group">
                  <label>Rechnungs-Nummer*</label>
                  <input
                    className="form-control"
                    value={form.Nummer}
                    onChange={(e) =>
                      setForm({ ...form, Nummer: e.target.value })
                    }
                    placeholder="z.B. RE-2024-001"
                  />
                </div>
                <div className="form-group">
                  <label>Kunde*</label>
                  <select
                    className="form-control"
                    value={form.Kundennummer}
                    onChange={(e) =>
                      setForm({ ...form, Kundennummer: e.target.value })
                    }
                  >
                    <option value="">Bitte wählen...</option>
                    {kunden.map((k) => (
                      <option key={k.ID} value={k.ID}>
                        {k.Name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="piece-selection" style={{ marginTop: 24 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 12,
                  }}
                >
                  <h4 style={{ margin: 0 }}>
                    Schmuckstücke auswählen ({form.Artikelnummern.length})
                  </h4>
                  <input
                    className="form-control"
                    style={{ width: "200px" }}
                    placeholder="🔍 Suchen..."
                    value={pieceSearch}
                    onChange={(e) => setPieceSearch(e.target.value)}
                  />
                </div>
                <div
                  style={{
                    maxHeight: "300px",
                    overflowY: "auto",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                  }}
                >
                  <table className="data-table">
                    <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
                      <tr>
                        <th style={{ width: "40px" }}></th>
                        <th>Artikelnr.</th>
                        <th>Art</th>
                        <th>Preis</th>
                      </tr>
                    </thead>
                    <tbody>
                      {availablePieces
                        .filter(
                          (p) =>
                            !pieceSearch ||
                            p.Artikelnummer.toLowerCase().includes(
                              pieceSearch.toLowerCase(),
                            ) ||
                            p.Art.toLowerCase().includes(
                              pieceSearch.toLowerCase(),
                            ),
                        )
                        .map((p) => (
                          <tr
                            key={p.Artikelnummer}
                            onClick={() => togglePiece(p.Artikelnummer)}
                            style={{ cursor: "pointer" }}
                          >
                            <td>
                              <input
                                type="checkbox"
                                checked={form.Artikelnummern.includes(
                                  p.Artikelnummer,
                                )}
                                readOnly
                              />
                            </td>
                            <td>{p.Artikelnummer}</td>
                            <td>{p.Art}</td>
                            <td>{p.Verkaufspreis}€</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => setEditing(null)}
              >
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
