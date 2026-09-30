import { useCallback, useEffect, useMemo, useState } from "react";
import { formatEur, summeEur } from "../utils/zahlen";
import { istWahr } from "../utils/status";
import TablePhoto from "../components/TablePhoto";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faFileExcel,
  faFileInvoice,
  faTimes,
  faBox,
  faPlus,
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
import { useToast } from "../components/Toast";

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
    () => summeEur(items.map((item) => item.Verkaufspreis)),
    [items],
  );

  return (
    <div className="inventur-ox-auto">
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
                <div className="inventur-fs-8">Zurück</div>
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
            headerClassName: "inventur-th-checkbox",
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
                <div className="inventur-fs-8">Rechnung</div>
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
            headerClassName: "inventur-th-checkbox",
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
            key: "foto",
            label: "Foto",
            className: "photo-col",
            render: (item) => (
              <TablePhoto
                hatFoto={item.hatFoto}
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
                className="btn-link inventur-link-button"
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
              colSpan={1} className="inventur-fw-600-text-right-p-8-12">
              Gesamtwert:
            </td>
            <td className="inventur-fw-600">{formatEur(total)}</td>
            <td className="hide-on-mobile" />
          </tr>
        }
      />
    </div>
  );
}

function DetailModal({ kundeId, kundeName, kundeAktiv, onClose, onRestock }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  // Kunde, zu dem zuletzt fertig geladen wurde; daraus ergibt sich "lädt"
  const [geladenFuer, setGeladenFuer] = useState(null);
  const loading = geladenFuer !== kundeId;
  const [tab, setTab] = useState("aktiv");
  const [exporting, setExporting] = useState(false);
  const [restocking, setRestocking] = useState(false);
  const [selectedForReturn, setselectedForReturn] = useState(new Set());
  const [selectedForRechnung, setSelectedForRechnung] = useState(new Set());
  const [creatingRechnung, setCreatingRechnung] = useState(false);
  const [schmuckstueckOverlay, setSchmuckstueckOverlay] = useState(null);
  const isForegroundModalOpen = schmuckstueckOverlay !== null;

  useEffect(() => {
    api
      .getInventurKunde(kundeId)
      .then(setData)
      .catch((err) => toast.fehler(err.message))
      .finally(() => setGeladenFuer(kundeId));
  }, [kundeId, toast]);

  const tabItems = useMemo(() => {
    if (!data) return [];
    const { items } = data;
    if (tab === "aktiv")
      return items.filter(
        (i) => !istWahr(i.Verkauft) && !istWahr(i.Ausschuss),
      );
    if (tab === "verkauft")
      return items.filter((i) => istWahr(i.Verkauft));
    if (tab === "ausschuss")
      return items.filter((i) => istWahr(i.Ausschuss));
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
      toast.fehler(err.message);
    } finally {
      setExporting(false);
    }
  };

  const handleRestock = async () => {
    if (selectedForReturn.size === 0) {
      toast.fehler("Bitte wähle mindestens einen Artikel aus");
      return;
    }

    const confirm_msg = `Möchtest du ${selectedForReturn.size} Artikel von "${kundeName}" zurück ins Lager lagern?`;
    if (!window.confirm(confirm_msg)) return;

    setRestocking(true);
    try {
      await api.restockKundeSelective(kundeId, Array.from(selectedForReturn));
      toast.erfolg("Artikel erfolgreich zurückgelagert!");
      onRestock?.();
      onClose();
    } catch (err) {
      toast.fehler(err.message);
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
      toast.fehler("Bitte wähle mindestens einen Artikel für die Rechnung aus");
      return;
    }

    const totalValue = summeEur(
      tabItems
        .filter((i) => selectedForRechnung.has(i.Artikelnummer))
        .map((i) => i.Verkaufspreis),
    );

    const confirmMsg = `Rechnung für ${selectedForRechnung.size} Artikel (${formatEur(totalValue)}) für "${kundeName}" erstellen?`;
    if (!window.confirm(confirmMsg)) return;

    setCreatingRechnung(true);
    try {
      const created = await api.createRechnung({
        Kundennummer: kundeId,
        Artikelnummern: Array.from(selectedForRechnung),
      });
      toast.erfolg(`Rechnung "${created?.Nummer}" erfolgreich erstellt!`);
      onRestock?.();
      onClose();
    } catch (err) {
      toast.fehler(err.message);
    } finally {
      setCreatingRechnung(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div
        className="modal inventur-maxw-960-w-95"
        onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>
            Inventur – {kundeName}
            {!kundeAktiv && (
              <span
                className="badge danger inventur-ml-8-fs-12">
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
                <div className="stats-grid inventur-mb-10">
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
                <div className="inventur-flex-gap-12-mb-20-wrap-wrap">
                  <span className="inventur-color-text-secondary-fs-13">
                    Warenwert (aktiv):{" "}
                    <strong className="inventur-color-success">
                      {formatEur(data.stats.wert_aktiv)}
                    </strong>
                  </span>
                  <span className="inventur-color-text-secondary-fs-13">
                    Warenwert (verkauft):{" "}
                    <strong className="inventur-color-info">
                      {formatEur(data.stats.wert_verkauft)}
                    </strong>
                  </span>
                </div>

                {/* Tabs */}
                <div className="inventur-flex-gap-4-mb-16-wrap-wrap">
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
                        <span className="inventur-zaehler-badge">
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
          className="modal-footer inventur-modal-footer inventur-jc-space-between">
          <div className="inventur-flex-gap-8">
            <button
              className="btn btn-warning"
              onClick={handleRestock}
              disabled={restocking || loading || selectedForReturn.size === 0}
              title={
                selectedForReturn.size === 0
                  ? "Wähle Artikel (↩) aus um zurückzulagern"
                  : `${selectedForReturn.size} Artikel zurücklagern`
              }>
              <FontAwesomeIcon icon={faBox} className="inventur-mr-6" />
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
                icon={faFileInvoice} className="inventur-mr-6"/>
              {creatingRechnung
                ? "Erstelle Rechnung…"
                : `Rechnung erstellen (${selectedForRechnung.size})`}
            </button>
          </div>
          <div
            className="inventur-modal-actions inventur-flex-gap-8">
            <button
              className="btn btn-primary"
              onClick={handleExcel}
              disabled={exporting || loading}>
              <FontAwesomeIcon icon={faFileExcel} className="inventur-mr-6" />
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
  const toast = useToast();
  const [diff, setDiff] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState("fehlend");

  useEffect(() => {
    api
      .getInventurDiff(draftId)
      .then(setDiff)
      .catch((err) => toast.fehler("Fehler beim Laden der Auswertung: " + err.message))
      .finally(() => setLoading(false));
  }, [draftId, toast]);

  return (
    <div className="modal-overlay">
      <div
        className="modal inventur-modal-diff"
        onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="inventur-flex-ai-center-gap-10">
            <FontAwesomeIcon icon={faSearch} />
            Inventur-Auswertung #{draftId}
          </h3>
          <button className="modal-close" onClick={onClose}>
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>

        <div className="modal-body inventur-flex-1-oy-auto">
          {loading ? (
            <div className="loading">
              <div className="spinner"></div>Lade Auswertung…
            </div>
          ) : (
            diff && (
              <>
                {/* Summary Badges */}
                <div className="stats-grid inventur-mb-20">
                  <div
                    className={`stat-card danger inventur-stat-klickbar${activeSection === "fehlend" ? " inventur-outline-danger" : ""}`}
                    onClick={() => setActiveSection("fehlend")}>
                    <div className="stat-value">{diff.stats.fehlend}</div>
                    <div className="stat-label">Fehlend</div>
                  </div>
                  <div
                    className={`stat-card warning inventur-stat-klickbar${activeSection === "unbekannt" ? " inventur-outline-warning" : ""}`}
                    onClick={() => setActiveSection("unbekannt")}>
                    <div className="stat-value">{diff.stats.unbekannt}</div>
                    <div className="stat-label">Unbekannt</div>
                  </div>
                  <div
                    className={`stat-card success inventur-stat-klickbar${activeSection === "gefunden" ? " inventur-outline-success" : ""}`}
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
                    <h4 className="inventur-color-danger-flex-ai-center-gap-8-mb-12">
                      <FontAwesomeIcon icon={faExclamationTriangle} />
                      Fehlende Artikelnummern ({diff.stats.fehlend})
                      <span className="inventur-fs-12-fw-400-color-text-secondary">
                        – Im Lager erwartet, aber nicht gescannt
                      </span>
                    </h4>
                    {diff.fehlend.length === 0 ? (
                      <p className="inventur-color-success-fw-600">
                        ✓ Keine Artikel fehlen – alles vollständig erfasst!
                      </p>
                    ) : (
                      <div className="inventur-ox-auto">
                        <table
                          className="table inventur-w-100-border-collapse-collapse">
                          <thead>
                            <tr className="inventur-border-b-2-solid-border">
                              <th className="inventur-p-8-text-left">
                                Artikelnummer
                              </th>
                              <th className="inventur-p-8-text-left">
                                Name
                              </th>
                              <th className="inventur-p-8-text-center">
                                Soll
                              </th>
                              <th className="inventur-p-8-text-center">
                                Ist
                              </th>
                              <th className="inventur-p-8-text-center">
                                Fehlend
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {diff.fehlend.map((item) => (
                              <tr
                                key={item.Artikelnummer} className="inventur-zeile-fehlend">
                                <td className="inventur-p-8">
                                  <strong className="inventur-color-danger">
                                    {item.Artikelnummer}
                                  </strong>
                                </td>
                                <td className="inventur-p-8">
                                  {item.Name || "–"}
                                </td>
                                <td className="inventur-p-8-text-center">
                                  {item.Soll}
                                </td>
                                <td className="inventur-p-8-text-center">
                                  {item.Ist}
                                </td>
                                <td className="inventur-p-8-text-center-fw-bold-color-danger">
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
                    <h4 className="inventur-titel-unbekannt">
                      <FontAwesomeIcon icon={faQuestionCircle} />
                      Unbekannte Artikel ({diff.unbekannt.length})
                      <span className="inventur-fs-12-fw-400-color-text-secondary">
                        – Gescannt, aber nicht im Lager-Soll
                      </span>
                    </h4>
                    {diff.unbekannt.length === 0 ? (
                      <p className="inventur-color-success-fw-600">
                        ✓ Keine unbekannten Artikel gescannt.
                      </p>
                    ) : (
                      <div className="inventur-ox-auto">
                        <table
                          className="table inventur-w-100-border-collapse-collapse">
                          <thead>
                            <tr className="inventur-border-b-2-solid-border">
                              <th className="inventur-p-8-text-left">
                                Artikelnummer
                              </th>
                              <th className="inventur-p-8-text-left">
                                Name
                              </th>
                              <th className="inventur-p-8-text-center">
                                Soll
                              </th>
                              <th className="inventur-p-8-text-center">
                                Ist
                              </th>
                              <th className="inventur-p-8-text-center">
                                Überschuss
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {diff.unbekannt.map((item) => (
                              <tr
                                key={item.Artikelnummer} className="inventur-zeile-unbekannt">
                                <td className="inventur-p-8">
                                  <strong className="inventur-color-warning">
                                    {item.Artikelnummer}
                                  </strong>
                                </td>
                                <td className="inventur-p-8">
                                  {item.Name || "–"}
                                </td>
                                <td className="inventur-p-8-text-center">
                                  {item.Soll}
                                </td>
                                <td className="inventur-p-8-text-center">
                                  {item.Ist}
                                </td>
                                <td className="inventur-p-8-text-center-fw-bold-color-warning">
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
                    <h4 className="inventur-titel-gefunden">
                      <FontAwesomeIcon icon={faCheckCircle} />
                      Gefundene Artikel ({diff.gefunden.length})
                      <span className="inventur-fs-12-fw-400-color-text-secondary">
                        – Im Soll und auch gescannt
                      </span>
                    </h4>
                    {diff.gefunden.length === 0 ? (
                      <p className="inventur-color-text-muted">
                        Keine Artikel übereinstimmend.
                      </p>
                    ) : (
                      <div className="inventur-ox-auto">
                        <table
                          className="table inventur-w-100-border-collapse-collapse">
                          <thead>
                            <tr className="inventur-border-b-2-solid-border">
                              <th className="inventur-p-8-text-left">
                                Artikelnummer
                              </th>
                              <th className="inventur-p-8-text-left">
                                Name
                              </th>
                              <th className="inventur-p-8-text-center">
                                Soll
                              </th>
                              <th className="inventur-p-8-text-center">
                                Gefunden
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {diff.gefunden.map((item) => (
                              <tr
                                key={item.Artikelnummer} className="inventur-border-b-1-solid-border">
                                <td className="inventur-p-8">
                                  <strong className="inventur-color-success">
                                    {item.Artikelnummer}
                                  </strong>
                                </td>
                                <td className="inventur-p-8">
                                  {item.Name || "–"}
                                </td>
                                <td className="inventur-p-8-text-center">
                                  {item.Soll}
                                </td>
                                <td className="inventur-p-8-text-center">
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

        <div className="modal-footer inventur-jc-flex-end">
          <button className="btn btn-secondary" onClick={onClose}>
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}

function LagerInventurEditor({ draftId, onBack }) {
  const toast = useToast();
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
        toast.fehler(err.message);
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
        toast.fehler("Fehler beim Laden der Artikelnummern: " + err.message)
      );
  }, [draftId, onBack, toast]);

  const performSave = async (showSuccessAlert = false) => {
    const currentStr = JSON.stringify({
      data: draft.data,
      kommentar: draft.kommentar,
    });
    if (currentStr === lastSavedDraftStr) {
      // Nichts geändert, muss nicht gespeichert werden
      if (showSuccessAlert) toast.erfolg("Inventur erfolgreich gespeichert!");
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
        toast.erfolg("Inventur erfolgreich gespeichert!");
      }
      return true;
    } catch (err) {
      if (showSuccessAlert) {
        toast.fehler("Fehler beim Speichern: " + err.message);
      } else {
        toast.fehler("Automatische Speicherung fehlgeschlagen: " + err.message);
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
      toast.fehler("Fehler beim Abschließen: " + err.message);
    }
  };

  const handleShowDiff = async () => {
    try {
      await performSave(false);
      setShowDiff(true);
    } catch (err) {
      toast.fehler("Fehler vor Auswertung: " + err.message);
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
          className="card-header inventur-flex-gap-16-ai-center">
          <button className="btn btn-secondary" onClick={onBack}>
            &larr; Zurück
          </button>
          <h3 className="inventur-m-0">Lager-Inventur #{draft.id}</h3>
        </div>
        <div className="card-body">
          <div className="inventur-mb-20">
            <label>Kommentar:</label>
            <input
              type="text"
              className="input inventur-w-100-maxw-400-mt-4"
              value={draft.kommentar || ""}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, kommentar: e.target.value }))
              }
              placeholder="Optionale Notiz..."
            />
          </div>

          <form
            onSubmit={handleScan} className="inventur-scan-form">
            <input
              type="text"
              className="input inventur-flex-1-maxw-300"
              list="artikelnummer-autocomplete"
              value={inputNr}
              onChange={(e) => setInputNr(e.target.value)}
              placeholder="Artikelnummer scannen..."
              autoFocus
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

          <h4 className="inventur-mb-12">
            Erfasste Artikel (
            {entries.reduce((sum, [_, count]) => sum + count, 0)} Stück gesamt)
          </h4>
          {entries.length === 0 ? (
            <p className="inventur-color-text-muted">
              Noch keine Artikel gescannt.
            </p>
          ) : (
            <div className="inventur-ox-auto-mb-20">
              <table
                className="table inventur-tabelle">
                <thead>
                  <tr className="inventur-border-b-2-solid-border">
                    <th className="inventur-p-8">Artikelnummer</th>
                    <th className="inventur-w-120-p-8">Anzahl</th>
                    <th className="inventur-w-80-p-8-text-center">
                      Aktion
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(([nr, count]) => (
                    <tr
                      key={nr} className="inventur-border-b-1-solid-border">
                      <td className="inventur-p-8">
                        <strong>{nr}</strong>
                      </td>
                      <td className="inventur-p-8">
                        <input
                          type="number"
                          className="input inventur-w-80"
                          min="1"
                          value={count}
                          onChange={(e) =>
                            handleCountChange(nr, e.target.value)
                          }
                        />
                      </td>
                      <td className="inventur-p-8-text-center">
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

          <div className="inventur-aktionsleiste">
            <button
              className="btn btn-primary"
              onClick={handleShowDiff}
              disabled={saving || entries.length === 0}
              title="Vergleiche gescannte Artikel mit dem Lagerbestand">
              <FontAwesomeIcon icon={faSearch} className="mr-8" />
              Auswertung anzeigen
            </button>
            <button
              className="btn btn-success ml-auto"
              onClick={completeDraft}
              disabled={saving}>
              <FontAwesomeIcon icon={faCheck} className="mr-8" />
              Abschließen
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function LagerInventurUI() {
  const toast = useToast();
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeDraftId, setActiveDraftId] = useState(null);

  const loadDrafts = useCallback(() => {
    api
      .getInventurDrafts()
      .then(setDrafts)
      .catch((err) => toast.fehler("Fehler beim Laden der Inventuren: " + err.message))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => {
    if (!activeDraftId) {
      loadDrafts();
    }
  }, [activeDraftId, loadDrafts]);

  const createDraft = async () => {
    try {
      const draft = await api.createInventurDraft({ data: {}, kommentar: "" });
      setActiveDraftId(draft.id);
    } catch (err) {
      toast.fehler(err.message);
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
          <FontAwesomeIcon icon={faPlus} className="mr-8" />
          Neue Inventur
        </button>
      </div>
      <div className="card-body">
        {loading ? (
          <div className="loading">
            <div className="spinner"></div>Lade Inventuren...
          </div>
        ) : drafts.length === 0 ? (
          <p className="inventur-color-text-muted-p-10">
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
                    <span className="inventur-color-text-muted">
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
  const toast = useToast();
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({ aktiv: "1" });
  const [selectedKunde, setSelectedKunde] = useState(null);
  const [activeTab, setActiveTab] = useState("kunden"); // 'kunden' | 'lager'
  // Konstant: setSortConfig wird nirgends aufgerufen, die Sortierung stand
  // also schon immer fest auf diesem Wert (Befund G14).
  const sortConfig = { key: "Name", direction: "asc" };
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  const load = useCallback(() => {
    api
      .getInventur()
      .then(setSummary)
      .catch((err) => toast.fehler(err.message))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

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

  // requestSort/getSortIcon waren nie verdrahtet – kein Header rief sie auf.
  // Dadurch wird setSortConfig nirgends aufgerufen und die Sortierung unten
  // steht dauerhaft auf ihrem Anfangswert; DataTable sortiert danach ohnehin
  // ein zweites Mal clientseitig (Befund G14). Die tote Implementierung ist
  // entfernt, das eingefrorene useMemo bleibt vorerst, weil es die
  // Anfangsreihenfolge der Liste bestimmt.

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
      <div className="inventur-flex-gap-8-mb-16">
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
                <p className="inventur-color-text-muted">
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
                      <tr className="inventur-fw-600-bg-bg-hover">
                        <td
                          colSpan={isMobile ? 1 : 2} className="inventur-p-8-12">
                          Gesamt
                        </td>
                        <td className="inventur-text-left">{totals.gesamt}</td>
                        <td className="inventur-text-left-color-success">
                          {totals.aktiv}
                        </td>
                        <td
                          className="hide-on-mobile inventur-text-left-color-info">
                          {totals.verkauft}
                        </td>
                        <td
                          className="hide-on-mobile inventur-text-left-color-warning">
                          {totals.ausschuss}
                        </td>
                        <td
                          className="hide-on-mobile inventur-text-left">
                          {formatEur(totals.wert_aktiv)}
                        </td>
                        <td
                          className="hide-on-mobile inventur-text-left">
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
                                className="badge danger inventur-ml-8-fs-10">
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
                        headerClassName: "inventur-th-links",
                        sortable: true,
                        render: (r) => (
                          <span className="inventur-text-left">{r.gesamt}</span>
                        ),
                      },
                      {
                        key: "aktiv",
                        label: "Nicht verkauft",
                        headerClassName: "inventur-th-links",
                        sortable: true,
                        render: (r) => (
                          <span className="inventur-color-success">
                            {r.aktiv}
                          </span>
                        ),
                      },
                      {
                        key: "verkauft",
                        label: "Verkauft",
                        className: "hide-on-mobile",
                        headerClassName: "inventur-th-links",
                        sortable: true,
                        render: (r) => (
                          <span className="inventur-color-info">
                            {r.verkauft}
                          </span>
                        ),
                      },
                      {
                        key: "ausschuss",
                        label: "Ausschuss",
                        className: "hide-on-mobile",
                        headerClassName: "inventur-th-links",
                        sortable: true,
                        render: (r) => (
                          <span className="inventur-color-warning">
                            {r.ausschuss}
                          </span>
                        ),
                      },
                      {
                        key: "wert_aktiv",
                        label: "Warenwert (aktiv)",
                        className: "hide-on-mobile",
                        headerClassName: "inventur-th-links",
                        render: (r) => formatEur(r.wert_aktiv),
                      },
                      {
                        key: "wert_verkauft",
                        label: "Warenwert (verkauft)",
                        className: "hide-on-mobile",
                        headerClassName: "inventur-th-links",
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
      <div className="inventur-p-8">
        <div className="spinner inventur-w-20-h-20"></div>
      </div>
    );
  if (error)
    return <p className="inventur-color-danger-p-8">{error}</p>;
  if (!data) return null;

  const aktiv = data.items.filter(
    (i) => !istWahr(i.Verkauft) && !istWahr(i.Ausschuss),
  );
  const verkauft = data.items.filter((i) => istWahr(i.Verkauft));
  const ausschuss = data.items.filter((i) => istWahr(i.Ausschuss));

  return (
    <div className="inventur-p-8-0-fs-13">
      <div className="inventur-flex-gap-24-wrap-wrap">
        <span>
          <span className="inventur-color-success-fw-600">
            {aktiv.length}
          </span>{" "}
          nicht verkauft &nbsp;|&nbsp;
          <span className="inventur-color-info-fw-600">
            {verkauft.length}
          </span>{" "}
          verkauft &nbsp;|&nbsp;
          <span className="inventur-color-warning-fw-600">
            {ausschuss.length}
          </span>{" "}
          Ausschuss
        </span>
      </div>
    </div>
  );
}
