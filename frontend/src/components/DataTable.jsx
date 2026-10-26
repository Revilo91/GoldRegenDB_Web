import React, { useState, useMemo, useRef, useEffect } from "react";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { MOBILE_QUERY } from "../utils/breakpoints";

export default function DataTable({
  columns = [],
  data = [],
  className = "",
  onRowClick,
  rowProps,
  defaultSort = { key: null, direction: "asc" },
  getRowKey = (r) => r.id || r.ID || JSON.stringify(r),
  footer = null,
  onSortedChange, // optional: (Zeilenschlüssel[]) => void, meldet die sichtbare Reihenfolge nach jeder Änderung
  mobileRow, // optional: (row) => Knoten; ersetzt auf dem Handy die Tabelle durch eine Liste (ohne Sortierauswahl)
}) {
  const istMobil = useMediaQuery(MOBILE_QUERY);
  const [sortConfig, setSortConfig] = useState(defaultSort);
  const [draggingRowKey, setDraggingRowKey] = useState(null);
  const suppressClickUntilRef = useRef(0);

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

  // Nur die Schlüsselfolge als Text ist stabil; `sorted` selbst ist bei jedem neuen `columns`-Array eine neue Liste
  const reihenfolge = onSortedChange ? JSON.stringify(sorted.map((row) => getRowKey(row))) : null;
  const onSortedChangeRef = useRef(onSortedChange);
  useEffect(() => {
    onSortedChangeRef.current = onSortedChange;
  });
  useEffect(() => {
    if (reihenfolge !== null) onSortedChangeRef.current?.(JSON.parse(reihenfolge));
  }, [reihenfolge]);

  const requestSort = (key) => {
    let direction = "asc";
    if (sortConfig.key === key && sortConfig.direction === "asc") direction = "desc";
    setSortConfig({ key, direction });
  };

  const getSortIcon = (key) => {
    if (sortConfig.key !== key) return "↕️";
    return sortConfig.direction === "asc" ? "🔼" : "🔽";
  };

  if (mobileRow && istMobil) {
    return (
      <ul className={`data-table-mobil ${className}`.trim()}>
        {sorted.map((row) => {
          const klickbar = Boolean(onRowClick);
          return (
            <li
              key={getRowKey(row)}
              className={klickbar ? "data-table-mobil-item data-table-row-pointer" : "data-table-mobil-item"}
              role={klickbar ? "button" : undefined}
              tabIndex={klickbar ? 0 : undefined}
              onClick={klickbar ? () => onRowClick(row) : undefined}
              onKeyDown={
                klickbar
                  ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onRowClick(row);
                      }
                    }
                  : undefined
              }>
              {mobileRow(row)}
            </li>
          );
        })}
        {footer}
      </ul>
    );
  }

  return (
    <table className={`data-table ${className}`.trim()}>
      <thead>
        <tr>
          {columns.map((c) => (
            <th
              key={c.key || c.label}
              className={`${c.className || ""} ${c.headerClassName || ""} ${c.sortable ? "data-table-th-sortable" : "data-table-th-static"}`.trim()}
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
            className: customClassName,
            ...restCustomRowProps
          } = customRowProps;

          const isDraggable = Boolean(restCustomRowProps.draggable);
          const rowCursorClass = isDraggable
            ? draggingRowKey === rowKey
              ? "data-table-row-grabbing"
              : "data-table-row-grab"
            : onRowClick
              ? "data-table-row-pointer"
              : "data-table-row-default";

          return (
            <tr
              key={rowKey}
              onClick={(event) => {
                if (Date.now() < suppressClickUntilRef.current) {
                  event.preventDefault();
                  return;
                }
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
                // Prevent synthetic click firing right after a drag/drop interaction.
                suppressClickUntilRef.current = Date.now() + 250;
                if (typeof customOnDragEnd === "function") {
                  customOnDragEnd(event);
                }
              }}
              className={`${rowCursorClass} ${customClassName || ""}`.trim()}
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
