import { useState, useEffect } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faGem,
  faCopy,
  faPen,
  faTrash,
  faArrowLeft,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { statusBadge } from "../utils/status";
import { formatEur } from "../utils/zahlen";

export default function SchmuckstueckDetail() {
  const { artikelnummer } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  // Edit/Delete nur wenn man von der Schmuckstücke-Liste kommt
  const fromSchmuckstuecke = location.state?.fromSchmuckstuecke === true;
  const canEdit =
    fromSchmuckstuecke &&
    user &&
    (user.role === "admin" || user.role === "bearbeiter");

  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [kunden, setKunden] = useState([]);
  const [photo, setPhoto] = useState(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoError, setPhotoError] = useState(null);

  useEffect(() => {
    setLoading(true);
    api
      .getSchmuckstueck(artikelnummer)
      .then(setItem)
      .catch(() => navigate("/schmuckstuecke", { replace: true }))
      .finally(() => setLoading(false));
    api.getKunden().then(setKunden).catch(console.error);
  }, [artikelnummer]);

  useEffect(() => {
    if (item?.Foto) {
      setPhotoLoading(true);
      setPhotoError(null);
      api
        .loadPhotoAsDataUrl(item.Foto)
        .then(setPhoto)
        .catch((err) => {
          setPhoto(null);
          setPhotoError(err.message);
          console.error(err);
        })
        .finally(() => setPhotoLoading(false));
    } else {
      setPhoto(null);
      setPhotoError(null);
    }
  }, [item]);

  const getKundenName = (id) => {
    const kunde = kunden.find((k) => k.ID === id);
    return kunde ? kunde.Name : `Kundennummer ${id}`;
  };

  const handleDelete = async () => {
    if (!confirm(`Schmuckstück ${artikelnummer} wirklich löschen?`)) return;
    try {
      await api.deleteSchmuckstueck(artikelnummer);
      navigate("/schmuckstuecke");
    } catch (err) {
      alert(err.message);
    }
  };

  const handleEdit = () => {
    navigate("/schmuckstuecke", { state: { openEdit: artikelnummer } });
  };

  const handleDuplicate = () => {
    navigate("/schmuckstuecke", { state: { openDuplicate: artikelnummer } });
  };

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner"></div>Lade...
      </div>
    );
  }

  if (!item) return null;

  return (
    <div>
      <div className="page-header">
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => navigate(-1)}
            title="Zurück">
            <FontAwesomeIcon icon={faArrowLeft} />
          </button>
          <div>
            <h2>
              <FontAwesomeIcon icon={faGem} /> {item.Artikelnummer}
            </h2>
            <p>
              {(() => {
                const badge = statusBadge(item, getKundenName);
                return <span className={badge.klasse}>{badge.label}</span>;
              })()}
            </p>
          </div>
        </div>
        {canEdit && (
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              className="btn btn-secondary"
              onClick={handleDuplicate}>
              <FontAwesomeIcon icon={faCopy} /> Duplizieren
            </button>
            <button
              className="btn btn-secondary"
              onClick={handleEdit}>
              <FontAwesomeIcon icon={faPen} /> Bearbeiten
            </button>
            <button
              className="btn btn-danger"
              onClick={handleDelete}>
              <FontAwesomeIcon icon={faTrash} /> Löschen
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-body">
          {/* Foto */}
          <div
            style={{
              textAlign: "center",
              padding: "16px 0",
              borderBottom: "1px solid #ddd",
              backgroundColor: "#f9f9f9",
              marginBottom: "16px",
              borderRadius: "4px",
            }}>
            {photo ? (
              <img
                src={photo}
                alt={item.Artikelnummer}
                style={{
                  maxWidth: "200px",
                  maxHeight: "200px",
                  borderRadius: "8px",
                }}
              />
            ) : item.Foto && photoLoading ? (
              <div
                style={{
                  width: "200px",
                  height: "200px",
                  margin: "0 auto",
                  borderRadius: "8px",
                  backgroundColor: "#e0e0e0",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#999",
                  fontSize: "14px",
                  border: "2px dashed #ccc",
                }}>
                <div>
                  <div style={{ marginBottom: "8px" }}>⏳</div>
                  Bild wird geladen...
                </div>
              </div>
            ) : item.Foto && photoError ? (
              <div
                style={{
                  width: "200px",
                  minHeight: "200px",
                  margin: "0 auto",
                  borderRadius: "8px",
                  backgroundColor: "#fff4e5",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#7a4b00",
                  fontSize: "14px",
                  border: "2px dashed #d8a74f",
                  padding: "12px",
                  boxSizing: "border-box",
                  textAlign: "center",
                }}>
                <div>
                  <div style={{ marginBottom: "8px" }}>⚠️</div>
                  Bild konnte nicht geladen werden
                  <div style={{ marginTop: "8px", fontSize: "12px" }}>
                    {photoError}
                  </div>
                </div>
              </div>
            ) : (
              <div
                style={{
                  width: "200px",
                  height: "200px",
                  margin: "0 auto",
                  borderRadius: "8px",
                  backgroundColor: "#f0f0f0",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#bbb",
                  fontSize: "14px",
                  border: "2px dashed #ddd",
                }}>
                <div>
                  <div style={{ marginBottom: "8px", fontSize: "24px" }}>
                    📷
                  </div>
                  Kein Bild vorhanden
                </div>
              </div>
            )}
          </div>

          {/* Details */}
          <div className="detail-grid">
            {[
              ["Grundmaterial", item.Grundmaterial],
              ["Art", item.Art],
              ["Form", item.Form],
              ["Länge", item["Länge"] ? `${item["Länge"]} cm` : "–"],
              ["Fassung", item.Fassung],
              ["Farbe", item.Farbe],
              ["Material", item.Material],
              ["Größe", item["Grösse"]],
              ["Inhalt Material", item.Inhalt_Material],
              ["Inhalt Farbe", item.Inhalt_Farbe],
              ["Inhalt Farbakzent", item.Inhalt_Farbakzent],
              ["Inhalt Zusatzmaterial", item.Inhalt_Zusatzmaterial],
              ["Anhänger Fassung", item["Anhänger_Fassung"]],
              ["Anhänger Form", item["Anhänger_Form"]],
              ["Anhänger Farbe", item["Anhänger_Farbe"]],
              ["Anhänger Größe", item["Anhänger_Grösse"]],
              ["Anhänger Inhalt Material", item["Anhänger_Inhalt_Material"]],
              ["Anhänger Inhalt Farbe", item["Anhänger_Inhalt_Farbe"]],
              ["Zwischenstück", item["Zwischenstück"]],
              [
                "Herstellungskosten",
                item.Herstellungskosten
                  ? formatEur(item.Herstellungskosten)
                  : "–",
              ],
              [
                "Verkaufspreis",
                item.Verkaufspreis ? formatEur(item.Verkaufspreis) : "–",
              ],
              [
                "Erstellt",
                item.Erstelldatum
                  ? new Date(item.Erstelldatum).toLocaleDateString("de-DE", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                    })
                  : "–",
              ],
              [
                "Letzte Änderung",
                item["Letzte_Änderung"]
                  ? new Date(item["Letzte_Änderung"]).toLocaleString("de-DE")
                  : "–",
              ],
            ]
              .filter(([, v]) => v && v !== "–" && v !== 0 && v !== "0")
              .map(([label, value]) => (
                <div className="detail-item" key={label}>
                  <label>{label}</label>
                  <div className="detail-value">{value}</div>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
