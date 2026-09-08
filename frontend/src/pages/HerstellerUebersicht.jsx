import { useState, useEffect, useMemo } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faLayerGroup,
  faEuroSign,
  faTags,
  faBoxOpen,
  faHourglassHalf,
  faWarehouse,
} from "@fortawesome/free-solid-svg-icons";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { api } from "../api";

const HERSTELLER_META = {
  M: { key: "M", label: "Marina", color: "#6366f1", modifier: "marina" },
  S: { key: "S", label: "Saskia", color: "#ec4899", modifier: "saskia" },
};

const AGING_COLORS = {
  "0-30": "#10b981",
  "31-90": "#3b82f6",
  "91-180": "#f59e0b",
  "180+": "#ef4444",
};

const TOOLTIP_STYLE = {
  backgroundColor: "#21242f",
  border: "1px solid #2e3240",
  borderRadius: "8px",
  color: "#e8eaf0",
};
const AXIS_TICK_STYLE = { fill: "#9ca3b4", fontSize: 12 };

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatEuro(value) {
  return `${toNumber(value).toLocaleString("de-DE", { maximumFractionDigits: 0 })} €`;
}

function agingSeverity(tage) {
  if (tage <= 30) return "success";
  if (tage <= 90) return "info";
  if (tage <= 180) return "warning";
  return "danger";
}

const QUELLE_LABEL = {
  lieferschein: "lt. Lieferschein",
  audit: "lt. Änderungsprotokoll",
  erstellt: "geschätzt (Erstelldatum)",
};

function EmptyChart({ message }) {
  return (
    <div className="chart-empty">
      <p>{message}</p>
    </div>
  );
}

/* ── Hero-Kachel je Hersteller ────────────────────────────────── */
function HerstellerHeroCard({ meta, h, medianAlter, anteil }) {
  const kpis = [
    { icon: faEuroSign, label: "Einnahmen", value: formatEuro(h.einnahmen.gesamt) },
    { icon: faTags, label: "Ø Verkaufspreis", value: formatEuro(h.einnahmen.durchschnitt) },
    { icon: faBoxOpen, label: "Im Mietfach", value: `${h.mietfach.stuecke} Stück` },
    { icon: faHourglassHalf, label: "Ø Verweildauer", value: `${medianAlter} Tage` },
    { icon: faWarehouse, label: "Gebundener Wert", value: formatEuro(h.einnahmen.gebundenerWertMietfach) },
    { icon: faLayerGroup, label: "Anteil Einnahmen", value: `${Math.round(anteil * 100)} %` },
  ];
  return (
    <div className={`hu-hero-card hu-hero-card--${meta.modifier}`}>
      <div className="hu-hero-card-head">
        <span className="hu-hero-dot" />
        <h3>{meta.label}</h3>
        <span className="hu-hero-sub">Artikelnummer {meta.key}…</span>
      </div>
      <div className="hu-hero-kpis">
        {kpis.map((k) => (
          <div className="hu-kpi" key={k.label}>
            <FontAwesomeIcon icon={k.icon} className="hu-kpi-icon" />
            <div className="hu-kpi-value">{k.value}</div>
            <div className="hu-kpi-label">{k.label}</div>
          </div>
        ))}
      </div>
      <div className="hu-hero-bestand">
        <span><b>{h.bestand.verfuegbar}</b> verfügbar</span>
        <span><b>{h.bestand.ausgelagert}</b> ausgelagert</span>
        <span><b>{h.bestand.verkauft}</b> verkauft</span>
        <span><b>{h.bestand.ausschuss}</b> Ausschuss</span>
      </div>
    </div>
  );
}

/* ── Mietfach-Aging: gestapelter Balken + Legende ─────────────── */
// Ausnahme von der "keine Inline-Styles"-Regel: Segmentbreite (%) und
// Bucket-Farbe sind datengetrieben und lassen sich nicht als Klasse ausdrücken.
function AgingBar({ meta, buckets }) {
  const total = buckets.reduce((sum, b) => sum + b.anzahl, 0);
  return (
    <div className="card hu-aging">
      <div className="card-header">
        <h3>
          <span className={`hu-inline-dot hu-inline-dot--${meta.modifier}`} />
          {meta.label} · Verweildauer im Mietfach
        </h3>
        <span className="hu-muted">{total} Stück</span>
      </div>
      <div className="hu-aging-body">
        {total === 0 ? (
          <EmptyChart message="Keine Stücke aktuell im Mietfach" />
        ) : (
          <>
            <div className="hu-aging-track">
              {buckets.map((b) =>
                b.anzahl === 0 ? null : (
                  <div
                    key={b.key}
                    className="hu-aging-seg"
                    style={{
                      width: `${(b.anzahl / total) * 100}%`,
                      background: AGING_COLORS[b.key],
                    }}
                    title={`${b.label}: ${b.anzahl} Stück`}
                  >
                    {b.anzahl}
                  </div>
                )
              )}
            </div>
            <ul className="hu-aging-legend">
              {buckets.map((b) => (
                <li key={b.key}>
                  <span className="hu-legend-dot" style={{ background: AGING_COLORS[b.key] }} />
                  <span className="hu-legend-label">{b.label}</span>
                  <span className="hu-legend-count">{b.anzahl}</span>
                  <span className="hu-legend-value">{formatEuro(b.wert)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Mietfach je Kunde: Tabelle ──────────────────────────────── */
function MietfachKundenTable({ meta, rows }) {
  return (
    <div className="card">
      <div className="card-header">
        <h3>
          <span className={`hu-inline-dot hu-inline-dot--${meta.modifier}`} />
          {meta.label} · Mietfächer nach Kunde
        </h3>
      </div>
      <div className="hu-table-wrap">
        {rows.length === 0 ? (
          <EmptyChart message="Keine ausgelagerten Stücke" />
        ) : (
          <table className="hu-table">
            <thead>
              <tr>
                <th>Kunde</th>
                <th className="hu-num">Stücke</th>
                <th className="hu-num">Gebundener Wert</th>
                <th className="hu-num">Ø Tage</th>
                <th className="hu-num">Ältestes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.kunde}>
                  <td>{r.kunde}</td>
                  <td className="hu-num">{r.anzahl}</td>
                  <td className="hu-num">{formatEuro(r.wert)}</td>
                  <td className="hu-num">{r.schnittTage}</td>
                  <td className="hu-num">
                    <span className={`badge ${agingSeverity(r.aeltestesTage)}`}>
                      {r.aeltestesTage} T
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ── Älteste Stücke im Mietfach ──────────────────────────────── */
function OldestList({ meta, rows }) {
  return (
    <div className="card">
      <div className="card-header">
        <h3>
          <span className={`hu-inline-dot hu-inline-dot--${meta.modifier}`} />
          {meta.label} · Ladenhüter
        </h3>
      </div>
      <div className="hu-oldest">
        {rows.length === 0 ? (
          <EmptyChart message="Keine ausgelagerten Stücke" />
        ) : (
          <ul>
            {rows.map((r) => (
              <li key={r.artikelnummer}>
                <span className={`badge ${agingSeverity(r.tage)}`}>{r.tage} T</span>
                <span className="hu-oldest-main">
                  <b>{r.artikelnummer}</b>
                  {r.name ? ` · ${r.name}` : ""}
                </span>
                <span className="hu-oldest-meta">
                  bei {r.kunde} · {QUELLE_LABEL[r.quelle] || r.quelle}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function HerstellerUebersicht() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revenueMode, setRevenueMode] = useState("all");
  const [jahr, setJahr] = useState(null); // null = alle Jahre

  useEffect(() => {
    let cancelled = false;
    api
      .getHerstellerUebersicht(jahr)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(false);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [jahr]);

  // Während eines Filterwechsels zeigt data noch den vorigen Zeitraum -> dimmen
  const busy = !loading && !!data && (data.jahr ?? null) !== jahr;

  const revenueTrend = useMemo(() => {
    if (!data) return [];
    const byMonth = new Map();
    for (const key of ["M", "S"]) {
      for (const row of data.hersteller[key].monatsumsatz) {
        if (!byMonth.has(row.monat)) byMonth.set(row.monat, { monat: row.monat, Marina: 0, Saskia: 0 });
        byMonth.get(row.monat)[key === "M" ? "Marina" : "Saskia"] = toNumber(row.umsatz);
      }
    }
    return [...byMonth.values()]
      .sort((a, b) => a.monat.localeCompare(b.monat))
      .map((m) => ({ ...m, Gesamt: m.Marina + m.Saskia }));
  }, [data]);

  if (loading)
    return (
      <div className="loading">
        <div className="spinner"></div>Lade Übersicht…
      </div>
    );
  if (error || !data)
    return <div className="loading">Fehler beim Laden der Hersteller-Übersicht.</div>;

  const anteil = data.vergleich.einnahmenAnteil;
  const median = data.vergleich.mietfachAlterMedianTage;
  const jahre = data.verfuegbareJahre || [];
  const zeitraumLabel = jahr ? `${jahr}` : "alle Jahre";
  const donutData = [
    { name: "Marina", value: data.hersteller.M.einnahmen.gesamt },
    { name: "Saskia", value: data.hersteller.S.einnahmen.gesamt },
  ];
  const showMarina = revenueMode !== "total";
  const showSaskia = revenueMode !== "total";
  const showTotal = revenueMode !== "manufacturers";

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Hersteller &amp; Mietfächer</h2>
          <p>
            Bestand, Einnahmen und Konsignations-Verweildauer – getrennt nach Marina und Saskia.
          </p>
        </div>
        <div className="hu-jahr-filter">
          <span className="hu-muted">Einnahmen-Zeitraum</span>
          <div className="hu-toggle">
            <button
              type="button"
              className={jahr === null ? "btn" : "btn-secondary"}
              onClick={() => setJahr(null)}
            >
              Alle Jahre
            </button>
            {jahre.map((y) => (
              <button
                key={y}
                type="button"
                className={jahr === y ? "btn" : "btn-secondary"}
                onClick={() => setJahr(y)}
              >
                {y}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={busy ? "hu-busy" : undefined}>
      {/* ── Hero: Split Marina | Anteil | Saskia ── */}
      <div className="hu-hero">
        <HerstellerHeroCard
          meta={HERSTELLER_META.M}
          h={data.hersteller.M}
          medianAlter={median.M}
          anteil={anteil.M}
        />
        <div className="hu-hero-donut">
          <div className="hu-hero-donut-title">Einnahmen-Anteil</div>
          {donutData.every((d) => d.value === 0) ? (
            <EmptyChart message="Noch keine Einnahmen" />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={donutData}
                  dataKey="value"
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={3}
                >
                  <Cell fill={HERSTELLER_META.M.color} />
                  <Cell fill={HERSTELLER_META.S.color} />
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => formatEuro(v)} />
              </PieChart>
            </ResponsiveContainer>
          )}
          <div className="hu-hero-donut-legend">
            <span>
              <span className="hu-legend-dot hu-inline-dot--marina" /> {Math.round(anteil.M * 100)} %
            </span>
            <span>
              <span className="hu-legend-dot hu-inline-dot--saskia" /> {Math.round(anteil.S * 100)} %
            </span>
          </div>
        </div>
        <HerstellerHeroCard
          meta={HERSTELLER_META.S}
          h={data.hersteller.S}
          medianAlter={median.S}
          anteil={anteil.S}
        />
      </div>

      {/* ── Mietfach-Aging ── */}
      <h3 className="hu-section-title">
        Verweildauer im Mietfach <span className="hu-muted">· aktueller Stand</span>
      </h3>
      <div className="responsive-grid-2 hu-mb">
        <AgingBar meta={HERSTELLER_META.M} buckets={data.hersteller.M.mietfach.buckets} />
        <AgingBar meta={HERSTELLER_META.S} buckets={data.hersteller.S.mietfach.buckets} />
      </div>

      <div className="responsive-grid-2 hu-mb">
        <MietfachKundenTable meta={HERSTELLER_META.M} rows={data.hersteller.M.mietfach.proKunde} />
        <MietfachKundenTable meta={HERSTELLER_META.S} rows={data.hersteller.S.mietfach.proKunde} />
      </div>

      <div className="responsive-grid-2 hu-mb">
        <OldestList meta={HERSTELLER_META.M} rows={data.hersteller.M.mietfach.aeltesteStuecke} />
        <OldestList meta={HERSTELLER_META.S} rows={data.hersteller.S.mietfach.aeltesteStuecke} />
      </div>

      {/* ── Einnahmen nach Hersteller ── */}
      <h3 className="hu-section-title">
        Einnahmen nach Hersteller <span className="hu-muted">· {zeitraumLabel}</span>
      </h3>
      <div className="card hu-mb">
        <div className="card-header">
          <h3>Monatlicher Umsatzverlauf</h3>
          <div className="hu-toggle">
            <button
              type="button"
              onClick={() => setRevenueMode("total")}
              className={revenueMode === "total" ? "btn" : "btn-secondary"}
            >
              Gesamt
            </button>
            <button
              type="button"
              onClick={() => setRevenueMode("manufacturers")}
              className={revenueMode === "manufacturers" ? "btn" : "btn-secondary"}
            >
              Hersteller
            </button>
            <button
              type="button"
              onClick={() => setRevenueMode("all")}
              className={revenueMode === "all" ? "btn" : "btn-secondary"}
            >
              Alle
            </button>
          </div>
        </div>
        <div className="chart-container">
          {revenueTrend.length === 0 ? (
            <EmptyChart message="Noch keine Umsatzdaten vorhanden" />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={revenueTrend} margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
                <defs>
                  <linearGradient id="huMarina" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={HERSTELLER_META.M.color} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={HERSTELLER_META.M.color} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="huSaskia" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={HERSTELLER_META.S.color} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={HERSTELLER_META.S.color} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="huGesamt" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#2e3240" />
                <XAxis dataKey="monat" tick={AXIS_TICK_STYLE} axisLine={false} tickLine={false} />
                <YAxis
                  tick={AXIS_TICK_STYLE}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `${v}€`}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v, name) => [formatEuro(v), name]}
                />
                <Legend wrapperStyle={{ fontSize: 13, color: "#9ca3b4" }} />
                {showMarina && (
                  <Area
                    type="monotone"
                    dataKey="Marina"
                    stroke={HERSTELLER_META.M.color}
                    strokeWidth={2}
                    fill="url(#huMarina)"
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                )}
                {showSaskia && (
                  <Area
                    type="monotone"
                    dataKey="Saskia"
                    stroke={HERSTELLER_META.S.color}
                    strokeWidth={2}
                    fill="url(#huSaskia)"
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                )}
                {showTotal && (
                  <Area
                    type="monotone"
                    dataKey="Gesamt"
                    stroke="#22c55e"
                    strokeWidth={2}
                    fill="url(#huGesamt)"
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── Einnahmen nach Kunde ── */}
      <div className="responsive-grid-2 hu-mb">
        {["M", "S"].map((key) => {
          const meta = HERSTELLER_META[key];
          const rows = data.hersteller[key].einnahmen.proKunde.map((r) => ({
            name: r.kunde,
            Umsatz: r.umsatz,
          }));
          return (
            <div className="card" key={key}>
              <div className="card-header">
                <h3>
                  <span className={`hu-inline-dot hu-inline-dot--${meta.modifier}`} />
                  {meta.label} · Einnahmen nach Kunde
                </h3>
              </div>
              <div className="chart-container">
                {rows.length === 0 ? (
                  <EmptyChart message="Noch keine Einnahmen" />
                ) : (
                  <ResponsiveContainer width="100%" height={Math.max(220, rows.length * 34)}>
                    <BarChart
                      data={rows}
                      layout="vertical"
                      margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#2e3240" horizontal={false} />
                      <XAxis
                        type="number"
                        tick={AXIS_TICK_STYLE}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => `${v}€`}
                      />
                      <YAxis
                        dataKey="name"
                        type="category"
                        width={110}
                        tick={AXIS_TICK_STYLE}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        cursor={{ fill: "rgba(99,102,241,0.1)" }}
                        formatter={(v) => [formatEuro(v), "Umsatz"]}
                      />
                      <Bar dataKey="Umsatz" fill={meta.color} radius={[0, 4, 4, 0]} maxBarSize={26} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}
