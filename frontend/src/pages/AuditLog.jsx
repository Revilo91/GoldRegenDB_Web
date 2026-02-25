import { useState, useEffect } from 'react';
import { api } from '../api';

export default function AuditLog() {
  const [data, setData] = useState({ data: [], pagination: {} });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setLoading(true);
    api.getAuditLog({ page, limit: 100 })
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [page]);

  const p = data.pagination;

  return (
    <div>
      <div className="page-header">
        <h2>Audit Log</h2>
        <p>{p.total || 0} Einträge – Änderungsprotokoll</p>
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
                  <th>Artikel</th>
                  <th>Spalte</th>
                  <th>Alter Wert</th>
                  <th>Neuer Wert</th>
                  <th>Aktion</th>
                  <th>Geändert von</th>
                  <th>Zeitpunkt</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map(entry => (
                  <tr key={entry.id}>
                    <td>{entry.id}</td>
                    <td><span className="badge gold">{entry.artikelnummer_id}</span></td>
                    <td>{entry.column_name}</td>
                    <td>{entry.old_value}</td>
                    <td>{entry.new_value}</td>
                    <td><span className="badge info">{entry.action_type}</span></td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{entry.changed_by}</td>
                    <td>{new Date(entry.change_timestamp).toLocaleString('de-DE')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {p.totalPages > 1 && (
          <div className="pagination">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)}>← Zurück</button>
            <span className="page-info">Seite {page} von {p.totalPages}</span>
            <button disabled={page >= p.totalPages} onClick={() => setPage(page + 1)}>Weiter →</button>
          </div>
        )}
      </div>
    </div>
  );
}
