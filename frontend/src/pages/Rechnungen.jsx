import { useState, useEffect } from 'react';
import { api } from '../api';

export default function Rechnungen() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);

  const load = () => {
    setLoading(true);
    api.getRechnungen().then(setData).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const openDetail = async (id) => {
    try {
      const d = await api.getRechnung(id);
      setDetail(d);
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Rechnungen</h2>
        <p>{data.length} Rechnungen</p>
      </div>

      <div className="card">
        <div className="card-body">
          {loading ? (
            <div className="loading"><div className="spinner"></div>Lade...</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Nummer</th>
                  <th>Kunde</th>
                  <th>Datum</th>
                  <th>Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {data.map(r => (
                  <tr key={r.ID}>
                    <td>{r.ID}</td>
                    <td><strong>{r.Nummer}</strong></td>
                    <td>{r.KundenName || `Kunde ${r.Kundennummer}`}</td>
                    <td>{new Date(r.Datum).toLocaleDateString('de-DE')}</td>
                    <td>
                      <button className="btn btn-secondary btn-sm" onClick={() => openDetail(r.ID)}>Details</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {detail && (
        <div className="modal-overlay" onClick={() => setDetail(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>🧾 Rechnung {detail.Nummer}</h3>
              <button className="modal-close" onClick={() => setDetail(null)}>×</button>
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
                  <div className="detail-value">{new Date(detail.Datum).toLocaleDateString('de-DE')}</div>
                </div>
              </div>
              {detail.schmuckstuecke?.length > 0 && (
                <>
                  <h4 style={{ padding: '16px 24px 8px', fontSize: 15 }}>Zugehörige Schmuckstücke ({detail.schmuckstuecke.length})</h4>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Artikelnr.</th>
                        <th>Art</th>
                        <th>Material</th>
                        <th>Preis</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.schmuckstuecke.map(s => (
                        <tr key={s.Artikelnummer}>
                          <td><span className="badge gold">{s.Artikelnummer}</span></td>
                          <td>{s.Art}</td>
                          <td>{s.Material}</td>
                          <td>{s.Verkaufspreis}€</td>
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
