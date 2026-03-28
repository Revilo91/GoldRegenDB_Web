import { useState, useEffect, useMemo } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faFileExcel,
  faFileInvoice,
  faTimes,
  faBox,
  faGem,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../api";
import DataTable from "../components/DataTable";
import TableToolbar from "../components/TableToolbar";

const TABS = [
  { id: "aktiv", label: "Nicht verkauft" },
  { id: "verkauft", label: "Verkauft" },
  { id: "ausschuss", label: "Ausschuss" },
  { id: "alle", label: "Alle" },
];

function formatEur(value) {
  return Number(value || 0).toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
  });
}

function TablePhoto({ foto, artikelnummer }) {
  const [photoSrc, setPhotoSrc] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    if (!foto) {
      setPhotoSrc(null);
      setIsLoading(false);
      return () => {
        isCancelled = true;
      };
    }

    setIsLoading(true);
    api.loadPhotoAsDataUrl(foto).then((dataUrl) => {
      if (isCancelled) return;
      setPhotoSrc(dataUrl);
      setIsLoading(false);
    });

    return () => {
      isCancelled = true;
    };
  }, [foto]);

  if (!photoSrc) {
    return (
      <span
        className="table-photo-placeholder"
        title={isLoading ? "Foto wird geladen" : "Kein Foto verfügbar"}>
        <FontAwesomeIcon icon={faGem} />
      </span>
    );
  }

  return (
    <img
      className="table-photo-thumb"
      src={photoSrc}
      alt={`Foto ${artikelnummer}`}
      title={`Foto ${artikelnummer}`}
      loading="lazy"
    />
  );
}

function ItemsTable({
  items,
  selectedForReturn,
  toggleItemSelection,
  selectAll,
  selectedForRechnung,
  toggleForRechnung,
  selectAllForRechnung,
}) {
  const [sortConfig, setSortConfig] = useState({
    key: "Artikelnummer",
    direction: "asc",
  });

  const sorted = useMemo(() => {
    let sortableData = [...items];
    if (sortConfig.key !== null) {
      sortableData.sort((a, b) => {
        let aValue = a[sortConfig.key];
        let bValue = b[sortConfig.key];

        // Numeric sort for prices
        if (sortConfig.key === "Verkaufspreis") {
          aValue = Number(aValue) || 0;
          bValue = Number(bValue) || 0;
        } else if (sortConfig.key === "Artikelnummer") {
          return sortConfig.direction === "asc"
            ? String(aValue || "").localeCompare(
                String(bValue || ""),
                undefined,
                {
                  numeric: true,
                },
              )
            : String(bValue || "").localeCompare(
                String(aValue || ""),
                undefined,
                {
                  numeric: true,
                },
              );
        } else {
          // Case-insensitive string comparison
          if (typeof aValue === "string") aValue = aValue.toUpperCase();
          if (typeof bValue === "string") bValue = bValue.toUpperCase();
        }

        if (aValue < bValue) return sortConfig.direction === "asc" ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === "asc" ? 1 : -1;
        return 0;
      });
    }
    return sortableData;
  }, [items, sortConfig]);

  const allSelected =
    selectedForReturn &&
    sorted.length > 0 &&
    selectedForReturn.size === sorted.length;
  const allSelectedForRechnung =
    selectedForRechnung &&
    sorted.length > 0 &&
    selectedForRechnung.size === sorted.length;

  const total = useMemo(
    () => sorted.reduce((sum, item) => sum + (Number(item.Verkaufspreis) || 0), 0),
    [sorted],
  );

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

  return (
    <div style={{ overflowX: "auto" }}>
      <DataTable
        data={sorted}
        className="inventur-items-table"
        getRowKey={(item) => item.Artikelnummer}
        defaultSort={{ key: sortConfig.key, direction: sortConfig.direction }}
        onRowClick={undefined}
        columns={[
          selectedForReturn && {
            key: "zurueck",
            label: (
              <>
                <div style={{ fontSize: 8 }}>Zurück</div>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={selectAll}
                  title={allSelected ? "Alle abwählen" : "Alle auswählen"}
                  onClick={e => e.stopPropagation()}
                  style={{ marginTop: 2 }}
                />
              </>
            ),
            style: { width: 40, textAlign: "center" },
            render: (item) => (
              <input
                type="checkbox"
                checked={selectedForReturn.has(item.Artikelnummer)}
                onChange={() => toggleItemSelection(item.Artikelnummer)}
                onClick={e => e.stopPropagation()}
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
                  checked={allSelectedForRechnung}
                  onChange={selectAllForRechnung}
                  title={
                    allSelectedForRechnung
                      ? "Alle abwählen"
                      : "Alle für Rechnung auswählen"
                  }
                  onClick={e => e.stopPropagation()}
                  style={{ marginTop: 2 }}
                />
              </>
            ),
            style: { width: 40, textAlign: "center" },
            render: (item) => (
              <input
                type="checkbox"
                checked={selectedForRechnung.has(item.Artikelnummer)}
                onChange={() => toggleForRechnung(item.Artikelnummer)}
                onClick={e => e.stopPropagation()}
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
              />
            ),
          },
          {
            key: "Artikelnummer",
            label: (
              <span style={{ cursor: "pointer" }} onClick={() => requestSort("Artikelnummer")}>Artikelnummer {getSortIcon("Artikelnummer")}</span>
            ),
            sortable: true,
            render: (item) => (
              <>
                <strong>{String(item.Artikelnummer || "").split("_")[0]}</strong>
                {Number(String(item.Artikelnummer || "").split("_")[1]) > 0 && (
                  <span className="badge warning">
                    {String(item.Artikelnummer || "").split("_")[1]}
                  </span>
                )}
              </>
            ),
          },
          {
            key: "Verkaufspreis",
            label: (
              <span className="hide-on-mobile" style={{ cursor: "pointer" }} onClick={() => requestSort("Verkaufspreis")}>Verkaufspreis {getSortIcon("Verkaufspreis")}</span>
            ),
            className: "hide-on-mobile",
            sortable: true,
            render: (item) => formatEur(item.Verkaufspreis),
          },
          {
            key: "Erstelldatum",
            label: (
              <span style={{ cursor: "pointer" }} onClick={() => requestSort("Erstelldatum")}>Erstellt {getSortIcon("Erstelldatum")}</span>
            ),
            sortable: true,
            render: (item) =>
              item.Erstelldatum
                ? new Date(item.Erstelldatum).toLocaleDateString("de-DE", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                  })
                : "–",
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

    const confirm_msg = `Möchtest du ${selectedForReturn.size} Artikel von "${kundeName}" zurück ins Lager lagern (Ausgelagert = 0)?`;
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

    const nummer = window.prompt(
      `Rechnungsnummer für ${selectedForRechnung.size} Artikel von "${kundeName}" eingeben:`,
    );
    if (!nummer || !nummer.trim()) return;

    const totalValue = tabItems
      .filter((i) => selectedForRechnung.has(i.Artikelnummer))
      .reduce((s, i) => s + (Number(i.Verkaufspreis) || 0), 0);

    const confirmMsg = `Rechnung "${nummer.trim()}" für ${selectedForRechnung.size} Artikel (${formatEur(totalValue)}) von "${kundeName}" erstellen?`;
    if (!window.confirm(confirmMsg)) return;

    setCreatingRechnung(true);
    try {
      await api.createRechnung({
        Nummer: nummer.trim(),
        Kundennummer: kundeId,
        Artikelnummern: Array.from(selectedForRechnung),
      });
      alert(`Rechnung "${nummer.trim()}" erfolgreich erstellt!`);
      onRestock?.();
      onClose();
    } catch (err) {
      alert(err.message);
    } finally {
      setCreatingRechnung(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
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
    </div>
  );
}

export default function Inventur() {
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({ aktiv: "1" });
  const [selectedKunde, setSelectedKunde] = useState(null);
  const [activeTab, setActiveTab] = useState('kunden'); // 'kunden' | 'lager'
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
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          className={`btn btn-sm ${activeTab === 'kunden' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('kunden')}
        >
          Kunden-Inventur
        </button>
        <button
          className={`btn btn-sm ${activeTab === 'lager' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('lager')}
        >
          Lager-Inventur
        </button>
      </div>

      {activeTab === 'kunden' && (
        <>
          <TableToolbar
            search={search}
            onSearchChange={setSearch}
            placeholder="Suche nach Kunde, Ort…"
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
                        <td colSpan={isMobile ? 1 : 2} style={{ padding: "8px 12px" }}>
                          Gesamt
                        </td>
                        <td style={{ textAlign: "left" }}>{totals.gesamt}</td>
                        <td style={{ textAlign: "left", color: "var(--success)" }}>
                          {totals.aktiv}
                        </td>
                        <td className="hide-on-mobile" style={{ textAlign: "left", color: "var(--info)" }}>
                          {totals.verkauft}
                        </td>
                        <td className="hide-on-mobile" style={{ textAlign: "left", color: "var(--warning)" }}>
                          {totals.ausschuss}
                        </td>
                        <td className="hide-on-mobile" style={{ textAlign: "left" }}>
                          {formatEur(totals.wert_aktiv)}
                        </td>
                        <td className="hide-on-mobile" style={{ textAlign: "left" }}>
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
                          <span style={{ color: "var(--success)" }}>{r.aktiv}</span>
                        ),
                      },
                      {
                        key: "verkauft",
                        label: "Verkauft",
                        className: "hide-on-mobile",
                        style: { textAlign: "left" },
                        sortable: true,
                        render: (r) => (
                          <span style={{ color: "var(--info)" }}>{r.verkauft}</span>
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

      {activeTab === 'lager' && (
        <div className="card">
          <div className="card-body">
            <h3>Lager-Inventur</h3>
            <p>Hier können Sie eine Inventur des Lagerbestands durchführen und Zwischenergebnisse speichern.</p>
            {/* TODO: Lager-Inventur-UI und Anbindung an Entwurfs-API */}
            <div style={{ color: 'var(--text-muted)', padding: 24 }}>
              (Platzhalter für Lager-Inventur)
            </div>
          </div>
        </div>
      )}
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
