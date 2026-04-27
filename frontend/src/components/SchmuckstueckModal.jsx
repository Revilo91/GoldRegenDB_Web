import { useState, useEffect } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGem, faTimes, faPen, faTrash } from "@fortawesome/free-solid-svg-icons";
import { api } from "../api";

/**
 * Zeigt ein Schmuckstück-Detail-Modal über einem bestehenden Modal.
 * Props:
 *   artikelnummer  – Artikelnummer des anzuzeigenden Stücks
 *   onClose        – Callback zum Schließen
 *   onEdit         – (optional) Callback für Bearbeiten-Button
 *   onDelete       – (optional) Callback für Löschen-Button
 */
export default function SchmuckstueckModal({ artikelnummer, onClose, onEdit, onDelete }) {
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [kunden, setKunden] = useState([]);
  const [photo, setPhoto] = useState(null);
  const [photoLoading, setPhotoLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([api.getSchmuckstueck(artikelnummer), api.getKunden()])
      .then(([s, k]) => {
        setItem(s);
        setKunden(k);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [artikelnummer]);

  useEffect(() => {
    if (item?.Foto) {
      setPhotoLoading(true);
      api
        .loadPhotoAsDataUrl(item.Foto)
        .then(setPhoto)
        .catch(console.error)
        .finally(() => setPhotoLoading(false));
    } else {
      setPhoto(null);
    }
  }, [item]);

  const getKundenName = (id) => {
    const kunde = kunden.find((k) => k.ID === id);
    return kunde ? kunde.Name : `Kundennummer ${id}`;
  };

  return (
    <div
      className="modal-overlay"
      style={{ zIndex: 1600 }}
      onClick={onClose}>
      <div
        className="modal"
        style={{ maxWidth: 680 }}
        onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>
            <FontAwesomeIcon icon={faGem} />{" "}
            {item ? item.Artikelnummer : artikelnummer}{" "}
            {item && (
              <>
                {item.Verkauft === 1 ? (
                  <span className="badge success">Verkauft</span>
                ) : item.Ausschuss === 1 ? (
                  <span className="badge danger">Ausschuss</span>
                ) : item.Ausgelagert > 0 ? (
                  <span className="badge gold">
                    Ausgelagert: {getKundenName(item.Ausgelagert)}
                  </span>
                ) : (
                  <span className="badge warning">Lager</span>
                )}
              </>
            )}
          </h3>
          {(onEdit || onDelete) && (
            <div style={{ marginLeft: "auto", marginRight: 16 }}>
              {onEdit && (
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ marginRight: 8 }}
                  onClick={onEdit}>
                  <FontAwesomeIcon icon={faPen} /> Bearbeiten
                </button>
              )}
              {onDelete && (
                <button className="btn btn-danger btn-sm" onClick={onDelete}>
                  <FontAwesomeIcon icon={faTrash} /> Löschen
                </button>
              )}
            </div>
          )}
          <button className="modal-close" onClick={onClose}>
            <FontAwesomeIcon icon={faTimes} />
          </button>
        </div>

        {loading ? (
          <div className="loading" style={{ padding: "32px" }}>
            <div className="spinner"></div>Lade…
          </div>
        ) : item ? (
          <>
            {/* Foto */}
            <div
              style={{
                textAlign: "center",
                padding: "16px 0",
                borderBottom: "1px solid #ddd",
                backgroundColor: "#f9f9f9",
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
                    ? `${item.Herstellungskosten}€`
                    : "–",
                ],
                [
                  "Verkaufspreis",
                  item.Verkaufspreis ? `${item.Verkaufspreis}€` : "–",
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
          </>
        ) : (
          <div style={{ padding: "24px", textAlign: "center", color: "#999" }}>
            Schmuckstück nicht gefunden.
          </div>
        )}
      </div>
    </div>
  );
}
