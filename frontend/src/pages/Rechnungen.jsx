import { useState, useEffect, useMemo } from "react";
import { api } from "../api";

export default function Rechnungen() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
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

  const sortedData = useMemo(() => {
    let sortableData = [...data];
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
  }, [data, sortConfig]);

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
        <button
          className="btn btn-primary"
          onClick={() => alert("Funktion zur Erstellung in Arbeit (Issue #3)")}
        >
          + Neue Rechnung
        </button>
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
    </div>
  );
}
