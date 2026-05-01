import React, { useState, useMemo } from "react";

export default function DataTable({
  columns = [],
  data = [],
  className = "",
  onRowClick,
  rowProps,
  defaultSort = { key: null, direction: "asc" },
  getRowKey = (r) => r.id || r.ID || JSON.stringify(r),
  footer = null,
}) {
  const [sortConfig, setSortConfig] = useState(defaultSort);
  const [draggingRowKey, setDraggingRowKey] = useState(null);

  const sorted = useMemo(() => {
    const arr = [...data];
    if (!sortConfig.key) return arr;
    const activeCol = columns.find((c) => c.key === sortConfig.key);
    arr.sort((a, b) => {
      if (activeCol?.comparator) {
        const result = activeCol.comparator(a, b);
        return sortConfig.direction === "asc" ? result : -result;
      }
      const aV = a[sortConfig.key];
      const bV = b[sortConfig.key];

      if (typeof aV === "string" && typeof bV === "string") {
        const result = aV.localeCompare(bV, undefined, {
          numeric: true,
          sensitivity: "base",
        });
        return sortConfig.direction === "asc" ? result : -result;
      }

      if (aV < bV) return sortConfig.direction === "asc" ? -1 : 1;
      if (aV > bV) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
    return arr;
  }, [data, sortConfig, columns]);

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
        {sorted.map((row) => {
          const rowKey = getRowKey(row);
          const customRowProps = rowProps ? rowProps(row) || {} : {};
          const {
            onClick: customOnClick,
            onDragStart: customOnDragStart,
            onDragEnd: customOnDragEnd,
            style: customStyle,
            ...restCustomRowProps
          } = customRowProps;

          const isDraggable = Boolean(restCustomRowProps.draggable);
          const baseCursor = isDraggable
            ? draggingRowKey === rowKey
              ? "grabbing"
              : "grab"
            : onRowClick
              ? "pointer"
              : "default";

          return (
            <tr
              key={rowKey}
              onClick={(event) => {
                if (typeof customOnClick === "function") {
                  customOnClick(event);
                }
                if (onRowClick) {
                  onRowClick(row);
                }
              }}
              onDragStart={(event) => {
                setDraggingRowKey(rowKey);
                if (typeof customOnDragStart === "function") {
                  customOnDragStart(event);
                }
              }}
              onDragEnd={(event) => {
                setDraggingRowKey(null);
                if (typeof customOnDragEnd === "function") {
                  customOnDragEnd(event);
                }
              }}
              style={{
                cursor: baseCursor,
                ...customStyle,
              }}
              {...restCustomRowProps}>
              {columns.map((c) => (
                <td key={(c.key || c.label) + getRowKey(row)} className={c.className || ""}>
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
      {footer ? <tfoot>{footer}</tfoot> : null}
    </table>
  );
}
