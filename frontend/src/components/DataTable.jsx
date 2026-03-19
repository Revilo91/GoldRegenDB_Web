import React, { useState, useMemo } from "react";

export default function DataTable({
  columns = [],
  data = [],
  className = "",
  onRowClick,
  defaultSort = { key: null, direction: "asc" },
  getRowKey = (r) => r.id || r.ID || JSON.stringify(r),
  footer = null,
}) {
  const [sortConfig, setSortConfig] = useState(defaultSort);

  const sorted = useMemo(() => {
    const arr = [...data];
    if (!sortConfig.key) return arr;
    arr.sort((a, b) => {
      const aV = a[sortConfig.key];
      const bV = b[sortConfig.key];
      if (aV < bV) return sortConfig.direction === "asc" ? -1 : 1;
      if (aV > bV) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
    return arr;
  }, [data, sortConfig]);

  const requestSort = (key) => {
    let direction = "asc";
    if (sortConfig.key === key && sortConfig.direction === "asc") direction = "desc";
    setSortConfig({ key, direction });
  };

  const getSortIcon = (key) => {
    if (sortConfig.key !== key) return "↕️";
    return sortConfig.direction === "asc" ? "🔼" : "🔽";
  };

  return (
    <table className={`data-table ${className}`.trim()}>
      <thead>
        <tr>
          {columns.map((c) => (
            <th
              key={c.key || c.label}
              className={c.className || ""}
              style={{ cursor: c.sortable ? "pointer" : "default", ...c.style }}
              onClick={() => c.sortable && requestSort(c.key)}>
              {c.label} {c.sortable ? getSortIcon(c.key) : null}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map((row) => (
          <tr key={getRowKey(row)} onClick={() => onRowClick && onRowClick(row)} style={{ cursor: onRowClick ? "pointer" : "default" }}>
            {columns.map((c) => (
              <td key={(c.key || c.label) + getRowKey(row)} className={c.className || ""}>
                {c.render ? c.render(row) : row[c.key]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {footer ? <tfoot>{footer}</tfoot> : null}
    </table>
  );
}
