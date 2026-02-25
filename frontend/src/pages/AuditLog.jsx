import { useState, useEffect, useMemo } from "react";
import { api } from "../api";

export default function AuditLog() {
  const [data, setData] = useState({ data: [], pagination: {} });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [sortConfig, setSortConfig] = useState({
    key: "change_timestamp",
    direction: "desc",
  });

  useEffect(() => {
    setLoading(true);
    api
      .getAuditLog({ page, limit: 100 })
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [page]);

  const sortedData = useMemo(() => {
    let sortableData = [...data.data];
    if (sortConfig.key !== null) {
      sortableData.sort((a, b) => {
        const aValue = a[sortConfig.key];
        const bValue = b[sortConfig.key];
        if (aValue < bValue) return sortConfig.direction === "asc" ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === "asc" ? 1 : -1;
        return 0;
      });
    }
    return sortableData;
  }, [data.data, sortConfig]);

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
            <div className="loading">
              <div className="spinner"></div>Lade...
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th
                    onClick={() => requestSort("id")}
                    style={{ cursor: "pointer" }}
                  >
                    ID {getSortIcon("id")}
                  </th>
                  <th
                    onClick={() => requestSort("artikelnummer_id")}
                    style={{ cursor: "pointer" }}
                  >
                    Artikel {getSortIcon("artikelnummer_id")}
                  </th>
                  <th
                    onClick={() => requestSort("column_name")}
                    style={{ cursor: "pointer" }}
                  >
                    Spalte {getSortIcon("column_name")}
                  </th>
                  <th
                    onClick={() => requestSort("old_value")}
                    style={{ cursor: "pointer" }}
                  >
                    Alter Wert {getSortIcon("old_value")}
                  </th>
                  <th
                    onClick={() => requestSort("new_value")}
                    style={{ cursor: "pointer" }}
                  >
                    Neuer Wert {getSortIcon("new_value")}
                  </th>
                  <th
                    onClick={() => requestSort("action_type")}
                    style={{ cursor: "pointer" }}
                  >
                    Aktion {getSortIcon("action_type")}
                  </th>
                  <th
                    onClick={() => requestSort("changed_by")}
                    style={{ cursor: "pointer" }}
                  >
                    Geändert von {getSortIcon("changed_by")}
                  </th>
                  <th
                    onClick={() => requestSort("change_timestamp")}
                    style={{ cursor: "pointer" }}
                  >
                    Zeitpunkt {getSortIcon("change_timestamp")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedData.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.id}</td>
                    <td>
                      <span className="badge gold">
                        {entry.artikelnummer_id}
                      </span>
                    </td>
                    <td>{entry.column_name}</td>
                    <td>{entry.old_value}</td>
                    <td>{entry.new_value}</td>
                    <td>
                      <span className="badge info">{entry.action_type}</span>
                    </td>
                    <td
                      style={{ fontSize: 12, color: "var(--text-secondary)" }}
                    >
                      {entry.changed_by}
                    </td>
                    <td>
                      {new Date(entry.change_timestamp).toLocaleString("de-DE")}
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
    </div>
  );
}
