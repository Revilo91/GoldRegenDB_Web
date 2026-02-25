import { useState, useEffect } from 'react';
import { api } from '../api';

export default function Schmuckstuecke() {
  const [data, setData] = useState({ data: [], pagination: {} });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({});
  const [filterOptions, setFilterOptions] = useState({});
  const [selected, setSelected] = useState(null);

  const load = () => {
    setLoading(true);
    api.getSchmuckstuecke({ page, limit: 50, search, ...filters })
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    api.getFilterOptions().then(setFilterOptions).catch(console.error);
  }, []);

  useEffect(() => { load(); }, [page, search, filters]);

  const p = data.pagination;

  return (
    <div>
      <div className="page-header">
        <h2>Schmuckstücke</h2>
        <p>{p.total || 0} Stücke insgesamt</p>
      </div>

      <div className="toolbar">
        <input
          className="form-control search-input"
          placeholder="🔍 Suche nach Artikelnummer, Name, Art, Material..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        <select className="form-control" style={{ width: 'auto', minWidth: 150 }}
          value={filters.art || ''}
          onChange={(e) => { setFilters({ ...filters, art: e.target.value || undefined }); setPage(1); }}>
          <option value="">Alle Arten</option>
          {filterOptions.arten?.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="form-control" style={{ width: 'auto', minWidth: 130 }}
          value={filters.verkauft ?? ''}
          onChange={(e) => { setFilters({ ...filters, verkauft: e.target.value || undefined }); setPage(1); }}>
          <option value="">Alle Status</option>
          <option value="0">Verfügbar</option>
          <option value="1">Verkauft</option>
        </select>
      </div>

      <div className="card">
        <div className="card-body">
          {loading ? (
            <div className="loading"><div className="spinner"></div>Lade...</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Artikelnr.</th>
                  <th>Art</th>
                  <th>Material</th>
                  <th>Farbe</th>
                  <th>Preis</th>
                  <th>Status</th>
                  <th>Ausgelagert</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map(s => (
                  <tr key={s.Artikelnummer} onClick={() => setSelected(s)} style={{ cursor: 'pointer' }}>
                    <td><strong>{s.Artikelnummer}</strong></td>
                    <td>{s.Art}</td>
                    <td>{s.Material}</td>
                    <td>{s.Farbe}</td>
                    <td>{s.Verkaufspreis > 0 ? `${s.Verkaufspreis}€` : '–'}</td>
                    <td>
                      {s.Verkauft === 1 && <span className="badge success">Verkauft</span>}
                      {s.Ausschuss === 1 && <span className="badge danger">Ausschuss</span>}
                      {s.Online === 1 && <span className="badge info">Online</span>}
                      {s.Verkauft === 0 && s.Ausschuss === 0 && s.Online === 0 && <span className="badge gold">Lager</span>}
                    </td>
                    <td>{s.Ausgelagert > 0 ? <span className="badge warning">Kunde {s.Ausgelagert}</span> : '–'}</td>
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

      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>💍 {selected.Artikelnummer}</h3>
              <button className="modal-close" onClick={() => setSelected(null)}>×</button>
            </div>
            <div className="detail-grid">
              {[
                ['Art', selected.Art], ['Form', selected.Form], ['Länge', selected['Länge'] ? `${selected['Länge']} cm` : '–'],
                ['Fassung', selected.Fassung], ['Farbe', selected.Farbe], ['Material', selected.Material],
                ['Größe', selected['Grösse']], ['Inhalt Material', selected.Inhalt_Material], ['Inhalt Farbe', selected.Inhalt_Farbe],
                ['Inhalt Farbakzent', selected.Inhalt_Farbakzent], ['Inhalt Zusatzmaterial', selected.Inhalt_Zusatzmaterial],
                ['Anhänger Fassung', selected['Anhänger_Fassung']], ['Anhänger Form', selected['Anhänger_Form']],
                ['Anhänger Farbe', selected['Anhänger_Farbe']], ['Anhänger Größe', selected['Anhänger_Grösse']],
                ['Anhänger Inhalt Material', selected['Anhänger_Inhalt_Material']], ['Anhänger Inhalt Farbe', selected['Anhänger_Inhalt_Farbe']],
                ['Zwischenstück', selected['Zwischenstück']], ['Herstellungskosten', selected.Herstellungskosten ? `${selected.Herstellungskosten}€` : '–'],
                ['Verkaufspreis', selected.Verkaufspreis ? `${selected.Verkaufspreis}€` : '–'],
                ['Erstellt', selected.Erstelldatum ? new Date(selected.Erstelldatum).toLocaleDateString('de-DE') : '–'],
                ['Letzte Änderung', selected['Letzte_Änderung'] ? new Date(selected['Letzte_Änderung']).toLocaleString('de-DE') : '–'],
              ].filter(([, v]) => v && v !== '–' && v !== 0 && v !== '0').map(([label, value]) => (
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
