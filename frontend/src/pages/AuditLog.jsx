import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import DataTable from "../components/DataTable";
import TableToolbar from "../components/TableToolbar";

export default function AuditLog() {
  const [data, setData] = useState({ data: [], pagination: {} });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [sortConfig, setSortConfig] = useState({
    key: "change_timestamp",
    direction: "desc",
  });

  useEffect(() => {
    setLoading(true);
    api
      .getAuditLog({ page, limit: 100, search })
      .then(setData)
      .catch((err) => alert("Fehler beim Laden des Audit-Logs: " + err.message))
      .finally(() => setLoading(false));
  }, [page, search]);

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
  const columns = [
    { key: "id", label: "ID", sortable: true },
    { key: "artikelnummer_id", label: "Artikel", sortable: true, render: (r) => <Link to={`/schmuckstuecke/${r.artikelnummer_id}`} className="badge gold" style={{ textDecoration: "none" }}>{r.artikelnummer_id}</Link> },
    { key: "column_name", label: "Spalte", sortable: true },
    { key: "old_value", label: "Alter Wert" },
    { key: "new_value", label: "Neuer Wert" },
    { key: "action_type", label: "Aktion", sortable: true, render: (r) => <span className="badge info">{r.action_type}</span> },
    { key: "changed_by", label: "Geändert von", sortable: true, style: { fontSize: 12, color: "var(--text-secondary)" } },
    { key: "change_timestamp", label: "Zeitpunkt", sortable: true, render: (r) => (r.change_timestamp ? new Date(r.change_timestamp).toLocaleString("de-DE") : "") },
  ];

  return (
    <div>
      <div className="page-header">
        <h2>Audit Log</h2>
        <p>{p.total || 0} Einträge – Änderungsprotokoll</p>
      </div>

      <TableToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Suche nach ID, Artikel, Spalte,..."
        style={{ marginBottom: 12 }}
      />

      <div className="card">
        <div className="card-body">
          {loading ? (
            <div className="loading"><div className="spinner"></div>Lade...</div>
          ) : (
            <DataTable
              data={sortedData}
              columns={columns}
              defaultSort={{ key: "change_timestamp", direction: "desc" }}
              getRowKey={(r) => r.id}
            />
          )}
        </div>
      </div>

      {p.totalPages > 1 && (
        <div className="pagination">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)}>← Zurück</button>
          <span className="page-info">Seite {page} von {p.totalPages}</span>
          <button disabled={page >= p.totalPages} onClick={() => setPage(page + 1)}>Weiter →</button>
        </div>
      )}
    </div>
  );
}
