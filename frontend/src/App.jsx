import { useCallback, useEffect, useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  NavLink,
  Navigate,
  useLocation,
} from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faChartBar,
  faGem,
  faUsers,
  faBox,
  faFileInvoice,
  faCreditCard,
  faClipboardList,
  faWrench,
  faUserLock,
  faDatabase,
  faUser,
  faTimes,
  faBars,
  faWarehouse,
  faKey,
  faSignOutAlt,
  faTruck,
  faAnglesLeft,
  faAnglesRight,
  faCodeBranch,
} from "@fortawesome/free-solid-svg-icons";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { authApi } from "./api";
import ProtectedRoute from "./components/ProtectedRoute";
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import Dashboard from "./pages/Dashboard";
import Schmuckstuecke from "./pages/Schmuckstuecke";
import Kunden from "./pages/Kunden";
import Lieferscheine from "./pages/Lieferscheine";
import Bestelluebersicht from "./pages/Bestelluebersicht";
import BestellungPublic from "./pages/BestellungPublic";
import Rechnungen from "./pages/Rechnungen";
import Sumup from "./pages/Sumup";
import AuditLog from "./pages/AuditLog";
import Debug from "./pages/Debug";
import Benutzerverwaltung from "./pages/Benutzerverwaltung";
import Datensicherung from "./pages/Datensicherung";
import Inventur from "./pages/Inventur";
import SchmuckstueckDetail from "./pages/SchmuckstueckDetail";
import "./index.css";

const COLLAPSE_KEY = "sidebarCollapsed";
const DRAWER_BREAKPOINT = 768;

// Von Vite zur Build-Zeit ersetzt (siehe vite.config.js). Fallback für Tests,
// in denen das define nicht greift.
const APP_VERSION =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";
// Nur der reine Tag (ohne "-<n>-g<hash>"-Suffix von `git describe`)
const APP_VERSION_TAG = APP_VERSION.split("-")[0];
const RELEASES_URL =
  "https://github.com/Revilo91/GoldRegenDB_Web/releases";

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

function AppLayout() {
  const { user, logout, mustChangePassword, clearMustChangePassword } =
    useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(readCollapsed);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPasswordField, setShowNewPasswordField] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");

  const toggleMobileMenu = () => setIsMobileMenuOpen(!isMobileMenuOpen);
  const closeMobileMenu = () => setIsMobileMenuOpen(false);

  const toggleSidebarCollapsed = useCallback(() => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // localStorage kann blockiert sein - die Ansicht funktioniert trotzdem
      }
      return next;
    });
  }, []);

  // Escape schliesst den mobilen Drawer; oberhalb des Breakpoints gibt es keinen
  useEffect(() => {
    if (!isMobileMenuOpen) return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape") setIsMobileMenuOpen(false);
    };
    const onResize = () => {
      if (window.innerWidth > DRAWER_BREAKPOINT) setIsMobileMenuOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
    };
  }, [isMobileMenuOpen]);

  const toggleUserMenu = () => setShowUserMenu(!showUserMenu);
  const closeUserMenu = () => setShowUserMenu(false);

  const openPasswordModal = () => {
    setShowPasswordModal(true);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setShowCurrentPassword(false);
    setShowNewPasswordField(false);
    setPasswordError("");
    setPasswordSuccess("");
    closeUserMenu();
    closeMobileMenu();
  };

  const closePasswordModal = () => {
    // Only allow closing when it's a voluntary change, not a forced one
    if (!mustChangePassword) {
      setShowPasswordModal(false);
    }
  };

  const handleChangePassword = async () => {
    setPasswordError("");
    setPasswordSuccess("");
    if (!currentPassword) {
      setPasswordError("Bitte aktuelles Passwort eingeben");
      return;
    }
    if (!newPassword) {
      setPasswordError("Bitte neues Passwort eingeben");
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError("Neues Passwort muss mindestens 8 Zeichen lang sein");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Neue Passwörter stimmen nicht überein");
      return;
    }
    try {
      await authApi.changePassword(currentPassword, newPassword);
      setPasswordSuccess("Passwort erfolgreich geändert");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      // If this was a forced password change, clear the flag and close modal
      if (mustChangePassword) {
        clearMustChangePassword();
        setShowPasswordModal(false);
      }
    } catch (err) {
      setPasswordError(err.message);
    }
  };

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  const isAdmin = user.role === "admin";
  const isBearbeiter = user.role === "admin" || user.role === "bearbeiter";

  const navLinks = [
    { to: "/", end: true, icon: faChartBar, label: "Dashboard", show: isBearbeiter },
    { to: "/schmuckstuecke", icon: faGem, label: "Schmuckst\u00fccke", show: true },
    { to: "/kunden", icon: faUsers, label: "Kunden", show: isBearbeiter },
    { to: "/lieferscheine", icon: faBox, label: "Lieferscheine", show: isBearbeiter },
    { to: "/rechnungen", icon: faFileInvoice, label: "Rechnungen", show: isBearbeiter },
    { to: "/bestelluebersicht", icon: faTruck, label: "Bestell\u00fcbersicht", show: isBearbeiter },
    { to: "/sumup", icon: faCreditCard, label: "SumUp", show: isBearbeiter },
    { to: "/inventur", icon: faWarehouse, label: "Inventur", show: isBearbeiter },
  ].filter((link) => link.show);

  const adminLinks = [
    { to: "/audit-log", icon: faClipboardList, label: "Audit Log" },
    { to: "/debug", icon: faWrench, label: "Debug" },
    { to: "/benutzerverwaltung", icon: faUserLock, label: "Benutzerverwaltung" },
    { to: "/datensicherung", icon: faDatabase, label: "Datensicherung" },
  ];

  const renderNavLink = ({ to, end, icon, label }, extraClass = "") => (
    <NavLink
      key={to}
      to={to}
      end={end}
      title={label}
      className={({ isActive }) =>
        `nav-link ${extraClass} ${isActive ? "active" : ""}`.replace(/\s+/g, " ").trim()
      }
      onClick={closeMobileMenu}
    >
      <span className="nav-link-icon">
        <FontAwesomeIcon icon={icon} />
      </span>
      <span className="nav-link-label">{label}</span>
    </NavLink>
  );

  // Determine if we need to show the forced password change modal
  const showForcedPasswordChange = mustChangePassword;
  const isPasswordModalVisible = showPasswordModal || showForcedPasswordChange;

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
          <FontAwesomeIcon icon={isMobileMenuOpen ? faTimes : faBars} />
        </button>
      </header>

      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div className="sidebar-overlay" onClick={closeMobileMenu}></div>
      )}

      <aside
        id="app-sidebar"
        className={`sidebar ${isSidebarCollapsed ? "collapsed" : ""} ${
          isMobileMenuOpen ? "open" : ""
        }`
          .replace(/\s+/g, " ")
          .trim()}
        aria-label="Hauptnavigation"
      >
        <div className="sidebar-brand">
          <img
            src="/Logo transparent.png"
            alt="GoldRegen Logo"
            className="sidebar-logo"
          />
        </div>
        <nav className="sidebar-nav">
          {navLinks.map((link) => renderNavLink(link))}
          {isAdmin && (
            <div className="nav-section-admin">
              <div className="nav-section nav-section-admin-title" title="Admin">
                <FontAwesomeIcon icon={faUserLock} />
                <span className="nav-link-label">Admin</span>
              </div>
              {adminLinks.map((link) => renderNavLink(link, "nav-link-admin"))}
            </div>
          )}
        </nav>
        <div className="sidebar-footer">
          <button
            className="btn btn-secondary btn-sm user-menu-btn"
            onClick={toggleUserMenu}
            aria-label="Benutzermen\u00fc"
            title={user.username}
          >
            <FontAwesomeIcon icon={faUser} />
            <span className="sidebar-username">{user.username}</span>
            <span className={`role-badge role-${user.role}`}>
              {user.role === "admin" ? "Admin" : user.role === "bearbeiter" ? "Bearbeiter" : "Benutzer"}
            </span>
          </button>
          <button
            type="button"
            className="sidebar-collapse-toggle"
            aria-label={
              isSidebarCollapsed
                ? "Seitenleiste ausklappen"
                : "Seitenleiste einklappen"
            }
            aria-pressed={isSidebarCollapsed}
            aria-controls="app-sidebar"
            onClick={toggleSidebarCollapsed}
          >
            <FontAwesomeIcon
              icon={isSidebarCollapsed ? faAnglesRight : faAnglesLeft}
            />
            <span className="nav-link-label">Einklappen</span>
          </button>
          <a
            className="sidebar-version"
            href={RELEASES_URL}
            target="_blank"
            rel="noopener noreferrer"
            title={`Version ${APP_VERSION} – Release-Notes öffnen`}
          >
            <FontAwesomeIcon icon={faCodeBranch} />
            <span className="nav-link-label">{APP_VERSION_TAG}</span>
          </a>
        </div>
      </aside>

      {/* User Menu Modal */}
      {showUserMenu && (
        <div className="modal-overlay">
          <div className="modal user-menu-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                <FontAwesomeIcon icon={faUser} /> Benutzerkonto
              </h3>
              <button
                className="btn btn-secondary btn-sm"
                onClick={closeUserMenu}
              >
                <FontAwesomeIcon icon={faTimes} />
              </button>
            </div>
            <div className="modal-body">
              <div className="user-info">
                <div className="user-info-row">
                  <strong>Benutzername:</strong>
                  <span>{user.username}</span>
                </div>
                <div className="user-info-row">
                  <strong>Rolle:</strong>
                  <span className={`role-badge role-${user.role}`}>
                    {user.role === "admin" ? "Admin" : user.role === "bearbeiter" ? "Bearbeiter" : "Benutzer"}
                  </span>
                </div>
                {user.email && (
                  <div className="user-info-row">
                    <strong>E-Mail:</strong>
                    <span>{user.email}</span>
                  </div>
                )}
              </div>
              <div className="user-menu-actions">
                <button
                  className="btn btn-primary btn-block"
                  onClick={openPasswordModal}
                >
                  <FontAwesomeIcon icon={faKey} /> Passwort ändern
                </button>
                <button
                  className="btn btn-danger btn-block"
                  onClick={() => {
                    closeUserMenu();
                    logout();
                  }}
                >
                  <FontAwesomeIcon icon={faSignOutAlt} /> Abmelden
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isPasswordModalVisible && (
        <div className="modal-overlay">
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                <FontAwesomeIcon icon={faKey} />{" "}
                {showForcedPasswordChange
                  ? "Passwort muss geändert werden"
                  : "Passwort ändern"}
              </h3>
              {!showForcedPasswordChange && (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={closePasswordModal}
                >
                  <FontAwesomeIcon icon={faTimes} />
                </button>
              )}
            </div>
            <div className="modal-body">
              {showForcedPasswordChange && (
                <div
                  style={{
                    padding: "10px 14px",
                    marginBottom: 16,
                    background: "rgba(245,158,11,0.1)",
                    color: "#f59e0b",
                    borderRadius: "var(--radius-sm)",
                    fontSize: 14,
                  }}
                >
                  Bitte ändern Sie Ihr Passwort, bevor Sie fortfahren können.
                  Geben Sie Ihr aktuelles Einmalpasswort und ein neues Passwort
                  ein.
                </div>
              )}
              {passwordError && (
                <div
                  style={{
                    padding: "10px 14px",
                    marginBottom: 16,
                    background: "var(--danger-bg)",
                    color: "var(--danger)",
                    borderRadius: "var(--radius-sm)",
                    fontSize: 14,
                  }}
                >
                  {passwordError}
                </div>
              )}
              {passwordSuccess && (
                <div
                  style={{
                    padding: "10px 14px",
                    marginBottom: 16,
                    background: "var(--success-bg, rgba(16,185,129,0.1))",
                    color: "var(--success, #10b981)",
                    borderRadius: "var(--radius-sm)",
                    fontSize: 14,
                  }}
                >
                  {passwordSuccess}
                </div>
              )}
              <div style={{ display: "grid", gap: 16 }}>
                <div className="form-group">
                  <label className="form-label">Aktuelles Passwort *</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      type={showCurrentPassword ? "text" : "password"}
                      className="form-control"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="Aktuelles Passwort eingeben"
                    />
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() =>
                        setShowCurrentPassword(!showCurrentPassword)
                      }
                      style={{ padding: "6px 12px", minWidth: 40 }}
                    >
                      {showCurrentPassword ? "🙈" : "👁️"}
                    </button>
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Neues Passwort *</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      type={showNewPasswordField ? "text" : "password"}
                      className="form-control"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Mindestens 8 Zeichen"
                    />
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() =>
                        setShowNewPasswordField(!showNewPasswordField)
                      }
                      style={{ padding: "6px 12px", minWidth: 40 }}
                    >
                      {showNewPasswordField ? "🙈" : "👁️"}
                    </button>
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">
                    Neues Passwort bestätigen *
                  </label>
                  <input
                    type={showNewPasswordField ? "text" : "password"}
                    className="form-control"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Neues Passwort wiederholen"
                  />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              {!showForcedPasswordChange && (
                <button
                  className="btn btn-secondary"
                  onClick={closePasswordModal}
                >
                  Abbrechen
                </button>
              )}
              <button
                className="btn btn-primary"
                onClick={handleChangePassword}
                disabled={!currentPassword || !newPassword || !confirmPassword}
              >
                Passwort ändern
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="main-content">
        <Routes>
          <Route
            path="/"
            element={
              isBearbeiter ? (
                <ProtectedRoute bearbeiterOnly>
                  <Dashboard />
                </ProtectedRoute>
              ) : (
                <Navigate to="/schmuckstuecke" replace />
              )
            }
          />
          <Route
            path="/schmuckstuecke"
            element={
              <ProtectedRoute>
                <Schmuckstuecke />
              </ProtectedRoute>
            }
          />
          <Route
            path="/schmuckstuecke/:artikelnummer"
            element={
              <ProtectedRoute>
                <SchmuckstueckDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/kunden"
            element={
              <ProtectedRoute bearbeiterOnly>
                <Kunden />
              </ProtectedRoute>
            }
          />
          <Route
            path="/lieferscheine"
            element={
              <ProtectedRoute bearbeiterOnly>
                <Lieferscheine />
              </ProtectedRoute>
            }
          />
          <Route
            path="/rechnungen"
            element={
              <ProtectedRoute bearbeiterOnly>
                <Rechnungen />
              </ProtectedRoute>
            }
          />
          <Route
            path="/bestelluebersicht"
            element={
              <ProtectedRoute bearbeiterOnly>
                <Bestelluebersicht />
              </ProtectedRoute>
            }
          />
          <Route
            path="/sumup"
            element={
              <ProtectedRoute bearbeiterOnly>
                <Sumup />
              </ProtectedRoute>
            }
          />
          <Route
            path="/inventur"
            element={
              <ProtectedRoute bearbeiterOnly>
                <Inventur />
              </ProtectedRoute>
            }
          />
          <Route
            path="/audit-log"
            element={
              <ProtectedRoute adminOnly>
                <AuditLog />
              </ProtectedRoute>
            }
          />
          <Route
            path="/debug"
            element={
              <ProtectedRoute adminOnly>
                <Debug />
              </ProtectedRoute>
            }
          />
          <Route
            path="/benutzerverwaltung"
            element={
              <ProtectedRoute adminOnly>
                <Benutzerverwaltung />
              </ProtectedRoute>
            }
          />
          <Route
            path="/datensicherung"
            element={
              <ProtectedRoute adminOnly>
                <Datensicherung />
              </ProtectedRoute>
            }
          />
          <Route path="/login" element={<Navigate to={isBearbeiter ? "/" : "/schmuckstuecke"} replace />} />
        </Routes>
      </main>
    </>
  );
}

// Öffentliches Bestellformular ist bewusst außerhalb des Login-Gates von AppLayout verdrahtet,
// damit es unabhängig vom Auth-Status (eingeloggt oder nicht) erreichbar bleibt.
function AppRoot() {
  const location = useLocation();
  if (location.pathname.toLowerCase() === "/bestellung") {
    return <BestellungPublic />;
  }
  return <AppLayout />;
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoot />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
