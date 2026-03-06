import { useState, useEffect } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faGem,
  faWarehouse,
  faBox,
  faCheckCircle,
  faGlobe,
  faTimesCircle,
  faEuroSign,
  faUsers,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../api";

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getDashboard()
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading)
    return (
      <div className="loading">
        <div className="spinner"></div>Lade Dashboard...
      </div>
    );
  if (!data) return <div className="loading">Fehler beim Laden</div>;

  const s = data.statistics;

  return (
    <div>
      <div className="stats-grid">
        <div className="stat-card gold">
          <div className="stat-icon">
            <FontAwesomeIcon icon={faGem} />
          </div>
          <div className="stat-value">{s.totalPieces}</div>
          <div className="stat-label">Gesamt Stücke</div>
        </div>
        <div className="stat-card info">
          <div className="stat-icon">
            <FontAwesomeIcon icon={faWarehouse} />
          </div>
          <div className="stat-value">{s.inStockPieces}</div>
          <div className="stat-label">Im Lager</div>
        </div>
        <div className="stat-card warning">
          <div className="stat-icon">
            <FontAwesomeIcon icon={faBox} />
          </div>
          <div className="stat-value">{s.outsourcedPieces}</div>
          <div className="stat-label">Ausgelagert</div>
        </div>
        <div className="stat-card success">
          <div className="stat-icon">
            <FontAwesomeIcon icon={faCheckCircle} />
          </div>
          <div className="stat-value">{s.soldPieces}</div>
          <div className="stat-label">Verkauft</div>
        </div>
        <div className="stat-card info">
          <div className="stat-icon">
            <FontAwesomeIcon icon={faGlobe} />
          </div>
          <div className="stat-value">{s.onlinePieces}</div>
          <div className="stat-label">Online</div>
        </div>
        <div className="stat-card danger">
          <div className="stat-icon">
            <FontAwesomeIcon icon={faTimesCircle} />
          </div>
          <div className="stat-value">{s.rejectPieces}</div>
          <div className="stat-label">Ausschuss</div>
        </div>
        <div className="stat-card gold">
          <div className="stat-icon">
            <FontAwesomeIcon icon={faEuroSign} />
          </div>
          <div className="stat-value">{s.totalRevenue.toFixed(0)}€</div>
          <div className="stat-label">Umsatz (verkauft)</div>
        </div>
        <div className="stat-card info">
          <div className="stat-icon">
            <FontAwesomeIcon icon={faUsers} />
          </div>
          <div className="stat-value">
            {s.activeCustomers}/{s.totalCustomers}
          </div>
          <div className="stat-label">Aktive Kunden</div>
        </div>
      </div>

      <div className="responsive-grid-2">
        <div className="card">
          <div className="card-header">
            <h3>Stücke nach Art</h3>
          </div>
          <div className="chart-bars">
            {data.piecesByArt.map((item) => {
              const max = data.piecesByArt[0]?.count || 1;
              return (
                <div className="chart-bar" key={item.Art}>
                  <div className="bar-label" title={item.Art}>
                    {item.Art}
                  </div>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{ width: `${(item.count / max) * 100}%` }}
                    ></div>
                  </div>
                  <div className="bar-value">{item.count}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>Stücke bei Kunden</h3>
          </div>
          <div className="chart-bars">
            {data.piecesByKunde.map((item) => {
              const max = data.piecesByKunde[0]?.count || 1;
              return (
                <div className="chart-bar" key={item.Name}>
                  <div className="bar-label" title={item.Name}>
                    {item.Name}
                  </div>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{ width: `${(item.count / max) * 100}%` }}
                    ></div>
                  </div>
                  <div className="bar-value">{item.count}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* <div className="card" style={{ marginTop: '24px' }}>
        <div className="card-header"><h3>Letzte Änderungen</h3></div>
        <div className="card-body">
          <table className="data-table">
            <thead>
              <tr>
                <th>Artikel</th>
                <th>Spalte</th>
                <th>Alt</th>
                <th>Neu</th>
                <th>Zeitpunkt</th>
              </tr>
            </thead>
            <tbody>
              {data.recentChanges.map((c) => (
                <tr key={c.id}>
                  <td><span className="badge gold">{c.artikelnummer_id}</span></td>
                  <td>{c.column_name}</td>
                  <td>{c.old_value}</td>
                  <td>{c.new_value}</td>
                  <td>{new Date(c.change_timestamp).toLocaleString('de-DE')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div> */}
    </div>
  );
}
