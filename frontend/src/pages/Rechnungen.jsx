import { useState, useEffect, useMemo } from "react";
import { api } from "../api";

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
    setForm({ Nummer: `${year}-${nextNr}`, Kundennummer: "", Artikelnummern: [] });
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
        // Hole alle Lieferscheine des Kunden
        const lieferscheine = await api.getLieferscheine();
        const kundenLieferscheinIDs = lieferscheine
          .filter((l) => String(l.Kundennummer) === String(form.Kundennummer))
          .map((l) => l.ID);
        // Filter für Schmuckstücke
        const params = {
          ohne_rechnung: "1",
          verkauft: "0",
          ausschuss: "0",
          kunde: form.Kundennummer,
          limit: 1000,
        };
        const resp = await api.getSchmuckstuecke(params);
        // Nur Stücke, die keinem Lieferschein zugeordnet sind ODER deren Lieferschein_ID zu diesem Kunden gehört
        const filtered = resp.data.filter(
          (s) => !s.Lieferschein_ID || kundenLieferscheinIDs.includes(s.Lieferschein_ID)
        );
        setAvailablePieces(filtered);
      } catch (err) {
        setAvailablePieces([]);
        console.error(err);
      }
    };
    loadPieces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      <div
        className="page-header"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
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
          placeholder="🔍 Suche nach Nummer, Kunde, ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
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
          }}
        >
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
              e.target.value !== "" ? { ...rest, jahr: e.target.value } : rest,
            );
          }}
        >
          <option value="">Alle Jahre</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <label
          style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 14, color: "var(--text-secondary)", userSelect: "none" }}>
          <input
            type="checkbox"
            checked={groupByKunde}
            onChange={(e) => setGroupByKunde(e.target.checked)}
          />
          Nach Kunde gruppieren
        </label>
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
                    onClick={() => requestSort("ID")}
                    style={{ cursor: "pointer" }}
                  >
                    ID {getSortIcon("ID")}
                  </th>
                  <th
                    onClick={() => requestSort("Nummer")}
                    style={{ cursor: "pointer" }}
                  >
                    Nummer {getSortIcon("Nummer")}
                  </th>
                  <th
                    onClick={() => requestSort("KundenName")}
                    style={{ cursor: "pointer" }}
                  >
                    Kunde {getSortIcon("KundenName")}
                  </th>
                  <th
                    onClick={() => requestSort("Datum")}
                    style={{ cursor: "pointer" }}
                  >
                    Datum {getSortIcon("Datum")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {groupByKunde
                  ? groupedData.flatMap((group) => {
                    const isExpanded = expandedGroups.has(group.key);
                    return [
                      <tr
                        key={`group-${group.key}`}
                        className="group-header-row"
                        style={{ cursor: "pointer" }}
                        onClick={() => toggleGroup(group.key)}
                        aria-label={`Kundengruppe: ${group.name}`}
                      >
                        <td colSpan={4}>
                          <span style={{ marginRight: 8 }}>
                            {isExpanded ? "▼" : "▶"}
                          </span>
                          👤 {group.name}{" "}
                          <span style={{ fontWeight: "normal", color: "var(--text-muted)", fontSize: "0.9em" }}>
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
                              style={{ cursor: "pointer" }}
                            >
                              <td>{r.ID}</td>
                              <td>
                                <strong>{r.Nummer}</strong>
                              </td>
                              <td>{r.KundenName || `Kunde ${r.Kundennummer}`}</td>
                              <td>{new Date(r.Datum).toLocaleDateString("de-DE")}</td>
                            </tr>
                          ))
                        : [])
                    ];
                  })
                  : sortedData.map((r) => (
                      <tr
                        key={r.ID}
                        onClick={() => openDetail(r.ID)}
                        style={{ cursor: "pointer" }}
                      >
                        <td>{r.ID}</td>
                        <td>
                          <strong>{r.Nummer}</strong>
                        </td>
                        <td>{r.KundenName || `Kunde ${r.Kundennummer}`}</td>
                        <td>{new Date(r.Datum).toLocaleDateString("de-DE")}</td>
                      </tr>
                    ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {detail && (
        <div className="modal-overlay" onClick={() => setDetail(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                🧾 Rechnung {detail.Nummer} ({detail.ID})
              </h3>
              <button
                className="btn btn-primary btn-sm"
                style={{ marginLeft: "auto", marginRight: 8 }}
                onClick={() =>
                  window.open(api.getRechnungExcel(detail.ID), "_blank")
                }
              >
                Rechnung erstellen
              </button>
              <button
                className="btn btn-danger btn-sm"
                style={{ marginRight: 16 }}
                onClick={() => handleDelete(detail.ID)}
              >
                🗑️ Löschen
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
                    {new Date(detail.Datum).toLocaleDateString("de-DE")}
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
                          }}
                        >
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
                            }}
                          >
                            <span>Überweisungsbetrag:</span>{" "}
                            <strong
                              className="dblUnderlined"
                              style={{ color: "var(--primary)" }}
                            >
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
                          }}
                        >
                          <label
                            style={{
                              fontSize: "0.9em",
                              marginBottom: "0",
                              display: "block",
                              color: "#888",
                              fontWeight: "600",
                            }}
                          >
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
                                }}
                              >
                                <div>
                                  <strong>Marina:</strong>{" "}
                                  {marinaNetto.toFixed(2)} €
                                  <span
                                    style={{
                                      fontSize: "0.9em",
                                      color: "#999",
                                      marginLeft: "4px",
                                    }}
                                  >
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
                                    }}
                                  >
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
            }}
          >
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
                      setForm({ ...form, Kundennummer: e.target.value, Artikelnummern: [] })
                    }
                  >
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

                <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
                  {/* Linke Seite: Alle verfügbaren Schmuckstücke */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h5>Alle Schmuckstücke</h5>
                    <input
                      className="form-control"
                      style={{ width: "200px", marginBottom: 8 }}
                      placeholder="🔍 Suchen..."
                      value={pieceSearch}
                      onChange={(e) => setPieceSearch(e.target.value)}
                      disabled={!form.Kundennummer}
                    />
                    <div
                      style={{
                        maxHeight: "400px",
                        overflowY: "auto",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-sm)",
                      }}
                    >
                      <table className="data-table">
                        <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
                          <tr>
                            <th style={{ width: "40px" }}></th>
                            <th>Artikelnr.</th>
                            <th>Art</th>
                            <th>Preis</th>
                          </tr>
                        </thead>
                        <tbody>
                          {form.Kundennummer && availablePieces
                            .filter((p) => {
                              // Nur Stücke, deren Lieferschein_ID zu einem Lieferschein des Kunden gehört ODER kein Lieferschein zugeordnet ist
                              if (!p.Lieferschein_ID) return false;
                              // Lieferschein_ID muss zu diesem Kunden gehören
                              // availablePieces ist bereits nach Kunde gefiltert, aber wir filtern hier nochmal sicherheitshalber
                              return (
                                (!pieceSearch ||
                                  p.Artikelnummer.toUpperCase().includes(pieceSearch.toUpperCase()) ||
                                  p.Art.toUpperCase().includes(pieceSearch.toUpperCase()))
                              );
                            })
                            .map((p) => (
                              <tr
                                key={p.Artikelnummer}
                                onClick={() => togglePiece(p.Artikelnummer)}
                                style={{ cursor: "pointer" }}
                              >
                                <td>
                                  <input
                                    type="checkbox"
                                    checked={form.Artikelnummern.includes(
                                      p.Artikelnummer,
                                    )}
                                    readOnly
                                  />
                                </td>
                                <td>{p.Artikelnummer}</td>
                                <td>{p.Art}</td>
                                <td>{p.Verkaufspreis}€</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  {/* Rechte Seite: Selektierte Schmuckstücke */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h5>
                      Ausgewählte Schmuckstücke ({form.Artikelnummern.length})
                    </h5>
                    <input
                      className="form-control"
                      style={{ width: "200px", marginBottom: 8 }}
                      placeholder="🔍 Suchen..."
                      value={pieceSearch}
                      onChange={(e) => setPieceSearch(e.target.value)}
                      disabled
                    />
                    <div
                      style={{
                        maxHeight: "400px",
                        overflowY: "auto",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-sm)",
                      }}
                    >
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
                          {form.Kundennummer && form.Artikelnummern
                            .map((nr) => {
                              // Nur Stücke anzeigen, die auch wirklich zu diesem Kunden gehören
                              const piece = availablePieces.find(
                                (p) => p.Artikelnummer === nr
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
                                      ✕
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
                onClick={() => setEditing(null)}
              >
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
