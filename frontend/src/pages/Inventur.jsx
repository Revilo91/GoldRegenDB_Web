import { useState, useEffect, useMemo } from "react";
import { formatEur } from "../utils/zahlen";
import TablePhoto from "../components/TablePhoto";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faFileExcel,
  faFileInvoice,
  faTimes,
  faBox,
  faPlus,
  faSave,
  faCheck,
  faSearch,
  faExclamationTriangle,
  faQuestionCircle,
  faCheckCircle,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../api";
import DataTable from "../components/DataTable";
import TableToolbar from "../components/TableToolbar";
import SchmuckstueckModal from "../components/SchmuckstueckModal";

const TABS = [
  { id: "aktiv", label: "Nicht verkauft" },
  { id: "verkauft", label: "Verkauft" },
  { id: "ausschuss", label: "Ausschuss" },
  { id: "alle", label: "Alle" },
];

// formatEur liegt jetzt in utils/zahlen.js – es war die einzige deutsch korrekte
// Geldformatierung im Projekt, während anderswo `${wert}€`, toFixed(0) und
// toFixed(2) im Einsatz waren (Befund G21).

function getBelegdatumForTab(item, tab) {
  if (tab === "verkauft") return item?.Rechnung_Datum || null;
  // aktiv, ausschuss, alle → Lieferscheindatum
  return item?.Lieferschein_Datum || null;
}

function getBelegdatumLabel(tab) {
  if (tab === "verkauft") return "Rechnungsdatum";
  return "Lieferscheindatum";
}

function formatDateDE(dateValue) {
  if (!dateValue) return "–";
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "–";
  return date.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}


function ItemsTable({
  items,
  tab,
  selectedForReturn,
  toggleItemSelection,
  selectAll,
  selectedForRechnung,
  toggleForRechnung,
  selectAllForRechnung,
  onItemClick,
  pausePhotoLoading = false,
}) {
  const allSelected =
    selectedForReturn &&
    items.length > 0 &&
    selectedForReturn.size === items.length;
  const allSelectedForRechnung =
    selectedForRechnung &&
    items.length > 0 &&
    selectedForRechnung.size === items.length;

  const total = useMemo(
    () =>
      items.reduce((sum, item) => sum + (Number(item.Verkaufspreis) || 0), 0),
    [items],
  );

  return (
    <div style={{ overflowX: "auto" }}>
      <DataTable
        data={items}
        className="inventur-items-table"
        getRowKey={(item) => item.Artikelnummer}
        defaultSort={{ key: "Artikelnummer", direction: "asc" }}
        onRowClick={undefined}
        columns={[
          selectedForReturn && {
            key: "zurueck",
            label: (
              <>
                <div style={{ fontSize: 8 }}>Zurück</div>
                <input
                  type="checkbox"
                  className="table-checkbox table-checkbox-header"
                  checked={allSelected}
                  onChange={selectAll}
                  title={allSelected ? "Alle abwählen" : "Alle auswählen"}
                  onClick={(e) => e.stopPropagation()}
                />
              </>
            ),
            style: { width: 40, textAlign: "center" },
            render: (item) => (
              <input
                type="checkbox"
                className="table-checkbox"
                checked={selectedForReturn.has(item.Artikelnummer)}
                onChange={() => toggleItemSelection(item.Artikelnummer)}
                onClick={(e) => e.stopPropagation()}
              />
            ),
          },
          selectedForRechnung && {
            key: "rechnung",
            label: (
              <>
                <div style={{ fontSize: 8 }}>Rechnung</div>
                <input
                  type="checkbox"
                  className="table-checkbox table-checkbox-header"
                  checked={allSelectedForRechnung}
                  onChange={selectAllForRechnung}
                  title={
                    allSelectedForRechnung
                      ? "Alle abwählen"
                      : "Alle für Rechnung auswählen"
                  }
                  onClick={(e) => e.stopPropagation()}
                />
              </>
            ),
            style: { width: 40, textAlign: "center" },
            render: (item) => (
              <input
                type="checkbox"
                className="table-checkbox"
                checked={selectedForRechnung.has(item.Artikelnummer)}
                onChange={() => toggleForRechnung(item.Artikelnummer)}
                onClick={(e) => e.stopPropagation()}
              />
            ),
          },
          {
            key: "Foto",
            label: "Foto",
            className: "photo-col",
            render: (item) => (
              <TablePhoto
                foto={item.Foto}
                artikelnummer={item.Artikelnummer}
                pauseLoading={pausePhotoLoading}
              />
            ),
          },
          {
            key: "Artikelnummer",
            label: "Artikelnummer",
            sortable: true,
            comparator: (a, b) =>
              String(a.Artikelnummer || "").localeCompare(
                String(b.Artikelnummer || ""),
                undefined,
                { numeric: true },
              ),
            render: (item) => (
              <button
                className="btn-link"
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  textDecoration: "none",
                  color: "inherit",
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onItemClick(item.Artikelnummer);
                }}>
                <strong>
                  {String(item.Artikelnummer || "").split("_")[0]}
                </strong>
                {Number(String(item.Artikelnummer || "").split("_")[1]) > 0 && (
                  <span className="badge warning">
                    {String(item.Artikelnummer || "").split("_")[1]}
                  </span>
                )}
              </button>
            ),
          },
          {
            key: "Verkaufspreis",
            label: "Verkaufspreis",
            className: "hide-on-mobile",
            sortable: true,
            comparator: (a, b) =>
              (Number(a.Verkaufspreis) || 0) - (Number(b.Verkaufspreis) || 0),
            render: (item) => formatEur(item.Verkaufspreis),
          },
          {
            key: "Erstelldatum",
            label: getBelegdatumLabel(tab),
            sortable: true,
            comparator: (a, b) => {
              const aDate = getBelegdatumForTab(a, tab);
              const bDate = getBelegdatumForTab(b, tab);
              const aMs = aDate ? new Date(aDate).getTime() : null;
              const bMs = bDate ? new Date(bDate).getTime() : null;
              if (aMs === null && bMs === null) return 0;
              if (aMs === null) return 1;
              if (bMs === null) return -1;
              return aMs - bMs;
            },
            render: (item) => formatDateDE(getBelegdatumForTab(item, tab)),
          },
        ].filter(Boolean)}
        footer={
          <tr>
            {selectedForReturn && <td />}
            {selectedForRechnung && <td />}
            <td className="photo-col" />
            <td
              colSpan={1}
              style={{
                fontWeight: 600,
                textAlign: "right",
                padding: "8px 12px",
              }}>
              Gesamtwert:
            </td>
            <td style={{ fontWeight: 600 }}>{formatEur(total)}</td>
            <td className="hide-on-mobile" />
          </tr>
        }
      />
    </div>
  );
}

function DetailModal({ kundeId, kundeName, kundeAktiv, onClose, onRestock }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("aktiv");
  const [exporting, setExporting] = useState(false);
  const [restocking, setRestocking] = useState(false);
  const [selectedForReturn, setselectedForReturn] = useState(new Set());
  const [selectedForRechnung, setSelectedForRechnung] = useState(new Set());
  const [creatingRechnung, setCreatingRechnung] = useState(false);
  const [schmuckstueckOverlay, setSchmuckstueckOverlay] = useState(null);
  const isForegroundModalOpen = schmuckstueckOverlay !== null;

  useEffect(() => {
    setLoading(true);
    api
      .getInventurKunde(kundeId)
      .then(setData)
      .catch((err) => alert(err.message))
      .finally(() => setLoading(false));
  }, [kundeId]);

  const tabItems = useMemo(() => {
    if (!data) return [];
    const { items } = data;
    if (tab === "aktiv")
      return items.filter(
        (i) => Number(i.Verkauft) === 0 && Number(i.Ausschuss) === 0,
      );
    if (tab === "verkauft")
      return items.filter((i) => Number(i.Verkauft) === 1);
    if (tab === "ausschuss")
      return items.filter((i) => Number(i.Ausschuss) === 1);
    return items;
  }, [data, tab]);

  const handleExcel = async () => {
    setExporting(true);
    try {
      const blob = await api.exportInventurExcel(kundeId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeName = String(kundeName || kundeId).replace(
        /[\\/:*?"<>|]+/g,
        "_",
      );
      a.download = `Inventur_${safeName}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      alert(err.message);
    } finally {
      setExporting(false);
    }
  };

  const handleRestock = async () => {
    if (selectedForReturn.size === 0) {
      alert("Bitte wähle mindestens einen Artikel aus");
      return;
    }

    const confirm_msg = `Möchtest du ${selectedForReturn.size} Artikel von "${kundeName}" zurück ins Lager lagern?`;
    if (!window.confirm(confirm_msg)) return;

    setRestocking(true);
    try {
      await api.restockKundeSelective(kundeId, Array.from(selectedForReturn));
      alert("Artikel erfolgreich zurückgelagert!");
      onRestock?.();
      onClose();
    } catch (err) {
      alert(err.message);
    } finally {
      setRestocking(false);
    }
  };

  const toggleItemSelection = (artikelnummer) => {
    setselectedForReturn((prev) => {
      const next = new Set(prev);
      if (next.has(artikelnummer)) {
        next.delete(artikelnummer);
      } else {
        next.add(artikelnummer);
      }
      return next;
    });
  };

  const selectAll = () => {
    if (tabItems.length > 0) {
      if (selectedForReturn.size === tabItems.length) {
        setselectedForReturn(new Set());
      } else {
        setselectedForReturn(new Set(tabItems.map((i) => i.Artikelnummer)));
      }
    }
  };

  const toggleForRechnung = (artikelnummer) => {
    setSelectedForRechnung((prev) => {
      const next = new Set(prev);
      if (next.has(artikelnummer)) {
        next.delete(artikelnummer);
      } else {
        next.add(artikelnummer);
      }
      return next;
    });
  };

  const selectAllForRechnung = () => {
    if (tabItems.length > 0) {
      if (selectedForRechnung.size === tabItems.length) {
        setSelectedForRechnung(new Set());
      } else {
        setSelectedForRechnung(new Set(tabItems.map((i) => i.Artikelnummer)));
      }
    }
  };

  const handleCreateRechnung = async () => {
    if (selectedForRechnung.size === 0) {
      alert("Bitte wähle mindestens einen Artikel für die Rechnung aus");
      return;
    }

    const totalValue = tabItems
      .filter((i) => selectedForRechnung.has(i.Artikelnummer))
      .reduce((s, i) => s + (Number(i.Verkaufspreis) || 0), 0);

    const confirmMsg = `Rechnung für ${selectedForRechnung.size} Artikel (${formatEur(totalValue)}) für "${kundeName}" erstellen?`;
    if (!window.confirm(confirmMsg)) return;

    setCreatingRechnung(true);
    try {
      const created = await api.createRechnung({
        Kundennummer: kundeId,
        Artikelnummern: Array.from(selectedForRechnung),
      });
      alert(`Rechnung "${created?.Nummer}" erfolgreich erstellt!`);
      onRestock?.();
      onClose();
    } catch (err) {
      alert(err.message);
    } finally {
      setCreatingRechnung(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div
        className="modal"
        style={{ maxWidth: 960, width: "95%" }}
        onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>
            Inventur – {kundeName}
            {!kundeAktiv && (
              <span
                className="badge danger"
                style={{ marginLeft: 8, fontSize: 12 }}>
                Inaktiv
              </span>
            )}
          </h3>

          <button className="modal-close" onClick={onClose}>
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>

        <div className="modal-body">
          {loading ? (
            <div className="loading">
              <div className="spinner"></div>Lade…
            </div>
          ) : (
            data && (
              <>
                {/* Stats */}
                <div className="stats-grid" style={{ marginBottom: 10 }}>
                  {[
                    {
                      label: "Gesamt",
                      value: data.stats.gesamt,
                      colorClass: "gold",
                    },
                    {
                      label: "Nicht verkauft",
                      value: data.stats.aktiv,
                      colorClass: "success",
                    },
                    {
                      label: "Verkauft",
                      value: data.stats.verkauft,
                      colorClass: "info",
                    },
                    {
                      label: "Ausschuss",
                      value: data.stats.ausschuss,
                      colorClass: "danger",
                    },
                  ].map((s) => (
                    <div key={s.label} className={`stat-card ${s.colorClass}`}>
                      <div className="stat-value">{s.value}</div>
                      <div className="stat-label">{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* Wert stats */}
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    marginBottom: 20,
                    flexWrap: "wrap",
                  }}>
                  <span
                    style={{ color: "var(--text-secondary)", fontSize: 13 }}>
                    Warenwert (aktiv):{" "}
                    <strong style={{ color: "var(--success)" }}>
                      {formatEur(data.stats.wert_aktiv)}
                    </strong>
                  </span>
                  <span
                    style={{ color: "var(--text-secondary)", fontSize: 13 }}>
                    Warenwert (verkauft):{" "}
                    <strong style={{ color: "var(--info)" }}>
                      {formatEur(data.stats.wert_verkauft)}
                    </strong>
                  </span>
                </div>

                {/* Tabs */}
                <div
                  style={{
                    display: "flex",
                    gap: 4,
                    marginBottom: 16,
                    flexWrap: "wrap",
                  }}>
                  {TABS.map((t) => (
                    <button
                      key={t.id}
                      className={`btn btn-sm ${tab === t.id ? "btn-primary" : "btn-secondary"}`}
                      onClick={() => {
                        setTab(t.id);
                        setselectedForReturn(new Set());
                        setSelectedForRechnung(new Set());
                      }}>
                      {t.label}
                      {t.id !== "alle" && (
                        <span
                          style={{
                            marginLeft: 6,
                            background: "rgba(255,255,255,0.15)",
                            borderRadius: 10,
                            padding: "1px 6px",
                            fontSize: 11,
                          }}>
                          {t.id === "aktiv"
                            ? data.stats.aktiv
                            : t.id === "verkauft"
                              ? data.stats.verkauft
                              : data.stats.ausschuss}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                <ItemsTable
                  items={tabItems}
                  tab={tab}
                  selectedForReturn={
                    tab === "aktiv" ? selectedForReturn : undefined
                  }
                  toggleItemSelection={toggleItemSelection}
                  selectAll={selectAll}
                  selectedForRechnung={
                    tab === "aktiv" ? selectedForRechnung : undefined
                  }
                  toggleForRechnung={toggleForRechnung}
                  selectAllForRechnung={selectAllForRechnung}
                  onItemClick={(nr) => setSchmuckstueckOverlay(nr)}
                  pausePhotoLoading={isForegroundModalOpen}
                />
              </>
            )
          )}
        </div>

        <div
          className="modal-footer inventur-modal-footer"
          style={{ justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn btn-warning"
              onClick={handleRestock}
              disabled={restocking || loading || selectedForReturn.size === 0}
              title={
                selectedForReturn.size === 0
                  ? "Wähle Artikel (↩) aus um zurückzulagern"
                  : `${selectedForReturn.size} Artikel zurücklagern`
              }>
              <FontAwesomeIcon icon={faBox} style={{ marginRight: 6 }} />
              {restocking
                ? "Lagere zurück…"
                : `Zurücklagern (${selectedForReturn.size})`}
            </button>
            <button
              className="btn btn-success"
              onClick={handleCreateRechnung}
              disabled={
                creatingRechnung || loading || selectedForRechnung.size === 0
              }
              title={
                selectedForRechnung.size === 0
                  ? "Wähle Artikel (🧾) aus um eine Rechnung zu erstellen"
                  : `Rechnung für ${selectedForRechnung.size} Artikel erstellen`
              }>
              <FontAwesomeIcon
                icon={faFileInvoice}
                style={{ marginRight: 6 }}
              />
              {creatingRechnung
                ? "Erstelle Rechnung…"
                : `Rechnung erstellen (${selectedForRechnung.size})`}
            </button>
          </div>
          <div
            className="inventur-modal-actions"
            style={{ display: "flex", gap: 8 }}>
            <button
              className="btn btn-primary"
              onClick={handleExcel}
              disabled={exporting || loading}>
              <FontAwesomeIcon icon={faFileExcel} style={{ marginRight: 6 }} />
              {exporting ? "Exportiere…" : "Excel Export"}
            </button>
            <button className="btn btn-secondary" onClick={onClose}>
              Schließen
            </button>
          </div>
        </div>
      </div>
      {schmuckstueckOverlay && (
        <SchmuckstueckModal
          artikelnummer={schmuckstueckOverlay}
          onClose={() => setSchmuckstueckOverlay(null)}
        />
      )}
    </div>
  );
}

function InventurDiffModal({ draftId, onClose }) {
  const [diff, setDiff] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState("fehlend");

  useEffect(() => {
    api
      .getInventurDiff(draftId)
      .then(setDiff)
      .catch((err) => alert("Fehler beim Laden der Auswertung: " + err.message))
      .finally(() => setLoading(false));
  }, [draftId]);

  return (
    <div className="modal-overlay">
      <div
        className="modal"
        style={{
          maxWidth: 900,
          width: "95%",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <FontAwesomeIcon icon={faSearch} />
            Inventur-Auswertung #{draftId}
          </h3>
          <button className="modal-close" onClick={onClose}>
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>

        <div className="modal-body" style={{ flex: 1, overflowY: "auto" }}>
          {loading ? (
            <div className="loading">
              <div className="spinner"></div>Lade Auswertung…
            </div>
          ) : (
            diff && (
              <>
                {/* Summary Badges */}
                <div className="stats-grid" style={{ marginBottom: 20 }}>
                  <div
                    className="stat-card danger"
                    style={{
                      cursor: "pointer",
                      outline:
                        activeSection === "fehlend"
                          ? "2px solid var(--danger)"
                          : "none",
                    }}
                    onClick={() => setActiveSection("fehlend")}>
                    <div className="stat-value">{diff.stats.fehlend}</div>
                    <div className="stat-label">Fehlend</div>
                  </div>
                  <div
                    className="stat-card warning"
                    style={{
                      cursor: "pointer",
                      outline:
                        activeSection === "unbekannt"
                          ? "2px solid var(--warning)"
                          : "none",
                    }}
                    onClick={() => setActiveSection("unbekannt")}>
                    <div className="stat-value">{diff.stats.unbekannt}</div>
                    <div className="stat-label">Unbekannt</div>
                  </div>
                  <div
                    className="stat-card success"
                    style={{
                      cursor: "pointer",
                      outline:
                        activeSection === "gefunden"
                          ? "2px solid var(--success)"
                          : "none",
                    }}
                    onClick={() => setActiveSection("gefunden")}>
                    <div className="stat-value">{diff.stats.gefunden}</div>
                    <div className="stat-label">Gefunden</div>
                  </div>
                  <div className="stat-card gold">
                    <div className="stat-value">{diff.stats.soll}</div>
                    <div className="stat-label">Soll-Bestand</div>
                  </div>
                </div>

                {/* Fehlend */}
                {activeSection === "fehlend" && (
                  <>
                    <h4
                      style={{
                        color: "var(--danger)",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 12,
                      }}>
                      <FontAwesomeIcon icon={faExclamationTriangle} />
                      Fehlende Artikelnummern ({diff.stats.fehlend})
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 400,
                          color: "var(--text-secondary)",
                        }}>
                        – Im Lager erwartet, aber nicht gescannt
                      </span>
                    </h4>
                    {diff.fehlend.length === 0 ? (
                      <p style={{ color: "var(--success)", fontWeight: 600 }}>
                        ✓ Keine Artikel fehlen – alles vollständig erfasst!
                      </p>
                    ) : (
                      <div style={{ overflowX: "auto" }}>
                        <table
                          className="table"
                          style={{ width: "100%", borderCollapse: "collapse" }}>
                          <thead>
                            <tr
                              style={{
                                borderBottom: "2px solid var(--border)",
                              }}>
                              <th style={{ padding: "8px", textAlign: "left" }}>
                                Artikelnummer
                              </th>
                              <th style={{ padding: "8px", textAlign: "left" }}>
                                Name
                              </th>
                              <th
                                style={{ padding: "8px", textAlign: "center" }}>
                                Soll
                              </th>
                              <th
                                style={{ padding: "8px", textAlign: "center" }}>
                                Ist
                              </th>
                              <th
                                style={{ padding: "8px", textAlign: "center" }}>
                                Fehlend
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {diff.fehlend.map((item) => (
                              <tr
                                key={item.Artikelnummer}
                                style={{
                                  borderBottom: "1px solid var(--border)",
                                  background:
                                    "rgba(var(--danger-rgb, 239,68,68), 0.05)",
                                }}>
                                <td style={{ padding: "8px" }}>
                                  <strong style={{ color: "var(--danger)" }}>
                                    {item.Artikelnummer}
                                  </strong>
                                </td>
                                <td style={{ padding: "8px" }}>
                                  {item.Name || "–"}
                                </td>
                                <td
                                  style={{
                                    padding: "8px",
                                    textAlign: "center",
                                  }}>
                                  {item.Soll}
                                </td>
                                <td
                                  style={{
                                    padding: "8px",
                                    textAlign: "center",
                                  }}>
                                  {item.Ist}
                                </td>
                                <td
                                  style={{
                                    padding: "8px",
                                    textAlign: "center",
                                    fontWeight: "bold",
                                    color: "var(--danger)",
                                  }}>
                                  {item.Fehlt}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}

                {/* Unbekannt */}
                {activeSection === "unbekannt" && (
                  <>
                    <h4
                      style={{
                        color: "var(--warning)",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 12,
                      }}>
                      <FontAwesomeIcon icon={faQuestionCircle} />
                      Unbekannte Artikel ({diff.unbekannt.length})
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 400,
                          color: "var(--text-secondary)",
                        }}>
                        – Gescannt, aber nicht im Lager-Soll
                      </span>
                    </h4>
                    {diff.unbekannt.length === 0 ? (
                      <p style={{ color: "var(--success)", fontWeight: 600 }}>
                        ✓ Keine unbekannten Artikel gescannt.
                      </p>
                    ) : (
                      <div style={{ overflowX: "auto" }}>
                        <table
                          className="table"
                          style={{ width: "100%", borderCollapse: "collapse" }}>
                          <thead>
                            <tr
                              style={{
                                borderBottom: "2px solid var(--border)",
                              }}>
                              <th style={{ padding: "8px", textAlign: "left" }}>
                                Artikelnummer
                              </th>
                              <th style={{ padding: "8px", textAlign: "left" }}>
                                Name
                              </th>
                              <th
                                style={{ padding: "8px", textAlign: "center" }}>
                                Soll
                              </th>
                              <th
                                style={{ padding: "8px", textAlign: "center" }}>
                                Ist
                              </th>
                              <th
                                style={{ padding: "8px", textAlign: "center" }}>
                                Überschuss
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {diff.unbekannt.map((item) => (
                              <tr
                                key={item.Artikelnummer}
                                style={{
                                  borderBottom: "1px solid var(--border)",
                                  background:
                                    "rgba(var(--warning-rgb, 245,158,11), 0.05)",
                                }}>
                                <td style={{ padding: "8px" }}>
                                  <strong style={{ color: "var(--warning)" }}>
                                    {item.Artikelnummer}
                                  </strong>
                                </td>
                                <td style={{ padding: "8px" }}>
                                  {item.Name || "–"}
                                </td>
                                <td
                                  style={{
                                    padding: "8px",
                                    textAlign: "center",
                                  }}>
                                  {item.Soll}
                                </td>
                                <td
                                  style={{
                                    padding: "8px",
                                    textAlign: "center",
                                  }}>
                                  {item.Ist}
                                </td>
                                <td
                                  style={{
                                    padding: "8px",
                                    textAlign: "center",
                                    fontWeight: "bold",
                                    color: "var(--warning)",
                                  }}>
                                  {item.Zuviel}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}

                {/* Gefunden */}
                {activeSection === "gefunden" && (
                  <>
                    <h4
                      style={{
                        color: "var(--success)",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 12,
                      }}>
                      <FontAwesomeIcon icon={faCheckCircle} />
                      Gefundene Artikel ({diff.gefunden.length})
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 400,
                          color: "var(--text-secondary)",
                        }}>
                        – Im Soll und auch gescannt
                      </span>
                    </h4>
                    {diff.gefunden.length === 0 ? (
                      <p style={{ color: "var(--text-muted)" }}>
                        Keine Artikel übereinstimmend.
                      </p>
                    ) : (
                      <div style={{ overflowX: "auto" }}>
                        <table
                          className="table"
                          style={{ width: "100%", borderCollapse: "collapse" }}>
                          <thead>
                            <tr
                              style={{
                                borderBottom: "2px solid var(--border)",
                              }}>
                              <th style={{ padding: "8px", textAlign: "left" }}>
                                Artikelnummer
                              </th>
                              <th style={{ padding: "8px", textAlign: "left" }}>
                                Name
                              </th>
                              <th
                                style={{ padding: "8px", textAlign: "center" }}>
                                Soll
                              </th>
                              <th
                                style={{ padding: "8px", textAlign: "center" }}>
                                Gefunden
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {diff.gefunden.map((item) => (
                              <tr
                                key={item.Artikelnummer}
                                style={{
                                  borderBottom: "1px solid var(--border)",
                                }}>
                                <td style={{ padding: "8px" }}>
                                  <strong style={{ color: "var(--success)" }}>
                                    {item.Artikelnummer}
                                  </strong>
                                </td>
                                <td style={{ padding: "8px" }}>
                                  {item.Name || "–"}
                                </td>
                                <td
                                  style={{
                                    padding: "8px",
                                    textAlign: "center",
                                  }}>
                                  {item.Soll}
                                </td>
                                <td
                                  style={{
                                    padding: "8px",
                                    textAlign: "center",
                                  }}>
                                  {item.Gefunden}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </>
            )
          )}
        </div>

        <div className="modal-footer" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-secondary" onClick={onClose}>
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}

function LagerInventurEditor({ draftId, onBack }) {
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [inputNr, setInputNr] = useState("");
  const [allArticleNumbers, setAllArticleNumbers] = useState([]);
  const [showDiff, setShowDiff] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [lastSavedDraftStr, setLastSavedDraftStr] = useState(null);

  useEffect(() => {
    api
      .getInventurDraft(draftId)
      .then((d) => {
        if (!d.data) d.data = {};
        setDraft(d);
        setLastSavedDraftStr(
          JSON.stringify({ data: d.data, kommentar: d.kommentar }),
        );
        setTimeout(() => setDraftLoaded(true), 100);
      })
      .catch((err) => {
        alert(err.message);
        onBack();
      })
      .finally(() => setLoading(false));

    // Lade Artikelnummern für Autovervollständigung
    api
      .getUniqueArtikelnummern({
        ausgelagert: "0",
        verkauft: "0",
        ausschuss: "0",
      })
      .then((res) => {
        if (res && Array.isArray(res)) {
          setAllArticleNumbers(res);
        }
      })
      .catch((err) =>
        alert("Fehler beim Laden der Artikelnummern: " + err.message)
      );
  }, [draftId, onBack]);

  const performSave = async (showSuccessAlert = false) => {
    const currentStr = JSON.stringify({
      data: draft.data,
      kommentar: draft.kommentar,
    });
    if (currentStr === lastSavedDraftStr) {
      // Nichts geändert, muss nicht gespeichert werden
      if (showSuccessAlert) alert("Inventur erfolgreich gespeichert!");
      return true;
    }

    setSaving(true);
    try {
      await api.updateInventurDraft(draftId, {
        data: draft.data,
        kommentar: draft.kommentar,
      });
      setLastSavedDraftStr(currentStr);
      if (showSuccessAlert) {
        alert("Inventur erfolgreich gespeichert!");
      }
      return true;
    } catch (err) {
      if (showSuccessAlert) {
        alert("Fehler beim Speichern: " + err.message);
      } else {
        alert("Automatische Speicherung fehlgeschlagen: " + err.message);
      }
      throw err;
    } finally {
      setSaving(false);
    }
  };

  // Autosave
  useEffect(() => {
    if (!draftLoaded || !draft) return;
    const timer = setTimeout(() => {
      performSave(false).catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, [draft, draftLoaded, draftId]);

  const handleScan = (e) => {
    e.preventDefault();
    const nr = inputNr.trim().toUpperCase();
    if (!nr) return;

    setDraft((prev) => {
      const nextData = { ...prev.data };
      nextData[nr] = (nextData[nr] || 0) + 1;
      return { ...prev, data: nextData };
    });
    setInputNr("");
  };

  const handleCountChange = (nr, count) => {
    setDraft((prev) => {
      const nextData = { ...prev.data };
      const val = parseInt(count, 10);
      if (isNaN(val) || val <= 0) {
        delete nextData[nr];
      } else {
        nextData[nr] = val;
      }
      return { ...prev, data: nextData };
    });
  };

  const handleRemove = (nr) => {
    setDraft((prev) => {
      const nextData = { ...prev.data };
      delete nextData[nr];
      return { ...prev, data: nextData };
    });
  };

  const completeDraft = async () => {
    if (
      !window.confirm(
        "Möchtest du diese Inventur wirklich abschließen? Sie kann danach nicht mehr bearbeitet werden.",
      )
    )
      return;

    try {
      await performSave(false);
      await api.completeInventurDraft(draftId);
      setIsCompleted(true);
      setShowDiff(true); // Fehlbestand automatisch anzeigen
    } catch (err) {
      alert("Fehler beim Abschließen: " + err.message);
    }
  };

  const handleShowDiff = async () => {
    try {
      await performSave(false);
      setShowDiff(true);
    } catch (err) {
      alert("Fehler vor Auswertung: " + err.message);
    }
  };

  if (loading || !draft)
    return (
      <div className="loading">
        <div className="spinner"></div>
      </div>
    );

  const entries = Object.entries(draft.data || {}).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  return (
    <>
      {showDiff && (
        <InventurDiffModal
          draftId={draftId}
          onClose={() => {
            setShowDiff(false);
            if (isCompleted) {
              onBack();
            }
          }}
        />
      )}
      <div className="card">
        <div
          className="card-header"
          style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <button className="btn btn-secondary" onClick={onBack}>
            &larr; Zurück
          </button>
          <h3 style={{ margin: 0 }}>Lager-Inventur #{draft.id}</h3>
        </div>
        <div className="card-body">
          <div style={{ marginBottom: 20 }}>
            <label>Kommentar:</label>
            <input
              type="text"
              className="input"
              value={draft.kommentar || ""}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, kommentar: e.target.value }))
              }
              placeholder="Optionale Notiz..."
              style={{ width: "100%", maxWidth: 400, marginTop: 4 }}
            />
          </div>

          <form
            onSubmit={handleScan}
            style={{
              display: "flex",
              gap: 8,
              marginBottom: 24,
              padding: 16,
              background: "var(--bg-hover)",
              borderRadius: 8,
            }}>
            <input
              type="text"
              className="input"
              list="artikelnummer-autocomplete"
              value={inputNr}
              onChange={(e) => setInputNr(e.target.value)}
              placeholder="Artikelnummer scannen..."
              autoFocus
              style={{ flex: 1, maxWidth: 300 }}
            />
            <datalist id="artikelnummer-autocomplete">
              {allArticleNumbers.map((nr) => (
                <option key={nr} value={nr} />
              ))}
            </datalist>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!inputNr.trim()}>
              Hinzufügen
            </button>
          </form>

          <h4 style={{ marginBottom: 12 }}>
            Erfasste Artikel (
            {entries.reduce((sum, [_, count]) => sum + count, 0)} Stück gesamt)
          </h4>
          {entries.length === 0 ? (
            <p style={{ color: "var(--text-muted)" }}>
              Noch keine Artikel gescannt.
            </p>
          ) : (
            <div style={{ overflowX: "auto", marginBottom: 20 }}>
              <table
                className="table"
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  textAlign: "left",
                }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--border)" }}>
                    <th style={{ padding: "8px" }}>Artikelnummer</th>
                    <th style={{ width: 120, padding: "8px" }}>Anzahl</th>
                    <th
                      style={{
                        width: 80,
                        padding: "8px",
                        textAlign: "center",
                      }}>
                      Aktion
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(([nr, count]) => (
                    <tr
                      key={nr}
                      style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "8px" }}>
                        <strong>{nr}</strong>
                      </td>
                      <td style={{ padding: "8px" }}>
                        <input
                          type="number"
                          className="input"
                          min="1"
                          value={count}
                          onChange={(e) =>
                            handleCountChange(nr, e.target.value)
                          }
                          style={{ width: 80 }}
                        />
                      </td>
                      <td style={{ padding: "8px", textAlign: "center" }}>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => handleRemove(nr)}
                          title="Löschen">
                          <FontAwesomeIcon icon={faTimes} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div
            style={{
              display: "flex",
              gap: 12,
              marginTop: 20,
              paddingTop: 20,
              borderTop: "1px solid var(--border)",
              flexWrap: "wrap",
            }}>
            <button
              className="btn btn-primary"
              onClick={handleShowDiff}
              disabled={saving || entries.length === 0}
              title="Vergleiche gescannte Artikel mit dem Lagerbestand">
              <FontAwesomeIcon icon={faSearch} style={{ marginRight: 8 }} />
              Auswertung anzeigen
            </button>
            <button
              className="btn btn-success"
              onClick={completeDraft}
              disabled={saving}
              style={{ marginLeft: "auto" }}>
              <FontAwesomeIcon icon={faCheck} style={{ marginRight: 8 }} />
              Abschließen
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function LagerInventurUI() {
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeDraftId, setActiveDraftId] = useState(null);

  const loadDrafts = () => {
    setLoading(true);
    api
      .getInventurDrafts()
      .then(setDrafts)
      .catch((err) => alert("Fehler beim Laden der Inventuren: " + err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!activeDraftId) {
      loadDrafts();
    }
  }, [activeDraftId]);

  const createDraft = async () => {
    try {
      const draft = await api.createInventurDraft({ data: {}, kommentar: "" });
      setActiveDraftId(draft.id);
    } catch (err) {
      alert(err.message);
    }
  };

  if (activeDraftId) {
    return (
      <LagerInventurEditor
        draftId={activeDraftId}
        onBack={() => setActiveDraftId(null)}
      />
    );
  }

  return (
    <div className="card">
      <div className="card-header">
        <h3>Offene Inventuren</h3>
        <button className="btn btn-primary" onClick={createDraft}>
          <FontAwesomeIcon icon={faPlus} style={{ marginRight: 8 }} />
          Neue Inventur
        </button>
      </div>
      <div className="card-body">
        {loading ? (
          <div className="loading">
            <div className="spinner"></div>Lade Inventuren...
          </div>
        ) : drafts.length === 0 ? (
          <p style={{ color: "var(--text-muted)", padding: 10 }}>
            Keine offenen Inventuren vorhanden.
          </p>
        ) : (
          <DataTable
            data={drafts}
            getRowKey={(d) => d.id}
            onRowClick={(d) => setActiveDraftId(d.id)}
            columns={[
              { key: "id", label: "ID", render: (d) => `#${d.id}` },
              {
                key: "created_at",
                label: "Erstellt am",
                render: (d) => new Date(d.created_at).toLocaleString("de-DE"),
              },
              {
                key: "updated_at",
                label: "Zuletzt geändert",
                render: (d) => new Date(d.updated_at).toLocaleString("de-DE"),
              },
              {
                key: "kommentar",
                label: "Kommentar",
                render: (d) =>
                  d.kommentar || (
                    <span style={{ color: "var(--text-muted)" }}>
                      Kein Kommentar
                    </span>
                  ),
              },
              {
                key: "item_count",
                label: "Gescannte Artikel",
                render: (d) =>
                  Object.values(d.data || {}).reduce((s, c) => s + c, 0) +
                  " Stück",
              },
            ]}
          />
        )}
      </div>
    </div>
  );
}

export default function Inventur() {
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({ aktiv: "1" });
  const [selectedKunde, setSelectedKunde] = useState(null);
  const [activeTab, setActiveTab] = useState("kunden"); // 'kunden' | 'lager'
  const [sortConfig, setSortConfig] = useState({
    key: "Name",
    direction: "asc",
  });
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  const load = () => {
    setLoading(true);
    api
      .getInventur()
      .then(setSummary)
      .catch((err) => alert(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const filtered = useMemo(() => {
    return summary.filter((k) => {
      // Search filter
      if (search && search.trim()) {
        const s = search.toUpperCase();
        const match =
          k.Name?.toUpperCase().includes(s) || k.Ort?.toUpperCase().includes(s);
        if (!match) return false;
      }

      // Quick filters (Status)
      if (filters.aktiv !== undefined) {
        if (k.Aktiv !== (filters.aktiv === "1")) return false;
      }

      return true;
    });
  }, [summary, search, filters]);

  const sorted = useMemo(() => {
    const sortableData = [...filtered];
    if (sortConfig.key !== null) {
      sortableData.sort((a, b) => {
        let aValue = a[sortConfig.key];
        let bValue = b[sortConfig.key];

        if (
          sortConfig.key.includes("wert") ||
          ["gesamt", "aktiv", "verkauft", "ausschuss"].includes(sortConfig.key)
        ) {
          aValue = Number(aValue) || 0;
          bValue = Number(bValue) || 0;
        } else {
          if (typeof aValue === "string") aValue = aValue.toUpperCase();
          if (typeof bValue === "string") bValue = bValue.toUpperCase();
        }

        if (aValue < bValue) return sortConfig.direction === "asc" ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === "asc" ? 1 : -1;
        return 0;
      });
    }
    return sortableData;
  }, [filtered, sortConfig]);

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

  const totals = useMemo(
    () =>
      summary.reduce(
        (acc, k) => ({
          gesamt: acc.gesamt + (k.gesamt || 0),
          aktiv: acc.aktiv + (k.aktiv || 0),
          verkauft: acc.verkauft + (k.verkauft || 0),
          ausschuss: acc.ausschuss + (k.ausschuss || 0),
          wert_aktiv: acc.wert_aktiv + (Number(k.wert_aktiv) || 0),
          wert_verkauft: acc.wert_verkauft + (Number(k.wert_verkauft) || 0),
        }),
        {
          gesamt: 0,
          aktiv: 0,
          verkauft: 0,
          ausschuss: 0,
          wert_aktiv: 0,
          wert_verkauft: 0,
        },
      ),
    [summary],
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Inventur</h2>
          <p>Ausgelagerte Schmuckstücke pro Kunde oder Lager</p>
        </div>
      </div>

      {/* Tabs für Kunden-Inventur und Lager-Inventur */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          className={`btn btn-sm ${activeTab === "kunden" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setActiveTab("kunden")}>
          Kunden-Inventur
        </button>
        <button
          className={`btn btn-sm ${activeTab === "lager" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setActiveTab("lager")}>
          Lager-Inventur
        </button>
      </div>

      {activeTab === "kunden" && (
        <>
          <TableToolbar
            search={search}
            onSearchChange={setSearch}
            placeholder="Suche nach Kunde, Ort…"
            right={
              <div className="filter-group">
                <select
                  className="form-control"
                  value={filters.aktiv ?? ""}
                  onChange={(e) => {
                    const { aktiv, ...rest } = filters;
                    setFilters(
                      e.target.value !== ""
                        ? { ...rest, aktiv: e.target.value }
                        : rest,
                    );
                  }}>
                  <option value="">Alle Status</option>
                  <option value="1">Aktiv</option>
                  <option value="0">Inaktiv</option>
                </select>
              </div>
            }
          />

          <div className="card">
            <div className="card-body">
              {loading ? (
                <div className="loading">
                  <div className="spinner"></div>Lade…
                </div>
              ) : filtered.length === 0 ? (
                <p style={{ color: "var(--text-muted)" }}>
                  {summary.length === 0
                    ? "Keine ausgelagerten Artikel vorhanden."
                    : "Keine Ergebnisse für diese Suche."}
                </p>
              ) : (
                <>
                  <DataTable
                    data={sorted}
                    getRowKey={(r) => r.ID}
                    defaultSort={{ key: "Name", direction: "asc" }}
                    onRowClick={(k) => setSelectedKunde(k)}
                    className="inventur-table"
                    footer={
                      <tr
                        style={{
                          fontWeight: 600,
                          background: "var(--bg-hover)",
                        }}>
                        <td
                          colSpan={isMobile ? 1 : 2}
                          style={{ padding: "8px 12px" }}>
                          Gesamt
                        </td>
                        <td style={{ textAlign: "left" }}>{totals.gesamt}</td>
                        <td
                          style={{
                            textAlign: "left",
                            color: "var(--success)",
                          }}>
                          {totals.aktiv}
                        </td>
                        <td
                          className="hide-on-mobile"
                          style={{ textAlign: "left", color: "var(--info)" }}>
                          {totals.verkauft}
                        </td>
                        <td
                          className="hide-on-mobile"
                          style={{
                            textAlign: "left",
                            color: "var(--warning)",
                          }}>
                          {totals.ausschuss}
                        </td>
                        <td
                          className="hide-on-mobile"
                          style={{ textAlign: "left" }}>
                          {formatEur(totals.wert_aktiv)}
                        </td>
                        <td
                          className="hide-on-mobile"
                          style={{ textAlign: "left" }}>
                          {formatEur(totals.wert_verkauft)}
                        </td>
                      </tr>
                    }
                    columns={[
                      {
                        key: "Name",
                        label: "Kunde",
                        sortable: true,
                        render: (r) => (
                          <>
                            <strong>{r.Name}</strong>
                            {!r.Aktiv && (
                              <span
                                className="badge danger"
                                style={{ marginLeft: 8, fontSize: 10 }}>
                                Inaktiv
                              </span>
                            )}
                          </>
                        ),
                      },
                      {
                        key: "Ort",
                        label: "Ort",
                        className: "hide-on-mobile",
                        sortable: true,
                      },
                      {
                        key: "gesamt",
                        label: "Gesamt",
                        style: { textAlign: "left" },
                        sortable: true,
                        render: (r) => (
                          <span style={{ textAlign: "left" }}>{r.gesamt}</span>
                        ),
                      },
                      {
                        key: "aktiv",
                        label: "Nicht verkauft",
                        style: { textAlign: "left" },
                        sortable: true,
                        render: (r) => (
                          <span style={{ color: "var(--success)" }}>
                            {r.aktiv}
                          </span>
                        ),
                      },
                      {
                        key: "verkauft",
                        label: "Verkauft",
                        className: "hide-on-mobile",
                        style: { textAlign: "left" },
                        sortable: true,
                        render: (r) => (
                          <span style={{ color: "var(--info)" }}>
                            {r.verkauft}
                          </span>
                        ),
                      },
                      {
                        key: "ausschuss",
                        label: "Ausschuss",
                        className: "hide-on-mobile",
                        style: { textAlign: "left" },
                        sortable: true,
                        render: (r) => (
                          <span style={{ color: "var(--warning)" }}>
                            {r.ausschuss}
                          </span>
                        ),
                      },
                      {
                        key: "wert_aktiv",
                        label: "Warenwert (aktiv)",
                        className: "hide-on-mobile",
                        style: { textAlign: "left" },
                        render: (r) => formatEur(r.wert_aktiv),
                      },
                      {
                        key: "wert_verkauft",
                        label: "Warenwert (verkauft)",
                        className: "hide-on-mobile",
                        style: { textAlign: "left" },
                        render: (r) => formatEur(r.wert_verkauft),
                      },
                    ]}
                  />
                  {selectedKunde && (
                    <DetailModal
                      kundeId={selectedKunde.ID}
                      kundeName={selectedKunde.Name}
                      kundeAktiv={selectedKunde.Aktiv}
                      onClose={() => setSelectedKunde(null)}
                      onRestock={load}
                    />
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}

      {activeTab === "lager" && <LagerInventurUI />}
    </div>
  );
}

/** Inline mini-table shown on row expand */
function InlineItems({ kundeId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .getInventurKunde(kundeId)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [kundeId]);

  if (loading)
    return (
      <div style={{ padding: 8 }}>
        <div className="spinner" style={{ width: 20, height: 20 }}></div>
      </div>
    );
  if (error)
    return <p style={{ color: "var(--danger)", padding: 8 }}>{error}</p>;
  if (!data) return null;

  const aktiv = data.items.filter(
    (i) => Number(i.Verkauft) === 0 && Number(i.Ausschuss) === 0,
  );
  const verkauft = data.items.filter((i) => Number(i.Verkauft) === 1);
  const ausschuss = data.items.filter((i) => Number(i.Ausschuss) === 1);

  return (
    <div style={{ padding: "8px 0", fontSize: 13 }}>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <span>
          <span style={{ color: "var(--success)", fontWeight: 600 }}>
            {aktiv.length}
          </span>{" "}
          nicht verkauft &nbsp;|&nbsp;
          <span style={{ color: "var(--info)", fontWeight: 600 }}>
            {verkauft.length}
          </span>{" "}
          verkauft &nbsp;|&nbsp;
          <span style={{ color: "var(--warning)", fontWeight: 600 }}>
            {ausschuss.length}
          </span>{" "}
          Ausschuss
        </span>
      </div>
    </div>
  );
}
