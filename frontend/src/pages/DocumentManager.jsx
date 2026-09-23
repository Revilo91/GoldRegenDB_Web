import { useState, useEffect, useMemo } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import DataTable from "../components/DataTable";
import SchmuckstueckModal from "../components/SchmuckstueckModal";
import { formatEur } from "../utils/zahlen";

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
  const [form, setForm] = useState({
    Nummer: "",
    Kundennummer: "",
    Artikelnummern: [],
    rabatt_gesamt: 0,
    rabatt_positionen: {},
  });
  const [availablePieces, setAvailablePieces] = useState([]);
  const [pieceSearch, setPieceSearch] = useState("");
  const [artikelnummerInput, setArtikelnummerInput] = useState("");
  // Konstant: setSortConfig wird nirgends aufgerufen, die Sortierung stand
  // also schon immer fest auf diesem Wert (Befund G14).
  const sortConfig = { key: "Datum", direction: "desc" };
  const [groupByKunde, setGroupByKunde] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [schmuckstueckOverlay, setSchmuckstueckOverlay] = useState(null);

  // Entwurf bearbeiten
  const openEditDraft = async (doc) => {
    try {
      const d = await api.getDetail(doc.ID);
      const neuesForm = {
        Nummer: d.Nummer,
        Kundennummer: d.Kundennummer,
        Artikelnummern: d.schmuckstuecke?.map(s => s.Artikelnummer) || [],
        rabatt_gesamt: Number(d.rabatt_gesamt) || 0,
        rabatt_positionen: d.rabatt_positionen || {},
      };
      setForm(neuesForm);
      setPieceSearch("");
      setArtikelnummerInput("");
      setEditing(doc.ID); // Edit mode with document ID
      setDetail(null); // Close detail modal
      await loadAvailablePieces(neuesForm, doc.ID);
    } catch (err) {
      alert(err.message);
    }
  };

  // Entwurf finalisieren
  const finalizeDraft = async (id) => {
    if (!confirm('Möchten Sie diesen Entwurf wirklich abschließen? Nach dem Abschließen werden die Schmuckstücke zugewiesen und der Status kann nicht mehr geändert werden.')) {
      return;
    }
    try {
      const d = await api.getDetail(id);
      await api.updateItem(id, {
        Nummer: d.Nummer,
        Kundennummer: d.Kundennummer,
        Artikelnummern: d.schmuckstuecke?.map(s => s.Artikelnummer) || [],
        status: 'final',
        rabatt_gesamt: Number(d.rabatt_gesamt) || 0,
        rabatt_positionen: d.rabatt_positionen || {},
      });
      setDetail(null);
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  // Laden
  const load = () => {
    setLoading(true);
    api
      .getList()
      .then(setData)
      .catch((err) => alert("Fehler beim Laden der Dokumente: " + err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    api.getKunden().then(setKunden).catch((err) => alert("Fehler beim Laden der Kunden: " + err.message));
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

  // Stückauswahl laden (unterschiedlich je nach Dokumenttyp).
  //
  // Form und Editing-Zustand werden übergeben, nicht aus der Closure gelesen:
  // openNew und openEditDraft rufen setForm/setEditing und direkt danach diese
  // Funktion auf. Aus der Closure kam dann noch der ALTE Zustand, für
  // Rechnungen also `{ ausgelagert: "" }`. Das ging als `ausgelagert=` ans
  // Backend, wo builder.equals("Ausgelagert", parseInt("")) einen NaN-Parameter
  // erzeugte – Postgres antwortete mit "invalid input syntax for type integer"
  // und der Nutzer sah einen 500er (Befund G5). Weil availablePieces danach
  // leer blieb, zeigte der Kopf "Ausgewählte Schmuckstücke (n)" über einer
  // leeren Tabelle, und Speichern schrieb die unsichtbaren Positionen trotzdem
  // (Befund G6).
  const loadAvailablePieces = async (formToUse = form, editingToUse = editing) => {
    try {
      const resp = await api.getPieces(pieceFilter(formToUse, editingToUse));
      setAvailablePieces(resp.data);
    } catch (err) {
      setAvailablePieces([]);
      alert("Fehler beim Laden der verfügbaren Schmuckstücke: " + err.message);
    }
  };

  // Neues Dokument anlegen
  const openNew = async () => {
    let nummer = "";
    if (typeof api.getNextNumber === "function") {
      try {
        const response = await api.getNextNumber();
        nummer = String(response?.Nummer || "").trim();
      } catch (err) {
        alert("Nächste Nummer konnte nicht abgerufen werden: " + err.message);
      }
    }

    const neuesForm = {
      Nummer: nummer,
      Kundennummer: "",
      Artikelnummern: [],
      rabatt_gesamt: 0,
      rabatt_positionen: {},
    };
    setForm(neuesForm);
    setPieceSearch("");
    setArtikelnummerInput("");
    setEditing("new");
    // Nur im Modus "all" (Lieferschein) sofort laden. Bei "byKunde" (Rechnung)
    // baut pieceFilter `ausgelagert: form.Kundennummer` – der ist hier noch
    // leer, das ergäbe `ausgelagert=` und im Backend einen NaN-Parameter, also
    // einen 500er direkt beim Öffnen des Dialogs. Sobald ein Kunde gewählt ist,
    // lädt der useEffect unten nach. handleSave prüft genau so (Befund G5).
    if (pieceSelectMode === "all") {
      loadAvailablePieces(neuesForm, "new");
    } else {
      setAvailablePieces([]);
    }
  };

  // Stückauswahl nach Kunde (nur für Rechnungen).
  //
  // Die Bedingung war vorher `editing === "new"`, ein geöffneter Entwurf bekam
  // damit nie eine Stückliste – seine ausgewählten Positionen blieben in der
  // Tabelle unsichtbar, obwohl der Kopf sie zählte (Befund G5/G6). Jetzt lädt
  // jeder Bearbeitungszustand nach, sobald ein Kunde gesetzt ist.
  useEffect(() => {
    if (pieceSelectMode !== "byKunde") {
      // Lieferschein: alle Stücke werden beim Öffnen geladen
      return;
    }
    if (editing && form.Kundennummer) {
      loadAvailablePieces(form, editing);
    } else {
      setAvailablePieces([]);
    }
  }, [form.Kundennummer, editing]);

  const handleSave = async (status = 'final') => {
    if (!form.Kundennummer) {
      alert(labels.kundeRequired);
      return;
    }
    // Die Nummer wurde vorher per getNextNumber geholt. Ohne diese Sperre
    // erzeugte ein Doppelklick zwei Dokumente mit identischer Nummer bzw. eine
    // Primary-Key-Verletzung (Befund G4).
    if (saving) return;
    setSaving(true);
    try {
      if (editing === 'new') {
        await api.createItem({ ...form, status });
      } else {
        // Editing existing document
        await api.updateItem(editing, { ...form, status });
      }
      setEditing(null);
      setDetail(null);
      load();
      if (pieceSelectMode === "all") loadAvailablePieces();
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const togglePiece = (nr) => {
    const nrs = [...form.Artikelnummern];
    if (nrs.includes(nr)) {
      // Remove per-item discount when piece is removed
      const basis = nr.split("_")[0];
      const remainingWithSameBasis = nrs.filter((n) => n !== nr && n.split("_")[0] === basis);
      const newRabattPositionen = { ...form.rabatt_positionen };
      if (remainingWithSameBasis.length === 0) {
        delete newRabattPositionen[basis];
      }
      setForm({ ...form, Artikelnummern: nrs.filter((n) => n !== nr), rabatt_positionen: newRabattPositionen });
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
      setForm({
        ...form,
        Artikelnummern: [...form.Artikelnummern, piece.Artikelnummer],
      });
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

  // requestSort/getSortIcon waren nie verdrahtet – kein Header rief sie auf.
  // Dadurch wird setSortConfig nirgends aufgerufen und die Sortierung unten
  // steht dauerhaft auf ihrem Anfangswert; DataTable sortiert danach ohnehin
  // ein zweites Mal clientseitig (Befund G14). Die tote Implementierung ist
  // entfernt, das eingefrorene useMemo bleibt vorerst, weil es die
  // Anfangsreihenfolge der Liste bestimmt.

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
          <p>
            {data.length} {labels.header}
          </p>
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
            className="form-control doc-filter-select"
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
            className="form-control doc-filter-select-year"
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
          <label className="doc-group-checkbox-label">
            <input
              type="checkbox"
              className="form-checkbox"
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
                {
                  key: "status",
                  label: "Status",
                  sortable: true,
                  render: (r) => {
                    if (r.status === 'entwurf') {
                      return (
                        <span className="badge data-table-status-badge">
                          Entwurf
                        </span>
                      );
                    }
                    return (
                      <span className="badge data-table-status-badge success">
                        Abgeschlossen
                      </span>
                    );
                  },
                },
              ]}
            />
          )}
        </div>
      </div>

      {/* Detail-Modal */}
      {detail && (
        <div className="modal-overlay">
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                <FontAwesomeIcon icon={icons.modal} /> {labels.header}{" "}
                {detail.Nummer}
                {detail.status === 'entwurf' && (
                  <span className="badge modal-header-badge">
                    Entwurf
                  </span>
                )}
              </h3>
              {detail.status === 'entwurf' && (
                <>
                  <button
                    className="btn btn-primary btn-sm header-action-btn"
                    onClick={() => openEditDraft(detail)}>
                    Bearbeiten
                  </button>
                  <button
                    className="btn btn-success btn-sm"
                    style={{ marginRight: 8 }}
                    onClick={() => finalizeDraft(detail.ID)}>
                    Abschließen
                  </button>
                </>
              )}
              {detail.status === 'final' && (
                <button
                  className="btn btn-primary btn-sm header-action-btn"
                  onClick={() => handleExcelExport(detail.ID, detail.Nummer)}>
                  {labels.excel}
                </button>
              )}
              <button
                className="btn btn-danger btn-sm header-delete-btn"
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
                {type === "rechnung" && Number(detail.rabatt_gesamt) > 0 && (
                  <div className="detail-item">
                    <label>Gesamtrabatt</label>
                    <div className="detail-value detail-value-warning">
                      {Number(detail.rabatt_gesamt)}%
                    </div>
                  </div>
                )}
              </div>
              {/* Aufteilung Marina & Saskia */}
              {detail.schmuckstuecke?.length > 0 && (
                <div
                  style={{
                    fontSize: "0.85em",
                    color: "#666",
                    marginTop: 16,
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
                    // Befund G7: diese Zahlen wurden hier aus rohen Preisen
                    // summiert -- ohne Positions- und Gesamtrabatt. Bei 20 %
                    // Rabatt stand im Modal ein um 20 % zu hoher
                    // Auszahlungsbetrag je Herstellerin, und genau danach wird
                    // abgerechnet. Sie kommen jetzt aus SQL (utils/rabatt.js),
                    // in derselben Reihenfolge wie auf dem Beleg.
                    const summen = detail.summen || {};
                    const provisionPercent = Number(detail.Provision) || 0;
                    const totalBrutto = Number(summen.summe_nach_rabatt) || 0;
                    const provisionValue = Number(summen.provision_betrag) || 0;
                    const totalNetto = Number(summen.ueberweisungsbetrag) || 0;
                    const marinaBrutto = Number(summen.marina_brutto) || 0;
                    const saskiaBrutto = Number(summen.saskia_brutto) || 0;
                    const marinaNetto = Number(summen.marina_netto) || 0;
                    const saskiaNetto = Number(summen.saskia_netto) || 0;
                    const rabattGesamt = Number(summen.rabatt_gesamt) || 0;

                    return (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "8px",
                        }}>
                        <div
                          style={{
                            paddingBottom: "8px",
                            borderBottom: "1px solid #ddd",
                          }}>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              marginBottom: "4px",
                            }}>
                            {/* Dieselbe Bezeichnung wie auf dem Beleg, damit
                                Modal und Rechnung nicht zwei Namen fuer
                                dieselbe Zahl fuehren (Befund G7). */}
                            <span>
                              {rabattGesamt > 0 ? "Summe nach Rabatt:" : "Gesamtwert:"}
                            </span>
                            <strong>{formatEur(totalBrutto)}</strong>
                          </div>
                          {provisionPercent > 0 && (
                            <>
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  marginBottom: "4px",
                                  color: "#d9534f",
                                }}>
                                <span>Provision ({provisionPercent}%):</span>
                                <strong>-{formatEur(provisionValue)}</strong>
                              </div>
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  fontWeight: "600",
                                }}>
                                <span>Überweisungsbetrag:</span>
                                <strong>{formatEur(totalNetto)}</strong>
                              </div>
                            </>
                          )}
                        </div>

                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: "12px",
                            flexWrap: "wrap",
                          }}>
                          {marinaBrutto > 0 && (
                            <div>
                              <strong>Marina:</strong>{" "}
                              {formatEur(marinaNetto)}
                              <span
                                style={{
                                  fontSize: "0.9em",
                                  color: "#999",
                                  marginLeft: "4px",
                                }}>
                                ({formatEur(marinaBrutto)} brutto)
                              </span>
                            </div>
                          )}
                          {saskiaBrutto > 0 && (
                            <div>
                              <strong>Saskia:</strong>{" "}
                              {formatEur(saskiaNetto)}
                              <span
                                style={{
                                  fontSize: "0.9em",
                                  color: "#999",
                                  marginLeft: "4px",
                                }}>
                                ({formatEur(saskiaBrutto)} brutto)
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
              {detail.schmuckstuecke?.length > 0 && (
                <>
                  <h4 className="modal-body h4">
                    Zugehörige Schmuckstücke ({detail.schmuckstuecke.length})
                  </h4>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Artikelnr.</th>
                        <th>Art</th>
                        <th>Preis</th>
                        {type === "rechnung" && <th>Rabatt</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {detail.schmuckstuecke
                        .sort((a, b) =>
                          a.Artikelnummer.split("_")[0].localeCompare(
                            b.Artikelnummer.split("_")[0],
                          ),
                        )
                        .map((s) => {
                          const basis = s.Artikelnummer.split("_")[0];
                          const itemRabatt = type === "rechnung"
                            ? Number(detail.rabatt_positionen?.[basis] || 0)
                            : 0;
                          return (
                          <tr key={s.Artikelnummer}>
                            <td>
                              <button
                                className="schmuck-table-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSchmuckstueckOverlay(s.Artikelnummer);
                                }}>
                                <span className="badge gold">
                                  {s.Artikelnummer.split("_")[0]}
                                </span>
                              </button>
                            </td>
                            <td>{s.Art}</td>
                            <td>
                              {itemRabatt > 0 ? (
                                <span>
                                  <span className="schmuck-item-row-price-original">
                                    {formatEur(s.Verkaufspreis)}
                                  </span>
                                  <span className="schmuck-item-row-price">
                                    {formatEur(Number(s.Verkaufspreis) * (1 - itemRabatt / 100))}
                                  </span>
                                </span>
                              ) : (
                                formatEur(s.Verkaufspreis)
                              )}
                            </td>
                            {type === "rechnung" && (
                              <td className={itemRabatt > 0 ? "schmuck-item-row-rabatt" : "schmuck-item-row-rabatt no-rabatt"}>
                                {itemRabatt > 0 ? `-${itemRabatt}%` : "–"}
                              </td>
                            )}
                          </tr>
                        )})}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal für neues Dokument / Entwurf bearbeiten */}
      {editing && (
        <div className="modal-overlay">
          <div
            className="modal modal-lg modal-edit-document"
            onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                {editing === 'new' ? labels.modalTitle : `${labels.header} ${form.Nummer} bearbeiten`}
                {editing !== 'new' && (
                  <span className="badge modal-header-badge">
                    Entwurf
                  </span>
                )}
              </h3>
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
                        ...(pieceSelectMode === "byKunde"
                          ? { Artikelnummern: [] }
                          : {}),
                      })
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

              <div className="piece-selection piece-selection-wrapper">
                <div className="piece-selection-flex">
                  {/* Linke Seite: Stückauswahl */}
                  <div className="piece-side">
                    <h5>Alle Schmuckstücke</h5>
                    <input
                      className="form-control search-input piece-search-input"
                      placeholder="Schmuckstücke suchen..."
                      value={pieceSearch}
                      onChange={(e) => setPieceSearch(e.target.value)}
                      disabled={
                        pieceSelectMode === "byKunde" && !form.Kundennummer
                      }
                    />
                    <div className="piece-container">
                      <DataTable
                        data={availablePieces.filter((p) =>
                          pieceSearch.trim() === ""
                            ? true
                            : [p.Artikelnummer, p.Art, String(p.Verkaufspreis)]
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
                                className="form-checkbox"
                                checked={form.Artikelnummern.includes(
                                  p.Artikelnummer,
                                )}
                                readOnly
                              />
                            ),
                            width: 40,
                          },
                          {
                            key: "Artikelnummer",
                            label: "Artikelnr.",
                            sortable: true,
                          },
                          { key: "Art", label: "Art", sortable: true },
                          {
                            key: "Verkaufspreis",
                            label: "Preis",
                            sortable: true,
                            render: (p) => formatEur(p.Verkaufspreis),
                          },
                        ]}
                        onRowClick={(p) => togglePiece(p.Artikelnummer)}
                        rowProps={(p) => ({
                          draggable: true,
                          onDragStart: (e) =>
                            e.dataTransfer.setData(
                              "artikelnummer",
                              p.Artikelnummer,
                            ),
                        })}
                      />
                    </div>
                  </div>
                  {/* Rechte Seite: Selektierte Stücke */}
                  <div className="piece-side">
                    <h5>
                      Ausgewählte Schmuckstücke ({form.Artikelnummern.length})
                    </h5>
                    <div className="piece-add-controls">
                      <input
                        className="form-control piece-add-input"
                        placeholder="Artikelnummer eingeben..."
                        value={artikelnummerInput}
                        onChange={(e) => setArtikelnummerInput(e.target.value)}
                        onKeyDown={(e) =>
                          e.key === "Enter" && addByArtikelnummer()
                        }
                        disabled={
                          pieceSelectMode === "byKunde" && !form.Kundennummer
                        }
                      />
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={addByArtikelnummer}
                        disabled={
                          pieceSelectMode === "byKunde" && !form.Kundennummer
                        }>
                        Hinzufügen
                      </button>
                    </div>
                    <div
                      className="piece-container"
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
                            {type === "rechnung" && <th style={{ minWidth: 90 }}>Rabatt %</th>}
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {form.Artikelnummern.map((nr) => {
                            const piece = availablePieces.find(
                              (p) => p.Artikelnummer === nr,
                            );
                            if (!piece) return null;
                            const basis = nr.split("_")[0];
                            const rabatt = type === "rechnung"
                              ? Number(form.rabatt_positionen?.[basis] || 0)
                              : 0;
                            return (
                              <tr key={nr}>
                                <td>{piece.Artikelnummer}</td>
                                <td>{piece.Art}</td>
                                <td>{formatEur(piece.Verkaufspreis)}</td>
                                {type === "rechnung" && (
                                  <td>
                                    <input
                                      type="number"
                                      min="0"
                                      max="100"
                                      step="1"
                                      value={rabatt}
                                      className="rabatt-input-piece form-control"
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={(e) => {
                                        const val = Math.min(100, Math.max(0, Number(e.target.value) || 0));
                                        setForm({
                                          ...form,
                                          rabatt_positionen: {
                                            ...form.rabatt_positionen,
                                            [basis]: val,
                                          },
                                        });
                                      }}
                                    />
                                  </td>
                                )}
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
            {type === "rechnung" && (
              <div className="rabatt-section">
                <div className="rabatt-form-group">
                  <label className="rabatt-label">Gesamtrabatt auf Rechnung:</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={form.rabatt_gesamt || 0}
                    className="form-control rabatt-input"
                    onChange={(e) => {
                      const val = Math.min(100, Math.max(0, Number(e.target.value) || 0));
                      setForm({ ...form, rabatt_gesamt: val });
                    }}
                  />
                  <label className="rabatt-label">%</label>

                </div>
              </div>
            )}
            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => setEditing(null)}>
                Abbrechen
              </button>
              <button
                className="btn btn-secondary"
                disabled={saving}
                onClick={() => handleSave('entwurf')}
                style={{ marginLeft: 'auto' }}>
                {saving ? 'Speichert…' : 'Als Entwurf speichern'}
              </button>
              <button
                className="btn btn-primary"
                disabled={saving}
                onClick={() => handleSave('final')}>
                {saving ? 'Speichert…' : 'Speichern & Abschließen'}
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
