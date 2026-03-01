import { useState } from "react";
import { BrowserRouter, Routes, Route, NavLink, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Schmuckstuecke from "./pages/Schmuckstuecke";
import Kunden from "./pages/Kunden";
import Lieferscheine from "./pages/Lieferscheine";
import Rechnungen from "./pages/Rechnungen";
import AuditLog from "./pages/AuditLog";
import Debug from "./pages/Debug";
import "./index.css";

function AppLayout() {
  const { user, logout } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const toggleMobileMenu = () => setIsMobileMenuOpen(!isMobileMenuOpen);
  const closeMobileMenu = () => setIsMobileMenuOpen(false);

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  const isAdmin = user.role === "admin";

  return (
    <>
      {/* Mobile Top Header */}
      <header className="mobile-header">
        <div className="mobile-brand">
          <img
            src="/Logo transparent.png"
            alt="GoldRegen"
            className="mobile-logo"
          />
        </div>
        <button
          className="menu-toggle"
          onClick={toggleMobileMenu}
          aria-label="Menu"
        >
          {isMobileMenuOpen ? "✕" : "☰"}
        </button>
      </header>

      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div className="sidebar-overlay" onClick={closeMobileMenu}></div>
      )}

      <aside className={`sidebar ${isMobileMenuOpen ? "open" : ""}`}>
        <div className="sidebar-brand">
          <img
            src="/Logo transparent.png"
            alt="GoldRegen Logo"
            className="sidebar-logo"
          />
        </div>
        <nav className="sidebar-nav">
          <NavLink
            to="/"
            end
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
            onClick={closeMobileMenu}
          >
            <span className="nav-icon">📊</span>
            <span>Dashboard</span>
          </NavLink>
          <NavLink
            to="/schmuckstuecke"
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
            onClick={closeMobileMenu}
          >
            <span className="nav-icon">💍</span>
            <span>Schmuckstücke</span>
          </NavLink>
          <NavLink
            to="/kunden"
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
            onClick={closeMobileMenu}
          >
            <span className="nav-icon">👥</span>
            <span>Kunden</span>
          </NavLink>
          <NavLink
            to="/lieferscheine"
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
            onClick={closeMobileMenu}
          >
            <span className="nav-icon">📦</span>
            <span>Lieferscheine</span>
          </NavLink>
          <NavLink
            to="/rechnungen"
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
            onClick={closeMobileMenu}
          >
            <span className="nav-icon">🧾</span>
            <span>Rechnungen</span>
          </NavLink>
          {isAdmin && (
            <>
              <NavLink
                to="/audit-log"
                className={({ isActive }) =>
                  `nav-link ${isActive ? "active" : ""}`
                }
                onClick={closeMobileMenu}
              >
                <span className="nav-icon">📋</span>
                <span>Audit Log</span>
              </NavLink>
              <NavLink
                to="/debug"
                className={({ isActive }) =>
                  `nav-link ${isActive ? "active" : ""}`
                }
                onClick={closeMobileMenu}
              >
                <span className="nav-icon">🛠️</span>
                <span>Debug</span>
              </NavLink>
            </>
          )}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <span className="nav-icon">👤</span>
            <span className="sidebar-username">{user.username}</span>
            <span className={`role-badge role-${user.role}`}>{user.role}</span>
          </div>
          <button className="btn btn-secondary btn-sm logout-btn" onClick={logout} aria-label="Abmelden">
            Abmelden
          </button>
        </div>
      </aside>

      <main className="main-content">
        <Routes>
          <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/schmuckstuecke" element={<ProtectedRoute><Schmuckstuecke /></ProtectedRoute>} />
          <Route path="/kunden" element={<ProtectedRoute><Kunden /></ProtectedRoute>} />
          <Route path="/lieferscheine" element={<ProtectedRoute><Lieferscheine /></ProtectedRoute>} />
          <Route path="/rechnungen" element={<ProtectedRoute><Rechnungen /></ProtectedRoute>} />
          <Route path="/audit-log" element={<ProtectedRoute adminOnly><AuditLog /></ProtectedRoute>} />
          <Route path="/debug" element={<ProtectedRoute adminOnly><Debug /></ProtectedRoute>} />
          <Route path="/login" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppLayout />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
