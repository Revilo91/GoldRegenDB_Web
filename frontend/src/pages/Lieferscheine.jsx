import { useState, useEffect, useMemo } from "react";
import { api } from "../api";

export default function Lieferscheine() {
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
      .getLieferscheine()
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
      const d = await api.getLieferschein(id);
      setDetail(d);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Lieferschein wirklich löschen?")) return;
    try {
      await api.deleteLieferschein(id);
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
        ohne_lieferschein: "1",
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
      await api.createLieferschein(form);
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
    data.forEach((l) => {
      if (l.Datum) y.add(new Date(l.Datum).getFullYear());
    });
    return Array.from(y).sort((a, b) => b - a);
  }, [data]);

  const filteredData = useMemo(() => {
    return data.filter((l) => {
      // Search filter
      if (search) {
        const s = search.toUpperCase();
        const match =
          l.Nummer?.toUpperCase().includes(s) ||
          l.KundenName?.toUpperCase().includes(s) ||
          String(l.ID).includes(s);
        if (!match) return false;
      }

      // Customer filter
      if (filters.kundennummer) {
        if (l.Kundennummer !== parseInt(filters.kundennummer)) return false;
      }

      // Year filter
      if (filters.jahr) {
        if (new Date(l.Datum).getFullYear() !== parseInt(filters.jahr))
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

        // Handle nested or computed values if necessary
        if (sortConfig.key === "KundenName") {
          aValue = (a.KundenName || `Kunde ${a.Kundennummer}`).toUpperCase();
          bValue = (b.KundenName || `Kunde ${b.Kundennummer}`).toUpperCase();
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
          <h2>Lieferscheine</h2>
          <p>{data.length} Lieferscheine</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>
          + Neuer Lieferschein
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
                {sortedData.map((l) => (
                  <tr
                    key={l.ID}
                    onClick={() => openDetail(l.ID)}
                    style={{ cursor: "pointer" }}
                  >
                    <td>{l.ID}</td>
                    <td>
                      <strong>{l.Nummer}</strong>
                    </td>
                    <td>{l.KundenName || `Kunde ${l.Kundennummer}`}</td>
                    <td>{new Date(l.Datum).toLocaleDateString("de-DE")}</td>
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
              <h3>
                📦 Lieferschein {detail.Nummer} ({detail.ID})
              </h3>
              <button
                className="btn btn-primary btn-sm"
                style={{ marginLeft: "auto", marginRight: 8 }}
                onClick={() =>
                  window.open(api.getLieferscheinExcel(detail.ID), "_blank")
                }
              >
                Lieferschein erstellen
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
                  <div className="detail-value">
                    {(() => {
                      const totalBrutto = detail.schmuckstuecke.reduce(
                        (sum, s) => sum + (Number(s.Verkaufspreis) || 0),
                        0,
                      );
                      const provisionPercent = Number(detail.Provision) || 0;
                      const provisionValue =
                        totalBrutto * (provisionPercent / 100);
                      const finalTotal = totalBrutto - provisionValue;

                      return (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "8px",
                          }}
                        >
                          <div>
                            <span style={{ color: "#666", fontSize: "0.9em" }}>
                              Gesamtwert (brutto):
                            </span>{" "}
                            <strong>{totalBrutto.toFixed(2)} €</strong>
                          </div>
                          {provisionPercent > 0 && (
                            <div style={{ color: "#d32f2f" }}>
                              <span style={{ fontSize: "0.9em" }}>
                                - Provision ({provisionPercent}%):
                              </span>{" "}
                              <strong>{provisionValue.toFixed(2)} €</strong>
                            </div>
                          )}
                          <div
                            style={{
                              marginTop: "4px",
                              paddingTop: "8px",
                              borderTop: "1px solid #eee",
                              fontSize: "1.1em",
                            }}
                          >
                            <span>Voraussichtlich:</span>{" "}
                            <strong
                              className="dblUnderlined"
                              style={{ color: "var(--primary)" }}
                            >
                              {finalTotal.toFixed(2)} €
                            </strong>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
                <div className="detail-item">
                  <div className="detail-value">
                    {(() => {
                      const totalBrutto = detail.schmuckstuecke.reduce(
                        (sum, s) => sum + (Number(s.Verkaufspreis) || 0),
                        0,
                      );
                      const provisionPercent = Number(detail.Provision) || 0;
                      const provisionValue =
                        totalBrutto * (provisionPercent / 100);
                      const finalTotal = totalBrutto - provisionValue;

                      return (
                        <div
                          style={{
                            fontSize: "0.85em",
                            color: "#666",
                            marginTop: 8,
                            padding: "12px",
                            backgroundColor: "#f9f9f9",
                            borderRadius: "4px",
                            display: "flex",
                            flexDirection: "column",
                            gap: "8px",
                          }}
                        >
                          <label
                            style={{
                              fontSize: "0.9em",
                              marginBottom: "0",
                              display: "block",
                              color: "#888",
                              fontWeight: "600",
                            }}
                          >
                            Aufteilung (Netto nach Provision):
                          </label>

                          {(() => {
                            const marinaBrutto = detail.schmuckstuecke
                              .filter((s) =>
                                s.Artikelnummer?.toUpperCase().startsWith("M"),
                              )
                              .reduce(
                                (sum, s) =>
                                  sum + (Number(s.Verkaufspreis) || 0),
                                0,
                              );
                            const saskiaBrutto = detail.schmuckstuecke
                              .filter((s) =>
                                s.Artikelnummer?.toUpperCase().startsWith("S"),
                              )
                              .reduce(
                                (sum, s) =>
                                  sum + (Number(s.Verkaufspreis) || 0),
                                0,
                              );

                            const marinaNetto =
                              marinaBrutto * (1 - provisionPercent / 100);
                            const saskiaNetto =
                              saskiaBrutto * (1 - provisionPercent / 100);

                            return (
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  gap: "12px",
                                  flexWrap: "wrap",
                                }}
                              >
                                <div>
                                  <strong>Marina:</strong>{" "}
                                  {marinaNetto.toFixed(2)} €
                                  <span
                                    style={{
                                      fontSize: "0.9em",
                                      color: "#999",
                                      marginLeft: "4px",
                                    }}
                                  >
                                    ({marinaBrutto.toFixed(2)} brutto)
                                  </span>
                                </div>
                                <div>
                                  <strong>Saskia:</strong>{" "}
                                  {saskiaNetto.toFixed(2)} €
                                  <span
                                    style={{
                                      fontSize: "0.9em",
                                      color: "#999",
                                      marginLeft: "4px",
                                    }}
                                  >
                                    ({saskiaBrutto.toFixed(2)} brutto)
                                  </span>
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })()}
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
                      {detail.schmuckstuecke
                        .sort((a, b) =>
                          a.Artikelnummer.split("_")[0].localeCompare(
                            b.Artikelnummer.split("_")[0],
                          ),
                        )
                        .map((s) => (
                          <tr key={s.Artikelnummer}>
                            <td>
                              <span className="badge gold">
                                {s.Artikelnummer.split("_")[0]}
                              </span>
                            </td>
                            <td>{s.Art}</td>
                            <td>{Number(s.Verkaufspreis).toFixed(0)}€</td>
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
              <h3>🆕 Neuer Lieferschein</h3>
              <button className="modal-close" onClick={() => setEditing(null)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group">
                  <label>Lieferschein-Nummer*</label>
                  <input
                    className="form-control"
                    value={form.Nummer}
                    onChange={(e) =>
                      setForm({ ...form, Nummer: e.target.value })
                    }
                    placeholder="z.B. LS-2024-001"
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
                            .filter((p) => {
                              if (!pieceSearch) return true;
                              const s = pieceSearch.toUpperCase();
                              return (
                                p.Artikelnummer?.toUpperCase().includes(s) ||
                                p.Art?.toUpperCase().includes(s) ||
                                (p.Name?.toUpperCase().includes(s) ?? false)
                              );
                            })
                        .sort((a, b) =>
                          a.Artikelnummer.split("_")[0].localeCompare(
                            b.Artikelnummer.split("_")[0],
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
