import { useState, useEffect, useMemo } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faUser,
  faFileInvoice,
  faTrash,
  faTimes,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../api";
import DataTable from "../components/DataTable";

export default function Rechnungen() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [kunden, setKunden] = useState([]);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({});
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    Nummer: "",
    Kundennummer: "",
    Artikelnummern: [],
  });
  const [availablePieces, setAvailablePieces] = useState([]);
  const [pieceSearch, setPieceSearch] = useState("");
  const [artikelnummerInput, setArtikelnummerInput] = useState("");
  const [sortConfig, setSortConfig] = useState({
    key: "Datum",
    direction: "desc",
  });
  const [groupByKunde, setGroupByKunde] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState(new Set());

  const load = () => {
    setLoading(true);
    api
      .getRechnungen()
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
      const d = await api.getRechnung(id);
      setDetail(d);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Rechnung wirklich löschen?")) return;
    try {
      await api.deleteRechnung(id);
      setDetail(null);
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleExcelExport = async (id, nummer) => {
    try {
      const blob = await api.exportRechnungExcel(id);
      const url = window.URL.createObjectURL(blob);
      const safeNummer = String(nummer || id).replace(/[\\/:*?"<>|]+/g, "_");
      const a = document.createElement("a");
      a.href = url;
      a.download = `Rechnung_${safeNummer}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      alert(err.message);
    }
  };

  const openNew = async () => {
    // Jahr bestimmen
    const year = new Date().getFullYear();
    // Alle Rechnungen des aktuellen Jahres filtern
    const yearRechnungen = data.filter((r) => {
      if (!r.Nummer) return false;
      const match = r.Nummer.match(/(\d{4})-(\d{3})$/);
      return match && match[1] === String(year);
    });
    let maxNr = 0;
    yearRechnungen.forEach((r) => {
      const match = r.Nummer.match(/(\d{4})-(\d{3})$/);
      if (match) {
        const nr = parseInt(match[2], 10);
        if (nr > maxNr) maxNr = nr;
      }
    });
    const nextNr = String(maxNr + 1).padStart(3, "0");
    setForm({
      Nummer: `${year}-${nextNr}`,
      Kundennummer: "",
      Artikelnummern: [],
    });
    setArtikelnummerInput("");
    setAvailablePieces([]);
    setEditing("new");
  };

  // Schmuckstücke laden, wenn Kunde gewählt wurde und im "new"-Dialog
  useEffect(() => {
    const loadPieces = async () => {
      if (editing !== "new" || !form.Kundennummer) {
        setAvailablePieces([]);
        return;
      }
      try {
        // Nur Stücke, die beim Kunden ausgelagert sind (Ausgelagert = KundenID)
        const resp = await api.getSchmuckstuecke({
          ausgelagert: form.Kundennummer,
          verkauft: "0",
          ausschuss: "0",
          limit: -1,
        });
        setAvailablePieces(resp.data);
      } catch (err) {
        setAvailablePieces([]);
        console.error(err);
      }
    };
    loadPieces();
  }, [form.Kundennummer, editing]);

  const handleSave = async () => {
    if (!form.Kundennummer) {
      alert("Bitte Kunde angeben.");
      return;
    }
    try {
      await api.createRechnung(form);
      setEditing(null);
      load();
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
      alert(
        `Artikelnummer "${nr}" nicht gefunden oder nicht beim Kunden ausgelagert.`,
      );
      return;
    }
    if (!form.Artikelnummern.includes(piece.Artikelnummer)) {
      setForm({
        ...form,
        Artikelnummern: [...form.Artikelnummern, piece.Artikelnummer],
      });
    }
    setArtikelnummerInput("");
  };

  const years = useMemo(() => {
    const y = new Set();
    data.forEach((r) => {
      if (r.Datum) y.add(new Date(r.Datum).getFullYear());
    });
    return Array.from(y).sort((a, b) => b - a);
  }, [data]);

  const filteredData = useMemo(() => {
    return data.filter((r) => {
      // Suchfilter
      if (search) {
        const s = search.toUpperCase();
        const match =
          r.Nummer?.toUpperCase().includes(s) ||
          r.KundenName?.toUpperCase().includes(s) ||
          String(r.ID).includes(s);
        if (!match) return false;
      }

      // Kundenfilter
      if (filters.kundennummer) {
        if (r.Kundennummer !== parseInt(filters.kundennummer)) return false;
      }

      // Year filter
      if (filters.jahr) {
        if (!r.Datum) return false;
        const jahr = new Date(r.Datum).getFullYear();
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
    for (const r of sortedData) {
      const key = r.Kundennummer;
      const name = r.KundenName || `Kunde ${r.Kundennummer}`;
      if (!seen.has(key)) {
        seen.set(key, groups.length);
        groups.push({ key, name, items: [] });
      }
      groups[seen.get(key)].items.push(r);
    }
    return groups.sort((a, b) => a.name.localeCompare(b.name));
  }, [sortedData, groupByKunde]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Rechnungen</h2>
          <p>{data.length} Rechnungen</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>
          + Neue Rechnung
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
                        <FontAwesomeIcon icon={faUser} /> {group.name}{" "}
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
                      ? group.items.map((r) => (
                          <tr
                            key={r.ID}
                            onClick={(e) => {
                              e.stopPropagation();
                              openDetail(r.ID);
                            }}
                            style={{ cursor: "pointer" }}>
                            <td>{r.Nummer}</td>
                            <td>{r.KundenName || `Kunde ${r.Kundennummer}`}</td>
                            <td className="hide-on-mobile">
                              {r.Datum
                                ? new Date(r.Datum).toLocaleDateString(
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

      {detail && (
        <div className="modal-overlay" onClick={() => setDetail(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                <FontAwesomeIcon icon={faFileInvoice} /> Rechnung{" "}
                {detail.Nummer} ({detail.ID})
              </h3>
              <button
                className="btn btn-primary btn-sm"
                style={{ marginLeft: "auto", marginRight: 8 }}
                onClick={() => handleExcelExport(detail.ID, detail.Nummer)}>
                Rechnung erstellen
              </button>
              <button
                className="btn btn-danger btn-sm"
                style={{ marginRight: 16 }}
                onClick={() => handleDelete(detail.ID)}>
                <FontAwesomeIcon icon={faTrash} /> Löschen
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
                <div className="detail-item">
                  <div className="detail-value">
                    {(() => {
                      const totalBrutto = detail.schmuckstuecke.reduce(
                        (sum, s) => sum + (Number(s.Verkaufspreis) || 0),
                        0,
                      );
                      const provisionPercent = Number(detail.Provision) || 0;
                      const provisionValue =
                        totalBrutto * (provisionPercent / 100);
                      const finalTotal = totalBrutto - provisionValue;

                      return (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "8px",
                          }}>
                          <div>
                            <span style={{ color: "#666", fontSize: "0.9em" }}>
                              Gesamtwert (brutto):
                            </span>{" "}
                            <strong>{totalBrutto.toFixed(2)} €</strong>
                          </div>
                          {provisionPercent > 0 && (
                            <div style={{ color: "#d32f2f" }}>
                              <span style={{ fontSize: "0.9em" }}>
                                - Provision ({provisionPercent}%):
                              </span>{" "}
                              <strong>{provisionValue.toFixed(2)} €</strong>
                            </div>
                          )}
                          <div
                            style={{
                              marginTop: "4px",
                              paddingTop: "8px",
                              borderTop: "1px solid #eee",
                              fontSize: "1.1em",
                            }}>
                            <span>Überweisungsbetrag:</span>{" "}
                            <strong
                              className="dblUnderlined"
                              style={{ color: "var(--primary)" }}>
                              {finalTotal.toFixed(2)} €
                            </strong>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
                <div className="detail-item">
                  <div className="detail-value">
                    {(() => {
                      const totalBrutto = detail.schmuckstuecke.reduce(
                        (sum, s) => sum + (Number(s.Verkaufspreis) || 0),
                        0,
                      );
                      const provisionPercent = Number(detail.Provision) || 0;
                      const provisionValue =
                        totalBrutto * (provisionPercent / 100);
                      const finalTotal = totalBrutto - provisionValue;

                      return (
                        <div
                          style={{
                            fontSize: "0.85em",
                            color: "#666",
                            marginTop: 8,
                            padding: "12px",
                            backgroundColor: "#f9f9f9",
                            borderRadius: "4px",
                            display: "flex",
                            flexDirection: "column",
                            gap: "8px",
                          }}>
                          <label
                            style={{
                              fontSize: "0.9em",
                              marginBottom: "0",
                              display: "block",
                              color: "#888",
                              fontWeight: "600",
                            }}>
                            Aufteilung (Netto nach Provision):
                          </label>

                          {(() => {
                            const marinaBrutto = detail.schmuckstuecke
                              .filter((s) =>
                                s.Artikelnummer?.toUpperCase().startsWith("M"),
                              )
                              .reduce(
                                (sum, s) =>
                                  sum + (Number(s.Verkaufspreis) || 0),
                                0,
                              );
                            const saskiaBrutto = detail.schmuckstuecke
                              .filter((s) =>
                                s.Artikelnummer?.toUpperCase().startsWith("S"),
                              )
                              .reduce(
                                (sum, s) =>
                                  sum + (Number(s.Verkaufspreis) || 0),
                                0,
                              );

                            const marinaNetto =
                              marinaBrutto * (1 - provisionPercent / 100);
                            const saskiaNetto =
                              saskiaBrutto * (1 - provisionPercent / 100);

                            return (
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  gap: "12px",
                                  flexWrap: "wrap",
                                }}>
                                <div>
                                  <strong>Marina:</strong>{" "}
                                  {marinaNetto.toFixed(2)} €
                                  <span
                                    style={{
                                      fontSize: "0.9em",
                                      color: "#999",
                                      marginLeft: "4px",
                                    }}>
                                    ({marinaBrutto.toFixed(2)} brutto)
                                  </span>
                                </div>
                                <div>
                                  <strong>Saskia:</strong>{" "}
                                  {saskiaNetto.toFixed(2)} €
                                  <span
                                    style={{
                                      fontSize: "0.9em",
                                      color: "#999",
                                      marginLeft: "4px",
                                    }}>
                                    ({saskiaBrutto.toFixed(2)} brutto)
                                  </span>
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })()}
                  </div>
                </div>
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
                              <span className="badge gold">
                                {s.Artikelnummer.split("_")[0]}
                              </span>
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
              <h3>🆕 Neue Rechnung ({form.Nummer})</h3>
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
                      setForm({
                        ...form,
                        Kundennummer: e.target.value,
                        Artikelnummern: [],
                      })
                    }>
                    <option value="">Bitte wählen...</option>
                    {kunden.map((k) => (
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
                  {/* Linke Seite: Beim Kunden ausgelagerte Schmuckstücke */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h5>Alle Schmuckstücke</h5>
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
                      searchValue={pieceSearch}
                      onSearchChange={setPieceSearch}
                      searchPlaceholder="Suchen..."
                      style={{ maxHeight: 400, overflowY: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}
                      disabled={!form.Kundennummer}
                    />
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
    </div>
  );
}
