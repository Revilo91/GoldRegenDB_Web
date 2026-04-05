import { useState, useEffect } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faTimes,
  faPlus,
  faSave,
  faCheck,
  faSearch,
  faExclamationTriangle,
  faQuestionCircle,
  faCheckCircle,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../api";
import DataTable from "../components/DataTable";

function InventurDiffModal({ draftId, onClose }) {
  const [diff, setDiff] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState("fehlend");

  useEffect(() => {
    api
      .getInventurDiff(draftId)
      .then(setDiff)
      .catch((err) => alert("Fehler beim Laden der Auswertung: " + err.message))
      .finally(() => setLoading(false));
  }, [draftId]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        style={{
          maxWidth: 900,
          width: "95%",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <FontAwesomeIcon icon={faSearch} />
            Inventur-Auswertung #{draftId}
          </h3>
          <button className="modal-close" onClick={onClose}>
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>

        <div className="modal-body" style={{ flex: 1, overflowY: "auto" }}>
          {loading ? (
            <div className="loading">
              <div className="spinner"></div>Lade Auswertung…
            </div>
          ) : (
            diff && (
              <>
                {/* Summary Badges */}
                <div className="stats-grid" style={{ marginBottom: 20 }}>
                  <div
                    className="stat-card danger"
                    style={{
                      cursor: "pointer",
                      outline:
                        activeSection === "fehlend"
                          ? "2px solid var(--danger)"
                          : "none",
                    }}
                    onClick={() => setActiveSection("fehlend")}>
                    <div className="stat-value">{diff.stats.fehlend}</div>
                    <div className="stat-label">Fehlend</div>
                  </div>
                  <div
                    className="stat-card warning"
                    style={{
                      cursor: "pointer",
                      outline:
                        activeSection === "unbekannt"
                          ? "2px solid var(--warning)"
                          : "none",
                    }}
                    onClick={() => setActiveSection("unbekannt")}>
                    <div className="stat-value">{diff.stats.unbekannt}</div>
                    <div className="stat-label">Unbekannt</div>
                  </div>
                  <div
                    className="stat-card success"
                    style={{
                      cursor: "pointer",
                      outline:
                        activeSection === "gefunden"
                          ? "2px solid var(--success)"
                          : "none",
                    }}
                    onClick={() => setActiveSection("gefunden")}>
                    <div className="stat-value">{diff.stats.gefunden}</div>
                    <div className="stat-label">Gefunden</div>
                  </div>
                  <div className="stat-card gold">
                    <div className="stat-value">{diff.stats.soll}</div>
                    <div className="stat-label">Soll-Bestand</div>
                  </div>
                </div>

                {/* Fehlend */}
                {activeSection === "fehlend" && (
                  <>
                    <h4
                      style={{
                        color: "var(--danger)",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 12,
                      }}>
                      <FontAwesomeIcon icon={faExclamationTriangle} />
                      Fehlende Artikelnummern ({diff.stats.fehlend})
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 400,
                          color: "var(--text-secondary)",
                        }}>
                        – Im Lager erwartet, aber nicht gescannt
                      </span>
                    </h4>
                    {diff.fehlend.length === 0 ? (
                      <p style={{ color: "var(--success)", fontWeight: 600 }}>
                        ✓ Keine Artikel fehlen – alles vollständig erfasst!
                      </p>
                    ) : (
                      <div style={{ overflowX: "auto" }}>
                        <table
                          className="table"
                          style={{ width: "100%", borderCollapse: "collapse" }}>
                          <thead>
                            <tr
                              style={{
                                borderBottom: "2px solid var(--border)",
                              }}>
                              <th style={{ padding: "8px", textAlign: "left" }}>
                                Artikelnummer
                              </th>
                              <th style={{ padding: "8px", textAlign: "left" }}>
                                Name
                              </th>
                              <th
                                style={{ padding: "8px", textAlign: "center" }}>
                                Soll
                              </th>
                              <th
                                style={{ padding: "8px", textAlign: "center" }}>
                                Ist
                              </th>
                              <th
                                style={{ padding: "8px", textAlign: "center" }}>
                                Fehlend
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {diff.fehlend.map((item) => (
                              <tr
                                key={item.Artikelnummer}
                                style={{
                                  borderBottom: "1px solid var(--border)",
                                  background:
                                    "rgba(var(--danger-rgb, 239,68,68), 0.05)",
                                }}>
                                <td style={{ padding: "8px" }}>
                                  <strong style={{ color: "var(--danger)" }}>
                                    {item.Artikelnummer}
                                  </strong>
                                </td>
                                <td style={{ padding: "8px" }}>
                                  {item.Name || "–"}
                                </td>
                                <td
                                  style={{
                                    padding: "8px",
                                    textAlign: "center",
                                  }}>
                                  {item.Soll}
                                </td>
                                <td
                                  style={{
                                    padding: "8px",
                                    textAlign: "center",
                                  }}>
                                  {item.Ist}
                                </td>
                                <td
                                  style={{
                                    padding: "8px",
                                    textAlign: "center",
                                    fontWeight: "bold",
                                    color: "var(--danger)",
                                  }}>
                                  {item.Fehlt}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}

                {/* Unbekannt */}
                {activeSection === "unbekannt" && (
                  <>
                    <h4
                      style={{
                        color: "var(--warning)",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 12,
                      }}>
                      <FontAwesomeIcon icon={faQuestionCircle} />
                      Unbekannte Artikel ({diff.unbekannt.length})
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 400,
                          color: "var(--text-secondary)",
                        }}>
                        – Gescannt, aber nicht im Lager-Soll
                      </span>
                    </h4>
                    {diff.unbekannt.length === 0 ? (
                      <p style={{ color: "var(--success)", fontWeight: 600 }}>
                        ✓ Keine unbekannten Artikel gescannt.
                      </p>
                    ) : (
                      <div style={{ overflowX: "auto" }}>
                        <table
                          className="table"
                          style={{ width: "100%", borderCollapse: "collapse" }}>
                          <thead>
                            <tr
                              style={{
                                borderBottom: "2px solid var(--border)",
                              }}>
                              <th style={{ padding: "8px", textAlign: "left" }}>
                                Artikelnummer
                              </th>
                              <th style={{ padding: "8px", textAlign: "left" }}>
                                Name
                              </th>
                              <th
                                style={{ padding: "8px", textAlign: "center" }}>
                                Soll
                              </th>
                              <th
                                style={{ padding: "8px", textAlign: "center" }}>
                                Ist
                              </th>
                              <th
                                style={{ padding: "8px", textAlign: "center" }}>
                                Überschuss
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {diff.unbekannt.map((item) => (
                              <tr
                                key={item.Artikelnummer}
                                style={{
                                  borderBottom: "1px solid var(--border)",
                                  background:
                                    "rgba(var(--warning-rgb, 245,158,11), 0.05)",
                                }}>
                                <td style={{ padding: "8px" }}>
                                  <strong style={{ color: "var(--warning)" }}>
                                    {item.Artikelnummer}
                                  </strong>
                                </td>
                                <td style={{ padding: "8px" }}>
                                  {item.Name || "–"}
                                </td>
                                <td
                                  style={{
                                    padding: "8px",
                                    textAlign: "center",
                                  }}>
                                  {item.Soll}
                                </td>
                                <td
                                  style={{
                                    padding: "8px",
                                    textAlign: "center",
                                  }}>
                                  {item.Ist}
                                </td>
                                <td
                                  style={{
                                    padding: "8px",
                                    textAlign: "center",
                                    fontWeight: "bold",
                                    color: "var(--warning)",
                                  }}>
                                  {item.Zuviel}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}

                {/* Gefunden */}
                {activeSection === "gefunden" && (
                  <>
                    <h4
                      style={{
                        color: "var(--success)",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 12,
                      }}>
                      <FontAwesomeIcon icon={faCheckCircle} />
                      Gefundene Artikel ({diff.gefunden.length})
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 400,
                          color: "var(--text-secondary)",
                        }}>
                        – Im Soll und auch gescannt
                      </span>
                    </h4>
                    {diff.gefunden.length === 0 ? (
                      <p style={{ color: "var(--text-muted)" }}>
                        Keine Artikel übereinstimmend.
                      </p>
                    ) : (
                      <div style={{ overflowX: "auto" }}>
                        <table
                          className="table"
                          style={{ width: "100%", borderCollapse: "collapse" }}>
                          <thead>
                            <tr
                              style={{
                                borderBottom: "2px solid var(--border)",
                              }}>
                              <th style={{ padding: "8px", textAlign: "left" }}>
                                Artikelnummer
                              </th>
                              <th style={{ padding: "8px", textAlign: "left" }}>
                                Name
                              </th>
                              <th
                                style={{ padding: "8px", textAlign: "center" }}>
                                Soll
                              </th>
                              <th
                                style={{ padding: "8px", textAlign: "center" }}>
                                Gefunden
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {diff.gefunden.map((item) => (
                              <tr
                                key={item.Artikelnummer}
                                style={{
                                  borderBottom: "1px solid var(--border)",
                                }}>
                                <td style={{ padding: "8px" }}>
                                  <strong style={{ color: "var(--success)" }}>
                                    {item.Artikelnummer}
                                  </strong>
                                </td>
                                <td style={{ padding: "8px" }}>
                                  {item.Name || "–"}
                                </td>
                                <td
                                  style={{
                                    padding: "8px",
                                    textAlign: "center",
                                  }}>
                                  {item.Soll}
                                </td>
                                <td
                                  style={{
                                    padding: "8px",
                                    textAlign: "center",
                                  }}>
                                  {item.Gefunden}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </>
            )
          )}
        </div>

        <div className="modal-footer" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-secondary" onClick={onClose}>
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}

function LagerInventurEditor({ draftId, onBack }) {
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [inputNr, setInputNr] = useState("");
  const [allArticleNumbers, setAllArticleNumbers] = useState([]);
  const [showDiff, setShowDiff] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [lastSavedDraftStr, setLastSavedDraftStr] = useState(null);

  useEffect(() => {
    api
      .getInventurDraft(draftId)
      .then((d) => {
        if (!d.data) d.data = {};
        setDraft(d);
        setLastSavedDraftStr(
          JSON.stringify({ data: d.data, kommentar: d.kommentar }),
        );
        setTimeout(() => setDraftLoaded(true), 100);
      })
      .catch((err) => {
        alert(err.message);
        onBack();
      })
      .finally(() => setLoading(false));

    // Lade Artikelnummern für Autovervollständigung
    api
      .getUniqueArtikelnummern({
        ausgelagert: "0",
        verkauft: "0",
        ausschuss: "0",
      })
      .then((res) => {
        if (res && Array.isArray(res)) {
          setAllArticleNumbers(res);
        }
      })
      .catch((err) =>
        console.error("Fehler beim Laden der Artikelnummern", err),
      );
  }, [draftId, onBack]);

  const performSave = async (showSuccessAlert = false) => {
    const currentStr = JSON.stringify({
      data: draft.data,
      kommentar: draft.kommentar,
    });
    if (currentStr === lastSavedDraftStr) {
      // Nichts geändert, muss nicht gespeichert werden
      if (showSuccessAlert) alert("Inventur erfolgreich gespeichert!");
      return true;
    }

    setSaving(true);
    try {
      await api.updateInventurDraft(draftId, {
        data: draft.data,
        kommentar: draft.kommentar,
      });
      setLastSavedDraftStr(currentStr);
      if (showSuccessAlert) {
        alert("Inventur erfolgreich gespeichert!");
      }
      return true;
    } catch (err) {
      if (showSuccessAlert) {
        alert("Fehler beim Speichern: " + err.message);
      } else {
        console.error("Speicher-Fehler:", err);
      }
      throw err;
    } finally {
      setSaving(false);
    }
  };

  // Autosave
  useEffect(() => {
    if (!draftLoaded || !draft) return;
    const timer = setTimeout(() => {
      performSave(false).catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, [draft, draftLoaded, draftId]);

  const handleScan = (e) => {
    e.preventDefault();
    const nr = inputNr.trim().toUpperCase();
    if (!nr) return;

    setDraft((prev) => {
      const nextData = { ...prev.data };
      nextData[nr] = (nextData[nr] || 0) + 1;
      return { ...prev, data: nextData };
    });
    setInputNr("");
  };

  const handleCountChange = (nr, count) => {
    setDraft((prev) => {
      const nextData = { ...prev.data };
      const val = parseInt(count, 10);
      if (isNaN(val) || val <= 0) {
        delete nextData[nr];
      } else {
        nextData[nr] = val;
      }
      return { ...prev, data: nextData };
    });
  };

  const handleRemove = (nr) => {
    setDraft((prev) => {
      const nextData = { ...prev.data };
      delete nextData[nr];
      return { ...prev, data: nextData };
    });
  };

  const completeDraft = async () => {
    if (
      !window.confirm(
        "Möchtest du diese Inventur wirklich abschließen? Sie kann danach nicht mehr bearbeitet werden.",
      )
    )
      return;

    try {
      await performSave(false);
      await api.completeInventurDraft(draftId);
      setIsCompleted(true);
      setShowDiff(true); // Fehlbestand automatisch anzeigen
    } catch (err) {
      alert("Fehler beim Abschließen: " + err.message);
    }
  };

  const handleShowDiff = async () => {
    try {
      await performSave(false);
      setShowDiff(true);
    } catch (err) {
      alert("Fehler vor Auswertung: " + err.message);
    }
  };

  if (loading || !draft)
    return (
      <div className="loading">
        <div className="spinner"></div>
      </div>
    );

  const entries = Object.entries(draft.data || {}).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  return (
    <>
      {showDiff && (
        <InventurDiffModal
          draftId={draftId}
          onClose={() => {
            setShowDiff(false);
            if (isCompleted) {
              onBack();
            }
          }}
        />
      )}
      <div className="card">
        <div
          className="card-header"
          style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <button className="btn btn-secondary" onClick={onBack}>
            &larr; Zurück
          </button>
          <h3 style={{ margin: 0 }}>Lager-Inventur #{draft.id}</h3>
        </div>
        <div className="card-body">
          <div style={{ marginBottom: 20 }}>
            <label>Kommentar:</label>
            <input
              type="text"
              className="input"
              value={draft.kommentar || ""}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, kommentar: e.target.value }))
              }
              placeholder="Optionale Notiz..."
              style={{ width: "100%", maxWidth: 400, marginTop: 4 }}
            />
          </div>

          <form
            onSubmit={handleScan}
            style={{
              display: "flex",
              gap: 8,
              marginBottom: 24,
              padding: 16,
              background: "var(--bg-hover)",
              borderRadius: 8,
            }}>
            <input
              type="text"
              className="input"
              list="artikelnummer-autocomplete"
              value={inputNr}
              onChange={(e) => setInputNr(e.target.value)}
              placeholder="Artikelnummer scannen..."
              autoFocus
              style={{ flex: 1, maxWidth: 300 }}
            />
            <datalist id="artikelnummer-autocomplete">
              {allArticleNumbers.map((nr) => (
                <option key={nr} value={nr} />
              ))}
            </datalist>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!inputNr.trim()}>
              Hinzufügen
            </button>
          </form>

          <h4 style={{ marginBottom: 12 }}>
            Erfasste Artikel (
            {entries.reduce((sum, [_, count]) => sum + count, 0)} Stück gesamt)
          </h4>
          {entries.length === 0 ? (
            <p style={{ color: "var(--text-muted)" }}>
              Noch keine Artikel gescannt.
            </p>
          ) : (
            <div style={{ overflowX: "auto", marginBottom: 20 }}>
              <table
                className="table"
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  textAlign: "left",
                }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--border)" }}>
                    <th style={{ padding: "8px" }}>Artikelnummer</th>
                    <th style={{ width: 120, padding: "8px" }}>Anzahl</th>
                    <th
                      style={{
                        width: 80,
                        padding: "8px",
                        textAlign: "center",
                      }}>
                      Aktion
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(([nr, count]) => (
                    <tr
                      key={nr}
                      style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "8px" }}>
                        <strong>{nr}</strong>
                      </td>
                      <td style={{ padding: "8px" }}>
                        <input
                          type="number"
                          className="input"
                          min="1"
                          value={count}
                          onChange={(e) =>
                            handleCountChange(nr, e.target.value)
                          }
                          style={{ width: 80 }}
                        />
                      </td>
                      <td style={{ padding: "8px", textAlign: "center" }}>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => handleRemove(nr)}
                          title="Löschen">
                          <FontAwesomeIcon icon={faTimes} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div
            style={{
              display: "flex",
              gap: 12,
              marginTop: 20,
              paddingTop: 20,
              borderTop: "1px solid var(--border)",
              flexWrap: "wrap",
            }}>
            <button
              className="btn btn-primary"
              onClick={handleShowDiff}
              disabled={saving || entries.length === 0}
              title="Vergleiche gescannte Artikel mit dem Lagerbestand">
              <FontAwesomeIcon icon={faSearch} style={{ marginRight: 8 }} />
              Auswertung anzeigen
            </button>
            <button
              className="btn btn-success"
              onClick={completeDraft}
              disabled={saving}
              style={{ marginLeft: "auto" }}>
              <FontAwesomeIcon icon={faCheck} style={{ marginRight: 8 }} />
              Abschließen
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default function Lagerinventur() {
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeDraftId, setActiveDraftId] = useState(null);

  const loadDrafts = () => {
    setLoading(true);
    api
      .getInventurDrafts()
      .then(setDrafts)
      .catch((err) => alert("Fehler beim Laden der Inventuren: " + err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!activeDraftId) {
      loadDrafts();
    }
  }, [activeDraftId]);

  const createDraft = async () => {
    try {
      const draft = await api.createInventurDraft({ data: {}, kommentar: "" });
      setActiveDraftId(draft.id);
    } catch (err) {
      alert(err.message);
    }
  };

  if (activeDraftId) {
    return (
      <LagerInventurEditor
        draftId={activeDraftId}
        onBack={() => setActiveDraftId(null)}
      />
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Lager-Inventur</h2>
          <p>
            Erfasse Schmuckstücke im Lager per Barcode-Scanner und vergleiche
            den Ist-Bestand mit dem Soll-Bestand
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>Offene Inventuren</h3>
          <button className="btn btn-primary" onClick={createDraft}>
            <FontAwesomeIcon icon={faPlus} style={{ marginRight: 8 }} />
            Neue Inventur
          </button>
        </div>
        <div className="card-body">
          {loading ? (
            <div className="loading">
              <div className="spinner"></div>Lade Inventuren...
            </div>
          ) : drafts.length === 0 ? (
            <p style={{ color: "var(--text-muted)", padding: 10 }}>
              Keine offenen Inventuren vorhanden.
            </p>
          ) : (
            <DataTable
              data={drafts}
              getRowKey={(d) => d.id}
              onRowClick={(d) => setActiveDraftId(d.id)}
              columns={[
                { key: "id", label: "ID", render: (d) => `#${d.id}` },
                {
                  key: "created_at",
                  label: "Erstellt am",
                  render: (d) => new Date(d.created_at).toLocaleString("de-DE"),
                },
                {
                  key: "updated_at",
                  label: "Zuletzt geändert",
                  render: (d) => new Date(d.updated_at).toLocaleString("de-DE"),
                },
                {
                  key: "kommentar",
                  label: "Kommentar",
                  render: (d) =>
                    d.kommentar || (
                      <span style={{ color: "var(--text-muted)" }}>
                        Kein Kommentar
                      </span>
                    ),
                },
                {
                  key: "item_count",
                  label: "Gescannte Artikel",
                  render: (d) =>
                    Object.values(d.data || {}).reduce((s, c) => s + c, 0) +
                    " Stück",
                },
              ]}
            />
          )}
        </div>
      </div>
    </div>
  );
}
