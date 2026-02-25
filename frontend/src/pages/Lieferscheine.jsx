import { useState, useEffect } from "react";
import { api } from "../api";

export default function Lieferscheine() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);

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
  }, []);

  const openDetail = async (id) => {
    try {
      const d = await api.getLieferschein(id);
      setDetail(d);
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Lieferscheine</h2>
        <p>{data.length} Lieferscheine</p>
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
                  <th>ID</th>
                  <th>Nummer</th>
                  <th>Kunde</th>
                  <th>Datum</th>
                </tr>
              </thead>
              <tbody>
                {data.map((l) => (
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
              <h3>📦 Lieferschein {detail.Nummer}</h3>
              <button
                className="btn btn-primary btn-sm"
                style={{ marginLeft: "auto", marginRight: 16 }}
                onClick={() =>
                  window.open(api.getLieferscheinExcel(detail.ID), "_blank")
                }
              >
                Lieferschein erstellen
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
                  <label>Gesamtwert (voraussichtlich)</label>
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
