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

  const piecesByArtChart = (data.piecesByArt || []).map((item) => ({
    name: item.Art,
    Stück: parseInt(item.count),
  }));

  const piecesByKundeChart = (data.piecesByKunde || []).map((item) => ({
    name: item.Name,
    Stück: parseInt(item.count),
  }));

  const statusData = data.statusDistribution || [];

  const trendData = (data.monthlyRevenueTrend || []).map((item) => ({
    monat: item.monat,
    Umsatz: item.umsatz,
    Stücke: item.stuecke,
  }));

  return (
    <div>
      {/* ── Stat Cards ── */}
      <div className="stats-grid">
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
                    formatter={(v, name) => [v, name]}
                  />
                  <Legend
                    iconType="circle"
                    wrapperStyle={{ fontSize: 13, color: "#9ca3b4" }}
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
                      id="umsatzGradient"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="5%"
                        stopColor={CHART_COLORS.gold}
                        stopOpacity={0.3}
                      />
                      <stop
                        offset="95%"
                        stopColor={CHART_COLORS.gold}
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
                      name === "Umsatz" ? `${(v ?? 0).toFixed(2)}€` : v,
                      name,
                    ]}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 13, color: "#9ca3b4" }}
                  />
                  <Area
                    type="monotone"
                    dataKey="Umsatz"
                    stroke={CHART_COLORS.gold}
                    strokeWidth={2}
                    fill="url(#umsatzGradient)"
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
