import { useState, useEffect, useMemo } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faFileExcel,
  faTimes,
  faChevronDown,
  faChevronRight,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../api";

const TABS = [
  { id: "aktiv",     label: "Nicht verkauft" },
  { id: "verkauft",  label: "Verkauft" },
  { id: "ausschuss", label: "Ausschuss" },
  { id: "alle",      label: "Alle" },
];

function formatEur(value) {
  return Number(value || 0).toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
  });
}

function ItemsTable({ items }) {
  if (items.length === 0) {
    return <p style={{ color: "var(--text-muted)", padding: "16px 0" }}>Keine Artikel.</p>;
  }
  const total = items.reduce((s, i) => s + (Number(i.Verkaufspreis) || 0), 0);
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Artikelnummer</th>
            <th>Name</th>
            <th>Art</th>
            <th>Farbe</th>
            <th>Material</th>
            <th>Verkaufspreis</th>
            <th>Erstellt</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.Artikelnummer}>
              <td><code>{item.Artikelnummer}</code></td>
              <td>{item.Name || "–"}</td>
              <td>{item.Art || "–"}</td>
              <td>{item.Farbe || "–"}</td>
              <td>{item.Material || "–"}</td>
              <td>{formatEur(item.Verkaufspreis)}</td>
              <td>
                {item.Erstelldatum
                  ? new Date(item.Erstelldatum).toLocaleDateString("de-DE")
                  : "–"}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={5} style={{ fontWeight: 600, textAlign: "right", padding: "8px 12px" }}>
              Gesamtwert:
            </td>
            <td style={{ fontWeight: 600 }}>{formatEur(total)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function DetailModal({ kundeId, kundeName, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("aktiv");
  const [exporting, setExporting] = useState(false);

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
    if (tab === "aktiv")     return items.filter((i) => Number(i.Verkauft) === 0 && Number(i.Ausschuss) === 0);
    if (tab === "verkauft")  return items.filter((i) => Number(i.Verkauft) === 1);
    if (tab === "ausschuss") return items.filter((i) => Number(i.Ausschuss) === 1);
    return items;
  }, [data, tab]);

  const handleExcel = async () => {
    setExporting(true);
    try {
      const blob = await api.exportInventurExcel(kundeId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeName = String(kundeName || kundeId).replace(/[\\/:*?"<>|]+/g, "_");
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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        style={{ maxWidth: 960, width: "95%" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>Inventur – {kundeName}</h3>
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
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                    gap: 12,
                    marginBottom: 20,
                  }}
                >
                  {[
                    { label: "Gesamt",         value: data.stats.gesamt,    color: "var(--text-primary)" },
                    { label: "Nicht verkauft", value: data.stats.aktiv,     color: "var(--success)" },
                    { label: "Verkauft",       value: data.stats.verkauft,  color: "var(--info)" },
                    { label: "Ausschuss",      value: data.stats.ausschuss, color: "var(--warning)" },
                  ].map((s) => (
                    <div
                      key={s.label}
                      style={{
                        background: "var(--bg-hover)",
                        borderRadius: "var(--radius-sm)",
                        padding: "12px 16px",
                        textAlign: "center",
                      }}
                    >
                      <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{s.label}</div>
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
                  }}
                >
                  <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>
                    Warenwert (aktiv): <strong style={{ color: "var(--success)" }}>{formatEur(data.stats.wert_aktiv)}</strong>
                  </span>
                  <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>
                    Warenwert (verkauft): <strong style={{ color: "var(--info)" }}>{formatEur(data.stats.wert_verkauft)}</strong>
                  </span>
                </div>

                {/* Tabs */}
                <div style={{ display: "flex", gap: 4, marginBottom: 16, flexWrap: "wrap" }}>
                  {TABS.map((t) => (
                    <button
                      key={t.id}
                      className={`btn btn-sm ${tab === t.id ? "btn-primary" : "btn-secondary"}`}
                      onClick={() => setTab(t.id)}
                    >
                      {t.label}
                      {t.id !== "alle" && (
                        <span
                          style={{
                            marginLeft: 6,
                            background: "rgba(255,255,255,0.15)",
                            borderRadius: 10,
                            padding: "1px 6px",
                            fontSize: 11,
                          }}
                        >
                          {t.id === "aktiv"     ? data.stats.aktiv
                           : t.id === "verkauft" ? data.stats.verkauft
                           : data.stats.ausschuss}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                <ItemsTable items={tabItems} />
              </>
            )
          )}
        </div>

        <div className="modal-footer" style={{ justifyContent: "flex-end" }}>
          <button
            className="btn btn-primary"
            onClick={handleExcel}
            disabled={exporting || loading}
          >
            <FontAwesomeIcon icon={faFileExcel} style={{ marginRight: 6 }} />
            {exporting ? "Exportiere…" : "Excel Export"}
          </button>
          <button className="btn btn-secondary" onClick={onClose} style={{ marginLeft: 8 }}>
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Inventur() {
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedKunde, setSelectedKunde] = useState(null);
  const [expandedRows, setExpandedRows] = useState(new Set());

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

  const filtered = useMemo(() => {
    if (!search.trim()) return summary;
    const s = search.toUpperCase();
    return summary.filter(
      (k) =>
        k.Name?.toUpperCase().includes(s) ||
        k.Ort?.toUpperCase().includes(s)
    );
  }, [summary, search]);

  const totals = useMemo(
    () =>
      summary.reduce(
        (acc, k) => ({
          gesamt:       acc.gesamt       + (k.gesamt    || 0),
          aktiv:        acc.aktiv        + (k.aktiv     || 0),
          verkauft:     acc.verkauft     + (k.verkauft  || 0),
          ausschuss:    acc.ausschuss    + (k.ausschuss || 0),
          wert_aktiv:   acc.wert_aktiv   + (Number(k.wert_aktiv)   || 0),
          wert_verkauft:acc.wert_verkauft+ (Number(k.wert_verkauft)|| 0),
        }),
        { gesamt: 0, aktiv: 0, verkauft: 0, ausschuss: 0, wert_aktiv: 0, wert_verkauft: 0 }
      ),
    [summary]
  );

  const toggleExpand = (id) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Inventur</h2>
          <p>Ausgelagerte Schmuckstücke pro Kunde</p>
        </div>
      </div>

      {/* Summary stats */}
      {!loading && summary.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 12,
            marginBottom: 24,
          }}
        >
          {[
            { label: "Kunden",           value: summary.length,      color: "var(--accent)"  },
            { label: "Artikel gesamt",   value: totals.gesamt,       color: "var(--text-primary)" },
            { label: "Nicht verkauft",   value: totals.aktiv,        color: "var(--success)" },
            { label: "Verkauft",         value: totals.verkauft,     color: "var(--info)"    },
            { label: "Ausschuss",        value: totals.ausschuss,    color: "var(--warning)" },
          ].map((s) => (
            <div
              key={s.label}
              className="card"
              style={{ padding: "16px", textAlign: "center" }}
            >
              <div style={{ fontSize: 24, fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="toolbar">
        <input
          className="form-control search-input"
          placeholder="Suche nach Kunde, Ort…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

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
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}></th>
                  <th>Kunde</th>
                  <th>Ort</th>
                  <th style={{ textAlign: "right" }}>Gesamt</th>
                  <th style={{ textAlign: "right" }}>Nicht verkauft</th>
                  <th style={{ textAlign: "right" }}>Verkauft</th>
                  <th style={{ textAlign: "right" }}>Ausschuss</th>
                  <th style={{ textAlign: "right" }}>Warenwert (aktiv)</th>
                  <th style={{ textAlign: "right" }}>Warenwert (verk.)</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((k) => (
                  <>
                    <tr
                      key={k.ID}
                      style={{ cursor: "pointer" }}
                      onClick={() => setSelectedKunde(k)}
                    >
                      <td
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpand(k.ID);
                        }}
                        style={{ textAlign: "center", color: "var(--text-muted)" }}
                      >
                        <FontAwesomeIcon
                          icon={expandedRows.has(k.ID) ? faChevronDown : faChevronRight}
                        />
                      </td>
                      <td>
                        <strong>{k.Name}</strong>
                        {!k.Aktiv && (
                          <span
                            className="badge danger"
                            style={{ marginLeft: 8, fontSize: 10 }}
                          >
                            Inaktiv
                          </span>
                        )}
                      </td>
                      <td>{k.Ort || "–"}</td>
                      <td style={{ textAlign: "right" }}>{k.gesamt}</td>
                      <td style={{ textAlign: "right" }}>
                        <span style={{ color: "var(--success)" }}>{k.aktiv}</span>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <span style={{ color: "var(--info)" }}>{k.verkauft}</span>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <span style={{ color: "var(--warning)" }}>{k.ausschuss}</span>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {formatEur(k.wert_aktiv)}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {formatEur(k.wert_verkauft)}
                      </td>
                      <td>
                        <button
                          className="btn btn-sm btn-secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedKunde(k);
                          }}
                          title="Details anzeigen"
                        >
                          Details
                        </button>
                      </td>
                    </tr>
                    {expandedRows.has(k.ID) && (
                      <tr key={`${k.ID}-expanded`}>
                        <td colSpan={10} style={{ padding: "0 0 8px 40px", background: "var(--bg-hover)" }}>
                          <InlineItems kundeId={k.ID} />
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 600, background: "var(--bg-hover)" }}>
                  <td colSpan={3} style={{ padding: "8px 12px" }}>Gesamt</td>
                  <td style={{ textAlign: "right" }}>{totals.gesamt}</td>
                  <td style={{ textAlign: "right", color: "var(--success)" }}>{totals.aktiv}</td>
                  <td style={{ textAlign: "right", color: "var(--info)" }}>{totals.verkauft}</td>
                  <td style={{ textAlign: "right", color: "var(--warning)" }}>{totals.ausschuss}</td>
                  <td style={{ textAlign: "right" }}>{formatEur(totals.wert_aktiv)}</td>
                  <td style={{ textAlign: "right" }}>{formatEur(totals.wert_verkauft)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>

      {selectedKunde && (
        <DetailModal
          kundeId={selectedKunde.ID}
          kundeName={selectedKunde.Name}
          onClose={() => setSelectedKunde(null)}
        />
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

  if (loading) return <div style={{ padding: 8 }}><div className="spinner" style={{ width: 20, height: 20 }}></div></div>;
  if (error) return <p style={{ color: "var(--danger)", padding: 8 }}>{error}</p>;
  if (!data) return null;

  const aktiv     = data.items.filter((i) => Number(i.Verkauft) === 0 && Number(i.Ausschuss) === 0);
  const verkauft  = data.items.filter((i) => Number(i.Verkauft) === 1);
  const ausschuss = data.items.filter((i) => Number(i.Ausschuss) === 1);

  return (
    <div style={{ padding: "8px 0", fontSize: 13 }}>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <span>
          <span style={{ color: "var(--success)", fontWeight: 600 }}>{aktiv.length}</span>
          {" "}nicht verkauft &nbsp;|&nbsp;
          <span style={{ color: "var(--info)", fontWeight: 600 }}>{verkauft.length}</span>
          {" "}verkauft &nbsp;|&nbsp;
          <span style={{ color: "var(--warning)", fontWeight: 600 }}>{ausschuss.length}</span>
          {" "}Ausschuss
        </span>
      </div>
      {aktiv.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <strong style={{ fontSize: 12, color: "var(--text-muted)" }}>Nicht verkauft:</strong>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
            {aktiv.slice(0, 20).map((i) => (
              <code
                key={i.Artikelnummer}
                style={{
                  background: "var(--bg-secondary)",
                  padding: "2px 6px",
                  borderRadius: 4,
                  fontSize: 11,
                }}
              >
                {i.Artikelnummer}
              </code>
            ))}
            {aktiv.length > 20 && (
              <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
                +{aktiv.length - 20} weitere…
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
