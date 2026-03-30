import React, { useState, useEffect, useRef } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faKey } from "@fortawesome/free-solid-svg-icons";
import { api } from "../api";
import DataTable from "../components/DataTable";
import TableToolbar from "../components/TableToolbar";
import "./../index.css"; // Make sure styles are loaded

const formatDebugError = (err) => {
  if (err?.status === 401) {
    return "Nicht angemeldet oder Sitzung abgelaufen. Bitte erneut einloggen.";
  }
  if (err?.status === 403) {
    return "Kein Zugriff auf die Debug-Ansicht. Admin-Rechte erforderlich.";
  }
  return err?.message || "Unbekannter Fehler";
};

const EditableCell = ({ value, onSave, onCancel }) => {
  const [editingValue, setEditingValue] = useState(value === null ? "" : value);
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      onSave(editingValue);
    } else if (e.key === "Escape") {
      onCancel();
    }
  };

  return (
    <input
      ref={inputRef}
      type="text"
      className="debug-cell-input"
      value={editingValue}
      onChange={(e) => setEditingValue(e.target.value)}
      onBlur={() => onSave(editingValue)}
      onKeyDown={handleKeyDown}
    />
  );
};

const DebugTable = ({ tableName }) => {
  const [expanded, setExpanded] = useState(false);
  const [data, setData] = useState([]);
  const [columns, setColumns] = useState([]);
  const [primaryKeys, setPrimaryKeys] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasFetched, setHasFetched] = useState(false);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const pageSize = 100;

  // Track which cell is currently being edited: { rowIndex, columnName }
  const [editingCell, setEditingCell] = useState(null);

  useEffect(() => {
    if (expanded && !hasFetched) {
      fetchTableData();
    }
  }, [expanded, tableName, hasFetched]);

  const fetchTableData = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getDebugTableData(tableName);
      setData(result.data);
      setColumns(result.columns);
      setPrimaryKeys(result.primaryKeys);
    } catch (err) {
      setError(formatDebugError(err));
    } finally {
      setLoading(false);
      setHasFetched(true);
    }
  };

  const handleSave = async (rowIndex, columnName, newValue) => {
    setEditingCell(null); // Close editor

    const row = data[rowIndex];
    const oldValue = row[columnName];

    if (newValue === String(oldValue === null ? "" : oldValue)) {
      return; // No change
    }

    // Determine primary key to use for update. Prefer single PK, otherwise try to use first available or fallback to id.
    const pk =
      primaryKeys.length > 0
        ? primaryKeys[0]
        : row.id !== undefined
          ? "id"
          : null;

    if (!pk) {
      alert("Cannot update this table: No primary key found.");
      return;
    }

    try {
      const updatedRow = await api.updateDebugCell(tableName, {
        primaryKey: pk,
        id: row[pk],
        field: columnName,
        value: newValue,
      });

      // Update local state
      const newData = [...data];
      newData[rowIndex] = updatedRow;
      setData(newData);
    } catch (err) {
      alert(`Error updating cell: ${err.message}`);
      // Re-fetch to reset to actual state
      fetchTableData();
    }
  };

  const filteredData = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return data;

    return data.filter((row) =>
      columns.some((col) => {
        const rawValue = row[col.column_name];
        const normalized =
          rawValue === null ? "null" : String(rawValue).toLowerCase();
        return normalized.includes(query);
      }),
    );
  }, [data, columns, search]);

  const tableColumns = React.useMemo(
    () =>
      columns.map((col) => ({
        key: col.column_name,
        label: (
          <>
            {col.column_name}
            {primaryKeys.includes(col.column_name) && (
              <>
                {" "}
                <FontAwesomeIcon icon={faKey} />
              </>
            )}
          </>
        ),
        sortable: true,
        render: (row) => {
          const rowIndex = data.findIndex((candidate) => candidate === row);
          const colName = col.column_name;
          const isEditing =
            editingCell?.rowIndex === rowIndex &&
            editingCell?.columnName === colName;
          const value = row[colName];
          const displayValue =
            value === null ? (
              <em style={{ color: "var(--text-muted)" }}>null</em>
            ) : (
              String(value)
            );

          return (
            <div
              className="debug-cell"
              onDoubleClick={() =>
                setEditingCell({ rowIndex, columnName: colName })
              }>
              {isEditing ? (
                <EditableCell
                  value={value}
                  onSave={(newVal) => handleSave(rowIndex, colName, newVal)}
                  onCancel={() => setEditingCell(null)}
                />
              ) : (
                displayValue
              )}
            </div>
          );
        },
      })),
    [columns, data, editingCell, primaryKeys],
  );

  useEffect(() => {
    setPage(0);
  }, [search]);

  useEffect(() => {
    const totalPages = Math.ceil(filteredData.length / pageSize);
    if (page > 0 && page >= totalPages) {
      setPage(Math.max(totalPages - 1, 0));
    }
  }, [filteredData.length, page]);

  const renderContent = () => {
    if (loading)
      return (
        <div className="loading">
          <div className="spinner"></div>Loading {tableName}...
        </div>
      );
    if (error)
      return (
        <div className="detail-item" style={{ padding: "24px" }}>
          <span className="badge danger">{error}</span>
        </div>
      );
    if (hasFetched && data.length === 0)
      return (
        <div className="detail-item" style={{ padding: "24px" }}>
          No rows in {tableName}
        </div>
      );

    if (!hasFetched) return null;

    const totalPages = Math.ceil(filteredData.length / pageSize);
    const paginatedData = filteredData.slice(
      page * pageSize,
      (page + 1) * pageSize,
    );

    return (
      <div className="card-body" style={{ overflowX: "auto" }}>
        <TableToolbar
          search={search}
          onSearchChange={setSearch}
          placeholder={`Suche in ${tableName}...`}
          style={{ marginBottom: "12px" }}
        />

        {filteredData.length > 0 ? (
          <DataTable
            columns={tableColumns}
            data={paginatedData}
            getRowKey={(row) => {
              if (primaryKeys.length > 0) {
                return primaryKeys.map((pk) => String(row[pk])).join("|");
              }
              return JSON.stringify(row);
            }}
          />
        ) : (
          <div className="detail-item" style={{ padding: "24px" }}>
            Keine Treffer in {tableName}.
          </div>
        )}

        {totalPages > 1 && (
          <div className="pagination">
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <span className="page-info">
              Page {page + 1} of {totalPages} (Gefilterte Zeilen:{" "}
              {filteredData.length})
            </span>
            <button
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="debug-table-container">
      <h3 onClick={() => setExpanded(!expanded)} className="debug-table-header">
        <span>{tableName}</span>
        <span>{expanded ? "▲" : "▼"}</span>
      </h3>
      {expanded && (
        <div className="card" style={{ marginTop: "16px" }}>
          {renderContent()}
        </div>
      )}
    </div>
  );
};

const Debug = () => {
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchTables = async () => {
      try {
        const data = await api.getDebugTables();
        setTables(data);
      } catch (err) {
        setError(formatDebugError(err));
      } finally {
        setLoading(false);
      }
    };

    fetchTables();
  }, []);

  if (loading)
    return (
      <div>
        <div className="loading">
          <div className="spinner"></div>Loading Debug View...
        </div>
      </div>
    );
  if (error)
    return (
      <div>
        <h2>Error</h2>
        <p>{error}</p>
      </div>
    );

  return (
    <div>
      <div className="page-header">
        <h2>Database Debug View</h2>
      </div>

      <div>
        {tables.map((tableName) => (
          <DebugTable key={tableName} tableName={tableName} />
        ))}
      </div>
    </div>
  );
};

export default Debug;
