import { useState, useEffect } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faGem,
  faWarehouse,
  faBox,
  faCheckCircle,
  faTimesCircle,
  faEuroSign,
  faUsers,
} from "@fortawesome/free-solid-svg-icons";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  AreaChart,
  Area,
} from "recharts";
import { api } from "../api";

const CHART_COLORS = {
  accent: "#6366f1",
  success: "#10b981",
  warning: "#f59e0b",
  danger: "#ef4444",
  info: "#3b82f6",
  gold: "#d4a853",
};

const STATUS_COLORS = [
  CHART_COLORS.info,
  CHART_COLORS.warning,
  CHART_COLORS.success,
  CHART_COLORS.danger,
];

const TOOLTIP_STYLE = {
  backgroundColor: "#21242f",
  border: "1px solid #2e3240",
  borderRadius: "8px",
  color: "#e8eaf0",
};

const AXIS_TICK_STYLE = { fill: "#9ca3b4", fontSize: 12 };

function formatPercentage(value) {
  return `${value.toFixed(1)}%`;
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function EmptyChart({ message }) {
  return (
    <div className="chart-empty">
      <p>{message}</p>
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revenueSeriesMode, setRevenueSeriesMode] = useState("all");

  useEffect(() => {
    api
      .getDashboard()
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  if (loading)
    return (
      <div className="loading">
        <div className="spinner"></div>Lade Dashboard...
      </div>
    );
  if (error || !data)
    return (
      <div className="loading">Fehler beim Laden der Dashboard-Daten.</div>
    );

  const s = data.statistics;

  const mStats = data.manufacturerStats?.M || {
    total: 0,
    verkauft: 0,
    ausgelagert: 0,
    verfuegbar: 0,
    ausschuss: 0,
    umsatz: 0,
  };
  const sStats = data.manufacturerStats?.S || {
    total: 0,
    verkauft: 0,
    ausgelagert: 0,
    verfuegbar: 0,
    ausschuss: 0,
    umsatz: 0,
  };

  const piecesByArtChart = (data.piecesByArt || []).map((item) => ({
    name: item.Art,
    Stück: parseInt(item.count),
  }));

  const piecesByKundeChart = (data.piecesByKunde || []).map((item) => ({
    name: item.Name,
    Stück: parseInt(item.count),
  }));

  const rawStatusData = data.statusDistribution || [];
  const totalStatusValue = rawStatusData.reduce(
    (sum, item) => sum + toNumber(item.value),
    0
  );
  const statusData = rawStatusData.map((item) => {
    const value = toNumber(item.value);
    const percentage =
      totalStatusValue > 0
        ? Number(((value / totalStatusValue) * 100).toFixed(1))
        : 0;

    return {
      ...item,
      value,
      percentage,
    };
  });

  const manufacturerComparisonData = [
    {
      name: "Marina",
      Gesamt: mStats.total,
      Verfügbar: mStats.verfuegbar,
      Ausgelagert: mStats.ausgelagert,
      Verkauft: mStats.verkauft,
      Ausschuss: mStats.ausschuss,
    },
    {
      name: "Saskia",
      Gesamt: sStats.total,
      Verfügbar: sStats.verfuegbar,
      Ausgelagert: sStats.ausgelagert,
      Verkauft: sStats.verkauft,
      Ausschuss: sStats.ausschuss,
    },
  ];

  // Group manufacturer by kunde data
  const mByKunde = (data.manufacturerByKunde || [])
    .filter((item) => item.hersteller === "M")
    .map((item) => ({ name: item.kunde, Stück: item.anzahl }));

  const sByKunde = (data.manufacturerByKunde || [])
    .filter((item) => item.hersteller === "S")
    .map((item) => ({ name: item.kunde, Stück: item.anzahl }));

  const trendData = (data.monthlyRevenueTrend || []).map((item) => ({
    monat: item.monat,
    Marina: toNumber(item.marinaUmsatz),
    Saskia: toNumber(item.saskiaUmsatz),
    Gesamt: toNumber(item.marinaUmsatz) + toNumber(item.saskiaUmsatz),
  }));

  const showMarinaSeries =
    revenueSeriesMode === "all" || revenueSeriesMode === "manufacturers";
  const showSaskiaSeries =
    revenueSeriesMode === "all" || revenueSeriesMode === "manufacturers";
  const showTotalSeries =
    revenueSeriesMode === "all" || revenueSeriesMode === "total";

  return (
    <div>
      {/* ── Stat Cards ── */}
      <div className="stats-grid dashboard-stats-grid">
        <div className="stat-card gold">
          <div className="stat-icon">
            <FontAwesomeIcon icon={faGem} />
          </div>
          <div className="stat-value">{s.totalPieces}</div>
          <div className="stat-label">Gesamt Stücke</div>
        </div>
        <div className="stat-card info">
          <div className="stat-icon">
            <FontAwesomeIcon icon={faWarehouse} />
          </div>
          <div className="stat-value">{s.inStockPieces}</div>
          <div className="stat-label">Im Lager</div>
        </div>
        <div className="stat-card warning">
          <div className="stat-icon">
            <FontAwesomeIcon icon={faBox} />
          </div>
          <div className="stat-value">{s.outsourcedPieces}</div>
          <div className="stat-label">Ausgelagert</div>
        </div>
        <div className="stat-card success">
          <div className="stat-icon">
            <FontAwesomeIcon icon={faCheckCircle} />
          </div>
          <div className="stat-value">{s.soldPieces}</div>
          <div className="stat-label">Verkauft</div>
        </div>
        <div className="stat-card danger">
          <div className="stat-icon">
            <FontAwesomeIcon icon={faTimesCircle} />
          </div>
          <div className="stat-value">{s.rejectPieces}</div>
          <div className="stat-label">Ausschuss</div>
        </div>
        <div className="stat-card gold">
          <div className="stat-icon">
            <FontAwesomeIcon icon={faEuroSign} />
          </div>
          <div className="stat-value">{s.totalRevenue.toFixed(0)}€</div>
          <div className="stat-label">Umsatz (verkauft)</div>
        </div>
        <div className="stat-card info">
          <div className="stat-icon">
            <FontAwesomeIcon icon={faUsers} />
          </div>
          <div className="stat-value">
            {s.activeCustomers}/{s.totalCustomers}
          </div>
          <div className="stat-label">Aktive Kunden</div>
        </div>
      </div>

      {/* ── Manufacturer Stats Grid ── */}
      <div style={{ marginBottom: 24 }}>
        <h2
          style={{
            fontSize: "1.5rem",
            fontWeight: 600,
            marginBottom: 16,
            color: "#e8eaf0",
          }}
        >
          Statistiken nach Hersteller
        </h2>
        <div className="responsive-grid-2">
          {/* Marina */}
          <div className="card">
            <div
              className="card-header"
              style={{ borderBottom: "2px solid #6366f1" }}
            >
              <h3 style={{ color: "#6366f1" }}>Marina (M)</h3>
            </div>
            <div style={{ padding: 16 }}>
              <div className="stats-grid" style={{ marginBottom: 0 }}>
                <div className="stat-card info" style={{ minHeight: "auto" }}>
                  <div className="stat-value" style={{ fontSize: "1.5rem" }}>
                    {mStats.total}
                  </div>
                  <div className="stat-label" style={{ fontSize: "0.75rem" }}>
                    Gesamt
                  </div>
                </div>
                <div
                  className="stat-card success"
                  style={{ minHeight: "auto" }}
                >
                  <div className="stat-value" style={{ fontSize: "1.5rem" }}>
                    {mStats.verfuegbar}
                  </div>
                  <div className="stat-label" style={{ fontSize: "0.75rem" }}>
                    Verfügbar
                  </div>
                </div>
                <div
                  className="stat-card warning"
                  style={{ minHeight: "auto" }}
                >
                  <div className="stat-value" style={{ fontSize: "1.5rem" }}>
                    {mStats.ausgelagert}
                  </div>
                  <div className="stat-label" style={{ fontSize: "0.75rem" }}>
                    Ausgelagert
                  </div>
                </div>
                <div className="stat-card gold" style={{ minHeight: "auto" }}>
                  <div className="stat-value" style={{ fontSize: "1.5rem" }}>
                    {mStats.verkauft}
                  </div>
                  <div className="stat-label" style={{ fontSize: "0.75rem" }}>
                    Verkauft
                  </div>
                </div>
              </div>
              <div
                style={{
                  marginTop: 12,
                  paddingTop: 12,
                  borderTop: "1px solid #2e3240",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "0.9rem",
                    color: "#9ca3b4",
                  }}
                >
                  <span>Umsatz:</span>
                  <span style={{ fontWeight: 600, color: "#d4a853" }}>
                    {mStats.umsatz.toFixed(2)}€
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Saskia */}
          <div className="card">
            <div
              className="card-header"
              style={{ borderBottom: "2px solid #ec4899" }}
            >
              <h3 style={{ color: "#ec4899" }}>Saskia (S)</h3>
            </div>
            <div style={{ padding: 16 }}>
              <div className="stats-grid" style={{ marginBottom: 0 }}>
                <div className="stat-card info" style={{ minHeight: "auto" }}>
                  <div className="stat-value" style={{ fontSize: "1.5rem" }}>
                    {sStats.total}
                  </div>
                  <div className="stat-label" style={{ fontSize: "0.75rem" }}>
                    Gesamt
                  </div>
                </div>
                <div
                  className="stat-card success"
                  style={{ minHeight: "auto" }}
                >
                  <div className="stat-value" style={{ fontSize: "1.5rem" }}>
                    {sStats.verfuegbar}
                  </div>
                  <div className="stat-label" style={{ fontSize: "0.75rem" }}>
                    Verfügbar
                  </div>
                </div>
                <div
                  className="stat-card warning"
                  style={{ minHeight: "auto" }}
                >
                  <div className="stat-value" style={{ fontSize: "1.5rem" }}>
                    {sStats.ausgelagert}
                  </div>
                  <div className="stat-label" style={{ fontSize: "0.75rem" }}>
                    Ausgelagert
                  </div>
                </div>
                <div className="stat-card gold" style={{ minHeight: "auto" }}>
                  <div className="stat-value" style={{ fontSize: "1.5rem" }}>
                    {sStats.verkauft}
                  </div>
                  <div className="stat-label" style={{ fontSize: "0.75rem" }}>
                    Verkauft
                  </div>
                </div>
              </div>
              <div
                style={{
                  marginTop: 12,
                  paddingTop: 12,
                  borderTop: "1px solid #2e3240",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "0.9rem",
                    color: "#9ca3b4",
                  }}
                >
                  <span>Umsatz:</span>
                  <span style={{ fontWeight: 600, color: "#d4a853" }}>
                    {sStats.umsatz.toFixed(2)}€
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Manufacturer Comparison Chart ── */}
      <div style={{ marginBottom: 24 }}>
        <div className="card">
          <div className="card-header">
            <h3>Hersteller-Vergleich</h3>
          </div>
          <div className="chart-container">
            {manufacturerComparisonData.every((d) =>
              Object.values(d).every((v) => typeof v === "string" || v === 0)
            ) ? (
              <EmptyChart message="Keine Hersteller-Daten vorhanden" />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  data={manufacturerComparisonData}
                  margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#2e3240" />
                  <XAxis
                    dataKey="name"
                    tick={AXIS_TICK_STYLE}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={AXIS_TICK_STYLE}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    cursor={{ fill: "rgba(99,102,241,0.1)" }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 13, color: "#9ca3b4" }}
                  />
                  <Bar
                    dataKey="Verfügbar"
                    fill={CHART_COLORS.success}
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="Ausgelagert"
                    fill={CHART_COLORS.warning}
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="Verkauft"
                    fill={CHART_COLORS.gold}
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="Ausschuss"
                    fill={CHART_COLORS.danger}
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* ── Manufacturer Outsourced by Customer ── */}
      <div style={{ marginBottom: 24 }}>
        <h3
          style={{
            fontSize: "1.25rem",
            fontWeight: 600,
            marginBottom: 16,
            color: "#e8eaf0",
          }}
        >
          Ausgelagerte Stücke nach Hersteller & Kunde
        </h3>
        <div className="responsive-grid-2">
          <div className="card">
            <div className="card-header">
              <h3 style={{ color: "#6366f1" }}>Marina bei Kunden</h3>
            </div>
            <div className="chart-container">
              {mByKunde.length === 0 ? (
                <EmptyChart message="Keine ausgelagerten Stücke von Marina" />
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart
                    data={mByKunde}
                    layout="vertical"
                    margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#2e3240"
                      horizontal={false}
                    />
                    <XAxis
                      type="number"
                      tick={AXIS_TICK_STYLE}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      dataKey="name"
                      type="category"
                      width={90}
                      tick={AXIS_TICK_STYLE}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      cursor={{ fill: "rgba(99,102,241,0.1)" }}
                      formatter={(v) => [v, "Stücke"]}
                    />
                    <Bar
                      dataKey="Stück"
                      fill="#6366f1"
                      radius={[0, 4, 4, 0]}
                      maxBarSize={24}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3 style={{ color: "#ec4899" }}>Saskia bei Kunden</h3>
            </div>
            <div className="chart-container">
              {sByKunde.length === 0 ? (
                <EmptyChart message="Keine ausgelagerten Stücke von Saskia" />
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart
                    data={sByKunde}
                    layout="vertical"
                    margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#2e3240"
                      horizontal={false}
                    />
                    <XAxis
                      type="number"
                      tick={AXIS_TICK_STYLE}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      dataKey="name"
                      type="category"
                      width={90}
                      tick={AXIS_TICK_STYLE}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      cursor={{ fill: "rgba(99,102,241,0.1)" }}
                      formatter={(v) => [v, "Stücke"]}
                    />
                    <Bar
                      dataKey="Stück"
                      fill="#ec4899"
                      radius={[0, 4, 4, 0]}
                      maxBarSize={24}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Row 1: BarChart Art + PieChart Status ── */}
      <div className="responsive-grid-2" style={{ marginBottom: 24 }}>
        <div className="card">
          <div className="card-header">
            <h3>Stücke nach Art</h3>
          </div>
          <div className="chart-container">
            {piecesByArtChart.length === 0 ? (
              <EmptyChart message="Keine Daten vorhanden" />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={piecesByArtChart}
                  layout="vertical"
                  margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#2e3240"
                    horizontal={false}
                  />
                  <XAxis
                    type="number"
                    tick={AXIS_TICK_STYLE}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    dataKey="name"
                    type="category"
                    width={90}
                    tick={AXIS_TICK_STYLE}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    cursor={{ fill: "rgba(99,102,241,0.1)" }}
                    formatter={(v) => [v, "Stücke"]}
                  />
                  <Bar
                    dataKey="Stück"
                    fill={CHART_COLORS.accent}
                    radius={[0, 4, 4, 0]}
                    maxBarSize={24}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>Statusverteilung</h3>
          </div>
          <div className="chart-container">
            {statusData.every((d) => d.value === 0) ? (
              <EmptyChart message="Keine Daten vorhanden" />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={statusData}
                    cx="50%"
                    cy="45%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={3}
                    dataKey="value"
                    label={({ payload }) => formatPercentage(payload.percentage || 0)}
                    labelLine={false}
                  >
                    {statusData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={STATUS_COLORS[index % STATUS_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(value, name, item) => [
                      `${value} (${formatPercentage(item.payload.percentage || 0)})`,
                      name,
                    ]}
                  />
                  <Legend
                    iconType="circle"
                    wrapperStyle={{ fontSize: 13, color: "#9ca3b4" }}
                    formatter={(value, entry) =>
                      `${value} (${formatPercentage(
                        entry.payload.percentage || 0
                      )})`
                    }
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* ── Row 2: BarChart Kunden + AreaChart Umsatztrend ── */}
      <div className="responsive-grid-2">
        <div className="card">
          <div className="card-header">
            <h3>Stücke bei Kunden</h3>
          </div>
          <div className="chart-container">
            {piecesByKundeChart.length === 0 ? (
              <EmptyChart message="Keine ausgelagerten Stücke" />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={piecesByKundeChart}
                  layout="vertical"
                  margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#2e3240"
                    horizontal={false}
                  />
                  <XAxis
                    type="number"
                    tick={AXIS_TICK_STYLE}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    dataKey="name"
                    type="category"
                    width={90}
                    tick={AXIS_TICK_STYLE}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    cursor={{ fill: "rgba(99,102,241,0.1)" }}
                    formatter={(v) => [v, "Stücke"]}
                  />
                  <Bar
                    dataKey="Stück"
                    fill={CHART_COLORS.warning}
                    radius={[0, 4, 4, 0]}
                    maxBarSize={24}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>Monatlicher Umsatztrend</h3>
            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                onClick={() => setRevenueSeriesMode("total")}
                className={revenueSeriesMode === "total" ? "btn" : "btn-secondary"}
                style={{ padding: "6px 10px", fontSize: "0.8rem" }}
              >
                Gesamt
              </button>
              <button
                type="button"
                onClick={() => setRevenueSeriesMode("manufacturers")}
                className={
                  revenueSeriesMode === "manufacturers" ? "btn" : "btn-secondary"
                }
                style={{ padding: "6px 10px", fontSize: "0.8rem" }}
              >
                Hersteller
              </button>
              <button
                type="button"
                onClick={() => setRevenueSeriesMode("all")}
                className={revenueSeriesMode === "all" ? "btn" : "btn-secondary"}
                style={{ padding: "6px 10px", fontSize: "0.8rem" }}
              >
                Alle
              </button>
            </div>
          </div>
          <div className="chart-container">
            {trendData.length === 0 ? (
              <EmptyChart message="Noch keine Umsatzdaten vorhanden" />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart
                  data={trendData}
                  margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
                >
                  <defs>
                    <linearGradient
                      id="marinaRevenueGradient"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="5%"
                        stopColor={CHART_COLORS.accent}
                        stopOpacity={0.3}
                      />
                      <stop
                        offset="95%"
                        stopColor={CHART_COLORS.accent}
                        stopOpacity={0}
                      />
                    </linearGradient>
                    <linearGradient
                      id="saskiaRevenueGradient"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="5%"
                        stopColor="#ec4899"
                        stopOpacity={0.25}
                      />
                      <stop
                        offset="95%"
                        stopColor="#ec4899"
                        stopOpacity={0}
                      />
                    </linearGradient>
                    <linearGradient
                      id="totalRevenueGradient"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="5%"
                        stopColor="#22c55e"
                        stopOpacity={0.2}
                      />
                      <stop
                        offset="95%"
                        stopColor="#22c55e"
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2e3240" />
                  <XAxis
                    dataKey="monat"
                    tick={AXIS_TICK_STYLE}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={AXIS_TICK_STYLE}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `${v}€`}
                  />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(v, name) => [
                      `${toNumber(v).toFixed(2)}€`,
                      name,
                    ]}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 13, color: "#9ca3b4" }}
                  />
                  {showMarinaSeries && (
                    <Area
                      type="monotone"
                      dataKey="Marina"
                      stroke={CHART_COLORS.accent}
                      strokeWidth={2}
                      fill="url(#marinaRevenueGradient)"
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  )}
                  {showSaskiaSeries && (
                    <Area
                      type="monotone"
                      dataKey="Saskia"
                      stroke="#ec4899"
                      strokeWidth={2}
                      fill="url(#saskiaRevenueGradient)"
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  )}
                  {showTotalSeries && (
                    <Area
                      type="monotone"
                      dataKey="Gesamt"
                      stroke="#22c55e"
                      strokeWidth={2}
                      fill="url(#totalRevenueGradient)"
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
