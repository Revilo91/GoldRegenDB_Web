import { useState, useEffect, useMemo } from "react";
import { api } from "../api";

export default function Kunden() {
  const [kunden, setKunden] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({});
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [sortConfig, setSortConfig] = useState({
    key: "Name",
    direction: "asc",
  });

  const load = () => {
    setLoading(true);
    api
      .getKunden()
      .then(setKunden)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleSave = async () => {
    try {
      if (editing === "new") {
        await api.createKunde(form);
      } else {
        await api.updateKunde(editing, form);
      }
      setEditing(null);
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Kunde wirklich löschen?")) return;
    try {
      await api.deleteKunde(id);
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  const openNew = () => {
    setForm({
      Name: "",
      Strasse: "",
      Hausnummer: 0,
      Ort: "",
      PLZ: 0,
      Email: "",
      Telefonnummer: "",
      Provision: 0,
      Aktiv: false,
      Artikelnummern_Erforderlich: false,
    });
    setEditing("new");
  };

  const openEdit = (k) => {
    setForm({ ...k });
    setEditing(k.ID);
  };

  const filteredKunden = useMemo(() => {
    return kunden.filter((k) => {
      // Search filter
      if (search) {
        const s = search.toUpperCase();
        const match =
          k.Name?.toUpperCase().includes(s) ||
          k.Ort?.toUpperCase().includes(s) ||
          k.Email?.toUpperCase().includes(s) ||
          String(k.ID).includes(s);
        if (!match) return false;
      }

      // Quick filters
      if (filters.aktiv !== undefined) {
        if (k.Aktiv !== (filters.aktiv === "1")) return false;
      }

      return true;
    });
  }, [kunden, search, filters]);

  const sortedKunden = useMemo(() => {
    let sortableKunden = [...filteredKunden];
    if (sortConfig.key !== null) {
      sortableKunden.sort((a, b) => {
        const aValue = a[sortConfig.key];
        const bValue = b[sortConfig.key];

        if (aValue < bValue) {
          return sortConfig.direction === "asc" ? -1 : 1;
        }
        if (aValue > bValue) {
          return sortConfig.direction === "asc" ? 1 : -1;
        }
        return 0;
      });
    }
    return sortableKunden;
  }, [filteredKunden, sortConfig]);

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

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Kunden</h2>
          <p>{kunden.length} Kunden / Händler</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>
          + Neuer Kunde
        </button>
      </div>

      <div className="toolbar">
        <input
          className="form-control search-input"
          placeholder="Suche nach Name, Ort, Email, ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="form-control"
          style={{ width: "auto", minWidth: 150 }}
          value={filters.aktiv ?? ""}
          onChange={(e) => {
            const { aktiv, ...rest } = filters;
            setFilters(
              e.target.value !== "" ? { ...rest, aktiv: e.target.value } : rest,
            );
          }}
        >
          <option value="">Alle Status</option>
          <option value="1">Aktiv</option>
          <option value="0">Inaktiv</option>
        </select>
      </div>

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
                  <th
                    onClick={() => requestSort("ID")}
                    style={{ cursor: "pointer" }}
                  >
                    ID {getSortIcon("ID")}
                  </th>
                  <th
                    onClick={() => requestSort("Name")}
                    style={{ cursor: "pointer" }}
                  >
                    Name {getSortIcon("Name")}
                  </th>
                  <th
                    onClick={() => requestSort("Ort")}
                    style={{ cursor: "pointer" }}
                  >
                    Ort {getSortIcon("Ort")}
                  </th>
                  <th
                    onClick={() => requestSort("PLZ")}
                    style={{ cursor: "pointer" }}
                  >
                    PLZ {getSortIcon("PLZ")}
                  </th>
                  <th
                    onClick={() => requestSort("Provision")}
                    style={{ cursor: "pointer" }}
                  >
                    Provision {getSortIcon("Provision")}
                  </th>
                  <th
                    onClick={() => requestSort("Aktiv")}
                    style={{ cursor: "pointer" }}
                  >
                    Status {getSortIcon("Aktiv")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedKunden.map((k) => (
                  <tr
                    key={k.ID}
                    onClick={() => openEdit(k)}
                    style={{ cursor: "pointer" }}
                  >
                    <td>{k.ID}</td>
                    <td>
                      <strong>{k.Name}</strong>
                    </td>
                    <td>{k.Ort}</td>
                    <td>{k.PLZ || "–"}</td>
                    <td>{k.Provision}%</td>
                    <td>
                      {k.Aktiv ? (
                        <span className="badge success">Aktiv</span>
                      ) : (
                        <span className="badge danger">Inaktiv</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {editing !== null && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editing === "new" ? "Neuer Kunde" : "Kunde bearbeiten"}</h3>
              <button className="modal-close" onClick={() => setEditing(null)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group">
                  <label>Name</label>
                  <input
                    className="form-control"
                    value={form.Name || ""}
                    onChange={(e) => setForm({ ...form, Name: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Straße</label>
                  <input
                    className="form-control"
                    value={form.Strasse || ""}
                    onChange={(e) =>
                      setForm({ ...form, Strasse: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Hausnummer</label>
                  <input
                    className="form-control"
                    type="number"
                    value={form.Hausnummer || 0}
                    onChange={(e) =>
                      setForm({ ...form, Hausnummer: parseInt(e.target.value) })
                    }
                  />
                </div>
                <div className="form-group">
                  <label>Ort</label>
                  <input
                    className="form-control"
                    value={form.Ort || ""}
                    onChange={(e) => setForm({ ...form, Ort: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>PLZ</label>
                  <input
                    className="form-control"
                    type="number"
                    value={form.PLZ || 0}
                    onChange={(e) =>
                      setForm({ ...form, PLZ: parseInt(e.target.value) })
                    }
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Email</label>
                  <input
                    className="form-control"
                    type="email"
                    value={form.Email || ""}
                    onChange={(e) =>
                      setForm({ ...form, Email: e.target.value })
                    }
                  />
                </div>
                <div className="form-group">
                  <label>Telefonnummer</label>
                  <input
                    className="form-control"
                    value={form.Telefonnummer || ""}
                    onChange={(e) =>
                      setForm({ ...form, Telefonnummer: e.target.value })
                    }
                  />
                </div>
                <div className="form-group">
                  <label>Provision (%)</label>
                  <input
                    className="form-control"
                    type="number"
                    value={form.Provision || 0}
                    onChange={(e) =>
                      setForm({ ...form, Provision: parseInt(e.target.value) })
                    }
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>
                    <input
                      type="checkbox"
                      checked={form.Aktiv || false}
                      onChange={(e) =>
                        setForm({ ...form, Aktiv: e.target.checked })
                      }
                      style={{ marginRight: 8 }}
                    />
                    Aktiv
                  </label>
                </div>
                <div className="form-group">
                  <label>
                    <input
                      type="checkbox"
                      checked={form.Artikelnummern_Erforderlich || false}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          Artikelnummern_Erforderlich: e.target.checked,
                        })
                      }
                      style={{ marginRight: 8 }}
                    />
                    Artikelnummern erforderlich
                  </label>
                </div>
              </div>
            </div>
            <div
              className="modal-footer"
              style={{ justifyContent: "space-between" }}
            >
              <button
                className="btn btn-danger"
                onClick={() => {
                  handleDelete(form.ID);
                  setEditing(null);
                }}
              >
                Löschen
              </button>
              <div className="btn-group">
                <button
                  className="btn btn-secondary"
                  onClick={() => setEditing(null)}
                >
                  Abbrechen
                </button>
                <button className="btn btn-primary" onClick={handleSave}>
                  Speichern
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
