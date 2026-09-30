import { useCallback, useEffect, useMemo, useState } from "react";
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
  faCopy,
} from "@fortawesome/free-solid-svg-icons";
import { api, authApi } from "../api";
import DataTable from "../components/DataTable";
import TableToolbar from "../components/TableToolbar";
import { useToast } from "../components/Toast";

const ROLES = [
  { value: "admin", label: "Admin" },
  { value: "bearbeiter", label: "Bearbeiter" },
  { value: "user", label: "Benutzer" },
];

function RoleBadge({ role }) {
  if (role === "admin") {
    return (
      <span className="badge gold">
        <FontAwesomeIcon icon={faCrown} /> Admin
      </span>
    );
  }
  if (role === "bearbeiter") {
    return (
      <span className="badge warning">
        <FontAwesomeIcon icon={faPen} /> Bearbeiter
      </span>
    );
  }
  return (
    <span className="badge info">
      <FontAwesomeIcon icon={faUser} /> Benutzer
    </span>
  );
}

const EMPTY_FORM = {
  username: "",
  password: "",
  passwordConfirm: "",
  email: "",
  role: "user",
  active: true,
};

export default function Benutzerverwaltung() {
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [resetLink, setResetLink] = useState(null);
  const [resetLinkLoading, setResetLinkLoading] = useState(false);
  const [resetLinkCopied, setResetLinkCopied] = useState(false);

  const load = useCallback(() => {
    api
      .getUsers()
      .then((data) => setUsers(data || []))
      .catch((err) =>
        toast.fehler("Fehler beim Laden der Benutzer: " + err.message),
      )
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const openNew = () => {
    setForm({ ...EMPTY_FORM });
    setSelected({ id: "new", username: "", email: "", role: "user", active: true });
    setEditing("new");
  };

  const openEdit = (u) => {
    setSelected(u);
    setForm({ username: u.username, email: u.email || "", role: u.role, active: u.active });
    setEditing(null);
    setResetLink(null);
    setResetLinkCopied(false);
  };

  const handleGenerateResetLink = async () => {
    setResetLinkLoading(true);
    setResetLink(null);
    setResetLinkCopied(false);
    try {
      const { resetPath, expiresInMinutes, username } = await authApi.generateAdminResetLink(selected.id);
      setResetLink({ url: window.location.origin + resetPath, expiresInMinutes, username });
    } catch (err) {
      toast.fehler(err.message || "Fehler beim Generieren des Reset-Links");
    } finally {
      setResetLinkLoading(false);
    }
  };

  const handleCopyResetLink = () => {
    navigator.clipboard.writeText(resetLink.url).then(() => {
      setResetLinkCopied(true);
      setTimeout(() => setResetLinkCopied(false), 3000);
    });
  };

  const handleSave = async () => {
    try {
      if (editing === "new") {
        if (form.password !== form.passwordConfirm) return toast.fehler("Passwörter stimmen nicht überein");
        if (form.password.length < 8) return toast.fehler("Passwort muss mindestens 8 Zeichen lang sein");
        if (!form.username.trim()) return toast.fehler("Benutzername darf nicht leer sein");
        await api.createUser({ username: form.username, password: form.password, email: form.email, role: form.role, active: form.active });
      } else {
        if (!form.username.trim()) return toast.fehler("Benutzername darf nicht leer sein");
        await api.updateUser(selected.id, { username: form.username, email: form.email, role: form.role, active: form.active });
      }
      setEditing(null);
      setSelected(null);
      load();
    } catch (err) {
      toast.fehler(err.message || "Fehler beim Speichern");
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    if (!confirm(`Benutzer "${selected.username}" wirklich löschen?`)) return;
    try {
      await api.deleteUser(selected.id);
      setSelected(null);
      setEditing(null);
      load();
    } catch (err) {
      toast.fehler(err.message || "Fehler");
    }
  };

  const filteredUsers = useMemo(() => {
    const q = (search || "").trim().toLowerCase();
    return (users || []).filter((u) => {
      if (!q) return true;
      return (u.username && u.username.toLowerCase().includes(q)) || (u.email && u.email.toLowerCase().includes(q));
    });
  }, [users, search]);

  const columns = [
    { label: "Benutzername", key: "username", sortable: true },
    { label: "E-Mail", key: "email", sortable: true, className: "hide-on-mobile" },
    { label: "Rolle", key: "role", render: (r) => <RoleBadge role={r.role} /> },
    {
      label: "Status",
      key: "active",
      render: (r) => (
        <span className={`badge ${r.active ? "success" : "danger"}`}>
          {r.active ? (
            <>
              <FontAwesomeIcon icon={faCheckCircle} /> Aktiv
            </>
          ) : (
            <>
              <FontAwesomeIcon icon={faTimesCircle} /> Inaktiv
            </>
          )}
        </span>
      ),
    },
    { label: "PW-Status", key: "must_change_password", className: "hide-on-mobile" },
    { label: "Erstellt", key: "created_at", className: "hide-on-mobile", render: (r) => (r.created_at ? new Date(r.created_at).toLocaleString("de-DE") : "–") },
    { label: "Letzter Login", key: "last_login", className: "hide-on-mobile", render: (r) => (r.last_login ? new Date(r.last_login).toLocaleString("de-DE") : "–") },
  ];

  return (
    <div className="page">
      <div className="benutzer-flex-jc-space-between-ai-center-mb-12">
        <h2>Benutzerverwaltung</h2>
        <button className="btn btn-primary" onClick={openNew} title="Neuer Benutzer">
          <FontAwesomeIcon icon={faPlus} />
        </button>
      </div>

      <TableToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Suche nach Benutzername oder E-Mail..." className="benutzer-mb-12"/>

      <div className="card">
        <div className="card-body">
          {loading ? (
            <div className="loading"><div className="spinner"></div>Lade...</div>
          ) : (
            <DataTable
              data={filteredUsers}
              columns={columns}
              defaultSort={{ key: "username", direction: "asc" }}
              onRowClick={(r) => openEdit(r)}
              getRowKey={(r) => r.id}
            />
          )}
        </div>
      </div>

      {selected && (
        <div className="modal benutzer-block">
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h3 className="benutzer-m-0">{editing === "new" || editing === selected.id ? (editing === "new" ? "Neuer Benutzer" : `Bearbeite: ${selected.username}`) : selected.username}</h3>
                <button className="btn btn-ghost" onClick={() => { setSelected(null); setEditing(null); setResetLink(null); setResetLinkCopied(false); }}><FontAwesomeIcon icon={faTimes} /></button>
              </div>
              <div className="modal-body">
                {editing === "new" || editing === selected.id ? (
                  <>
                    <div className="form-group">
                      <label className="form-label">Benutzername *</label>
                      <input className="form-control" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
                    </div>
                    {editing === "new" && (
                      <>
                        <div className="form-group">
                          <label className="form-label">Passwort *</label>
                          <input type="password" className="form-control" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Mindestens 8 Zeichen" />
                        </div>
                        <div className="form-group">
                          <label className="form-label">Passwort wiederholen *</label>
                          <input type="password" className="form-control" value={form.passwordConfirm} onChange={(e) => setForm({ ...form, passwordConfirm: e.target.value })} placeholder="Passwort erneut eingeben" />
                        </div>
                      </>
                    )}
                    <div className="form-group">
                      <label className="form-label">E-Mail</label>
                      <input type="email" className="form-control" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Rolle *</label>
                      <select className="form-control" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                        {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Aktiv</label>
                    </div>
                  </>
                ) : (
                  <>
                    <h4 className="benutzer-mb-10-color-text-secondary">Grundinformationen</h4>
                    <div className="benutzer-info-grid">
                      <strong>Benutzername:</strong><span>{selected.username}</span>
                      <strong>E-Mail:</strong><span>{selected.email || "–"}</span>
                      <strong>Rolle:</strong><span><RoleBadge role={selected.role} /></span>
                      <strong>Status:</strong><span><span className={`badge ${selected.active ? "success" : "danger"}`}>{selected.active ? (<><FontAwesomeIcon icon={faCheckCircle} /> Aktiv</>) : (<><FontAwesomeIcon icon={faTimesCircle} /> Inaktiv</>)}</span></span>
                    </div>
                    <h4 className="benutzer-mt-16-mb-8-color-text-secondary">Audit-Informationen</h4>
                    <div className="benutzer-info-grid">
                      <strong>Erstellt:</strong><span>{selected.created_at ? new Date(selected.created_at).toLocaleString("de-DE") : "–"}</span>
                      <strong>Letzter Login:</strong><span>{selected.last_login ? new Date(selected.last_login).toLocaleString("de-DE") : "Noch nicht angemeldet"}</span>
                    </div>
                    <h4 className="benutzer-mt-16-mb-8-color-text-secondary">Passwort-Reset</h4>
                    <p className="benutzer-mb-8-fs-0_875rem-color-text-secondary">
                      Generiert einen Einmal-Link, den Sie an den Benutzer weitergeben. Der Benutzer setzt sein Passwort selbst.
                    </p>
                    <button
                      className="btn btn-secondary"
                      onClick={handleGenerateResetLink}
                      disabled={resetLinkLoading}
                    >
                      <FontAwesomeIcon icon={faKey} /> {resetLinkLoading ? "Generiere…" : "Reset-Link generieren"}
                    </button>
                    {resetLink && (
                      <div className="reset-link-box">
                        <p className="reset-link-hint">
                          Gültig {resetLink.expiresInMinutes} Minuten. Link direkt an <strong>{resetLink.username}</strong> weitergeben.
                        </p>
                        <div className="reset-link-row">
                          <input
                            readOnly
                            className="form-control reset-link-input"
                            value={resetLink.url}
                            onFocus={(e) => e.target.select()}
                          />
                          <button className="btn btn-secondary" onClick={handleCopyResetLink}>
                            <FontAwesomeIcon icon={faCopy} /> {resetLinkCopied ? "Kopiert!" : "Kopieren"}
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="benutzer-mt-12" />
                  </>
                )}
              </div>
              <div className={`modal-footer benutzer-flex-gap-10 ${editing === "new" || editing === selected.id ? "benutzer-jc-flex-end" : "benutzer-jc-space-between"}`}>
                {selected.id !== "new" && editing === null && (
                  <button className="btn btn-danger benutzer-mr-auto" onClick={handleDelete}><FontAwesomeIcon icon={faTrash} /> Löschen</button>
                )}
                <div className="benutzer-flex-gap-10">
                  {selected.id !== "new" && editing === null && (
                    <button className="btn btn-secondary" onClick={() => setEditing(selected.id)}><FontAwesomeIcon icon={faPen} /> Bearbeiten</button>
                  )}
                  <button className="btn btn-secondary" onClick={() => { setSelected(null); setEditing(null); setResetLink(null); setResetLinkCopied(false); }}>
                    {editing === "new" || editing === selected.id ? "Abbrechen" : "Schließen"}
                  </button>
                  {(editing === "new" || editing === selected.id) && (
                    <button className="btn btn-primary" onClick={handleSave}>✓ Speichern</button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
