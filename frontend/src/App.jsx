import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import Schmuckstuecke from "./pages/Schmuckstuecke";
import Kunden from "./pages/Kunden";
import Lieferscheine from "./pages/Lieferscheine";
import Rechnungen from "./pages/Rechnungen";
import AuditLog from "./pages/AuditLog";
import Debug from "./pages/Debug";
import "./index.css";

function App() {
  return (
    <BrowserRouter>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <img
            src="/Logo transparent.png"
            alt="GoldRegen Logo"
            style={{
              maxWidth: "100%",
              height: "auto",
              backgroundColor: "white",
            }}
          />
        </div>
        <nav className="sidebar-nav">
          <NavLink
            to="/"
            end
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
          >
            <span className="nav-icon">📊</span>
            <span>Dashboard</span>
          </NavLink>
          <NavLink
            to="/schmuckstuecke"
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
          >
            <span className="nav-icon">💍</span>
            <span>Schmuckstücke</span>
          </NavLink>
          <NavLink
            to="/kunden"
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
          >
            <span className="nav-icon">👥</span>
            <span>Kunden</span>
          </NavLink>
          <NavLink
            to="/lieferscheine"
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
          >
            <span className="nav-icon">📦</span>
            <span>Lieferscheine</span>
          </NavLink>
          <NavLink
            to="/rechnungen"
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
          >
            <span className="nav-icon">🧾</span>
            <span>Rechnungen</span>
          </NavLink>
          <NavLink
            to="/audit-log"
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
          >
            <span className="nav-icon">📋</span>
            <span>Audit Log</span>
          </NavLink>
          <NavLink
            to="/debug"
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
          >
            <span className="nav-icon">🛠️</span>
            <span>Debug</span>
          </NavLink>
        </nav>
      </aside>

      <main className="main-content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/schmuckstuecke" element={<Schmuckstuecke />} />
          <Route path="/kunden" element={<Kunden />} />
          <Route path="/lieferscheine" element={<Lieferscheine />} />
          <Route path="/rechnungen" element={<Rechnungen />} />
          <Route path="/audit-log" element={<AuditLog />} />
          <Route path="/debug" element={<Debug />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}

export default App;
