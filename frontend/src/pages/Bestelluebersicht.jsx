import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import DataTable from "../components/DataTable";
import TableToolbar from "../components/TableToolbar";
import { useToast } from "../components/Toast";

const VERSANDART_LABEL = { lieferung: "Lieferung", abholung: "Abholung" };
const STATUS_LABEL = {
  offen: "Offen",
  in_bearbeitung: "In Bearbeitung",
  abgeschlossen: "Abgeschlossen",
  storniert: "Storniert",
};
const STATUS_BADGE = {
  offen: "info",
  in_bearbeitung: "warning",
  abgeschlossen: "success",
  storniert: "danger",
};

const EMPTY_FORM = {
  versandart: "abholung",
  wunschdatum: "",
  beschreibung: "",
  status: "offen",
  kunde: { name: "", email: "", telefonnummer: "", strasse: "", hausnummer: "", plz: "", ort: "" },
  foto: "",
  consentErteilt: false,
};

const ERLAUBTE_FOTO_TYPEN = ["image/jpeg", "image/png", "image/gif"];
const MAX_FOTO_BYTES = 5 * 1024 * 1024;

export default function Bestelluebersicht() {
  const toast = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [bestellungen, setBestellungen] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState("");
  const [fotoDataUrl, setFotoDataUrl] = useState(null);
  const [fotoError, setFotoError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api
      .getBestellungen()
      .then(setBestellungen)
      .catch((err) => toast.fehler("Fehler beim Laden der Bestellungen: " + err.message))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const openNew = () => {
    setForm(EMPTY_FORM);
    setError("");
    setFotoError("");
    setFotoDataUrl(null);
    setEditing("new");
  };

  const openEdit = (b) => {
    setForm({
      versandart: b.versandart,
      wunschdatum: b.wunschdatum ? b.wunschdatum.slice(0, 10) : "",
      beschreibung: b.beschreibung,
      status: b.status,
      kunde: {
        name: b.kunde.name || "",
        email: b.kunde.email || "",
        telefonnummer: b.kunde.telefonnummer || "",
        strasse: b.kunde.strasse || "",
        hausnummer: b.kunde.hausnummer || "",
        plz: b.kunde.plz || "",
        ort: b.kunde.ort || "",
      },
      foto: "",
      consentErteilt: true,
    });
    setError("");
    setFotoError("");
    setFotoDataUrl(null);
    setEditing(b);
    if (b.foto_pfad) {
      api
        .loadBestellungFotoAsDataUrl(b.foto_pfad)
        .then(setFotoDataUrl)
        .catch((err) => {
          // Vorher verschwand das Foto ohne jeden Hinweis (Befund G20).
          setFotoDataUrl(null);
          setFotoError(err.message || "Das Foto konnte nicht geladen werden.");
        });
    }
  };

  const updateKundeField = (field, value) =>
    setForm((f) => ({ ...f, kunde: { ...f.kunde, [field]: value } }));

  const handleFoto = (file) => {
    if (!file) return;
    if (!ERLAUBTE_FOTO_TYPEN.includes(file.type)) {
      setFotoError("Nur JPG, PNG und GIF Dateien sind erlaubt");
      return;
    }
    if (file.size > MAX_FOTO_BYTES) {
      setFotoError("Datei ist zu groß (max. 5 MB)");
      return;
    }
    setFotoError("");
    const reader = new FileReader();
    reader.onload = (e) => setForm((f) => ({ ...f, foto: e.target.result }));
    reader.readAsDataURL(file);
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) {
      handleFoto(e.dataTransfer.files[0]);
    }
  };

  const handleSave = async () => {
    setError("");
    // Ohne diese Sperre erzeugte ein Doppelklick zwei Bestellungen: das
    // disabled prueft nur die Consent-Checkbox, nicht den laufenden Request
    // (Befund G4).
    if (saving) return;
    setSaving(true);
    try {
      const payload = {
        versandart: form.versandart,
        wunschdatum: form.wunschdatum || null,
        beschreibung: form.beschreibung,
        status: form.status,
        kunde: form.kunde,
        foto: form.foto || undefined,
      };
      if (editing === "new") {
        await api.createBestellung({ ...payload, consent: { erteilt: form.consentErteilt } });
      } else {
        await api.updateBestellung(editing.id, payload);
      }
      setEditing(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleAnonymisieren = async () => {
    if (!confirm("Kundendaten dieser Bestellung dauerhaft anonymisieren? Dies kann nicht rückgängig gemacht werden.")) return;
    try {
      await api.anonymisiereBestellungKunde(editing.id);
      setEditing(null);
      load();
    } catch (err) {
      toast.fehler(err.message);
    }
  };

  const filtered = useMemo(() => {
    return bestellungen.filter((b) => {
      if (search) {
        const s = search.toUpperCase();
        const match =
          b.bestellnummer?.toUpperCase().includes(s) ||
          b.kunde?.name?.toUpperCase().includes(s) ||
          b.kunde?.kundePseudonym?.toUpperCase().includes(s) ||
          b.beschreibung?.toUpperCase().includes(s);
        if (!match) return false;
      }
      if (statusFilter && b.status !== statusFilter) return false;
      return true;
    });
  }, [bestellungen, search, statusFilter]);

  const isLieferung = form.versandart === "lieferung";
  const kundeDisabled = editing && editing !== "new" && editing.kunde.anonymisiert;

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Bestellübersicht</h2>
          <p>{bestellungen.length} Bestellungen</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>
          + Neue Bestellung
        </button>
      </div>

      <TableToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Suche nach Bestellnummer, Name oder Beschreibung..."
        right={
          <div className="filter-group">
            <select
              className="form-control"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">Alle Status</option>
              {Object.entries(STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        }
      />

      <div className="card">
        <div className="card-body">
          {loading ? (
            <div className="loading">
              <div className="spinner"></div>Lade...
            </div>
          ) : (
            <DataTable
              data={filtered}
              defaultSort={{ key: "erfassungsdatum", direction: "desc" }}
              onRowClick={(b) => openEdit(b)}
              columns={[
                { key: "bestellnummer", label: "Nummer", sortable: true },
                {
                  key: "kunde",
                  label: "Kunde",
                  render: (r) => r.kunde.anonymisiert ? (
                    <em>{r.kunde.kundePseudonym} (anonymisiert)</em>
                  ) : r.kunde.name,
                },
                {
                  key: "versandart",
                  label: "Versandart",
                  className: "hide-on-mobile",
                  render: (r) => VERSANDART_LABEL[r.versandart],
                  sortable: true,
                },
                {
                  key: "wunschdatum",
                  label: "Wunschdatum",
                  className: "hide-on-mobile",
                  render: (r) => r.wunschdatum ? new Date(r.wunschdatum).toLocaleDateString("de-DE") : "–",
                  sortable: true,
                },
                {
                  key: "erfassungsdatum",
                  label: "Erfasst",
                  className: "hide-on-mobile",
                  render: (r) => new Date(r.erfassungsdatum).toLocaleDateString("de-DE"),
                  sortable: true,
                },
                {
                  key: "status",
                  label: "Status",
                  render: (r) => <span className={`badge ${STATUS_BADGE[r.status]}`}>{STATUS_LABEL[r.status]}</span>,
                  sortable: true,
                },
              ]}
            />
          )}
        </div>
      </div>

      {editing !== null && (
        <div className="modal-overlay">
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editing === "new" ? "Neue Bestellung" : `Bestellung ${editing.bestellnummer}`}</h3>
              <button className="modal-close" onClick={() => setEditing(null)}>×</button>
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-danger">{error}</div>}

              <div className="modal-form-grid">
                <div className="form-group">
                  <label className="form-label">Versandart *</label>
                  <select
                    className="form-control"
                    value={form.versandart}
                    onChange={(e) => setForm({ ...form, versandart: e.target.value })}
                  >
                    <option value="abholung">Abholung</option>
                    <option value="lieferung">Lieferung</option>
                  </select>
                </div>

                {editing !== "new" && (
                  <div className="form-group">
                    <label className="form-label">Status</label>
                    <select
                      className="form-control"
                      value={form.status}
                      onChange={(e) => setForm({ ...form, status: e.target.value })}
                    >
                      {Object.entries(STATUS_LABEL).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label">Wunschdatum</label>
                  <input
                    type="date"
                    className="form-control"
                    value={form.wunschdatum}
                    onChange={(e) => setForm({ ...form, wunschdatum: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Name *</label>
                  <input
                    className="form-control"
                    value={form.kunde.name}
                    disabled={kundeDisabled}
                    onChange={(e) => updateKundeField("name", e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">E-Mail</label>
                  <input
                    type="email"
                    className="form-control"
                    value={form.kunde.email}
                    disabled={kundeDisabled}
                    onChange={(e) => updateKundeField("email", e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Telefonnummer *</label>
                  <input
                    className="form-control"
                    value={form.kunde.telefonnummer}
                    disabled={kundeDisabled}
                    onChange={(e) => updateKundeField("telefonnummer", e.target.value)}
                  />
                </div>

                {isLieferung && (
                  <>
                    <div className="form-group">
                      <label className="form-label">Straße *</label>
                      <input
                        className="form-control"
                        value={form.kunde.strasse}
                        disabled={kundeDisabled}
                        onChange={(e) => updateKundeField("strasse", e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Hausnummer *</label>
                      <input
                        className="form-control"
                        value={form.kunde.hausnummer}
                        disabled={kundeDisabled}
                        onChange={(e) => updateKundeField("hausnummer", e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">PLZ *</label>
                      <input
                        className="form-control"
                        value={form.kunde.plz}
                        disabled={kundeDisabled}
                        onChange={(e) => updateKundeField("plz", e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Ort *</label>
                      <input
                        className="form-control"
                        value={form.kunde.ort}
                        disabled={kundeDisabled}
                        onChange={(e) => updateKundeField("ort", e.target.value)}
                      />
                    </div>
                  </>
                )}

                <div className="form-group form-group-full">
                  <label className="form-label">Auftragsbeschreibung *</label>
                  <textarea
                    className="form-control"
                    rows={4}
                    value={form.beschreibung}
                    onChange={(e) => setForm({ ...form, beschreibung: e.target.value })}
                  />
                </div>

                <div className="form-group form-group-full">
                  <label className="form-label">Referenzfoto (optional)</label>
                  <div className="photo-upload-container">
                    <div
                      className={`drag-drop-zone ${dragActive ? "active" : ""}`}
                      onDragEnter={handleDrag}
                      onDragLeave={handleDrag}
                      onDragOver={handleDrag}
                      onDrop={handleDrop}
                    >
                      <input
                        type="file"
                        id="bestelluebersicht-foto"
                        accept="image/jpeg,image/png,image/gif"
                        onChange={(e) => handleFoto(e.target.files?.[0])}
                      />
                      <label htmlFor="bestelluebersicht-foto" className="upload-label">
                        <div className="upload-content">
                          <div className="upload-icon">📸</div>
                          <p>Ziehe ein Foto hier hin oder klicke zum Auswählen</p>
                          <small>JPG, PNG, GIF (max. 5 MB){fotoDataUrl ? " – ersetzt das vorhandene Foto" : ""}</small>
                        </div>
                      </label>
                    </div>
                    {fotoError && <div className="alert alert-danger">{fotoError}</div>}
                    {(form.foto || fotoDataUrl) && (
                      <div className="photo-preview">
                        <img src={form.foto || fotoDataUrl} alt={form.foto ? "Neues Foto" : "Referenzfoto vom Kunden"} />
                      </div>
                    )}
                  </div>
                </div>

                {editing === "new" && (
                  <div className="form-group form-group-full">
                    <label className="form-label">
                      <input
                        type="checkbox"
                        className="form-checkbox"
                        checked={form.consentErteilt}
                        onChange={(e) => setForm({ ...form, consentErteilt: e.target.checked })}
                      />{" "}
                      Ich stimme der Verarbeitung meiner Daten zur Bearbeitung dieser Bestellung gemäß der
                      Datenschutzerklärung zu. *
                    </label>
                  </div>
                )}

                {editing !== "new" && editing.kunde.anonymisiert && (
                  <div className="form-group form-group-full">
                    <span className="badge warning">
                      Kundendaten wurden{editing.kunde.anonymisiertAm ? ` am ${new Date(editing.kunde.anonymisiertAm).toLocaleDateString("de-DE")}` : ""} anonymisiert (DSGVO)
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              {isAdmin && editing !== "new" && !editing.kunde.anonymisiert && (
                <button className="btn btn-danger" onClick={handleAnonymisieren}>
                  Kundendaten anonymisieren (DSGVO)
                </button>
              )}
              <div className="btn-group">
                <button className="btn btn-secondary" onClick={() => setEditing(null)}>
                  Abbrechen
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleSave}
                  disabled={saving || (editing === "new" && !form.consentErteilt)}
                >
                  {saving ? "Speichert…" : "Speichern"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
