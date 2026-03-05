import { useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  NavLink,
  Navigate,
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
} from "@fortawesome/free-solid-svg-icons";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { authApi } from "./api";
import ProtectedRoute from "./components/ProtectedRoute";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Schmuckstuecke from "./pages/Schmuckstuecke";
import Kunden from "./pages/Kunden";
import Lieferscheine from "./pages/Lieferscheine";
import Rechnungen from "./pages/Rechnungen";
import Sumup from "./pages/Sumup";
import AuditLog from "./pages/AuditLog";
import Debug from "./pages/Debug";
import Benutzerverwaltung from "./pages/Benutzerverwaltung";
import Datensicherung from "./pages/Datensicherung";
import Inventur from "./pages/Inventur";
import "./index.css";

function AppLayout() {
  const { user, logout } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
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

  const openPasswordModal = () => {
    setShowPasswordModal(true);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setShowCurrentPassword(false);
    setShowNewPasswordField(false);
    setPasswordError("");
    setPasswordSuccess("");
    closeMobileMenu();
  };

  const closePasswordModal = () => {
    setShowPasswordModal(false);
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
    } catch (err) {
      setPasswordError(err.message);
    }
  };

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
          aria-label="Menu">
          <FontAwesomeIcon icon={isMobileMenuOpen ? faTimes : faBars} />
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
            onClick={closeMobileMenu}>
            <span className="nav-icon"><FontAwesomeIcon icon={faChartBar} /></span>
            <span>Dashboard</span>
          </NavLink>
          <NavLink
            to="/schmuckstuecke"
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
            onClick={closeMobileMenu}>
            <span className="nav-icon"><FontAwesomeIcon icon={faGem} /></span>
            <span>Schmuckstücke</span>
          </NavLink>
          <NavLink
            to="/kunden"
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
            onClick={closeMobileMenu}>
            <span className="nav-icon"><FontAwesomeIcon icon={faUsers} /></span>
            <span>Kunden</span>
          </NavLink>
          <NavLink
            to="/lieferscheine"
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
            onClick={closeMobileMenu}>
            <span className="nav-icon"><FontAwesomeIcon icon={faBox} /></span>
            <span>Lieferscheine</span>
          </NavLink>
          <NavLink
            to="/rechnungen"
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
            onClick={closeMobileMenu}>
            <span className="nav-icon"><FontAwesomeIcon icon={faFileInvoice} /></span>
            <span>Rechnungen</span>
          </NavLink>
          <NavLink
            to="/sumup"
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
            onClick={closeMobileMenu}>
            <span className="nav-icon"><FontAwesomeIcon icon={faCreditCard} /></span>
            <span>SumUp</span>
          </NavLink>
          <NavLink
            to="/inventur"
            className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
            onClick={closeMobileMenu}>
            <span className="nav-icon"><FontAwesomeIcon icon={faWarehouse} /></span>
            <span>Inventur</span>
          </NavLink>
          {isAdmin && (
            <>
            <div className="nav-section">Admin</div>
              <NavLink
                to="/audit-log"
                className={({ isActive }) =>
                  `nav-link ${isActive ? "active" : ""}`
                }
                onClick={closeMobileMenu}>
                <span className="nav-icon"><FontAwesomeIcon icon={faClipboardList} /></span>
                <span>Audit Log</span>
              </NavLink>
              <NavLink
                to="/debug"
                className={({ isActive }) =>
                  `nav-link ${isActive ? "active" : ""}`
                }
                onClick={closeMobileMenu}>
                <span className="nav-icon"><FontAwesomeIcon icon={faWrench} /></span>
                <span>Debug</span>
              </NavLink>
              <NavLink
                to="/benutzerverwaltung"
                className={({ isActive }) =>
                  `nav-link ${isActive ? "active" : ""}`
                }
                onClick={closeMobileMenu}>
                <span className="nav-icon"><FontAwesomeIcon icon={faUserLock} /></span>
                <span>Benutzerverwaltung</span>
              </NavLink>
              <NavLink
                to="/datensicherung"
                className={({ isActive }) =>
                  `nav-link ${isActive ? "active" : ""}`
                }
                onClick={closeMobileMenu}>
                <span className="nav-icon"><FontAwesomeIcon icon={faDatabase} /></span>
                <span>Datensicherung</span>
              </NavLink>
            </>
          )}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <span className="nav-icon"><FontAwesomeIcon icon={faUser} /></span>
            <span className="sidebar-username">{user.username}</span>
            <span className={`role-badge role-${user.role}`}>{user.role}</span>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            onClick={openPasswordModal}
            aria-label="Passwort ändern">
            <FontAwesomeIcon icon={faKey} /> Passwort ändern
          </button>
          <button
            className="btn btn-secondary btn-sm logout-btn"
            onClick={logout}
            aria-label="Abmelden">
            Abmelden
          </button>
        </div>
      </aside>

      {showPasswordModal && (
        <div className="modal-overlay" onClick={closePasswordModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3><FontAwesomeIcon icon={faKey} /> Passwort ändern</h3>
              <button className="btn btn-secondary btn-sm" onClick={closePasswordModal}>
                <FontAwesomeIcon icon={faTimes} />
              </button>
            </div>
            <div className="modal-body">
              {passwordError && (
                <div style={{ padding: "10px 14px", marginBottom: 16, background: "var(--danger-bg)", color: "var(--danger)", borderRadius: "var(--radius-sm)", fontSize: 14 }}>
                  {passwordError}
                </div>
              )}
              {passwordSuccess && (
                <div style={{ padding: "10px 14px", marginBottom: 16, background: "var(--success-bg, rgba(16,185,129,0.1))", color: "var(--success, #10b981)", borderRadius: "var(--radius-sm)", fontSize: 14 }}>
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
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
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
                      onClick={() => setShowNewPasswordField(!showNewPasswordField)}
                      style={{ padding: "6px 12px", minWidth: 40 }}
                    >
                      {showNewPasswordField ? "🙈" : "👁️"}
                    </button>
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Neues Passwort bestätigen *</label>
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
              <button className="btn btn-secondary" onClick={closePasswordModal}>
                Abbrechen
              </button>
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
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
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
            path="/kunden"
            element={
              <ProtectedRoute>
                <Kunden />
              </ProtectedRoute>
            }
          />
          <Route
            path="/lieferscheine"
            element={
              <ProtectedRoute>
                <Lieferscheine />
              </ProtectedRoute>
            }
          />
          <Route
            path="/rechnungen"
            element={
              <ProtectedRoute>
                <Rechnungen />
              </ProtectedRoute>
            }
          />
          <Route
            path="/sumup"
            element={
              <ProtectedRoute>
                <Sumup />
              </ProtectedRoute>
            }
          />
          <Route
            path="/inventur"
            element={
              <ProtectedRoute>
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
