import React, { useState, useEffect, useRef } from 'react';
import './../index.css'; // Make sure styles are loaded

const EditableCell = ({ value, onSave, onCancel }) => {
  const [editingValue, setEditingValue] = useState(value === null ? '' : value);
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      onSave(editingValue);
    } else if (e.key === 'Escape') {
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
      const response = await fetch(`http://localhost:3001/api/debug/tables/${tableName}`);
      if (!response.ok) throw new Error('Failed to fetch table data');
      const result = await response.json();
      setData(result.data);
      setColumns(result.columns);
      setPrimaryKeys(result.primaryKeys);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setHasFetched(true);
    }
  };

  const handleSave = async (rowIndex, columnName, newValue) => {
    setEditingCell(null); // Close editor
    
    const row = data[rowIndex];
    const oldValue = row[columnName];
    
    if (newValue === String(oldValue === null ? '' : oldValue)) {
      return; // No change
    }

    // Determine primary key to use for update. Prefer single PK, otherwise try to use first available or fallback to id.
    const pk = primaryKeys.length > 0 ? primaryKeys[0] : (row.id !== undefined ? 'id' : null);
    
    if (!pk) {
      alert("Cannot update this table: No primary key found.");
      return;
    }

    try {
      const response = await fetch(`http://localhost:3001/api/debug/tables/${tableName}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primaryKey: pk,
          id: row[pk],
          field: columnName,
          value: newValue
        })
      });

      if (!response.ok) {
        throw new Error('Failed to update value');
      }

      const updatedRow = await response.json();
      
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

  const renderContent = () => {
    if (loading) return <div className="loading"><div className="spinner"></div>Loading {tableName}...</div>;
    if (error) return <div className="detail-item" style={{ padding: '24px' }}><span className="badge danger">{error}</span></div>;
    if (hasFetched && data.length === 0) return <div className="detail-item" style={{ padding: '24px' }}>No rows in {tableName}</div>;

    if (!hasFetched) return null;

    const totalPages = Math.ceil(data.length / pageSize);
    const paginatedData = data.slice(page * pageSize, (page + 1) * pageSize);

    return (
      <div className="card-body" style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              {columns.map(col => (
                <th key={col.column_name} title={col.data_type}>
                  {col.column_name}
                  {primaryKeys.includes(col.column_name) && ' 🔑'}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedData.map((row, relativeIndex) => {
              const rowIndex = page * pageSize + relativeIndex;
              return (
                <tr key={rowIndex}>
                  {columns.map(col => {
                    const colName = col.column_name;
                    const isEditing = editingCell?.rowIndex === rowIndex && editingCell?.columnName === colName;
                    const value = row[colName];
                    const displayValue = value === null ? <em style={{color: 'var(--text-muted)'}}>null</em> : String(value);

                    return (
                      <td 
                        key={colName} 
                        className="debug-cell"
                        onDoubleClick={() => setEditingCell({ rowIndex, columnName: colName })}
                      >
                        {isEditing ? (
                          <EditableCell 
                            value={value} 
                            onSave={(newVal) => handleSave(rowIndex, colName, newVal)} 
                            onCancel={() => setEditingCell(null)}
                          />
                        ) : (
                          displayValue
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        {totalPages > 1 && (
          <div className="pagination">
            <button 
              disabled={page === 0} 
              onClick={() => setPage(p => p - 1)}
            >
              Previous
            </button>
            <span className="page-info">
              Page {page + 1} of {totalPages} (Total rows: {data.length})
            </span>
            <button 
              disabled={page >= totalPages - 1} 
              onClick={() => setPage(p => p + 1)}
            >
              Next
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="debug-table-container">
      <h3 
        onClick={() => setExpanded(!expanded)}
        className="debug-table-header"
      >
        <span>{tableName}</span>
        <span>{expanded ? '▲' : '▼'}</span>
      </h3>
      {expanded && (
        <div className="card" style={{ marginTop: '16px' }}>
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
        const response = await fetch('http://localhost:3001/api/debug/tables');
        if (!response.ok) throw new Error('Failed to fetch tables');
        const data = await response.json();
        setTables(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchTables();
  }, []);

  if (loading) return <div className="main-content"><div className="loading"><div className="spinner"></div>Loading Debug View...</div></div>;
  if (error) return <div className="main-content"><h2>Error</h2><p>{error}</p></div>;

  return (
    <div className="page-header">
      <h2>Database Debug View</h2>
      <p>Double-click a cell to edit its value. Press Enter to save, or Escape to cancel.</p>
      
      <div style={{ marginTop: '32px' }}>
        {tables.map(tableName => (
          <DebugTable key={tableName} tableName={tableName} />
        ))}
      </div>
    </div>
  );
};

export default Debug;
