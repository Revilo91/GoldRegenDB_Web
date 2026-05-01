// Gemeinsame Komponente für Lieferscheine und Rechnungen
// Reuse-Strategie: Alle Logik, die identisch ist, wird hier gekapselt.
// Unterschiede werden über Props (z.B. api, Labels, Excel-Export, Stückauswahl) gesteuert.

import { useState, useEffect, useMemo } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import DataTable from "../components/DataTable";
import SchmuckstueckModal from "../components/SchmuckstueckModal";

/**
 * Props:
 * - type: "lieferschein" | "rechnung"
 * - api: { getList, getDetail, deleteItem, createItem, exportExcel, getPieces }
 * - icons: { header, modal }
 * - labels: { header, newBtn, modalTitle, excel, delete, pieceSelect, pieceSelected, pieceAdd, pieceRemove, ... }
 * - pieceFilter: (form, editing) => Filterobjekt für getPieces
 * - pieceSelectMode: "all" | "byKunde" (lieferschein: alle verfügbaren, rechnung: nur ausgelagert beim Kunden)
 */
export default function DocumentManager({
  type,
  api,
  icons,
  labels,
  pieceFilter,
  pieceSelectMode = "all",
}) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [kunden, setKunden] = useState([]);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({});
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ Nummer: "", Kundennummer: "", Artikelnummern: [] });
  const [availablePieces, setAvailablePieces] = useState([]);
  const [pieceSearch, setPieceSearch] = useState("");
  const [artikelnummerInput, setArtikelnummerInput] = useState("");
  const [sortConfig, setSortConfig] = useState({ key: "Datum", direction: "desc" });
  const [groupByKunde, setGroupByKunde] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [schmuckstueckOverlay, setSchmuckstueckOverlay] = useState(null);

  // Laden
  const load = () => {
    setLoading(true);
    api.getList()
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    api.getKunden().then(setKunden).catch(console.error);
  }, []);

  const openDetail = async (id) => {
    try {
      const d = await api.getDetail(id);
      setDetail(d);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm(labels.deleteConfirm)) return;
    try {
      await api.deleteItem(id);
      setDetail(null);
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleExcelExport = async (id, nummer) => {
    try {
      const blob = await api.exportExcel(id);
      const url = window.URL.createObjectURL(blob);
      const safeNummer = String(nummer || id).replace(/[\\/:*?"<>|]+/g, "_");
      const a = document.createElement("a");
      a.href = url;
      a.download = `${labels.excelFilePrefix}_${safeNummer}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      alert(err.message);
    }
  };

  // Stückauswahl laden (unterschiedlich je nach Dokumenttyp)
  const loadAvailablePieces = async () => {
    try {
      const resp = await api.getPieces(pieceFilter(form, editing));
      setAvailablePieces(resp.data);
    } catch (err) {
      setAvailablePieces([]);
      console.error(err);
    }
  };

  // Neues Dokument anlegen
  const openNew = async () => {
    const year = new Date().getFullYear();
    const yearDocs = data.filter((d) => {
      if (!d.Nummer) return false;
      const match = d.Nummer.match(/(\d{4})-(\d{3})$/);
      return match && match[1] === String(year);
    });
    let maxNr = 0;
    yearDocs.forEach((d) => {
      const match = d.Nummer.match(/(\d{4})-(\d{3})$/);
      if (match) {
        const nr = parseInt(match[2], 10);
        if (nr > maxNr) maxNr = nr;
      }
    });
    const nextNr = String(maxNr + 1).padStart(3, "0");
    setForm({ Nummer: `${year}-${nextNr}`, Kundennummer: "", Artikelnummern: [] });
    setPieceSearch("");
    setArtikelnummerInput("");
    setEditing("new");
    loadAvailablePieces();
  };

  // Stückauswahl nach Kunde (nur für Rechnungen)
  useEffect(() => {
    if (pieceSelectMode === "byKunde" && editing === "new" && form.Kundennummer) {
      loadAvailablePieces();
    } else if (pieceSelectMode === "byKunde" && (!form.Kundennummer || editing !== "new")) {
      setAvailablePieces([]);
    }
    // Lieferschein: alle Stücke werden beim Öffnen geladen
  }, [form.Kundennummer, editing]);

  const handleSave = async () => {
    if (!form.Kundennummer) {
      alert(labels.kundeRequired);
      return;
    }
    try {
      await api.createItem(form);
      setEditing(null);
      load();
      if (pieceSelectMode === "all") loadAvailablePieces();
    } catch (err) {
      alert(err.message);
    }
  };

  const togglePiece = (nr) => {
    const nrs = [...form.Artikelnummern];
    if (nrs.includes(nr)) {
      setForm({ ...form, Artikelnummern: nrs.filter((n) => n !== nr) });
    } else {
      setForm({ ...form, Artikelnummern: [...nrs, nr] });
    }
  };

  const addByArtikelnummer = () => {
    const nr = artikelnummerInput.trim();
    if (!nr) return;
    const piece = availablePieces.find(
      (p) => p.Artikelnummer.toUpperCase() === nr.toUpperCase(),
    );
    if (!piece) {
      alert(labels.pieceNotFound(nr));
      return;
    }
    if (!form.Artikelnummern.includes(piece.Artikelnummer)) {
      setForm({ ...form, Artikelnummern: [...form.Artikelnummern, piece.Artikelnummer] });
    }
    setArtikelnummerInput("");
  };

  // Filter, Sortierung, Gruppierung
  const years = useMemo(() => {
    const y = new Set();
    data.forEach((d) => {
      if (d.Datum) y.add(new Date(d.Datum).getFullYear());
    });
    return Array.from(y).sort((a, b) => b - a);
  }, [data]);

  const aktiveKunden = useMemo(
    () => kunden.filter((kunde) => kunde.Aktiv === true || kunde.Aktiv === 1),
    [kunden],
  );

  const filteredData = useMemo(() => {
    return data.filter((d) => {
      if (search) {
        const s = search.toUpperCase();
        const match =
          d.Nummer?.toUpperCase().includes(s) ||
          d.KundenName?.toUpperCase().includes(s) ||
          String(d.ID).includes(s);
        if (!match) return false;
      }
      if (filters.kundennummer) {
        if (d.Kundennummer !== parseInt(filters.kundennummer)) return false;
      }
      if (filters.jahr) {
        if (!d.Datum) return false;
        const jahr = new Date(d.Datum).getFullYear();
        if (String(jahr) !== String(filters.jahr)) return false;
      }
      return true;
    });
  }, [data, search, filters]);

  const sortedData = useMemo(() => {
    let sortableData = [...filteredData];
    if (sortConfig.key !== null) {
      sortableData.sort((a, b) => {
        let aValue = a[sortConfig.key];
        let bValue = b[sortConfig.key];
        if (sortConfig.key === "KundenName") {
          aValue = (a.KundenName || `Kunde ${a.Kundennummer}`).toUpperCase();
          bValue = (b.KundenName || `Kunde ${b.Kundennummer}`).toUpperCase();
        }
        if (aValue < bValue) return sortConfig.direction === "asc" ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === "asc" ? 1 : -1;
        return 0;
      });
    }
    return sortableData;
  }, [filteredData, sortConfig]);

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

  const toggleGroup = (groupKey) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(groupKey)) {
      newExpanded.delete(groupKey);
    } else {
      newExpanded.add(groupKey);
    }
    setExpandedGroups(newExpanded);
  };

  const groupedData = useMemo(() => {
    if (!groupByKunde) return null;
    const groups = [];
    const seen = new Map();
    for (const d of sortedData) {
      const key = d.Kundennummer;
      const name = d.KundenName || `Kunde ${d.Kundennummer}`;
      if (!seen.has(key)) {
        seen.set(key, groups.length);
        groups.push({ key, name, items: [] });
      }
      groups[seen.get(key)].items.push(d);
    }
    return groups.sort((a, b) => a.name.localeCompare(b.name));
  }, [sortedData, groupByKunde]);

  // Render
  return (
    <div>
      <div className="page-header">
        <div>
          <h2>{labels.header}</h2>
          <p>{data.length} {labels.header}</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>
          {labels.newBtn}
        </button>
      </div>

      <div className="toolbar">
        <input
          className="form-control search-input"
          placeholder="Suche nach Nummer, Kunde, ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="filter-group">
          <select
            className="form-control"
            style={{ width: "auto", minWidth: 150 }}
            value={filters.kundennummer ?? ""}
            onChange={(e) => {
              const { kundennummer, ...rest } = filters;
              setFilters(
                e.target.value !== ""
                  ? { ...rest, kundennummer: e.target.value }
                  : rest,
              );
            }}>
            <option value="">Alle Kunden</option>
            {kunden.map((k) => (
              <option key={k.ID} value={k.ID}>
                {k.Name}
              </option>
            ))}
          </select>
          <select
            className="form-control"
            style={{ width: "auto" }}
            value={filters.jahr ?? ""}
            onChange={(e) => {
              const { jahr, ...rest } = filters;
              setFilters(
                e.target.value !== ""
                  ? { ...rest, jahr: e.target.value }
                  : rest,
              );
            }}>
            <option value="">Alle Jahre</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              cursor: "pointer",
              fontSize: 14,
              color: "var(--text-secondary)",
              userSelect: "none",
            }}>
            <input
              type="checkbox"
              checked={groupByKunde}
              onChange={(e) => setGroupByKunde(e.target.checked)}
            />
            Nach Kunde gruppieren
          </label>
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          {loading ? (
            <div className="loading">
              <div className="spinner"></div>Lade...
            </div>
          ) : groupByKunde ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ cursor: "pointer" }}>Nummer</th>
                  <th style={{ cursor: "pointer" }}>Kunde</th>
                  <th className="hide-on-mobile" style={{ cursor: "pointer" }}>
                    Datum
                  </th>
                </tr>
              </thead>
              <tbody>
                {groupedData.flatMap((group) => {
                  const isExpanded = expandedGroups.has(group.key);
                  return [
                    <tr
                      key={`group-${group.key}`}
                      className="group-header-row"
                      style={{ cursor: "pointer" }}
                      onClick={() => toggleGroup(group.key)}
                      aria-label={`Kundengruppe: ${group.name}`}>
                      <td colSpan={4}>
                        <span style={{ marginRight: 8 }}>
                          {isExpanded ? "▼" : "▶"}
                        </span>
                        <FontAwesomeIcon icon={icons.user} /> {group.name}{" "}
                        <span
                          style={{
                            fontWeight: "normal",
                            color: "var(--text-muted)",
                            fontSize: "0.9em",
                          }}>
                          ({group.items.length})
                        </span>
                      </td>
                    </tr>,
                    ...(isExpanded
                      ? group.items.map((d) => (
                          <tr
                            key={d.ID}
                            onClick={(e) => {
                              e.stopPropagation();
                              openDetail(d.ID);
                            }}
                            style={{ cursor: "pointer" }}>
                            <td>{d.Nummer}</td>
                            <td>{d.KundenName || `Kunde ${d.Kundennummer}`}</td>
                            <td className="hide-on-mobile">
                              {d.Datum
                                ? new Date(d.Datum).toLocaleDateString(
                                    "de-DE",
                                    {
                                      day: "2-digit",
                                      month: "2-digit",
                                      year: "numeric",
                                    },
                                  )
                                : ""}
                            </td>
                          </tr>
                        ))
                      : []),
                  ];
                })}
              </tbody>
            </table>
          ) : (
            <DataTable
              data={sortedData}
              defaultSort={{ key: "Datum", direction: "desc" }}
              onRowClick={(r) => openDetail(r.ID)}
              columns={[
                { key: "Nummer", label: "Nummer", sortable: true },
                {
                  key: "KundenName",
                  label: "Kunde",
                  sortable: true,
                  render: (r) => r.KundenName || `Kunde ${r.Kundennummer}`,
                },
                {
                  key: "Datum",
                  label: "Datum",
                  className: "hide-on-mobile",
                  sortable: true,
                  render: (r) =>
                    r.Datum
                      ? new Date(r.Datum).toLocaleDateString("de-DE", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                        })
                      : "",
                },
              ]}
            />
          )}
        </div>
      </div>

      {/* Detail-Modal */}
      {detail && (
        <div className="modal-overlay" onClick={() => setDetail(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                <FontAwesomeIcon icon={icons.modal} /> {labels.header} {detail.Nummer} ({detail.ID})
              </h3>
              <button
                className="btn btn-primary btn-sm"
                style={{ marginLeft: "auto", marginRight: 8 }}
                onClick={() => handleExcelExport(detail.ID, detail.Nummer)}>
                {labels.excel}
              </button>
              <button
                className="btn btn-danger btn-sm"
                style={{ marginRight: 16 }}
                onClick={() => handleDelete(detail.ID)}>
                <FontAwesomeIcon icon={icons.trash} /> {labels.delete}
              </button>
              <button className="modal-close" onClick={() => setDetail(null)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="detail-grid">
                <div className="detail-item">
                  <label>Kunde</label>
                  <div className="detail-value">{detail.KundenName}</div>
                </div>
                <div className="detail-item">
                  <label>Datum</label>
                  <div className="detail-value">
                    {new Date(detail.Datum).toLocaleDateString("de-DE", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                    })}
                  </div>
                </div>
                {/* Provision, Aufteilung, Schmuckstücke analog zu Originaldateien */}
                {/* ...hier kann je nach type/labels weiteres Rendering erfolgen... */}
              </div>
              {detail.schmuckstuecke?.length > 0 && (
                <>
                  <h4 style={{ padding: "16px 24px 8px", fontSize: 15 }}>
                    Zugehörige Schmuckstücke ({detail.schmuckstuecke.length})
                  </h4>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Artikelnr.</th>
                        <th>Art</th>
                        <th>Preis</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.schmuckstuecke
                        .sort((a, b) =>
                          a.Artikelnummer.split("_")[0].localeCompare(
                            b.Artikelnummer.split("_")[0],
                          ),
                        )
                        .map((s) => (
                          <tr key={s.Artikelnummer}>
                            <td>
                              <button
                                style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
                                onClick={(e) => { e.stopPropagation(); setSchmuckstueckOverlay(s.Artikelnummer); }}>
                                <span className="badge gold">
                                  {s.Artikelnummer.split("_")[0]}
                                </span>
                              </button>
                            </td>
                            <td>{s.Art}</td>
                            <td>{Number(s.Verkaufspreis).toFixed(0)}€</td>
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

      {/* Modal für neues Dokument */}
      {editing === "new" && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div
            className="modal modal-lg"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "95vw",
              height: "95vh",
              maxWidth: "1200px",
              maxHeight: "800px",
            }}>
            <div className="modal-header">
              <h3>{labels.modalTitle} ({form.Nummer})</h3>
              <button className="modal-close" onClick={() => setEditing(null)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group">
                  <label>Kunde*</label>
                  <select
                    className="form-control"
                    value={form.Kundennummer}
                    onChange={(e) =>
                      setForm({ ...form, Kundennummer: e.target.value, ...(pieceSelectMode === "byKunde" ? { Artikelnummern: [] } : {}) })
                    }>
                    <option value="">Bitte wählen...</option>
                    {aktiveKunden.map((k) => (
                      <option key={k.ID} value={k.ID}>
                        {k.Name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="piece-selection" style={{ marginTop: 24 }}>
                <div
                  style={{
                    display: "flex",
                    gap: 24,
                    alignItems: "flex-start",
                  }}>
                  {/* Linke Seite: Stückauswahl */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h5>Alle Schmuckstücke</h5>
                    <input
                      className="form-control search-input"
                      style={{ marginBottom: 8 }}
                      placeholder="Schmuckstücke suchen..."
                      value={pieceSearch}
                      onChange={(e) => setPieceSearch(e.target.value)}
                      disabled={pieceSelectMode === "byKunde" && !form.Kundennummer}
                    />
                    <DataTable
                      data={availablePieces
                        .filter((p) =>
                          pieceSearch.trim() === ""
                            ? true
                            : [
                                p.Artikelnummer,
                                p.Art,
                                String(p.Verkaufspreis),
                              ]
                                .join(" ")
                                .toLowerCase()
                                .includes(pieceSearch.trim().toLowerCase()),
                        )}
                      columns={[
                        {
                          key: "select",
                          label: "",
                          render: (p) => (
                            <input
                              type="checkbox"
                              checked={form.Artikelnummern.includes(p.Artikelnummer)}
                              readOnly
                            />
                          ),
                          width: 40,
                        },
                        { key: "Artikelnummer", label: "Artikelnr.", sortable: true },
                        { key: "Art", label: "Art", sortable: true },
                        {
                          key: "Verkaufspreis",
                          label: "Preis",
                          sortable: true,
                          render: (p) => `${p.Verkaufspreis}€`,
                        },
                      ]}
                      onRowClick={(p) => togglePiece(p.Artikelnummer)}
                      rowProps={(p) => ({
                        draggable: true,
                        onDragStart: (e) =>
                          e.dataTransfer.setData("artikelnummer", p.Artikelnummer),
                        style: { cursor: "grab" },
                      })}
                      style={{ maxHeight: 400, overflowY: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}
                      disabled={pieceSelectMode === "byKunde" && !form.Kundennummer}
                    />
                  </div>
                  {/* Rechte Seite: Selektierte Stücke */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h5>
                      Ausgewählte Schmuckstücke ({form.Artikelnummern.length})
                    </h5>
                    <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                      <input
                        className="form-control"
                        style={{ flex: 1 }}
                        placeholder="Artikelnummer eingeben..."
                        value={artikelnummerInput}
                        onChange={(e) => setArtikelnummerInput(e.target.value)}
                        onKeyDown={(e) =>
                          e.key === "Enter" && addByArtikelnummer()
                        }
                        disabled={pieceSelectMode === "byKunde" && !form.Kundennummer}
                      />
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={addByArtikelnummer}
                        disabled={pieceSelectMode === "byKunde" && !form.Kundennummer}>
                        Hinzufügen
                      </button>
                    </div>
                    <div
                      style={{
                        maxHeight: "400px",
                        overflowY: "auto",
                        border: "2px dashed var(--border)",
                        borderRadius: "var(--radius-sm)",
                      }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const nr = e.dataTransfer.getData("artikelnummer");
                        if (nr && !form.Artikelnummern.includes(nr)) {
                          setForm({
                            ...form,
                            Artikelnummern: [...form.Artikelnummern, nr],
                          });
                        }
                      }}>
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Artikelnr.</th>
                            <th>Art</th>
                            <th>Preis</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {form.Artikelnummern.map((nr) => {
                            const piece = availablePieces.find(
                              (p) => p.Artikelnummer === nr,
                            );
                            if (!piece) return null;
                            return (
                              <tr key={nr}>
                                <td>{piece.Artikelnummer}</td>
                                <td>{piece.Art}</td>
                                <td>{piece.Verkaufspreis}€</td>
                                <td>
                                  <button
                                    className="btn btn-danger btn-sm"
                                    title="Entfernen"
                                    onClick={() => togglePiece(nr)}>
                                    <FontAwesomeIcon icon={icons.times} />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => setEditing(null)}>
                Abbrechen
              </button>
              <button className="btn btn-primary" onClick={handleSave}>
                Speichern
              </button>
            </div>
          </div>
        </div>
      )}
      {schmuckstueckOverlay && (
        <SchmuckstueckModal
          artikelnummer={schmuckstueckOverlay}
          onClose={() => setSchmuckstueckOverlay(null)}
        />
      )}
    </div>
  );
}
