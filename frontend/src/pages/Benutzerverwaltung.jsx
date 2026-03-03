import { useState, useEffect, useMemo } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlus,
  faPen,
  faUser,
  faCrown,
  faCheckCircle,
  faTimesCircle,
  faTrash,
  faTimes,
  faKey,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../api";

const ROLES = [
  { value: "admin", label: "Admin" },
  { value: "user", label: "Benutzer" },
];

const EMPTY_FORM = {
  username: "",
  password: "",
  passwordConfirm: "",
  email: "",
  role: "user",
  active: true,
};

export default function Benutzerverwaltung() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showPasswordReset, setShowPasswordReset] = useState(false);
  const [sortConfig, setSortConfig] = useState({
    key: "username",
    direction: "asc",
  });

  const load = () => {
    setLoading(true);
    api
      .getUsers()
      .then(setUsers)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleSave = async () => {
    try {
      if (editing === "new") {
        if (form.password !== form.passwordConfirm) {
          alert("Passwörter stimmen nicht überein");
          return;
        }
        if (form.password.length < 8) {
          alert("Passwort muss mindestens 8 Zeichen lang sein");
          return;
        }
        if (!form.username.trim()) {
          alert("Benutzername darf nicht leer sein");
          return;
        }
        const createData = { username: form.username, password: form.password, email: form.email, role: form.role, active: form.active };
        await api.createUser(createData);
      } else {
        if (!form.username.trim()) {
          alert("Benutzername darf nicht leer sein");
          return;
        }
        const updateData = { username: form.username, email: form.email, role: form.role, active: form.active };
        await api.updateUser(selected.id, updateData);
      }
      setEditing(null);
      setSelected(null);
      load();
    } catch (err) {
      let errorMessage = "Fehler beim Speichern";

      if (err.message === "Failed to fetch") {
        errorMessage = "Backend-Server nicht erreichbar. Bitte stelle sicher, dass der Server läuft (http://localhost:3001).";
      } else if (err.message === "Request failed") {
        // Versuche Details aus der Axios-Response zu bekommen
        errorMessage = "Backend-Fehler: " + (err.message || "Unbekannter Fehler");
      } else if (err.message) {
        errorMessage = err.message;
      }

      alert(errorMessage);
      console.error("Save error:", err);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Benutzer "${selected.username}" wirklich löschen?`)) return;
    try {
      await api.deleteUser(selected.id);
      setSelected(null);
      setEditing(null);
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleResetPassword = async () => {
    try {
      if (!newPassword) {
        alert("Bitte ein neues Passwort eingeben");
        return;
      }
      if (newPassword.length < 8) {
        alert("Passwort muss mindestens 8 Zeichen lang sein");
        return;
      }
      await api.resetUserPassword(selected.id, newPassword);
      alert("Passwort erfolgreich zurückgesetzt");
      setNewPassword("");
      setShowNewPassword(false);
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  const openNew = () => {
    setForm({ ...EMPTY_FORM });
    setSelected({ id: "new", username: "", email: "", role: "user", active: true });
    setEditing("new");
  };

  const openEdit = (u) => {
    setSelected(u);
    setForm({
      username: u.username,
      email: u.email || "",
      role: u.role,
      active: u.active,
    });
    setEditing(null);
    setNewPassword("");
    setShowNewPassword(false);
    setShowPasswordReset(false);
  };

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

  const filteredUsers = useMemo(() => {
    let list = users.filter((u) => {
      if (!search) return true;
      const s = search.toLowerCase();
      return (
        u.username?.toLowerCase().includes(s) ||
        u.email?.toLowerCase().includes(s) ||
        u.role?.toLowerCase().includes(s)
      );
    });
    list = [...list].sort((a, b) => {
      const aVal = a[sortConfig.key] ?? "";
      const bVal = b[sortConfig.key] ?? "";
      if (aVal < bVal) return sortConfig.direction === "asc" ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
    return list;
  }, [users, search, sortConfig]);

  return (
    <div>
      <div className="page-header">
        <h2>Benutzerverwaltung</h2>
        <p>{users.length} Benutzer – Nur Admins können Benutzer verwalten</p>
      </div>

      <div className="toolbar">
        <input
          className="form-control search-input"
          placeholder="Suche nach Benutzername, E-Mail, Rolle..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="btn btn-primary" onClick={openNew}>
          + Benutzer anlegen
        </button>
      </div>

      {/* User Detail Modal */}
      {selected && (
        <div className="modal-overlay" onClick={() => { setSelected(null); setEditing(null); setNewPassword(""); setShowPassword(false); setShowPasswordConfirm(false); setShowNewPassword(false); setShowPasswordReset(false); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "600px" }}>
            <div className="modal-header">
              <h3>{editing === "new" ? <><FontAwesomeIcon icon={faPlus} /> Neuer Benutzer</> : editing === selected.id ? <><FontAwesomeIcon icon={faPen} /> Benutzer bearbeiten</> : <><FontAwesomeIcon icon={faUser} /> {selected.username}</>}</h3>
              <button
                className="modal-close"
                onClick={() => { setSelected(null); setEditing(null); setNewPassword(""); setShowPassword(false); setShowPasswordConfirm(false); setShowNewPassword(false); setShowPasswordReset(false); }}
              >
                <FontAwesomeIcon icon={faTimes} />
              </button>
            </div>

            <div className="modal-body">
              {editing === "new" || editing === selected.id ? (
                // Edit/Create Mode
                <>
                  <div className="form-group">
                    <label className="form-label">Benutzername *</label>
                    <input
                      className="form-control"
                      value={form.username}
                      onChange={(e) => setForm({ ...form, username: e.target.value })}
                    />
                  </div>
                  {editing === "new" && (
                    <div className="form-group">
                      <label className="form-label">Passwort *</label>
                      <div style={{ display: "flex", gap: 8 }}>
                        <input
                          type={showPassword ? "text" : "password"}
                          className="form-control"
                          value={form.password}
                          onChange={(e) => setForm({ ...form, password: e.target.value })}
                          placeholder="Mindestens 8 Zeichen"
                        />
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => setShowPassword(!showPassword)}
                          style={{ padding: "6px 12px", minWidth: "40px" }}
                        >
                          {showPassword ? "🙈" : "👁️"}
                        </button>
                      </div>
                    </div>
                  )}
                  {editing === "new" && (
                    <div className="form-group">
                      <label className="form-label">Passwort bestätigen *</label>
                      <div style={{ display: "flex", gap: 8 }}>
                        <input
                          type={showPasswordConfirm ? "text" : "password"}
                          className="form-control"
                          value={form.passwordConfirm}
                          onChange={(e) => setForm({ ...form, passwordConfirm: e.target.value })}
                          placeholder="Passwort wiederholen"
                        />
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => setShowPasswordConfirm(!showPasswordConfirm)}
                          style={{ padding: "6px 12px", minWidth: "40px" }}
                        >
                          {showPasswordConfirm ? "🙈" : "👁️"}
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="form-group">
                    <label className="form-label">E-Mail</label>
                    <input
                      type="email"
                      className="form-control"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Rolle *</label>
                    <select
                      className="form-control"
                      value={form.role}
                      onChange={(e) => setForm({ ...form, role: e.target.value })}
                    >
                      {ROLES.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={form.active}
                        onChange={(e) => setForm({ ...form, active: e.target.checked })}
                      />
                      Aktiv
                    </label>
                  </div>
                </>
              ) : (
                // View Mode
                <>
                  <div style={{ marginBottom: "20px" }}>
                    <h4 style={{ marginBottom: "10px", color: "var(--text-secondary)" }}>Grundinformationen</h4>
                    <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: "12px 20px" }}>
                      <strong>Benutzername:</strong>
                      <span>{selected.username}</span>
                      <strong>E-Mail:</strong>
                      <span>{selected.email || "–"}</span>
                      <strong>Rolle:</strong>
                      <span>
                        <span className={`badge ${selected.role === "admin" ? "gold" : "info"}`}>
                          {selected.role === "admin" ? <><FontAwesomeIcon icon={faCrown} /> Admin</> : <><FontAwesomeIcon icon={faUser} /> Benutzer</>}
                        </span>
                      </span>
                      <strong>Status:</strong>
                      <span>
                        <span className={`badge ${selected.active ? "success" : "danger"}`}>
                          {selected.active ? <><FontAwesomeIcon icon={faCheckCircle} /> Aktiv</> : <><FontAwesomeIcon icon={faTimesCircle} /> Inaktiv</>}
                        </span>
                      </span>
                    </div>
                  </div>

                  <div>
                    <h4 style={{ marginBottom: "10px", color: "var(--text-secondary)" }}>Audit-Informationen</h4>
                    <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: "12px 20px" }}>
                      <strong>Erstellt:</strong>
                      <span>
                        {selected.created_at
                          ? new Date(selected.created_at).toLocaleString("de-DE")
                          : "–"}
                      </span>
                      <strong>Letzter Login:</strong>
                      <span>
                        {selected.last_login
                          ? new Date(selected.last_login).toLocaleString("de-DE")
                          : "Noch nicht angemeldet"}
                      </span>
                    </div>
                  </div>

                  {showPasswordReset && (
                    <>
                      <hr style={{ margin: "20px 0", borderColor: "var(--border)" }} />
                      <h4 style={{ marginBottom: "10px", color: "var(--text-secondary)" }}>Passwort zurücksetzen</h4>
                      <div style={{ display: "grid", gap: "10px" }}>
                        <div className="form-group">
                          <label className="form-label">Neues Passwort *</label>
                          <div style={{ display: "flex", gap: 8 }}>
                            <input
                              type={showNewPassword ? "text" : "password"}
                              className="form-control"
                              value={newPassword}
                              onChange={(e) => setNewPassword(e.target.value)}
                              placeholder="Mindestens 8 Zeichen"
                            />
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={() => setShowNewPassword(!showNewPassword)}
                              style={{ padding: "6px 12px", minWidth: "40px" }}
                            >
                              {showNewPassword ? "🙈" : "👁️"}
                            </button>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>

            <div
              className="modal-footer"
              style={{
                gap: "10px",
                justifyContent:
                  editing === "new" || editing === selected?.id
                    ? "flex-end"
                    : "space-between",
              }}
            >
              {selected.id !== "new" && editing === null && (
                <button
                  className="btn btn-danger"
                  onClick={handleDelete}
                  style={{ marginRight: "auto" }}
                >
                  <FontAwesomeIcon icon={faTrash} /> Löschen
                </button>
              )}
              <div className="modal-actions" style={{ display: "flex", gap: "10px" }}>
                {selected.id !== "new" && editing === null && (
                  <>
                    {showPasswordReset ? (
                      <>
                        <button className="btn btn-secondary" onClick={() => { setNewPassword(""); setShowNewPassword(false); setShowPasswordReset(false); }}>
                          <FontAwesomeIcon icon={faTimes} /> Passwort-Reset abbrechen
                        </button>
                        <button className="btn btn-success" onClick={handleResetPassword} disabled={!newPassword}>
                          ✓ Passwort jetzt zurücksetzen
                        </button>
                      </>
                    ) : (
                      <button className="btn btn-secondary" onClick={() => setShowPasswordReset(true)}>
                        <FontAwesomeIcon icon={faKey} /> Passwort zurücksetzen
                      </button>
                    )}
                  </>
                )}
                <button
                  className="btn btn-secondary"
                  onClick={() => { setSelected(null); setEditing(null); setNewPassword(""); setShowPassword(false); setShowPasswordConfirm(false); setShowNewPassword(false); setShowPasswordReset(false); }}
                >
                  {editing === "new" || editing === selected.id ? "Abbrechen" : "Schließen"}
                </button>
                {(editing === "new" || editing === selected.id) && (
                  <button className="btn btn-primary" onClick={handleSave}>
                    ✓ Speichern
                  </button>
                )}
                {editing === null && selected.id !== "new" && (
                  <button className="btn btn-primary" onClick={() => setEditing(selected.id)}>
                    <FontAwesomeIcon icon={faPen} /> Bearbeiten
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-body">
          {loading ? (
            <div className="loading">
              <div className="spinner"></div>Lade...
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th onClick={() => requestSort("id")} style={{ cursor: "pointer" }}>
                    ID {getSortIcon("id")}
                  </th>
                  <th onClick={() => requestSort("username")} style={{ cursor: "pointer" }}>
                    Benutzername {getSortIcon("username")}
                  </th>
                  <th onClick={() => requestSort("email")} style={{ cursor: "pointer" }}>
                    E-Mail {getSortIcon("email")}
                  </th>
                  <th onClick={() => requestSort("role")} style={{ cursor: "pointer" }}>
                    Rolle {getSortIcon("role")}
                  </th>
                  <th onClick={() => requestSort("active")} style={{ cursor: "pointer" }}>
                    Status {getSortIcon("active")}
                  </th>
                  <th onClick={() => requestSort("created_at")} style={{ cursor: "pointer" }}>
                    Erstellt {getSortIcon("created_at")}
                  </th>
                  <th onClick={() => requestSort("last_login")} style={{ cursor: "pointer" }}>
                    Letzter Login {getSortIcon("last_login")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => (
                  <tr key={u.id} onClick={() => openEdit(u)} style={{ cursor: "pointer" }}>
                    <td>{u.id}</td>
                    <td>
                      <strong>{u.username}</strong>
                    </td>
                    <td>{u.email || "–"}</td>
                    <td>
                      <span className={`badge ${u.role === "admin" ? "gold" : "info"}`}>
                        {u.role === "admin" ? <><FontAwesomeIcon icon={faCrown} /> Admin</> : <><FontAwesomeIcon icon={faUser} /> Benutzer</>}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${u.active ? "success" : "danger"}`}>
                        {u.active ? <><FontAwesomeIcon icon={faCheckCircle} /> Aktiv</> : <><FontAwesomeIcon icon={faTimesCircle} /> Inaktiv</>}
                      </span>
                    </td>
                    <td>
                      {u.created_at
                        ? new Date(u.created_at).toLocaleString("de-DE")
                        : "–"}
                    </td>
                    <td>
                      {u.last_login
                        ? new Date(u.last_login).toLocaleString("de-DE")
                        : "–"}
                    </td>
                  </tr>
                ))}
                {filteredUsers.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                      Keine Benutzer gefunden
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
